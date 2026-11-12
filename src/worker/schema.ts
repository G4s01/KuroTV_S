/**
 * KuroTV_S Database Schema & Isolate-Cached Initialization Helper
 * Cloudflare D1 (SQLite)
 */

export interface InstanceConfig {
  id: number;
  master_hash: string;
  master_salt: string;
  setup_completed: number; // 0 | 1
  created_at: number; // epoch ms
  updated_at: number; // epoch ms
}

export interface ProfileRecord {
  id: string;
  name: string;
  avatar_color: string;
  pin_hash: string | null;
  created_at: number;
  updated_at: number;
}

export type DeviceType = 'mobile' | 'tv' | 'web';

export interface DeviceRecord {
  id: string;
  profile_id: string;
  name: string;
  device_type: DeviceType;
  platform: string;
  token_hash: string; // SHA-256 hex
  last_seen_at: number;
  created_at: number;
  revoked_at: number | null;
}

export type PairingStatus = 'pending' | 'approved' | 'consumed' | 'expired';

export interface PairingCodeRecord {
  code: string;
  pair_secret_hash: string;
  device_name: string;
  device_type: string;
  platform: string;
  status: PairingStatus;
  approved_profile_id: string | null;
  issued_device_id: string | null;
  raw_device_token_encrypted_or_ephemeral: string | null;
  expires_at: number;
  created_at: number;
}

export interface FavoriteRecord {
  profile_id: string;
  anime_id: string;
  title: string;
  japanese_title: string | null;
  thumbnail: string;
  type: string | null;
  release_year: number | null;
  status: string | null;
  total_episodes: string | null;
  genres_json: string;
  link: string;
  sub_or_dub: string | null;
  updated_at: number;
}

export interface ContinueWatchingRecord {
  profile_id: string;
  anime_id: string;
  title: string;
  thumbnail: string;
  episode_id: string;
  episode_number: number;
  total_episodes: string | null;
  position: number;
  duration: number;
  percentage: number;
  data_id: string | null;
  server_id: string | null;
  is_caught_up: number; // 0 | 1
  last_checked_at: number | null;
  updated_at: number;
}

export interface WatchHistoryRecord {
  profile_id: string;
  anime_id: string;
  episode_number: number;
  episode_id: string;
  title: string;
  thumbnail: string;
  position: number;
  duration: number;
  progress_percent: number;
  is_completed: number; // 0 | 1
  data_id: string | null;
  server_id: string | null;
  updated_at: number;
}

export interface WatchProgressRecord {
  profile_id: string;
  anime_id: string;
  episode_number: number;
  anime_title: string;
  thumbnail: string;
  episode_id: string;
  total_episodes: string | null;
  current_time: number;
  duration: number;
  percentage: number;
  is_completed: number; // 0 | 1
  data_id: string | null;
  server_id: string | null;
  updated_at: number;
}

export interface SharedSettingRecord {
  profile_id: string;
  key: string;
  value_json: string;
  updated_at: number;
}

export type TombstoneEntityType =
  | 'favorite'
  | 'continue_watching'
  | 'watch_history'
  | 'watch_progress'
  | 'shared_settings'
  | 'search_history';

export interface TombstoneRecord {
  profile_id: string;
  entity_type: TombstoneEntityType;
  entity_key: string;
  deleted_at: number;
}

export const INIT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS instance_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  master_hash TEXT NOT NULL,
  master_salt TEXT NOT NULL,
  setup_completed INTEGER NOT NULL DEFAULT 0 CHECK (setup_completed IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar_color TEXT NOT NULL DEFAULT '#E50914',
  pin_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

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

CREATE TABLE IF NOT EXISTS shared_settings (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, key)
);

CREATE TABLE IF NOT EXISTS tombstones (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('favorite', 'continue_watching', 'watch_history', 'watch_progress', 'shared_settings', 'search_history')),
  entity_key TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, entity_type, entity_key)
);

CREATE INDEX IF NOT EXISTS idx_devices_profile_id ON devices(profile_id);
CREATE INDEX IF NOT EXISTS idx_devices_token_hash ON devices(token_hash);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_expires_at ON pairing_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_pairing_codes_status ON pairing_codes(status);
CREATE INDEX IF NOT EXISTS idx_favorites_profile_updated ON favorites(profile_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_continue_watching_profile_updated ON continue_watching(profile_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_continue_watching_caught_up ON continue_watching(profile_id, is_caught_up);
CREATE INDEX IF NOT EXISTS idx_watch_history_profile_updated ON watch_history(profile_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_watch_progress_profile_updated ON watch_progress(profile_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_shared_settings_profile_updated ON shared_settings(profile_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_tombstones_profile_deleted ON tombstones(profile_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tombstones_deleted_at ON tombstones(deleted_at);
`;

/**
 * Helper to split a multi-statement SQL string into individual trimmed statements.
 */
export function parseSqlStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Module-level promise cache per isolate
 */
let schemaInitPromise: Promise<void> | null = null;

/**
 * Idempotently ensures all tables and indexes exist in D1.
 * Cached via Promise singleton per isolate to ensure only a single
 * execution occurs even under concurrent requests.
 * Uses atomic db.batch() with prepared statements for reliable execution
 * across both local workerd and Cloudflare D1 environments.
 */
export function ensureSchema(db: D1Database): Promise<void> {
  if (schemaInitPromise) {
    return schemaInitPromise;
  }

  schemaInitPromise = (async () => {
    const statements = parseSqlStatements(INIT_SCHEMA_SQL);
    if (statements.length > 0) {
      await db.batch(statements.map((s) => db.prepare(s)));
    }
  })().catch((err) => {
    // Reset cache on failure so future invocations can retry
    schemaInitPromise = null;
    throw err;
  });

  return schemaInitPromise;
}

/**
 * Test helper to reset the cached initialization promise.
 */
export function resetSchemaInitCache(): void {
  schemaInitPromise = null;
}
