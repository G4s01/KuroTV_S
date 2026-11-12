import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/auth";

export const backupRouter = new Hono<AppEnv>();

backupRouter.use("/sync/export", requireAuth);
backupRouter.use("/sync/import", requireAuth);

backupRouter.get("/sync/export", async (c) => {
  const profileIdQuery = c.req.query("profileId");
  const authProfileId = c.get("profileId");
  const targetProfileId = profileIdQuery || authProfileId;

  // If specific profile is queried: export only that profile's data
  // If targetProfileId is omitted or requested as full instance, export all
  const profileFilter = profileIdQuery ? "WHERE profile_id = ?" : "";
  const profileArgs = profileIdQuery ? [profileIdQuery] : [];

  const [profiles, favorites, cw, wh, wp, ss, tombstones] = await Promise.all([
    profileIdQuery
      ? c.env.DB.prepare("SELECT * FROM profiles WHERE id = ?").bind(profileIdQuery).all()
      : c.env.DB.prepare("SELECT * FROM profiles").all(),

    c.env.DB.prepare(`SELECT * FROM favorites ${profileFilter}`)
      .bind(...profileArgs)
      .all(),

    c.env.DB.prepare(`SELECT * FROM continue_watching ${profileFilter}`)
      .bind(...profileArgs)
      .all(),

    c.env.DB.prepare(`SELECT * FROM watch_history ${profileFilter}`)
      .bind(...profileArgs)
      .all(),

    c.env.DB.prepare(`SELECT * FROM watch_progress ${profileFilter}`)
      .bind(...profileArgs)
      .all(),

    c.env.DB.prepare(`SELECT * FROM shared_settings ${profileFilter}`)
      .bind(...profileArgs)
      .all(),

    c.env.DB.prepare(`SELECT * FROM tombstones ${profileFilter}`)
      .bind(...profileArgs)
      .all(),
  ]);

  const backupData = {
    version: 1,
    exportedAt: Date.now(),
    profiles: profiles.results || [],
    favorites: favorites.results || [],
    continueWatching: cw.results || [],
    watchHistory: wh.results || [],
    watchProgress: wp.results || [],
    sharedSettings: ss.results || [],
    tombstones: tombstones.results || [],
  };

  return c.json(backupData, 200);
});

