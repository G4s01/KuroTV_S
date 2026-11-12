import { Hono } from "hono";
import type { AppEnv } from "../types";
import {
  generatePairingCode,
  generateRandomToken,
  sha256Hex,
  timingSafeEqual,
} from "../crypto";
import { rateLimit } from "../rate-limit";
import { requireAuth } from "../middleware/auth";
import { purgeExpiredPairingCodes } from "../maintenance";

export const pairRouter = new Hono<AppEnv>();

// In-memory rate limiting for pairing start (10 requests per minute per IP) and pairing info (30 requests per minute per IP)
pairRouter.use("/pair/start", rateLimit({ limit: 10, windowSeconds: 60, prefix: "pair_start" }));
pairRouter.use("/pair/info", rateLimit({ limit: 30, windowSeconds: 60, prefix: "pair_info" }));

pairRouter.post("/pair/start", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { deviceName, deviceType, platform } = body || {};
  if (!deviceName || typeof deviceName !== "string" || deviceName.trim().length === 0) {
    return c.json({ error: "deviceName is required and must not be empty" }, 400);
  }

  const normalizedType = deviceType === "mobile" ? "mobile" : "tv";
  const normalizedPlatform = platform || (normalizedType === "tv" ? "android-tv" : "android");

  // Generate unique 6-character code
  let code = generatePairingCode();
  let attempts = 0;
  while (attempts < 5) {
    const existing = await c.env.DB.prepare(
      "SELECT code FROM pairing_codes WHERE code = ? AND status != 'expired' AND status != 'consumed'"
    )
      .bind(code)
      .first();
    if (!existing) break;
    code = generatePairingCode();
    attempts++;
  }

  const pairSecret = generateRandomToken("", 16);
  const pairSecretHash = await sha256Hex(pairSecret);
  const now = Date.now();
  const expiresIn = 300; // 5 minutes
  const expiresAt = now + expiresIn * 1000;

  await c.env.DB.prepare(`
    INSERT INTO pairing_codes (
      code, pair_secret_hash, device_name, device_type, platform,
      status, expires_at, created_at
    )
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `)
    .bind(
      code,
      pairSecretHash,
      deviceName.trim(),
      normalizedType,
      normalizedPlatform,
      expiresAt,
      now
    )
    .run();

  // Piggybacked auto-cleanup: purge expired pairing codes older than 24h
  if (c.executionCtx && typeof c.executionCtx.waitUntil === "function") {
    c.executionCtx.waitUntil(purgeExpiredPairingCodes(c.env.DB, now));
  } else {
    await purgeExpiredPairingCodes(c.env.DB, now);
  }

  const url = new URL(c.req.url);
  const verifyUrl = `${url.origin}/pair?code=${code}`;

  return c.json(
    {
      code,
      pairSecret,
      expiresIn,
      verifyUrl,
    },
    201
  );
});

/**
 * GET /api/pair/info?code=<code>
 * Public/non-sensitive pairing metadata endpoint for the Web Console.
 * Allows previewing TV device details (deviceName, deviceType, platform, status, expiresAt)
 * without requiring the private X-Pair-Secret header.
 */
pairRouter.get("/pair/info", async (c) => {
  const code = c.req.query("code");
  if (!code || typeof code !== "string" || code.trim().length === 0) {
    return c.json({ error: "code query parameter is required" }, 400);
  }

  const normalized = code.trim().toUpperCase();
  const record = await c.env.DB.prepare(`
    SELECT code, device_name, device_type, platform, status, expires_at
    FROM pairing_codes
    WHERE code = ? OR code = ?
  `)
    .bind(normalized, code.trim())
    .first<{
      code: string;
      device_name: string;
      device_type: string;
      platform: string;
      status: string;
      expires_at: number;
    }>();

  if (!record) {
    return c.json({ error: "Pairing code not found" }, 404);
  }

  const now = Date.now();
  let currentStatus = record.status;
  if (now > record.expires_at && currentStatus !== "consumed") {
    currentStatus = "expired";
  }

  if (c.executionCtx && typeof c.executionCtx.waitUntil === "function") {
    c.executionCtx.waitUntil(purgeExpiredPairingCodes(c.env.DB, now));
  }

  return c.json(
    {
      ok: true,
      code: record.code,
      deviceName: record.device_name,
      deviceType: record.device_type,
      platform: record.platform,
      status: currentStatus,
      expiresAt: record.expires_at,
    },
    200
  );
});

