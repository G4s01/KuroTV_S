/**
 * Tier 2 Boundary & Corner Cases: Simple-Login TV Pairing Suite
 *
 * Covers boundary, edge, and corner cases for:
 * - Code Generation & Unambiguous Charset (/api/pair/start)
 * - Public Metadata Preview (/api/pair/info)
 * - Case-Insensitive Normalization & Status Polling (/api/pair/status)
 * - X-Pair-Secret Header Validation & Timing-Safe Checks
 * - Web & Mobile Approval (/api/pair/approve)
 * - Atomic Single-Use Consumption & Replay Prevention
 * - Expiration Lifecycles & Piggybacked Maintenance Cleanup
 * - Rate Limiting on Pairing Endpoints
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { TestHarness, clearDatabase } from "../helpers/harness";
import { ensureSchema } from "../../src/worker/schema";
import { resetRateLimits } from "../../src/worker/rate-limit";
import { sha256Hex } from "../../src/worker/crypto";

describe("Tier 2: TV Pairing Boundary & Corner Cases", () => {
  let harness: TestHarness;
  let masterAuthToken: string;
  let defaultProfileId: string;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();

    // Initialize instance
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
      initialProfileName: "Living Room",
      createSession: true,
    });
    defaultProfileId = setupRes.body.profileId;

    const loginRes = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: "MasterPassword123!",
    });
    masterAuthToken = loginRes.body.token;
  });

  // ==========================================================================
  // 1. Pairing Code Generation & Charset Boundaries (/api/pair/start)
  // ==========================================================================
  describe("1. Pairing Start Boundaries", () => {
    it("1.1 rejects start pairing with missing or empty deviceName (400)", async () => {
      const resEmpty = await harness.post("/api/pair/start", { deviceName: "" });
      expect(resEmpty.status).toBe(400);

      const resWhitespace = await harness.post("/api/pair/start", { deviceName: "    " });
      expect(resWhitespace.status).toBe(400);

      const resMissing = await harness.post("/api/pair/start", {});
      expect(resMissing.status).toBe(400);
    });

    it("1.2 generates strictly unambiguous 6-character uppercase codes (no 0, O, 1, I)", async () => {
      const UNAMBIGUOUS_REGEX = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

      for (let i = 0; i < 5; i++) {
        const res = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
          deviceName: `Android TV #${i + 1}`,
        });
        expect(res.status).toBe(201);
        expect(res.body.code).toHaveLength(6);
        expect(res.body.code).toMatch(UNAMBIGUOUS_REGEX);
        expect(res.body.code).not.toMatch(/[0O1I]/);
        expect(res.body.pairSecret).toBeDefined();
        expect(res.body.pairSecret.length).toBeGreaterThanOrEqual(16);
      }
    });

    it("1.3 defaults deviceType to 'tv' and platform to 'android-tv' when not specified", async () => {
      const res = await harness.post<{ code: string }>("/api/pair/start", {
        deviceName: "Living Room Bravia",
      });
      expect(res.status).toBe(201);

      const record = await env.DB.prepare("SELECT device_type, platform FROM pairing_codes WHERE code = ?")
        .bind(res.body.code)
        .first<{ device_type: string; platform: string }>();

      expect(record?.device_type).toBe("tv");
      expect(record?.platform).toBe("android-tv");
    });

    it("1.4 respects explicit mobile deviceType and custom platform", async () => {
      const res = await harness.post<{ code: string }>("/api/pair/start", {
        deviceName: "Pixel Tablet",
        deviceType: "mobile",
        platform: "android-tablet",
      });
      expect(res.status).toBe(201);

      const record = await env.DB.prepare("SELECT device_type, platform FROM pairing_codes WHERE code = ?")
        .bind(res.body.code)
        .first<{ device_type: string; platform: string }>();

      expect(record?.device_type).toBe("mobile");
      expect(record?.platform).toBe("android-tablet");
    });

    it("1.5 returns valid verifyUrl formatted with origin and query code", async () => {
      const res = await harness.post<{ code: string; verifyUrl: string }>("/api/pair/start", {
        deviceName: "Sony OLED",
      });
      expect(res.status).toBe(201);
      expect(res.body.verifyUrl).toContain(`/pair?code=${res.body.code}`);
    });
  });

  // ==========================================================================
  // 2. Public Pairing Metadata Boundaries (/api/pair/info)
  // ==========================================================================
  describe("2. Public Pairing Metadata Boundaries (/api/pair/info)", () => {
    let testCode: string;

    beforeEach(async () => {
      const res = await harness.post<{ code: string }>("/api/pair/start", {
        deviceName: "Bedroom Shield TV",
        platform: "shield",
      });
      testCode = res.body.code;
    });

    it("2.1 rejects /api/pair/info without code parameter (400)", async () => {
      const res = await harness.get("/api/pair/info");
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("code query parameter is required");
    });

    it("2.2 returns 404 for non-existent pairing code", async () => {
      const res = await harness.get("/api/pair/info?code=ZZZZZZ");
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("not found");
    });

    it("2.3 allows public access without authentication or X-Pair-Secret header", async () => {
      const publicHarness = new TestHarness();
      const res = await publicHarness.get<{
        ok: boolean;
        code: string;
        deviceName: string;
        status: string;
      }>(`/api/pair/info?code=${testCode}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.code).toBe(testCode);
      expect(res.body.deviceName).toBe("Bedroom Shield TV");
      expect(res.body.status).toBe("pending");
    });

    it("2.4 handles lowercase code queries with case-insensitive normalization", async () => {
      const lowercase = testCode.toLowerCase();
      const res = await harness.get<{ ok: boolean; code: string }>(`/api/pair/info?code=${lowercase}`);
      expect(res.status).toBe(200);
      expect(res.body.code).toBe(testCode);
    });

    it("2.5 reflects expired status dynamically when current time exceeds expires_at", async () => {
      // Artificially expire the code in D1
      await env.DB.prepare("UPDATE pairing_codes SET expires_at = ? WHERE code = ?")
        .bind(Date.now() - 10000, testCode)
        .run();

      const res = await harness.get<{ ok: boolean; status: string }>(`/api/pair/info?code=${testCode}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("expired");
    });
  });

  // ==========================================================================
  // 3. Status Polling & Secret Header Validation (/api/pair/status)
  // ==========================================================================
  describe("3. Status Polling & Secret Header Boundaries", () => {
    let testCode: string;
    let testSecret: string;

    beforeEach(async () => {
      const res = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
        deviceName: "Samsung Smart TV",
      });
      testCode = res.body.code;
      testSecret = res.body.pairSecret;
    });

    it("3.1 rejects polling without code query parameter (400)", async () => {
      harness.setPairSecret(testSecret);
      const res = await harness.get("/api/pair/status");
      expect(res.status).toBe(400);
    });

    it("3.2 rejects polling without X-Pair-Secret header (401)", async () => {
      const res = await harness.get(`/api/pair/status?code=${testCode}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Missing X-Pair-Secret header");
    });

    it("3.3 rejects polling with incorrect X-Pair-Secret header (401)", async () => {
      harness.setPairSecret("wrong-secret-key-12345");
      const res = await harness.get(`/api/pair/status?code=${testCode}`);
      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Invalid X-Pair-Secret");
    });

    it("3.4 returns 404 for non-existent pairing code with valid secret header", async () => {
      harness.setPairSecret(testSecret);
      const res = await harness.get("/api/pair/status?code=NONEX9");
      expect(res.status).toBe(404);
    });

    it("3.5 supports case-insensitive polling (polled as lowercase code)", async () => {
      harness.setPairSecret(testSecret);
      const res = await harness.get<{ status: string }>(`/api/pair/status?code=${testCode.toLowerCase()}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("pending");
    });

    it("3.6 returns status 'expired' when polling an expired code (> 5 minutes)", async () => {
      await env.DB.prepare("UPDATE pairing_codes SET expires_at = ? WHERE code = ?")
        .bind(Date.now() - 5000, testCode)
        .run();

      harness.setPairSecret(testSecret);
      const res = await harness.get<{ status: string }>(`/api/pair/status?code=${testCode}`);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("expired");
    });
  });

  // ==========================================================================
  // 4. Approval Boundaries (/api/pair/approve)
  // ==========================================================================
  describe("4. Approval Boundaries (/api/pair/approve)", () => {
    let testCode: string;

    beforeEach(async () => {
      const res = await harness.post<{ code: string }>("/api/pair/start", {
        deviceName: "Living Room Shield",
      });
      testCode = res.body.code;
    });

    it("4.1 rejects approval without authentication (401)", async () => {
      const res = await harness.post("/api/pair/approve", {
        code: testCode,
        profileId: defaultProfileId,
      });
      expect(res.status).toBe(401);
    });

    it("4.2 rejects approval with missing code or profileId (400)", async () => {
      harness.setBearerToken(masterAuthToken);

      const resNoCode = await harness.post("/api/pair/approve", {
        profileId: defaultProfileId,
      });
      expect(resNoCode.status).toBe(400);

      const resNoProfile = await harness.post("/api/pair/approve", {
        code: testCode,
      });
      expect(resNoProfile.status).toBe(400);
    });

    it("4.3 rejects approval for non-existent pairing code (404)", async () => {
      harness.setBearerToken(masterAuthToken);
      const res = await harness.post("/api/pair/approve", {
        code: "NOEXST",
        profileId: defaultProfileId,
      });
      expect(res.status).toBe(404);
    });

    it("4.4 rejects approval for non-existent profileId (404)", async () => {
      harness.setBearerToken(masterAuthToken);
      const res = await harness.post("/api/pair/approve", {
        code: testCode,
        profileId: crypto.randomUUID(),
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Profile not found");
    });

    it("4.5 rejects approval for expired pairing code (410 Gone)", async () => {
      await env.DB.prepare("UPDATE pairing_codes SET expires_at = ? WHERE code = ?")
        .bind(Date.now() - 1000, testCode)
        .run();

      harness.setBearerToken(masterAuthToken);
      const res = await harness.post("/api/pair/approve", {
        code: testCode,
        profileId: defaultProfileId,
      });
      expect(res.status).toBe(410);
      expect(res.body.error).toContain("expired");
    });

    it("4.6 normalizes lowercase code input on approval", async () => {
      harness.setBearerToken(masterAuthToken);
      const res = await harness.post<{ ok: boolean; deviceId: string }>("/api/pair/approve", {
        code: testCode.toLowerCase(),
        profileId: defaultProfileId,
        deviceLabel: "Custom Normalization TV",
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const record = await env.DB.prepare("SELECT status FROM pairing_codes WHERE code = ?")
        .bind(testCode)
        .first<{ status: string }>();
      expect(record?.status).toBe("approved");
    });
  });

  // ==========================================================================
  // 5. Atomic Single-Use Consumption & Replay Prevention
  // ==========================================================================
  describe("5. Atomic Single-Use Consumption & Replay Prevention", () => {
    let testCode: string;
    let testSecret: string;

    beforeEach(async () => {
      const startRes = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
        deviceName: "Sony OLED TV",
      });
      testCode = startRes.body.code;
      testSecret = startRes.body.pairSecret;

      // Approve code
      harness.setBearerToken(masterAuthToken);
      await harness.post("/api/pair/approve", {
        code: testCode,
        profileId: defaultProfileId,
        deviceLabel: "Sony Master Series",
      });
      harness.clearAuth();
    });

    it("5.1 first status poll after approval delivers deviceToken and transitions to consumed", async () => {
      harness.setPairSecret(testSecret);
      const firstPoll = await harness.get<{
        status: string;
        deviceToken: string;
        deviceId: string;
        profileId: string;
        profileName: string;
      }>(`/api/pair/status?code=${testCode}`);

      expect(firstPoll.status).toBe(200);
      expect(firstPoll.body.status).toBe("approved");
      expect(firstPoll.body.deviceToken).toMatch(/^kuro_tv_/);
      expect(firstPoll.body.deviceId).toBeDefined();
      expect(firstPoll.body.profileId).toBe(defaultProfileId);

      // Verify raw ephemeral token is purged from D1 and status is consumed
      const dbRecord = await env.DB.prepare(
        "SELECT status, raw_device_token_encrypted_or_ephemeral FROM pairing_codes WHERE code = ?"
      )
        .bind(testCode)
        .first<{ status: string; raw_device_token_encrypted_or_ephemeral: string | null }>();

      expect(dbRecord?.status).toBe("consumed");
      expect(dbRecord?.raw_device_token_encrypted_or_ephemeral).toBeNull();
    });

    it("5.2 second status poll after delivery returns consumed status without re-delivering token", async () => {
      harness.setPairSecret(testSecret);

      // First poll consumes
      await harness.get(`/api/pair/status?code=${testCode}`);

      // Second poll
      const secondPoll = await harness.get<{
        status: string;
        deviceToken?: string;
      }>(`/api/pair/status?code=${testCode}`);

      expect(secondPoll.status).toBe(200);
      expect(secondPoll.body.status).toBe("consumed");
      expect(secondPoll.body.deviceToken).toBeUndefined();
    });

    it("5.3 attempting to re-approve a consumed pairing code fails with 409 Conflict", async () => {
      harness.setPairSecret(testSecret);
      // Consume the code
      await harness.get(`/api/pair/status?code=${testCode}`);

      // Try re-approving with master token
      harness.clearAuth();
      harness.setBearerToken(masterAuthToken);
      const reApproveRes = await harness.post("/api/pair/approve", {
        code: testCode,
        profileId: defaultProfileId,
      });

      expect(reApproveRes.status).toBe(409);
      expect(reApproveRes.body.error).toContain("already been consumed");
    });

    it("5.4 delivered TV device token successfully authenticates future requests", async () => {
      harness.setPairSecret(testSecret);
      const pollRes = await harness.get<{
        status: string;
        deviceToken: string;
      }>(`/api/pair/status?code=${testCode}`);

      const tvDeviceToken = pollRes.body.deviceToken;
      expect(tvDeviceToken).toBeDefined();

      // Test that this token can make authenticated requests to /api/devices
      harness.clearAuth();
      harness.setBearerToken(tvDeviceToken);
      const devicesRes = await harness.get<{ ok: boolean; devices: any[] }>("/api/devices");
      expect(devicesRes.status).toBe(200);
      expect(devicesRes.body.ok).toBe(true);
      expect(devicesRes.body.devices.some((d) => d.name === "Sony Master Series")).toBe(true);
    });
  });

  // ==========================================================================
  // 6. Rate Limiting on Pairing Endpoints
  // ==========================================================================
  describe("6. Pairing Rate Limiting Boundaries", () => {
    it("6.1 returns 429 when /api/pair/start limit (10 req/min) is exceeded", async () => {
      for (let i = 0; i < 10; i++) {
        const res = await harness.post("/api/pair/start", {
          deviceName: `TV Device ${i}`,
        });
        expect(res.status).toBe(201);
      }

      // 11th request from same IP must be rate limited
      const rateLimitedRes = await harness.post("/api/pair/start", {
        deviceName: "Over Limit TV",
      });
      expect(rateLimitedRes.status).toBe(429);
      expect(rateLimitedRes.body.error).toBe("Too Many Requests");
    });
  });
});
