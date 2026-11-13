import { Hono, type Context } from "hono";
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

// Update device details (custom device name or profile association)
async function handleUpdateDevice(c: Context<AppEnv>) {
  const id = c.req.param("id");
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { name, profileId } = body || {};

  const existing = await c.env.DB.prepare(
    "SELECT id, profile_id, name, device_type, platform, last_seen_at, created_at, revoked_at FROM devices WHERE id = ?"
  )
    .bind(id)
    .first<{
      id: string;
      profile_id: string;
      name: string;
      device_type: string;
      platform: string;
      last_seen_at: number;
      created_at: number;
      revoked_at: number | null;
    }>();

  if (!existing) {
    return c.json({ error: "Device not found" }, 404);
  }

  let newName = existing.name;
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return c.json({ error: "Device name cannot be empty" }, 400);
    }
    newName = name.trim().slice(0, 50);
  }

  let newProfileId = existing.profile_id;
  if (profileId !== undefined && typeof profileId === "string" && profileId.trim().length > 0) {
    const profile = await c.env.DB.prepare("SELECT id FROM profiles WHERE id = ?")
      .bind(profileId.trim())
      .first();
    if (!profile) {
      return c.json({ error: "Profile not found" }, 404);
    }
    newProfileId = profileId.trim();
  }

  await c.env.DB.prepare(
    "UPDATE devices SET name = ?, profile_id = ? WHERE id = ?"
  )
    .bind(newName, newProfileId, id)
    .run();

  return c.json(
    {
      ok: true,
      device: {
        ...existing,
        name: newName,
        profile_id: newProfileId,
      },
    },
    200
  );
}

devicesRouter.put("/devices/:id", handleUpdateDevice);
devicesRouter.patch("/devices/:id", handleUpdateDevice);

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
