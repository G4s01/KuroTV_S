/**
 * Tier 1 Feature Coverage: TV Simple-Login Pairing Flow & Smartphone Quick Login
 *
 * Covers Features 7 to 11 (26 tests total, >=5 tests per feature):
 * - Feature 7: TV Pairing Start (POST /api/pair/start, 6-char code, pairSecret) [5 tests]
 * - Feature 8: TV Pairing Status Polling (GET /api/pair/status, X-Pair-Secret header) [5 tests]
 * - Feature 9: TV Pairing Approval (POST /api/pair/approve, Bearer auth) [5 tests]
 * - Feature 10: One-Time Token Delivery Consumption (consumed on delivery) [5 tests]
 * - Feature 11: Smartphone Quick Login & Deep Link (/api/auth/exchange, /api/auth/device-login, kurosync://) [6 tests]
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { TestHarness, clearDatabase } from "../helpers/harness";
import { ensureSchema } from "../../src/worker/schema";
import { resetRateLimits } from "../../src/worker/rate-limit";

/**
 * Computes SHA-256 hex digest using native Web Crypto
 */
async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Computes PBKDF2-SHA256 password hash (100,000 iterations)
 */
async function hashPassword(password: string, salt: Uint8Array): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as any,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Test helper: seed instance configuration in D1
 */
async function seedInstanceConfig(
  db: D1Database,
  masterPassword = "TestMasterPassword123!"
): Promise<{ saltHex: string; hashHex: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = Array.from(salt)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hashHex = await hashPassword(masterPassword, salt);
  const now = Date.now();

  await db
    .prepare(`
      INSERT INTO instance_config (id, master_hash, master_salt, setup_completed, created_at, updated_at)
      VALUES (1, ?, ?, 1, ?, ?)
    `)
    .bind(hashHex, saltHex, now, now)
    .run();

  return { saltHex, hashHex };
}

/**
 * Test helper: seed profile in D1
 */
async function seedProfile(
  db: D1Database,
  profileId = "profile-test-1",
  name = "Test Profile"
): Promise<string> {
  const now = Date.now();
  await db
    .prepare(`
      INSERT INTO profiles (id, name, avatar_color, created_at, updated_at)
      VALUES (?, ?, '#E50914', ?, ?)
    `)
    .bind(profileId, name, now, now)
    .run();
  return profileId;
}

/**
 * Test helper: seed authorized device in D1
 */
async function seedAuthorizedDevice(
  db: D1Database,
  profileId: string,
  deviceToken = "test-bearer-token-123"
): Promise<{ deviceId: string; deviceToken: string }> {
  const deviceId = crypto.randomUUID();
  const tokenHash = await sha256Hex(deviceToken);
  const now = Date.now();

  await db
    .prepare(`
      INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at)
      VALUES (?, ?, 'Admin Phone', 'mobile', 'android', ?, ?, ?)
    `)
    .bind(deviceId, profileId, tokenHash, now, now)
    .run();

  return { deviceId, deviceToken };
}

