/**
 * Tier 4 Real-World Application Scenarios
 *
 * Implements the 6 end-to-end multi-device workflow scenarios from TEST_INFRA.md:
 * 1. Complete Zero-Config Setup to Android TV Onboarding
 * 2. Multi-Device Progress Sync with Mobile -> TV Handoff
 * 3. Offline Catch-Up with Tombstone Dominance & IN PARI
 * 4. Security Compromise: Device Revocation during Sync
 * 5. Full Instance Disaster Recovery: Export -> Wipe -> Import
 * 6. Multi-Profile Library & Settings Isolation
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { TestHarness, clearDatabase } from "../helpers/harness";
import { ensureSchema } from "../../src/worker/schema";
import { resetRateLimits } from "../../src/worker/rate-limit";
import {
  FIXTURE_ANIME_1,
  FIXTURE_ANIME_2,
  FIXTURE_ANIME_3,
  FIXTURE_PROGRESS_1,
  FIXTURE_PROGRESS_2,
  FIXTURE_CONTINUE_WATCHING_1,
  FIXTURE_CONTINUE_WATCHING_2,
  FIXTURE_WATCH_HISTORY_1,
  FIXTURE_SEARCH_HISTORY_1,
} from "../helpers/fixtures";
import type {
  AnimeItem,
  ContinueWatchingItem,
  WatchProgressItem,
  WatchHistoryItem,
} from "@kurosync/sync-client";

describe("Tier 4: Real-World Multi-Device Workflows Suite", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();
  });

  // ==========================================================================
  // Scenario 1: Complete Zero-Config Setup to Android TV Onboarding
  // ==========================================================================
  it("Scenario 1: Complete Zero-Config Setup to Android TV Onboarding", async () => {
    // 1. Uninitialized reachability check
    const healthBefore = await harness.get<{ ok: boolean; initialized: boolean }>("/api/health");
    expect(healthBefore.status).toBe(200);
    expect(healthBefore.body.initialized).toBe(false);

    // 2. Setup Wizard executed on first start
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword2026!",
      initialProfileName: "Living Room",
      createSession: true,
    });
    expect(setupRes.status).toBe(200);
    expect(setupRes.body.ok).toBe(true);
    const profileId = setupRes.body.profileId;

    // 3. Web Console Master Login
    const loginRes = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: "MasterPassword2026!",
    });
    expect(loginRes.status).toBe(200);
    const webToken = loginRes.body.token;

    // 4. Android TV launches and starts pairing flow
    const tvStartRes = await harness.post<{
      code: string;
      pairSecret: string;
      expiresIn: number;
      verifyUrl: string;
    }>("/api/pair/start", {
      deviceName: "Living Room Sony Bravia",
      deviceType: "tv",
      platform: "android-tv",
    });
    expect(tvStartRes.status).toBe(201);
    const tvCode = tvStartRes.body.code;
    const pairSecret = tvStartRes.body.pairSecret;

    // 5. Android TV begins background polling (status is pending)
    harness.setPairSecret(pairSecret);
    const pollPending = await harness.get<{ status: string }>(`/api/pair/status?code=${tvCode}`);
    expect(pollPending.status).toBe(200);
    expect(pollPending.body.status).toBe("pending");

    // 6. User enters code in Web Console (/pair) and approves TV device for profile
    harness.clearAuth();
    harness.setBearerToken(webToken);
    const approveRes = await harness.post<{ ok: boolean; deviceId: string }>("/api/pair/approve", {
      code: tvCode,
      profileId,
      deviceLabel: "Sony Bravia OLED 65",
    });
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.ok).toBe(true);

    // 7. TV's next poll consumes approved status and receives device token
    harness.clearAuth();
    harness.setPairSecret(pairSecret);
    const pollApproved = await harness.get<{
      status: string;
      deviceToken: string;
      deviceId: string;
      profileId: string;
      profileName: string;
    }>(`/api/pair/status?code=${tvCode}`);

    expect(pollApproved.status).toBe(200);
    expect(pollApproved.body.status).toBe("approved");
    expect(pollApproved.body.deviceToken).toMatch(/^kuro_tv_/);
    expect(pollApproved.body.profileName).toBe("Living Room");
    const tvToken = pollApproved.body.deviceToken;

    // 8. Subsequent poll shows consumed and will not re-deliver token
    const pollConsumed = await harness.get<{ status: string; deviceToken?: string }>(
      `/api/pair/status?code=${tvCode}`
    );
    expect(pollConsumed.body.status).toBe("consumed");
    expect(pollConsumed.body.deviceToken).toBeUndefined();

    // 9. Android TV performs initial bootstrap pull
    harness.clearAuth();
    harness.setBearerToken(tvToken);
    const bootstrapPull = await harness.get<{
      serverTime: number;
      profile: { id: string; name: string };
      deltas: any;
    }>("/api/sync/pull?since=0");

    expect(bootstrapPull.status).toBe(200);
    expect(bootstrapPull.body.profile.name).toBe("Living Room");
    expect(bootstrapPull.body.deltas.favorites).toEqual([]);
  });

  // ==========================================================================
  // Scenario 2: Multi-Device Progress Sync with Mobile -> TV Handoff
  // ==========================================================================
  it("Scenario 2: Multi-Device Progress Sync with Mobile -> TV Handoff", async () => {
    // 1. Instance initialized with profile
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
      initialProfileName: "Marco",
    });
    const profileId = setupRes.body.profileId;

    // 2. Issue Mobile Device Token via Quick Login
    const mobileLogin = await harness.post<{ ok: boolean; deviceToken: string }>("/api/auth/device-login", {
      password: "MasterPassword123!",
      profileId,
      deviceName: "Pixel 8 Mobile",
      platform: "android",
    });
    const mobileToken = mobileLogin.body.deviceToken;

    // 3. Issue Android TV Token via TV Pairing Flow
    const tvPair = await harness.post<{ code: string; pairSecret: string }>("/api/pair/start", {
      deviceName: "Living Room Shield TV",
    });
    harness.setBearerToken(mobileToken);
    await harness.post("/api/pair/approve", {
      code: tvPair.body.code,
      profileId,
      deviceLabel: "Shield TV Living Room",
    });

    harness.clearAuth();
    harness.setPairSecret(tvPair.body.pairSecret);
    const tvStatus = await harness.get<{ deviceToken: string }>(`/api/pair/status?code=${tvPair.body.code}`);
    const tvToken = tvStatus.body.deviceToken;

    // 4. Mobile: User watches Solo Leveling Ep 12 on the bus and finishes it
    const busTimestamp = 1700000000000;
    harness.clearAuth();
    harness.setBearerToken(mobileToken);

    await harness.post("/api/sync/push", {
      favorites: [{ ...FIXTURE_ANIME_1, id: "anime-solo-leveling" }],
      watchProgress: [
        {
          ...FIXTURE_PROGRESS_1,
          animeId: "anime-solo-leveling",
          episodeNumber: 12,
          currentTime: 1350,
          duration: 1420,
          percentage: 95.0,
          isCompleted: true,
          updatedAt: busTimestamp,
        },
      ],
      continueWatching: [
        {
          ...FIXTURE_CONTINUE_WATCHING_1,
          animeId: "anime-solo-leveling",
          episodeNumber: 12,
          position: 1350,
          duration: 1420,
          percentage: 95.0,
          isCaughtUp: true,
          updatedAt: busTimestamp,
        },
      ],
    });

    // 5. TV: User turns on TV at home and executes pull
    harness.clearAuth();
    harness.setBearerToken(tvToken);
    const tvPull = await harness.get<{
      deltas: {
        continueWatching: ContinueWatchingItem[];
        watchProgress: WatchProgressItem[];
      };
    }>("/api/sync/pull?since=0");

    expect(tvPull.status).toBe(200);
    const tvCw = tvPull.body.deltas.continueWatching.find((c) => c.animeId === "anime-solo-leveling");
    expect(tvCw).toBeDefined();
    expect(tvCw?.episodeNumber).toBe(12);
    expect(tvCw?.position).toBe(1350);
    expect(tvCw?.isCaughtUp).toBe(true); // IN PARI

    // 6. TV: User starts watching Frieren Episode 14 on TV and reaches 44%
    const tvWatchTimestamp = busTimestamp + 3600000;
    await harness.post("/api/sync/push", {
      continueWatching: [
        {
          ...FIXTURE_CONTINUE_WATCHING_2,
          animeId: "anime-frieren",
          episodeNumber: 14,
          position: 640,
          duration: 1440,
          percentage: 44.4,
          isCaughtUp: false,
          updatedAt: tvWatchTimestamp,
        },
      ],
    });

    // 7. Mobile: Pulls latest delta and reflects TV's Frieren progress seamlessly
    harness.clearAuth();
    harness.setBearerToken(mobileToken);
    const mobilePull = await harness.get<{
      deltas: {
        continueWatching: ContinueWatchingItem[];
      };
    }>(`/api/sync/pull?since=${busTimestamp}`);

    expect(mobilePull.status).toBe(200);
    const frierenCw = mobilePull.body.deltas.continueWatching.find((c) => c.animeId === "anime-frieren");
    expect(frierenCw).toBeDefined();
    expect(frierenCw?.episodeNumber).toBe(14);
    expect(frierenCw?.percentage).toBe(44.4);
  });

  // ==========================================================================
  // Scenario 3: Offline Catch-Up with Tombstone Dominance & IN PARI
  // ==========================================================================
  it("Scenario 3: Offline Catch-Up with Tombstone Dominance & IN PARI", async () => {
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
    });
    const profileId = setupRes.body.profileId;

    const mobRes = await harness.post<{ ok: boolean; deviceToken: string }>("/api/auth/device-login", {
      password: "MasterPassword123!",
      profileId,
      deviceName: "Travel Phone",
    });
    const phoneToken = mobRes.body.deviceToken;

    const tvRes = await harness.post<{ ok: boolean; deviceToken: string }>("/api/auth/device-login", {
      password: "MasterPassword123!",
      profileId,
      deviceName: "Home TV",
    });
    const tvToken = tvRes.body.deviceToken;

    const t0 = 1700000000000;

    // Both devices start with jujutsu kaisen on continue watching
    harness.setBearerToken(phoneToken);
    await harness.post("/api/sync/push", {
      continueWatching: [
        {
          ...FIXTURE_CONTINUE_WATCHING_1,
          animeId: "anime-jjk",
          episodeNumber: 1,
          position: 300,
          percentage: 20.0,
          updatedAt: t0,
        },
      ],
    });

    // While mobile is on flight, TV pushes 10 min progress on jjk at t0 + 1000
    harness.setBearerToken(tvToken);
    await harness.post("/api/sync/push", {
      continueWatching: [
        {
          ...FIXTURE_CONTINUE_WATCHING_1,
          animeId: "anime-jjk",
          episodeNumber: 1,
          position: 600,
          percentage: 45.0,
          updatedAt: t0 + 1000,
        },
      ],
    });

    // Mobile lands and pushes offline actions performed at t0 + 5000:
    // 1. Deleted jjk from continue watching (tombstone)
    // 2. Finished Frieren (isCaughtUp = true)
    harness.setBearerToken(phoneToken);
    const pushOfflineRes = await harness.post("/api/sync/push", {
      deletions: [{ type: "continue_watching", key: "anime-jjk", deletedAt: t0 + 5000 }],
      continueWatching: [
        {
          ...FIXTURE_CONTINUE_WATCHING_2,
          animeId: "anime-frieren",
          episodeNumber: 28,
          position: 1440,
          percentage: 100.0,
          isCaughtUp: true,
          updatedAt: t0 + 5000,
        },
      ],
    });
    expect(pushOfflineRes.status).toBe(200);

    // TV executes delta pull:
    // JJK must be in tombstones, and deleted from continue watching
    // Frieren must be present with isCaughtUp = true
    harness.setBearerToken(tvToken);
    const tvSync = await harness.get<{
      deltas: { continueWatching: ContinueWatchingItem[] };
      tombstones: Array<{ type: string; key: string }>;
    }>(`/api/sync/pull?since=${t0}`);

    expect(tvSync.status).toBe(200);
    expect(tvSync.body.deltas.continueWatching.some((c) => c.animeId === "anime-jjk")).toBe(false);
    expect(tvSync.body.tombstones.some((t) => t.type === "continue_watching" && t.key === "anime-jjk")).toBe(true);

    const frieren = tvSync.body.deltas.continueWatching.find((c) => c.animeId === "anime-frieren");
    expect(frieren).toBeDefined();
    expect(frieren?.isCaughtUp).toBe(true);
  });

  // ==========================================================================
  // Scenario 4: Security Compromise: Device Revocation during Sync
  // ==========================================================================
  it("Scenario 4: Security Compromise: Device Revocation during Sync", async () => {
    // 1. Instance initialized
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
      createSession: true,
    });
    const profileId = setupRes.body.profileId;

    const loginRes = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: "MasterPassword123!",
    });
    const masterToken = loginRes.body.token;

    // 2. Mobile device logged in (this tablet will be compromised)
    const tabletLogin = await harness.post<{ ok: boolean; deviceToken: string; deviceId: string }>(
      "/api/auth/device-login",
      {
        password: "MasterPassword123!",
        profileId,
        deviceName: "Compromised iPad",
        deviceType: "mobile",
        platform: "ios",
      }
    );
    const tabletToken = tabletLogin.body.deviceToken;
    const tabletDeviceId = tabletLogin.body.deviceId;

    // 3. Tablet syncs normally
    harness.setBearerToken(tabletToken);
    const initialSync = await harness.get("/api/sync/pull?since=0");
    expect(initialSync.status).toBe(200);

    // 4. Tablet is compromised; owner opens Web Console and lists devices
    harness.setBearerToken(masterToken);
    const devicesList = await harness.get<{ ok: boolean; devices: any[] }>("/api/devices");
    expect(devicesList.status).toBe(200);
    const target = devicesList.body.devices.find((d) => d.id === tabletDeviceId);
    expect(target).toBeDefined();
    expect(target.revoked_at).toBeNull();

    // 5. Owner revokes the compromised device
    const revokeRes = await harness.delete<{ ok: boolean; revokedId: string }>(`/api/devices/${tabletDeviceId}`);
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.revokedId).toBe(tabletDeviceId);

    // 6. Tablet attempts to push deltas: immediately blocked with 401
    harness.setBearerToken(tabletToken);
    const blockedPush = await harness.post("/api/sync/push", {
      favorites: [FIXTURE_ANIME_1],
    });
    expect(blockedPush.status).toBe(401);
    expect(blockedPush.body.message).toContain("Invalid or revoked token");

    // 7. Tablet attempts to pull deltas: immediately blocked with 401
    const blockedPull = await harness.get("/api/sync/pull");
    expect(blockedPull.status).toBe(401);
  });

  // ==========================================================================
  // Scenario 5: Full Instance Disaster Recovery: Export -> Wipe -> Import
  // ==========================================================================
  it("Scenario 5: Full Instance Disaster Recovery: Export -> Wipe -> Import", async () => {
    // 1. Setup instance
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
      initialProfileName: "Primary",
      createSession: true,
    });
    const profileId = setupRes.body.profileId;

    const loginRes = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: "MasterPassword123!",
    });
    const masterToken = loginRes.body.token;

    // 2. Populate instance with extensive data
    harness.setBearerToken(masterToken);
    await harness.post("/api/sync/push", {
      favorites: [FIXTURE_ANIME_1, FIXTURE_ANIME_2],
      continueWatching: [FIXTURE_CONTINUE_WATCHING_1, FIXTURE_CONTINUE_WATCHING_2],
      watchHistory: [FIXTURE_WATCH_HISTORY_1],
      watchProgress: [FIXTURE_PROGRESS_1, FIXTURE_PROGRESS_2],
      sharedSettings: { preferredQuality: "1080p", autoplayNext: true },
      searchHistory: [FIXTURE_SEARCH_HISTORY_1],
      deletions: [{ type: "favorite", key: "old-purged-anime", deletedAt: Date.now() }],
    });

    // 3. Export complete disaster recovery backup
    const exportRes = await harness.get<{
      version: number;
      exportedAt: number;
      profiles: any[];
      favorites: any[];
      continueWatching: any[];
      watchHistory: any[];
      watchProgress: any[];
      sharedSettings: any[];
      tombstones: any[];
    }>("/api/sync/export");

    expect(exportRes.status).toBe(200);
    const backup = exportRes.body;
    expect(backup.favorites).toHaveLength(2);
    expect(backup.continueWatching).toHaveLength(2);
    expect(backup.tombstones).toHaveLength(1);

    // 4. Catastrophic disaster: clear all database tables
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);

    // Re-initialize master auth
    await harness.post("/api/setup", {
      masterPassword: "MasterPassword123!",
      initialProfileName: "Temporary",
    });
    const newLoginRes = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: "MasterPassword123!",
    });
    harness.setBearerToken(newLoginRes.body.token);

    // 5. Restore full disaster recovery backup
    const importRes = await harness.post<{ ok: boolean; imported: any }>("/api/sync/import", {
      backup,
    });
    expect(importRes.status).toBe(200);
    expect(importRes.body.ok).toBe(true);

    // 6. Verify full state restoration across all collections
    const favCount = await env.DB.prepare("SELECT COUNT(*) as cnt FROM favorites WHERE profile_id = ?")
      .bind(profileId)
      .first<{ cnt: number }>();
    expect(favCount?.cnt).toBe(2);

    const cwCount = await env.DB.prepare("SELECT COUNT(*) as cnt FROM continue_watching WHERE profile_id = ?")
      .bind(profileId)
      .first<{ cnt: number }>();
    expect(cwCount?.cnt).toBe(2);

    const tombCount = await env.DB.prepare("SELECT COUNT(*) as cnt FROM tombstones WHERE profile_id = ?")
      .bind(profileId)
      .first<{ cnt: number }>();
    expect(tombCount?.cnt).toBe(1);

    // 7. Verify delta pull against restored state using a device bound to the restored profile
    const restoredDevLogin = await harness.post<{ ok: boolean; deviceToken: string }>("/api/auth/device-login", {
      password: "MasterPassword123!",
      profileId,
      deviceName: "Restored Device",
    });
    expect(restoredDevLogin.status).toBe(200);
    harness.setBearerToken(restoredDevLogin.body.deviceToken);

    const postRestorePull = await harness.get<{
      deltas: {
        favorites: AnimeItem[];
        continueWatching: ContinueWatchingItem[];
      };
      tombstones: any[];
    }>(`/api/sync/pull?since=0`);

    expect(postRestorePull.status).toBe(200);
    expect(postRestorePull.body.deltas.favorites).toHaveLength(2);
    expect(postRestorePull.body.deltas.continueWatching).toHaveLength(2);
    expect(postRestorePull.body.tombstones).toHaveLength(1);
  });

  // ==========================================================================
  // Scenario 6: Multi-Profile Library & Settings Isolation
  // ==========================================================================
  it("Scenario 6: Multi-Profile Library & Settings Isolation", async () => {
    // 1. Setup instance with Adults profile
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
      initialProfileName: "Adults",
      createSession: true,
    });
    const adultsProfileId = setupRes.body.profileId;

    const loginRes = await harness.post<{ ok: boolean; token: string }>("/api/auth/login", {
      password: "MasterPassword123!",
    });
    harness.setBearerToken(loginRes.body.token);

    // 2. Create Kids profile
    const kidsProfileRes = await harness.post<{ ok: boolean; profile: { id: string } }>("/api/profiles", {
      name: "Kids",
      avatarColor: "#00E5FF",
    });
    const kidsProfileId = kidsProfileRes.body.profile.id;

    // 3. Issue separate device tokens for each profile
    const adultsLogin = await harness.post<{ ok: boolean; deviceToken: string }>("/api/auth/device-login", {
      password: "MasterPassword123!",
      profileId: adultsProfileId,
      deviceName: "Adults Phone",
    });
    const adultsToken = adultsLogin.body.deviceToken;

    const kidsLogin = await harness.post<{ ok: boolean; deviceToken: string }>("/api/auth/device-login", {
      password: "MasterPassword123!",
      profileId: kidsProfileId,
      deviceName: "Kids Tablet",
    });
    const kidsToken = kidsLogin.body.deviceToken;

    // 4. Adults pushes action anime & 1080p settings
    harness.setBearerToken(adultsToken);
    await harness.post("/api/sync/push", {
      favorites: [FIXTURE_ANIME_1, FIXTURE_ANIME_3],
      sharedSettings: { preferredQuality: "1080p", defaultServer: "StreamAdult" },
      searchHistory: [{ query: "Jujutsu Kaisen", timestamp: Date.now() }],
    });

    // 5. Kids pushes fantasy anime & 720p settings
    harness.setBearerToken(kidsToken);
    await harness.post("/api/sync/push", {
      favorites: [FIXTURE_ANIME_2],
      sharedSettings: { preferredQuality: "720p", defaultServer: "StreamKids" },
      searchHistory: [{ query: "Frieren Adventure", timestamp: Date.now() }],
    });

    // 6. Kids pulls delta: must see ONLY Kids data, ZERO leakage from Adults
    const kidsPull = await harness.get<{
      profile: { name: string };
      deltas: {
        favorites: AnimeItem[];
        sharedSettings: Record<string, any>;
        searchHistory: Array<{ query: string }>;
      };
    }>("/api/sync/pull?since=0");

    expect(kidsPull.status).toBe(200);
    expect(kidsPull.body.profile.name).toBe("Kids");
    expect(kidsPull.body.deltas.favorites).toHaveLength(1);
    expect(kidsPull.body.deltas.favorites[0].id).toBe(FIXTURE_ANIME_2.id);
    expect(kidsPull.body.deltas.favorites.some((f) => f.id === FIXTURE_ANIME_3.id)).toBe(false);
    expect(kidsPull.body.deltas.sharedSettings.preferredQuality).toBe("720p");
    expect(kidsPull.body.deltas.searchHistory.some((s) => s.query === "Jujutsu Kaisen")).toBe(false);

    // 7. Adults pulls delta: must see ONLY Adults data, ZERO leakage from Kids
    harness.setBearerToken(adultsToken);
    const adultsPull = await harness.get<{
      profile: { name: string };
      deltas: {
        favorites: AnimeItem[];
        sharedSettings: Record<string, any>;
        searchHistory: Array<{ query: string }>;
      };
    }>("/api/sync/pull?since=0");

    expect(adultsPull.status).toBe(200);
    expect(adultsPull.body.profile.name).toBe("Adults");
    expect(adultsPull.body.deltas.favorites).toHaveLength(2);
    expect(adultsPull.body.deltas.favorites.some((f) => f.id === FIXTURE_ANIME_2.id)).toBe(false);
    expect(adultsPull.body.deltas.sharedSettings.preferredQuality).toBe("1080p");
  });
});
