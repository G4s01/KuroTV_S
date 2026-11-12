import { Hono } from "hono";
import type { AppEnv } from "../types";
import { hashPassword, generateSessionToken, hashToken } from "../crypto";
import { rateLimit } from "../rate-limit";

export const setupRouter = new Hono<AppEnv>();

// In-memory rate limiting for setup endpoint (5 requests per minute per IP)
setupRouter.use("/setup", rateLimit({ limit: 5, windowSeconds: 60, prefix: "setup" }));

setupRouter.post("/setup", async (c) => {
  // 1. If SYNC_ADMIN_SECRET is configured, Zero-Config setup wizard is permanently locked out
  if (c.env.SYNC_ADMIN_SECRET && c.env.SYNC_ADMIN_SECRET.trim().length > 0) {
    return c.json(
      {
        error: "Forbidden",
        message: "Setup is disabled because SYNC_ADMIN_SECRET environment variable is active",
      },
      403
    );
  }

  // 2. Check if instance is already initialized
  const existingConfig = await c.env.DB.prepare(
    "SELECT setup_completed FROM instance_config WHERE id = 1"
  ).first<{ setup_completed: number }>();

  if (existingConfig && existingConfig.setup_completed === 1) {
    return c.json(
      {
        error: "Conflict",
        message: "Setup has already been completed for this instance",
      },
      409
    );
  }

  // 3. Parse & validate request payload
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const masterPassword = body?.masterPassword;
  if (!masterPassword || typeof masterPassword !== "string" || masterPassword.trim().length === 0) {
    return c.json({ error: "masterPassword is required and must not be empty" }, 400);
  }

  if (masterPassword.length < 8) {
    return c.json({ error: "masterPassword must be at least 8 characters long" }, 400);
  }

  const initialProfileName =
    typeof body?.initialProfileName === "string" && body.initialProfileName.trim().length > 0
      ? body.initialProfileName.trim()
      : "Principale";

  // 4. Derive PBKDF2 hash with random 16-byte salt
  const { hash: masterHash, salt: saltHex } = await hashPassword(masterPassword);
  const now = Date.now();
  const profileId = crypto.randomUUID();

  // 5. Build atomic D1 batch operations
  const batchQueries = [
    c.env.DB.prepare(`
      INSERT INTO instance_config (id, master_hash, master_salt, setup_completed, created_at, updated_at)
      VALUES (1, ?, ?, 1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        master_hash = excluded.master_hash,
        master_salt = excluded.master_salt,
        setup_completed = 1,
        updated_at = excluded.updated_at
    `).bind(masterHash, saltHex, now, now),
    c.env.DB.prepare(`
      INSERT INTO profiles (id, name, avatar_color, created_at, updated_at)
      VALUES (?, ?, '#E50914', ?, ?)
    `).bind(profileId, initialProfileName, now, now),
  ];

  let sessionToken: string | undefined;
  let deviceId: string | undefined;

  // If client requests initial session creation during setup
  if (body?.createSession === true) {
    sessionToken = generateSessionToken();
    const tokenHash = await hashToken(sessionToken);
    deviceId = crypto.randomUUID();

    batchQueries.push(
      c.env.DB.prepare(`
        INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at)
        VALUES (?, ?, 'Web Console', 'web', 'web', ?, ?, ?)
      `).bind(deviceId, profileId, tokenHash, now, now)
    );
  }

  await c.env.DB.batch(batchQueries);

  return c.json(
    {
      ok: true,
      profileId,
      sessionToken,
      token: sessionToken,
      deviceId,
      profile: {
        id: profileId,
        name: initialProfileName,
      },
      message: "Instance initialized successfully",
    },
    200
  );
});