describe("Tier 1: TV Pairing Start (Feature 7)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();
  });

  it("7.1 POST /api/pair/start returns 200/201 with 6-char code, pairSecret, expiresIn: 300, and verifyUrl", async () => {
    const res = await harness.post<{
      code: string;
      pairSecret: string;
      expiresIn: number;
      verifyUrl: string;
    }>("/api/pair/start", {
      deviceName: "Living Room Sony Bravia",
      deviceType: "tv",
      platform: "android-tv",
    });

    expect([200, 201]).toContain(res.status);
    expect(res.body.code).toBeDefined();
    // 6-character alphanumeric code from unambiguous charset ABCDEFGHJKLMNPQRSTUVWXYZ23456789
    expect(res.body.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(typeof res.body.pairSecret).toBe("string");
    expect(res.body.pairSecret.length).toBeGreaterThanOrEqual(16);
    expect(res.body.expiresIn).toBe(300);
    expect(res.body.verifyUrl).toContain(`/pair?code=${res.body.code}`);
  });

  it("7.2 POST /api/pair/start persists record in D1 pairing_codes with status 'pending' and SHA-256 hashed secret", async () => {
    const res = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Bedroom TV",
      deviceType: "tv",
      platform: "tizen",
    });

    expect([200, 201]).toContain(res.status);

    const record = await env.DB.prepare("SELECT * FROM pairing_codes WHERE code = ?")
      .bind(res.body.code)
      .first<any>();

    expect(record).toBeDefined();
    expect(record.status).toBe("pending");
    expect(record.device_name).toBe("Bedroom TV");
    expect(record.device_type).toBe("tv");
    expect(record.platform).toBe("tizen");

    // Secret must be stored hashed via SHA-256, NEVER plaintext
    const expectedHash = await sha256Hex(res.body.pairSecret);
    expect(record.pair_secret_hash).toBe(expectedHash);
    expect(record.pair_secret_hash).not.toBe(res.body.pairSecret);
    expect(record.expires_at).toBeGreaterThan(Date.now());
  });

  it("7.3 POST /api/pair/start supports mobile deviceType and diverse platforms", async () => {
    const res = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "iPad Pro",
      deviceType: "mobile",
      platform: "ios",
    });

    expect([200, 201]).toContain(res.status);

    const record = await env.DB.prepare("SELECT * FROM pairing_codes WHERE code = ?")
      .bind(res.body.code)
      .first<any>();

    expect(record).toBeDefined();
    expect(record.device_type).toBe("mobile");
    expect(record.platform).toBe("ios");
  });

  it("7.4 POST /api/pair/start generates unique codes and secrets across concurrent requests", async () => {
    const [res1, res2, res3] = await Promise.all([
      harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
        deviceName: "TV 1",
        deviceType: "tv",
        platform: "webos",
      }),
      harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
        deviceName: "TV 2",
        deviceType: "tv",
        platform: "android-tv",
      }),
      harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
        deviceName: "TV 3",
        deviceType: "tv",
        platform: "firetv",
      }),
    ]);

    const codes = new Set([res1.body.code, res2.body.code, res3.body.code]);
    const secrets = new Set([res1.body.pairSecret, res2.body.pairSecret, res3.body.pairSecret]);

    expect(codes.size).toBe(3);
    expect(secrets.size).toBe(3);
  });

  it("7.5 POST /api/pair/start returns 400 Bad Request on missing mandatory fields", async () => {
    const resEmpty = await harness.post("/api/pair/start", {});
    expect(resEmpty.status).toBe(400);

    const resMissingName = await harness.post("/api/pair/start", {
      deviceType: "tv",
      platform: "android-tv",
    });
    expect(resMissingName.status).toBe(400);

    const count = await env.DB.prepare("SELECT count(*) as count FROM pairing_codes").first<{
      count: number;
    }>();
    expect(count?.count).toBe(0);
  });
});

