import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { env } from "cloudflare:test";
import { TestHarness, clearDatabase } from "./helpers/harness";
import { ensureSchema } from "../src/worker/schema";
import { resetRateLimits } from "../src/worker/rate-limit";
import { FIXTURE_MAL_AUTH_1 } from "./helpers/fixtures";

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function seedProfileAndDevice(options: {
  profileId: string;
  profileName: string;
  token: string;
  deviceType: "web" | "mobile" | "tv";
  deviceName: string;
}): Promise<void> {
  const tokenHash = await sha256Hex(options.token);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO profiles (id, name, avatar_color, created_at, updated_at)
      VALUES (?, ?, '#E50914', ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name
    `).bind(options.profileId, options.profileName, now, now),
    env.DB.prepare(`
      INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      options.profileId,
      options.deviceName,
      options.deviceType,
      options.deviceType,
      tokenHash,
      now,
      now
    ),
  ]);
}

const TOKEN_WEB = "kuro_web_mal_admin_token";
const TOKEN_MOBILE_P1 = "kuro_mob_mal_prof1_token";
const TOKEN_MOBILE_P2 = "kuro_mob_mal_prof2_token";

describe("MAL Web Panel Management API (/api/mal/*)", () => {
  let webHarness: TestHarness;
  let mobP1Harness: TestHarness;
  let mobP2Harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await ensureSchema(env.DB);
    await clearDatabase(env.DB);

    await seedProfileAndDevice({
      profileId: "prof-1",
      profileName: "Principale",
      token: TOKEN_WEB,
      deviceType: "web",
      deviceName: "Web Admin",
    });
    await seedProfileAndDevice({
      profileId: "prof-1",
      profileName: "Principale",
      token: TOKEN_MOBILE_P1,
      deviceType: "mobile",
      deviceName: "Mobile P1",
    });
    await seedProfileAndDevice({
      profileId: "prof-2",
      profileName: "Salotto",
      token: TOKEN_MOBILE_P2,
      deviceType: "mobile",
      deviceName: "Mobile P2",
    });

    webHarness = new TestHarness().setBearerToken(TOKEN_WEB);
    mobP1Harness = new TestHarness().setBearerToken(TOKEN_MOBILE_P1);
    mobP2Harness = new TestHarness().setBearerToken(TOKEN_MOBILE_P2);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists all profiles without leaking raw access/refresh tokens for web sessions and isolates mobile devices", async () => {
    await mobP1Harness.post("/api/sync/push", {
      malAuth: {
        ...FIXTURE_MAL_AUTH_1,
        accessToken: "super_secret_access_token_xyz",
        refreshToken: "super_secret_refresh_token_xyz",
      },
    });

    const webRes = await webHarness.get("/api/mal/accounts");
    expect(webRes.status).toBe(200);
    expect(webRes.body.ok).toBe(true);
    expect(webRes.body.accounts).toHaveLength(2);
    expect(webRes.text).not.toContain("super_secret_access_token_xyz");
    expect(webRes.text).not.toContain("super_secret_refresh_token_xyz");

    const p1 = webRes.body.accounts.find((a: any) => a.profileId === "prof-1");
    const p2 = webRes.body.accounts.find((a: any) => a.profileId === "prof-2");
    expect(p1).toMatchObject({
      profileId: "prof-1",
      profileName: "Principale",
      connected: true,
      clientId: FIXTURE_MAL_AUTH_1.clientId,
      username: FIXTURE_MAL_AUTH_1.username,
    });
    expect(p2).toMatchObject({
      profileId: "prof-2",
      profileName: "Salotto",
      connected: false,
      clientId: null,
    });

    // Mobile device sees only its own profile and gets 403 on cross-profile query
    const mobOwn = await mobP2Harness.get("/api/mal/accounts");
    expect(mobOwn.status).toBe(200);
    expect(mobOwn.body.accounts).toHaveLength(1);
    expect(mobOwn.body.accounts[0].profileId).toBe("prof-2");

    const mobForbidden = await mobP2Harness.get("/api/mal/accounts?profileId=prof-1");
    expect(mobForbidden.status).toBe(403);
  });

  it("exchanges OAuth PKCE code server-side, clears tombstone, and propagates malAuth to synced mobile client", async () => {
    // Seed prior disconnect tombstone for prof-2
    const oldDel = Date.now() - 10_000;
    await env.DB.prepare(
      "INSERT INTO tombstones (profile_id, entity_type, entity_key, deleted_at, server_deleted_at) VALUES ('prof-2', 'mal_auth', 'default', ?, ?)"
    )
      .bind(oldDel, oldDel)
      .run();

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : input.url;
      if (url === "https://myanimelist.net/v1/oauth2/token") {
        expect(init?.method).toBe("POST");
        const params = new URLSearchParams(String(init?.body || ""));
        expect(params.get("grant_type")).toBe("authorization_code");
        expect(params.get("client_id")).toBe("clientid1234567890abcdef");
        expect(params.get("code")).toBe("auth_code_999");
        expect(params.get("redirect_uri")).toBe("https://kurosync.example/mal-callback");
        expect(params.get("client_secret")).toBeNull();

        return new Response(
          JSON.stringify({
            token_type: "Bearer",
            expires_in: 3600,
            access_token: "fresh_mal_access_token",
            refresh_token: "fresh_mal_refresh_token",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.startsWith("https://api.myanimelist.net/v2/users/@me")) {
        return new Response(
          JSON.stringify({
            id: 424242,
            name: "SalottoOtaku",
            picture: "https://cdn.myanimelist.net/images/userimages/424242.jpg",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      throw new Error(`Unexpected fetch URL in test: ${url}`);
    });

    const verifier = "a".repeat(64);
    const exchangeRes = await webHarness.post("/api/mal/oauth/exchange", {
      profileId: "prof-2",
      clientId: "clientid1234567890abcdef",
      code: "auth_code_999",
      codeVerifier: verifier,
      redirectUri: "https://kurosync.example/mal-callback",
    });

    expect(exchangeRes.status).toBe(200);
    expect(exchangeRes.body.ok).toBe(true);
    expect(exchangeRes.body.account).toMatchObject({
      profileId: "prof-2",
      connected: true,
      clientId: "clientid1234567890abcdef",
      username: "SalottoOtaku",
      userId: 424242,
    });
    expect(exchangeRes.text).not.toContain("fresh_mal_access_token");
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // Synced mobile device on prof-2 receives the linked malAuth record and tombstone is gone
    const pullP2 = await mobP2Harness.get("/api/sync/pull?since=0");
    expect(pullP2.status).toBe(200);
    expect(pullP2.body.deltas.malAuth).toMatchObject({
      clientId: "clientid1234567890abcdef",
      accessToken: "fresh_mal_access_token",
      refreshToken: "fresh_mal_refresh_token",
      username: "SalottoOtaku",
      userId: 424242,
    });
    expect(pullP2.body.tombstones.filter((t: any) => t.type === "mal_auth")).toHaveLength(0);

    // Prof-1 remains isolated and unlinked
    const pullP1 = await mobP1Harness.get("/api/sync/pull?since=0");
    expect(pullP1.body.deltas.malAuth).toBeNull();
  });

  it("validates exchange inputs and refuses cross-profile exchange from mobile devices", async () => {
    const badClientRes = await webHarness.post("/api/mal/oauth/exchange", {
      profileId: "prof-1",
      clientId: "short",
      code: "abc",
      codeVerifier: "a".repeat(64),
      redirectUri: "https://kurosync.example/mal-callback",
    });
    expect(badClientRes.status).toBe(400);

    const forbiddenRes = await mobP1Harness.post("/api/mal/oauth/exchange", {
      profileId: "prof-2",
      clientId: "clientid1234567890abcdef",
      code: "abc",
      codeVerifier: "a".repeat(64),
      redirectUri: "https://kurosync.example/mal-callback",
    });
    expect(forbiddenRes.status).toBe(403);
  });

  it("refreshes MAL token for a profile and reports revoked credentials cleanly", async () => {
    await mobP1Harness.post("/api/sync/push", {
      malAuth: FIXTURE_MAL_AUTH_1,
    });

    vi.spyOn(globalThis, "fetch").mockImplementationOnce(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      expect(url).toBe("https://myanimelist.net/v1/oauth2/token");
      return new Response(
        JSON.stringify({
          token_type: "Bearer",
          expires_in: 7200,
          access_token: "rotated_access_token",
          refresh_token: "rotated_refresh_token",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }).mockImplementationOnce(async (input: any) => {
      const url = typeof input === "string" ? input : input.url;
      expect(url).toContain("/v2/users/@me");
      return new Response(
        JSON.stringify({ id: 101, name: "UpdatedMalName" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const refreshRes = await webHarness.post("/api/mal/accounts/prof-1/refresh");
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.account.username).toBe("UpdatedMalName");

    const pullRes = await mobP1Harness.get("/api/sync/pull?since=0");
    expect(pullRes.body.deltas.malAuth).toMatchObject({
      accessToken: "rotated_access_token",
      refreshToken: "rotated_refresh_token",
      username: "UpdatedMalName",
    });

    // Revoked / invalid_grant returns 401 with revoked: true
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant", message: "Token revoked" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );
    const revokedRes = await webHarness.post("/api/mal/accounts/prof-1/refresh");
    expect(revokedRes.status).toBe(401);
    expect(revokedRes.body.revoked).toBe(true);
  });

  it("disconnects MAL account from a profile and records a 'mal_auth' tombstone for clients", async () => {
    await mobP1Harness.post("/api/sync/push", { malAuth: FIXTURE_MAL_AUTH_1 });

    const delRes = await webHarness.delete("/api/mal/accounts/prof-1");
    expect(delRes.status).toBe(200);
    expect(delRes.body.ok).toBe(true);
    expect(delRes.body.account.connected).toBe(false);
    expect(delRes.body.account.revokedAt).toBeTypeOf("number");

    const pullRes = await mobP1Harness.get("/api/sync/pull?since=0");
    expect(pullRes.body.deltas.malAuth).toBeNull();
    expect(pullRes.body.tombstones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "mal_auth", key: "default" }),
      ])
    );
  });
});