backupRouter.post("/sync/import", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const backup = body?.backup || body;
  if (!backup || typeof backup !== "object") {
    return c.json({ error: "Invalid backup format" }, 400);
  }

  const {
    profiles = [],
    favorites = [],
    continueWatching = [],
    watchHistory = [],
    watchProgress = [],
    sharedSettings = [],
    tombstones = [],
  } = backup;

  const statements: D1PreparedStatement[] = [];

  // 1. Profiles
  for (const p of profiles) {
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO profiles (id, name, avatar_color, pin_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          avatar_color = excluded.avatar_color,
          pin_hash = excluded.pin_hash,
          updated_at = excluded.updated_at
      `).bind(
        p.id,
        p.name,
        p.avatar_color || "#E50914",
        p.pin_hash || null,
        p.created_at || Date.now(),
        p.updated_at || Date.now()
      )
    );
  }

  // 2. Favorites
  for (const f of favorites) {
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO favorites (
          profile_id, anime_id, title, japanese_title, thumbnail, type,
          release_year, status, total_episodes, genres_json, link, sub_or_dub, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_id, anime_id) DO UPDATE SET
          title = excluded.title,
          japanese_title = excluded.japanese_title,
          thumbnail = excluded.thumbnail,
          type = excluded.type,
          release_year = excluded.release_year,
          status = excluded.status,
          total_episodes = excluded.total_episodes,
          genres_json = excluded.genres_json,
          link = excluded.link,
          sub_or_dub = excluded.sub_or_dub,
          updated_at = excluded.updated_at
      `).bind(
        f.profile_id,
        f.anime_id,
        f.title,
        f.japanese_title || null,
        f.thumbnail,
        f.type || "TV",
        f.release_year || null,
        f.status || null,
        f.total_episodes ? String(f.total_episodes) : null,
        f.genres_json || "[]",
        f.link,
        f.sub_or_dub || "SUB",
        f.updated_at || Date.now()
      )
    );
  }

  // 3. Continue Watching
  for (const cw of continueWatching) {
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO continue_watching (
          profile_id, anime_id, title, thumbnail, episode_id, episode_number,
          total_episodes, position, duration, percentage, is_caught_up,
          last_checked_at, updated_at, data_id, server_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_id, anime_id) DO UPDATE SET
          title = excluded.title,
          thumbnail = excluded.thumbnail,
          episode_id = excluded.episode_id,
          episode_number = excluded.episode_number,
          total_episodes = excluded.total_episodes,
          position = excluded.position,
          duration = excluded.duration,
          percentage = excluded.percentage,
          is_caught_up = excluded.is_caught_up,
          last_checked_at = excluded.last_checked_at,
          updated_at = excluded.updated_at,
          data_id = excluded.data_id,
          server_id = excluded.server_id
      `).bind(
        cw.profile_id,
        cw.anime_id,
        cw.title,
        cw.thumbnail,
        cw.episode_id,
        cw.episode_number,
        cw.total_episodes || null,
        cw.position,
        cw.duration,
        cw.percentage,
        cw.is_caught_up || 0,
        cw.last_checked_at || Date.now(),
        cw.updated_at || Date.now(),
        cw.data_id || null,
        cw.server_id || null
      )
    );
  }

  // 4. Watch History
  for (const wh of watchHistory) {
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO watch_history (
          profile_id, anime_id, episode_number, episode_id, title, thumbnail,
          position, duration, progress_percent, is_completed, data_id, server_id, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_id, anime_id, episode_number) DO UPDATE SET
          episode_id = excluded.episode_id,
          title = excluded.title,
          thumbnail = excluded.thumbnail,
          position = excluded.position,
          duration = excluded.duration,
          progress_percent = excluded.progress_percent,
          is_completed = excluded.is_completed,
          data_id = excluded.data_id,
          server_id = excluded.server_id,
          updated_at = excluded.updated_at
      `).bind(
        wh.profile_id,
        wh.anime_id,
        wh.episode_number,
        wh.episode_id,
        wh.title,
        wh.thumbnail,
        wh.position,
        wh.duration,
        wh.progress_percent,
        wh.is_completed || 0,
        wh.data_id || null,
        wh.server_id || null,
        wh.updated_at || Date.now()
      )
    );
  }

  // 5. Watch Progress
  for (const wp of watchProgress) {
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO watch_progress (
          profile_id, anime_id, episode_number, anime_title, thumbnail,
          episode_id, total_episodes, "current_time", duration, percentage,
          is_completed, data_id, server_id, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_id, anime_id, episode_number) DO UPDATE SET
          anime_title = excluded.anime_title,
          thumbnail = excluded.thumbnail,
          episode_id = excluded.episode_id,
          total_episodes = excluded.total_episodes,
          "current_time" = excluded."current_time",
          duration = excluded.duration,
          percentage = excluded.percentage,
          is_completed = excluded.is_completed,
          data_id = excluded.data_id,
          server_id = excluded.server_id,
          updated_at = excluded.updated_at
      `).bind(
        wp.profile_id,
        wp.anime_id,
        wp.episode_number,
        wp.anime_title,
        wp.thumbnail,
        wp.episode_id,
        wp.total_episodes || null,
        wp.current_time,
        wp.duration,
        wp.percentage,
        wp.is_completed || 0,
        wp.data_id || null,
        wp.server_id || null,
        wp.updated_at || Date.now()
      )
    );
  }

  // 6. Shared Settings
  for (const ss of sharedSettings) {
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO shared_settings (profile_id, key, value_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id, key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `).bind(ss.profile_id, ss.key, ss.value_json, ss.updated_at || Date.now())
    );
  }

  // 7. Tombstones
  for (const t of tombstones) {
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO tombstones (profile_id, entity_type, entity_key, deleted_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id, entity_type, entity_key) DO UPDATE SET
          deleted_at = excluded.deleted_at
      `).bind(t.profile_id, t.entity_type, t.entity_key, t.deleted_at || Date.now())
    );
  }

  // Execute in chunks <= 50
  const CHUNK_SIZE = 50;
  for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
    const chunk = statements.slice(i, i + CHUNK_SIZE);
    if (chunk.length > 0) {
      await c.env.DB.batch(chunk);
    }
  }

  return c.json({ ok: true, restoredCount: statements.length }, 200);
});
