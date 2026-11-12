import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import { hashToken } from "../crypto";

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return c.json(
      {
        error: "Unauthorized",
        message: "Missing or invalid Authorization header",
      },
      401
    );
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return c.json(
      {
        error: "Unauthorized",
        message: "Empty token",
      },
      401
    );
  }

  const tokenHash = await hashToken(token);
  const now = Date.now();

  const device = await c.env.DB.prepare(
    "SELECT id, profile_id, revoked_at FROM devices WHERE token_hash = ?"
  )
    .bind(tokenHash)
    .first<{ id: string; profile_id: string; revoked_at: number | null }>();

  if (!device || device.revoked_at !== null) {
    return c.json(
      {
        error: "Unauthorized",
        message: "Invalid or revoked token",
      },
      401
    );
  }

  // Update last seen timestamp
  if (c.executionCtx && typeof c.executionCtx.waitUntil === "function") {
    c.executionCtx.waitUntil(
      c.env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?")
        .bind(now, device.id)
        .run()
    );
  } else {
    await c.env.DB.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?")
      .bind(now, device.id)
      .run();
  }

  c.set("profileId", device.profile_id);
  c.set("deviceId", device.id);

  await next();
};

export const requireAuth = authMiddleware;
