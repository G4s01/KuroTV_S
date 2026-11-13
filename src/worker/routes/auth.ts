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
import { requireAuth } from "../middleware/auth";

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

// Generate Ephemeral One-Time QR Connect Token
async function handleCreateQrToken(c: Context<AppEnv>) {
  let body: any = {};
  try {
    body = await c.req.json();
  } catch {
    // empty body is fine
  }

  const profileId = body?.profileId;
  let targetProfileId = profileId;

  if (!targetProfileId) {
    const firstProfile = await c.env.DB.prepare(
      "SELECT id FROM profiles ORDER BY created_at ASC LIMIT 1"
    ).first<{ id: string }>();
    if (!firstProfile) {
      return c.json({ error: "No profile available" }, 400);
    }
    targetProfileId = firstProfile.id;
  } else {
    const p = await c.env.DB.prepare("SELECT id FROM profiles WHERE id = ?")
      .bind(targetProfileId)
      .first<{ id: string }>();
    if (!p) {
      return c.json({ error: "Profile not found" }, 404);
    }
  }

  const now = Date.now();
  const ttlMs = 5 * 60 * 1000; // 5 minutes TTL
  const expiresAt = now + ttlMs;
  const qrToken = `qr_${crypto.randomUUID().replace(/-/g, "")}`;
  const secretHash = await hashToken(qrToken);

  await c.env.DB.prepare(`
    INSERT INTO pairing_codes (
      code, pair_secret_hash, device_name, device_type, platform,
      status, approved_profile_id, issued_device_id,
      raw_device_token_encrypted_or_ephemeral, expires_at, created_at
    )
    VALUES (?, ?, 'KuroTV Mobile', 'mobile', 'android', 'approved', ?, NULL, NULL, ?, ?)
  `)
    .bind(qrToken, secretHash, targetProfileId, expiresAt, now)
    .run();

  return c.json(
    {
      ok: true,
      qrToken,
      expiresAt,
      expiresInSeconds: 300,
      profileId: targetProfileId,
    },
    201
  );
}

authRouter.post("/qr-token", requireAuth, handleCreateQrToken);
authRouter.post("/auth/qr-token", requireAuth, handleCreateQrToken);

// Handle Single-Use Token Exchange
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

  // 1. Check in pairing_codes table (for QR ephemeral codes and pairing codes)
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

  if (record) {
    if (record.status === "consumed") {
      return c.json({ error: "Token già utilizzato o scaduto. Genera un nuovo codice QR." }, 410);
    }

    if (record.expires_at < now || record.status === "expired") {
      return c.json({ error: "Token scaduto. Genera un nuovo codice QR." }, 410);
    }

    if (record.status !== "approved" || !record.approved_profile_id) {
      return c.json({ error: "Token non in stato approvato" }, 401);
    }

    // ATOMICALLY consume token: guarantees 100% single-use
    const consumeRes = await c.env.DB.prepare(
      "UPDATE pairing_codes SET status = 'consumed' WHERE code = ? AND status = 'approved'"
    )
      .bind(rawInputToken)
      .run();

    if (consumeRes.meta.changes === 0) {
      return c.json({ error: "Token già utilizzato contemporaneamente" }, 410);
    }

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
        deviceName || record.device_name || "KuroTV Mobile",
        deviceType || "mobile",
        platform || record.platform || "android",
        tokenHash,
        now,
        now
      )
      .run();

    return c.json({ ok: true, deviceToken, deviceId, profileId }, 200);
  }

  // 2. Check if it matches an existing active device token (token migration)
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

    // Revoke the old token so it cannot be reused
    await c.env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?")
      .bind(now, existingDevice.id)
      .run();

    await c.env.DB.prepare(`
      INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        deviceId,
        profileId,
        deviceName || "KuroTV Mobile",
        deviceType || "mobile",
        platform || "android",
        tokenHash,
        now,
        now
      )
      .run();

    return c.json({ ok: true, deviceToken, deviceId, profileId }, 200);
  }

  return c.json({ error: "Invalid or expired exchange token" }, 404);
}

authRouter.post("/exchange", handleExchange);
authRouter.post("/auth/exchange", handleExchange);

// Logout and Revoke Session
async function handleLogout(c: Context<AppEnv>) {
  const now = Date.now();
  let deviceId: string | undefined = c.get("deviceId" as any);

  if (!deviceId) {
    const authHeader = c.req.header("Authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      const tokenHash = await hashToken(token);
      const dev = await c.env.DB.prepare(
        "SELECT id FROM devices WHERE token_hash = ? AND revoked_at IS NULL"
      )
        .bind(tokenHash)
        .first<{ id: string }>();
      if (dev) {
        deviceId = dev.id;
      }
    }
  }

  if (deviceId) {
    await c.env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE id = ?")
      .bind(now, deviceId)
      .run();
  }

  return c.json(
    {
      ok: true,
      message: deviceId ? "Session successfully revoked" : "No active session found",
    },
    200
  );
}

authRouter.post("/logout", handleLogout);
authRouter.post("/auth/logout", handleLogout);
