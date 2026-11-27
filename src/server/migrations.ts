import fs from "node:fs";
import path from "node:path";
import { ensureSchema } from "../worker/schema";
import type { SqliteD1Database } from "./d1-sqlite";

export interface MigrationReport {
  applied: string[];
  skipped: string[];
}

function tableExists(db: SqliteD1Database, tableName: string): boolean {
  const row = db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName) as { name?: string } | undefined;
  return Boolean(row?.name);
}

function columnExists(db: SqliteD1Database, tableName: string, columnName: string): boolean {
  const rows = db.raw.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  return rows.some((col) => col.name === columnName);
}

function seedLegacyMigrationRecords(db: SqliteD1Database, files: string[]): void {
  if (!tableExists(db, "instance_config")) {
    return;
  }

  const insert = db.raw.prepare(
    "INSERT OR IGNORE INTO d1_migrations (name) VALUES (?)"
  );

  // Database already initialized before d1_migrations tracking existed (e.g. via ensureSchema)
  if (files.includes("0001_init.sql")) {
    insert.run("0001_init.sql");
  }
  if (
    files.includes("0002_server_replication_cursor.sql") &&
    tableExists(db, "favorites") &&
    columnExists(db, "favorites", "server_updated_at")
  ) {
    insert.run("0002_server_replication_cursor.sql");
  }
  if (files.includes("0003_mal_auth.sql") && tableExists(db, "mal_auth")) {
    insert.run("0003_mal_auth.sql");
  }
}

/**
 * Applies incremental SQLite migrations from `migrations/` and ensures schema idempotency.
 */
export async function runMigrations(
  db: SqliteD1Database,
  migrationsDir: string
): Promise<MigrationReport> {
  if (db.isReadOnly) {
    return { applied: [], skipped: [] };
  }

  const applied: string[] = [];
  const skipped: string[] = [];

  if (fs.existsSync(migrationsDir)) {
    const files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql"))
      .sort((a, b) => a.localeCompare(b, "en"));

    db.raw.exec(`
      CREATE TABLE IF NOT EXISTS d1_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const existingCountRow = db.raw
      .prepare("SELECT COUNT(*) AS count FROM d1_migrations")
      .get() as { count?: number } | undefined;

    if ((existingCountRow?.count ?? 0) === 0) {
      seedLegacyMigrationRecords(db, files);
    }

    const appliedRows = db.raw
      .prepare("SELECT name FROM d1_migrations")
      .all() as Array<{ name: string }>;
    const appliedSet = new Set(appliedRows.map((r) => r.name));

    for (const file of files) {
      if (appliedSet.has(file)) {
        skipped.push(file);
        continue;
      }

      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, "utf8");

      db.raw.exec("BEGIN IMMEDIATE");
      try {
        if (sql.trim().length > 0) {
          db.raw.exec(sql);
        }
        db.raw.prepare("INSERT INTO d1_migrations (name) VALUES (?)").run(file);
        db.raw.exec("COMMIT");
        applied.push(file);
      } catch (err) {
        try {
          db.raw.exec("ROLLBACK");
        } catch {
          // Ignore rollback failure
        }
        throw new Error(
          `Failed applying migration '${file}': ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  await ensureSchema(db);
  return { applied, skipped };
}
