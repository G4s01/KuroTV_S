import { Hono, type Context } from "hono";
import type { AppEnv } from "../types";
import { requireAuth } from "../middleware/auth";

export const malRouter = new Hono<AppEnv>();

const MAL_OAUTH_TOKEN_URL = "https://myanimelist.net/v1/oauth2/token";
const MAL_USER_ME_URL = "https://api.myanimelist.net/v2/users/@me?fields=id,name,picture";
const MAL_CLIENT_ID_REGEX = /^[a-zA-Z0-9]{16,128}$/;
const PKCE_VERIFIER_REGEX = /^[A-Za-z0-9\-._~]{43,128}$/;

malRouter.use("/mal/*", requireAuth);

interface ProfileMalJoinRow {
  profile_id: string;
  profile_name: string;
  avatar_color: string;
  client_id: string | null;
  expires_at: number | null;
  token_type: string | null;
  username: string | null;
  user_id: number | null;
  picture: string | null;
  updated_at: number | null;
  server_updated_at: number | null;
  revoked_at: number | null;
}

export interface MalAccountSummary {
  profileId: string;
  profileName: string;
  avatarColor: string;
  connected: boolean;
  clientId: string | null;
  tokenType: string | null;
  expiresAt: number | null;
  isExpired: boolean;
  username: string | null;
  userId: number | null;
  picture: string | null;
  updatedAt: number | null;
  serverUpdatedAt: number | null;
  revokedAt: number | null;
}

function toAccountSummary(row: ProfileMalJoinRow, now: number): MalAccountSummary {
  const connected = typeof row.client_id === "string" && row.client_id.length > 0;
  const expiresAt = connected && row.expires_at !== null ? Number(row.expires_at) : null;
  const isExpired = connected && expiresAt !== null && expiresAt > 0 ? expiresAt <= now : false;

  return {
    profileId: row.profile_id,
    profileName: row.profile_name,
    avatarColor: row.avatar_color || "#E50914",
    connected,
    clientId: connected ? row.client_id : null,
    tokenType: connected ? row.token_type || "Bearer" : null,
    expiresAt,
    isExpired,
    username: connected ? row.username ?? null : null,
    userId: connected && row.user_id !== null ? Number(row.user_id) : null,
    picture: connected ? row.picture ?? null : null,
    updatedAt: connected && row.updated_at !== null ? Number(row.updated_at) : null,
    serverUpdatedAt:
      connected && row.server_updated_at !== null ? Number(row.server_updated_at) : null,
    revokedAt: !connected && row.revoked_at !== null ? Number(row.revoked_at) : null,
  };
}

function isValidRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 512) return false;
  try {
    const parsed = new URL(trimmed);
    return (
      parsed.protocol === "https:" ||
      parsed.protocol === "http:" ||
      parsed.protocol === "kurotv:"
    );
  } catch {
    return false;
  }
}

function parseMalOAuthError(payload: any, fallbackStatus: number): {
  errorCode?: string;
  message: string;
  hint?: string;
} {
  const errorCode =
    typeof payload?.error === "string" && payload.error.trim().length > 0
      ? payload.error.trim()
      : undefined;
  const rawMessage =
    (typeof payload?.message === "string" && payload.message.trim()) ||
    (typeof payload?.error_description === "string" && payload.error_description.trim()) ||
    errorCode ||
    `MyAnimeList API returned HTTP ${fallbackStatus}`;
  const rawHint =
    typeof payload?.hint === "string" && payload.hint.trim().length > 0
      ? payload.hint.trim()
      : undefined;

  return {
    errorCode,
    message: rawMessage,
    hint: rawHint,
  };
}

