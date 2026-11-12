/**
 * Tier 2 Boundary & Corner Cases: Setup & Authentication Suite
 *
 * Covers boundary, edge, and corner cases for:
 * - Hybrid Zero-Config Setup (/api/setup)
 * - Master Admin Authentication (/api/auth/login)
 * - Smartphone Device Login & Exchange (/api/auth/device-login, /api/auth/exchange)
 * - Token Storage, Bearer Validation & Revocation (/api/devices, middleware)
 * - In-Memory Rate Limiting thresholds under rapid requests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { TestHarness, clearDatabase } from "../helpers/harness";
import { ensureSchema } from "../../src/worker/schema";
import { resetRateLimits } from "../../src/worker/rate-limit";
import { sha256Hex, hashToken } from "../../src/worker/crypto";

describe("Tier 2: Setup & Auth Boundary & Corner Cases", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();
  });

  // ==========================================================================
  // 1. Setup Wizard Boundaries (/api/setup)
  // ==========================================================================
  describe("1. Setup Wizard Boundaries", () => {
    it("1.1 rejects setup with empty master password (400)", async () => {
      const res = await harness.post("/api/setup", {
        masterPassword: "",
        initialProfileName: "Primary",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("masterPassword is required");
    });

    it("1.2 rejects setup with whitespace-only master password (400)", async () => {
      const res = await harness.post("/api/setup", {
        masterPassword: "        ",
        initialProfileName: "Primary",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("masterPassword is required");
    });

    it("1.3 rejects setup with password shorter than 8 characters (400)", async () => {
      const res = await harness.post("/api/setup", {
        masterPassword: "short",
        initialProfileName: "Primary",
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("at least 8 characters");
    });

    it("1.4 handles ultra-long master password (1024 characters) successfully", async () => {
      const longPassword = "A".repeat(1024);
      const res = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
        masterPassword: longPassword,
        initialProfileName: "Main",
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify that login works with this 1024-char password
      const loginRes = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
        password: longPassword,
      });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.ok).toBe(true);
      expect(loginRes.body.token).toBeDefined();
    });

    it("1.5 handles Unicode, emoji, and special character master passwords", async () => {
      const unicodePassword = "🔐KuroMaster_2026_🚀✨-ç@#€!漢字";
      const res = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
        masterPassword: unicodePassword,
        initialProfileName: "Otaku Profile 🌸",
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      // Verify profile name saved with Unicode
      const profile = await env.DB.prepare("SELECT name FROM profiles WHERE id = ?")
        .bind(res.body.profileId)
        .first<{ name: string }>();
      expect(profile?.name).toBe("Otaku Profile 🌸");

      // Verify login succeeds with exact Unicode password
      const loginRes = await harness.post<{ ok: boolean }>("/api/auth/login", {
        password: unicodePassword,
      });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.ok).toBe(true);
    });

    it("1.6 defaults initial profile name to 'Principale' when omitted or whitespace", async () => {
      const res = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
        masterPassword: "ValidMasterPassword123!",
        initialProfileName: "   ",
      });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const profile = await env.DB.prepare("SELECT name FROM profiles WHERE id = ?")
        .bind(res.body.profileId)
        .first<{ name: string }>();
      expect(profile?.name).toBe("Principale");
    });

    it("1.7 rejects setup with invalid non-JSON body (400)", async () => {
      const res = await harness.request("/api/setup", {
        method: "POST",
        body: "malformed-json-payload-not-an-object",
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid JSON body");
    });

    it("1.8 blocks setup when SYNC_ADMIN_SECRET is active (403)", async () => {
      const harnessWithSecret = new TestHarness({ SYNC_ADMIN_SECRET: "predefined-admin-key" });
      const res = await harnessWithSecret.post("/api/setup", {
        masterPassword: "MyPassword123!",
      });
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden");
    });

    it("1.9 double-setup race condition returns 409 conflict on subsequent calls", async () => {
      const first = await harness.post<{ ok: boolean }>("/api/setup", {
        masterPassword: "FirstPassword123!",
      });
      expect(first.status).toBe(200);

      // Immediate second call
      const second = await harness.post("/api/setup", {
        masterPassword: "SecondPassword456!",
      });
      expect(second.status).toBe(409);
      expect(second.body.error).toBe("Conflict");
    });
  });

  // ==========================================================================
  // 2. Master Authentication Boundaries (/api/auth/login)
  // ==========================================================================
  describe("2. Master Authentication Boundaries", () => {
    it("2.1 rejects login with 401 when instance is not yet initialized", async () => {
      const res = await harness.post("/api/auth/login", {
        password: "SomePassword123!",
      });
      expect(res.status).toBe(401);
      expect(res.body.message).toContain("not initialized");
    });

    it("2.2 rejects login with missing or empty password (400)", async () => {
      await harness.post("/api/setup", { masterPassword: "CorrectPassword123!" });

      const resEmpty = await harness.post("/api/auth/login", { password: "" });
      expect(resEmpty.status).toBe(400);

      const resWhitespace = await harness.post("/api/auth/login", { password: "   " });
      expect(resWhitespace.status).toBe(400);

      const resMissing = await harness.post("/api/auth/login", {});
      expect(resMissing.status).toBe(400);
    });

    it("2.3 rejects login with incorrect password (401)", async () => {
      await harness.post("/api/setup", { masterPassword: "CorrectPassword123!" });

      const res = await harness.post("/api/auth/login", {
        password: "WrongPassword999!",
      });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Unauthorized");
    });

    it("2.4 timing-safe comparison with SYNC_ADMIN_SECRET accepts valid secret and rejects invalid", async () => {
      const harnessEnv = new TestHarness({ SYNC_ADMIN_SECRET: "super-secret-sync-admin-key" });

      const resWrong = await harnessEnv.post("/api/auth/login", {
        password: "super-secret-sync-admin-wrong",
      });
      expect(resWrong.status).toBe(401);

      const resCorrect = await harnessEnv.post<{ ok: boolean; token: string }>("/api/auth/login", {
        password: "super-secret-sync-admin-key",
      });
      expect(resCorrect.status).toBe(200);
      expect(resCorrect.body.ok).toBe(true);
      expect(resCorrect.body.token).toBeDefined();
    });
  });

  // ==========================================================================
  // 3. Smartphone Quick Login & Exchange Boundaries
  // ==========================================================================
  describe("3. Smartphone Device Login & Exchange Boundaries", () => {
    let profileId: string;

    beforeEach(async () => {
      const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
        masterPassword: "MasterPassword123!",
        initialProfileName: "Living Room",
      });
      profileId = setupRes.body.profileId;
    });

    it("3.1 /api/auth/device-login rejects missing profileId or password (400)", async () => {
      const resNoPass = await harness.post("/api/auth/device-login", {
        profileId,
        deviceName: "Pixel 8",
      });
      expect(resNoPass.status).toBe(400);

      const resNoProf = await harness.post("/api/auth/device-login", {
        password: "MasterPassword123!",
        deviceName: "Pixel 8",
      });
      expect(resNoProf.status).toBe(400);
    });

    it("3.2 /api/auth/device-login rejects non-existent profileId (404)", async () => {
      const res = await harness.post("/api/auth/device-login", {
        password: "MasterPassword123!",
        profileId: crypto.randomUUID(),
        deviceName: "Pixel 8",
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toContain("Profile not found");
    });

    it("3.3 /api/auth/device-login issues mobile device token with custom deviceName", async () => {
      const res = await harness.post<{
        ok: boolean;
        deviceToken: string;
        deviceId: string;
        profile: { id: string; name: string };
      }>("/api/auth/device-login", {
        password: "MasterPassword123!",
        profileId,
        deviceName: "Kuro Phone Pro",
        platform: "android",
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.deviceToken).toMatch(/^kuro_dev_/);
      expect(res.body.deviceId).toBeDefined();

      // Verify device recorded in D1
      const device = await env.DB.prepare("SELECT name, device_type, platform FROM devices WHERE id = ?")
        .bind(res.body.deviceId)
        .first<{ name: string; device_type: string; platform: string }>();
      expect(device?.name).toBe("Kuro Phone Pro");
      expect(device?.device_type).toBe("mobile");
      expect(device?.platform).toBe("android");
    });

    it("3.4 /api/auth/exchange rejects missing or invalid exchange token (400/404)", async () => {
      const resEmpty = await harness.post("/api/auth/exchange", {});
      expect(resEmpty.status).toBe(400);

      const resInvalid = await harness.post("/api/auth/exchange", {
        token: "non-existent-or-expired-token",
      });
      expect(resInvalid.status).toBe(404);
      expect(resInvalid.body.error).toContain("Invalid or expired exchange token");
    });
  });

  // ==========================================================================
  // 4. Token Validation & Revocation Boundaries
  // ==========================================================================
  describe("4. Token Storage, Bearer Validation & Revocation", () => {
    let validToken: string;
    let deviceId: string;
    let profileId: string;

    beforeEach(async () => {
      const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
        masterPassword: "MasterPassword123!",
        createSession: true,
      });
      profileId = setupRes.body.profileId;

      const devRes = await harness.post<{
        ok: boolean;
        deviceToken: string;
        deviceId: string;
      }>("/api/auth/device-login", {
        password: "MasterPassword123!",
        profileId,
        deviceName: "Test Mobile Device",
      });
      validToken = devRes.body.deviceToken;
      deviceId = devRes.body.deviceId;
    });

    it("4.1 rejects requests with missing Authorization header (401)", async () => {
      const res = await harness.get("/api/devices");
      expect(res.status).toBe(401);
      expect(res.body.message).toContain("Missing or invalid Authorization header");
    });

    it("4.2 rejects requests with malformed Authorization header prefix (401)", async () => {
      const resBasic = await harness.get("/api/devices", {
        Authorization: `Basic ${validToken}`,
      });
      expect(resBasic.status).toBe(401);

      const resNoBearer = await harness.get("/api/devices", {
        Authorization: validToken,
      });
      expect(resNoBearer.status).toBe(401);
    });

    it("4.3 rejects requests with empty Bearer token (401)", async () => {
      const resEmpty = await harness.get("/api/devices", {
        Authorization: "Bearer",
      });
      expect(resEmpty.status).toBe(401);
      expect(resEmpty.body.error).toBe("Unauthorized");

      const resWhitespace = await harness.get("/api/devices", {
        Authorization: "Bearer    ",
      });
      expect(resWhitespace.status).toBe(401);
      expect(resWhitespace.body.error).toBe("Unauthorized");
    });

    it("4.4 rejects requests with invalid or non-existent token (401)", async () => {
      const res = await harness.get("/api/devices", {
        Authorization: "Bearer kuro_dev_fake_token_random_garbage",
      });
      expect(res.status).toBe(401);
      expect(res.body.message).toContain("Invalid or revoked token");
    });

    it("4.5 revoked device token returns 401 immediately on subsequent requests", async () => {
      // 1. Verify token works initially
      harness.setBearerToken(validToken);
      const initialRes = await harness.get("/api/devices");
      expect(initialRes.status).toBe(200);

      // 2. Revoke the device
      const revokeRes = await harness.delete(`/api/devices/${deviceId}`);
      expect(revokeRes.status).toBe(200);

      // 3. Subsequent request with the same revoked token must immediately return 401
      const blockedRes = await harness.get("/api/devices");
      expect(blockedRes.status).toBe(401);
      expect(blockedRes.body.message).toContain("Invalid or revoked token");
    });
  });

  // ==========================================================================
  // 5. In-Memory Rate Limiting Boundaries
  // ==========================================================================
  describe("5. In-Memory Rate Limiting Boundaries", () => {
    it("5.1 returns 429 Too Many Requests when login limit (5 req/min) is exceeded", async () => {
      await harness.post("/api/setup", { masterPassword: "MasterPassword123!" });

      // First 5 attempts should return 401 (invalid password) without 429
      for (let i = 0; i < 5; i++) {
        const res = await harness.post("/api/auth/login", { password: "WrongPassword" });
        expect(res.status).toBe(401);
      }

      // 6th attempt from the same IP must be blocked by rate limiter
      const blockedRes = await harness.post("/api/auth/login", { password: "WrongPassword" });
      expect(blockedRes.status).toBe(429);
      expect(blockedRes.body.error).toBe("Too Many Requests");
      expect(blockedRes.headers.get("Retry-After")).toBeDefined();
    });

    it("5.2 rate limiting is isolated by endpoint prefix", async () => {
      await harness.post("/api/setup", { masterPassword: "MasterPassword123!" });

      // Exhaust login attempts
      for (let i = 0; i < 5; i++) {
        await harness.post("/api/auth/login", { password: "WrongPassword" });
      }
      const loginBlocked = await harness.post("/api/auth/login", { password: "WrongPassword" });
      expect(loginBlocked.status).toBe(429);

      // Different endpoint prefix (pair/start) should not be blocked by auth/login limit
      const pairRes = await harness.post<{ code: string }>("/api/pair/start", {
        deviceName: "Living Room TV",
      });
      expect(pairRes.status).toBe(201);
    });

    it("5.3 resetRateLimits clears tracked IP counters", async () => {
      await harness.post("/api/setup", { masterPassword: "MasterPassword123!" });

      for (let i = 0; i < 5; i++) {
        await harness.post("/api/auth/login", { password: "WrongPassword" });
      }
      expect((await harness.post("/api/auth/login", { password: "WrongPassword" })).status).toBe(429);

      // Reset limits
      resetRateLimits();

      // Next attempt must pass through limiter
      const resAfterReset = await harness.post("/api/auth/login", { password: "WrongPassword" });
      expect(resAfterReset.status).toBe(401);
    });
  });
});
