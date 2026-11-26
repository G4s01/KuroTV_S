-- KuroTV_S Database Schema Migration: 0003_mal_auth.sql
-- Adds per-profile MyAnimeList authentication storage (mal_auth)
-- and rebuilds tombstones to allow entity_type = 'mal_auth' while preserving
-- deleted_at and server_deleted_at columns and indexes.
-- Compatible with Cloudflare D1 (SQLite)

CREATE TABLE IF NOT EXISTS mal_auth (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL DEFAULT 0,
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  username TEXT,
  user_id INTEGER,
  picture TEXT,
  updated_at INTEGER NOT NULL,
  server_updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_mal_auth_profile_updated ON mal_auth(profile_id, server_updated_at);

CREATE TABLE tombstones_new (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('favorite', 'continue_watching', 'watch_history', 'watch_progress', 'shared_settings', 'search_history', 'mal_auth')),
  entity_key TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  server_deleted_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, entity_type, entity_key)
);

INSERT INTO tombstones_new (profile_id, entity_type, entity_key, deleted_at, server_deleted_at)
SELECT profile_id, entity_type, entity_key, deleted_at, server_deleted_at
FROM tombstones;

DROP TABLE tombstones;

ALTER TABLE tombstones_new RENAME TO tombstones;

CREATE INDEX IF NOT EXISTS idx_tombstones_profile_deleted ON tombstones(profile_id, server_deleted_at);
CREATE INDEX IF NOT EXISTS idx_tombstones_deleted_at ON tombstones(deleted_at);