pairRouter.get("/pair/status", async (c) => {
  const code = c.req.query("code");
  if (!code) {
    return c.json({ error: "code query parameter is required" }, 400);
  }

  const normalizedCode = (code || "").trim().toUpperCase();

  const pairSecretHeader = c.req.header("X-Pair-Secret");
  if (!pairSecretHeader) {
    return c.json({ error: "Unauthorized: Missing X-Pair-Secret header" }, 401);
  }

  const record = await c.env.DB.prepare("SELECT * FROM pairing_codes WHERE code = ?")
    .bind(normalizedCode)
    .first<any>();

  if (!record) {
    return c.json({ error: "Pairing code not found" }, 404);
  }

  // Validate X-Pair-Secret against stored SHA-256 hash using timing-safe comparison
  const inputSecretHash = await sha256Hex(pairSecretHeader);
  const isSecretValid = await timingSafeEqual(inputSecretHash, record.pair_secret_hash);
  if (!isSecretValid) {
    return c.json({ error: "Unauthorized: Invalid X-Pair-Secret" }, 401);
  }

  const now = Date.now();

  // If already consumed, do NOT deliver token again
  if (record.status === "consumed") {
    return c.json({ status: "consumed" }, 200);
  }

  // Check if expired
  if (now > record.expires_at || record.status === "expired") {
    if (record.status !== "expired") {
      c.executionCtx.waitUntil(
        c.env.DB.prepare("UPDATE pairing_codes SET status = 'expired' WHERE code = ?")
          .bind(normalizedCode)
          .run()
      );
    }
    return c.json({ status: "expired" }, 200);
  }

  // Pending
  if (record.status === "pending") {
    return c.json({ status: "pending" }, 200);
  }

  // Approved -> Deliver credentials once and transition to consumed
  if (record.status === "approved") {
    const rawDeviceToken = record.raw_device_token_encrypted_or_ephemeral;
    const profileId = record.approved_profile_id;
    const deviceId = record.issued_device_id;

    // Fetch profile name
    const profile = await c.env.DB.prepare("SELECT name FROM profiles WHERE id = ?")
      .bind(profileId)
      .first<{ name: string }>();

    // Atomically transition status to 'consumed' and purge raw device token
    await c.env.DB.prepare(`
      UPDATE pairing_codes
      SET status = 'consumed', raw_device_token_encrypted_or_ephemeral = NULL
      WHERE code = ?
    `)
      .bind(normalizedCode)
      .run();

    return c.json(
      {
        status: "approved",
        deviceToken: rawDeviceToken,
        deviceId,
        profileId,
        profileName: profile?.name || "Principale",
      },
      200
    );
  }

  return c.json({ status: record.status }, 200);
});

pairRouter.post("/pair/approve", requireAuth, async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { code, profileId, deviceLabel } = body || {};
  if (!code || !profileId) {
    return c.json({ error: "code and profileId are required" }, 400);
  }

  const normalizedCode = (code || "").trim().toUpperCase();

  const record = await c.env.DB.prepare("SELECT * FROM pairing_codes WHERE code = ?")
    .bind(normalizedCode)
    .first<any>();

  if (!record) {
    return c.json({ error: "Pairing code not found" }, 404);
  }

  const now = Date.now();
  if (now > record.expires_at || record.status === "expired") {
    return c.json({ error: "Pairing code has expired" }, 410);
  }

  if (record.status === "consumed") {
    return c.json({ error: "Pairing code has already been consumed" }, 409);
  }

  // Verify profile exists
  const profile = await c.env.DB.prepare("SELECT id FROM profiles WHERE id = ?")
    .bind(profileId)
    .first();

  if (!profile) {
    return c.json({ error: "Profile not found" }, 404);
  }

  // Generate device credentials
  const deviceToken = generateRandomToken("kuro_tv_");
  const tokenHash = await sha256Hex(deviceToken);
  const deviceId = crypto.randomUUID();
  const deviceName = (deviceLabel || record.device_name || "TV Device").trim();

  // Create device and mark pairing code approved atomically
  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      deviceId,
      profileId,
      deviceName,
      record.device_type,
      record.platform,
      tokenHash,
      now,
      now
    ),
    c.env.DB.prepare(`
      UPDATE pairing_codes
      SET status = 'approved',
          approved_profile_id = ?,
          issued_device_id = ?,
          raw_device_token_encrypted_or_ephemeral = ?
      WHERE code = ?
    `).bind(profileId, deviceId, deviceToken, normalizedCode),
  ]);

  return c.json({ ok: true, deviceId }, 200);
});
