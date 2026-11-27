import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { serve, type HttpBindings, type ServerType } from "@hono/node-server";
import workerApp from "../worker/index";
import { purgeExpiredPairingCodes, purgeOldTombstones } from "../worker/maintenance";
import { resetSchemaInitCache } from "../worker/schema";
import { SqliteD1Database } from "./d1-sqlite";
import { runMigrations } from "./migrations";
import { normalizeProxyRequest, resolvePublicOrigin } from "./proxy";
import { createStaticAssetsFetcher } from "./static";

export interface KuroNodeServerOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  dbPath?: string;
  migrationsDir?: string;
  staticDir?: string;
  readOnly?: boolean;
  trustProxy?: boolean;
  publicUrl?: string;
  syncAdminSecret?: string;
  maxBodyBytes?: number;
  maintenanceIntervalMs?: number;
}

export interface KuroNodeServerInstance {
  server: ServerType;
  db: SqliteD1Database;
  port: number;
  host: string;
  readOnly: boolean;
  close: () => Promise<void>;
}

const DEFAULT_MAX_BODY_BYTES = 50 * 1024 * 1024; // 50 MB for large JSON backup imports
const DEFAULT_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

function parseBooleanEnv(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return defaultValue;
}

function parseIntEnv(raw: string | undefined, defaultValue: number): number {
  if (!raw || raw.trim() === "") return defaultValue;
  const parsed = Number.parseInt(raw.trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function detectReadOnlyFilesystem(dbPath: string): {
  autoReadOnly: boolean;
  permissionError?: string;
} {
  if (dbPath === ":memory:") {
    return { autoReadOnly: false };
  }

  const resolvedDbPath = path.resolve(dbPath);
  const parentDir = path.dirname(resolvedDbPath);
  const dbExists = fs.existsSync(resolvedDbPath);

  if (dbExists) {
    try {
      fs.accessSync(resolvedDbPath, fs.constants.W_OK);
      fs.accessSync(parentDir, fs.constants.W_OK);
      return { autoReadOnly: false };
    } catch (err: any) {
      if (err?.code === "EROFS") {
        return { autoReadOnly: true };
      }
      const uid = typeof process.getuid === "function" ? process.getuid() : "unknown";
      const gid = typeof process.getgid === "function" ? process.getgid() : "unknown";
      return {
        autoReadOnly: false,
        permissionError: `Database or data directory is not writable by UID:GID ${uid}:${gid} (${resolvedDbPath}). Ensure the host directory is writable or mount with KUROSYNC_READ_ONLY=true.`,
      };
    }
  }

  if (fs.existsSync(parentDir)) {
    try {
      fs.accessSync(parentDir, fs.constants.W_OK);
      return { autoReadOnly: false };
    } catch (err: any) {
      const uid = typeof process.getuid === "function" ? process.getuid() : "unknown";
      const gid = typeof process.getgid === "function" ? process.getgid() : "unknown";
      return {
        autoReadOnly: false,
        permissionError:
          err?.code === "EROFS"
            ? `Cannot initialize new database on read-only filesystem (${parentDir}).`
            : `Data directory is not writable by UID:GID ${uid}:${gid} (${parentDir}).`,
      };
    }
  }

  return { autoReadOnly: false };
}

function createExecutionContextTracker() {
  const pending = new Set<Promise<unknown>>();

  const createContext = (): ExecutionContext =>
    ({
      waitUntil(promise: Promise<unknown>) {
        const tracked = Promise.resolve(promise)
          .catch((err) => {
            console.error(
              JSON.stringify({
                level: "error",
                event: "wait_until_error",
                message: err instanceof Error ? err.message : String(err),
              })
            );
          })
          .finally(() => {
            pending.delete(tracked);
          });
        pending.add(tracked);
      },
      passThroughOnException() {},
      props: {},
    }) as unknown as ExecutionContext;

  const flush = async () => {
    while (pending.size > 0) {
      await Promise.allSettled(Array.from(pending));
    }
  };

  return { createContext, flush };
}

export async function createKuroNodeServer(
  options: KuroNodeServerOptions = {}
): Promise<KuroNodeServerInstance> {
  const port = options.port ?? parseIntEnv(process.env.PORT, 8787);
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";
  const dataDir = path.resolve(options.dataDir ?? process.env.KUROSYNC_DATA_DIR ?? "/data");
  const dbPath =
    options.dbPath ?? process.env.KUROSYNC_DB_PATH ?? path.join(dataDir, "kurosync.db");
  const migrationsDir = path.resolve(
    options.migrationsDir ?? process.env.KUROSYNC_MIGRATIONS_DIR ?? path.resolve(process.cwd(), "migrations")
  );
  const staticDir = path.resolve(
    options.staticDir ?? process.env.KUROSYNC_STATIC_DIR ?? path.resolve(process.cwd(), "dist/client")
  );
  const trustProxy = options.trustProxy ?? parseBooleanEnv(process.env.TRUST_PROXY, true);
  const publicOrigin = resolvePublicOrigin(options.publicUrl ?? process.env.PUBLIC_URL);
  const syncAdminSecret = options.syncAdminSecret ?? process.env.SYNC_ADMIN_SECRET;
  const maxBodyBytes = options.maxBodyBytes ?? parseIntEnv(process.env.MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES);
  const maintenanceIntervalMs =
    options.maintenanceIntervalMs ??
    parseIntEnv(process.env.MAINTENANCE_INTERVAL_MS, DEFAULT_MAINTENANCE_INTERVAL_MS);

  const explicitReadOnly =
    options.readOnly ?? parseBooleanEnv(process.env.KUROSYNC_READ_ONLY, false);

  let readOnly = explicitReadOnly;
  if (!readOnly) {
    const check = detectReadOnlyFilesystem(dbPath);
    if (check.permissionError) {
      throw new Error(check.permissionError);
    }
    readOnly = check.autoReadOnly;
  } else if (dbPath !== ":memory:" && !fs.existsSync(path.resolve(dbPath))) {
    throw new Error(
      `Read-only mode enabled, but database file does not exist at '${path.resolve(dbPath)}'.`
    );
  }

  resetSchemaInitCache();
  const db = new SqliteD1Database(dbPath, { readOnly });

  try {
    await runMigrations(db, migrationsDir);
  } catch (err) {
    db.closeGracefully();
    throw err;
  }

  const assets = createStaticAssetsFetcher(staticDir);
  const tracker = createExecutionContextTracker();

  const workerEnv = {
    DB: db as unknown as D1Database,
    ASSETS: assets,
    ...(syncAdminSecret && syncAdminSecret.trim().length > 0
      ? { SYNC_ADMIN_SECRET: syncAdminSecret }
      : {}),
  };

  let maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  if (!readOnly && maintenanceIntervalMs > 0) {
    maintenanceTimer = setInterval(() => {
      const now = Date.now();
      Promise.all([
        purgeOldTombstones(db, now),
        purgeExpiredPairingCodes(db, now),
      ]).catch((err) => {
        console.error(
          JSON.stringify({
            level: "error",
            event: "maintenance_error",
            message: err instanceof Error ? err.message : String(err),
          })
        );
      });
    }, maintenanceIntervalMs);
    maintenanceTimer.unref?.();
  }

  const fetchHandler = async (request: Request, bindings: HttpBindings): Promise<Response> => {
    const contentLengthHeader = request.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
        return new Response(
          JSON.stringify({
            error: "Payload Too Large",
            message: `Request body exceeds MAX_BODY_BYTES (${maxBodyBytes})`,
          }),
          {
            status: 413,
            headers: { "Content-Type": "application/json" },
          }
        );
      }
    }

    const normalizedRequest = normalizeProxyRequest(
      request,
      bindings?.incoming?.socket?.remoteAddress,
      { trustProxy, publicOrigin }
    );

    const url = new URL(normalizedRequest.url);
    if (
      readOnly &&
      url.pathname.startsWith("/api/") &&
      !["GET", "HEAD", "OPTIONS"].includes(normalizedRequest.method.toUpperCase())
    ) {
      return new Response(
        JSON.stringify({
          error: "Read-Only Mode",
          message: "Database is mounted in read-only mode; write operations are disabled",
        }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return workerApp.fetch(normalizedRequest, workerEnv as any, tracker.createContext());
  };

  let actualPort = port;
  const server = await new Promise<ServerType>((resolve, reject) => {
    const srv = serve(
      {
        fetch: fetchHandler as any,
        port,
        hostname: host,
      },
      (info: AddressInfo) => {
        actualPort = info.port;
        resolve(srv);
      }
    );
    srv.on("error", (err: Error) => {
      reject(err);
    });
  });

  const close = async () => {
    if (maintenanceTimer) {
      clearInterval(maintenanceTimer);
      maintenanceTimer = null;
    }
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await tracker.flush();
    db.closeGracefully();
  };

  return {
    server,
    db,
    port: actualPort,
    host,
    readOnly,
    close,
  };
}
