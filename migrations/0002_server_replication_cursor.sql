-- KuroTV_S Database Schema Migration: 0002_server_replication_cursor.sql
-- Decouples client logical clock (updated_at/deleted_at) from server replication commit cursor (server_updated_at/server_deleted_at)
-- Compatible with Cloudflare D1 (SQLite)

ALTER TABLE favorites ADD COLUMN server_updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE continue_watching ADD COLUMN server_updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE watch_history ADD COLUMN server_updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE watch_progress ADD COLUMN server_updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE shared_settings ADD COLUMN server_updated_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tombstones ADD COLUMN server_deleted_at INTEGER NOT NULL DEFAULT 0;

-- Backfill server_updated_at / server_deleted_at from logical timestamps
UPDATE favorites SET server_updated_at = updated_at WHERE server_updated_at = 0;
UPDATE continue_watching SET server_updated_at = updated_at WHERE server_updated_at = 0;
UPDATE watch_history SET server_updated_at = updated_at WHERE server_updated_at = 0;
UPDATE watch_progress SET server_updated_at = updated_at WHERE server_updated_at = 0;
UPDATE shared_settings SET server_updated_at = updated_at WHERE server_updated_at = 0;
UPDATE tombstones SET server_deleted_at = deleted_at WHERE server_deleted_at = 0;

-- Update performance indexes to use server replication cursor
DROP INDEX IF EXISTS idx_favorites_profile_updated;
CREATE INDEX IF NOT EXISTS idx_favorites_profile_updated ON favorites(profile_id, server_updated_at);

DROP INDEX IF EXISTS idx_continue_watching_profile_updated;
CREATE INDEX IF NOT EXISTS idx_continue_watching_profile_updated ON continue_watching(profile_id, server_updated_at);

DROP INDEX IF EXISTS idx_watch_history_profile_updated;
CREATE INDEX IF NOT EXISTS idx_watch_history_profile_updated ON watch_history(profile_id, server_updated_at);

DROP INDEX IF EXISTS idx_watch_progress_profile_updated;
CREATE INDEX IF NOT EXISTS idx_watch_progress_profile_updated ON watch_progress(profile_id, server_updated_at);

DROP INDEX IF EXISTS idx_shared_settings_profile_updated;
CREATE INDEX IF NOT EXISTS idx_shared_settings_profile_updated ON shared_settings(profile_id, server_updated_at);

DROP INDEX IF EXISTS idx_tombstones_profile_deleted;
CREATE INDEX IF NOT EXISTS idx_tombstones_profile_deleted ON tombstones(profile_id, server_deleted_at);
