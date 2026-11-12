/**
 * Tier 1 Feature Coverage: Pure Client SDK & mergeLocalAndRemote
 *
 * Covers Feature 17 & Feature 24-26:
 * - 17.1 mergeLocalAndRemote() hydrates empty local storage from remote delta payload
 * - 17.2 mergeLocalAndRemote() deletes local entities matching remote tombstones
 * - 17.3 mergeLocalAndRemote() applies Last-Write-Wins (LWW) conflict resolution across collections
 * - 17.4 mergeLocalAndRemote() enforces timeline progress safeguard and propagates isCaughtUp ('IN PARI') flag
 * - 17.5 KuroSyncClient HTTP client constructs valid requests with base URL and Bearer authorization header
 * - 17.6 mergeLocalAndRemote() prevents Continue Watching episode regression when local has higher episodeNumber
 * - 17.7 mergeLocalAndRemote() adopts newer remote episode when remote episodeNumber is ahead
 * - 17.8 mergeLocalAndRemote() purges search history matching remote tombstones
 * - 17.9 mergeLocalAndRemote() respects metadata timestamp order on watch progress while preserving higher playback progress
 * - 17.10 KuroSyncClient implements all 9 R7 client methods: checkHealth, loginDevice, startTvPairing, pollTvPairing, approveTvPairing, pullDelta, pushDelta, exportBackup, importBackup
 * - 17.11 KuroSyncClient error handling extracts descriptive error messages on failure
 *
 * Runs inside standard Node.js Vitest runner ('client-sdk' project).
 */

import { describe, it, expect } from "vitest";
import {
  KuroSyncClient,
  mergeLocalAndRemote,
  DEFAULT_ANISKIP_SETTINGS,
  type LocalStorageState,
  type RemotePullResponse,
  type ContinueWatchingItem,
  type WatchProgressItem,
  type SearchHistoryItem,
} from "@kurosync/sync-client";
import {
  FIXTURE_ANIME_1,
  FIXTURE_ANIME_2,
  FIXTURE_CONTINUE_WATCHING_1,
  FIXTURE_PROGRESS_1,
  FIXTURE_WATCH_HISTORY_1,
  FIXTURE_SEARCH_HISTORY_1,
  FIXTURE_ANISKIP_SETTINGS,
} from "../helpers/fixtures";

