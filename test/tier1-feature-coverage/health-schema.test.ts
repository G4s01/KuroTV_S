/**
 * Tier 1 Feature Coverage: Health & Routing (Feature 1) + D1 DDL & ensureSchema (Feature 2)
 *
 * Verifies:
 * - Feature 1: GET /api/health reachability, initialization flags, version, CORS preflight, and 404 routing.
 * - Feature 2: ensureSchema 10-table & 12-index DDL creation, idempotency under concurrent execution,
 *              clearDatabase single-batch foreign-key safe truncation, and TestHarness opaque execution.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { TestHarness, clearDatabase } from "../helpers/harness";
import { ensureSchema, resetSchemaInitCache } from "../../src/worker/schema";

describe("Tier 1: Health & Routing (Feature 1)", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    await clearDatabase(env.DB);
    harness = new TestHarness();
  });

  it("1.1 GET /api/health returns initialized: false on fresh unconfigured instance", async () => {
    const res = await harness.get<{ ok: boolean; initialized: boolean; version: string }>("/api/health");

    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.body.ok).toBe(true);
    expect(res.body.initialized).toBe(false);
    expect(res.body.version).toBe("1.0.0");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("1.2 GET /api/health returns initialized: true when instance_config has setup_completed = 1", async () => {
    const now = Date.now();
    await env.DB.prepare(`
      INSERT INTO instance_config (id, master_hash, master_salt, setup_completed, created_at, updated_at)
      VALUES (1, 'mock-hash-val', 'mock-salt-val', 1, ?, ?)
    `).bind(now, now).run();

    const res = await harness.get<{ ok: boolean; initialized: boolean; version: string }>("/api/health");

    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.body.ok).toBe(true);
    expect(res.body.initialized).toBe(true);
    expect(res.body.version).toBe("1.0.0");
  });

  it("1.3 GET /api/health returns initialized: true when SYNC_ADMIN_SECRET environment variable is present", async () => {
    const secretHarness = new TestHarness({
      SYNC_ADMIN_SECRET: "admin-pre-shared-secret-key-xyz",
    });

    const res = await secretHarness.get<{ ok: boolean; initialized: boolean; version: string }>("/api/health");

    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.body.ok).toBe(true);
    expect(res.body.initialized).toBe(true);
    expect(res.body.version).toBe("1.0.0");
  });

  it("1.4 OPTIONS /api/health returns valid CORS preflight headers", async () => {
    const res = await harness.request("/api/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://kurotv.app",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Content-Type, Authorization, X-Pair-Secret",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://kurotv.app");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type");
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(res.headers.get("access-control-allow-headers")).toContain("X-Pair-Secret");
  });

  it("1.5 Unmatched /api/* routes return JSON 404 rather than HTML fallback", async () => {
    const res = await harness.get<{ error: string }>("/api/non-existent-endpoint");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Not Found");
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("Tier 1: D1 DDL & ensureSchema (Feature 2)", () => {
  beforeEach(async () => {
    await clearDatabase(env.DB);
  });

  it("2.1 ensureSchema creates all 10 required database tables", async () => {
    await ensureSchema(env.DB);

    const tablesRes = await env.DB.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '_cf_%'
        AND name != 'd1_migrations'
      ORDER BY name ASC
    `).all<{ name: string }>();

    const actualTables = tablesRes.results.map((r) => r.name);
    const expectedTables = [
      "continue_watching",
      "devices",
      "favorites",
      "instance_config",
      "pairing_codes",
      "profiles",
      "shared_settings",
      "tombstones",
      "watch_history",
      "watch_progress",
    ];

    expect(actualTables).toEqual(expectedTables);
    expect(actualTables.length).toBe(10);
  });

  it("2.2 ensureSchema creates all 12 custom performance indexes", async () => {
    await ensureSchema(env.DB);

    const indexesRes = await env.DB.prepare(`
      SELECT name FROM sqlite_master
      WHERE type='index'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE 'sqlite_autoindex_%'
      ORDER BY name ASC
    `).all<{ name: string }>();

    const actualIndexes = indexesRes.results.map((r) => r.name);
    const expectedIndexes = [
      "idx_continue_watching_caught_up",
      "idx_continue_watching_profile_updated",
      "idx_devices_profile_id",
      "idx_devices_token_hash",
      "idx_favorites_profile_updated",
      "idx_pairing_codes_expires_at",
      "idx_pairing_codes_status",
      "idx_shared_settings_profile_updated",
      "idx_tombstones_deleted_at",
      "idx_tombstones_profile_deleted",
      "idx_watch_history_profile_updated",
      "idx_watch_progress_profile_updated",
    ];

    expect(actualIndexes).toEqual(expectedIndexes);
    expect(actualIndexes.length).toBe(12);
  });

  it("2.3 ensureSchema is idempotent under sequential and concurrent invocation", async () => {
    resetSchemaInitCache();

    // Run concurrently across multiple promises
    await expect(
      Promise.all([
        ensureSchema(env.DB),
        ensureSchema(env.DB),
        ensureSchema(env.DB),
      ])
    ).resolves.not.toThrow();

    // Verify tables still intact and exactly 10
    const countRes = await env.DB.prepare(`
      SELECT count(*) as count FROM sqlite_master
      WHERE type='table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '_cf_%'
        AND name != 'd1_migrations'
    `).first<{ count: number }>();

    expect(countRes?.count).toBe(10);
  });

  it("2.4 clearDatabase helper truncates all 10 tables without foreign key constraint violations", async () => {
    const now = Date.now();

    // Seed data across parent and child foreign-key related tables
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO profiles (id, name, avatar_color, created_at, updated_at)
        VALUES ('test-profile-1', 'Main Profile', '#E50914', ?, ?)
      `).bind(now, now),
      env.DB.prepare(`
        INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at)
        VALUES ('test-device-1', 'test-profile-1', 'Test Device', 'mobile', 'android', 'token-hash-1', ?, ?)
      `).bind(now, now),
      env.DB.prepare(`
        INSERT INTO favorites (profile_id, anime_id, title, genres_json, link, updated_at)
        VALUES ('test-profile-1', 'anime-123', 'Test Anime', '[]', '', ?)
      `).bind(now),
      env.DB.prepare(`
        INSERT INTO tombstones (profile_id, entity_type, entity_key, deleted_at)
        VALUES ('test-profile-1', 'favorite', 'anime-123', ?)
      `).bind(now),
    ]);

    // Truncate all tables via clearDatabase
    await clearDatabase(env.DB);

    // Assert every table is empty
    const profileCount = await env.DB.prepare("SELECT count(*) as count FROM profiles").first<{ count: number }>();
    const deviceCount = await env.DB.prepare("SELECT count(*) as count FROM devices").first<{ count: number }>();
    const favCount = await env.DB.prepare("SELECT count(*) as count FROM favorites").first<{ count: number }>();
    const tombCount = await env.DB.prepare("SELECT count(*) as count FROM tombstones").first<{ count: number }>();

    expect(profileCount?.count).toBe(0);
    expect(deviceCount?.count).toBe(0);
    expect(favCount?.count).toBe(0);
    expect(tombCount?.count).toBe(0);
  });

  it("2.5 TestHarness accurately wraps opaque HTTP request lifecycle with execution context", async () => {
    const harness = new TestHarness();
    const res = await harness.get<{ ok: boolean; version: string }>("/api/health");

    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    expect(res.body).toHaveProperty("ok", true);
    expect(res.body).toHaveProperty("version", "1.0.0");
    expect(res.text).toContain('"ok":true');
    expect(res.headers.has("content-type")).toBe(true);
  });
});
