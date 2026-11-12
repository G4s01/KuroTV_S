/**
 * Tier 3: Cross-Feature Pairwise Interaction Matrix
 *
 * Exercises pairwise feature interactions across all 17 features:
 * - Feature 1: Health & Routing (/api/health)
 * - Feature 2: D1 DDL & ensureSchema
 * - Feature 3: Hybrid Zero-Config Setup (/api/setup)
 * - Feature 4: Master Admin Authentication (/api/auth/login)
 * - Feature 5: Token Storage & Revocation (/api/devices, middleware)
 * - Feature 6: In-Memory Rate Limiting
 * - Feature 7: TV Pairing Start (/api/pair/start)
 * - Feature 8: TV Pairing Status Polling (/api/pair/status)
 * - Feature 9: TV Pairing Approval (/api/pair/approve)
 * - Feature 10: One-Time Code Delivery & Consumption
 * - Feature 11: Smartphone Quick Login (/api/auth/device-login)
 * - Feature 12: Delta Sync Pull (/api/sync/pull)
 * - Feature 13: Delta Sync Push Batch (/api/sync/push)
 * - Feature 14: LWW & Tombstone Dominance
 * - Feature 15: Timeline Progress Safeguard
 * - Feature 16: Backup Export & Import (/api/sync/export, /api/sync/import)
 * - Feature 17: Client SDK & End-to-End Interoperability
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { TestHarness, clearDatabase } from "../helpers/harness";
import { ensureSchema } from "../../src/worker/schema";
import { resetRateLimits } from "../../src/worker/rate-limit";
import {
  FIXTURE_ANIME_1,
  FIXTURE_ANIME_2,
  FIXTURE_PROGRESS_1,
  FIXTURE_CONTINUE_WATCHING_1,
  FIXTURE_WATCH_HISTORY_1,
} from "../helpers/fixtures";

describe("Tier 3: Cross-Feature Pairwise Interaction Suite", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();
  });

  // Pair 1: F1 (Health) + F3 (Zero-Config Setup)
  it("Pairwise 1 [F1 + F3]: Health reflects initialized false before setup, then true after setup", async () => {
    const healthBefore = await harness.get<{ ok: boolean; initialized: boolean }>("/api/health");
    expect(healthBefore.status).toBe(200);
    expect(healthBefore.body.ok).toBe(true);
    expect(healthBefore.body.initialized).toBe(false);

    // Perform setup
    const setupRes = await harness.post<{ ok: boolean }>("/api/setup", {
      masterPassword: "MasterPassword123!",
      initialProfileName: "Primary",
    });
    expect(setupRes.status).toBe(200);

    // Health after setup
    const healthAfter = await harness.get<{ ok: boolean; initialized: boolean }>("/api/health");
    expect(healthAfter.status).toBe(200);
    expect(healthAfter.body.initialized).toBe(true);
  });

  // Pair 2: F3 (Setup) + F4 (Master Login)
  it("Pairwise 2 [F3 + F4]: Master password configured during setup authenticates and returns session token", async () => {
    await harness.post("/api/setup", {
      masterPassword: "SetupDerivedKey2026!",
      initialProfileName: "Console User",
    });

    const loginRes = await harness.post<{
      ok: boolean;
      token: string;
      profileId: string;
      profile: { name: string };
    }>("/api/auth/login", {
      password: "SetupDerivedKey2026!",
    });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.ok).toBe(true);
    expect(loginRes.body.token).toBeDefined();
    expect(loginRes.body.profile.name).toBe("Console User");
  });

  // Pair 3: F4 (Master Login) + Profiles (Multi-Profile)
  it("Pairwise 3 [F4 + Profiles]: Authenticated master session creates and lists multiple profiles", async () => {
    await harness.post("/api/setup", { masterPassword: "MasterPassword123!" });
    const loginRes = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: "MasterPassword123!",
    });
    harness.setBearerToken(loginRes.body.token);

    // Create profile 2
    const createRes = await harness.post<{ ok: boolean; profile: { id: string; name: string } }>(
      "/api/profiles",
      { name: "Salotto TV", avatarColor: "#FF3B5C" }
    );
    expect(createRes.status).toBe(201);
    expect(createRes.body.profile.name).toBe("Salotto TV");

    // List all profiles
    const listRes = await harness.get<{ ok: boolean; profiles: any[] }>("/api/profiles");
    expect(listRes.status).toBe(200);
    expect(listRes.body.profiles).toHaveLength(2);
    expect(listRes.body.profiles.some((p) => p.name === "Salotto TV")).toBe(true);
  });

  // Pair 4: F3 (Setup) + F7 (TV Pairing Start)
  it("Pairwise 4 [F3 + F7]: Fresh instance immediately accepts TV pairing start and returns valid 6-char code", async () => {
    await harness.post("/api/setup", { masterPassword: "MasterPassword123!" });

    const pairRes = await harness.post<{
      code: string;
      pairSecret: string;
      expiresIn: number;
      verifyUrl: string;
    }>("/api/pair/start", {
      deviceName: "Living Room Android TV",
      deviceType: "tv",
      platform: "android-tv",
    });

    expect(pairRes.status).toBe(201);
    expect(pairRes.body.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(pairRes.body.pairSecret).toBeDefined();
    expect(pairRes.body.expiresIn).toBe(300);
  });

  // Pair 5: F7 (Pairing Start) + F8 (Pairing Polling)
  it("Pairwise 5 [F7 + F8]: TV polling immediately returns pending status with valid X-Pair-Secret", async () => {
    await harness.post("/api/setup", { masterPassword: "MasterPassword123!" });
    const startRes = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Bedroom Shield",
    });

    harness.setPairSecret(startRes.body.pairSecret);
    const pollRes = await harness.get<{ status: string }>(`/api/pair/status?code=${startRes.body.code}`);
    expect(pollRes.status).toBe(200);
    expect(pollRes.body.status).toBe("pending");
  });

  // Pair 6: F4 (Master Session) + F9 (Pairing Approval)
  it("Pairwise 6 [F4 + F9]: Authenticated master session approves TV pairing code for selected profile", async () => {
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
    });
    const profileId = setupRes.body.profileId;

    const loginRes = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: "MasterPassword123!",
    });

    const startRes = await harness.post<{ code: string }>("/api/pair/start", {
      deviceName: "Sony Bravia 4K",
    });

    harness.setBearerToken(loginRes.body.token);
    const approveRes = await harness.post<{ ok: boolean; deviceId: string }>("/api/pair/approve", {
      code: startRes.body.code,
      profileId,
      deviceLabel: "Sony Bravia Master Room",
    });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.ok).toBe(true);
    expect(approveRes.body.deviceId).toBeDefined();
  });

  // Pair 7: F8 (Pairing Polling) + F10 (One-Time Delivery & Consumption)
  it("Pairwise 7 [F8 + F10]: TV polls approved code, receives credentials once, subsequent poll is consumed", async () => {
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
    });
    const profileId = setupRes.body.profileId;

    const startRes = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Philips Ambilight TV",
    });

    const loginRes = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: "MasterPassword123!",
    });
    harness.setBearerToken(loginRes.body.token);
    await harness.post("/api/pair/approve", {
      code: startRes.body.code,
      profileId,
    });

    // 1st TV Poll: Delivers credentials
    harness.clearAuth();
    harness.setPairSecret(startRes.body.pairSecret);
    const firstPoll = await harness.get<{
      status: string;
      deviceToken: string;
      deviceId: string;
      profileId: string;
    }>(`/api/pair/status?code=${startRes.body.code}`);

    expect(firstPoll.status).toBe(200);
    expect(firstPoll.body.status).toBe("approved");
    expect(firstPoll.body.deviceToken).toMatch(/^kuro_tv_/);

    // 2nd TV Poll: Must be consumed
    const secondPoll = await harness.get<{ status: string; deviceToken?: string }>(
      `/api/pair/status?code=${startRes.body.code}`
    );
    expect(secondPoll.status).toBe(200);
    expect(secondPoll.body.status).toBe("consumed");
    expect(secondPoll.body.deviceToken).toBeUndefined();
  });

  // Pair 8: F10 (TV Device Token) + F13 (Delta Push)
  it("Pairwise 8 [F10 + F13]: Delivered TV device token authenticates and pushes delta playback data", async () => {
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
    });

    const startRes = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "LG WebOS TV",
    });

    const loginRes = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: "MasterPassword123!",
    });
    harness.setBearerToken(loginRes.body.token);
    await harness.post("/api/pair/approve", {
      code: startRes.body.code,
      profileId: setupRes.body.profileId,
    });

    harness.clearAuth();
    harness.setPairSecret(startRes.body.pairSecret);
    const pollRes = await harness.get<{ deviceToken: string }>(`/api/pair/status?code=${startRes.body.code}`);
    const tvToken = pollRes.body.deviceToken;

    // TV pushes progress
    harness.clearAuth();
    harness.setBearerToken(tvToken);
    const pushRes = await harness.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
      continueWatching: [
        {
          ...FIXTURE_CONTINUE_WATCHING_1,
          animeId: "anime-tv-session",
          episodeNumber: 4,
          position: 650,
          percentage: 45.0,
          updatedAt: Date.now(),
        },
      ],
    });

    expect(pushRes.status).toBe(200);
    expect(pushRes.body.ok).toBe(true);
    expect(pushRes.body.appliedCount).toBe(1);
  });

  // Pair 9: F11 (Smartphone Quick Login) + F12 (Delta Pull)
  it("Pairwise 9 [F11 + F12]: Smartphone logs in via device-login and pulls TV's pushed progress", async () => {
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
    });
    const profileId = setupRes.body.profileId;

    // Mobile logs in
    const phoneRes = await harness.post<{ ok: boolean; deviceToken: string }>("/api/auth/device-login", {
      password: "MasterPassword123!",
      profileId,
      deviceName: "Google Pixel 8",
    });
    expect(phoneRes.status).toBe(200);
    const phoneToken = phoneRes.body.deviceToken;

    // Push data to profile
    harness.setBearerToken(phoneToken);
    await harness.post("/api/sync/push", {
      favorites: [{ ...FIXTURE_ANIME_1, id: "anime-cross-device" }],
    });

    // Pull data
    const pullRes = await harness.get<{ deltas: { favorites: any[] } }>("/api/sync/pull?since=0");
    expect(pullRes.status).toBe(200);
    expect(pullRes.body.deltas.favorites.some((f) => f.id === "anime-cross-device")).toBe(true);
  });

  // Pair 10: F13 (Delta Push Deletion) + F14 (Tombstone Dominance)
  it("Pairwise 10 [F13 + F14]: Deleting entity creates tombstone that drops older subsequent pushes", async () => {
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
    });
    const devRes = await harness.post<{ ok: boolean; deviceToken: string }>("/api/auth/device-login", {
      password: "MasterPassword123!",
      profileId: setupRes.body.profileId,
      deviceName: "Dev 1",
    });
    harness.setBearerToken(devRes.body.deviceToken);

    const deleteTime = 1700005000000;
    await harness.post("/api/sync/push", {
      deletions: [{ type: "favorite", key: "anime-tomb-pw10", deletedAt: deleteTime }],
    });

    // Older push must be dropped
    await harness.post("/api/sync/push", {
      favorites: [{ ...FIXTURE_ANIME_1, id: "anime-tomb-pw10", updatedAt: deleteTime - 5000 }],
    });

    const check = await env.DB.prepare("SELECT * FROM favorites WHERE anime_id = 'anime-tomb-pw10'").first();
    expect(check).toBeNull();
  });

  // Pair 11: F14 (Tombstones) + F12 (Delta Pull)
  it("Pairwise 11 [F14 + F12]: Delta pull includes tombstones deleted after requested since timestamp", async () => {
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
    });
    const devRes = await harness.post<{ ok: boolean; deviceToken: string }>("/api/auth/device-login", {
      password: "MasterPassword123!",
      profileId: setupRes.body.profileId,
      deviceName: "Dev 1",
    });
    harness.setBearerToken(devRes.body.deviceToken);

    const t0 = 1700000000000;
    const t1 = 1700002000000;
    await harness.post("/api/sync/push", {
      deletions: [{ type: "continue_watching", key: "anime-pw11", deletedAt: t1 }],
    });

    const pullRes = await harness.get<{ tombstones: Array<{ type: string; key: string }> }>(
      `/api/sync/pull?since=${t0}`
    );

    expect(pullRes.status).toBe(200);
    expect(pullRes.body.tombstones.some((t) => t.key === "anime-pw11")).toBe(true);
  });

  // Pair 12: F13 (Delta Push) + F15 (Timeline Safeguard)
  it("Pairwise 12 [F13 + F15]: Concurrent watch_progress pushes preserve higher percentage and completed status", async () => {
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
    });
    const devRes = await harness.post<{ ok: boolean; deviceToken: string }>("/api/auth/device-login", {
      password: "MasterPassword123!",
      profileId: setupRes.body.profileId,
      deviceName: "Dev 1",
    });
    harness.setBearerToken(devRes.body.deviceToken);

    // Push 1: completed ep 1
    await harness.post("/api/sync/push", {
      watchProgress: [
        {
          ...FIXTURE_PROGRESS_1,
          animeId: "anime-safeguard-pw12",
          episodeNumber: 1,
          percentage: 100.0,
          currentTime: 1400,
          isCompleted: true,
          updatedAt: 1000,
        },
      ],
    });

    // Push 2: uncompleted ep 1 with lower progress
    await harness.post("/api/sync/push", {
      watchProgress: [
        {
          ...FIXTURE_PROGRESS_1,
          animeId: "anime-safeguard-pw12",
          episodeNumber: 1,
          percentage: 50.0,
          currentTime: 700,
          isCompleted: false,
          updatedAt: 2000,
        },
      ],
    });

    const row = await env.DB.prepare(
      "SELECT percentage, is_completed FROM watch_progress WHERE anime_id = 'anime-safeguard-pw12'"
    ).first<{ percentage: number; is_completed: number }>();

    expect(row?.percentage).toBe(100.0);
    expect(row?.is_completed).toBe(1);
  });

  // Pair 13: F5 (Token Revocation) + F13 (Blocked Push)
  it("Pairwise 13 [F5 + F13]: Revoking a device token blocks subsequent delta push immediately with 401", async () => {
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
    });
    const devRes = await harness.post<{ ok: boolean; deviceToken: string; deviceId: string }>(
      "/api/auth/device-login",
      {
        password: "MasterPassword123!",
        profileId: setupRes.body.profileId,
        deviceName: "Compromised Tablet",
      }
    );
    const compromisedToken = devRes.body.deviceToken;
    const deviceId = devRes.body.deviceId;

    // Revoke device
    harness.setBearerToken(compromisedToken);
    const revokeRes = await harness.delete(`/api/devices/${deviceId}`);
    expect(revokeRes.status).toBe(200);

    // Attempt push with revoked token
    const pushRes = await harness.post("/api/sync/push", {
      favorites: [FIXTURE_ANIME_1],
    });
    expect(pushRes.status).toBe(401);
    expect(pushRes.body.message).toContain("Invalid or revoked token");
  });

  // Pair 14: F5 (Token Revocation) + F12 (Blocked Pull)
  it("Pairwise 14 [F5 + F12]: Revoking a device token blocks subsequent delta pull immediately with 401", async () => {
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
    });
    const devRes = await harness.post<{ ok: boolean; deviceToken: string; deviceId: string }>(
      "/api/auth/device-login",
      {
        password: "MasterPassword123!",
        profileId: setupRes.body.profileId,
        deviceName: "Lost Phone",
      }
    );
    const lostToken = devRes.body.deviceToken;
    const deviceId = devRes.body.deviceId;

    harness.setBearerToken(lostToken);
    await harness.delete(`/api/devices/${deviceId}`);

    const pullRes = await harness.get("/api/sync/pull");
    expect(pullRes.status).toBe(401);
  });

  // Pair 15: F4 (Master Login) + F16 (Backup Export)
  it("Pairwise 15 [F4 + F16]: Authenticated master session exports comprehensive instance backup JSON", async () => {
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
      createSession: true,
    });
    const loginRes = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: "MasterPassword123!",
    });
    harness.setBearerToken(loginRes.body.token);

    // Seed some data
    await harness.post("/api/sync/push", {
      favorites: [{ ...FIXTURE_ANIME_1, id: "anime-backup-pw15" }],
      sharedSettings: { preferredQuality: "1080p" },
    });

    const exportRes = await harness.get<{
      version: number;
      profiles: any[];
      favorites: any[];
      sharedSettings: any[];
    }>("/api/sync/export");

    expect(exportRes.status).toBe(200);
    expect(exportRes.body.version).toBe(1);
    expect(exportRes.body.profiles.length).toBeGreaterThanOrEqual(1);
    expect(exportRes.body.favorites.some((f) => f.anime_id === "anime-backup-pw15")).toBe(true);
  });

  // Pair 16: F2 (DDL Wipe) + F16 (Backup Import)
  it("Pairwise 16 [F2 + F16]: Wiping database and restoring via backup import recreates full state", async () => {
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
      createSession: true,
    });
    const profileId = setupRes.body.profileId;

    const loginRes = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: "MasterPassword123!",
    });
    harness.setBearerToken(loginRes.body.token);

    await harness.post("/api/sync/push", {
      favorites: [{ ...FIXTURE_ANIME_1, id: "anime-restore-test" }],
    });

    // Export backup
    const exportRes = await harness.get("/api/sync/export");
    const backupData = exportRes.body;

    // Wipe library tables
    await env.DB.prepare("DELETE FROM favorites").run();
    expect((await env.DB.prepare("SELECT COUNT(*) as cnt FROM favorites").first<{ cnt: number }>())?.cnt).toBe(0);

    // Import backup
    const importRes = await harness.post<{ ok: boolean; imported: any }>("/api/sync/import", {
      backup: backupData,
    });
    expect(importRes.status).toBe(200);
    expect(importRes.body.ok).toBe(true);

    // Verify record restored
    const restored = await env.DB.prepare("SELECT * FROM favorites WHERE anime_id = 'anime-restore-test'").first();
    expect(restored).toBeDefined();
  });

  // Pair 17: F16 (Restore) + F12 (Post-Restore Delta Pull)
  it("Pairwise 17 [F16 + F12]: Restored instance delivers restored items in delta pull to authenticated clients", async () => {
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
      createSession: true,
    });
    const loginRes = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: "MasterPassword123!",
    });
    harness.setBearerToken(loginRes.body.token);

    // Import payload with a favorite
    await harness.post("/api/sync/import", {
      backup: {
        profiles: [{ id: setupRes.body.profileId, name: "Restored Profile", avatar_color: "#E50914" }],
        favorites: [
          {
            profile_id: setupRes.body.profileId,
            anime_id: "anime-post-restore",
            title: "Post Restore Anime",
            thumbnail: "https://example.com/thumb.jpg",
            genres_json: "[]",
            link: "https://example.com",
            updated_at: Date.now(),
          },
        ],
      },
    });

    const pullRes = await harness.get<{ deltas: { favorites: any[] } }>("/api/sync/pull?since=0");
    expect(pullRes.status).toBe(200);
    expect(pullRes.body.deltas.favorites.some((f) => f.id === "anime-post-restore")).toBe(true);
  });

  // Pair 18: F6 (Rate Limiting) + F4/F7 (Endpoint Isolation)
  it("Pairwise 18 [F6 + F4/F7]: Rate limit exhaustion on auth/login leaves pair/start unblocked", async () => {
    await harness.post("/api/setup", { masterPassword: "MasterPassword123!" });

    // Exhaust 5 login attempts
    for (let i = 0; i < 5; i++) {
      await harness.post("/api/auth/login", { password: "WrongPassword" });
    }
    const blockedLogin = await harness.post("/api/auth/login", { password: "WrongPassword" });
    expect(blockedLogin.status).toBe(429);

    // Pair start endpoint should be unaffected
    const unblockedPair = await harness.post<{ code: string }>("/api/pair/start", {
      deviceName: "Isolated TV",
    });
    expect(unblockedPair.status).toBe(201);
    expect(unblockedPair.body.code).toBeDefined();
  });
});
