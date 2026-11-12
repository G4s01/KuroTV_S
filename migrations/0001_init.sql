-- KuroTV_S Database Schema Migration: 0001_init.sql
-- Compatible with Cloudflare D1 (SQLite)

-- 1. Instance Configuration (Single-row table for master auth & setup status)
CREATE TABLE IF NOT EXISTS instance_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  master_hash TEXT NOT NULL,
  master_salt TEXT NOT NULL,
  setup_completed INTEGER NOT NULL DEFAULT 0 CHECK (setup_completed IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 2. Profiles (Multi-profile management)
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#E50914',
  pin_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 3. Devices (Authorized client devices & tokens)
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  device_type TEXT NOT NULL CHECK(device_type IN ('mobile', 'tv', 'web')),
  platform TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

-- 4. Pairing Codes (Simple-Login pairing flow)
CREATE TABLE IF NOT EXISTS pairing_codes (
  code TEXT PRIMARY KEY,
  pair_secret_hash TEXT NOT NULL,
  device_name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'consumed', 'expired')),
  approved_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  issued_device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  raw_device_token_encrypted_or_ephemeral TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

-- 5. Favorites (Bookmarked anime per profile)
CREATE TABLE IF NOT EXISTS favorites (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  anime_id TEXT NOT NULL,
  title TEXT NOT NULL,
  japanese_title TEXT,
  thumbnail TEXT NOT NULL DEFAULT '',
  type TEXT,
  release_year INTEGER,
  status TEXT,
  total_episodes TEXT,
  genres_json TEXT NOT NULL DEFAULT '[]',
  link TEXT NOT NULL DEFAULT '',
  sub_or_dub TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, anime_id)
);

-- 6. Continue Watching (In-progress & Caught-up carousel items)
CREATE TABLE IF NOT EXISTS continue_watching (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  anime_id TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail TEXT NOT NULL DEFAULT '',
  episode_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  total_episodes TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0,
  percentage INTEGER NOT NULL DEFAULT 0,
  data_id TEXT,
  server_id TEXT,
  is_caught_up INTEGER NOT NULL DEFAULT 0 CHECK(is_caught_up IN (0, 1)),
  last_checked_at INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, anime_id)
);

-- 7. Watch History (Chronological playback log per profile)
CREATE TABLE IF NOT EXISTS watch_history (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  anime_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  episode_id TEXT NOT NULL,
  title TEXT NOT NULL,
  thumbnail TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0,
  progress_percent INTEGER NOT NULL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 0 CHECK(is_completed IN (0, 1)),
  data_id TEXT,
  server_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, anime_id, episode_number)
);

-- 8. Watch Progress (Per-episode playback checkpoints)
CREATE TABLE IF NOT EXISTS watch_progress (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  anime_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  anime_title TEXT NOT NULL,
  thumbnail TEXT NOT NULL DEFAULT '',
  episode_id TEXT NOT NULL,
  total_episodes TEXT,
  current_time INTEGER NOT NULL DEFAULT 0,
  duration INTEGER NOT NULL DEFAULT 0,
  percentage INTEGER NOT NULL DEFAULT 0,
  is_completed INTEGER NOT NULL DEFAULT 0 CHECK(is_completed IN (0, 1)),
  data_id TEXT,
  server_id TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, anime_id, episode_number)
);

-- 9. Shared Settings (Synced application settings and preferences)
CREATE TABLE IF NOT EXISTS shared_settings (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, key)
);

-- 10. Tombstones (Deletion tracking for delta sync & conflict resolution)
CREATE TABLE IF NOT EXISTS tombstones (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('favorite', 'continue_watching', 'watch_history', 'watch_progress', 'shared_settings', 'search_history')),
  entity_key TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, entity_type, entity_key)
);

-- ============================================================================
-- Indexes for High Performance Queries
-- ============================================================================

-- Devices lookups
CREATE INDEX IF NOT EXISTS idx_devices_profile_id ON devices(profile_id);
CREATE INDEX IF NOT EXISTS idx_devices_token_hash ON devices(token_hash);

-- Pairing codes lookups & expiration
CREATE INDEX IF NOT EXISTS idx_pairing_codes_expires_at ON pairing_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_status ON pairing_codes(status);

-- Favorites delta sync
CREATE INDEX IF NOT EXISTS idx_favorites_profile_updated ON favorites(profile_id, updated_at);

-- Continue watching carousel & caught-up checks
CREATE INDEX IF NOT EXISTS idx_continue_watching_profile_updated ON continue_watching(profile_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_continue_watching_caught_up ON continue_watching(profile_id, is_caught_up);

-- Watch history ordering
CREATE INDEX IF NOT EXISTS idx_watch_history_profile_updated ON watch_history(profile_id, updated_at);

-- Watch progress delta sync
CREATE INDEX IF NOT EXISTS idx_watch_progress_profile_updated ON watch_progress(profile_id, updated_at);

-- Shared settings delta sync
CREATE INDEX IF NOT EXISTS idx_shared_settings_profile_updated ON shared_settings(profile_id, updated_at);

-- Tombstones delta sync & 90-day auto-purge
CREATE INDEX IF NOT EXISTS idx_tombstones_profile_deleted ON tombstones(profile_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tombstones_deleted_at ON tombstones(deleted_at);
