import { Hono, type Context } from "hono";
import type { AppEnv } from "../types";
import {
  verifyPassword,
  timingSafeEqualStrings,
  generateDeviceToken,
  generateSessionToken,
  hashToken,
} from "../crypto";
import { rateLimit } from "../rate-limit";

export const authRouter = new Hono<AppEnv>();

// In-memory rate limiting for login attempts (5 requests per minute per IP)
const loginLimiter = rateLimit({ limit: 5, windowSeconds: 60, prefix: "auth_login" });
authRouter.use("/login", loginLimiter);
authRouter.use("/auth/login", loginLimiter);

// In-memory rate limiting for device-login attempts (10 requests per minute per IP)
const deviceLoginLimiter = rateLimit({ limit: 10, windowSeconds: 60, prefix: "auth_dev_login" });
authRouter.use("/device-login", deviceLoginLimiter);
authRouter.use("/auth/device-login", deviceLoginLimiter);

async function handleLogin(c: Context<AppEnv>) {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const password = body?.password;
  if (!password || typeof password !== "string" || password.trim().length === 0) {
    return c.json({ error: "Password is required" }, 400);
  }

  let isAuthenticated = false;

  // 1. Check if SYNC_ADMIN_SECRET is configured
  if (c.env.SYNC_ADMIN_SECRET && c.env.SYNC_ADMIN_SECRET.trim().length > 0) {
    isAuthenticated = await timingSafeEqualStrings(password, c.env.SYNC_ADMIN_SECRET);
  } else {
    // 2. Zero-Config check against instance_config
    const config = await c.env.DB.prepare(
      "SELECT master_hash, master_salt, setup_completed FROM instance_config WHERE id = 1"
    ).first<{ master_hash: string; master_salt: string; setup_completed: number }>();

    if (!config || config.setup_completed !== 1) {
      return c.json(
        {
          error: "Unauthorized",
          message: "Instance is not initialized",
        },
        401
      );
    }

    isAuthenticated = await verifyPassword(password, config.master_hash, config.master_salt);
  }

  if (!isAuthenticated) {
    return c.json(
      {
        error: "Unauthorized",
        message: "Invalid master password",
      },
      401
    );
  }

  // 3. Find primary profile to bind the session
  let profile = await c.env.DB.prepare(
    "SELECT id, name FROM profiles ORDER BY created_at ASC LIMIT 1"
  ).first<{ id: string; name: string }>();

  if (!profile) {
    // Fallback if no profile exists yet
    const profileId = crypto.randomUUID();
    const now = Date.now();
    await c.env.DB.prepare(
      "INSERT INTO profiles (id, name, avatar_color, created_at, updated_at) VALUES (?, 'Principale', '#E50914', ?, ?)"
    )
      .bind(profileId, now, now)
      .run();
    profile = { id: profileId, name: "Principale" };
  }

  // 4. Generate Web Session Token and store SHA-256 hash
  const rawToken = generateSessionToken();
  const tokenHash = await hashToken(rawToken);
  const deviceId = crypto.randomUUID();
  const now = Date.now();

  await c.env.DB.prepare(`
    INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at)
    VALUES (?, ?, 'Web Session', 'web', 'web', ?, ?, ?)
  `)
    .bind(deviceId, profile.id, tokenHash, now, now)
    .run();

  return c.json(
    {
      ok: true,
      token: rawToken,
      sessionToken: rawToken,
      deviceId,
      profileId: profile.id,
      profile: {
        id: profile.id,
        name: profile.name,
      },
    },
    200
  );
}

authRouter.post("/login", handleLogin);
authRouter.post("/auth/login", handleLogin);

