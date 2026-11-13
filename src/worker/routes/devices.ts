import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/auth";

export const devicesRouter = new Hono<AppEnv>();

devicesRouter.use("/devices*", requireAuth);

devicesRouter.get("/devices", async (c) => {
  const profileIdQuery = c.req.query("profileId");

  let results;
  if (profileIdQuery && profileIdQuery.trim().length > 0) {
    results = await c.env.DB.prepare(`
      SELECT id, profile_id, name, device_type, platform, last_seen_at, created_at, revoked_at
      FROM devices
      WHERE profile_id = ?
      ORDER BY COALESCE(last_seen_at, created_at) DESC
    `)
      .bind(profileIdQuery.trim())
      .all();
  } else {
    results = await c.env.DB.prepare(`
      SELECT id, profile_id, name, device_type, platform, last_seen_at, created_at, revoked_at
      FROM devices
      ORDER BY COALESCE(last_seen_at, created_at) DESC
    `).all();
  }

  return c.json({ ok: true, devices: results.results }, 200);
});

// Purge all revoked devices in bulk
devicesRouter.delete("/devices/revoked", async (c) => {
  const profileIdQuery = c.req.query("profileId");
  let res;
  if (profileIdQuery && profileIdQuery.trim().length > 0) {
    res = await c.env.DB.prepare(
      "DELETE FROM devices WHERE revoked_at IS NOT NULL AND profile_id = ?"
    )
      .bind(profileIdQuery.trim())
      .run();
  } else {
    res = await c.env.DB.prepare("DELETE FROM devices WHERE revoked_at IS NOT NULL").run();
  }
  return c.json({ ok: true, purgedCount: res.meta.changes }, 200);
});

// Delete or revoke device
devicesRouter.delete("/devices/:id", async (c) => {
  const id = c.req.param("id");
  const purge = c.req.query("purge") === "true";
  const now = Date.now();

  const existing = await c.env.DB.prepare(
    "SELECT id, revoked_at FROM devices WHERE id = ?"
  )
    .bind(id)
    .first<{ id: string; revoked_at: number | null }>();

  if (!existing) {
    return c.json({ error: "Device not found" }, 404);
  }

  // If purge is explicitly requested OR if the device was already revoked, delete permanently
  if (purge || existing.revoked_at !== null) {
    await c.env.DB.prepare("DELETE FROM devices WHERE id = ?").bind(id).run();
    return c.json({ ok: true, deletedId: id, purged: true }, 200);
  }

  // First deletion on active device marks it as revoked
  await c.env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?")
    .bind(now, id)
    .run();

  return c.json({ ok: true, revokedId: id, revokedAt: now }, 200);
});
