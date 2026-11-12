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
      ORDER BY created_at DESC
    `)
      .bind(profileIdQuery.trim())
      .all();
  } else {
    results = await c.env.DB.prepare(`
      SELECT id, profile_id, name, device_type, platform, last_seen_at, created_at, revoked_at
      FROM devices
      ORDER BY created_at DESC
    `).all();
  }

  return c.json({ ok: true, devices: results.results }, 200);
});

devicesRouter.delete("/devices/:id", async (c) => {
  const id = c.req.param("id");
  const now = Date.now();

  const res = await c.env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?")
    .bind(now, id)
    .run();

  if (res.meta.changes === 0) {
    return c.json({ error: "Device not found" }, 404);
  }

  return c.json({ ok: true, revokedId: id, revokedAt: now }, 200);
});
