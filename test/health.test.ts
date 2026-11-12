import { env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";
import app from "../src/worker/index";
import { ensureSchema, resetSchemaInitCache } from "../src/worker/schema";
import { KuroSyncClient } from "@kurosync/sync-client";

describe("Milestone 1: D1 Schema & Health Route", () => {
  beforeEach(async () => {
    resetSchemaInitCache();
    // Drop all tables to start each test in a clean state
    await env.DB.exec(`
      DROP TABLE IF EXISTS tombstones;
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
  });

  it("ensureSchema idempotently creates all 10 tables and 12 indexes", async () => {
    // Run schema creation first time
    await ensureSchema(env.DB);

    // Verify all 10 tables exist
    const tablesRes = await env.DB.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'"
    ).first<{ count: number }>();
    expect(tablesRes?.count).toBe(10);

    // Verify all 12 custom indexes exist
    const indexesRes = await env.DB.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'"
    ).first<{ count: number }>();
    expect(indexesRes?.count).toBe(12);

    // Run schema creation second time to test idempotency
    resetSchemaInitCache();
    await expect(ensureSchema(env.DB)).resolves.not.toThrow();

    // Verify count is still exactly 10 tables and 12 indexes
    const tablesRes2 = await env.DB.prepare(
      "SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'd1_migrations'"
    ).first<{ count: number }>();
    expect(tablesRes2?.count).toBe(10);
  });

  it("GET /api/health returns initialized: false when no setup completed and no secret", async () => {
    const req = new Request("http://localhost/api/health", { method: "GET" });
    const res = await app.fetch(req, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.initialized).toBe(false);
    expect(body.version).toBe("1.0.0");
  });

  it("GET /api/health returns initialized: true when instance_config has setup_completed = 1", async () => {
    await ensureSchema(env.DB);
    const now = Date.now();
    await env.DB.prepare(`
      INSERT INTO instance_config (id, master_hash, master_salt, setup_completed, created_at, updated_at)
      VALUES (1, 'mockhash', 'mocksalt', 1, ?, ?)
    `).bind(now, now).run();

    const req = new Request("http://localhost/api/health", { method: "GET" });
    const res = await app.fetch(req, env);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.initialized).toBe(true);
    expect(body.version).toBe("1.0.0");
  });

  it("GET /api/health returns initialized: true when SYNC_ADMIN_SECRET is provided", async () => {
    const customEnv = {
      ...env,
      SYNC_ADMIN_SECRET: "super-secret-key-123",
    };

    const req = new Request("http://localhost/api/health", { method: "GET" });
    const res = await app.fetch(req, customEnv as any);

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.initialized).toBe(true);
    expect(body.version).toBe("1.0.0");
  });

  it("GET /api/health returns HTTP 500 with JSON error when database fails during cold start", async () => {
    resetSchemaInitCache();
    const brokenDb = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "batch") {
          return () => Promise.reject(new Error("SQLITE_BUSY: database is locked"));
        }
        return Reflect.get(target, prop);
      },
    });

    const req = new Request("http://localhost/api/health", { method: "GET" });
    const res = await app.fetch(req, { ...env, DB: brokenDb });

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as any;
    expect(body).toEqual({
      ok: false,
      initialized: false,
      version: "1.0.0",
      error: "SQLITE_BUSY: database is locked",
    });
  });

  it("GET /api/health returns HTTP 200 with initialized: true when SYNC_ADMIN_SECRET is set even if DB fails", async () => {
    resetSchemaInitCache();
    const brokenDb = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "batch") {
          return () => Promise.reject(new Error("SQLITE_BUSY: database is locked"));
        }
        return Reflect.get(target, prop);
      },
    });

    const customEnv = {
      ...env,
      SYNC_ADMIN_SECRET: "admin-secret-xyz",
      DB: brokenDb,
    };

    const req = new Request("http://localhost/api/health", { method: "GET" });
    const res = await app.fetch(req, customEnv as any);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as any;
    expect(body).toEqual({
      ok: true,
      initialized: true,
      version: "1.0.0",
    });
  });

  it("app.onError returns JSON 500 when an unhandled error occurs on an API route", async () => {
    resetSchemaInitCache();
    const brokenDb = new Proxy(env.DB, {
      get(target, prop) {
        if (prop === "batch") {
          return () => Promise.reject(new Error("Database disconnected"));
        }
        return Reflect.get(target, prop);
      },
    });

    const req = new Request("http://localhost/api/sync/pull", { method: "POST" });
    const res = await app.fetch(req, { ...env, DB: brokenDb });

    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as any;
    expect(body).toEqual({
      error: "Database disconnected",
    });
  });

  it("OPTIONS /api/health responds with CORS preflight headers", async () => {
    const req = new Request("http://localhost/api/health", {
      method: "OPTIONS",
      headers: {
        Origin: "https://kurotv.app",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "Content-Type, Authorization",
      },
    });
    const res = await app.fetch(req, env);

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("https://kurotv.app");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });

  it("GET /api/nonexistent returns JSON 404", async () => {
    const req = new Request("http://localhost/api/nonexistent", { method: "GET" });
    const res = await app.fetch(req, env);

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toBe("Not Found");
  });

  it("KuroSyncClient correctly formats and parses health check", async () => {
    // Intercept or test client against app.fetch
    const client = new KuroSyncClient({ baseUrl: "https://kurosync.local" });
    expect(client.options.baseUrl).toBe("https://kurosync.local");

    // Test client with real fetch mocked to worker app
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const req = new Request(url, init);
      return app.fetch(req, env);
    };

    try {
      const health = await client.checkHealth();
      expect(health.ok).toBe(true);
      expect(health.version).toBe("1.0.0");
      expect(typeof health.initialized).toBe("boolean");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
