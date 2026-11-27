-- KuroTV_S Database Schema Migration: 0004_recovery_key.sql
-- Adds optional per-instance PBKDF2 Recovery Key hash & salt to instance_config
-- Compatible with Cloudflare D1 (SQLite)

ALTER TABLE instance_config ADD COLUMN recovery_hash TEXT;
ALTER TABLE instance_config ADD COLUMN recovery_salt TEXT;
