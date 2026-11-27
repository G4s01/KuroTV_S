import { Hono, type Context } from "hono";
import type { AppEnv } from "../types";
import {
  verifyPassword,
  hashPassword,
  timingSafeEqualStrings,
  generateDeviceToken,
  generateSessionToken,
  generateRecoveryKey,
  normalizeRecoveryKey,
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
authRouter.use("/profiles", deviceLoginLimiter);
authRouter.use("/auth/profiles", deviceLoginLimiter);

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

  const rawInputToken = (body?.token || body?.exchangeToken || "").trim();
  const { deviceName, deviceType, platform } = body || {};

  if (!rawInputToken || typeof rawInputToken !== "string") {
    return c.json({ error: "token or exchangeToken is required" }, 400);
  }

  const now = Date.now();
  const upperInput = rawInputToken.toUpperCase();
  const lowerInput = rawInputToken.toLowerCase();

  // 1. Look up in pairing_codes table (strictly single-use ephemeral QR codes and pairing codes)
  const record = await c.env.DB.prepare(
    "SELECT * FROM pairing_codes WHERE code = ? OR code = ? OR code = ? OR LOWER(code) = ?"
  )
    .bind(rawInputToken, upperInput, lowerInput, lowerInput)
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

  if (record.status === "consumed") {
    return c.json({ error: "Token già utilizzato. Genera un nuovo codice QR." }, 410);
  }

  if (record.expires_at < now || record.status === "expired") {
    return c.json({ error: "Token scaduto. Genera un nuovo codice QR." }, 410);
  }

  if (record.status !== "approved" || !record.approved_profile_id) {
    return c.json({ error: "Token non autorizzato" }, 401);
  }

  // ATOMICALLY consume token: guarantees 100% single-use
  const consumeRes = await c.env.DB.prepare(
    "UPDATE pairing_codes SET status = 'consumed' WHERE code = ? AND status = 'approved'"
  )
    .bind(record.code)
    .run();

  const rowsChanged = consumeRes.meta?.changes ?? (consumeRes as any).changes ?? 1;
  if (rowsChanged === 0) {
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

// List Profiles with Master Password (for Netflix-style profile selector before login)
async function handleListProfilesWithPassword(c: Context<AppEnv>) {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { password } = body || {};
  if (!password || typeof password !== "string") {
    return c.json({ error: "password is required" }, 400);
  }

  let isAuthenticated = false;
  if (c.env.SYNC_ADMIN_SECRET && c.env.SYNC_ADMIN_SECRET.trim().length > 0) {
    isAuthenticated = await timingSafeEqualStrings(password, c.env.SYNC_ADMIN_SECRET);
  } else {
    const config = await c.env.DB.prepare(
      "SELECT master_hash, master_salt, setup_completed FROM instance_config WHERE id = 1"
    ).first<{ master_hash: string; master_salt: string; setup_completed: number }>();

    if (!config || config.setup_completed !== 1) {
      return c.json({ error: "Setup not completed" }, 400);
    }
    isAuthenticated = await verifyPassword(password, config.master_hash, config.master_salt);
  }

  if (!isAuthenticated) {
    return c.json({ error: "Unauthorized", message: "Invalid master password" }, 401);
  }

  const rows = await c.env.DB.prepare(`
    SELECT id, name, avatar_color, created_at, updated_at
    FROM profiles
    ORDER BY created_at ASC
  `).all<{
    id: string;
    name: string;
    avatar_color: string;
    created_at: number;
    updated_at: number;
  }>();

  const profiles = (rows.results || []).map((row) => ({
    id: row.id,
    name: row.name,
    avatar_color: row.avatar_color,
    avatarColor: row.avatar_color,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return c.json({ ok: true, profiles }, 200);
}

authRouter.post("/auth/profiles", handleListProfilesWithPassword);

// Switch Active Profile for Connected Device
async function handleSwitchProfile(c: Context<AppEnv>) {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { profileId } = body || {};
  if (!profileId || typeof profileId !== "string" || profileId.trim().length === 0) {
    return c.json({ error: "profileId is required" }, 400);
  }

  const profile = await c.env.DB.prepare(
    "SELECT id, name, avatar_color, created_at, updated_at FROM profiles WHERE id = ?"
  )
    .bind(profileId.trim())
    .first<{ id: string; name: string; avatar_color: string; created_at: number; updated_at: number }>();

  if (!profile) {
    return c.json({ error: "Profile not found" }, 404);
  }

  const deviceId = c.get("deviceId" as any);
  if (deviceId) {
    await c.env.DB.prepare("UPDATE devices SET profile_id = ? WHERE id = ?")
      .bind(profile.id, deviceId)
      .run();
  }

  return c.json(
    {
      ok: true,
      profileId: profile.id,
      profile: {
        id: profile.id,
        name: profile.name,
        avatar_color: profile.avatar_color,
        avatarColor: profile.avatar_color,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
      },
    },
    200
  );
}

authRouter.post("/switch-profile", requireAuth, handleSwitchProfile);
authRouter.post("/auth/switch-profile", requireAuth, handleSwitchProfile);

// Rate limiters for password management & recovery endpoints
const passwordChangeLimiter = rateLimit({ limit: 10, windowSeconds: 60, prefix: "auth_pwd_change" });
const passwordResetLimiter = rateLimit({ limit: 5, windowSeconds: 60, prefix: "auth_pwd_reset" });

// Public non-sensitive recovery capability check (used by MasterLogin)
authRouter.get("/auth/recovery-status", async (c) => {
  const adminSecretActive = Boolean(
    c.env.SYNC_ADMIN_SECRET && c.env.SYNC_ADMIN_SECRET.trim().length > 0
  );
  if (adminSecretActive) {
    return c.json({ ok: true, adminSecretActive: true, recoveryConfigured: false }, 200);
  }

  const config = await c.env.DB.prepare(
    "SELECT recovery_hash, recovery_salt, setup_completed FROM instance_config WHERE id = 1"
  ).first<{ recovery_hash: string | null; recovery_salt: string | null; setup_completed: number }>();

  const recoveryConfigured = Boolean(
    config &&
      config.setup_completed === 1 &&
      config.recovery_hash &&
      config.recovery_salt
  );

  return c.json({ ok: true, adminSecretActive: false, recoveryConfigured }, 200);
});

// Authenticated security status for Web Console Security Modal
authRouter.get("/auth/security", requireAuth, async (c) => {
  if (c.get("deviceType") !== "web") {
    return c.json({ error: "Forbidden: security management is restricted to web sessions" }, 403);
  }

  const adminSecretActive = Boolean(
    c.env.SYNC_ADMIN_SECRET && c.env.SYNC_ADMIN_SECRET.trim().length > 0
  );
  if (adminSecretActive) {
    return c.json(
      { ok: true, adminSecretActive: true, recoveryConfigured: false, updatedAt: null },
      200
    );
  }

  const config = await c.env.DB.prepare(
    "SELECT recovery_hash, recovery_salt, setup_completed, updated_at FROM instance_config WHERE id = 1"
  ).first<{
    recovery_hash: string | null;
    recovery_salt: string | null;
    setup_completed: number;
    updated_at: number;
  }>();

  return c.json(
    {
      ok: true,
      adminSecretActive: false,
      recoveryConfigured: Boolean(
        config && config.setup_completed === 1 && config.recovery_hash && config.recovery_salt
      ),
      updatedAt: config?.updated_at ?? null,
    },
    200
  );
});

// Change Master Password (requires active Web session + current password; revokes other Web sessions only)
authRouter.post("/auth/change-password", requireAuth, passwordChangeLimiter, async (c) => {
  if (c.get("deviceType") !== "web") {
    return c.json({ error: "Forbidden: password management is restricted to web sessions" }, 403);
  }

  if (c.env.SYNC_ADMIN_SECRET && c.env.SYNC_ADMIN_SECRET.trim().length > 0) {
    return c.json(
      {
        error: "Forbidden",
        message: "Password is managed via SYNC_ADMIN_SECRET environment variable",
      },
      403
    );
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const currentPassword = body?.currentPassword;
  const newPassword = body?.newPassword;

  if (!currentPassword || typeof currentPassword !== "string" || currentPassword.trim().length === 0) {
    return c.json({ error: "currentPassword is required" }, 400);
  }
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    return c.json({ error: "newPassword must be at least 8 characters long" }, 400);
  }

  const config = await c.env.DB.prepare(
    "SELECT master_hash, master_salt, setup_completed FROM instance_config WHERE id = 1"
  ).first<{ master_hash: string; master_salt: string; setup_completed: number }>();

  if (!config || config.setup_completed !== 1) {
    return c.json({ error: "Unauthorized", message: "Instance is not initialized" }, 401);
  }

  const isCurrentValid = await verifyPassword(
    currentPassword,
    config.master_hash,
    config.master_salt
  );
  if (!isCurrentValid) {
    return c.json({ error: "Unauthorized", message: "Current master password is invalid" }, 401);
  }

  const { hash: nextHash, salt: nextSalt } = await hashPassword(newPassword);
  const now = Date.now();
  const currentDeviceId = c.get("deviceId");

  const revokeQuery = currentDeviceId
    ? c.env.DB.prepare(
        "UPDATE devices SET revoked_at = ? WHERE device_type = 'web' AND id != ? AND revoked_at IS NULL"
      ).bind(now, currentDeviceId)
    : c.env.DB.prepare(
        "UPDATE devices SET revoked_at = ? WHERE device_type = 'web' AND revoked_at IS NULL"
      ).bind(now);

  const batchRes = await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE instance_config SET master_hash = ?, master_salt = ?, updated_at = ? WHERE id = 1"
    ).bind(nextHash, nextSalt, now),
    revokeQuery,
  ]);

  const revokedWebSessions = Number(batchRes[1]?.meta?.changes ?? 0);

  return c.json(
    {
      ok: true,
      revokedWebSessions,
      message: "Master password updated successfully",
    },
    200
  );
});

// Regenerate Recovery Key (requires active Web session + current Master Password)
authRouter.post("/auth/recovery-key/regenerate", requireAuth, passwordChangeLimiter, async (c) => {
  if (c.get("deviceType") !== "web") {
    return c.json({ error: "Forbidden: recovery management is restricted to web sessions" }, 403);
  }

  if (c.env.SYNC_ADMIN_SECRET && c.env.SYNC_ADMIN_SECRET.trim().length > 0) {
    return c.json(
      {
        error: "Forbidden",
        message: "Recovery key is disabled when SYNC_ADMIN_SECRET is active",
      },
      403
    );
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const password = body?.password;
  if (!password || typeof password !== "string" || password.trim().length === 0) {
    return c.json({ error: "password is required" }, 400);
  }

  const config = await c.env.DB.prepare(
    "SELECT master_hash, master_salt, setup_completed FROM instance_config WHERE id = 1"
  ).first<{ master_hash: string; master_salt: string; setup_completed: number }>();

  if (!config || config.setup_completed !== 1) {
    return c.json({ error: "Unauthorized", message: "Instance is not initialized" }, 401);
  }

  const isValid = await verifyPassword(password, config.master_hash, config.master_salt);
  if (!isValid) {
    return c.json({ error: "Unauthorized", message: "Invalid master password" }, 401);
  }

  const recoveryKey = generateRecoveryKey();
  const { hash: recoveryHash, salt: recoverySalt } = await hashPassword(
    normalizeRecoveryKey(recoveryKey)
  );
  const now = Date.now();

  await c.env.DB.prepare(
    "UPDATE instance_config SET recovery_hash = ?, recovery_salt = ?, updated_at = ? WHERE id = 1"
  )
    .bind(recoveryHash, recoverySalt, now)
    .run();

  return c.json({ ok: true, recoveryKey }, 200);
});

// Reset forgotten Master Password using single-use Recovery Key (rotates Recovery Key & revokes Web sessions only)
authRouter.post("/auth/reset-password", passwordResetLimiter, async (c) => {
  if (c.env.SYNC_ADMIN_SECRET && c.env.SYNC_ADMIN_SECRET.trim().length > 0) {
    return c.json(
      {
        error: "Forbidden",
        message: "Password reset is disabled because SYNC_ADMIN_SECRET is active",
      },
      403
    );
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const recoveryKey = body?.recoveryKey;
  const newPassword = body?.newPassword;

  if (!recoveryKey || typeof recoveryKey !== "string" || recoveryKey.trim().length === 0) {
    return c.json({ error: "recoveryKey is required" }, 400);
  }
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    return c.json({ error: "newPassword must be at least 8 characters long" }, 400);
  }

  const config = await c.env.DB.prepare(
    "SELECT recovery_hash, recovery_salt, setup_completed FROM instance_config WHERE id = 1"
  ).first<{ recovery_hash: string | null; recovery_salt: string | null; setup_completed: number }>();

  if (
    !config ||
    config.setup_completed !== 1 ||
    !config.recovery_hash ||
    !config.recovery_salt
  ) {
    return c.json(
      {
        error: "Unauthorized",
        message: "Recovery key is not configured for this instance",
      },
      401
    );
  }

  const normalizedInput = normalizeRecoveryKey(recoveryKey);
  const isRecoveryValid = await verifyPassword(
    normalizedInput,
    config.recovery_hash,
    config.recovery_salt
  );

  if (!isRecoveryValid) {
    return c.json({ error: "Unauthorized", message: "Invalid recovery key" }, 401);
  }

  const nextRecoveryKey = generateRecoveryKey();
  const [masterDerived, nextRecoveryDerived] = await Promise.all([
    hashPassword(newPassword),
    hashPassword(normalizeRecoveryKey(nextRecoveryKey)),
  ]);
  const now = Date.now();

  const batchRes = await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE instance_config
      SET master_hash = ?, master_salt = ?, recovery_hash = ?, recovery_salt = ?, updated_at = ?
      WHERE id = 1
    `).bind(
      masterDerived.hash,
      masterDerived.salt,
      nextRecoveryDerived.hash,
      nextRecoveryDerived.salt,
      now
    ),
    c.env.DB.prepare(
      "UPDATE devices SET revoked_at = ? WHERE device_type = 'web' AND revoked_at IS NULL"
    ).bind(now),
  ]);

  const revokedWebSessions = Number(batchRes[1]?.meta?.changes ?? 0);

  return c.json(
    {
      ok: true,
      recoveryKey: nextRecoveryKey,
      revokedWebSessions,
      message: "Master password reset successfully",
    },
    200
  );
});
