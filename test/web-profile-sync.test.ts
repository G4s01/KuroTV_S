import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { TestHarness, clearDatabase } from "./helpers/harness";
import { ensureSchema } from "../src/worker/schema";
import { resetRateLimits } from "../src/worker/rate-limit";
import {
  FIXTURE_ANIME_1,
  FIXTURE_ANIME_2,
  FIXTURE_PROFILE_PRIMARY,
  FIXTURE_PROFILE_SECONDARY,
} from "./helpers/fixtures";

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const WEB_SESSION_TOKEN = "kuro_web_session_token_123456789";

describe("Web Console Multi-Profile Content Switching", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);

    const tokenHash = await sha256Hex(WEB_SESSION_TOKEN);
    const now = Date.now();

    // Create 2 profiles
    await env.DB.batch([
      env.DB.prepare(`
        INSERT INTO profiles (id, name, avatar_color, created_at, updated_at)
        VALUES (?, 'Principale', '#E50914', ?, ?)
      `).bind(FIXTURE_PROFILE_PRIMARY.id, now, now),
      env.DB.prepare(`
        INSERT INTO profiles (id, name, avatar_color, created_at, updated_at)
        VALUES (?, 'Secondario', '#3B82F6', ?, ?)
      `).bind(FIXTURE_PROFILE_SECONDARY.id, now, now),
      // Create Web Session device bound originally to Primary profile
      env.DB.prepare(`
        INSERT INTO devices (id, profile_id, name, device_type, platform, token_hash, last_seen_at, created_at)
        VALUES (?, ?, 'Web Session', 'web', 'web', ?, ?, ?)
      `).bind(crypto.randomUUID(), FIXTURE_PROFILE_PRIMARY.id, tokenHash, now, now),
      // Insert anime 1 into Primary favorites
      env.DB.prepare(`
        INSERT INTO favorites (profile_id, anime_id, title, thumbnail, link, updated_at)
        VALUES (?, ?, 'Anime Principale', 'https://thumb1.jpg', 'link1', ?)
      `).bind(FIXTURE_PROFILE_PRIMARY.id, FIXTURE_ANIME_1.id, now),
      // Insert anime 2 into Secondary favorites
      env.DB.prepare(`
        INSERT INTO favorites (profile_id, anime_id, title, thumbnail, link, updated_at)
        VALUES (?, ?, 'Anime Secondario', 'https://thumb2.jpg', 'link2', ?)
      `).bind(FIXTURE_PROFILE_SECONDARY.id, FIXTURE_ANIME_2.id, now),
    ]);

    harness = new TestHarness();
    harness.setBearerToken(WEB_SESSION_TOKEN);
  });

  it("Web session defaults to primary profile when no profile header is specified", async () => {
    const res = await harness.get<any>("/api/sync/pull?since=0");
    expect(res.status).toBe(200);
    expect(res.body.profile.id).toBe(FIXTURE_PROFILE_PRIMARY.id);
    expect(res.body.deltas.favorites).toHaveLength(1);
    expect(res.body.deltas.favorites[0].title).toBe("Anime Principale");
  });

  it("Web session switches to secondary profile when X-Profile-Id header is passed", async () => {
    const res = await harness.get<any>("/api/sync/pull?since=0", {
      "X-Profile-Id": FIXTURE_PROFILE_SECONDARY.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.id).toBe(FIXTURE_PROFILE_SECONDARY.id);
    expect(res.body.deltas.favorites).toHaveLength(1);
    expect(res.body.deltas.favorites[0].title).toBe("Anime Secondario");
  });

  it("Web session switches to secondary profile when profileId query param is passed", async () => {
    const res = await harness.get<any>(`/api/sync/pull?since=0&profileId=${FIXTURE_PROFILE_SECONDARY.id}`);
    expect(res.status).toBe(200);
    expect(res.body.profile.id).toBe(FIXTURE_PROFILE_SECONDARY.id);
    expect(res.body.deltas.favorites).toHaveLength(1);
    expect(res.body.deltas.favorites[0].title).toBe("Anime Secondario");
  });

  it("Web session pushing with X-Profile-Id writes to the specified secondary profile", async () => {
    const newAnime = { ...FIXTURE_ANIME_1, id: "anime-new-sec", title: "Nuovo Anime Secondario" };
    const pushRes = await harness.post<any>(
      "/api/sync/push",
      { favorites: [newAnime] },
      { "X-Profile-Id": FIXTURE_PROFILE_SECONDARY.id }
    );
    expect(pushRes.status).toBe(200);

    // Verify in DB that it went to secondary profile
    const secFavs = await env.DB.prepare(
      "SELECT * FROM favorites WHERE profile_id = ? AND anime_id = 'anime-new-sec'"
    )
      .bind(FIXTURE_PROFILE_SECONDARY.id)
      .all();
    expect(secFavs.results).toHaveLength(1);

    // Verify Primary profile was not modified
    const primFavs = await env.DB.prepare(
      "SELECT * FROM favorites WHERE profile_id = ? AND anime_id = 'anime-new-sec'"
    )
      .bind(FIXTURE_PROFILE_PRIMARY.id)
      .all();
    expect(primFavs.results).toHaveLength(0);
  });
});
