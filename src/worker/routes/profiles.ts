import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/auth";

export const profilesRouter = new Hono<AppEnv>();

// Protected: all profile operations require valid authentication
profilesRouter.use("/profiles*", requireAuth);

/**
 * GET /api/profiles
 * List all profiles for the authenticated user instance.
 */
profilesRouter.get("/profiles", async (c) => {
  const rows = await c.env.DB.prepare(`
    SELECT id, name, avatar_color, created_at, updated_at
    FROM profiles
    ORDER BY created_at ASC
  `).all<{
    id: string;
    name: string;
    avatar_color: string;
    created_at: number;
    updated_at: number;
  }>();

  const profiles = (rows.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    avatar_color: row.avatar_color,
    avatarColor: row.avatar_color,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return c.json({ ok: true, profiles }, 200);
});

/**
 * GET /api/profiles/:id
 * Retrieve a single profile by ID.
 */
profilesRouter.get("/profiles/:id", async (c) => {
  const id = c.req.param("id");
  const existing = await c.env.DB.prepare(`
    SELECT id, name, avatar_color, created_at, updated_at
    FROM profiles
    WHERE id = ?
  `)
    .bind(id)
    .first<{
      id: string;
      name: string;
      avatar_color: string;
      created_at: number;
      updated_at: number;
    }>();

  if (!existing) {
    return c.json({ error: "Profile not found" }, 404);
  }

  return c.json(
    {
      ok: true,
      profile: {
        id: existing.id,
        name: existing.name,
        avatar_color: existing.avatar_color,
        avatarColor: existing.avatar_color,
        created_at: existing.created_at,
        updated_at: existing.updated_at,
      },
    },
    200
  );
});

/**
 * POST /api/profiles
 * Create a new profile with name and optional avatarColor.
 */
profilesRouter.post("/profiles", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const name = body?.name;
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return c.json({ error: "name is required and must not be empty" }, 400);
  }

  const rawColor =
    typeof body?.avatarColor === "string"
      ? body.avatarColor
      : typeof body?.avatar_color === "string"
      ? body.avatar_color
      : "";
  const avatarColor = rawColor.trim() || "#E50914";
  const id = crypto.randomUUID();
  const now = Date.now();

  await c.env.DB.prepare(`
    INSERT INTO profiles (id, name, avatar_color, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `)
    .bind(id, name.trim(), avatarColor, now, now)
    .run();

  return c.json(
    {
      ok: true,
      profile: {
        id,
        name: name.trim(),
        avatar_color: avatarColor,
        avatarColor,
        created_at: now,
        updated_at: now,
      },
    },
    201
  );
});

/**
 * PUT /api/profiles/:id
 * Update an existing profile (name and/or avatarColor).
 */
profilesRouter.put("/profiles/:id", async (c) => {
  const id = c.req.param("id");
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const existing = await c.env.DB.prepare(`
    SELECT id, name, avatar_color, created_at, updated_at
    FROM profiles
    WHERE id = ?
  `)
    .bind(id)
    .first<{
      id: string;
      name: string;
      avatar_color: string;
      created_at: number;
      updated_at: number;
    }>();

  if (!existing) {
    return c.json({ error: "Profile not found" }, 404);
  }

  const updatedName =
    typeof body?.name === "string" && body.name.trim().length > 0
      ? body.name.trim()
      : existing.name;

  const rawUpdatedColor =
    typeof body?.avatarColor === "string"
      ? body.avatarColor
      : typeof body?.avatar_color === "string"
      ? body.avatar_color
      : undefined;

  const updatedColor =
    rawUpdatedColor !== undefined && rawUpdatedColor.trim().length > 0
      ? rawUpdatedColor.trim()
      : existing.avatar_color;

  const now = Date.now();

  await c.env.DB.prepare(`
    UPDATE profiles
    SET name = ?, avatar_color = ?, updated_at = ?
    WHERE id = ?
  `)
    .bind(updatedName, updatedColor, now, id)
    .run();

  return c.json(
    {
      ok: true,
      profile: {
        id,
        name: updatedName,
        avatar_color: updatedColor,
        avatarColor: updatedColor,
        created_at: existing.created_at,
        updated_at: now,
      },
    },
    200
  );
});

/**
 * DELETE /api/profiles/:id
 * Delete a profile and purge all associated viewing data atomically.
 */
profilesRouter.delete("/profiles/:id", async (c) => {
  const id = c.req.param("id");

  const existing = await c.env.DB.prepare("SELECT id FROM profiles WHERE id = ?")
    .bind(id)
    .first<{ id: string }>();

  if (!existing) {
    return c.json({ error: "Profile not found" }, 404);
  }

  // Atomically clean up all associated viewing data and cascade
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM favorites WHERE profile_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM continue_watching WHERE profile_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM watch_history WHERE profile_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM watch_progress WHERE profile_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM shared_settings WHERE profile_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM tombstones WHERE profile_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM devices WHERE profile_id = ?").bind(id),
    c.env.DB.prepare("UPDATE pairing_codes SET approved_profile_id = NULL WHERE approved_profile_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM profiles WHERE id = ?").bind(id),
  ]);

  return c.json({ ok: true, deletedId: id }, 200);
});
