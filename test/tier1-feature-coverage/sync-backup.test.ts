/**
 * Tier 1 Feature Coverage: Delta Sync Protocol & Disaster Recovery Backup Suite
 *
 * Covers Features 12 to 16 (25 tests total, 5 tests per feature):
 * - Feature 12: Delta Sync Pull (GET /api/sync/pull) [5 tests]
 * - Feature 13: Delta Sync Push Batch (POST /api/sync/push) [5 tests]
 * - Feature 14: LWW & Tombstone Dominance [5 tests]
 * - Feature 15: Timeline Progress Safeguard [5 tests]
 * - Feature 16: Backup Export & Import [5 tests]
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
  FIXTURE_PROGRESS_2,
  FIXTURE_CONTINUE_WATCHING_1,
  FIXTURE_CONTINUE_WATCHING_2,
  FIXTURE_WATCH_HISTORY_1,
  FIXTURE_ANISKIP_SETTINGS,
  FIXTURE_SEARCH_HISTORY_1,
  FIXTURE_PROFILE_PRIMARY,
  FIXTURE_PROFILE_SECONDARY,
} from "../helpers/fixtures";

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const TEST_TOKEN_1 = "kuro_dev_test_token_primary_123456";
const TEST_TOKEN_2 = "kuro_dev_test_token_secondary_789012";

async function seedAuthContext(
  db: D1Database,
  profileId = FIXTURE_PROFILE_PRIMARY.id,
  profileName = FIXTURE_PROFILE_PRIMARY.name,
  token = TEST_TOKEN_1
): Promise<void> {
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await db.batch([
    db.prepare(`
      INSERT INTO profiles (id, name, avatar_color, created_at, updated_at)
      VALUES (?, ?, '#E50914', ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name
    `).bind(profileId, profileName, now, now),
    db.prepare(`
      INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at)
      VALUES (?, ?, 'Test Device', 'mobile', 'android', ?, ?, ?)
    `).bind(crypto.randomUUID(), profileId, tokenHash, now, now),
  ]);
}

describe("Tier 1: Delta Sync Pull (Feature 12)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    await seedAuthContext(env.DB);
    harness = new TestHarness();
    harness.setBearerToken(TEST_TOKEN_1);
  });

  it("12.1 GET /api/sync/pull with since=0 performs full bootstrap pull returning all entities", async () => {
    // Push some initial data
    await harness.post("/api/sync/push", {
      favorites: [FIXTURE_ANIME_1],
      continueWatching: [FIXTURE_CONTINUE_WATCHING_1],
      watchProgress: [FIXTURE_PROGRESS_1],
    });

    const res = await harness.get<{
      serverTime: number;
      profile: { id: string; name: string };
      deltas: {
        favorites: any[];
        continueWatching: any[];
        watchProgress: any[];
      };
      tombstones: any[];
    }>("/api/sync/pull?since=0");

    expect(res.status).toBe(200);
    expect(res.body.serverTime).toBeDefined();
    expect(res.body.profile.id).toBe(FIXTURE_PROFILE_PRIMARY.id);
    expect(res.body.deltas.favorites).toHaveLength(1);
    expect(res.body.deltas.favorites[0].id).toBe(FIXTURE_ANIME_1.id);
    expect(res.body.deltas.continueWatching).toHaveLength(1);
    expect(res.body.deltas.continueWatching[0].animeId).toBe(FIXTURE_CONTINUE_WATCHING_1.animeId);
    expect(res.body.deltas.watchProgress).toHaveLength(1);
  });

  it("12.2 GET /api/sync/pull?since=<ts> returns only entities updated strictly after <ts>", async () => {
    const t0 = 1700000000000;
    const t1 = 1700001000000;

    await harness.post("/api/sync/push", {
      favorites: [
        { ...FIXTURE_ANIME_1, updatedAt: t0 },
        { ...FIXTURE_ANIME_2, updatedAt: t1 },
      ],
    });

    const res = await harness.get<{ deltas: { favorites: any[] } }>(
      `/api/sync/pull?since=${t0}`
    );

    expect(res.status).toBe(200);
    expect(res.body.deltas.favorites).toHaveLength(1);
    expect(res.body.deltas.favorites[0].id).toBe(FIXTURE_ANIME_2.id);
  });

  it("12.3 GET /api/sync/pull?since=<ts> returns tombstones deleted after <ts>", async () => {
    const t0 = 1700000000000;
    const t1 = 1700001000000;

    // Delete item at t1
    await harness.post("/api/sync/push", {
      deletions: [{ type: "favorite", key: "deleted-anime-99", deletedAt: t1 }],
    });

    const res = await harness.get<{ tombstones: any[] }>(`/api/sync/pull?since=${t0}`);

    expect(res.status).toBe(200);
    expect(res.body.tombstones).toHaveLength(1);
    expect(res.body.tombstones[0].key).toBe("deleted-anime-99");
    expect(res.body.tombstones[0].deletedAt).toBe(t1);
  });

  it("12.4 GET /api/sync/pull enforces multi-profile isolation", async () => {
    // Seed Profile 2 and push data to Profile 2
    await seedAuthContext(env.DB, FIXTURE_PROFILE_SECONDARY.id, FIXTURE_PROFILE_SECONDARY.name, TEST_TOKEN_2);

    const harness2 = new TestHarness();
    harness2.setBearerToken(TEST_TOKEN_2);
    await harness2.post("/api/sync/push", {
      favorites: [FIXTURE_ANIME_2],
    });

    // Profile 1 should not see Profile 2's data
    const res1 = await harness.get<{ deltas: { favorites: any[] } }>("/api/sync/pull?since=0");
    expect(res1.body.deltas.favorites).toHaveLength(0);

    // Profile 2 should see Profile 2's data
    const res2 = await harness2.get<{ deltas: { favorites: any[] } }>("/api/sync/pull?since=0");
    expect(res2.body.deltas.favorites).toHaveLength(1);
    expect(res2.body.deltas.favorites[0].id).toBe(FIXTURE_ANIME_2.id);
  });

  it("12.5 GET /api/sync/pull on clean database returns 200 with empty arrays, profile info, and serverTime", async () => {
    const res = await harness.get<{
      serverTime: number;
      profile: { id: string; name: string };
      deltas: Record<string, any[]>;
      tombstones: any[];
    }>("/api/sync/pull?since=0");

    expect(res.status).toBe(200);
    expect(typeof res.body.serverTime).toBe("number");
    expect(res.body.profile.id).toBe(FIXTURE_PROFILE_PRIMARY.id);
    expect(res.body.deltas.favorites).toEqual([]);
    expect(res.body.deltas.continueWatching).toEqual([]);
    expect(res.body.deltas.watchHistory).toEqual([]);
    expect(res.body.deltas.watchProgress).toEqual([]);
    expect(res.body.tombstones).toEqual([]);
  });
});

describe("Tier 1: Delta Sync Push Batch (Feature 13)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    await seedAuthContext(env.DB);
    harness = new TestHarness();
    harness.setBearerToken(TEST_TOKEN_1);
  });

  it("13.1 POST /api/sync/push atomically inserts heterogeneous batch", async () => {
    const res = await harness.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
      favorites: [FIXTURE_ANIME_1],
      continueWatching: [FIXTURE_CONTINUE_WATCHING_1],
      watchHistory: [FIXTURE_WATCH_HISTORY_1],
      watchProgress: [FIXTURE_PROGRESS_1],
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.appliedCount).toBe(4);

    const favCount = await env.DB.prepare("SELECT count(*) as c FROM favorites").first<{ c: number }>();
    const cwCount = await env.DB.prepare("SELECT count(*) as c FROM continue_watching").first<{ c: number }>();
    const whCount = await env.DB.prepare("SELECT count(*) as c FROM watch_history").first<{ c: number }>();
    const wpCount = await env.DB.prepare("SELECT count(*) as c FROM watch_progress").first<{ c: number }>();

    expect(favCount?.c).toBe(1);
    expect(cwCount?.c).toBe(1);
    expect(whCount?.c).toBe(1);
    expect(wpCount?.c).toBe(1);
  });

  it("13.2 POST /api/sync/push records are immediately persistent and retrievable via GET /api/sync/pull", async () => {
    await harness.post("/api/sync/push", {
      favorites: [FIXTURE_ANIME_1],
    });

    const pullRes = await harness.get<{ deltas: { favorites: any[] } }>("/api/sync/pull?since=0");
    expect(pullRes.status).toBe(200);
    expect(pullRes.body.deltas.favorites).toHaveLength(1);
    expect(pullRes.body.deltas.favorites[0].title).toBe("Solo Leveling");
  });

  it("13.3 POST /api/sync/push successfully persists shared settings and search history items", async () => {
    const res = await harness.post<{ ok: boolean }>("/api/sync/push", {
      sharedSettings: {
        aniSkipSettings: FIXTURE_ANISKIP_SETTINGS,
        preferredQuality: "1080p",
      },
      searchHistory: [FIXTURE_SEARCH_HISTORY_1],
    });

    expect(res.status).toBe(200);

    const pullRes = await harness.get<{
      deltas: { sharedSettings: any; searchHistory: any[] };
    }>("/api/sync/pull?since=0");

    expect(pullRes.body.deltas.sharedSettings.aniSkipSettings).toEqual(FIXTURE_ANISKIP_SETTINGS);
    expect(pullRes.body.deltas.sharedSettings.preferredQuality).toBe("1080p");
    expect(pullRes.body.deltas.searchHistory).toHaveLength(1);
    expect(pullRes.body.deltas.searchHistory[0].query).toBe("Solo Leveling");
  });

  it("13.4 POST /api/sync/push handles large batch up to 50 operations within D1 free tier limits", async () => {
    const manyFavorites: any[] = [];
    for (let i = 0; i < 40; i++) {
      manyFavorites.push({
        ...FIXTURE_ANIME_1,
        id: `bulk-anime-${i}`,
        title: `Bulk Anime ${i}`,
        updatedAt: 1700000000000 + i,
      });
    }

    const res = await harness.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
      favorites: manyFavorites,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.appliedCount).toBe(40);

    const count = await env.DB.prepare("SELECT count(*) as c FROM favorites").first<{ c: number }>();
    expect(count?.c).toBe(40);
  });

  it("13.5 POST /api/sync/push with empty payload {} returns 200 { ok: true, appliedCount: 0 }", async () => {
    const res = await harness.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.appliedCount).toBe(0);
  });
});

describe("Tier 1: LWW & Tombstone Dominance (Feature 14)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    await seedAuthContext(env.DB);
    harness = new TestHarness();
    harness.setBearerToken(TEST_TOKEN_1);
  });

  it("14.1 Pushing deletion creates tombstone and removes row from entity table", async () => {
    // Insert favorite
    await harness.post("/api/sync/push", { favorites: [FIXTURE_ANIME_1] });

    // Push deletion
    const delRes = await harness.post<{ ok: boolean }>("/api/sync/push", {
      deletions: [{ type: "favorite", key: FIXTURE_ANIME_1.id, deletedAt: 1700000500000 }],
    });
    expect(delRes.status).toBe(200);

    // Entity deleted
    const favCount = await env.DB.prepare("SELECT count(*) as c FROM favorites").first<{ c: number }>();
    expect(favCount?.c).toBe(0);

    // Tombstone created
    const tomb = await env.DB.prepare(
      "SELECT * FROM tombstones WHERE entity_type = 'favorite' AND entity_key = ?"
    )
      .bind(FIXTURE_ANIME_1.id)
      .first<{ deleted_at: number }>();

    expect(tomb).toBeDefined();
    expect(tomb?.deleted_at).toBe(1700000500000);
  });

  it("14.2 Tombstone dominance drops incoming push where updatedAt <= deleted_at (no resurrection)", async () => {
    const deleteTime = 1700001000000;
    await harness.post("/api/sync/push", {
      deletions: [{ type: "favorite", key: FIXTURE_ANIME_1.id, deletedAt: deleteTime }],
    });

    // Stale push with older timestamp
    await harness.post("/api/sync/push", {
      favorites: [{ ...FIXTURE_ANIME_1, updatedAt: deleteTime - 5000 }],
    });

    const favCount = await env.DB.prepare("SELECT count(*) as c FROM favorites").first<{ c: number }>();
    expect(favCount?.c).toBe(0);
  });

  it("14.3 Legitimate re-addition: pushing entity with updatedAt > deleted_at restores item", async () => {
    const deleteTime = 1700001000000;
    await harness.post("/api/sync/push", {
      deletions: [{ type: "favorite", key: FIXTURE_ANIME_1.id, deletedAt: deleteTime }],
    });

    // Newer push restores item
    const restoreTime = deleteTime + 5000;
    await harness.post("/api/sync/push", {
      favorites: [{ ...FIXTURE_ANIME_1, updatedAt: restoreTime }],
    });

    const fav = await env.DB.prepare("SELECT * FROM favorites WHERE anime_id = ?")
      .bind(FIXTURE_ANIME_1.id)
      .first<any>();

    expect(fav).toBeDefined();
    expect(fav?.updated_at).toBe(restoreTime);
  });

  it("14.4 Last-Write-Wins: pushing stale update (updatedAt < current updated_at) is discarded", async () => {
    const tRecent = 1700002000000;
    const tStale = 1700001000000;

    await harness.post("/api/sync/push", {
      favorites: [{ ...FIXTURE_ANIME_1, title: "Solo Leveling - Newer Title", updatedAt: tRecent }],
    });

    // Stale update
    await harness.post("/api/sync/push", {
      favorites: [{ ...FIXTURE_ANIME_1, title: "Solo Leveling - Stale Old Title", updatedAt: tStale }],
    });

    const fav = await env.DB.prepare("SELECT title FROM favorites WHERE anime_id = ?")
      .bind(FIXTURE_ANIME_1.id)
      .first<{ title: string }>();

    expect(fav?.title).toBe("Solo Leveling - Newer Title");
  });

  it("14.5 Tombstones are propagated via GET /api/sync/pull?since=<ts> for peer client deletion", async () => {
    const t0 = 1700000000000;
    const tDel = 1700001000000;

    await harness.post("/api/sync/push", {
      deletions: [{ type: "continue_watching", key: "cw-del-key", deletedAt: tDel }],
    });

    const pull = await harness.get<{ tombstones: any[] }>(`/api/sync/pull?since=${t0}`);
    expect(pull.body.tombstones).toHaveLength(1);
    expect(pull.body.tombstones[0].type).toBe("continue_watching");
    expect(pull.body.tombstones[0].key).toBe("cw-del-key");
  });
});

describe("Tier 1: Timeline Progress Safeguard (Feature 15)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    await seedAuthContext(env.DB);
    harness = new TestHarness();
    harness.setBearerToken(TEST_TOKEN_1);
  });

  it("15.1 Lower playback progress does not regress higher existing playback progress", async () => {
    // Initial higher progress
    await harness.post("/api/sync/push", {
      watchProgress: [{ ...FIXTURE_PROGRESS_1, currentTime: 1200, percentage: 85.0 }],
    });

    // Concurrent push with lower progress
    await harness.post("/api/sync/push", {
      watchProgress: [{ ...FIXTURE_PROGRESS_1, currentTime: 600, percentage: 42.0 }],
    });

    const row = await env.DB.prepare(
      'SELECT "current_time", percentage FROM watch_progress WHERE anime_id = ? AND episode_number = ?'
    )
      .bind(FIXTURE_PROGRESS_1.animeId, FIXTURE_PROGRESS_1.episodeNumber)
      .first<{ current_time: number; percentage: number }>();

    expect(row?.current_time).toBe(1200);
    expect(row?.percentage).toBe(85.0);
  });

  it("15.2 Higher playback progress successfully updates lower existing playback progress", async () => {
    await harness.post("/api/sync/push", {
      watchProgress: [{ ...FIXTURE_PROGRESS_1, currentTime: 500, percentage: 35.0, updatedAt: 1000 }],
    });

    await harness.post("/api/sync/push", {
      watchProgress: [{ ...FIXTURE_PROGRESS_1, currentTime: 950, percentage: 67.0, updatedAt: 2000 }],
    });

    const row = await env.DB.prepare(
      'SELECT "current_time", percentage FROM watch_progress WHERE anime_id = ? AND episode_number = ?'
    )
      .bind(FIXTURE_PROGRESS_1.animeId, FIXTURE_PROGRESS_1.episodeNumber)
      .first<{ current_time: number; percentage: number }>();

    expect(row?.current_time).toBe(950);
    expect(row?.percentage).toBe(67.0);
  });

  it("15.3 Completed state preservation: update with isCompleted: false cannot un-complete isCompleted: true", async () => {
    await harness.post("/api/sync/push", {
      watchProgress: [{ ...FIXTURE_PROGRESS_1, isCompleted: true }],
    });

    // Push with isCompleted = false
    await harness.post("/api/sync/push", {
      watchProgress: [{ ...FIXTURE_PROGRESS_1, isCompleted: false }],
    });

    const row = await env.DB.prepare(
      "SELECT is_completed FROM watch_progress WHERE anime_id = ? AND episode_number = ?"
    )
      .bind(FIXTURE_PROGRESS_1.animeId, FIXTURE_PROGRESS_1.episodeNumber)
      .first<{ is_completed: number }>();

    expect(row?.is_completed).toBe(1);
  });

  it("15.4 Episode completion update: update with isCompleted: true transitions incomplete episode to completed", async () => {
    await harness.post("/api/sync/push", {
      watchProgress: [{ ...FIXTURE_PROGRESS_2, isCompleted: false, updatedAt: 1000 }],
    });

    await harness.post("/api/sync/push", {
      watchProgress: [{ ...FIXTURE_PROGRESS_2, isCompleted: true, updatedAt: 2000 }],
    });

    const row = await env.DB.prepare(
      "SELECT is_completed FROM watch_progress WHERE anime_id = ? AND episode_number = ?"
    )
      .bind(FIXTURE_PROGRESS_2.animeId, FIXTURE_PROGRESS_2.episodeNumber)
      .first<{ is_completed: number }>();

    expect(row?.is_completed).toBe(1);
  });

  it("15.5 Continue watching position safeguard: preserves higher playback position and percentage", async () => {
    await harness.post("/api/sync/push", {
      continueWatching: [
        { ...FIXTURE_CONTINUE_WATCHING_1, episodeNumber: 5, position: 1200, percentage: 80.0 },
      ],
    });

    // Pushed with same episode but lower position
    await harness.post("/api/sync/push", {
      continueWatching: [
        { ...FIXTURE_CONTINUE_WATCHING_1, episodeNumber: 5, position: 400, percentage: 26.0 },
      ],
    });

    const row = await env.DB.prepare(
      "SELECT position, percentage FROM continue_watching WHERE anime_id = ?"
    )
      .bind(FIXTURE_CONTINUE_WATCHING_1.animeId)
      .first<{ position: number; percentage: number }>();

    expect(row?.position).toBe(1200);
    expect(row?.percentage).toBe(80.0);
  });
});

describe("Tier 1: Backup Export & Import (Feature 16)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    await seedAuthContext(env.DB);
    harness = new TestHarness();
    harness.setBearerToken(TEST_TOKEN_1);
  });

  it("16.1 GET /api/sync/export returns complete JSON backup with metadata, profiles, and all collections", async () => {
    await harness.post("/api/sync/push", {
      favorites: [FIXTURE_ANIME_1],
      continueWatching: [FIXTURE_CONTINUE_WATCHING_1],
      watchHistory: [FIXTURE_WATCH_HISTORY_1],
    });

    const res = await harness.get<any>("/api/sync/export");
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.exportedAt).toBeDefined();
    expect(res.body.profiles.length).toBeGreaterThanOrEqual(1);
    expect(res.body.favorites).toHaveLength(1);
    expect(res.body.continueWatching).toHaveLength(1);
    expect(res.body.watchHistory).toHaveLength(1);
  });

  it("16.2 Full disaster recovery round-trip: export -> truncate DB -> import restores identical state", async () => {
    await harness.post("/api/sync/push", {
      favorites: [FIXTURE_ANIME_1, FIXTURE_ANIME_2],
      continueWatching: [FIXTURE_CONTINUE_WATCHING_1],
      watchProgress: [FIXTURE_PROGRESS_1],
    });

    // 1. Export
    const exportRes = await harness.get<any>("/api/sync/export");
    expect(exportRes.status).toBe(200);
    const backupData = exportRes.body;

    // 2. Wipe database
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    await seedAuthContext(env.DB); // reseed auth token to call import

    // 3. Import
    const importRes = await harness.post<any>("/api/sync/import", backupData);
    expect(importRes.status).toBe(200);
    expect(importRes.body.ok).toBe(true);

    // 4. Verify restored counts
    const favCount = await env.DB.prepare("SELECT count(*) as c FROM favorites").first<{ c: number }>();
    const cwCount = await env.DB.prepare("SELECT count(*) as c FROM continue_watching").first<{ c: number }>();
    const wpCount = await env.DB.prepare("SELECT count(*) as c FROM watch_progress").first<{ c: number }>();

    expect(favCount?.c).toBe(2);
    expect(cwCount?.c).toBe(1);
    expect(wpCount?.c).toBe(1);
  });

  it("16.3 Multi-profile backup import restores multiple profiles and preserves profile associations", async () => {
    const multiProfileBackup = {
      version: 1,
      profiles: [
        { id: "prof-a", name: "Profile A", avatar_color: "#E50914" },
        { id: "prof-b", name: "Profile B", avatar_color: "#3B82F6" },
      ],
      favorites: [
        { profile_id: "prof-a", anime_id: "anime-a", title: "Anime A", thumbnail: "thumb.jpg", link: "link" },
        { profile_id: "prof-b", anime_id: "anime-b", title: "Anime B", thumbnail: "thumb.jpg", link: "link" },
      ],
    };

    const res = await harness.post<any>("/api/sync/import", multiProfileBackup);
    expect(res.status).toBe(200);

    const profACount = await env.DB.prepare("SELECT count(*) as c FROM favorites WHERE profile_id = 'prof-a'").first<{ c: number }>();
    const profBCount = await env.DB.prepare("SELECT count(*) as c FROM favorites WHERE profile_id = 'prof-b'").first<{ c: number }>();

    expect(profACount?.c).toBe(1);
    expect(profBCount?.c).toBe(1);
  });

  it("16.4 Selective profile export: GET /api/sync/export?profileId=<id> exports only target profile", async () => {
    // Seed Profile 2 and push
    await seedAuthContext(env.DB, "prof-target-2", "Target 2", TEST_TOKEN_2);
    const h2 = new TestHarness();
    h2.setBearerToken(TEST_TOKEN_2);

    await harness.post("/api/sync/push", { favorites: [FIXTURE_ANIME_1] });
    await h2.post("/api/sync/push", { favorites: [FIXTURE_ANIME_2] });

    const exportRes = await h2.get<any>(`/api/sync/export?profileId=prof-target-2`);
    expect(exportRes.status).toBe(200);
    expect(exportRes.body.favorites).toHaveLength(1);
    expect(exportRes.body.favorites[0].anime_id).toBe(FIXTURE_ANIME_2.id);
  });

  it("16.5 Import idempotency: importing identical backup twice succeeds without duplicate key errors", async () => {
    const backupData = {
      version: 1,
      profiles: [{ id: "prof-idemp-1", name: "Idempotent User" }],
      favorites: [
        { profile_id: "prof-idemp-1", anime_id: "anime-idemp-1", title: "Test", thumbnail: "t", link: "l" },
      ],
    };

    const firstImport = await harness.post<any>("/api/sync/import", backupData);
    expect(firstImport.status).toBe(200);

    const secondImport = await harness.post<any>("/api/sync/import", backupData);
    expect(secondImport.status).toBe(200);
    expect(secondImport.body.ok).toBe(true);
  });
});
