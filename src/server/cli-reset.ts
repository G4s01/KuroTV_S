import {
  generateRecoveryKey,
  hashPassword,
  normalizeRecoveryKey,
  verifyPassword,
} from "../worker/crypto";
import type { SqliteD1Database } from "./d1-sqlite";

export interface CliPasswordResetResult {
  recoveryKey: string;
  revokedWebSessions: number;
  createdDefaultProfile: boolean;
}

/**
 * Resets the Master Password directly in SQLite, rotates the Recovery Key,
 * and revokes active Web sessions while preserving mobile/TV devices.
 */
export async function applyPasswordReset(
  db: SqliteD1Database,
  newPassword: string
): Promise<CliPasswordResetResult> {
  if (db.isReadOnly) {
    throw new Error("Cannot reset Master Password when database is mounted in read-only mode.");
  }
  if (!newPassword || newPassword.length < 8) {
    throw new Error("Master password must be at least 8 characters long.");
  }

  const recoveryKey = generateRecoveryKey();
  const [masterDerived, recoveryDerived, existingProfile] = await Promise.all([
    hashPassword(newPassword),
    hashPassword(normalizeRecoveryKey(recoveryKey)),
    db.prepare("SELECT id FROM profiles ORDER BY created_at ASC LIMIT 1").first<{ id: string }>(),
  ]);

  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO instance_config (
        id, master_hash, master_salt, recovery_hash, recovery_salt,
        setup_completed, created_at, updated_at
      )
      VALUES (1, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        master_hash = excluded.master_hash,
        master_salt = excluded.master_salt,
        recovery_hash = excluded.recovery_hash,
        recovery_salt = excluded.recovery_salt,
        setup_completed = 1,
        updated_at = excluded.updated_at
    `).bind(
      masterDerived.hash,
      masterDerived.salt,
      recoveryDerived.hash,
      recoveryDerived.salt,
      now,
      now
    ),
    db
      .prepare(
        "UPDATE devices SET revoked_at = ? WHERE device_type = 'web' AND revoked_at IS NULL"
      )
      .bind(now),
  ];

  let createdDefaultProfile = false;
  if (!existingProfile) {
    createdDefaultProfile = true;
    statements.push(
      db
        .prepare(
          "INSERT INTO profiles (id, name, avatar_color, created_at, updated_at) VALUES (?, 'Principale', '#E50914', ?, ?)"
        )
        .bind(crypto.randomUUID(), now, now)
    );
  }

  const results = await db.batch(statements);
  const revokedWebSessions = Number(results[1]?.meta?.changes ?? 0);

  return {
    recoveryKey,
    revokedWebSessions,
    createdDefaultProfile,
  };
}

/**
 * Idempotent env-based reset (`KUROSYNC_RESET_PASSWORD`): resets only when the
 * stored master password does not already match `newPassword`.
 */
export async function applyPasswordResetIfChanged(
  db: SqliteD1Database,
  newPassword: string
): Promise<{ applied: boolean; revokedWebSessions: number }> {
  if (!newPassword || newPassword.length < 8) {
    throw new Error("KUROSYNC_RESET_PASSWORD must be at least 8 characters long.");
  }

  const existing = await db
    .prepare("SELECT master_hash, master_salt, setup_completed FROM instance_config WHERE id = 1")
    .first<{ master_hash: string; master_salt: string; setup_completed: number }>();

  if (existing && existing.setup_completed === 1) {
    const matches = await verifyPassword(
      newPassword,
      existing.master_hash,
      existing.master_salt
    );
    if (matches) {
      return { applied: false, revokedWebSessions: 0 };
    }
  }

  const res = await applyPasswordReset(db, newPassword);
  return { applied: true, revokedWebSessions: res.revokedWebSessions };
}

/**
 * Reopens the Setup Wizard (`setup_completed = 0`) and revokes Web sessions
 * while keeping all existing profiles, synced library data, MAL tokens, and mobile/TV devices.
 */
export async function reopenInstanceSetup(
  db: SqliteD1Database
): Promise<{ revokedWebSessions: number }> {
  if (db.isReadOnly) {
    throw new Error("Cannot reopen setup when database is mounted in read-only mode.");
  }

  const now = Date.now();
  const results = await db.batch([
    db
      .prepare("UPDATE instance_config SET setup_completed = 0, updated_at = ? WHERE id = 1")
      .bind(now),
    db
      .prepare(
        "UPDATE devices SET revoked_at = ? WHERE device_type = 'web' AND revoked_at IS NULL"
      )
      .bind(now),
  ]);

  return {
    revokedWebSessions: Number(results[1]?.meta?.changes ?? 0),
  };
}
