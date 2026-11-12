/**
 * Tier 2 Boundary & Corner Cases: Pure Client SDK & mergeLocalAndRemote Suite
 *
 * Covers boundary, edge, and corner cases for:
 * - Empty & Undefined local / remote state payloads
 * - Continue Watching out-of-order episode resolution & regression prevention
 * - isCaughtUp ('IN PARI') flag propagation & retention across episode progressions
 * - Watch Progress progress safeguarding (currentTime, percentage, isCompleted)
 * - Watch History completion retention
 * - Tombstone dominance & resurrection across favorites, continue watching, and search history
 * - Shared Settings shallow/deep dictionary merging
 * - KuroSyncClient error extraction and header construction boundaries
 *
 * Runs inside standard Node.js Vitest runner ('client-sdk' project).
 */

import { describe, it, expect } from "vitest";
import {
  KuroSyncClient,
  mergeLocalAndRemote,
  type LocalStorageState,
  type RemotePullResponse,
  type ContinueWatchingItem,
  type WatchProgressItem,
  type SearchHistoryItem,
  type AnimeItem,
} from "@kurosync/sync-client";
import {
  FIXTURE_ANIME_1,
  FIXTURE_ANIME_2,
  FIXTURE_CONTINUE_WATCHING_1,
  FIXTURE_CONTINUE_WATCHING_2,
  FIXTURE_PROGRESS_1,
  FIXTURE_WATCH_HISTORY_1,
  FIXTURE_SEARCH_HISTORY_1,
} from "../helpers/fixtures";

function makeLocalState(partial?: Partial<LocalStorageState>): LocalStorageState {
  return {
    favorites: [],
    continueWatching: [],
    watchHistory: [],
    watchProgress: [],
    sharedSettings: {},
    searchHistory: [],
    ...partial,
  };
}

function makeRemoteResponse(
  deltas?: Partial<RemotePullResponse["deltas"]>,
  tombstones: RemotePullResponse["tombstones"] = []
): RemotePullResponse {
  return {
    serverTime: Date.now(),
    profile: { id: "p1", name: "Main" },
    deltas: {
      favorites: [],
      continueWatching: [],
      watchHistory: [],
      watchProgress: [],
      sharedSettings: {},
      searchHistory: [],
      ...deltas,
    },
    tombstones,
  };
}

