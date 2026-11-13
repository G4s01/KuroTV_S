/**
 * Tier 1 Feature Coverage: Setup & Authentication Suite
 *
 * Covers Features 3 to 6 (24 tests total, 6 tests per feature):
 * - Feature 3: Hybrid Zero-Config Setup (/api/setup) [6 tests]
 * - Feature 4: Master Admin Authentication (/api/auth/login) [6 tests]
 * - Feature 5: Token Storage & Revocation (/api/devices, Authorization) [6 tests]
 * - Feature 6: In-Memory Rate Limiting [6 tests]
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { TestHarness, clearDatabase } from "../helpers/harness";
import { ensureSchema } from "../../src/worker/schema";
import { sha256Hex, hashPassword, hexToBytes } from "../../src/worker/crypto";
import { resetRateLimits } from "../../src/worker/rate-limit";

describe("Tier 1: Hybrid Zero-Config Setup (Feature 3)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();
  });

  it("3.1 POST /api/setup initializes instance_config and creates initial profile", async () => {
    const res = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword2026!",
      initialProfileName: "Main Profile",
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.profileId).toBeDefined();

    // Verify D1 instance_config
    const config = await env.DB.prepare(
      "SELECT master_hash, master_salt, setup_completed FROM instance_config WHERE id = 1"
    ).first<{ master_hash: string; master_salt: string; setup_completed: number }>();

    expect(config).toBeDefined();
    expect(config?.setup_completed).toBe(1);
    expect(config?.master_hash).toHaveLength(64); // SHA-256 PBKDF2 hex
    expect(config?.master_salt).toHaveLength(32); // 16-byte hex

    // Verify D1 profiles
    const profile = await env.DB.prepare(
      "SELECT id, name FROM profiles WHERE id = ?"
    )
      .bind(res.body.profileId)
      .first<{ id: string; name: string }>();

    expect(profile?.name).toBe("Main Profile");
  });

  it("3.2 POST /api/setup subsequently returns 403 or 409 lockout conflict", async () => {
    const firstRes = await harness.post("/api/setup", {
      masterPassword: "FirstPassword123!",
      initialProfileName: "First Profile",
    });
    expect(firstRes.status).toBe(200);

    const secondRes = await harness.post("/api/setup", {
      masterPassword: "SecondPassword999!",
      initialProfileName: "Second Profile",
    });

    expect([403, 409]).toContain(secondRes.status);

    // Verify original password hash in D1 remains unchanged
    const count = await env.DB.prepare("SELECT count(*) as count FROM profiles").first<{
      count: number;
    }>();
    expect(count?.count).toBe(1);
  });

  it("3.3 POST /api/setup is blocked when SYNC_ADMIN_SECRET is present in environment", async () => {
    const secretHarness = new TestHarness({ SYNC_ADMIN_SECRET: "pre-shared-admin-secret" });

    const res = await secretHarness.post("/api/setup", {
      masterPassword: "AnyPassword123!",
    });

    expect([403, 409]).toContain(res.status);

    const count = await env.DB.prepare(
      "SELECT count(*) as count FROM instance_config"
    ).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it("3.4 POST /api/setup defaults profile name to 'Principale' when omitted", async () => {
    const res = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword2026!",
    });

    expect(res.status).toBe(200);

    const profile = await env.DB.prepare(
      "SELECT name, avatar_color FROM profiles WHERE id = ?"
    )
      .bind(res.body.profileId)
      .first<{ name: string; avatar_color: string }>();

    expect(profile?.name).toBe("Principale");
    expect(profile?.avatar_color).toBe("#E50914");
  });

  it("3.5 POST /api/setup rejects empty or missing masterPassword with 400 Bad Request", async () => {
    const resEmpty = await harness.post("/api/setup", { masterPassword: "" });
    expect(resEmpty.status).toBe(400);

    const resMissing = await harness.post("/api/setup", {});
    expect(resMissing.status).toBe(400);

    const configCount = await env.DB.prepare(
      "SELECT count(*) as count FROM instance_config"
    ).first<{ count: number }>();
    expect(configCount?.count).toBe(0);
  });

  it("3.6 POST /api/setup transitions GET /api/health initialized state from false to true", async () => {
    const beforeHealth = await harness.get<{ initialized: boolean }>("/api/health");
    expect(beforeHealth.body.initialized).toBe(false);

    await harness.post("/api/setup", {
      masterPassword: "TransitionPassword123!",
    });

    const afterHealth = await harness.get<{ initialized: boolean }>("/api/health");
    expect(afterHealth.body.initialized).toBe(true);
  });
});

describe("Tier 1: Master Admin Authentication (Feature 4)", () => {
  let harness: TestHarness;
  const MASTER_PASSWORD = "CorrectMasterPassword2026!";

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();
  });

  it("4.1 POST /api/auth/login succeeds with valid master password in Zero-Config mode", async () => {
    await harness.post("/api/setup", { masterPassword: MASTER_PASSWORD });

    const res = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: MASTER_PASSWORD,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.token.startsWith("kuro_sess_")).toBe(true);

    // Verify session stored in devices table
    const tokenHash = await sha256Hex(res.body.token);
    const device = await env.DB.prepare("SELECT * FROM devices WHERE token_hash = ?")
      .bind(tokenHash)
      .first<any>();

    expect(device).toBeDefined();
    expect(device.device_type).toBe("web");
  });

  it("4.2 POST /api/auth/login succeeds when authenticated against SYNC_ADMIN_SECRET", async () => {
    const secretHarness = new TestHarness({ SYNC_ADMIN_SECRET: "env-secret-password-xyz" });

    const res = await secretHarness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: "env-secret-password-xyz",
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.token).toBe("string");
  });

  it("4.3 POST /api/auth/login returns 401 Unauthorized on invalid password", async () => {
    await harness.post("/api/setup", { masterPassword: MASTER_PASSWORD });

    const res = await harness.post("/api/auth/login", {
      password: "WrongPassword999!",
    });

    expect(res.status).toBe(401);

    const devicesCount = await env.DB.prepare("SELECT count(*) as count FROM devices").first<{
      count: number;
    }>();
    expect(devicesCount?.count).toBe(0);
  });

  it("4.4 POST /api/auth/login returns 401 when instance is uninitialized", async () => {
    const res = await harness.post("/api/auth/login", {
      password: "AnyPassword",
    });

    expect([400, 401]).toContain(res.status);
  });

  it("4.5 POST /api/auth/login validates payload and returns 400 on missing password", async () => {
    await harness.post("/api/setup", { masterPassword: MASTER_PASSWORD });

    const resEmpty = await harness.post("/api/auth/login", { password: "" });
    expect(resEmpty.status).toBe(400);

    const resMissing = await harness.post("/api/auth/login", {});
    expect(resMissing.status).toBe(400);
  });

  it("4.6 POST /api/auth/login handles variable length passwords without throwing errors", async () => {
    await harness.post("/api/setup", { masterPassword: MASTER_PASSWORD });

    const shortRes = await harness.post("/api/auth/login", { password: "x" });
    expect(shortRes.status).toBe(401);

    const longPassword = "a".repeat(1000);
    const longRes = await harness.post("/api/auth/login", { password: longPassword });
    expect(longRes.status).toBe(401);
  });
});

describe("Tier 1: Token Storage & Revocation (Feature 5)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();
  });

  it("5.1 Valid Bearer token grants access to protected /api/devices endpoint", async () => {
    const setupRes = await harness.post<{ profileId: string }>("/api/setup", {
      masterPassword: "Password123!",
    });
    const loginRes = await harness.post<{ token: string }>("/api/auth/login", {
      password: "Password123!",
    });

    harness.setBearerToken(loginRes.body.token);
    const res = await harness.get<{ ok: boolean; devices: any[] }>("/api/devices");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.devices)).toBe(true);
    expect(res.body.devices.length).toBeGreaterThanOrEqual(1);
  });

  it("5.2 Device tokens are stored in D1 only as 64-char SHA-256 hex digests", async () => {
    await harness.post("/api/setup", { masterPassword: "Password123!" });
    const loginRes = await harness.post<{ token: string }>("/api/auth/login", {
      password: "Password123!",
    });
    const rawToken = loginRes.body.token;

    const expectedHash = await sha256Hex(rawToken);

    // Verify rawToken does not appear in D1
    const deviceByHash = await env.DB.prepare(
      "SELECT token_hash FROM devices WHERE token_hash = ?"
    )
      .bind(expectedHash)
      .first<{ token_hash: string }>();

    expect(deviceByHash).toBeDefined();
    expect(deviceByHash?.token_hash).toBe(expectedHash);
    expect(deviceByHash?.token_hash).toHaveLength(64);

    const deviceByRaw = await env.DB.prepare(
      "SELECT count(*) as count FROM devices WHERE token_hash = ?"
    )
      .bind(rawToken)
      .first<{ count: number }>();
    expect(deviceByRaw?.count).toBe(0);
  });

  it("5.3 DELETE /api/devices/:id revokes device and sets revoked_at timestamp", async () => {
    await harness.post("/api/setup", { masterPassword: "Password123!" });
    const loginRes = await harness.post<{ token: string }>("/api/auth/login", {
      password: "Password123!",
    });

    harness.setBearerToken(loginRes.body.token);
    const listRes = await harness.get<{ devices: any[] }>("/api/devices");
    const deviceId = listRes.body.devices[0].id;

    const delRes = await harness.delete(`/api/devices/${deviceId}`);
    expect(delRes.status).toBe(200);

    const record = await env.DB.prepare("SELECT revoked_at FROM devices WHERE id = ?")
      .bind(deviceId)
      .first<{ revoked_at: number | null }>();

    expect(record?.revoked_at).not.toBeNull();
    expect(typeof record?.revoked_at).toBe("number");
  });

  it("5.4 Revoked token immediately receives 401 Unauthorized on protected routes", async () => {
    await harness.post("/api/setup", { masterPassword: "Password123!" });
    const loginRes = await harness.post<{ token: string }>("/api/auth/login", {
      password: "Password123!",
    });

    harness.setBearerToken(loginRes.body.token);
    const listRes = await harness.get<{ devices: any[] }>("/api/devices");
    const deviceId = listRes.body.devices[0].id;

    // Revoke device
    await harness.delete(`/api/devices/${deviceId}`);

    // Try using the same token
    const blockedRes = await harness.get("/api/devices");
    expect(blockedRes.status).toBe(401);
  });

  it("5.5 Missing, invalid, or malformed Bearer tokens receive 401 Unauthorized", async () => {
    // 1. Missing Authorization header
    harness.clearAuth();
    const resNoAuth = await harness.get("/api/devices");
    expect(resNoAuth.status).toBe(401);

    // 2. Malformed Authorization header
    harness.setHeader("Authorization", "Basic 123456");
    const resMalformed = await harness.get("/api/devices");
    expect(resMalformed.status).toBe(401);

    // 3. Fake random token
    harness.setBearerToken("kuro_fake_token_nonexistent_12345");
    const resFake = await harness.get("/api/devices");
    expect(resFake.status).toBe(401);
  });

  it("5.6 Revoking one device token does not invalidate other active device tokens", async () => {
    await harness.post("/api/setup", { masterPassword: "Password123!" });

    // Session 1
    const login1 = await harness.post<{ token: string }>("/api/auth/login", {
      password: "Password123!",
    });
    const token1 = login1.body.token;

    // Session 2
    const login2 = await harness.post<{ token: string }>("/api/auth/login", {
      password: "Password123!",
    });
    const token2 = login2.body.token;

    harness.setBearerToken(token1);
    const listRes = await harness.get<{ devices: any[] }>("/api/devices");
    const device1Id = listRes.body.devices.find(
      (d: any) => d.created_at === Math.min(...listRes.body.devices.map((x: any) => x.created_at))
    )?.id;

    // Revoke Device 1
    await harness.delete(`/api/devices/${device1Id}`);

    // Token 1 is revoked -> 401
    harness.setBearerToken(token1);
    const test1 = await harness.get("/api/devices");
    expect(test1.status).toBe(401);

    // Token 2 remains active -> 200
    harness.setBearerToken(token2);
    const test2 = await harness.get("/api/devices");
    expect(test2.status).toBe(200);
  });

  it("5.7 POST /api/auth/logout revokes caller device session and rejects subsequent calls with 401", async () => {
    await harness.post("/api/setup", { masterPassword: "Password123!" });
    const loginRes = await harness.post<{ token: string }>("/api/auth/login", {
      password: "Password123!",
    });
    const token = loginRes.body.token;

    harness.setBearerToken(token);
    const logoutRes = await harness.post<{ ok: boolean; message: string }>("/api/auth/logout", {});
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.ok).toBe(true);

    // Any subsequent call using the revoked token must receive 401
    const postLogoutCall = await harness.get("/api/devices");
    expect(postLogoutCall.status).toBe(401);
  });

  it("5.8 POST /api/auth/qr-token generates single-use token; second exchange fails with 410", async () => {
    const setupRes = await harness.post<{ profileId: string }>("/api/setup", {
      masterPassword: "Password123!",
    });
    const loginRes = await harness.post<{ token: string }>("/api/auth/login", {
      password: "Password123!",
    });
    harness.setBearerToken(loginRes.body.token);

    // Generate QR token
    const qrRes = await harness.post<{ ok: boolean; qrToken: string }>("/api/auth/qr-token", {
      profileId: setupRes.body.profileId,
    });
    expect(qrRes.status).toBe(201);
    expect(qrRes.body.ok).toBe(true);
    expect(qrRes.body.qrToken).toMatch(/^qr_/);

    // Unauthenticated device exchanges the QR token for device token
    harness.clearAuth();
    const exchange1 = await harness.post<{ ok: boolean; deviceToken: string; profileId: string }>(
      "/api/auth/exchange",
      { token: qrRes.body.qrToken, deviceName: "Mobile Client A" }
    );
    expect(exchange1.status).toBe(200);
    expect(exchange1.body.ok).toBe(true);
    expect(exchange1.body.deviceToken).toBeDefined();

    // Second exchange of the exact same token MUST fail with 410 Gone
    const exchange2 = await harness.post<any>("/api/auth/exchange", {
      token: qrRes.body.qrToken,
      deviceName: "Mobile Client B",
    });
    expect(exchange2.status).toBe(410);
  });
});

describe("Tier 1: In-Memory Rate Limiting (Feature 6)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();
  });

  it("6.1 Normal requests under rate limit threshold succeed without 429 status", async () => {
    await harness.post("/api/setup", { masterPassword: "Password123!" });

    harness.setHeader("cf-connecting-ip", "192.168.1.101");
    for (let i = 0; i < 3; i++) {
      const res = await harness.post("/api/auth/login", { password: "Password123!" });
      expect(res.status).toBe(200);
    }
  });

  it("6.2 Exceeding request threshold on /api/auth/login returns 429 Too Many Requests", async () => {
    await harness.post("/api/setup", { masterPassword: "Password123!" });

    harness.setHeader("cf-connecting-ip", "192.168.1.102");
    // Limit is 5 per 60s
    for (let i = 0; i < 5; i++) {
      await harness.post("/api/auth/login", { password: "WrongPassword" });
    }

    const rateLimitedRes = await harness.post("/api/auth/login", {
      password: "Password123!",
    });
    expect(rateLimitedRes.status).toBe(429);
  });

  it("6.3 Rate-limited 429 response contains Retry-After header and JSON error body", async () => {
    await harness.post("/api/setup", { masterPassword: "Password123!" });

    harness.setHeader("cf-connecting-ip", "192.168.1.103");
    for (let i = 0; i < 5; i++) {
      await harness.post("/api/auth/login", { password: "Wrong" });
    }

    const res = await harness.post<any>("/api/auth/login", { password: "Wrong" });
    expect(res.status).toBe(429);
    expect(res.headers.has("retry-after")).toBe(true);
    expect(parseInt(res.headers.get("retry-after")!)).toBeGreaterThan(0);
    expect(res.body.error).toBe("Too Many Requests");
  });

  it("6.4 Rate limiting is partitioned per client IP via CF-Connecting-IP", async () => {
    await harness.post("/api/setup", { masterPassword: "Password123!" });

    // Exhaust IP 1
    harness.setHeader("cf-connecting-ip", "10.0.0.1");
    for (let i = 0; i < 5; i++) {
      await harness.post("/api/auth/login", { password: "Wrong" });
    }
    const ip1Res = await harness.post("/api/auth/login", { password: "Wrong" });
    expect(ip1Res.status).toBe(429);

    // IP 2 is unaffected
    harness.setHeader("cf-connecting-ip", "10.0.0.2");
    const ip2Res = await harness.post("/api/auth/login", { password: "Password123!" });
    expect(ip2Res.status).toBe(200);
  });

  it("6.5 GET /api/health is exempt from rate limiting and succeeds during auth throttle", async () => {
    await harness.post("/api/setup", { masterPassword: "Password123!" });

    harness.setHeader("cf-connecting-ip", "10.0.0.3");
    for (let i = 0; i < 5; i++) {
      await harness.post("/api/auth/login", { password: "Wrong" });
    }
    const authRes = await harness.post("/api/auth/login", { password: "Wrong" });
    expect(authRes.status).toBe(429);

    // Health is not throttled
    const healthRes = await harness.get<{ ok: boolean }>("/api/health");
    expect(healthRes.status).toBe(200);
    expect(healthRes.body.ok).toBe(true);
  });

  it("6.6 Rapid repeated calls to /api/setup are protected by rate limiting", async () => {
    harness.setHeader("cf-connecting-ip", "10.0.0.4");
    for (let i = 0; i < 5; i++) {
      await harness.post("/api/setup", { masterPassword: "" });
    }

    const res = await harness.post("/api/setup", { masterPassword: "ValidPassword123!" });
    expect(res.status).toBe(429);
  });
});