describe("Tier 1: Client SDK & mergeLocalAndRemote (Feature 17, 24-26)", () => {
  it("17.1 mergeLocalAndRemote() hydrates empty local storage from remote delta payload", () => {
    const emptyLocal: LocalStorageState = {
      favorites: [],
      continueWatching: [],
      watchHistory: [],
      watchProgress: [],
      sharedSettings: {},
      searchHistory: [],
    };

    const remotePull: RemotePullResponse = {
      serverTime: 1700000000000,
      profile: { id: "prof-1", name: "Principale" },
      deltas: {
        favorites: [FIXTURE_ANIME_1],
        continueWatching: [FIXTURE_CONTINUE_WATCHING_1],
        watchHistory: [FIXTURE_WATCH_HISTORY_1],
        watchProgress: [FIXTURE_PROGRESS_1],
        sharedSettings: { aniSkip: FIXTURE_ANISKIP_SETTINGS },
        searchHistory: [FIXTURE_SEARCH_HISTORY_1],
      },
      tombstones: [],
    };

    const result = mergeLocalAndRemote(emptyLocal, remotePull);

    expect(result.appliedDeletions).toBe(0);
    expect(result.appliedUpserts).toBeGreaterThanOrEqual(4);
    expect(result.state.favorites).toHaveLength(1);
    expect(result.state.favorites[0].id).toBe(FIXTURE_ANIME_1.id);
    expect(result.state.continueWatching).toHaveLength(1);
    expect(result.state.continueWatching[0].animeId).toBe(FIXTURE_CONTINUE_WATCHING_1.animeId);
    expect(result.state.watchHistory).toHaveLength(1);
    expect(result.state.watchProgress).toHaveLength(1);
    expect(result.state.sharedSettings.aniSkip).toEqual(FIXTURE_ANISKIP_SETTINGS);
    expect(result.state.searchHistory).toHaveLength(1);
  });

  it("17.2 mergeLocalAndRemote() deletes local entities matching remote tombstones", () => {
    const populatedLocal: LocalStorageState = {
      favorites: [FIXTURE_ANIME_1, FIXTURE_ANIME_2],
      continueWatching: [FIXTURE_CONTINUE_WATCHING_1],
      watchHistory: [FIXTURE_WATCH_HISTORY_1],
      watchProgress: [FIXTURE_PROGRESS_1],
      sharedSettings: {},
      searchHistory: [],
    };

    const remotePullWithTombstones: RemotePullResponse = {
      serverTime: 1700005000000,
      deltas: {
        favorites: [],
        continueWatching: [],
        watchHistory: [],
        watchProgress: [],
        sharedSettings: {},
        searchHistory: [],
      },
      tombstones: [
        { type: "favorite", key: FIXTURE_ANIME_1.id, deletedAt: 1700005000000 },
        { type: "continue_watching", key: FIXTURE_CONTINUE_WATCHING_1.animeId, deletedAt: 1700005000000 },
      ],
    };

    const result = mergeLocalAndRemote(populatedLocal, remotePullWithTombstones);

    expect(result.appliedDeletions).toBe(2);
    // Favorite 1 was deleted by tombstone; Favorite 2 remains intact
    expect(result.state.favorites).toHaveLength(1);
    expect(result.state.favorites[0].id).toBe(FIXTURE_ANIME_2.id);
    // Continue watching was deleted
    expect(result.state.continueWatching).toHaveLength(0);
    // Other collections unaffected
    expect(result.state.watchHistory).toHaveLength(1);
    expect(result.state.watchProgress).toHaveLength(1);
  });

  it("17.3 mergeLocalAndRemote() applies Last-Write-Wins (LWW) conflict resolution across collections", () => {
    const localLocal: LocalStorageState = {
      favorites: [
        { ...FIXTURE_ANIME_1, title: "Local Older Title", updatedAt: 1000 },
      ],
      continueWatching: [],
      watchHistory: [],
      watchProgress: [],
      sharedSettings: {},
      searchHistory: [],
    };

    const remotePull: RemotePullResponse = {
      serverTime: 2000,
      deltas: {
        favorites: [
          { ...FIXTURE_ANIME_1, title: "Remote Newer Title", updatedAt: 2000 },
        ],
        continueWatching: [],
        watchHistory: [],
        watchProgress: [],
        sharedSettings: {},
        searchHistory: [],
      },
      tombstones: [],
    };

    const result = mergeLocalAndRemote(localLocal, remotePull);
    expect(result.state.favorites[0].title).toBe("Remote Newer Title");

    // Reverse test: local is newer than remote
    const localNewer: LocalStorageState = {
      ...emptyState(),
      favorites: [
        { ...FIXTURE_ANIME_1, title: "Local Newer Title", updatedAt: 5000 },
      ],
    };
    const remoteOlder: RemotePullResponse = {
      serverTime: 3000,
      deltas: {
        ...emptyDeltas(),
        favorites: [
          { ...FIXTURE_ANIME_1, title: "Remote Stale Title", updatedAt: 3000 },
        ],
      },
      tombstones: [],
    };

    const resultReverse = mergeLocalAndRemote(localNewer, remoteOlder);
    expect(resultReverse.state.favorites[0].title).toBe("Local Newer Title");
  });

  it("17.4 mergeLocalAndRemote() enforces timeline progress safeguard and propagates isCaughtUp ('IN PARI') flag", () => {
    const localState: LocalStorageState = {
      ...emptyState(),
      continueWatching: [
        {
          ...FIXTURE_CONTINUE_WATCHING_1,
          episodeNumber: 5,
          position: 1200,
          percentage: 80.0,
          isCaughtUp: false,
        },
      ],
      watchProgress: [
        {
          ...FIXTURE_PROGRESS_1,
          episodeNumber: 5,
          currentTime: 1200,
          percentage: 80.0,
          isCompleted: true,
        },
      ],
    };

    // Remote pull has lower progress and isCaughtUp = true
    const remotePull: RemotePullResponse = {
      serverTime: Date.now(),
      deltas: {
        ...emptyDeltas(),
        continueWatching: [
          {
            ...FIXTURE_CONTINUE_WATCHING_1,
            episodeNumber: 5,
            position: 400,
            percentage: 26.0,
            isCaughtUp: true, // caught up ("IN PARI") flag
            updatedAt: Date.now(),
          },
        ],
        watchProgress: [
          {
            ...FIXTURE_PROGRESS_1,
            episodeNumber: 5,
            currentTime: 400,
            percentage: 26.0,
            isCompleted: false, // Attempt to un-complete
            updatedAt: Date.now(),
          },
        ],
      },
      tombstones: [],
    };

    const result = mergeLocalAndRemote(localState, remotePull);

    // Safeguard preserves higher position (1200) and percentage (80.0)
    expect(result.state.continueWatching[0].position).toBe(1200);
    expect(result.state.continueWatching[0].percentage).toBe(80.0);
    // Propagates isCaughtUp = true
    expect(result.state.continueWatching[0].isCaughtUp).toBe(true);

    // Watch progress preserves higher currentTime (1200) and completed state (true)
    expect(result.state.watchProgress[0].currentTime).toBe(1200);
    expect(result.state.watchProgress[0].isCompleted).toBe(true);
  });

  it("17.5 KuroSyncClient HTTP client constructs valid requests with base URL and Bearer authorization header", async () => {
    const client = new KuroSyncClient({
      baseUrl: "https://kurosync.example.com",
      deviceToken: "kuro_dev_test_token_sample",
    });

    expect(client.options.baseUrl).toBe("https://kurosync.example.com");
    expect(client.getDeviceToken()).toBe("kuro_dev_test_token_sample");

    const capturedRequests: { url: string; headers: Headers; method: string }[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      const headers = new Headers(init?.headers);
      capturedRequests.push({ url, headers, method: init?.method || "GET" });

      if (url.endsWith("/api/health")) {
        return new Response(JSON.stringify({ ok: true, initialized: true, version: "1.0.0" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/sync/pull")) {
        return new Response(JSON.stringify({ ok: true, serverTime: 123456789 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    }) as any;

    try {
      const health = await client.checkHealth();
      expect(health.ok).toBe(true);
      expect(capturedRequests[0].url).toBe("https://kurosync.example.com/api/health");
      expect(capturedRequests[0].headers.get("Authorization")).toBe("Bearer kuro_dev_test_token_sample");

      await client.pullDelta(500);
      expect(capturedRequests[1].url).toBe("https://kurosync.example.com/api/sync/pull?since=500");
      expect(capturedRequests[1].headers.get("Authorization")).toBe("Bearer kuro_dev_test_token_sample");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("17.6 mergeLocalAndRemote() prevents Continue Watching episode regression when local has higher episodeNumber", () => {
    // Local user watched Episode 13 locally
    const localItem: ContinueWatchingItem = {
      animeId: "anime-attack-titan",
      title: "L'attacco dei Giganti",
      thumbnail: "https://example.com/aot.jpg",
      episodeId: "ep-13-id",
      episodeNumber: 13,
      totalEpisodes: 25,
      position: 600,
      duration: 1440,
      percentage: 41.6,
      dataId: "data-ep-13",
      serverId: "server-9",
      isCaughtUp: false,
      updatedAt: 10000,
    };

    const localState: LocalStorageState = {
      ...emptyState(),
      continueWatching: [localItem],
    };

    // Remote pull still has Episode 12 (user was on ep 12 on another device earlier, marked caught-up at ep 12)
    const remotePull: RemotePullResponse = {
      serverTime: 11000,
      deltas: {
        ...emptyDeltas(),
        continueWatching: [
          {
            animeId: "anime-attack-titan",
            title: "L'attacco dei Giganti",
            thumbnail: "https://example.com/aot-old.jpg",
            episodeId: "ep-12-id",
            episodeNumber: 12,
            totalEpisodes: 25,
            position: 1400,
            duration: 1440,
            percentage: 97.2,
            dataId: "data-ep-12",
            serverId: "server-9",
            isCaughtUp: true, // caught up at ep 12
            updatedAt: 10500, // even if remote updatedAt was slightly later
          },
        ],
      },
      tombstones: [],
    };

    const result = mergeLocalAndRemote(localState, remotePull);

    expect(result.state.continueWatching).toHaveLength(1);
    const merged = result.state.continueWatching[0];

    // Must NOT regress to Episode 12!
    expect(merged.episodeNumber).toBe(13);
    expect(merged.episodeId).toBe("ep-13-id");
    expect(merged.dataId).toBe("data-ep-13");
    expect(merged.position).toBe(600);
    expect(merged.percentage).toBe(41.6);
    // Must NOT inherit isCaughtUp: true from old episode 12
    expect(merged.isCaughtUp).toBe(false);
  });

  it("17.7 mergeLocalAndRemote() adopts newer remote episode when remote episodeNumber is ahead", () => {
    // Local user was at Episode 7
    const localItem: ContinueWatchingItem = {
      animeId: "anime-frieren",
      title: "Frieren",
      thumbnail: "https://example.com/frieren.jpg",
      episodeId: "ep-7-id",
      episodeNumber: 7,
      totalEpisodes: 28,
      position: 1200,
      duration: 1400,
      percentage: 85.7,
      dataId: "data-ep-7",
      serverId: "server-1",
      isCaughtUp: false,
      updatedAt: 5000,
    };

    const localState: LocalStorageState = {
      ...emptyState(),
      continueWatching: [localItem],
    };

    // Remote user progressed to Episode 8 on TV
    const remotePull: RemotePullResponse = {
      serverTime: 8000,
      deltas: {
        ...emptyDeltas(),
        continueWatching: [
          {
            animeId: "anime-frieren",
            title: "Frieren",
            thumbnail: "https://example.com/frieren.jpg",
            episodeId: "ep-8-id",
            episodeNumber: 8,
            totalEpisodes: 28,
            position: 300,
            duration: 1400,
            percentage: 21.4,
            dataId: "data-ep-8",
            serverId: "server-1",
            isCaughtUp: true,
            updatedAt: 8000,
          },
        ],
      },
      tombstones: [],
    };

    const result = mergeLocalAndRemote(localState, remotePull);

    expect(result.state.continueWatching).toHaveLength(1);
    const merged = result.state.continueWatching[0];

    // Remote episode 8 must be adopted
    expect(merged.episodeNumber).toBe(8);
    expect(merged.episodeId).toBe("ep-8-id");
    expect(merged.dataId).toBe("data-ep-8");
    expect(merged.position).toBe(300);
    expect(merged.isCaughtUp).toBe(true);
  });

  it("17.8 mergeLocalAndRemote() purges search history matching remote tombstones", () => {
    const localState: LocalStorageState = {
      ...emptyState(),
      searchHistory: [
        { query: "Naruto", timestamp: 1000 },
        { query: "One Piece", timestamp: 2000 },
        { query: "Bleach", timestamp: 3000 },
      ],
    };

    const remotePull: RemotePullResponse = {
      serverTime: 5000,
      deltas: {
        ...emptyDeltas(),
        searchHistory: [
          { query: "Bleach", timestamp: 4000 },
          { query: "One Piece", timestamp: 1500 }, // Stale query matching tombstone
          { query: "Jujutsu Kaisen", timestamp: 4500 },
        ],
      },
      tombstones: [
        // One Piece was deleted on remote at ts=2500
        { type: "search_history", key: "One Piece", deletedAt: 2500 },
      ],
    };

    const result = mergeLocalAndRemote(localState, remotePull);

    const queries = result.state.searchHistory.map((s) => s.query);
    expect(queries).toContain("Naruto");
    expect(queries).toContain("Bleach");
    expect(queries).toContain("Jujutsu Kaisen");
    // "One Piece" must be purged by tombstone dominance!
    expect(queries).not.toContain("One Piece");
    expect(result.appliedDeletions).toBeGreaterThanOrEqual(1);
  });

  it("17.9 mergeLocalAndRemote() respects metadata timestamp order on watch progress while preserving higher playback progress", () => {
    const localState: LocalStorageState = {
      ...emptyState(),
      watchProgress: [
        {
          animeId: "anime-chainsaw",
          animeTitle: "Chainsaw Man (Newer Local Metadata)",
          thumbnail: "https://example.com/csm-local.jpg",
          episodeId: "ep-1",
          episodeNumber: 1,
          totalEpisodes: 12,
          currentTime: 300,
          duration: 1400,
          percentage: 21.4,
          isCompleted: false,
          updatedAt: 9000, // Local is newer metadata
          dataId: "loc-data-csm",
          serverId: "server-loc",
        },
      ],
    };

    const remotePull: RemotePullResponse = {
      serverTime: 10000,
      deltas: {
        ...emptyDeltas(),
        watchProgress: [
          {
            animeId: "anime-chainsaw",
            animeTitle: "Chainsaw Man (Stale Remote Metadata)",
            thumbnail: "https://example.com/csm-remote.jpg",
            episodeId: "ep-1",
            episodeNumber: 1,
            totalEpisodes: 12,
            currentTime: 900, // Remote had higher playback position
            duration: 1400,
            percentage: 64.2,
            isCompleted: true, // Remote marked completed
            updatedAt: 7000, // Remote metadata was older
            dataId: "rem-data-csm",
            serverId: "server-rem",
          },
        ],
      },
      tombstones: [],
    };

    const result = mergeLocalAndRemote(localState, remotePull);

    expect(result.state.watchProgress).toHaveLength(1);
    const merged = result.state.watchProgress[0];

    // Local newer metadata is preserved (not overwritten by stale remote)
    expect(merged.animeTitle).toBe("Chainsaw Man (Newer Local Metadata)");
    expect(merged.thumbnail).toBe("https://example.com/csm-local.jpg");
    expect(merged.dataId).toBe("loc-data-csm");

    // Higher progress is preserved via timeline safeguard
    expect(merged.currentTime).toBe(900);
    expect(merged.percentage).toBe(64.2);
    expect(merged.isCompleted).toBe(true);
  });

  it("17.10 KuroSyncClient implements all 9 R7 client methods", async () => {
    const client = new KuroSyncClient({
      baseUrl: "https://sync.kurotv.internal",
      deviceToken: "kuro_dev_bearer_token",
    });

    const calls: { url: string; method: string; body?: any; headers: Record<string, string> }[] = [];
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(init.body) : undefined;
      const headers: Record<string, string> = {};
      if (init?.headers) {
        new Headers(init.headers).forEach((v, k) => {
          headers[k] = v;
        });
      }

      calls.push({ url, method, body, headers });

      if (url.endsWith("/api/health")) {
        return new Response(JSON.stringify({ ok: true, initialized: true, version: "1.0.0" }), { status: 200 });
      }
      if (url.endsWith("/api/auth/device-login")) {
        return new Response(
          JSON.stringify({
            ok: true,
            deviceToken: "new_device_token_123",
            deviceId: "dev-uuid-1",
            profile: { id: "p1", name: "Principale" },
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/api/pair/start")) {
        return new Response(
          JSON.stringify({
            code: "ABC987",
            pairSecret: "secret_16char",
            expiresIn: 300,
            verifyUrl: "https://sync.kurotv.internal/pair?code=ABC987",
          }),
          { status: 201 }
        );
      }
      if (url.includes("/api/pair/status")) {
        return new Response(
          JSON.stringify({
            status: "approved",
            deviceToken: "paired_tv_token",
            deviceId: "tv-uuid-2",
            profileId: "p1",
            profileName: "Principale",
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/api/pair/approve")) {
        return new Response(JSON.stringify({ ok: true, deviceId: "tv-uuid-2" }), { status: 200 });
      }
      if (url.includes("/api/sync/pull")) {
        return new Response(
          JSON.stringify({
            serverTime: 123456,
            deltas: emptyDeltas(),
            tombstones: [],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/api/sync/push")) {
        return new Response(JSON.stringify({ ok: true, serverTime: 123456, appliedCount: 3 }), { status: 200 });
      }
      if (url.includes("/api/sync/export")) {
        return new Response(
          JSON.stringify({
            version: 1,
            exportedAt: 123456,
            profiles: [],
            favorites: [],
            continueWatching: [],
            watchHistory: [],
            watchProgress: [],
            sharedSettings: [],
            tombstones: [],
          }),
          { status: 200 }
        );
      }
      if (url.endsWith("/api/sync/import")) {
        return new Response(JSON.stringify({ ok: true, restoredCount: 10 }), { status: 200 });
      }

      return new Response("{}", { status: 200 });
    }) as any;

    try {
      // 1. checkHealth
      const health = await client.checkHealth();
      expect(health.ok).toBe(true);
      expect(calls[0].url).toBe("https://sync.kurotv.internal/api/health");

      // 2. loginDevice
      const login = await client.loginDevice({
        password: "master_password",
        profileId: "p1",
        deviceName: "Living Room Phone",
      });
      expect(login.ok).toBe(true);
      expect(client.getDeviceToken()).toBe("new_device_token_123");
      expect(calls[1].url).toBe("https://sync.kurotv.internal/api/auth/device-login");
      expect(calls[1].body.password).toBe("master_password");

      // 3. startTvPairing
      const startPair = await client.startTvPairing({
        deviceName: "Sony Bravia Android TV",
        deviceType: "tv",
        platform: "android-tv",
      });
      expect(startPair.code).toBe("ABC987");
      expect(calls[2].url).toBe("https://sync.kurotv.internal/api/pair/start");

      // 4. pollTvPairing
      const poll = await client.pollTvPairing("abc987", "secret_16char");
      expect(poll.status).toBe("approved");
      expect(poll.deviceToken).toBe("paired_tv_token");
      expect(client.getDeviceToken()).toBe("paired_tv_token");
      expect(calls[3].url).toBe("https://sync.kurotv.internal/api/pair/status?code=ABC987");
      expect(calls[3].headers["x-pair-secret"]).toBe("secret_16char");

      // 5. approveTvPairing
      const approve = await client.approveTvPairing({
        code: "ABC987",
        profileId: "p1",
        deviceLabel: "Sony Bravia",
      });
      expect(approve.ok).toBe(true);
      expect(calls[4].url).toBe("https://sync.kurotv.internal/api/pair/approve");

      // 6. pullDelta
      const pull = await client.pullDelta(1000);
      expect(pull.serverTime).toBe(123456);
      expect(calls[5].url).toBe("https://sync.kurotv.internal/api/sync/pull?since=1000");

      // 7. pushDelta
      const push = await client.pushDelta({
        favorites: [FIXTURE_ANIME_1],
        deletions: [{ type: "favorite", key: "del-id-1" }],
      });
      expect(push.appliedCount).toBe(3);
      expect(calls[6].url).toBe("https://sync.kurotv.internal/api/sync/push");

      // 8. exportBackup
      const backup = await client.exportBackup("prof-test");
      expect(backup.version).toBe(1);
      expect(calls[7].url).toBe("https://sync.kurotv.internal/api/sync/export?profileId=prof-test");

      // 9. importBackup
      const restore = await client.importBackup(backup);
      expect(restore.restoredCount).toBe(10);
      expect(calls[8].url).toBe("https://sync.kurotv.internal/api/sync/import");
      expect(calls[8].body.backup.version).toBe(1);

      // Verify all 9 calls captured
      expect(calls).toHaveLength(9);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("17.11 KuroSyncClient error handling extracts descriptive error messages on failure", async () => {
    const client = new KuroSyncClient({
      baseUrl: "https://sync.kurotv.internal",
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "Invalid master password" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }) as any;

    try {
      await expect(
        client.loginDevice({
          password: "wrong_password",
          profileId: "p1",
        })
      ).rejects.toThrow(/Device login failed \(401\): Invalid master password/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("17.12 exports DEFAULT_ANISKIP_SETTINGS with canonical default values", () => {
    expect(DEFAULT_ANISKIP_SETTINGS).toBeDefined();
    expect(DEFAULT_ANISKIP_SETTINGS.mode).toBe("manual");
    expect(DEFAULT_ANISKIP_SETTINGS.enableOpening).toBe(true);
    expect(DEFAULT_ANISKIP_SETTINGS.enableEnding).toBe(true);
    expect(DEFAULT_ANISKIP_SETTINGS.enableRecap).toBe(true);
    expect(DEFAULT_ANISKIP_SETTINGS.buttonDuration).toBe(10);
  });
});

function emptyState(): LocalStorageState {
  return {
    favorites: [],
    continueWatching: [],
    watchHistory: [],
    watchProgress: [],
    sharedSettings: {},
    searchHistory: [],
  };
}

function emptyDeltas() {
  return {
    favorites: [],
    continueWatching: [],
    watchHistory: [],
    watchProgress: [],
    sharedSettings: {},
    searchHistory: [],
  };
}