describe("Tier 2: Client SDK & mergeLocalAndRemote Boundary Cases", () => {
  // ==========================================================================
  // 1. Empty & Boundary Input Shapes
  // ==========================================================================
  describe("1. Empty & Boundary Input Shapes", () => {
    it("1.1 handles completely empty local and remote states without error", () => {
      const emptyLocal = makeLocalState();
      const emptyRemote = makeRemoteResponse();

      const result = mergeLocalAndRemote(emptyLocal, emptyRemote);
      expect(result.appliedUpserts).toBe(0);
      expect(result.appliedDeletions).toBe(0);
      expect(result.state.favorites).toEqual([]);
      expect(result.state.continueWatching).toEqual([]);
      expect(result.state.watchHistory).toEqual([]);
      expect(result.state.watchProgress).toEqual([]);
      expect(result.state.sharedSettings).toEqual({});
      expect(result.state.searchHistory).toEqual([]);
    });

    it("1.2 tolerates undefined collections and optional missing fields in remote deltas", () => {
      const emptyLocal = makeLocalState();
      const minimalRemote: RemotePullResponse = {
        serverTime: Date.now(),
        profile: { id: "p1", name: "Main" },
      } as any;

      const result = mergeLocalAndRemote(emptyLocal, minimalRemote);
      expect(result.appliedUpserts).toBe(0);
      expect(result.appliedDeletions).toBe(0);
      expect(result.state.favorites).toEqual([]);
    });

    it("1.3 preserves fully populated local state when remote deltas and tombstones are empty", () => {
      const populatedLocal = makeLocalState({
        favorites: [FIXTURE_ANIME_1],
        continueWatching: [FIXTURE_CONTINUE_WATCHING_1],
        watchHistory: [FIXTURE_WATCH_HISTORY_1],
        watchProgress: [FIXTURE_PROGRESS_1],
        sharedSettings: { preferredQuality: "1080p" },
        searchHistory: [FIXTURE_SEARCH_HISTORY_1],
      });

      const emptyRemote = makeRemoteResponse();

      const result = mergeLocalAndRemote(populatedLocal, emptyRemote);
      expect(result.state.favorites).toHaveLength(1);
      expect(result.state.favorites[0].id).toBe(FIXTURE_ANIME_1.id);
      expect(result.state.continueWatching).toHaveLength(1);
      expect(result.state.continueWatching[0].animeId).toBe(FIXTURE_CONTINUE_WATCHING_1.animeId);
      expect(result.state.sharedSettings.preferredQuality).toBe("1080p");
    });
  });

  // ==========================================================================
  // 2. Continue Watching Episode Progression & isCaughtUp ('IN PARI')
  // ==========================================================================
  describe("2. Continue Watching Episode Progression & isCaughtUp ('IN PARI')", () => {
    it("2.1 local episode ahead: prevents regression when remote has older episode number", () => {
      const localState = makeLocalState({
        continueWatching: [
          {
            ...FIXTURE_CONTINUE_WATCHING_1,
            animeId: "anime-ahead",
            episodeNumber: 10,
            position: 900,
            percentage: 75.0,
            isCaughtUp: true,
            updatedAt: 1000,
          },
        ],
      });

      const remoteResponse = makeRemoteResponse({
        continueWatching: [
          {
            ...FIXTURE_CONTINUE_WATCHING_1,
            animeId: "anime-ahead",
            episodeNumber: 4, // Stale older episode
            position: 300,
            percentage: 25.0,
            isCaughtUp: false,
            updatedAt: 1500, // Even with newer timestamp!
          },
        ],
      });

      const result = mergeLocalAndRemote(localState, remoteResponse);
      const cw = result.state.continueWatching.find((c) => c.animeId === "anime-ahead");
      expect(cw).toBeDefined();
      expect(cw?.episodeNumber).toBe(10);
      expect(cw?.position).toBe(900);
      expect(cw?.percentage).toBe(75.0);
      expect(cw?.isCaughtUp).toBe(true);
    });

    it("2.2 remote episode ahead: smoothly adopts newer remote episode", () => {
      const localState = makeLocalState({
        continueWatching: [
          {
            ...FIXTURE_CONTINUE_WATCHING_1,
            animeId: "anime-remote-ahead",
            episodeNumber: 3,
            position: 600,
            percentage: 50.0,
            isCaughtUp: false,
            updatedAt: 1000,
          },
        ],
      });

      const remoteResponse = makeRemoteResponse({
        continueWatching: [
          {
            ...FIXTURE_CONTINUE_WATCHING_1,
            animeId: "anime-remote-ahead",
            episodeNumber: 8,
            position: 120,
            percentage: 10.0,
            isCaughtUp: true,
            updatedAt: 1500,
          },
        ],
      });

      const result = mergeLocalAndRemote(localState, remoteResponse);
      const cw = result.state.continueWatching.find((c) => c.animeId === "anime-remote-ahead");
      expect(cw?.episodeNumber).toBe(8);
      expect(cw?.position).toBe(120);
      expect(cw?.percentage).toBe(10.0);
      expect(cw?.isCaughtUp).toBe(true);
    });

    it("2.3 equal episode number: takes maximum playback position and percentage", () => {
      const localState = makeLocalState({
        continueWatching: [
          {
            ...FIXTURE_CONTINUE_WATCHING_1,
            animeId: "anime-equal-ep",
            episodeNumber: 5,
            position: 850,
            percentage: 85.0,
            updatedAt: 1000,
          },
        ],
      });

      const remoteResponse = makeRemoteResponse({
        continueWatching: [
          {
            ...FIXTURE_CONTINUE_WATCHING_1,
            animeId: "anime-equal-ep",
            episodeNumber: 5,
            position: 400,
            percentage: 40.0,
            updatedAt: 1500,
          },
        ],
      });

      const result = mergeLocalAndRemote(localState, remoteResponse);
      const cw = result.state.continueWatching.find((c) => c.animeId === "anime-equal-ep");
      expect(cw?.episodeNumber).toBe(5);
      expect(cw?.position).toBe(850);
      expect(cw?.percentage).toBe(85.0);
    });

    it("2.4 equal episode number: propagates remote isCaughtUp = true", () => {
      const localState = makeLocalState({
        continueWatching: [
          {
            ...FIXTURE_CONTINUE_WATCHING_1,
            animeId: "anime-caught-up-test",
            episodeNumber: 12,
            isCaughtUp: false,
            updatedAt: 1000,
          },
        ],
      });

      const remoteResponse = makeRemoteResponse({
        continueWatching: [
          {
            ...FIXTURE_CONTINUE_WATCHING_1,
            animeId: "anime-caught-up-test",
            episodeNumber: 12,
            isCaughtUp: true,
            updatedAt: 1500,
          },
        ],
      });

      const result = mergeLocalAndRemote(localState, remoteResponse);
      const cw = result.state.continueWatching.find((c) => c.animeId === "anime-caught-up-test");
      expect(cw?.isCaughtUp).toBe(true);
    });
  });

  // ==========================================================================
  // 3. Watch Progress Safeguard & Metadata Timestamps
  // ==========================================================================
  describe("3. Watch Progress Safeguard & Metadata Timestamps", () => {
    it("3.1 preserves isCompleted = true if local completed it, even if remote is uncompleted", () => {
      const localState = makeLocalState({
        watchProgress: [
          {
            ...FIXTURE_PROGRESS_1,
            animeId: "anime-prog-test",
            episodeNumber: 1,
            percentage: 100.0,
            currentTime: 1400,
            isCompleted: true,
            updatedAt: 1000,
          },
        ],
      });

      const remoteResponse = makeRemoteResponse({
        watchProgress: [
          {
            ...FIXTURE_PROGRESS_1,
            animeId: "anime-prog-test",
            episodeNumber: 1,
            percentage: 60.0,
            currentTime: 800,
            isCompleted: false,
            updatedAt: 1500,
          },
        ],
      });

      const result = mergeLocalAndRemote(localState, remoteResponse);
      const wp = result.state.watchProgress.find((p) => p.animeId === "anime-prog-test");
      expect(wp?.isCompleted).toBe(true);
      expect(wp?.percentage).toBe(100.0);
      expect(wp?.currentTime).toBe(1400);
    });

    it("3.2 adopts isCompleted = true from remote when local was uncompleted", () => {
      const localState = makeLocalState({
        watchProgress: [
          {
            ...FIXTURE_PROGRESS_1,
            animeId: "anime-remote-completed",
            episodeNumber: 2,
            percentage: 50.0,
            currentTime: 700,
            isCompleted: false,
            updatedAt: 1000,
          },
        ],
      });

      const remoteResponse = makeRemoteResponse({
        watchProgress: [
          {
            ...FIXTURE_PROGRESS_1,
            animeId: "anime-remote-completed",
            episodeNumber: 2,
            percentage: 98.0,
            currentTime: 1380,
            isCompleted: true,
            updatedAt: 1500,
          },
        ],
      });

      const result = mergeLocalAndRemote(localState, remoteResponse);
      const wp = result.state.watchProgress.find((p) => p.animeId === "anime-remote-completed");
      expect(wp?.isCompleted).toBe(true);
      expect(wp?.percentage).toBe(98.0);
    });

    it("3.3 preserves newer metadata string while taking maximum progress metrics", () => {
      const localState = makeLocalState({
        watchProgress: [
          {
            ...FIXTURE_PROGRESS_1,
            animeId: "anime-metadata-order",
            episodeNumber: 3,
            animeTitle: "Stale Title",
            percentage: 90.0,
            currentTime: 1200,
            updatedAt: 1000,
          },
        ],
      });

      const remoteResponse = makeRemoteResponse({
        watchProgress: [
          {
            ...FIXTURE_PROGRESS_1,
            animeId: "anime-metadata-order",
            episodeNumber: 3,
            animeTitle: "Updated Official Title",
            percentage: 45.0,
            currentTime: 600,
            updatedAt: 2000, // Newer metadata update
          },
        ],
      });

      const result = mergeLocalAndRemote(localState, remoteResponse);
      const wp = result.state.watchProgress.find((p) => p.animeId === "anime-metadata-order");
      expect(wp?.animeTitle).toBe("Updated Official Title");
      expect(wp?.percentage).toBe(90.0);
      expect(wp?.currentTime).toBe(1200);
    });
  });

  // ==========================================================================
  // 4. Tombstone Dominance & Purging Across Collections
  // ==========================================================================
  describe("4. Tombstone Dominance & Purging Across Collections", () => {
    it("4.1 purges local favorite matching remote tombstone with deletedAt >= local updatedAt", () => {
      const localState = makeLocalState({
        favorites: [
          { ...FIXTURE_ANIME_1, id: "anime-del-fav", updatedAt: 1000 },
        ],
      });

      const remoteResponse = makeRemoteResponse(
        { favorites: [] },
        [{ type: "favorite", key: "anime-del-fav", deletedAt: 1500 }]
      );

      const result = mergeLocalAndRemote(localState, remoteResponse);
      expect(result.state.favorites).toHaveLength(0);
      expect(result.appliedDeletions).toBe(1);
    });

    it("4.2 does NOT delete local favorite if local was re-added strictly newer than tombstone", () => {
      const localState = makeLocalState({
        favorites: [
          { ...FIXTURE_ANIME_1, id: "anime-readded", updatedAt: 2500 },
        ],
      });

      const remoteResponse = makeRemoteResponse(
        { favorites: [] },
        [{ type: "favorite", key: "anime-readded", deletedAt: 1500 }]
      );

      const result = mergeLocalAndRemote(localState, remoteResponse);
      expect(result.state.favorites).toHaveLength(1);
      expect(result.state.favorites[0].id).toBe("anime-readded");
    });

    it("4.3 purges local continue_watching matching remote tombstone", () => {
      const localState = makeLocalState({
        continueWatching: [
          { ...FIXTURE_CONTINUE_WATCHING_1, animeId: "anime-del-cw", updatedAt: 1000 },
        ],
      });

      const remoteResponse = makeRemoteResponse(
        { continueWatching: [] },
        [{ type: "continue_watching", key: "anime-del-cw", deletedAt: 1500 }]
      );

      const result = mergeLocalAndRemote(localState, remoteResponse);
      expect(result.state.continueWatching).toHaveLength(0);
      expect(result.appliedDeletions).toBe(1);
    });

    it("4.4 purges search history matching search_history remote tombstone", () => {
      const localState = makeLocalState({
        searchHistory: [
          { query: "Bleach TYBW", timestamp: 1000 },
          { query: "Naruto Shippuden", timestamp: 1200 },
        ],
      });

      const remoteResponse = makeRemoteResponse(
        { searchHistory: [] },
        [{ type: "search_history", key: "Bleach TYBW", deletedAt: 1500 }]
      );

      const result = mergeLocalAndRemote(localState, remoteResponse);
      expect(result.state.searchHistory).toHaveLength(1);
      expect(result.state.searchHistory[0].query).toBe("Naruto Shippuden");
      expect(result.appliedDeletions).toBe(1);
    });
  });

  // ==========================================================================
  // 5. Shared Settings Merging
  // ==========================================================================
  describe("5. Shared Settings Merging", () => {
    it("5.1 shallow merges settings dictionaries, overriding overlapping keys with remote values", () => {
      const localState = makeLocalState({
        sharedSettings: {
          autoplayNext: false,
          preferredQuality: "720p",
          customSettingA: "preserved_local_value",
        },
      });

      const remoteResponse = makeRemoteResponse({
        sharedSettings: {
          autoplayNext: true, // overridden
          preferredQuality: "1080p", // overridden
          remoteSettingB: "new_remote_value",
        },
      });

      const result = mergeLocalAndRemote(localState, remoteResponse);
      expect(result.state.sharedSettings.autoplayNext).toBe(true);
      expect(result.state.sharedSettings.preferredQuality).toBe("1080p");
      expect(result.state.sharedSettings.customSettingA).toBe("preserved_local_value");
      expect(result.state.sharedSettings.remoteSettingB).toBe("new_remote_value");
    });
  });

  // ==========================================================================
  // 6. KuroSyncClient Edge & Construction Boundaries
  // ==========================================================================
  describe("6. KuroSyncClient Construction & Method Boundaries", () => {
    it("6.1 normalizes base URL options and exposes options.baseUrl", () => {
      const client = new KuroSyncClient({
        baseUrl: "https://kurosync.example.com",
        deviceToken: "initial_dev_token",
      });

      expect(client.options.baseUrl).toBe("https://kurosync.example.com");
      expect(client.getDeviceToken()).toBe("initial_dev_token");
    });

    it("6.2 setDeviceToken updates the active Bearer token dynamically", () => {
      const client = new KuroSyncClient({
        baseUrl: "https://kurosync.example.com",
      });

      expect(client.getDeviceToken()).toBeUndefined();
      client.setDeviceToken("new_dynamic_token_123");
      expect(client.getDeviceToken()).toBe("new_dynamic_token_123");
    });

    it("6.3 extracts error message from JSON error response when request fails", async () => {
      // Mock global fetch
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async () => {
          return new Response(JSON.stringify({ error: "Invalid master password" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }) as any;

        const client = new KuroSyncClient({ baseUrl: "https://mock.kurosync" });
        await expect(
          client.loginDevice({ password: "Wrong", profileId: "p1", deviceName: "Dev" })
        ).rejects.toThrow("Invalid master password");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