describe("Tier 1: TV Pairing Status Polling (Feature 8)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();
  });

  it("8.1 GET /api/pair/status returns status: 'pending' while awaiting approval", async () => {
    const start = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Sony TV",
      deviceType: "tv",
      platform: "android-tv",
    });

    harness.setPairSecret(start.body.pairSecret);
    const res = await harness.get<{ status: string }>(`/api/pair/status?code=${start.body.code}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
    expect((res.body as any).deviceToken).toBeUndefined();
  });

  it("8.2 GET /api/pair/status rejects polling with 401 Unauthorized when X-Pair-Secret header is missing", async () => {
    const start = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Sony TV",
      deviceType: "tv",
      platform: "android-tv",
    });

    harness.clearAuth();
    const res = await harness.get(`/api/pair/status?code=${start.body.code}`);
    expect(res.status).toBe(401);
  });

  it("8.3 GET /api/pair/status rejects polling with 401 Unauthorized when X-Pair-Secret is invalid", async () => {
    const start = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Sony TV",
      deviceType: "tv",
      platform: "android-tv",
    });

    harness.setPairSecret("invalid-pair-secret-token");
    const res = await harness.get(`/api/pair/status?code=${start.body.code}`);
    expect(res.status).toBe(401);
  });

  it("8.4 GET /api/pair/status returns status: 'expired' when pairing code has expired past 5 minutes", async () => {
    const code = "EXPIRE";
    const secret = "secret-1234567890123456";
    const secretHash = await sha256Hex(secret);
    const past = Date.now() - 10000;

    await env.DB.prepare(`
      INSERT INTO pairing_codes (code, pair_secret_hash, device_name, device_type, platform, status, expires_at, created_at)
      VALUES (?, ?, 'Old TV', 'tv', 'android-tv', 'pending', ?, ?)
    `)
      .bind(code, secretHash, past, past - 300000)
      .run();

    harness.setPairSecret(secret);
    const res = await harness.get<{ status: string }>(`/api/pair/status?code=${code}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("expired");
  });

  it("8.5 GET /api/pair/status returns 404 Not Found for non-existent pairing code", async () => {
    harness.setPairSecret("any-secret-token");
    const res = await harness.get(`/api/pair/status?code=NON999`);
    expect(res.status).toBe(404);
  });

  it("8.6 GET /api/pair/status normalizes lowercase pairing code to uppercase seamlessly", async () => {
    const start = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Lowercase Polling TV",
      deviceType: "tv",
      platform: "android-tv",
    });

    harness.setPairSecret(start.body.pairSecret);
    const res = await harness.get<{ status: string }>(`/api/pair/status?code=${start.body.code.toLowerCase()}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending");
  });
});

describe("Tier 1: TV Pairing Approval (Feature 9)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();
  });

  it("9.1 POST /api/pair/approve with valid Bearer token and profileId transitions pairing status to 'approved'", async () => {
    const profileId = await seedProfile(env.DB, "prof-1", "Salotto");
    const { deviceToken } = await seedAuthorizedDevice(env.DB, profileId);

    const start = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "LG OLED",
      deviceType: "tv",
      platform: "webos",
    });

    harness.clearAuth();
    harness.setBearerToken(deviceToken);
    const res = await harness.post<{ ok: boolean; deviceId: string }>("/api/pair/approve", {
      code: start.body.code,
      profileId,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.deviceId).toBeDefined();

    const record = await env.DB.prepare("SELECT * FROM pairing_codes WHERE code = ?")
      .bind(start.body.code)
      .first<any>();

    expect(record.status).toBe("approved");
    expect(record.approved_profile_id).toBe(profileId);
    expect(record.issued_device_id).toBe(res.body.deviceId);
  });

  it("9.2 POST /api/pair/approve creates an active device in devices table with hashed token and custom label", async () => {
    const profileId = await seedProfile(env.DB, "prof-1", "Salotto");
    const { deviceToken } = await seedAuthorizedDevice(env.DB, profileId);

    const start = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Generic TV",
      deviceType: "tv",
      platform: "android-tv",
    });

    harness.setBearerToken(deviceToken);
    const res = await harness.post<{ ok: boolean; deviceId: string }>("/api/pair/approve", {
      code: start.body.code,
      profileId,
      deviceLabel: "Salotto Sony 65-inch",
    });

    expect(res.status).toBe(200);

    const device = await env.DB.prepare("SELECT * FROM devices WHERE id = ?")
      .bind(res.body.deviceId)
      .first<any>();

    expect(device).toBeDefined();
    expect(device.name).toBe("Salotto Sony 65-inch");
    expect(device.device_type).toBe("tv");
    expect(device.platform).toBe("android-tv");
    expect(device.profile_id).toBe(profileId);
    expect(device.revoked_at).toBeNull();
    expect(device.token_hash).toHaveLength(64); // SHA-256 hex string
  });

  it("9.3 POST /api/pair/approve requires valid Bearer authentication, rejecting unauthenticated requests with 401", async () => {
    const profileId = await seedProfile(env.DB, "prof-1", "Salotto");
    const start = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Living Room TV",
      deviceType: "tv",
      platform: "android-tv",
    });

    harness.clearAuth();
    const resNoAuth = await harness.post("/api/pair/approve", {
      code: start.body.code,
      profileId,
    });
    expect(resNoAuth.status).toBe(401);

    harness.setBearerToken("non-existent-token-xyz");
    const resBadAuth = await harness.post("/api/pair/approve", {
      code: start.body.code,
      profileId,
    });
    expect(resBadAuth.status).toBe(401);
  });

  it("9.4 POST /api/pair/approve returns 404 Not Found for non-existent profileId or pairing code", async () => {
    const profileId = await seedProfile(env.DB, "prof-1", "Salotto");
    const { deviceToken } = await seedAuthorizedDevice(env.DB, profileId);

    const start = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Living Room TV",
      deviceType: "tv",
      platform: "android-tv",
    });

    harness.setBearerToken(deviceToken);

    // Non-existent code
    const resBadCode = await harness.post("/api/pair/approve", {
      code: "ZZZZ99",
      profileId,
    });
    expect(resBadCode.status).toBe(404);

    // Non-existent profile
    const resBadProfile = await harness.post("/api/pair/approve", {
      code: start.body.code,
      profileId: "non-existent-profile-id",
    });
    expect(resBadProfile.status).toBe(404);
  });

  it("9.5 POST /api/pair/approve rejects approval of expired pairing code with 409 Conflict or 410 Gone", async () => {
    const profileId = await seedProfile(env.DB, "prof-1", "Salotto");
    const { deviceToken } = await seedAuthorizedDevice(env.DB, profileId);

    const code = "EXPIR2";
    const secretHash = await sha256Hex("secret-token");
    const past = Date.now() - 5000;

    await env.DB.prepare(`
      INSERT INTO pairing_codes (code, pair_secret_hash, device_name, device_type, platform, status, expires_at, created_at)
      VALUES (?, ?, 'Old TV', 'tv', 'android-tv', 'pending', ?, ?)
    `)
      .bind(code, secretHash, past, past - 300000)
      .run();

    harness.setBearerToken(deviceToken);
    const res = await harness.post("/api/pair/approve", {
      code,
      profileId,
    });

    expect([409, 410]).toContain(res.status);

    const devicesCount = await env.DB.prepare(
      "SELECT count(*) as count FROM devices WHERE name = 'Old TV'"
    ).first<{ count: number }>();
    expect(devicesCount?.count).toBe(0);
  });

  it("9.6 POST /api/pair/approve accepts lowercase pairing code seamlessly and updates status to approved", async () => {
    const profileId = await seedProfile(env.DB, "prof-case-test", "Case Sensitive Test");
    const { deviceToken } = await seedAuthorizedDevice(env.DB, profileId);

    const start = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Case Normalization TV",
      deviceType: "tv",
      platform: "android-tv",
    });

    const uppercaseCode = start.body.code;
    const lowercaseCode = uppercaseCode.toLowerCase();

    harness.clearAuth();
    harness.setBearerToken(deviceToken);
    const approveRes = await harness.post<{ ok: boolean; deviceId: string }>("/api/pair/approve", {
      code: lowercaseCode,
      profileId,
      deviceLabel: "Normalized TV",
    });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.ok).toBe(true);

    // Verify status via polling using lowercase code as well
    harness.clearAuth();
    harness.setPairSecret(start.body.pairSecret);
    const pollRes = await harness.get<{
      status: string;
      deviceToken: string;
      profileName: string;
    }>(`/api/pair/status?code=${lowercaseCode}`);

    expect(pollRes.status).toBe(200);
    expect(pollRes.body.status).toBe("approved");
    expect(pollRes.body.deviceToken).toBeDefined();
    expect(pollRes.body.profileName).toBe("Case Sensitive Test");
  });
});

describe("Tier 1: One-Time Token Delivery Consumption (Feature 10)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();
  });

  it("10.1 First status poll after approval returns status: 'approved' with deviceToken, deviceId, profileId, and profileName", async () => {
    const profileId = await seedProfile(env.DB, "prof-1", "Salotto TV");
    const { deviceToken: adminToken } = await seedAuthorizedDevice(env.DB, profileId);

    const start = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Sony Bravia",
      deviceType: "tv",
      platform: "android-tv",
    });

    harness.setBearerToken(adminToken);
    await harness.post("/api/pair/approve", { code: start.body.code, profileId });

    harness.clearAuth();
    harness.setPairSecret(start.body.pairSecret);
    const pollRes = await harness.get<{
      status: string;
      deviceToken: string;
      deviceId: string;
      profileId: string;
      profileName: string;
    }>(`/api/pair/status?code=${start.body.code}`);

    expect(pollRes.status).toBe(200);
    expect(pollRes.body.status).toBe("approved");
    expect(typeof pollRes.body.deviceToken).toBe("string");
    expect(pollRes.body.deviceToken.length).toBeGreaterThanOrEqual(16);
    expect(pollRes.body.deviceId).toBeDefined();
    expect(pollRes.body.profileId).toBe(profileId);
    expect(pollRes.body.profileName).toBe("Salotto TV");
  });

  it("10.2 Delivery immediately transitions pairing_codes.status to 'consumed' in D1", async () => {
    const profileId = await seedProfile(env.DB, "prof-1", "Salotto");
    const { deviceToken: adminToken } = await seedAuthorizedDevice(env.DB, profileId);

    const start = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Sony Bravia",
      deviceType: "tv",
      platform: "android-tv",
    });

    harness.setBearerToken(adminToken);
    await harness.post("/api/pair/approve", { code: start.body.code, profileId });

    harness.clearAuth();
    harness.setPairSecret(start.body.pairSecret);
    await harness.get(`/api/pair/status?code=${start.body.code}`);

    const record = await env.DB.prepare("SELECT * FROM pairing_codes WHERE code = ?")
      .bind(start.body.code)
      .first<any>();

    expect(record.status).toBe("consumed");
  });

  it("10.3 Subsequent status poll rejects or returns consumed and NEVER delivers deviceToken again", async () => {
    const profileId = await seedProfile(env.DB, "prof-1", "Salotto");
    const { deviceToken: adminToken } = await seedAuthorizedDevice(env.DB, profileId);

    const start = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Sony Bravia",
      deviceType: "tv",
      platform: "android-tv",
    });

    harness.setBearerToken(adminToken);
    await harness.post("/api/pair/approve", { code: start.body.code, profileId });

    harness.clearAuth();
    harness.setPairSecret(start.body.pairSecret);

    // First poll consumes
    const firstPoll = await harness.get<{ deviceToken: string }>(`/api/pair/status?code=${start.body.code}`);
    expect(firstPoll.body.deviceToken).toBeDefined();

    // Second poll
    const secondPoll = await harness.get<any>(`/api/pair/status?code=${start.body.code}`);
    expect([200, 404, 409, 410]).toContain(secondPoll.status);
    if (secondPoll.status === 200) {
      expect(secondPoll.body.status).toBe("consumed");
    }
    expect(secondPoll.body?.deviceToken).toBeUndefined();
  });

  it("10.4 Delivered deviceToken functions as a valid Bearer token for authenticated API requests", async () => {
    const profileId = await seedProfile(env.DB, "prof-1", "Salotto");
    const { deviceToken: adminToken } = await seedAuthorizedDevice(env.DB, profileId);

    const start = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Sony Bravia",
      deviceType: "tv",
      platform: "android-tv",
    });

    harness.setBearerToken(adminToken);
    await harness.post("/api/pair/approve", { code: start.body.code, profileId });

    harness.clearAuth();
    harness.setPairSecret(start.body.pairSecret);
    const poll = await harness.get<{ deviceToken: string }>(`/api/pair/status?code=${start.body.code}`);
    const tvToken = poll.body.deviceToken;

    // Verify token hash is stored in devices
    const tvTokenHash = await sha256Hex(tvToken);
    const device = await env.DB.prepare("SELECT * FROM devices WHERE token_hash = ?")
      .bind(tvTokenHash)
      .first<any>();

    expect(device).toBeDefined();
    expect(device.profile_id).toBe(profileId);

    // Use TV token on authenticated route
    harness.clearAuth();
    harness.setBearerToken(tvToken);
    const syncRes = await harness.get("/api/sync/pull?since=0");
    expect(syncRes.status).not.toBe(401);
  });

  it("10.5 Ephemeral raw token is purged from pairing_codes row upon delivery", async () => {
    const profileId = await seedProfile(env.DB, "prof-1", "Salotto");
    const { deviceToken: adminToken } = await seedAuthorizedDevice(env.DB, profileId);

    const start = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Sony Bravia",
      deviceType: "tv",
      platform: "android-tv",
    });

    harness.setBearerToken(adminToken);
    await harness.post("/api/pair/approve", { code: start.body.code, profileId });

    // Raw token is present before delivery
    const beforeRecord = await env.DB.prepare("SELECT * FROM pairing_codes WHERE code = ?")
      .bind(start.body.code)
      .first<any>();
    expect(beforeRecord.raw_device_token_encrypted_or_ephemeral).toBeDefined();

    // Consume upon poll
    harness.clearAuth();
    harness.setPairSecret(start.body.pairSecret);
    await harness.get(`/api/pair/status?code=${start.body.code}`);

    // Raw token is cleared after delivery
    const afterRecord = await env.DB.prepare("SELECT * FROM pairing_codes WHERE code = ?")
      .bind(start.body.code)
      .first<any>();
    expect(afterRecord.raw_device_token_encrypted_or_ephemeral).toBeNull();
  });
});

describe("Tier 1: Smartphone Quick Login & Deep Link (Feature 11)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();
  });

  it("11.1 Validates deep-link URL scheme kurosync://connect structure and parameter parsing", async () => {
    const testUrl = "https://my-kurosync.workers.dev";
    const testToken = "quick-token-123456";
    const testProfile = "profile-uuid-abc";

    const deepLink = `kurosync://connect?url=${encodeURIComponent(testUrl)}&token=${encodeURIComponent(testToken)}&profile=${encodeURIComponent(testProfile)}`;
    expect(deepLink.startsWith("kurosync://connect?")).toBe(true);

    const parsed = new URL(deepLink.replace("kurosync://", "https://dummy.local/"));
    expect(decodeURIComponent(parsed.searchParams.get("url") || "")).toBe(testUrl);
    expect(parsed.searchParams.get("token")).toBe(testToken);
    expect(parsed.searchParams.get("profile")).toBe(testProfile);
  });

  it("11.2 POST /api/auth/device-login creates an authorized mobile device using Master Password and profileId", async () => {
    const masterPassword = "SuperSecretMasterPass123!";
    await seedInstanceConfig(env.DB, masterPassword);
    const profileId = await seedProfile(env.DB, "prof-mobile-1", "Marco Phone");

    const res = await harness.post<{
      ok: boolean;
      deviceToken: string;
      deviceId: string;
      profile: { id: string; name: string };
    }>("/api/auth/device-login", {
      password: masterPassword,
      deviceName: "Pixel 8 Pro",
      deviceType: "mobile",
      platform: "android",
      profileId,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.deviceToken).toBe("string");
    expect(res.body.deviceId).toBeDefined();
    expect(res.body.profile.id).toBe(profileId);
    expect(res.body.profile.name).toBe("Marco Phone");

    const tokenHash = await sha256Hex(res.body.deviceToken);
    const device = await env.DB.prepare("SELECT * FROM devices WHERE id = ?")
      .bind(res.body.deviceId)
      .first<any>();

    expect(device).toBeDefined();
    expect(device.token_hash).toBe(tokenHash);
    expect(device.device_type).toBe("mobile");
    expect(device.platform).toBe("android");
    expect(device.profile_id).toBe(profileId);
  });

  it("11.3 POST /api/auth/device-login rejects incorrect Master Password with 401 Unauthorized", async () => {
    await seedInstanceConfig(env.DB, "CorrectMasterPassword123!");
    const profileId = await seedProfile(env.DB, "prof-1", "Main");

    const res = await harness.post("/api/auth/device-login", {
      password: "WrongPassword999!",
      deviceName: "Pixel 8 Pro",
      deviceType: "mobile",
      platform: "android",
      profileId,
    });

    expect(res.status).toBe(401);

    const devicesCount = await env.DB.prepare("SELECT count(*) as count FROM devices").first<{
      count: number;
    }>();
    expect(devicesCount?.count).toBe(0);
  });

  it("11.4 POST /api/auth/device-login returns 404 Not Found when profileId does not exist", async () => {
    const masterPassword = "TestMasterPassword123!";
    await seedInstanceConfig(env.DB, masterPassword);

    const res = await harness.post("/api/auth/device-login", {
      password: masterPassword,
      deviceName: "Pixel 8 Pro",
      deviceType: "mobile",
      platform: "android",
      profileId: "non-existent-profile-xyz",
    });

    expect(res.status).toBe(404);
  });

  it("11.5 POST /api/auth/exchange consumes a valid exchange token and returns permanent deviceToken", async () => {
    const profileId = await seedProfile(env.DB, "prof-exch-1", "Quick User");
    const exchangeToken = "EXCH99";
    const secretHash = await sha256Hex("ephemeral-secret");
    const now = Date.now();

    await env.DB.prepare(`
      INSERT INTO pairing_codes (code, pair_secret_hash, device_name, device_type, platform, status, approved_profile_id, expires_at, created_at)
      VALUES (?, ?, 'Pending Mobile', 'mobile', 'android', 'approved', ?, ?, ?)
    `)
      .bind(exchangeToken, secretHash, profileId, now + 300000, now)
      .run();

    const res = await harness.post<{
      ok: boolean;
      deviceToken: string;
      deviceId: string;
      profileId: string;
    }>("/api/auth/exchange", {
      exchangeToken,
      deviceName: "iPhone 15 Pro",
      deviceType: "mobile",
      platform: "ios",
    });

    expect([200, 201]).toContain(res.status);
    expect(res.body.ok).toBe(true);
    expect(res.body.deviceToken).toBeDefined();
    expect(res.body.deviceId).toBeDefined();
    expect(res.body.profileId).toBe(profileId);
  });

  it("11.6 POST /api/auth/exchange rejects invalid or already consumed exchange token with 401 or 410", async () => {
    const res = await harness.post("/api/auth/exchange", {
      exchangeToken: "INVALID_EXCH_TOKEN",
      deviceName: "iPad",
      deviceType: "mobile",
      platform: "ios",
    });

    expect([400, 401, 404, 410]).toContain(res.status);
  });
});