async function handleDeviceLogin(c: Context<AppEnv>) {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { password, deviceName, deviceType, platform, profileId } = body || {};

  if (!password || typeof password !== "string" || !profileId) {
    return c.json({ error: "password and profileId are required" }, 400);
  }

  let isAuthenticated = false;
  if (c.env.SYNC_ADMIN_SECRET && c.env.SYNC_ADMIN_SECRET.trim().length > 0) {
    isAuthenticated = await timingSafeEqualStrings(password, c.env.SYNC_ADMIN_SECRET);
  } else {
    const config = await c.env.DB.prepare(
      "SELECT master_hash, master_salt, setup_completed FROM instance_config WHERE id = 1"
    ).first<{ master_hash: string; master_salt: string; setup_completed: number }>();

    if (!config || config.setup_completed !== 1) {
      return c.json(
        {
          error: "Unauthorized",
          message: "Instance is not initialized",
        },
        401
      );
    }
    isAuthenticated = await verifyPassword(password, config.master_hash, config.master_salt);
  }

  if (!isAuthenticated) {
    return c.json(
      {
        error: "Unauthorized",
        message: "Invalid master password",
      },
      401
    );
  }

  // Verify profile exists
  const profile = await c.env.DB.prepare("SELECT id, name FROM profiles WHERE id = ?")
    .bind(profileId)
    .first<{ id: string; name: string }>();

  if (!profile) {
    return c.json({ error: "Profile not found" }, 404);
  }

  const deviceToken = generateDeviceToken();
  const tokenHash = await hashToken(deviceToken);
  const deviceId = crypto.randomUUID();
  const now = Date.now();

  await c.env.DB.prepare(`
    INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      deviceId,
      profileId,
      deviceName || "Mobile Device",
      deviceType || "mobile",
      platform || "android",
      tokenHash,
      now,
      now
    )
    .run();

  return c.json({ ok: true, deviceToken, deviceId, profile }, 200);
}

authRouter.post("/device-login", handleDeviceLogin);
authRouter.post("/auth/device-login", handleDeviceLogin);

async function handleExchange(c: Context<AppEnv>) {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const rawInputToken = body?.token || body?.exchangeToken;
  const { deviceName, deviceType, platform } = body || {};

  if (!rawInputToken || typeof rawInputToken !== "string") {
    return c.json({ error: "token or exchangeToken is required" }, 400);
  }

  const now = Date.now();

  // 1. First check if it matches an existing active device token (token exchange)
  const inputHash = await hashToken(rawInputToken);
  const existingDevice = await c.env.DB.prepare(
    "SELECT id, profile_id FROM devices WHERE token_hash = ? AND revoked_at IS NULL"
  )
    .bind(inputHash)
    .first<{ id: string; profile_id: string }>();

  if (existingDevice) {
    const profileId = existingDevice.profile_id;
    const deviceToken = generateDeviceToken();
    const tokenHash = await hashToken(deviceToken);
    const deviceId = crypto.randomUUID();

    await c.env.DB.prepare(`
      INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        deviceId,
        profileId,
        deviceName || "Mobile Device",
        deviceType || "mobile",
        platform || "mobile",
        tokenHash,
        now,
        now
      )
      .run();

    return c.json({ ok: true, deviceToken, deviceId, profileId }, 200);
  }

  // 2. Otherwise check pairing_codes table
  const record = await c.env.DB.prepare(
    "SELECT * FROM pairing_codes WHERE code = ?"
  )
    .bind(rawInputToken)
    .first<{
      code: string;
      pair_secret_hash: string;
      device_name: string;
      device_type: string;
      platform: string;
      status: string;
      approved_profile_id: string | null;
      issued_device_id: string | null;
      raw_device_token_encrypted_or_ephemeral: string | null;
      expires_at: number;
      created_at: number;
    }>();

  if (!record) {
    return c.json({ error: "Invalid or expired exchange token" }, 404);
  }

  if (record.expires_at < now || record.status === "expired") {
    return c.json({ error: "Exchange token expired" }, 410);
  }

  if (record.status !== "approved" || !record.approved_profile_id) {
    return c.json({ error: "Exchange token not in approved status" }, 401);
  }

  // Consume token atomically
  await c.env.DB.prepare(
    "UPDATE pairing_codes SET status = 'consumed' WHERE code = ?"
  )
    .bind(rawInputToken)
    .run();

  const profileId = record.approved_profile_id;
  const deviceToken = generateDeviceToken();
  const tokenHash = await hashToken(deviceToken);
  const deviceId = crypto.randomUUID();

  await c.env.DB.prepare(`
    INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      deviceId,
      profileId,
      deviceName || record.device_name || "Mobile Device",
      deviceType || "mobile",
      platform || record.platform || "unknown",
      tokenHash,
      now,
      now
    )
    .run();

  return c.json({ ok: true, deviceToken, deviceId, profileId }, 200);
}

authRouter.post("/exchange", handleExchange);
authRouter.post("/auth/exchange", handleExchange);
