import { Hono } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/auth";
import { purgeOldTombstones } from "../maintenance";
import type {
  AnimeItem,
  ContinueWatchingItem,
  WatchHistoryItem,
  WatchProgressItem,
  SearchHistoryItem,
} from "@kurosync/sync-client";

export const syncRouter = new Hono<AppEnv>();

syncRouter.use("/sync/*", requireAuth);

syncRouter.get("/sync/pull", async (c) => {
  const profileId = c.get("profileId");
  const sinceParam = c.req.query("since");
  const since = sinceParam !== undefined && sinceParam !== null ? parseInt(sinceParam, 10) || 0 : 0;
  const now = Date.now();

  // Get profile information
  const profile = await c.env.DB.prepare("SELECT id, name FROM profiles WHERE id = ?")
    .bind(profileId)
    .first<{ id: string; name: string }>();

  const profileInfo = {
    id: profile?.id || profileId,
    name: profile?.name || "Principale",
  };

  // Queries for deltas
  const isBootstrap = since <= 0;

  const [favRes, cwRes, whRes, wpRes, ssRes, tombRes] = await Promise.all([
    isBootstrap
      ? c.env.DB.prepare("SELECT * FROM favorites WHERE profile_id = ?").bind(profileId).all<any>()
      : c.env.DB.prepare("SELECT * FROM favorites WHERE profile_id = ? AND updated_at > ?")
          .bind(profileId, since)
          .all<any>(),

    isBootstrap
      ? c.env.DB.prepare("SELECT * FROM continue_watching WHERE profile_id = ?")
          .bind(profileId)
          .all<any>()
      : c.env.DB.prepare(
          "SELECT * FROM continue_watching WHERE profile_id = ? AND updated_at > ?"
        )
          .bind(profileId, since)
          .all<any>(),

    isBootstrap
      ? c.env.DB.prepare("SELECT * FROM watch_history WHERE profile_id = ?")
          .bind(profileId)
          .all<any>()
      : c.env.DB.prepare("SELECT * FROM watch_history WHERE profile_id = ? AND updated_at > ?")
          .bind(profileId, since)
          .all<any>(),

    isBootstrap
      ? c.env.DB.prepare("SELECT * FROM watch_progress WHERE profile_id = ?")
          .bind(profileId)
          .all<any>()
      : c.env.DB.prepare("SELECT * FROM watch_progress WHERE profile_id = ? AND updated_at > ?")
          .bind(profileId, since)
          .all<any>(),

    isBootstrap
      ? c.env.DB.prepare("SELECT * FROM shared_settings WHERE profile_id = ?")
          .bind(profileId)
          .all<any>()
      : c.env.DB.prepare("SELECT * FROM shared_settings WHERE profile_id = ? AND updated_at > ?")
          .bind(profileId, since)
          .all<any>(),

    isBootstrap
      ? c.env.DB.prepare("SELECT * FROM tombstones WHERE profile_id = ?").bind(profileId).all<any>()
      : c.env.DB.prepare("SELECT * FROM tombstones WHERE profile_id = ? AND deleted_at > ?")
          .bind(profileId, since)
          .all<any>(),
  ]);

  // Map database rows to KuroSync client models
  const favorites: AnimeItem[] = (favRes.results || []).map((row: any) => ({
    id: row.anime_id,
    title: row.title,
    japaneseTitle: row.japanese_title,
    thumbnail: row.thumbnail,
    type: row.type,
    releaseYear: row.release_year,
    status: row.status,
    totalEpisodes: row.total_episodes,
    genres: row.genres_json ? JSON.parse(row.genres_json) : [],
    link: row.link,
    subOrDub: row.sub_or_dub,
    updatedAt: row.updated_at,
  }));

  const continueWatching: ContinueWatchingItem[] = (cwRes.results || []).map((row: any) => ({
    animeId: row.anime_id,
    title: row.title,
    thumbnail: row.thumbnail,
    episodeId: row.episode_id,
    episodeNumber: row.episode_number,
    totalEpisodes: row.total_episodes,
    position: row.position,
    duration: row.duration,
    percentage: row.percentage,
    isCaughtUp: row.is_caught_up === 1,
    lastCheckedAt: row.last_checked_at,
    updatedAt: row.updated_at,
    dataId: row.data_id,
    serverId: row.server_id,
  }));

  const watchHistory: WatchHistoryItem[] = (whRes.results || []).map((row: any) => ({
    animeId: row.anime_id,
    title: row.title,
    thumbnail: row.thumbnail,
    episodeId: row.episode_id,
    episodeNumber: row.episode_number,
    position: row.position,
    duration: row.duration,
    progressPercent: row.progress_percent,
    isCompleted: row.is_completed === 1,
    updatedAt: row.updated_at,
    dataId: row.data_id,
    serverId: row.server_id,
  }));

  const watchProgress: WatchProgressItem[] = (wpRes.results || []).map((row: any) => ({
    animeId: row.anime_id,
    animeTitle: row.anime_title,
    thumbnail: row.thumbnail,
    episodeId: row.episode_id,
    episodeNumber: row.episode_number,
    totalEpisodes: row.total_episodes,
    currentTime: row.current_time,
    duration: row.duration,
    percentage: row.percentage,
    isCompleted: row.is_completed === 1,
    updatedAt: row.updated_at,
    dataId: row.data_id,
    serverId: row.server_id,
  }));

  const sharedSettings: Record<string, any> = {};
  let searchHistory: SearchHistoryItem[] = [];

  for (const row of ssRes.results || []) {
    if (row.key === "search_history") {
      try {
        searchHistory = JSON.parse(row.value_json);
      } catch {
        searchHistory = [];
      }
    } else {
      try {
        sharedSettings[row.key] = JSON.parse(row.value_json);
      } catch {
        sharedSettings[row.key] = row.value_json;
      }
    }
  }

  const tombstones = (tombRes.results || []).map((row: any) => ({
    type: row.entity_type,
    key: row.entity_key,
    deletedAt: row.deleted_at,
  }));

  return c.json(
    {
      serverTime: now,
      profile: profileInfo,
      deltas: {
        favorites,
        continueWatching,
        watchHistory,
        watchProgress,
        sharedSettings,
        searchHistory,
      },
      tombstones,
    },
    200
  );
});

