import path from "node:path";
import { applyPasswordReset, reopenInstanceSetup } from "./cli-reset";
import { SqliteD1Database } from "./d1-sqlite";
import { runMigrations } from "./migrations";
import { createKuroNodeServer } from "./server";

function resolveCliDbConfig() {
  const dataDir = path.resolve(process.env.KUROSYNC_DATA_DIR ?? "/data");
  const dbPath = process.env.KUROSYNC_DB_PATH ?? path.join(dataDir, "kurosync.db");
  const migrationsDir = path.resolve(
    process.env.KUROSYNC_MIGRATIONS_DIR ?? path.resolve(process.cwd(), "migrations")
  );
  return { dbPath, migrationsDir };
}

async function runCliCommand(args: string[]): Promise<boolean> {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`KuroTV_S Self-Hosted Server & Recovery CLI

Usage:
  node dist/server/index.mjs                             Start HTTP server
  node dist/server/index.mjs --reset-password <newPass>  Reset Master Password (min 8 chars)
  node dist/server/index.mjs --reopen-setup              Reopen Setup Wizard (preserves data)`);
    return true;
  }

  const resetFlagIndex = args.findIndex(
    (arg) => arg === "--reset-password" || arg.startsWith("--reset-password=")
  );
  const reopenFlag = args.includes("--reopen-setup");

  if (resetFlagIndex === -1 && !reopenFlag) {
    return false;
  }

  const { dbPath, migrationsDir } = resolveCliDbConfig();
  const db = new SqliteD1Database(dbPath, { readOnly: false });

  try {
    await runMigrations(db, migrationsDir);

    if (resetFlagIndex !== -1) {
      const flag = args[resetFlagIndex];
      const newPassword = flag.includes("=")
        ? flag.slice(flag.indexOf("=") + 1)
        : args[resetFlagIndex + 1] || process.env.KUROSYNC_NEW_PASSWORD || "";

      const res = await applyPasswordReset(db, newPassword);
      console.log(
        JSON.stringify(
          {
            ok: true,
            action: "reset_password",
            dbPath: db.dbPath,
            revokedWebSessions: res.revokedWebSessions,
            recoveryKey: res.recoveryKey,
            note: "Save this Recovery Key safely; mobile and TV devices remain connected.",
          },
          null,
          2
        )
      );
      return true;
    }

    const res = await reopenInstanceSetup(db);
    console.log(
      JSON.stringify(
        {
          ok: true,
          action: "reopen_setup",
          dbPath: db.dbPath,
          revokedWebSessions: res.revokedWebSessions,
          note: "Open the Web Console to complete Setup Wizard with a new Master Password.",
        },
        null,
        2
      )
    );
    return true;
  } finally {
    db.closeGracefully();
  }
}

async function main() {
  const handledCli = await runCliCommand(process.argv.slice(2));
  if (handledCli) {
    process.exit(0);
  }

  const instance = await createKuroNodeServer();

  console.log(
    JSON.stringify({
      level: "info",
      event: "server_started",
      host: instance.host,
      port: instance.port,
      dbPath: instance.db.dbPath,
      readOnly: instance.readOnly,
      trustProxy: process.env.TRUST_PROXY !== "false",
      publicUrl: process.env.PUBLIC_URL || null,
    })
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ level: "info", event: "server_stopping", signal }));
    try {
      await instance.close();
      console.log(JSON.stringify({ level: "info", event: "server_stopped" }));
      process.exit(0);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "server_shutdown_error",
          message: err instanceof Error ? err.message : String(err),
        })
      );
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "server_boot_failed",
      message: err instanceof Error ? err.message : String(err),
    })
  );
  process.exit(1);
});
