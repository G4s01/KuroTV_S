import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { TestHarness, clearDatabase } from "./helpers/harness";
import { ensureSchema, resetSchemaInitCache } from "../src/worker/schema";
import { resetRateLimits } from "../src/worker/rate-limit";
import {
  FIXTURE_ANIME_1,
  FIXTURE_MAL_AUTH_1,
  FIXTURE_MAL_AUTH_2,
} from "./helpers/fixtures";
import type { MalAuthSyncRecord, RemotePullResponse } from "@kurosync/sync-client";

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function seedProfileWithDevice(
  db: D1Database,
  profileId: string,
  profileName: string,
  token: string,
  deviceName = "Mobile Device"
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
      VALUES (?, ?, ?, 'mobile', 'android', ?, ?, ?)
    `).bind(crypto.randomUUID(), profileId, deviceName, tokenHash, now, now),
  ]);
}

const TOKEN_PROF_1_DEV_A = "kuro_dev_mal_prof1_a";
const TOKEN_PROF_1_DEV_B = "kuro_dev_mal_prof1_b";
const TOKEN_PROF_2 = "kuro_dev_mal_prof2_a";

describe("MAL Auth Synchronization & Migration Suite", () => {
  let harnessProf1A: TestHarness;
  let harnessProf1B: TestHarness;
  let harnessProf2: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await ensureSchema(env.DB);
    await clearDatabase(env.DB);
    await seedProfileWithDevice(env.DB, "prof-1", "Profilo Uno", TOKEN_PROF_1_DEV_A, "Phone A");
    await seedProfileWithDevice(env.DB, "prof-1", "Profilo Uno", TOKEN_PROF_1_DEV_B, "Tablet B");
    await seedProfileWithDevice(env.DB, "prof-2", "Profilo Due", TOKEN_PROF_2, "Phone P2");

    harnessProf1A = new TestHarness().setBearerToken(TOKEN_PROF_1_DEV_A);
    harnessProf1B = new TestHarness().setBearerToken(TOKEN_PROF_1_DEV_B);
    harnessProf2 = new TestHarness().setBearerToken(TOKEN_PROF_2);
  });

  // ==========================================================================
  // 1. D1 Migration 0003_mal_auth.sql verification
  // ==========================================================================
  describe("1. Migration 0003_mal_auth.sql & Schema Integrity", () => {
    it("1.1 verifies mal_auth columns, indexes, tombstones preservation & 'mal_auth' CHECK constraint on upgrade from 0001+0002", async () => {
      const migrations = (env as any).TEST_MIGRATIONS as Array<{
        name: string;
        queries: string[];
      }>;
      expect(Array.isArray(migrations)).toBe(true);

      const mig0001 = migrations.find((m) => m.name.includes("0001"));
      const mig0002 = migrations.find((m) => m.name.includes("0002"));
      const mig0003 = migrations.find((m) => m.name.includes("0003"));
      expect(mig0001).toBeDefined();
      expect(mig0002).toBeDefined();
      expect(mig0003).toBeDefined();

      // Drop all tables to simulate a pre-0003 database
      resetSchemaInitCache();
      await env.DB.exec(`
        DROP TABLE IF EXISTS tombstones;
        DROP TABLE IF EXISTS mal_auth;
        DROP TABLE IF EXISTS shared_settings;
        DROP TABLE IF EXISTS watch_progress;
        DROP TABLE IF EXISTS watch_history;
        DROP TABLE IF EXISTS continue_watching;
        DROP TABLE IF EXISTS favorites;
        DROP TABLE IF EXISTS pairing_codes;
        DROP TABLE IF EXISTS devices;
        DROP TABLE IF EXISTS profiles;
        DROP TABLE IF EXISTS instance_config;
      `);

      // Apply 0001 and 0002
      await env.DB.batch(mig0001!.queries.map((q) => env.DB.prepare(q)));
      await env.DB.batch(mig0002!.queries.map((q) => env.DB.prepare(q)));

      // Seed existing profile and tombstone with deleted_at + server_deleted_at
      await env.DB.prepare(
        "INSERT INTO profiles (id, name, avatar_color, created_at, updated_at) VALUES ('prof-mig', 'Mig User', '#E50914', 1000, 1000)"
      ).run();
      await env.DB.prepare(
        "INSERT INTO tombstones (profile_id, entity_type, entity_key, deleted_at, server_deleted_at) VALUES ('prof-mig', 'favorite', 'anime-legacy', 1700000100000, 1700000200000)"
      ).run();

      // Before 0003: inserting 'mal_auth' tombstone MUST fail CHECK constraint
      await expect(
        env.DB.prepare(
          "INSERT INTO tombstones (profile_id, entity_type, entity_key, deleted_at, server_deleted_at) VALUES ('prof-mig', 'mal_auth', 'default', 1700000300000, 1700000300000)"
        ).run()
      ).rejects.toThrow();

      // Apply 0003_mal_auth.sql
      await env.DB.batch(mig0003!.queries.map((q) => env.DB.prepare(q)));

      // Verify mal_auth columns
      const malCols = await env.DB.prepare("PRAGMA table_info(mal_auth)").all<{
        name: string;
        type: string;
        notnull: number;
      }>();
      expect(malCols.results.map((c) => c.name)).toEqual([
        "profile_id",
        "client_id",
        "access_token",
        "refresh_token",
        "expires_at",
        "token_type",
        "username",
        "user_id",
        "picture",
        "updated_at",
        "server_updated_at",
      ]);

      // Verify tombstones columns preserved including server_deleted_at
      const tombCols = await env.DB.prepare("PRAGMA table_info(tombstones)").all<{
        name: string;
      }>();
      expect(tombCols.results.map((c) => c.name)).toEqual([
        "profile_id",
        "entity_type",
        "entity_key",
        "deleted_at",
        "server_deleted_at",
      ]);

      // Verify legacy tombstone data preserved identically
      const legacyTomb = await env.DB.prepare(
        "SELECT * FROM tombstones WHERE profile_id = 'prof-mig' AND entity_type = 'favorite'"
      ).first<{ entity_key: string; deleted_at: number; server_deleted_at: number }>();
      expect(legacyTomb?.entity_key).toBe("anime-legacy");
      expect(legacyTomb?.deleted_at).toBe(1700000100000);
      expect(legacyTomb?.server_deleted_at).toBe(1700000200000);

      // Verify indexes recreated
      const indexes = await env.DB.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name IN (
          'idx_mal_auth_profile_updated',
          'idx_tombstones_profile_deleted',
          'idx_tombstones_deleted_at'
        )
        ORDER BY name ASC
      `).all<{ name: string }>();
      expect(indexes.results.map((i) => i.name)).toEqual([
        "idx_mal_auth_profile_updated",
        "idx_tombstones_deleted_at",
        "idx_tombstones_profile_deleted",
      ]);

      // After 0003: inserting & reading 'mal_auth' tombstone succeeds without CHECK constraint error
      await env.DB.prepare(
        "INSERT INTO tombstones (profile_id, entity_type, entity_key, deleted_at, server_deleted_at) VALUES ('prof-mig', 'mal_auth', 'default', 1700000300000, 1700000400000)"
      ).run();

      const malTomb = await env.DB.prepare(
        "SELECT * FROM tombstones WHERE profile_id = 'prof-mig' AND entity_type = 'mal_auth'"
      ).first<{ entity_key: string; deleted_at: number; server_deleted_at: number }>();
      expect(malTomb?.entity_key).toBe("default");
      expect(malTomb?.deleted_at).toBe(1700000300000);
      expect(malTomb?.server_deleted_at).toBe(1700000400000);
    });
  });

  // ==========================================================================
  // 2. Push + Pull delta isolation, capability detection, refresh & LWW
  // ==========================================================================
  describe("2. Push & Pull Delta Isolation, Refresh Token & LWW", () => {
    it("2.1 GET /api/sync/pull always includes malAuth key (null when absent) for capability detection", async () => {
      const res = await harnessProf1A.get<RemotePullResponse>("/api/sync/pull?since=0");
      expect(res.status).toBe(200);
      expect("malAuth" in res.body.deltas).toBe(true);
      expect(res.body.deltas.malAuth).toBeNull();
    });

    it("2.2 POST /api/sync/push validates non-empty clientId, accessToken, and refreshToken", async () => {
      const badPayloads = [
        { malAuth: "not-an-object" },
        { malAuth: { clientId: "", accessToken: "a", refreshToken: "r", expiresAt: 1, tokenType: "Bearer", updatedAt: 1 } },
        { malAuth: { clientId: "c", accessToken: "   ", refreshToken: "r", expiresAt: 1, tokenType: "Bearer", updatedAt: 1 } },
        { malAuth: { clientId: "c", accessToken: "a", refreshToken: "", expiresAt: 1, tokenType: "Bearer", updatedAt: 1 } },
      ];

      for (const payload of badPayloads) {
        const res = await harnessProf1A.post("/api/sync/push", payload);
        expect(res.status).toBe(400);
      }

      // Explicitly passing malAuth: null is tolerated as no-op
      const nullRes = await harnessProf1A.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
        malAuth: null,
      });
      expect(nullRes.status).toBe(200);
      expect(nullRes.body.appliedCount).toBe(0);
    });

    it("2.3 pushes and pulls malAuth strictly isolated between prof-1 and prof-2 (ignoring spoofed profileId)", async () => {
      const pushRes = await harnessProf1A.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
        malAuth: {
          ...FIXTURE_MAL_AUTH_1,
          profileId: "prof-2", // Must be ignored in favor of authenticated prof-1
        },
      });
      expect(pushRes.status).toBe(200);
      expect(pushRes.body.appliedCount).toBe(1);

      // Device B on prof-1 pulls malAuth with camelCase fields
      const pull1B = await harnessProf1B.get<RemotePullResponse>("/api/sync/pull?since=0");
      expect(pull1B.status).toBe(200);
      expect(pull1B.body.deltas.malAuth).toEqual({
        profileId: "prof-1",
        clientId: FIXTURE_MAL_AUTH_1.clientId,
        accessToken: FIXTURE_MAL_AUTH_1.accessToken,
        refreshToken: FIXTURE_MAL_AUTH_1.refreshToken,
        expiresAt: FIXTURE_MAL_AUTH_1.expiresAt,
        tokenType: FIXTURE_MAL_AUTH_1.tokenType,
        username: FIXTURE_MAL_AUTH_1.username,
        userId: FIXTURE_MAL_AUTH_1.userId,
        picture: FIXTURE_MAL_AUTH_1.picture,
        updatedAt: FIXTURE_MAL_AUTH_1.updatedAt,
      });

      // prof-2 MUST NOT see prof-1's MAL credentials
      const pull2 = await harnessProf2.get<RemotePullResponse>("/api/sync/pull?since=0");
      expect(pull2.status).toBe(200);
      expect("malAuth" in pull2.body.deltas).toBe(true);
      expect(pull2.body.deltas.malAuth).toBeNull();
    });

    it("2.4 supports token refresh with newer updatedAt, incremental since delta, and rejects stale LWW updates", async () => {
      const t1 = 1700000000000;
      const t2 = 1700001000000;
      const tStale = 1700000500000;

      // Initial login at t1
      await harnessProf1A.post("/api/sync/push", {
        malAuth: { ...FIXTURE_MAL_AUTH_1, updatedAt: t1 },
      });

      // Pull at since = t1 returns malAuth: null (no changes after t1)
      const unchangedPull = await harnessProf1B.get<RemotePullResponse>(`/api/sync/pull?since=${t1}`);
      expect(unchangedPull.status).toBe(200);
      expect("malAuth" in unchangedPull.body.deltas).toBe(true);
      expect(unchangedPull.body.deltas.malAuth).toBeNull();

      // Token refresh at t2 > t1
      const refreshed: MalAuthSyncRecord = {
        ...FIXTURE_MAL_AUTH_1,
        accessToken: "mal-access-token-refreshed-2",
        refreshToken: "mal-refresh-token-refreshed-2",
        expiresAt: t2 + 3600000,
        updatedAt: t2,
      };
      const refreshRes = await harnessProf1A.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
        malAuth: refreshed,
      });
      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.appliedCount).toBe(1);

      // Stale push at tStale < t2 MUST be ignored by LWW
      const staleRes = await harnessProf1B.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
        malAuth: {
          ...FIXTURE_MAL_AUTH_1,
          accessToken: "mal-stale-token",
          refreshToken: "mal-stale-refresh",
          updatedAt: tStale,
        },
      });
      expect(staleRes.status).toBe(200);
      expect(staleRes.body.appliedCount).toBe(0);

      // Incremental pull since t1 delivers refreshed tokens (not stale)
      const deltaPull = await harnessProf1B.get<RemotePullResponse>(`/api/sync/pull?since=${t1}`);
      expect(deltaPull.status).toBe(200);
      expect(deltaPull.body.deltas.malAuth?.accessToken).toBe("mal-access-token-refreshed-2");
      expect(deltaPull.body.deltas.malAuth?.refreshToken).toBe("mal-refresh-token-refreshed-2");
      expect(deltaPull.body.deltas.malAuth?.updatedAt).toBe(t2);

      // Equal updatedAt === t2 overwrites via >= LWW tie-breaking
      const equalRes = await harnessProf1A.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
        malAuth: {
          ...refreshed,
          accessToken: "mal-access-token-tiebreak",
          updatedAt: t2,
        },
      });
      expect(equalRes.status).toBe(200);
      expect(equalRes.body.appliedCount).toBe(1);
    });

    it("2.5 replicates offline malAuth updates via server_updated_at cursor without delta miss", async () => {
      const pullA = await harnessProf1A.get<RemotePullResponse>("/api/sync/pull?since=0");
      const cursorA = pullA.body.serverTime;

      // Ensure push occurs on a strictly later server millisecond than cursorA
      await new Promise((r) => setTimeout(r, 5));

      const offlineUpdatedAt = cursorA - 120_000; // Device B was offline 2 minutes ago
      await harnessProf1B.post("/api/sync/push", {
        malAuth: {
          ...FIXTURE_MAL_AUTH_1,
          accessToken: "mal-offline-access",
          updatedAt: offlineUpdatedAt,
        },
      });

      const deltaPullA = await harnessProf1A.get<RemotePullResponse>(`/api/sync/pull?since=${cursorA}`);
      expect(deltaPullA.status).toBe(200);
      expect(deltaPullA.body.deltas.malAuth?.accessToken).toBe("mal-offline-access");
      expect(deltaPullA.body.deltas.malAuth?.updatedAt).toBe(offlineUpdatedAt);
    });
  });

  // ==========================================================================
  // 3. Deletion, Tombstone Propagation & Re-login
  // ==========================================================================
  describe("3. Deletion, Tombstone Dominance & Re-Login", () => {
    it("3.1 deletion removes mal_auth row, propagates tombstone to peer devices, blocks stale push, and allows re-login", async () => {
      const t1 = 1700000000000;
      const tDel = 1700001000000;
      const tStale = 1700000800000;
      const tRelogin = 1700002000000;

      // Seed both prof-1 and prof-2 with MAL auth
      await harnessProf1A.post("/api/sync/push", {
        malAuth: { ...FIXTURE_MAL_AUTH_1, updatedAt: t1 },
      });
      await harnessProf2.post("/api/sync/push", {
        malAuth: { ...FIXTURE_MAL_AUTH_2, updatedAt: t1 },
      });

      // Device A logs out of MAL at tDel
      const delRes = await harnessProf1A.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
        deletions: [{ type: "mal_auth", key: "default", deletedAt: tDel }],
      });
      expect(delRes.status).toBe(200);
      expect(delRes.body.appliedCount).toBe(1);

      // prof-1 row removed, prof-2 row untouched
      const row1 = await env.DB.prepare("SELECT * FROM mal_auth WHERE profile_id = 'prof-1'").first();
      const row2 = await env.DB.prepare("SELECT * FROM mal_auth WHERE profile_id = 'prof-2'").first();
      expect(row1).toBeNull();
      expect(row2).not.toBeNull();

      // Tombstone propagated to Device B on prof-1 (and NOT to prof-2)
      const pull1B = await harnessProf1B.get<RemotePullResponse>(`/api/sync/pull?since=${t1}`);
      expect(pull1B.body.deltas.malAuth).toBeNull();
      expect(pull1B.body.tombstones).toEqual([
        { type: "mal_auth", key: "default", deletedAt: tDel },
      ]);

      const pull2 = await harnessProf2.get<RemotePullResponse>("/api/sync/pull?since=0");
      expect(pull2.body.tombstones).toEqual([]);
      expect(pull2.body.deltas.malAuth?.clientId).toBe(FIXTURE_MAL_AUTH_2.clientId);

      // Stale push (updatedAt <= tDel) MUST be dropped by tombstone dominance
      const stalePush = await harnessProf1B.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
        malAuth: { ...FIXTURE_MAL_AUTH_1, accessToken: "zombie-token", updatedAt: tStale },
      });
      expect(stalePush.body.appliedCount).toBe(0);
      const equalPush = await harnessProf1B.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
        malAuth: { ...FIXTURE_MAL_AUTH_1, accessToken: "zombie-equal", updatedAt: tDel },
      });
      expect(equalPush.body.appliedCount).toBe(0);

      expect(await env.DB.prepare("SELECT * FROM mal_auth WHERE profile_id = 'prof-1'").first()).toBeNull();

      // Legitimate re-login (updatedAt > tDel) clears tombstone and restores mal_auth
      const reloginRes = await harnessProf1A.post<{ ok: boolean; appliedCount: number }>("/api/sync/push", {
        malAuth: {
          ...FIXTURE_MAL_AUTH_1,
          accessToken: "mal-relogin-access",
          refreshToken: "mal-relogin-refresh",
          updatedAt: tRelogin,
        },
      });
      expect(reloginRes.status).toBe(200);
      expect(reloginRes.body.appliedCount).toBe(1);

      const tombAfterRelogin = await env.DB.prepare(
        "SELECT * FROM tombstones WHERE profile_id = 'prof-1' AND entity_type = 'mal_auth'"
      ).first();
      expect(tombAfterRelogin).toBeNull();

      const pullAfterRelogin = await harnessProf1B.get<RemotePullResponse>("/api/sync/pull?since=0");
      expect(pullAfterRelogin.body.deltas.malAuth?.accessToken).toBe("mal-relogin-access");
      expect(pullAfterRelogin.body.deltas.malAuth?.updatedAt).toBe(tRelogin);
    });

    it("3.2 stale mal_auth deletion (deletedAt < existing.updated_at) does not wipe newer active login", async () => {
      const tNewLogin = 1700005000000;
      const tOldLogout = 1700002000000;

      await harnessProf1A.post("/api/sync/push", {
        malAuth: { ...FIXTURE_MAL_AUTH_1, updatedAt: tNewLogin },
      });

      await harnessProf1B.post("/api/sync/push", {
        deletions: [{ type: "mal_auth", key: "default", deletedAt: tOldLogout }],
      });

      const pull = await harnessProf1A.get<RemotePullResponse>("/api/sync/pull?since=0");
      expect(pull.body.deltas.malAuth?.accessToken).toBe(FIXTURE_MAL_AUTH_1.accessToken);
      expect(pull.body.deltas.malAuth?.updatedAt).toBe(tNewLogin);
    });
  });

  // ==========================================================================
  // 4. Backup Export/Import & Profile Deletion
  // ==========================================================================
  describe("4. Backup Export/Import & Profile Deletion", () => {
    it("4.1 /api/sync/export and /api/sync/import round-trip malAuth and mal_auth tombstones", async () => {
      const t1 = 1700000000000;
      const tDel = 1700001000000;

      // prof-1 has active malAuth, prof-2 has a mal_auth tombstone
      await harnessProf1A.post("/api/sync/push", {
        favorites: [FIXTURE_ANIME_1],
        malAuth: { ...FIXTURE_MAL_AUTH_1, updatedAt: t1 },
      });
      await harnessProf2.post("/api/sync/push", {
        deletions: [{ type: "mal_auth", key: "default", deletedAt: tDel }],
      });

      // Selective export for prof-1
      const exportProf1 = await harnessProf1A.get<any>("/api/sync/export?profileId=prof-1");
      expect(exportProf1.status).toBe(200);
      expect(exportProf1.body.malAuth).toHaveLength(1);
      expect(exportProf1.body.malAuth[0].profile_id).toBe("prof-1");
      expect(exportProf1.body.malAuth[0].client_id).toBe(FIXTURE_MAL_AUTH_1.clientId);

      // Full export
      const exportAll = await harnessProf1A.get<any>("/api/sync/export");
      expect(exportAll.status).toBe(200);
      expect(exportAll.body.malAuth).toHaveLength(1);
      expect(exportAll.body.tombstones.some((t: any) => t.entity_type === "mal_auth" && t.profile_id === "prof-2")).toBe(true);

      // Wipe DB and restore
      await clearDatabase(env.DB);
      await seedProfileWithDevice(env.DB, "prof-1", "Profilo Uno", TOKEN_PROF_1_DEV_A);

      const importRes = await harnessProf1A.post<{ ok: boolean }>("/api/sync/import", {
        backup: exportAll.body,
      });
      expect(importRes.status).toBe(200);
      expect(importRes.body.ok).toBe(true);

      const pullRestored = await harnessProf1A.get<RemotePullResponse>("/api/sync/pull?since=0");
      expect(pullRestored.body.deltas.malAuth?.accessToken).toBe(FIXTURE_MAL_AUTH_1.accessToken);
      expect(pullRestored.body.deltas.malAuth?.userId).toBe(FIXTURE_MAL_AUTH_1.userId);

      const restoredTomb = await env.DB.prepare(
        "SELECT * FROM tombstones WHERE profile_id = 'prof-2' AND entity_type = 'mal_auth'"
      ).first<{ deleted_at: number }>();
      expect(restoredTomb?.deleted_at).toBe(tDel);
    });

    it("4.2 /api/sync/import remains backward-compatible with legacy backups lacking malAuth", async () => {
      const legacyBackup = {
        version: 1,
        exportedAt: Date.now(),
        profiles: [{ id: "prof-legacy", name: "Legacy", avatar_color: "#E50914" }],
        favorites: [
          {
            profile_id: "prof-legacy",
            anime_id: "anime-legacy-1",
            title: "Legacy Anime",
            thumbnail: "",
            link: "",
          },
        ],
        continueWatching: [],
        watchHistory: [],
        watchProgress: [],
        sharedSettings: [],
        tombstones: [],
      };

      const res = await harnessProf1A.post<{ ok: boolean }>("/api/sync/import", legacyBackup);
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const count = await env.DB.prepare(
        "SELECT count(*) as c FROM favorites WHERE profile_id = 'prof-legacy'"
      ).first<{ c: number }>();
      expect(count?.c).toBe(1);
    });

    it("4.3 DELETE /api/profiles/:id removes mal_auth for deleted profile without affecting others", async () => {
      await harnessProf1A.post("/api/sync/push", {
        malAuth: { ...FIXTURE_MAL_AUTH_1, updatedAt: 1700000000000 },
      });
      await harnessProf2.post("/api/sync/push", {
        malAuth: { ...FIXTURE_MAL_AUTH_2, updatedAt: 1700000000000 },
      });

      const delProfileRes = await harnessProf1A.delete<{ ok: boolean; deletedId: string }>(
        "/api/profiles/prof-2"
      );
      expect(delProfileRes.status).toBe(200);
      expect(delProfileRes.body.deletedId).toBe("prof-2");

      const p2Mal = await env.DB.prepare("SELECT * FROM mal_auth WHERE profile_id = 'prof-2'").first();
      const p1Mal = await env.DB.prepare("SELECT * FROM mal_auth WHERE profile_id = 'prof-1'").first();
      expect(p2Mal).toBeNull();
      expect(p1Mal).not.toBeNull();
    });
  });
});