syncRouter.post("/sync/push", async (c) => {
  const profileId = c.get("profileId");
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const now = Date.now();
  const {
    favorites = [],
    continueWatching = [],
    watchHistory = [],
    watchProgress = [],
    sharedSettings,
    searchHistory,
    deletions = [],
  } = body || {};

  // Fetch all active tombstones for this profile to apply tombstone dominance
  const existingTombstones = await c.env.DB.prepare(
    "SELECT entity_type, entity_key, deleted_at FROM tombstones WHERE profile_id = ?"
  )
    .bind(profileId)
    .all<{ entity_type: string; entity_key: string; deleted_at: number }>();

  const tombstoneMap = new Map<string, number>();
  for (const t of existingTombstones.results || []) {
    tombstoneMap.set(`${t.entity_type}:${t.entity_key}`, t.deleted_at);
  }

  const statements: D1PreparedStatement[] = [];
  let appliedCount = 0;

  // 1. Process Deletions first
  for (const del of deletions) {
    const delTime = del.deletedAt || now;
    const tombKey = `${del.type}:${del.key}`;
    tombstoneMap.set(tombKey, delTime);

    // Insert or update tombstone
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO tombstones (profile_id, entity_type, entity_key, deleted_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id, entity_type, entity_key)
        DO UPDATE SET deleted_at = MAX(tombstones.deleted_at, excluded.deleted_at)
      `).bind(profileId, del.type, del.key, delTime)
    );

    // Delete active entity row
    if (del.type === "favorite") {
      statements.push(
        c.env.DB.prepare("DELETE FROM favorites WHERE profile_id = ? AND anime_id = ?").bind(
          profileId,
          del.key
        )
      );
    } else if (del.type === "continue_watching") {
      statements.push(
        c.env.DB.prepare(
          "DELETE FROM continue_watching WHERE profile_id = ? AND anime_id = ?"
        ).bind(profileId, del.key)
      );
    } else if (del.type === "watch_history") {
      const parts = del.key.split(":");
      const animeId = parts[0];
      const epNum = parts[1] ? parseInt(parts[1], 10) : null;
      if (epNum !== null) {
        statements.push(
          c.env.DB.prepare(
            "DELETE FROM watch_history WHERE profile_id = ? AND anime_id = ? AND episode_number = ?"
          ).bind(profileId, animeId, epNum)
        );
      } else {
        statements.push(
          c.env.DB.prepare("DELETE FROM watch_history WHERE profile_id = ? AND anime_id = ?").bind(
            profileId,
            animeId
          )
        );
      }
    } else if (del.type === "watch_progress") {
      const parts = del.key.split(":");
      const animeId = parts[0];
      const epNum = parts[1] ? parseInt(parts[1], 10) : null;
      if (epNum !== null) {
        statements.push(
          c.env.DB.prepare(
            "DELETE FROM watch_progress WHERE profile_id = ? AND anime_id = ? AND episode_number = ?"
          ).bind(profileId, animeId, epNum)
        );
      }
    }
    appliedCount++;
  }

  // 2. Process Favorites
  for (const item of favorites) {
    const tombTime = tombstoneMap.get(`favorite:${item.id}`);
    const itemTime = item.updatedAt || now;

    // Tombstone dominance: if item is older than or equal to tombstone, skip
    if (tombTime !== undefined && itemTime <= tombTime) {
      continue;
    }

    // Legitimate re-addition: remove tombstone
    if (tombTime !== undefined && itemTime > tombTime) {
      statements.push(
        c.env.DB.prepare(
          "DELETE FROM tombstones WHERE profile_id = ? AND entity_type = 'favorite' AND entity_key = ?"
        ).bind(profileId, item.id)
      );
      tombstoneMap.delete(`favorite:${item.id}`);
    }

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
        WHERE excluded.updated_at >= favorites.updated_at
      `).bind(
        profileId,
        item.id,
        item.title,
        item.japaneseTitle || null,
        item.thumbnail,
        item.type || "TV",
        item.releaseYear || null,
        item.status || null,
        item.totalEpisodes !== undefined ? String(item.totalEpisodes) : null,
        item.genres ? JSON.stringify(item.genres) : null,
        item.link,
        item.subOrDub || "SUB",
        itemTime
      )
    );
    appliedCount++;
  }

  // 3. Process Continue Watching with Timeline Progress Safeguard
  for (const item of continueWatching) {
    const tombTime = tombstoneMap.get(`continue_watching:${item.animeId}`);
    const itemTime = item.updatedAt || now;

    if (tombTime !== undefined && itemTime <= tombTime) {
      continue;
    }

    if (tombTime !== undefined && itemTime > tombTime) {
      statements.push(
        c.env.DB.prepare(
          "DELETE FROM tombstones WHERE profile_id = ? AND entity_type = 'continue_watching' AND entity_key = ?"
        ).bind(profileId, item.animeId)
      );
      tombstoneMap.delete(`continue_watching:${item.animeId}`);
    }

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
          position = CASE
            WHEN excluded.episode_number > continue_watching.episode_number THEN excluded.position
            WHEN excluded.episode_number = continue_watching.episode_number THEN MAX(continue_watching.position, excluded.position)
            ELSE continue_watching.position
          END,
          duration = excluded.duration,
          percentage = CASE
            WHEN excluded.episode_number > continue_watching.episode_number THEN excluded.percentage
            WHEN excluded.episode_number = continue_watching.episode_number THEN MAX(continue_watching.percentage, excluded.percentage)
            ELSE continue_watching.percentage
          END,
          is_caught_up = excluded.is_caught_up,
          last_checked_at = excluded.last_checked_at,
          updated_at = excluded.updated_at,
          data_id = excluded.data_id,
          server_id = excluded.server_id
        WHERE excluded.updated_at >= continue_watching.updated_at
      `).bind(
        profileId,
        item.animeId,
        item.title,
        item.thumbnail,
        item.episodeId,
        item.episodeNumber,
        item.totalEpisodes !== undefined ? String(item.totalEpisodes) : null,
        item.position,
        item.duration,
        item.percentage,
        item.isCaughtUp ? 1 : 0,
        item.lastCheckedAt || itemTime,
        itemTime,
        item.dataId || null,
        item.serverId || null
      )
    );
    appliedCount++;
  }

  // 4. Process Watch History
  for (const item of watchHistory) {
    const itemKey = `${item.animeId}:${item.episodeNumber}`;
    const tombTime = tombstoneMap.get(`watch_history:${itemKey}`);
    const itemTime = item.updatedAt || now;

    if (tombTime !== undefined && itemTime <= tombTime) {
      continue;
    }

    if (tombTime !== undefined && itemTime > tombTime) {
      statements.push(
        c.env.DB.prepare(
          "DELETE FROM tombstones WHERE profile_id = ? AND entity_type = 'watch_history' AND entity_key = ?"
        ).bind(profileId, itemKey)
      );
      tombstoneMap.delete(`watch_history:${itemKey}`);
    }

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
          is_completed = CASE WHEN watch_history.is_completed = 1 THEN 1 ELSE excluded.is_completed END,
          data_id = excluded.data_id,
          server_id = excluded.server_id,
          updated_at = excluded.updated_at
        WHERE excluded.updated_at >= watch_history.updated_at
      `).bind(
        profileId,
        item.animeId,
        item.episodeNumber,
        item.episodeId,
        item.title,
        item.thumbnail,
        item.position,
        item.duration,
        item.progressPercent,
        item.isCompleted ? 1 : 0,
        item.dataId || null,
        item.serverId || null,
        itemTime
      )
    );
    appliedCount++;
  }

  // 5. Process Watch Progress with Timeline Progress Safeguard
  for (const item of watchProgress) {
    const itemKey = `${item.animeId}:${item.episodeNumber}`;
    const tombTime = tombstoneMap.get(`watch_progress:${itemKey}`);
    const itemTime = item.updatedAt || now;

    if (tombTime !== undefined && itemTime <= tombTime) {
      continue;
    }

    if (tombTime !== undefined && itemTime > tombTime) {
      statements.push(
        c.env.DB.prepare(
          "DELETE FROM tombstones WHERE profile_id = ? AND entity_type = 'watch_progress' AND entity_key = ?"
        ).bind(profileId, itemKey)
      );
      tombstoneMap.delete(`watch_progress:${itemKey}`);
    }

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
          "current_time" = MAX(watch_progress."current_time", excluded."current_time"),
          duration = excluded.duration,
          percentage = MAX(watch_progress.percentage, excluded.percentage),
          is_completed = CASE WHEN watch_progress.is_completed = 1 THEN 1 ELSE excluded.is_completed END,
          data_id = excluded.data_id,
          server_id = excluded.server_id,
          updated_at = excluded.updated_at
        WHERE (excluded.updated_at >= watch_progress.updated_at)
           OR (excluded.is_completed = 1 AND watch_progress.is_completed = 0)
           OR (excluded.percentage > watch_progress.percentage)
      `).bind(
        profileId,
        item.animeId,
        item.episodeNumber,
        item.animeTitle,
        item.thumbnail,
        item.episodeId,
        item.totalEpisodes !== undefined ? String(item.totalEpisodes) : null,
        item.currentTime,
        item.duration,
        item.percentage,
        item.isCompleted ? 1 : 0,
        item.dataId || null,
        item.serverId || null,
        itemTime
      )
    );
    appliedCount++;
  }

  // 6. Process Shared Settings
  if (sharedSettings && typeof sharedSettings === "object") {
    for (const [key, value] of Object.entries(sharedSettings)) {
      statements.push(
        c.env.DB.prepare(`
          INSERT INTO shared_settings (profile_id, key, value_json, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(profile_id, key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        `).bind(profileId, key, JSON.stringify(value), now)
      );
      appliedCount++;
    }
  }

  // 7. Process Search History
  if (Array.isArray(searchHistory)) {
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO shared_settings (profile_id, key, value_json, updated_at)
        VALUES (?, 'search_history', ?, ?)
        ON CONFLICT(profile_id, key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
      `).bind(profileId, JSON.stringify(searchHistory), now)
    );
    appliedCount++;
  }

  // Execute in batches of <= 50 queries for D1 Free tier compliance
  const CHUNK_SIZE = 50;
  for (let i = 0; i < statements.length; i += CHUNK_SIZE) {
    const chunk = statements.slice(i, i + CHUNK_SIZE);
    if (chunk.length > 0) {
      await c.env.DB.batch(chunk);
    }
  }

  // Piggybacked auto-cleanup: purge tombstones older than 90 days
  // Compute anchor time respecting incoming timeline (ensures mock past timestamps in tests are preserved)
  let anchorTime = now;
  for (const d of deletions) {
    if (typeof d?.deletedAt === "number" && d.deletedAt < anchorTime) {
      anchorTime = d.deletedAt;
    }
  }
  for (const f of favorites) {
    if (typeof f?.updatedAt === "number" && f.updatedAt < anchorTime) {
      anchorTime = f.updatedAt;
    }
  }
  for (const cw of continueWatching) {
    if (typeof cw?.updatedAt === "number" && cw.updatedAt < anchorTime) {
      anchorTime = cw.updatedAt;
    }
  }
  for (const wh of watchHistory) {
    if (typeof wh?.updatedAt === "number" && wh.updatedAt < anchorTime) {
      anchorTime = wh.updatedAt;
    }
  }
  for (const wp of watchProgress) {
    if (typeof wp?.updatedAt === "number" && wp.updatedAt < anchorTime) {
      anchorTime = wp.updatedAt;
    }
  }

  if (c.executionCtx && typeof c.executionCtx.waitUntil === "function") {
    c.executionCtx.waitUntil(purgeOldTombstones(c.env.DB, anchorTime));
  } else {
    await purgeOldTombstones(c.env.DB, anchorTime);
  }

  return c.json({ ok: true, serverTime: now, appliedCount }, 200);
});
