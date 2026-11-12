/**
 * Tier 2 Boundary & Corner Cases: Delta Sync Protocol Suite
 *
 * Covers boundary, edge, and corner cases for:
 * - Slicing db.batch() under Free Tier limits (exact 50, >50, 120 items)
 * - Clock skew (future timestamps vs serverTime)
 * - Last-Write-Wins (LWW) & Tombstone Dominance (older push dropped, newer resurrects)
 * - Timeline Progress Safeguard (higher percentage, isCompleted=true preservation)
 * - Continue Watching Episode Regression Prevention
 * - Query Parameter Boundaries (empty, negative, non-numeric, future `since`)
 * - Multi-profile Data Isolation during Sync
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
import type {
  AnimeItem,
  ContinueWatchingItem,
  WatchProgressItem,
  WatchHistoryItem,
} from "@kurosync/sync-client";

describe("Tier 2: Delta Sync Boundary & Corner Cases", () => {
  let harness: TestHarness;
  let profile1Id: string;
  let profile2Id: string;
  let token1: string;
  let token2: string;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();

    // 1. Initial setup with Profile 1
    const setupRes = await harness.post<{ ok: boolean; profileId: string }>("/api/setup", {
      masterPassword: "MasterPassword123!",
      initialProfileName: "Primary Profile",
      createSession: true,
    });
    profile1Id = setupRes.body.profileId;

    // Login device for Profile 1
    const dev1Res = await harness.post<{ ok: boolean; deviceToken: string }>("/api/auth/device-login", {
      password: "MasterPassword123!",
      profileId: profile1Id,
      deviceName: "Mobile Device 1",
    });
    token1 = dev1Res.body.deviceToken;

    // 2. Create Profile 2
    harness.setBearerToken(token1);
    const prof2Res = await harness.post<{ ok: boolean; profile: { id: string } }>("/api/profiles", {
      name: "Secondary Profile",
      avatarColor: "#00E5FF",
    });
    profile2Id = prof2Res.body.profile.id;

    // Login device for Profile 2
    harness.clearAuth();
    const dev2Res = await harness.post<{ ok: boolean; deviceToken: string }>("/api/auth/device-login", {
      password: "MasterPassword123!",
      profileId: profile2Id,
      deviceName: "Mobile Device 2",
    });
    token2 = dev2Res.body.deviceToken;
  });

  // ==========================================================================
  // 1. Batch Chunking Boundaries (<= 50 queries per invocation)
  // ==========================================================================
  describe("1. Batch Chunking Boundaries (db.batch <= 50 limit)", () => {
    it("1.1 pushes exactly 50 items in a single push without error", async () => {
      harness.setBearerToken(token1);

      // Create exactly 50 favorites
      const favorites: AnimeItem[] = [];
      const baseTime = Date.now();
      for (let i = 0; i < 50; i++) {
        favorites.push({
          ...FIXTURE_ANIME_1,
          id: `anime-batch-50-${i}`,
          title: `Anime Title ${i}`,
          updatedAt: baseTime + i,
        });
      }

      const res = await harness.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
        favorites,
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.appliedCount).toBe(50);

      // Verify all 50 exist in D1
      const countRes = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM favorites WHERE profile_id = ?"
      )
        .bind(profile1Id)
        .first<{ cnt: number }>();
      expect(countRes?.cnt).toBe(50);
    });

    it("1.2 pushes 75 items chunked into multiple db.batch() slices (> 50 queries)", async () => {
      harness.setBearerToken(token1);

      const favorites: AnimeItem[] = [];
      const baseTime = Date.now();
      for (let i = 0; i < 75; i++) {
        favorites.push({
          ...FIXTURE_ANIME_1,
          id: `anime-chunk-75-${i}`,
          title: `Chunk Anime ${i}`,
          updatedAt: baseTime + i,
        });
      }

      const res = await harness.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
        favorites,
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.appliedCount).toBe(75);

      const countRes = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM favorites WHERE profile_id = ?"
      )
        .bind(profile1Id)
        .first<{ cnt: number }>();
      expect(countRes?.cnt).toBe(75);
    });

    it("1.3 pushes 120 items across multiple entity types (deletions, favorites, progress)", async () => {
      harness.setBearerToken(token1);

      // 40 favorites
      const favorites: AnimeItem[] = [];
      for (let i = 0; i < 40; i++) {
        favorites.push({
          ...FIXTURE_ANIME_1,
          id: `anime-multi-120-${i}`,
          title: `Multi Anime ${i}`,
          updatedAt: Date.now(),
        });
      }

      // 40 watch progress items
      const watchProgress: WatchProgressItem[] = [];
      for (let i = 0; i < 40; i++) {
        watchProgress.push({
          animeId: `anime-multi-120-${i}`,
          animeTitle: `Multi Anime ${i}`,
          thumbnail: `https://example.com/thumb-${i}.jpg`,
          episodeId: `ep-${i}`,
          episodeNumber: 1,
          currentTime: 300,
          duration: 1400,
          percentage: 21.4,
          isCompleted: false,
          updatedAt: Date.now(),
        });
      }

      // 40 deletions
      const deletions = [];
      for (let i = 0; i < 40; i++) {
        deletions.push({
          type: "favorite",
          key: `old-deleted-anime-${i}`,
          deletedAt: Date.now(),
        });
      }

      // Total statements: 40 favorites + 40 progress + 80 deletion statements (tombstone + delete) = 160 statements!
      const res = await harness.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
        favorites,
        watchProgress,
        deletions,
      });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.appliedCount).toBe(120);

      const favCount = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM favorites WHERE profile_id = ?"
      )
        .bind(profile1Id)
        .first<{ cnt: number }>();
      expect(favCount?.cnt).toBe(40);

      const progCount = await env.DB.prepare(
        "SELECT COUNT(*) as cnt FROM watch_progress WHERE profile_id = ?"
      )
        .bind(profile1Id)
        .first<{ cnt: number }>();
      expect(progCount?.cnt).toBe(40);
    });
  });

  // ==========================================================================
  // 2. Clock Skew & Future Timestamp Handling
  // ==========================================================================
  describe("2. Clock Skew & Future Timestamp Boundaries", () => {
    it("2.1 correctly stores and preserves future updatedAt timestamps", async () => {
      harness.setBearerToken(token1);
      const futureTime = Date.now() + 86400000; // +24 hours into future

      const item: AnimeItem = {
        ...FIXTURE_ANIME_1,
        id: "anime-future-skew",
        updatedAt: futureTime,
      };

      const pushRes = await harness.post("/api/sync/push", { favorites: [item] });
      expect(pushRes.status).toBe(200);

      const row = await env.DB.prepare(
        "SELECT updated_at FROM favorites WHERE profile_id = ? AND anime_id = ?"
      )
        .bind(profile1Id, "anime-future-skew")
        .first<{ updated_at: number }>();

      expect(row?.updated_at).toBe(futureTime);

      // Delta pull with current time should return this future item
      const pullRes = await harness.get<{ deltas: { favorites: AnimeItem[] } }>(
        `/api/sync/pull?since=${Date.now()}`
      );
      expect(pullRes.status).toBe(200);
      expect(pullRes.body.deltas.favorites.some((f) => f.id === "anime-future-skew")).toBe(true);
    });
  });

  // ==========================================================================
  // 3. Tombstone Dominance & Resurrection Boundaries
  // ==========================================================================
  describe("3. Tombstone Dominance & Resurrection Boundaries", () => {
    const animeId = "anime-tombstone-test";
    const deletionTime = 1700005000000;

    beforeEach(async () => {
      harness.setBearerToken(token1);
      // Create deletion tombstone
      await harness.post("/api/sync/push", {
        deletions: [{ type: "favorite", key: animeId, deletedAt: deletionTime }],
      });
    });

    it("3.1 pushing an entity with timestamp older than tombstone does NOT resurrect it", async () => {
      const olderTime = deletionTime - 10000;
      const res = await harness.post<{ ok: boolean; applied: number }>("/api/sync/push", {
        favorites: [{ ...FIXTURE_ANIME_1, id: animeId, updatedAt: olderTime }],
      });

      expect(res.status).toBe(200);

      // Verify entity was NOT created in favorites
      const row = await env.DB.prepare(
        "SELECT * FROM favorites WHERE profile_id = ? AND anime_id = ?"
      )
        .bind(profile1Id, animeId)
        .first();
      expect(row).toBeNull();
    });

    it("3.2 pushing an entity with timestamp equal to tombstone does NOT resurrect it", async () => {
      const res = await harness.post<{ ok: boolean; applied: number }>("/api/sync/push", {
        favorites: [{ ...FIXTURE_ANIME_1, id: animeId, updatedAt: deletionTime }],
      });

      expect(res.status).toBe(200);

      const row = await env.DB.prepare(
        "SELECT * FROM favorites WHERE profile_id = ? AND anime_id = ?"
      )
        .bind(profile1Id, animeId)
        .first();
      expect(row).toBeNull();
    });

    it("3.3 pushing an entity with timestamp strictly newer than tombstone DOES resurrect it and clears tombstone", async () => {
      const newerTime = deletionTime + 5000;
      const res = await harness.post<{ ok: boolean; applied: number }>("/api/sync/push", {
        favorites: [{ ...FIXTURE_ANIME_1, id: animeId, updatedAt: newerTime }],
      });

      expect(res.status).toBe(200);

      // Entity should now exist
      const row = await env.DB.prepare(
        "SELECT * FROM favorites WHERE profile_id = ? AND anime_id = ?"
      )
        .bind(profile1Id, animeId)
        .first();
      expect(row).toBeDefined();

      // Tombstone should have been cleared
      const tomb = await env.DB.prepare(
        "SELECT * FROM tombstones WHERE profile_id = ? AND entity_type = 'favorite' AND entity_key = ?"
      )
        .bind(profile1Id, animeId)
        .first();
      expect(tomb).toBeNull();
    });
  });

  // ==========================================================================
  // 4. Progress Safeguard & Regression Prevention
  // ==========================================================================
  describe("4. Progress Safeguard & Regression Prevention", () => {
    it("4.1 watch_progress preserves higher percentage when lower progress is pushed", async () => {
      harness.setBearerToken(token1);
      const baseTime = Date.now();

      // Initial push: 85% progress
      await harness.post("/api/sync/push", {
        watchProgress: [
          {
            ...FIXTURE_PROGRESS_1,
            animeId: "anime-prog-safeguard",
            episodeNumber: 1,
            percentage: 85.0,
            currentTime: 850,
            duration: 1000,
            isCompleted: false,
            updatedAt: baseTime,
          },
        ],
      });

      // Subsequent push: lower progress (40%) with newer timestamp
      await harness.post("/api/sync/push", {
        watchProgress: [
          {
            ...FIXTURE_PROGRESS_1,
            animeId: "anime-prog-safeguard",
            episodeNumber: 1,
            percentage: 40.0,
            currentTime: 400,
            duration: 1000,
            isCompleted: false,
            updatedAt: baseTime + 1000,
          },
        ],
      });

      // Verify D1 preserved 85%
      const row = await env.DB.prepare(
        "SELECT percentage, watch_progress.current_time FROM watch_progress WHERE profile_id = ? AND anime_id = ? AND episode_number = 1"
      )
        .bind(profile1Id, "anime-prog-safeguard")
        .first<{ percentage: number; current_time: number }>();

      expect(row?.percentage).toBe(85.0);
      expect(row?.current_time).toBe(850);
    });

    it("4.2 watch_progress preserves isCompleted = true when uncompleted progress is pushed", async () => {
      harness.setBearerToken(token1);
      const baseTime = Date.now();

      // Set completed = true
      await harness.post("/api/sync/push", {
        watchProgress: [
          {
            ...FIXTURE_PROGRESS_1,
            animeId: "anime-completed-safeguard",
            episodeNumber: 1,
            percentage: 100.0,
            currentTime: 1000,
            duration: 1000,
            isCompleted: true,
            updatedAt: baseTime,
          },
        ],
      });

      // Subsequent push: isCompleted = false
      await harness.post("/api/sync/push", {
        watchProgress: [
          {
            ...FIXTURE_PROGRESS_1,
            animeId: "anime-completed-safeguard",
            episodeNumber: 1,
            percentage: 90.0,
            currentTime: 900,
            duration: 1000,
            isCompleted: false,
            updatedAt: baseTime + 1000,
          },
        ],
      });

      const row = await env.DB.prepare(
        "SELECT is_completed FROM watch_progress WHERE profile_id = ? AND anime_id = ? AND episode_number = 1"
      )
        .bind(profile1Id, "anime-completed-safeguard")
        .first<{ is_completed: number }>();

      expect(row?.is_completed).toBe(1);
    });

    it("4.3 continue_watching does NOT regress to older update when stale timestamp is pushed", async () => {
      harness.setBearerToken(token1);
      const baseTime = Date.now();

      // Currently watching episode 5
      await harness.post("/api/sync/push", {
        continueWatching: [
          {
            ...FIXTURE_CONTINUE_WATCHING_1,
            animeId: "anime-cw-safeguard",
            episodeNumber: 5,
            position: 600,
            duration: 1200,
            percentage: 50.0,
            updatedAt: baseTime,
          },
        ],
      });

      // Another device attempts to push stale update (e.g. offline cache sync) with older timestamp
      await harness.post("/api/sync/push", {
        continueWatching: [
          {
            ...FIXTURE_CONTINUE_WATCHING_1,
            animeId: "anime-cw-safeguard",
            episodeNumber: 2,
            position: 300,
            duration: 1200,
            percentage: 25.0,
            updatedAt: baseTime - 5000,
          },
        ],
      });

      const row = await env.DB.prepare(
        "SELECT episode_number, percentage FROM continue_watching WHERE profile_id = ? AND anime_id = ?"
      )
        .bind(profile1Id, "anime-cw-safeguard")
        .first<{ episode_number: number; percentage: number }>();

      expect(row?.episode_number).toBe(5);
      expect(row?.percentage).toBe(50.0);
    });

    it("4.4 continue_watching advances smoothly when a higher episode number is pushed", async () => {
      harness.setBearerToken(token1);
      const baseTime = Date.now();

      // Episode 5
      await harness.post("/api/sync/push", {
        continueWatching: [
          {
            ...FIXTURE_CONTINUE_WATCHING_1,
            animeId: "anime-cw-advance",
            episodeNumber: 5,
            position: 600,
            duration: 1200,
            percentage: 50.0,
            updatedAt: baseTime,
          },
        ],
      });

      // Episode 6 pushed
      await harness.post("/api/sync/push", {
        continueWatching: [
          {
            ...FIXTURE_CONTINUE_WATCHING_1,
            animeId: "anime-cw-advance",
            episodeNumber: 6,
            position: 120,
            duration: 1200,
            percentage: 10.0,
            updatedAt: baseTime + 2000,
          },
        ],
      });

      const row = await env.DB.prepare(
        "SELECT episode_number, position FROM continue_watching WHERE profile_id = ? AND anime_id = ?"
      )
        .bind(profile1Id, "anime-cw-advance")
        .first<{ episode_number: number; position: number }>();

      expect(row?.episode_number).toBe(6);
      expect(row?.position).toBe(120);
    });

    it("4.5 watch_history preserves is_completed = 1 on duplicate conflict upsert", async () => {
      harness.setBearerToken(token1);
      const baseTime = Date.now();

      await harness.post("/api/sync/push", {
        watchHistory: [
          {
            ...FIXTURE_WATCH_HISTORY_1,
            animeId: "anime-hist-safeguard",
            episodeNumber: 1,
            episodeId: "ep-1",
            title: "Hist Ep 1",
            progressPercent: 100,
            isCompleted: true,
            updatedAt: baseTime,
          },
        ],
      });

      // Subsequent push with isCompleted = false
      await harness.post("/api/sync/push", {
        watchHistory: [
          {
            ...FIXTURE_WATCH_HISTORY_1,
            animeId: "anime-hist-safeguard",
            episodeNumber: 1,
            episodeId: "ep-1",
            title: "Hist Ep 1",
            progressPercent: 35,
            isCompleted: false,
            updatedAt: baseTime + 1000,
          },
        ],
      });

      const row = await env.DB.prepare(
        "SELECT is_completed FROM watch_history WHERE profile_id = ? AND anime_id = ? AND episode_number = 1"
      )
        .bind(profile1Id, "anime-hist-safeguard")
        .first<{ is_completed: number }>();

      expect(row?.is_completed).toBe(1);
    });
  });

  // ==========================================================================
  // 5. Query Parameter & Pull Edge Cases
  // ==========================================================================
  describe("5. Query Parameter & Pull Edge Cases", () => {
    beforeEach(async () => {
      harness.setBearerToken(token1);
      await harness.post("/api/sync/push", {
        favorites: [{ ...FIXTURE_ANIME_1, id: "anime-pull-edge", updatedAt: 1700000000000 }],
      });
    });

    it("5.1 empty pull (since=0 or omitted) performs full bootstrap", async () => {
      const res = await harness.get<{ deltas: { favorites: AnimeItem[] } }>("/api/sync/pull");
      expect(res.status).toBe(200);
      expect(res.body.deltas.favorites.some((f) => f.id === "anime-pull-edge")).toBe(true);
    });

    it("5.2 negative since parameter (since=-5000) falls back to bootstrap mode", async () => {
      const res = await harness.get<{ deltas: { favorites: AnimeItem[] } }>("/api/sync/pull?since=-5000");
      expect(res.status).toBe(200);
      expect(res.body.deltas.favorites.some((f) => f.id === "anime-pull-edge")).toBe(true);
    });

    it("5.3 non-numeric since parameter (since=invalid_text) falls back safely to 0", async () => {
      const res = await harness.get<{ deltas: { favorites: AnimeItem[] } }>("/api/sync/pull?since=invalid_text");
      expect(res.status).toBe(200);
      expect(res.body.deltas.favorites.some((f) => f.id === "anime-pull-edge")).toBe(true);
    });

    it("5.4 future since parameter returns empty deltas", async () => {
      const farFuture = Date.now() + 1000000000;
      const res = await harness.get<{ deltas: { favorites: AnimeItem[] } }>(`/api/sync/pull?since=${farFuture}`);
      expect(res.status).toBe(200);
      expect(res.body.deltas.favorites).toHaveLength(0);
    });

    it("5.5 empty push payload ({}) succeeds with 200 without side effects", async () => {
      const res = await harness.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {});
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.appliedCount).toBe(0);
    });

    it("5.6 push rejects invalid non-JSON body with 400 Bad Request", async () => {
      const res = await harness.request("/api/sync/push", {
        method: "POST",
        body: "not-a-valid-json-payload",
        headers: { "Content-Type": "application/json" },
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid JSON body");
    });

    it("5.7 push requires valid authentication token (401)", async () => {
      harness.clearAuth();
      const res = await harness.post("/api/sync/push", {});
      expect(res.status).toBe(401);
    });

    it("5.8 pull requires valid authentication token (401)", async () => {
      harness.clearAuth();
      const res = await harness.get("/api/sync/pull");
      expect(res.status).toBe(401);
    });

    it("5.9 pull correctly delivers pushed sharedSettings and searchHistory", async () => {
      harness.setBearerToken(token1);
      await harness.post("/api/sync/push", {
        sharedSettings: { preferredQuality: "1080p", autoplayNext: true },
        searchHistory: [{ query: "Solo Leveling", timestamp: Date.now() }],
      });

      const res = await harness.get<{
        deltas: {
          sharedSettings: Record<string, any>;
          searchHistory: Array<{ query: string; timestamp: number }>;
        };
      }>("/api/sync/pull");

      expect(res.status).toBe(200);
      expect(res.body.deltas.sharedSettings.preferredQuality).toBe("1080p");
      expect(res.body.deltas.sharedSettings.autoplayNext).toBe(true);
      expect(res.body.deltas.searchHistory.some((s) => s.query === "Solo Leveling")).toBe(true);
    });
  });

  // ==========================================================================
  // 6. Multi-Profile Data Isolation
  // ==========================================================================
  describe("6. Multi-Profile Data Isolation", () => {
    it("6.1 data pushed by Profile 1 is strictly invisible to Profile 2 pull", async () => {
      // Profile 1 pushes favorite
      harness.setBearerToken(token1);
      await harness.post("/api/sync/push", {
        favorites: [{ ...FIXTURE_ANIME_1, id: "anime-profile-1-private", updatedAt: Date.now() }],
      });

      // Profile 2 pulls deltas
      harness.setBearerToken(token2);
      const prof2Pull = await harness.get<{ deltas: { favorites: AnimeItem[] } }>("/api/sync/pull");

      expect(prof2Pull.status).toBe(200);
      expect(prof2Pull.body.deltas.favorites.some((f) => f.id === "anime-profile-1-private")).toBe(false);
    });

    it("6.2 tombstones created by Profile 1 do not affect Profile 2 records", async () => {
      const sharedAnimeId = "anime-shared-id-across-profiles";

      // Profile 2 has this favorite
      harness.setBearerToken(token2);
      await harness.post("/api/sync/push", {
        favorites: [{ ...FIXTURE_ANIME_2, id: sharedAnimeId, updatedAt: Date.now() }],
      });

      // Profile 1 deletes this anime ID in their profile
      harness.setBearerToken(token1);
      await harness.post("/api/sync/push", {
        deletions: [{ type: "favorite", key: sharedAnimeId, deletedAt: Date.now() }],
      });

      // Profile 2's favorite should remain intact
      harness.setBearerToken(token2);
      const prof2Pull = await harness.get<{ deltas: { favorites: AnimeItem[] } }>("/api/sync/pull");
      expect(prof2Pull.body.deltas.favorites.some((f) => f.id === sharedAnimeId)).toBe(true);
    });

    it("6.3 watch_progress is strictly isolated across profiles", async () => {
      harness.setBearerToken(token1);
      await harness.post("/api/sync/push", {
        watchProgress: [
          {
            ...FIXTURE_PROGRESS_1,
            animeId: "anime-prog-isolated",
            episodeNumber: 1,
            updatedAt: Date.now(),
          },
        ],
      });

      harness.setBearerToken(token2);
      const pullRes = await harness.get<{ deltas: { watchProgress: WatchProgressItem[] } }>("/api/sync/pull");
      expect(pullRes.body.deltas.watchProgress.some((wp) => wp.animeId === "anime-prog-isolated")).toBe(false);
    });

    it("6.4 continue_watching is strictly isolated across profiles", async () => {
      harness.setBearerToken(token1);
      await harness.post("/api/sync/push", {
        continueWatching: [
          {
            ...FIXTURE_CONTINUE_WATCHING_1,
            animeId: "anime-cw-isolated",
            episodeNumber: 1,
            updatedAt: Date.now(),
          },
        ],
      });

      harness.setBearerToken(token2);
      const pullRes = await harness.get<{ deltas: { continueWatching: ContinueWatchingItem[] } }>("/api/sync/pull");
      expect(pullRes.body.deltas.continueWatching.some((cw) => cw.animeId === "anime-cw-isolated")).toBe(false);
    });
  });
});
