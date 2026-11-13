/**
 * Tier 1 Feature Coverage: Profile Management, Pairing Info & Maintenance Queries
 *
 * Covers:
 * - Profile Management (GET/POST/PUT/DELETE /api/profiles)
 * - Cascading deletion of viewing data upon profile deletion
 * - Multi-profile device filtering (?profileId=...)
 * - Public TV Pairing Info preview endpoint (GET /api/pair/info)
 * - 90-day tombstone auto-cleanup and 24h expired pairing code maintenance
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { TestHarness, clearDatabase } from "../helpers/harness";
import { ensureSchema } from "../../src/worker/schema";
import { resetRateLimits } from "../../src/worker/rate-limit";
import { purgeOldTombstones, purgeExpiredPairingCodes, NINETY_DAYS_MS, TWENTY_FOUR_HOURS_MS } from "../../src/worker/maintenance";

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function seedContext(
  db: D1Database,
  profileId = "profile-main-1",
  profileName = "Principale",
  token = "bearer-token-profile-test"
): Promise<{ profileId: string; token: string; deviceId: string }> {
  const now = Date.now();
  await db
    .prepare("INSERT INTO profiles (id, name, avatar_color, created_at, updated_at) VALUES (?, ?, '#E50914', ?, ?)")
    .bind(profileId, profileName, now, now)
    .run();

  const deviceId = crypto.randomUUID();
  const tokenHash = await sha256Hex(token);
  await db
    .prepare(
      "INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at) VALUES (?, ?, 'Test Device', 'web', 'web', ?, ?, ?)"
    )
    .bind(deviceId, profileId, tokenHash, now, now)
    .run();

  return { profileId, token, deviceId };
}

describe("Tier 1: Profile Management (GET/POST/PUT/DELETE /api/profiles)", () => {
  let harness: TestHarness;
  let activeToken: string;
  let defaultProfileId: string;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();

    const seeded = await seedContext(env.DB, "prof-default", "Default Profile", "token-auth-valid");
    defaultProfileId = seeded.profileId;
    activeToken = seeded.token;
    harness.setBearerToken(activeToken);
  });

  it("1.1 GET /api/profiles requires authentication and returns 401 when unauthorized", async () => {
    const unauthHarness = new TestHarness();
    const resNoAuth = await unauthHarness.get("/api/profiles");
    expect(resNoAuth.status).toBe(401);

    unauthHarness.setBearerToken("invalid-bogus-token");
    const resInvalid = await unauthHarness.get("/api/profiles");
    expect(resInvalid.status).toBe(401);
  });

  it("1.2 GET /api/profiles returns list of profiles with id, name, avatar_color, created_at, updated_at", async () => {
    const res = await harness.get<{ ok: boolean; profiles: any[] }>("/api/profiles");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(Array.isArray(res.body.profiles)).toBe(true);
    expect(res.body.profiles.length).toBe(1);

    const first = res.body.profiles[0];
    expect(first.id).toBe(defaultProfileId);
    expect(first.name).toBe("Default Profile");
    expect(first.avatar_color).toBe("#E50914");
    expect(first.avatarColor).toBe("#E50914");
    expect(typeof first.created_at).toBe("number");
    expect(typeof first.updated_at).toBe("number");
  });

  it("1.3 POST /api/profiles creates a new profile with name and avatarColor", async () => {
    const res = await harness.post<{ ok: boolean; profile: any }>("/api/profiles", {
      name: "Salotto TV",
      avatarColor: "#00E5FF",
    });

    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.profile.name).toBe("Salotto TV");
    expect(res.body.profile.avatar_color).toBe("#00E5FF");
    expect(res.body.profile.avatarColor).toBe("#00E5FF");
    expect(res.body.profile.id).toBeDefined();

    // Verify stored in D1
    const stored = await env.DB.prepare("SELECT name, avatar_color FROM profiles WHERE id = ?")
      .bind(res.body.profile.id)
      .first<{ name: string; avatar_color: string }>();

    expect(stored?.name).toBe("Salotto TV");
    expect(stored?.avatar_color).toBe("#00E5FF");
  });

  it("1.4 POST /api/profiles uses default avatarColor when not specified", async () => {
    const res = await harness.post<{ ok: boolean; profile: any }>("/api/profiles", {
      name: "Kids Room",
    });

    expect(res.status).toBe(201);
    expect(res.body.profile.avatar_color).toBe("#E50914");
  });

  it("1.5 POST /api/profiles returns 400 Bad Request when name is missing or empty", async () => {
    const resEmpty = await harness.post("/api/profiles", { name: "   " });
    expect(resEmpty.status).toBe(400);

    const resMissing = await harness.post("/api/profiles", { avatarColor: "#123456" });
    expect(resMissing.status).toBe(400);

    const resInvalidBody = await harness.request("/api/profiles", {
      method: "POST",
      body: "invalid-json-string",
      headers: { "Content-Type": "application/json" },
    });
    expect(resInvalidBody.status).toBe(400);
  });

  it("1.6 GET /api/profiles/:id returns single profile or 404 when nonexistent", async () => {
    const res = await harness.get<{ ok: boolean; profile: any }>(`/api/profiles/${defaultProfileId}`);
    expect(res.status).toBe(200);
    expect(res.body.profile.id).toBe(defaultProfileId);
    expect(res.body.profile.name).toBe("Default Profile");

    const resNotFound = await harness.get("/api/profiles/non-existent-profile-id");
    expect(resNotFound.status).toBe(404);
  });

  it("1.7 PUT /api/profiles/:id updates profile name and avatarColor", async () => {
    const createRes = await harness.post<{ profile: any }>("/api/profiles", {
      name: "Guest",
      avatarColor: "#888888",
    });
    const guestId = createRes.body.profile.id;

    const updateRes = await harness.put<{ ok: boolean; profile: any }>(`/api/profiles/${guestId}`, {
      name: "Guest Renamed",
      avatarColor: "#00FF00",
    });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.ok).toBe(true);
    expect(updateRes.body.profile.name).toBe("Guest Renamed");
    expect(updateRes.body.profile.avatar_color).toBe("#00FF00");

    // Verify D1 row
    const row = await env.DB.prepare("SELECT name, avatar_color FROM profiles WHERE id = ?")
      .bind(guestId)
      .first<{ name: string; avatar_color: string }>();
    expect(row?.name).toBe("Guest Renamed");
    expect(row?.avatar_color).toBe("#00FF00");

    // Returns 404 for nonexistent id
    const res404 = await harness.put("/api/profiles/nonexistent-id", { name: "Test" });
    expect(res404.status).toBe(404);
  });

  it("1.8 DELETE /api/profiles/:id purges profile and all associated viewing data atomically", async () => {
    const createRes = await harness.post<{ profile: any }>("/api/profiles", { name: "To Delete" });
    const targetId = createRes.body.profile.id;
    const now = Date.now();

    // Populate associated viewing data across all tables
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO favorites (profile_id, anime_id, title, thumbnail, updated_at) VALUES (?, 'anime-del-1', 'Anime Del', '', ?)"
      ).bind(targetId, now),
      env.DB.prepare(
        "INSERT INTO continue_watching (profile_id, anime_id, title, thumbnail, episode_id, episode_number, position, duration, percentage, is_caught_up, updated_at) VALUES (?, 'anime-del-1', 'Anime Del', '', 'ep1', 1, 100, 200, 50, 0, ?)"
      ).bind(targetId, now),
      env.DB.prepare(
        "INSERT INTO watch_history (profile_id, anime_id, episode_number, episode_id, title, thumbnail, position, duration, progress_percent, is_completed, updated_at) VALUES (?, 'anime-del-1', 1, 'ep1', 'Anime Del', '', 100, 200, 50, 0, ?)"
      ).bind(targetId, now),
      env.DB.prepare(
        "INSERT INTO watch_progress (profile_id, anime_id, episode_number, anime_title, thumbnail, episode_id, \"current_time\", duration, percentage, is_completed, updated_at) VALUES (?, 'anime-del-1', 1, 'Anime Del', '', 'ep1', 100, 200, 50, 0, ?)"
      ).bind(targetId, now),
      env.DB.prepare(
        "INSERT INTO shared_settings (profile_id, key, value_json, updated_at) VALUES (?, 'prefQuality', '\"1080p\"', ?)"
      ).bind(targetId, now),
      env.DB.prepare(
        "INSERT INTO tombstones (profile_id, entity_type, entity_key, deleted_at) VALUES (?, 'favorite', 'old-del', ?)"
      ).bind(targetId, now),
      env.DB.prepare(
        "INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at) VALUES ('dev-del-1', ?, 'TV Target', 'tv', 'android', 'hash-target', ?, ?)"
      ).bind(targetId, now, now),
    ]);

    // Delete profile
    const delRes = await harness.delete(`/api/profiles/${targetId}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);
    expect(delRes.body.deletedId).toBe(targetId);

    // Verify all associated rows are purged
    const favCount = await env.DB.prepare("SELECT count(*) as c FROM favorites WHERE profile_id = ?").bind(targetId).first<{ c: number }>();
    const cwCount = await env.DB.prepare("SELECT count(*) as c FROM continue_watching WHERE profile_id = ?").bind(targetId).first<{ c: number }>();
    const whCount = await env.DB.prepare("SELECT count(*) as c FROM watch_history WHERE profile_id = ?").bind(targetId).first<{ c: number }>();
    const wpCount = await env.DB.prepare("SELECT count(*) as c FROM watch_progress WHERE profile_id = ?").bind(targetId).first<{ c: number }>();
    const ssCount = await env.DB.prepare("SELECT count(*) as c FROM shared_settings WHERE profile_id = ?").bind(targetId).first<{ c: number }>();
    const tombCount = await env.DB.prepare("SELECT count(*) as c FROM tombstones WHERE profile_id = ?").bind(targetId).first<{ c: number }>();
    const devCount = await env.DB.prepare("SELECT count(*) as c FROM devices WHERE profile_id = ?").bind(targetId).first<{ c: number }>();
    const profCount = await env.DB.prepare("SELECT count(*) as c FROM profiles WHERE id = ?").bind(targetId).first<{ c: number }>();

    expect(favCount?.c).toBe(0);
    expect(cwCount?.c).toBe(0);
    expect(whCount?.c).toBe(0);
    expect(wpCount?.c).toBe(0);
    expect(ssCount?.c).toBe(0);
    expect(tombCount?.c).toBe(0);
    expect(devCount?.c).toBe(0);
    expect(profCount?.c).toBe(0);

    // Default profile remains untouched
    const defaultCheck = await env.DB.prepare("SELECT count(*) as c FROM profiles WHERE id = ?").bind(defaultProfileId).first<{ c: number }>();
    expect(defaultCheck?.c).toBe(1);

    // Deleting nonexistent returns 404
    const notFoundRes = await harness.delete(`/api/profiles/${targetId}`);
    expect(notFoundRes.status).toBe(404);
  });

  it("1.9 POST /api/profiles safely falls back to #E50914 on non-string or invalid avatarColor without throwing 500", async () => {
    // Non-string number avatarColor
    const resNumber = await harness.post<{ ok: boolean; profile: any }>("/api/profiles", {
      name: "User Number Color",
      avatarColor: 123456,
    });
    expect(resNumber.status).toBe(201);
    expect(resNumber.body.ok).toBe(true);
    expect(resNumber.body.profile.avatar_color).toBe("#E50914");

    // Non-string boolean avatarColor
    const resBool = await harness.post<{ ok: boolean; profile: any }>("/api/profiles", {
      name: "User Bool Color",
      avatarColor: true,
    });
    expect(resBool.status).toBe(201);
    expect(resBool.body.profile.avatar_color).toBe("#E50914");

    // Non-string object avatarColor
    const resObj = await harness.post<{ ok: boolean; profile: any }>("/api/profiles", {
      name: "User Obj Color",
      avatarColor: { color: "red" },
    });
    expect(resObj.status).toBe(201);
    expect(resObj.body.profile.avatar_color).toBe("#E50914");

    // Whitespace-only string avatarColor
    const resWhitespace = await harness.post<{ ok: boolean; profile: any }>("/api/profiles", {
      name: "User Whitespace Color",
      avatar_color: "   ",
    });
    expect(resWhitespace.status).toBe(201);
    expect(resWhitespace.body.profile.avatar_color).toBe("#E50914");
  });

  it("1.10 PUT /api/profiles/:id safely ignores non-string avatarColor and retains existing color", async () => {
    const createRes = await harness.post<{ profile: any }>("/api/profiles", {
      name: "Target Color Profile",
      avatarColor: "#00E5FF",
    });
    const profileId = createRes.body.profile.id;

    const updateRes = await harness.put<{ ok: boolean; profile: any }>(`/api/profiles/${profileId}`, {
      name: "Target Color Profile Renamed",
      avatarColor: 999999,
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.profile.name).toBe("Target Color Profile Renamed");
    expect(updateRes.body.profile.avatar_color).toBe("#00E5FF");

    const stored = await env.DB.prepare("SELECT name, avatar_color FROM profiles WHERE id = ?")
      .bind(profileId)
      .first<{ name: string; avatar_color: string }>();
    expect(stored?.name).toBe("Target Color Profile Renamed");
    expect(stored?.avatar_color).toBe("#00E5FF");
  });
});

describe("Tier 1: Device Listing & Filtering (GET /api/devices)", () => {
  let harness: TestHarness;
  let prof1: string;
  let prof2: string;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();

    const s1 = await seedContext(env.DB, "prof-1", "Profile One", "token-prof-1");
    prof1 = s1.profileId;
    harness.setBearerToken(s1.token);

    const now = Date.now();
    await env.DB.prepare("INSERT INTO profiles (id, name, avatar_color, created_at, updated_at) VALUES ('prof-2', 'Profile Two', '#000', ?, ?)")
      .bind(now, now)
      .run();
    prof2 = "prof-2";

    // Add device to profile 2
    await env.DB.prepare(`
      INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at)
      VALUES ('dev-p2', 'prof-2', 'Tablet Two', 'mobile', 'android', 'hash-p2', ?, ?)
    `)
      .bind(now, now)
      .run();
  });

  it("2.1 GET /api/devices without filter returns all devices across instance", async () => {
    const res = await harness.get<{ ok: boolean; devices: any[] }>("/api/devices");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.devices.length).toBe(2);
  });

  it("2.2 GET /api/devices?profileId=... filters devices strictly for requested profile", async () => {
    const res1 = await harness.get<{ ok: boolean; devices: any[] }>(`/api/devices?profileId=${prof1}`);
    expect(res1.status).toBe(200);
    expect(res1.body.devices.length).toBe(1);
    expect(res1.body.devices[0].profile_id).toBe(prof1);

    const res2 = await harness.get<{ ok: boolean; devices: any[] }>(`/api/devices?profileId=${prof2}`);
    expect(res2.status).toBe(200);
    expect(res2.body.devices.length).toBe(1);
    expect(res2.body.devices[0].profile_id).toBe(prof2);
    expect(res2.body.devices[0].name).toBe("Tablet Two");

    const resEmpty = await harness.get<{ ok: boolean; devices: any[] }>("/api/devices?profileId=non-existent");
    expect(resEmpty.status).toBe(200);
    expect(resEmpty.body.devices.length).toBe(0);
  });

  it("2.3 PUT /api/devices/:id updates device name and associated profile", async () => {
    const updateRes = await harness.put<{ ok: boolean; device: any }>("/api/devices/dev-p2", {
      name: "Samsung S24 Ultra",
      profileId: prof1,
    });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.ok).toBe(true);
    expect(updateRes.body.device.name).toBe("Samsung S24 Ultra");
    expect(updateRes.body.device.profile_id).toBe(prof1);

    const check = await harness.get<{ ok: boolean; devices: any[] }>(`/api/devices?profileId=${prof1}`);
    expect(check.body.devices.some((d) => d.name === "Samsung S24 Ultra")).toBe(true);
  });

  it("2.4 PUT /api/devices/:id rejects empty device name (400) and non-existent device (404)", async () => {
    const resEmpty = await harness.put<{ error: string }>("/api/devices/dev-p2", {
      name: "   ",
    });
    expect(resEmpty.status).toBe(400);

    const res404 = await harness.put<{ error: string }>("/api/devices/non-existent-dev", {
      name: "Valid Name",
    });
    expect(res404.status).toBe(404);
  });

  it("2.5 POST /api/auth/profiles returns profiles with valid master password and rejects invalid password", async () => {
    // Setup instance master password
    const setupHarness = new TestHarness();
    await setupHarness.post("/api/setup", {
      masterPassword: "MyMasterPassword123!",
    });

    const publicHarness = new TestHarness();
    const wrongRes = await publicHarness.post<{ error: string }>("/api/auth/profiles", {
      password: "WrongPassword!",
    });
    expect(wrongRes.status).toBe(401);

    const validRes = await publicHarness.post<{ ok: boolean; profiles: any[] }>("/api/auth/profiles", {
      password: "MyMasterPassword123!",
    });
    expect(validRes.status).toBe(200);
    expect(validRes.body.ok).toBe(true);
    expect(validRes.body.profiles.length).toBeGreaterThan(0);
    expect(validRes.body.profiles[0].name).toBeDefined();
    expect(validRes.body.profiles[0].avatarColor).toBeDefined();
  });

  it("2.6 POST /api/auth/switch-profile switches active profile for connected device session", async () => {
    const switchRes = await harness.post<{ ok: boolean; profileId: string; profile: any }>("/api/auth/switch-profile", {
      profileId: prof2,
    });
    expect(switchRes.status).toBe(200);
    expect(switchRes.body.ok).toBe(true);
    expect(switchRes.body.profileId).toBe(prof2);
    expect(switchRes.body.profile.name).toBe("Profile Two");

    // Switching to invalid profile returns 404
    const notFoundRes = await harness.post<{ error: string }>("/api/auth/switch-profile", {
      profileId: "non-existent-profile",
    });
    expect(notFoundRes.status).toBe(404);
  });
});

describe("Tier 1: Public TV Pairing Preview Info (GET /api/pair/info)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();
  });

  it("3.1 GET /api/pair/info returns public TV pairing metadata without X-Pair-Secret header", async () => {
    const startRes = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Living Room Sony Bravia",
      deviceType: "tv",
      platform: "android-tv",
    });

    expect(startRes.status).toBe(201);
    const code = startRes.body.code;

    // Public lookup without Authorization and without X-Pair-Secret
    const publicHarness = new TestHarness();
    const infoRes = await publicHarness.get<{
      ok: boolean;
      code: string;
      deviceName: string;
      deviceType: string;
      platform: string;
      status: string;
      expiresAt: number;
    }>(`/api/pair/info?code=${code}`);

    expect(infoRes.status).toBe(200);
    expect(infoRes.body.ok).toBe(true);
    expect(infoRes.body.code).toBe(code);
    expect(infoRes.body.deviceName).toBe("Living Room Sony Bravia");
    expect(infoRes.body.deviceType).toBe("tv");
    expect(infoRes.body.platform).toBe("android-tv");
    expect(infoRes.body.status).toBe("pending");
    expect(typeof infoRes.body.expiresAt).toBe("number");
  });

  it("3.2 GET /api/pair/info supports case-insensitive code parameter", async () => {
    const startRes = await harness.post<{ code: string }>("/api/pair/start", {
      deviceName: "Bedroom Fire TV",
    });
    const code = startRes.body.code;

    const lowerRes = await harness.get<{ ok: boolean; code: string }>(`/api/pair/info?code=${code.toLowerCase()}`);
    expect(lowerRes.status).toBe(200);
    expect(lowerRes.body.code).toBe(code);
  });

  it("3.3 GET /api/pair/info returns 400 when code is missing and 404 when code not found", async () => {
    const missingRes = await harness.get("/api/pair/info");
    expect(missingRes.status).toBe(400);

    const notFoundRes = await harness.get("/api/pair/info?code=NOCODE");
    expect(notFoundRes.status).toBe(404);
  });

  it("3.4 GET /api/pair/info returns status expired when pairing code timestamp has elapsed", async () => {
    const now = Date.now();
    await env.DB.prepare(`
      INSERT INTO pairing_codes (code, pair_secret_hash, device_name, device_type, platform, status, expires_at, created_at)
      VALUES ('EXPIRE', 'hash', 'Old TV', 'tv', 'android', 'pending', ?, ?)
    `)
      .bind(now - 1000, now - 301000)
      .run();

    const res = await harness.get<{ ok: boolean; status: string }>("/api/pair/info?code=EXPIRE");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("expired");
  });

  it("3.5 GET /api/pair/info returns status expired when approved pairing code has elapsed", async () => {
    const now = Date.now();
    await env.DB.prepare(`
      INSERT INTO pairing_codes (code, pair_secret_hash, device_name, device_type, platform, status, expires_at, created_at)
      VALUES ('EXPAPP', 'hash', 'Approved But Abandoned TV', 'tv', 'android', 'approved', ?, ?)
    `)
      .bind(now - 2000, now - 302000)
      .run();

    const res = await harness.get<{ ok: boolean; status: string }>("/api/pair/info?code=EXPAPP");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("expired");
  });

  it("3.6 GET /api/pair/info enforces in-memory rate limiting (30 requests per minute per IP)", async () => {
    harness.setHeader("cf-connecting-ip", "192.168.10.50");

    // Perform 30 requests within limit
    for (let i = 0; i < 30; i++) {
      const res = await harness.get("/api/pair/info?code=NONEXIST");
      expect(res.status).toBe(404);
    }

    // 31st request triggers 429
    const rateLimitedRes = await harness.get<any>("/api/pair/info?code=NONEXIST");
    expect(rateLimitedRes.status).toBe(429);
    expect(rateLimitedRes.body.error).toBe("Too Many Requests");
    expect(rateLimitedRes.headers.has("retry-after")).toBe(true);

    // Another IP is unaffected
    harness.setHeader("cf-connecting-ip", "192.168.10.51");
    const otherIpRes = await harness.get("/api/pair/info?code=NONEXIST");
    expect(otherIpRes.status).toBe(404);
  });
});

describe("Tier 1: Maintenance Housekeeping Queries (purgeOldTombstones & purgeExpiredPairingCodes)", () => {
  beforeEach(async () => {
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
  });

  it("4.1 purgeOldTombstones purges tombstones older than 90 days and preserves recent tombstones", async () => {
    const now = Date.now();
    const oldTime = now - (NINETY_DAYS_MS + 1000); // 90 days and 1 second ago
    const recentTime = now - (NINETY_DAYS_MS - 10000); // 89+ days ago (recent)

    await env.DB.batch([
      env.DB.prepare("INSERT INTO profiles (id, name, avatar_color, created_at, updated_at) VALUES ('p-maint', 'Maint', '#000', ?, ?)")
        .bind(now, now),
      env.DB.prepare("INSERT INTO tombstones (profile_id, entity_type, entity_key, deleted_at) VALUES ('p-maint', 'favorite', 'old-tomb', ?)")
        .bind(oldTime),
      env.DB.prepare("INSERT INTO tombstones (profile_id, entity_type, entity_key, deleted_at) VALUES ('p-maint', 'favorite', 'recent-tomb', ?)")
        .bind(recentTime),
    ]);

    const purgedCount = await purgeOldTombstones(env.DB, now);
    expect(purgedCount).toBe(1);

    const remaining = await env.DB.prepare("SELECT entity_key FROM tombstones WHERE profile_id = 'p-maint'").all<{ entity_key: string }>();
    expect(remaining.results).toHaveLength(1);
    expect(remaining.results[0].entity_key).toBe("recent-tomb");
  });

  it("4.2 purgeExpiredPairingCodes purges codes older than 24h and preserves active codes", async () => {
    const now = Date.now();
    const oldExpiredTime = now - (TWENTY_FOUR_HOURS_MS + 5000);
    const activeTime = now + 200000;

    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO pairing_codes (code, pair_secret_hash, device_name, device_type, platform, status, expires_at, created_at)
        VALUES ('OLDEXP', 'hash1', 'Old TV', 'tv', 'android', 'expired', ?, ?)
      `).bind(oldExpiredTime, oldExpiredTime - 300000),
      env.DB.prepare(`
        INSERT INTO pairing_codes (code, pair_secret_hash, device_name, device_type, platform, status, expires_at, created_at)
        VALUES ('ACTIVE', 'hash2', 'New TV', 'tv', 'android', 'pending', ?, ?)
      `).bind(activeTime, now),
    ]);

    const purged = await purgeExpiredPairingCodes(env.DB, now);
    expect(purged).toBe(1);

    const remaining = await env.DB.prepare("SELECT code FROM pairing_codes").all<{ code: string }>();
    expect(remaining.results).toHaveLength(1);
    expect(remaining.results[0].code).toBe("ACTIVE");
  });
});
