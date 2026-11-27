import { createKuroNodeServer } from "./server";

async function main() {
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
