import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteD1Database } from "../../src/server/d1-sqlite";
import { runMigrations } from "../../src/server/migrations";
import { createKuroNodeServer, type KuroNodeServerInstance } from "../../src/server/server";
import { resetRateLimits } from "../../src/worker/rate-limit";
import { ensureSchema, resetSchemaInitCache } from "../../src/worker/schema";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

function makeTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createStaticFixtureDir(rootDir: string): string {
  const staticDir = path.join(rootDir, "static");
  fs.mkdirSync(path.join(staticDir, "assets"), { recursive: true });
  fs.writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><html><body>KUROSYNC_SPA</body></html>");
  fs.writeFileSync(path.join(staticDir, "icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(staticDir, "assets", "app.js"), "console.log('kuro');");
  return staticDir;
}

describe("Docker / Node.js Self-Hosted Runtime & SQLite Adapter", () => {
  const cleanupDirs: string[] = [];
  const activeServers: KuroNodeServerInstance[] = [];

  beforeEach(() => {
    resetRateLimits();
    resetSchemaInitCache();
  });

  afterEach(async () => {
    while (activeServers.length > 0) {
      const srv = activeServers.pop()!;
      await srv.close();
    }
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop()!;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("SqliteD1Database + runMigrations creates all 11 tables, 13 indexes, enforces FK cascade and atomic batch rollback", async () => {
    const tmp = makeTempDir("kuro-sqlite-");
    cleanupDirs.push(tmp);
    const dbPath = path.join(tmp, "kurosync.db");

    const db = new SqliteD1Database(dbPath);
    try {
      const report = await runMigrations(db, MIGRATIONS_DIR);
      expect(report.applied).toEqual([
        "0001_init.sql",
        "0002_server_replication_cursor.sql",
        "0003_mal_auth.sql",
      ]);

      // Re-running migrations should skip all already applied
      const secondReport = await runMigrations(db, MIGRATIONS_DIR);
      expect(secondReport.applied).toEqual([]);
      expect(secondReport.skipped).toEqual(report.applied);

      const tables = await db
        .prepare(
          "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations'"
        )
        .first<{ count: number }>();
      expect(tables?.count).toBe(11);

      const indexes = await db
        .prepare("SELECT count(*) as count FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
        .first<{ count: number }>();
      expect(indexes?.count).toBe(13);

      // first() returns null (not undefined) when no row matches
      const missing = await db.prepare("SELECT id FROM profiles WHERE id = ?").bind("missing").first();
      expect(missing).toBeNull();

      // batch() atomicity: fail on second statement -> first statement must roll back
      const now = Date.now();
      await expect(
        db.batch([
          db
            .prepare("INSERT INTO profiles (id, name, avatar_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
            .bind("prof-rollback", "Rollback", "#E50914", now, now),
          db
            .prepare("INSERT INTO instance_config (id, master_hash, master_salt, setup_completed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(99, "h", "s", 1, now, now), // violates CHECK (id = 1)
        ])
      ).rejects.toThrow();

      const afterRollback = await db
        .prepare("SELECT id FROM profiles WHERE id = ?")
        .bind("prof-rollback")
        .first();
      expect(afterRollback).toBeNull();

      // Foreign key CASCADE verification
      await db
        .prepare("INSERT INTO profiles (id, name, avatar_color, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind("prof-fk", "FK Profile", "#E50914", now, now)
        .run();
      await db
        .prepare(
          "INSERT INTO favorites (profile_id, anime_id, title, updated_at, server_updated_at) VALUES (?, ?, ?, ?, ?)"
        )
        .bind("prof-fk", "anime-1", "Show", now, now)
        .run();

      const delRes = await db.prepare("DELETE FROM profiles WHERE id = ?").bind("prof-fk").run();
      expect(delRes.meta.changes).toBe(1);

      const orphanFav = await db
        .prepare("SELECT anime_id FROM favorites WHERE profile_id = ?")
        .bind("prof-fk")
        .first();
      expect(orphanFav).toBeNull();
    } finally {
      db.closeGracefully();
    }
  });

  it("runMigrations handles existing database previously bootstrapped via ensureSchema without d1_migrations", async () => {
    const tmp = makeTempDir("kuro-legacy-");
    cleanupDirs.push(tmp);
    const dbPath = path.join(tmp, "legacy.db");

    const db = new SqliteD1Database(dbPath);
    try {
      await ensureSchema(db);
      const report = await runMigrations(db, MIGRATIONS_DIR);
      expect(report.applied).toEqual([]);
      expect(report.skipped).toEqual([
        "0001_init.sql",
        "0002_server_replication_cursor.sql",
        "0003_mal_auth.sql",
      ]);
    } finally {
      db.closeGracefully();
    }
  });

  it("serves full REST API, SPA fallback, persistence across restarts, and Read-Only mode", async () => {
    const tmp = makeTempDir("kuro-e2e-");
    cleanupDirs.push(tmp);
    const dataDir = path.join(tmp, "data");
    const dbPath = path.join(dataDir, "kurosync.db");
    const staticDir = createStaticFixtureDir(tmp);

    const srv = await createKuroNodeServer({
      port: 0,
      host: "127.0.0.1",
      dataDir,
      dbPath,
      migrationsDir: MIGRATIONS_DIR,
      staticDir,
      trustProxy: true,
      maintenanceIntervalMs: 0,
    });
    activeServers.push(srv);
    const baseUrl = `http://127.0.0.1:${srv.port}`;

    // 1. Static SPA routing & API 404
    const homeRes = await fetch(`${baseUrl}/`);
    expect(homeRes.status).toBe(200);
    expect(await homeRes.text()).toContain("KUROSYNC_SPA");

    const malRouteRes = await fetch(`${baseUrl}/mal`);
    expect(malRouteRes.status).toBe(200);
    expect(await malRouteRes.text()).toContain("KUROSYNC_SPA");

    const malCallbackRes = await fetch(`${baseUrl}/mal-callback?code=test&state=123`);
    expect(malCallbackRes.status).toBe(200);
    expect(await malCallbackRes.text()).toContain("KUROSYNC_SPA");

    const assetRes = await fetch(`${baseUrl}/assets/app.js`);
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get("cache-control")).toContain("immutable");

    const missingAssetRes = await fetch(`${baseUrl}/assets/does-not-exist.js`);
    expect(missingAssetRes.status).toBe(404);

    const apiNotFound = await fetch(`${baseUrl}/api/does-not-exist`);
    expect(apiNotFound.status).toBe(404);
    expect(((await apiNotFound.json()) as any).error).toBe("Not Found");

    // 2. Setup Wizard + Login + Profile + Pairing + Sync + Export
    const healthBefore = await (await fetch(`${baseUrl}/api/health`)).json();
    expect(healthBefore).toEqual({ ok: true, initialized: false, version: "1.0.0" });

    const setupRes = await fetch(`${baseUrl}/api/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        masterPassword: "SuperSecretPassword123!",
        initialProfileName: "Casa",
        createSession: true,
      }),
    });
    expect(setupRes.status).toBe(200);
    const setupData: any = await setupRes.json();
    expect(setupData.ok).toBe(true);
    expect(setupData.sessionToken).toMatch(/^kuro_sess_/);
    const token = setupData.sessionToken as string;
    const profileId = setupData.profileId as string;

    const healthAfter = await (await fetch(`${baseUrl}/api/health`)).json();
    expect(healthAfter).toEqual({ ok: true, initialized: true, version: "1.0.0" });

    // 3. Nginx Proxy Manager reverse proxy headers -> verifyUrl HTTPS
    const pairStartRes = await fetch(`${baseUrl}/api/pair/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "kurosync.example.com",
        "X-Forwarded-For": "203.0.113.42",
      },
      body: JSON.stringify({
        deviceName: "Living Room TV",
        deviceType: "tv",
        platform: "android-tv",
      }),
    });
    expect(pairStartRes.status).toBe(201);
    const pairData: any = await pairStartRes.json();
    expect(pairData.verifyUrl).toBe(`https://kurosync.example.com/pair?code=${pairData.code}`);

    const approveRes = await fetch(`${baseUrl}/api/pair/approve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ code: pairData.code, profileId }),
    });
    expect(approveRes.status).toBe(200);

    const statusRes = await fetch(
      `${baseUrl}/api/pair/status?code=${encodeURIComponent(pairData.code)}`,
      { headers: { "X-Pair-Secret": pairData.pairSecret } }
    );
    expect(statusRes.status).toBe(200);
    const statusJson: any = await statusRes.json();
    expect(statusJson.status).toBe("approved");
    expect(statusJson.deviceToken).toMatch(/^kuro_tv_/);

    // 4. Push data + malAuth + pull + export
    const now = Date.now();
    const pushRes = await fetch(`${baseUrl}/api/sync/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        favorites: [
          {
            id: "one-piece",
            title: "One Piece",
            thumbnail: "https://example.com/op.jpg",
            updatedAt: now,
          },
        ],
        malAuth: {
          clientId: "abcd1234efgh5678ijkl9012mnop3456",
          accessToken: "mal-access-1",
          refreshToken: "mal-refresh-1",
          expiresAt: now + 3600_000,
          tokenType: "Bearer",
          username: "kurotester",
          updatedAt: now,
        },
      }),
    });
    expect(pushRes.status).toBe(200);
    expect(((await pushRes.json()) as any).appliedCount).toBe(2);

    // Restart server against the SAME external directory to verify SQLite persistence
    await srv.close();
    activeServers.pop();
    expect(fs.existsSync(dbPath)).toBe(true);

    const srvRestarted = await createKuroNodeServer({
      port: 0,
      host: "127.0.0.1",
      dataDir,
      dbPath,
      migrationsDir: MIGRATIONS_DIR,
      staticDir,
      trustProxy: true,
      publicUrl: "https://override.example.org",
      maintenanceIntervalMs: 0,
    });
    activeServers.push(srvRestarted);
    const restartedUrl = `http://127.0.0.1:${srvRestarted.port}`;

    const pullRes = await fetch(`${restartedUrl}/api/sync/pull?since=0`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(pullRes.status).toBe(200);
    const pullJson: any = await pullRes.json();
    expect(pullJson.deltas.favorites).toHaveLength(1);
    expect(pullJson.deltas.favorites[0].id).toBe("one-piece");
    expect(pullJson.deltas.malAuth.username).toBe("kurotester");

    // PUBLIC_URL takes precedence over X-Forwarded-Host
    const pairWithPublicUrl = await fetch(`${restartedUrl}/api/pair/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-Proto": "http",
        "X-Forwarded-Host": "spoofed.local",
      },
      body: JSON.stringify({ deviceName: "Bedroom TV" }),
    });
    const pairPublicData: any = await pairWithPublicUrl.json();
    expect(pairPublicData.verifyUrl).toBe(
      `https://override.example.org/pair?code=${pairPublicData.code}`
    );

    // 5. Switch to Read-Only mode on existing DB file
    await srvRestarted.close();
    activeServers.pop();

    const srvReadOnly = await createKuroNodeServer({
      port: 0,
      host: "127.0.0.1",
      dataDir,
      dbPath,
      migrationsDir: MIGRATIONS_DIR,
      staticDir,
      readOnly: true,
      maintenanceIntervalMs: 0,
    });
    activeServers.push(srvReadOnly);
    const roUrl = `http://127.0.0.1:${srvReadOnly.port}`;

    // Authenticated GET still succeeds (last_seen_at write error is non-fatal in RO)
    const roPull = await fetch(`${roUrl}/api/sync/pull?since=0`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(roPull.status).toBe(200);
    expect(((await roPull.json()) as any).deltas.favorites).toHaveLength(1);

    // Mutating requests are rejected cleanly in RO mode
    const roPush = await fetch(`${roUrl}/api/sync/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ favorites: [] }),
    });
    expect(roPush.status).toBe(403);
    expect(((await roPush.json()) as any).error).toBe("Read-Only Mode");
  });

  it("isolates rate limiting by X-Forwarded-For when trustProxy=true and blocks header spoofing when trustProxy=false", async () => {
    const tmp = makeTempDir("kuro-rl-");
    cleanupDirs.push(tmp);
    const staticDir = createStaticFixtureDir(tmp);

    // 1. trustProxy: true -> distinct X-Forwarded-For IPs have independent buckets
    const srvTrusted = await createKuroNodeServer({
      port: 0,
      host: "127.0.0.1",
      dataDir: tmp,
      dbPath: path.join(tmp, "trusted.db"),
      migrationsDir: MIGRATIONS_DIR,
      staticDir,
      trustProxy: true,
      syncAdminSecret: "correct-secret",
      maintenanceIntervalMs: 0,
    });
    activeServers.push(srvTrusted);
    const trustedUrl = `http://127.0.0.1:${srvTrusted.port}`;

    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${trustedUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100.10",
        },
        body: JSON.stringify({ password: "wrong" }),
      });
      expect(res.status).toBe(401);
    }

    const blockedIp1 = await fetch(`${trustedUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "198.51.100.10",
      },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(blockedIp1.status).toBe(429);

    const otherClientIp = await fetch(`${trustedUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "198.51.100.20",
      },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(otherClientIp.status).toBe(401);

    await srvTrusted.close();
    activeServers.pop();
    resetRateLimits();

    // 2. trustProxy: false -> spoofed X-Forwarded-For headers are stripped, socket IP is enforced
    const srvUntrusted = await createKuroNodeServer({
      port: 0,
      host: "127.0.0.1",
      dataDir: tmp,
      dbPath: path.join(tmp, "untrusted.db"),
      migrationsDir: MIGRATIONS_DIR,
      staticDir,
      trustProxy: false,
      syncAdminSecret: "correct-secret",
      maxBodyBytes: 64,
      maintenanceIntervalMs: 0,
    });
    activeServers.push(srvUntrusted);
    const untrustedUrl = `http://127.0.0.1:${srvUntrusted.port}`;

    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${untrustedUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": `203.0.113.${i + 1}`,
        },
        body: JSON.stringify({ password: "wrong" }),
      });
      expect(res.status).toBe(401);
    }

    const sixthSpoofed = await fetch(`${untrustedUrl}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.250",
      },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(sixthSpoofed.status).toBe(429);

    // Payload exceeding MAX_BODY_BYTES returns 413
    const oversized = await fetch(`${untrustedUrl}/api/sync/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(200) }),
    });
    expect(oversized.status).toBe(413);
  });
});