async function fetchMalUserProfile(accessToken: string): Promise<{
  id: number;
  name: string;
  picture?: string;
} | null> {
  try {
    const res = await fetch(MAL_USER_ME_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    if (data && typeof data.name === "string" && data.name.trim().length > 0) {
      return {
        id: Number(data.id) || 0,
        name: data.name.trim(),
        picture: typeof data.picture === "string" && data.picture.trim() ? data.picture.trim() : undefined,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function loadProfileAccountSummary(
  db: D1Database,
  profileId: string,
  now: number
): Promise<MalAccountSummary | null> {
  const row = await db
    .prepare(
      `
      SELECT
        p.id AS profile_id,
        p.name AS profile_name,
        p.avatar_color AS avatar_color,
        m.client_id AS client_id,
        m.expires_at AS expires_at,
        m.token_type AS token_type,
        m.username AS username,
        m.user_id AS user_id,
        m.picture AS picture,
        m.updated_at AS updated_at,
        m.server_updated_at AS server_updated_at,
        (
          SELECT MAX(t.deleted_at)
          FROM tombstones t
          WHERE t.profile_id = p.id AND t.entity_type = 'mal_auth'
        ) AS revoked_at
      FROM profiles p
      LEFT JOIN mal_auth m ON m.profile_id = p.id
      WHERE p.id = ?
      `
    )
    .bind(profileId)
    .first<ProfileMalJoinRow>();

  return row ? toAccountSummary(row, now) : null;
}

function ensureProfilePermission(
  c: Context<AppEnv>,
  requestedProfileId?: string
): { allowed: true; targetProfileId: string } | { allowed: false; status: 403 } {
  const deviceType = c.get("deviceType");
  const boundProfileId = c.get("profileId") || "";
  const trimmed = requestedProfileId?.trim();

  if (deviceType === "web") {
    return {
      allowed: true,
      targetProfileId: trimmed || boundProfileId,
    };
  }

  if (trimmed && trimmed !== boundProfileId) {
    return { allowed: false, status: 403 };
  }

  return {
    allowed: true,
    targetProfileId: boundProfileId,
  };
}

/**
 * GET /api/mal/accounts
 * Lists sanitized MAL connection status across profiles (web) or the caller's profile (mobile/tv).
 */
malRouter.get("/mal/accounts", async (c) => {
  const profileIdQuery = c.req.query("profileId");
  const perm = ensureProfilePermission(c, profileIdQuery);
  if (!perm.allowed) {
    return c.json({ error: "Forbidden: cross-profile access is restricted to web sessions" }, 403);
  }

  const now = Date.now();
  const deviceType = c.get("deviceType");
  const filterByProfile =
    deviceType !== "web" || (profileIdQuery && profileIdQuery.trim().length > 0);

  const baseSelect = `
    SELECT
      p.id AS profile_id,
      p.name AS profile_name,
      p.avatar_color AS avatar_color,
      m.client_id AS client_id,
      m.expires_at AS expires_at,
      m.token_type AS token_type,
      m.username AS username,
      m.user_id AS user_id,
      m.picture AS picture,
      m.updated_at AS updated_at,
      m.server_updated_at AS server_updated_at,
      (
        SELECT MAX(t.deleted_at)
        FROM tombstones t
        WHERE t.profile_id = p.id AND t.entity_type = 'mal_auth'
      ) AS revoked_at
    FROM profiles p
    LEFT JOIN mal_auth m ON m.profile_id = p.id
  `;

  const result = filterByProfile
    ? await c.env.DB.prepare(`${baseSelect} WHERE p.id = ? ORDER BY p.created_at ASC`)
        .bind(perm.targetProfileId)
        .all<ProfileMalJoinRow>()
    : await c.env.DB.prepare(`${baseSelect} ORDER BY p.created_at ASC`).all<ProfileMalJoinRow>();

  const accounts = (result.results || []).map((row) => toAccountSummary(row, now));
  return c.json({ ok: true, accounts }, 200);
});

/**
 * POST /api/mal/oauth/exchange
 * Server-side PKCE code -> token exchange against MyAnimeList (avoids browser CORS),
 * fetches @me user metadata, and saves mal_auth scoped to the target profile.
 */
malRouter.post("/mal/oauth/exchange", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const requestedProfileId =
    typeof body?.profileId === "string" && body.profileId.trim().length > 0
      ? body.profileId.trim()
      : undefined;
  const perm = ensureProfilePermission(c, requestedProfileId);
  if (!perm.allowed) {
    return c.json({ error: "Forbidden: cross-profile access is restricted to web sessions" }, 403);
  }

  const targetProfileId = perm.targetProfileId;
  const clientId = typeof body?.clientId === "string" ? body.clientId.trim() : "";
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const codeVerifier = typeof body?.codeVerifier === "string" ? body.codeVerifier.trim() : "";
  const redirectUri = typeof body?.redirectUri === "string" ? body.redirectUri.trim() : "";

  if (!MAL_CLIENT_ID_REGEX.test(clientId)) {
    return c.json(
      { error: "Client ID non valido (richiesti 16-128 caratteri alfanumerici)" },
      400
    );
  }
  if (!code) {
    return c.json({ error: "Authorization code is required" }, 400);
  }
  if (!PKCE_VERIFIER_REGEX.test(codeVerifier)) {
    return c.json({ error: "Invalid PKCE code_verifier" }, 400);
  }
  if (!isValidRedirectUri(redirectUri)) {
    return c.json({ error: "Invalid redirectUri" }, 400);
  }

  const profileExists = await c.env.DB.prepare("SELECT id FROM profiles WHERE id = ?")
    .bind(targetProfileId)
    .first<{ id: string }>();
  if (!profileExists) {
    return c.json({ error: "Profile not found" }, 404);
  }

  const form = new URLSearchParams();
  form.set("client_id", clientId);
  form.set("code", code);
  form.set("code_verifier", codeVerifier);
  form.set("grant_type", "authorization_code");
  form.set("redirect_uri", redirectUri);

  let tokenRes: Response;
  try {
    tokenRes = await fetch(MAL_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    });
  } catch (err: any) {
    return c.json(
      {
        error: `Connessione a MyAnimeList fallita: ${err?.message || "Errore di rete"}`,
      },
      502
    );
  }

  const tokenPayload: any = await tokenRes.json().catch(() => null);
  if (
    !tokenRes.ok ||
    !tokenPayload ||
    typeof tokenPayload.access_token !== "string" ||
    tokenPayload.access_token.length === 0
  ) {
    const info = parseMalOAuthError(tokenPayload, tokenRes.status);
    return c.json(
      {
        error: `Scambio token MAL fallito: ${info.message}`,
        errorCode: info.errorCode,
        hint: info.hint,
      },
      tokenRes.status >= 500 ? 502 : 400
    );
  }

  const accessToken = tokenPayload.access_token;
  const refreshToken =
    typeof tokenPayload.refresh_token === "string" && tokenPayload.refresh_token.length > 0
      ? tokenPayload.refresh_token
      : "";
  if (!refreshToken) {
    return c.json(
      { error: "Risposta token MyAnimeList priva di refresh_token" },
      502
    );
  }

  const now = Date.now();
  const expiresIn =
    typeof tokenPayload.expires_in === "number" && tokenPayload.expires_in > 0
      ? tokenPayload.expires_in
      : 3600;
  const expiresAt = now + expiresIn * 1000;
  const tokenType =
    typeof tokenPayload.token_type === "string" && tokenPayload.token_type.trim().length > 0
      ? tokenPayload.token_type.trim()
      : "Bearer";

  const malUser = await fetchMalUserProfile(accessToken);

  const [existingMal, maxTomb] = await Promise.all([
    c.env.DB.prepare("SELECT updated_at FROM mal_auth WHERE profile_id = ?")
      .bind(targetProfileId)
      .first<{ updated_at: number }>(),
    c.env.DB.prepare(
      "SELECT MAX(deleted_at) AS max_deleted_at FROM tombstones WHERE profile_id = ? AND entity_type = 'mal_auth'"
    )
      .bind(targetProfileId)
      .first<{ max_deleted_at: number | null }>(),
  ]);

  const recordTime = Math.max(
    now,
    existingMal ? existingMal.updated_at + 1 : 0,
    maxTomb?.max_deleted_at !== null && maxTomb?.max_deleted_at !== undefined
      ? maxTomb.max_deleted_at + 1
      : 0
  );

  await c.env.DB.batch([
    c.env.DB.prepare(
      "DELETE FROM tombstones WHERE profile_id = ? AND entity_type = 'mal_auth'"
    ).bind(targetProfileId),
    c.env.DB.prepare(`
      INSERT INTO mal_auth (
        profile_id, client_id, access_token, refresh_token, expires_at,
        token_type, username, user_id, picture, updated_at, server_updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(profile_id) DO UPDATE SET
        client_id = excluded.client_id,
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        expires_at = excluded.expires_at,
        token_type = excluded.token_type,
        username = excluded.username,
        user_id = excluded.user_id,
        picture = excluded.picture,
        updated_at = excluded.updated_at,
        server_updated_at = excluded.server_updated_at
    `).bind(
      targetProfileId,
      clientId,
      accessToken,
      refreshToken,
      expiresAt,
      tokenType,
      malUser?.name ?? null,
      malUser?.id ?? null,
      malUser?.picture ?? null,
      recordTime,
      recordTime
    ),
  ]);

  const account = await loadProfileAccountSummary(c.env.DB, targetProfileId, now);
  return c.json({ ok: true, account }, 200);
});

/**
 * POST /api/mal/accounts/:profileId/refresh
 * Refreshes OAuth tokens and @me profile info for a profile's MAL association.
 */
malRouter.post("/mal/accounts/:profileId/refresh", async (c) => {
  const paramProfileId = c.req.param("profileId");
  const perm = ensureProfilePermission(c, paramProfileId);
  if (!perm.allowed) {
    return c.json({ error: "Forbidden: cross-profile access is restricted to web sessions" }, 403);
  }

  const targetProfileId = perm.targetProfileId;
  const existing = await c.env.DB.prepare(
    `
    SELECT profile_id, client_id, refresh_token, token_type, username, user_id, picture, updated_at
    FROM mal_auth
    WHERE profile_id = ?
    `
  )
    .bind(targetProfileId)
    .first<{
      profile_id: string;
      client_id: string;
      refresh_token: string;
      token_type: string;
      username: string | null;
      user_id: number | null;
      picture: string | null;
      updated_at: number;
    }>();

  if (!existing) {
    return c.json({ error: "Nessun account MyAnimeList associato a questo profilo" }, 404);
  }
  if (!existing.refresh_token) {
    return c.json({ error: "Refresh token non disponibile per questo profilo" }, 400);
  }

  const form = new URLSearchParams();
  form.set("client_id", existing.client_id);
  form.set("grant_type", "refresh_token");
  form.set("refresh_token", existing.refresh_token);

  let tokenRes: Response;
  try {
    tokenRes = await fetch(MAL_OAUTH_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: form.toString(),
    });
  } catch (err: any) {
    return c.json(
      { error: `Errore di rete verso MyAnimeList: ${err?.message || "timeout"}` },
      502
    );
  }

  const tokenPayload: any = await tokenRes.json().catch(() => null);
  if (
    !tokenRes.ok ||
    !tokenPayload ||
    typeof tokenPayload.access_token !== "string" ||
    tokenPayload.access_token.length === 0
  ) {
    const info = parseMalOAuthError(tokenPayload, tokenRes.status);
    const normalizedErr = info.errorCode?.toLowerCase();
    const isRevoked =
      tokenRes.status === 401 ||
      tokenRes.status === 403 ||
      (tokenRes.status === 400 &&
        (normalizedErr === "invalid_grant" || normalizedErr === "invalid_client"));

    return c.json(
      {
        error: isRevoked
          ? "Sessione MyAnimeList scaduta o revocata. Ricollega l'account con il Client ID."
          : `Refresh MAL fallito: ${info.message}`,
        errorCode: info.errorCode,
        revoked: isRevoked,
      },
      isRevoked ? 401 : 502
    );
  }

  const now = Date.now();
  const expiresIn =
    typeof tokenPayload.expires_in === "number" && tokenPayload.expires_in > 0
      ? tokenPayload.expires_in
      : 3600;
  const expiresAt = now + expiresIn * 1000;
  const nextAccessToken = tokenPayload.access_token;
  const nextRefreshToken =
    typeof tokenPayload.refresh_token === "string" && tokenPayload.refresh_token.trim().length > 0
      ? tokenPayload.refresh_token
      : existing.refresh_token;
  const nextTokenType =
    typeof tokenPayload.token_type === "string" && tokenPayload.token_type.trim().length > 0
      ? tokenPayload.token_type.trim()
      : existing.token_type || "Bearer";

  const malUser = await fetchMalUserProfile(nextAccessToken);
  const recordTime = Math.max(now, existing.updated_at + 1);

  await c.env.DB.prepare(
    `
    UPDATE mal_auth
    SET
      access_token = ?,
      refresh_token = ?,
      expires_at = ?,
      token_type = ?,
      username = ?,
      user_id = ?,
      picture = ?,
      updated_at = ?,
      server_updated_at = ?
    WHERE profile_id = ?
    `
  )
    .bind(
      nextAccessToken,
      nextRefreshToken,
      expiresAt,
      nextTokenType,
      malUser?.name ?? existing.username,
      malUser?.id ?? existing.user_id,
      malUser?.picture ?? existing.picture,
      recordTime,
      recordTime,
      targetProfileId
    )
    .run();

  const account = await loadProfileAccountSummary(c.env.DB, targetProfileId, now);
  return c.json({ ok: true, account }, 200);
});

/**
 * DELETE /api/mal/accounts/:profileId
 * Disconnects MAL from a profile and records a 'mal_auth' tombstone for connected clients.
 */
malRouter.delete("/mal/accounts/:profileId", async (c) => {
  const paramProfileId = c.req.param("profileId");
  const perm = ensureProfilePermission(c, paramProfileId);
  if (!perm.allowed) {
    return c.json({ error: "Forbidden: cross-profile access is restricted to web sessions" }, 403);
  }

  const targetProfileId = perm.targetProfileId;
  const profileExists = await c.env.DB.prepare("SELECT id FROM profiles WHERE id = ?")
    .bind(targetProfileId)
    .first<{ id: string }>();

  if (!profileExists) {
    return c.json({ error: "Profile not found" }, 404);
  }

  const existingMal = await c.env.DB.prepare(
    "SELECT updated_at FROM mal_auth WHERE profile_id = ?"
  )
    .bind(targetProfileId)
    .first<{ updated_at: number }>();

  const now = Date.now();
  const delTime = existingMal ? Math.max(now, existingMal.updated_at) : now;

  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM mal_auth WHERE profile_id = ?").bind(targetProfileId),
    c.env.DB.prepare(`
      INSERT INTO tombstones (profile_id, entity_type, entity_key, deleted_at, server_deleted_at)
      VALUES (?, 'mal_auth', 'default', ?, ?)
      ON CONFLICT(profile_id, entity_type, entity_key)
      DO UPDATE SET
        deleted_at = MAX(tombstones.deleted_at, excluded.deleted_at),
        server_deleted_at = excluded.server_deleted_at
    `).bind(targetProfileId, delTime, delTime),
  ]);

  const account = await loadProfileAccountSummary(c.env.DB, targetProfileId, now);
  return c.json({ ok: true, profileId: targetProfileId, disconnectedAt: delTime, account }, 200);
});
