import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AppEnv } from "./types";
import { ensureSchema } from "./schema";
import { healthRouter } from "./routes/health";
import { setupRouter } from "./routes/setup";
import { authRouter } from "./routes/auth";
import { profilesRouter } from "./routes/profiles";
import { pairRouter } from "./routes/pair";
import { devicesRouter } from "./routes/devices";
import { syncRouter } from "./routes/sync";
import { backupRouter } from "./routes/backup";

const app = new Hono<AppEnv>();

// 1. Clean CORS headers for React Native / Expo clients and Web Browsers
app.use(
  "/api/*",
  cors({
    origin: (origin) => origin || "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Pair-Secret"],
    exposeHeaders: ["Content-Length"],
    maxAge: 86400,
  })
);

// 2. Error handling for API and Worker (ensures JSON 500 responses for API clients)
app.onError((err, c) => {
  if (c.req.path === "/api/health") {
    return c.json(
      {
        ok: false,
        initialized: false,
        version: "1.0.0",
        error: err instanceof Error ? err.message : "Database error",
      },
      500
    );
  }
  if (c.req.path.startsWith("/api/")) {
    return c.json(
      { error: err instanceof Error ? err.message : "Internal Server Error" },
      500
    );
  }
  return c.text("Internal Server Error", 500);
});

// 3. Idempotent schema guarantee for API requests (health route handles its own schema assurance inside try/catch)
app.use("/api/*", async (c, next) => {
  if (c.req.path !== "/api/health" && c.env?.DB) {
    await ensureSchema(c.env.DB);
  }
  await next();
});

// 4. Mount modular API routes
app.route("/api", healthRouter);
app.route("/api", setupRouter);
app.route("/api", authRouter);
app.route("/api", profilesRouter);
app.route("/api", pairRouter);
app.route("/api", devicesRouter);
app.route("/api", syncRouter);
app.route("/api", backupRouter);

// 5. API 404 handler (ensures API clients never receive SPA HTML fallback)
app.all("/api/*", (c) => {
  return c.json({ error: "Not Found" }, 404);
});

// 6. Fallback for Static Assets (when running in test harness or non-CDN environment)
app.all("*", async (c) => {
  if (c.env?.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text("Not Found", 404);
});

export default app;
