import { Hono } from "hono";
import type { AppEnv, HealthResponse } from "../types";
import { ensureSchema } from "../schema";

export const healthRouter = new Hono<AppEnv>();

healthRouter.get("/health", async (c) => {
  let initialized = false;

  try {
    // 1. Check if SYNC_ADMIN_SECRET is configured in environment (Hybrid Zero-Config)
    if (c.env.SYNC_ADMIN_SECRET && c.env.SYNC_ADMIN_SECRET.trim() !== "") {
      initialized = true;
    } else if (c.env.DB) {
      // 2. Ensure schema exists idempotently
      await ensureSchema(c.env.DB);

      // 3. Query instance_config table for setup_completed status
      const row = await c.env.DB.prepare(
        "SELECT setup_completed FROM instance_config WHERE id = 1"
      ).first<{ setup_completed: number }>();

      initialized = row?.setup_completed === 1;
    }

    const response: HealthResponse = {
      ok: true,
      initialized,
      version: "1.0.0",
    };

    return c.json(response, 200);
  } catch (err) {
    const errorResponse: HealthResponse = {
      ok: false,
      initialized: false,
      version: "1.0.0",
      error: err instanceof Error ? err.message : "Database error",
    };

    return c.json(errorResponse, 500);
  }
});
