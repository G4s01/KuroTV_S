import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";

export interface SqliteD1Options {
  readOnly?: boolean;
  timeoutMs?: number;
}

function normalizeBindValue(value: unknown): SQLInputValue {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "string") {
    return value;
  }
  if (ArrayBuffer.isView(value)) {
    return value as NodeJS.ArrayBufferView;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return String(value);
}

function clonePlainRow(row: Record<string, SQLOutputValue>): Record<string, unknown> {
  return { ...row };
}

function buildD1Meta(opts: {
  duration: number;
  changes: number;
  lastRowId: number;
  rowsRead: number;
}): D1Meta & Record<string, unknown> {
  return {
    duration: opts.duration,
    size_after: 0,
    rows_read: opts.rowsRead,
    rows_written: opts.changes,
    last_row_id: opts.lastRowId,
    changed_db: opts.changes > 0,
    changes: opts.changes,
    served_by: "kurosync-node-sqlite",
  };
}

export class SqliteD1PreparedStatement implements D1PreparedStatement {
  private readonly db: DatabaseSync;
  private readonly sql: string;
  private readonly params: SQLInputValue[];

  constructor(db: DatabaseSync, sql: string, params: SQLInputValue[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  public bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteD1PreparedStatement(
      this.db,
      this.sql,
      values.map(normalizeBindValue)
    );
  }

  public async first<T = unknown>(colName: string): Promise<T | null>;
  public async first<T = Record<string, unknown>>(): Promise<T | null>;
  public async first<T = unknown>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...this.params);
    if (!row) {
      return null;
    }
    if (colName !== undefined) {
      return ((row[colName] as unknown) ?? null) as T | null;
    }
    return clonePlainRow(row) as T;
  }

  public async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const start = performance.now();
    const stmt = this.db.prepare(this.sql);
    const rows = stmt.all(...this.params).map(clonePlainRow) as T[];
    const duration = performance.now() - start;
    return {
      results: rows,
      success: true,
      meta: buildD1Meta({
        duration,
        changes: 0,
        lastRowId: 0,
        rowsRead: rows.length,
      }),
    };
  }

  public async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return this.executeSync() as D1Result<T>;
  }

  public async raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  public async raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  public async raw<T = unknown[]>(options?: {
    columnNames?: boolean;
  }): Promise<[string[], ...T[]] | T[]> {
    const stmt = this.db.prepare(this.sql);
    stmt.setReturnArrays(true);
    try {
      const rows = stmt.all(...this.params) as unknown as T[];
      if (options?.columnNames) {
        const names = stmt.columns().map((col) => col.name);
        return [names, ...rows];
      }
      return rows;
    } finally {
      stmt.setReturnArrays(false);
    }
  }

  public executeSync(): D1Result<any> {
    const start = performance.now();
    const stmt = this.db.prepare(this.sql);
    const returnsColumns = stmt.columns().length > 0;
    if (returnsColumns) {
      const rows = stmt.all(...this.params).map(clonePlainRow);
      const duration = performance.now() - start;
      return {
        results: rows,
        success: true,
        meta: buildD1Meta({
          duration,
          changes: 0,
          lastRowId: 0,
          rowsRead: rows.length,
        }),
      };
    }

    const info = stmt.run(...this.params);
    const duration = performance.now() - start;
    const changes = Number(info.changes ?? 0);
    const lastRowId = Number(info.lastInsertRowid ?? 0);
    return {
      results: [],
      success: true,
      meta: buildD1Meta({
        duration,
        changes,
        lastRowId,
        rowsRead: 0,
      }),
    };
  }
}

export class SqliteD1Database implements D1Database {
  public readonly dbPath: string;
  public readonly isReadOnly: boolean;
  public readonly raw: DatabaseSync;
  private inTransaction = false;
  private closed = false;

  constructor(dbPath: string, options: SqliteD1Options = {}) {
    this.isReadOnly = Boolean(options.readOnly);
    this.dbPath = dbPath === ":memory:" ? ":memory:" : path.resolve(dbPath);

    if (this.dbPath !== ":memory:" && !this.isReadOnly) {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }

    this.raw = new DatabaseSync(this.dbPath, {
      readOnly: this.isReadOnly,
      enableForeignKeyConstraints: true,
      timeout: options.timeoutMs ?? 5000,
    });

    if (!this.isReadOnly) {
      this.raw.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = ${options.timeoutMs ?? 5000};
      `);
    } else {
      try {
        this.raw.exec("PRAGMA foreign_keys = ON;");
      } catch {
        // Ignore pragma errors in strict read-only environments
      }
    }
  }

  public prepare(query: string): D1PreparedStatement {
    return new SqliteD1PreparedStatement(this.raw, query);
  }

  public async batch<T = unknown>(
    statements: D1PreparedStatement[]
  ): Promise<D1Result<T>[]> {
    if (statements.length === 0) {
      return [];
    }

    const results: D1Result<T>[] = [];
    const startedTx = !this.inTransaction;

    if (startedTx) {
      this.raw.exec(this.isReadOnly ? "BEGIN" : "BEGIN IMMEDIATE");
      this.inTransaction = true;
    }

    try {
      for (const stmt of statements) {
        if (stmt instanceof SqliteD1PreparedStatement) {
          results.push(stmt.executeSync() as D1Result<T>);
        } else {
          results.push(await stmt.run<T>());
        }
      }
      if (startedTx) {
        this.raw.exec("COMMIT");
      }
      return results;
    } catch (err) {
      if (startedTx) {
        try {
          this.raw.exec("ROLLBACK");
        } catch {
          // Transaction may already be rolled back by SQLite
        }
      }
      throw err;
    } finally {
      if (startedTx) {
        this.inTransaction = false;
      }
    }
  }

  public async exec(query: string): Promise<D1ExecResult> {
    const start = performance.now();
    const statements = query
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    this.raw.exec(query);
    return {
      count: statements.length,
      duration: performance.now() - start,
    };
  }

  public withSession(): D1DatabaseSession {
    return {
      prepare: (query: string) => this.prepare(query),
      batch: <T = unknown>(statements: D1PreparedStatement[]) => this.batch<T>(statements),
      getBookmark: () => null,
    };
  }

  public async dump(): Promise<ArrayBuffer> {
    if (this.dbPath === ":memory:") {
      throw new Error("dump() is not supported for :memory: SQLite databases");
    }
    const buf = fs.readFileSync(this.dbPath);
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }

  public closeGracefully(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (!this.isReadOnly) {
      try {
        this.raw.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      } catch {
        // Best-effort WAL checkpoint during shutdown
      }
    }
    this.raw.close();
  }
}
