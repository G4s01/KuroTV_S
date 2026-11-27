import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test";
import { TestHarness, clearDatabase } from "./helpers/harness";
import { ensureSchema } from "../src/worker/schema";
import { resetRateLimits } from "../src/worker/rate-limit";

describe("Master Password Change, Recovery Key & Reset Flows", () => {
  let harness: TestHarness;

  beforeEach(async () => {
    resetRateLimits();
    await clearDatabase(env.DB);
    await ensureSchema(env.DB);
    harness = new TestHarness();
  });

  it("POST /api/setup returns a Recovery Key and stores only PBKDF2 hash/salt in instance_config", async () => {
    const setupRes = await harness.post<{
      ok: boolean;
      profileId: string;
      sessionToken: string;
      recoveryKey: string;
    }>("/api/setup", {
      masterPassword: "InitialPassword123!",
      initialProfileName: "Casa",
      createSession: true,
    });

    expect(setupRes.status).toBe(200);
    expect(setupRes.body.ok).toBe(true);
    expect(setupRes.body.recoveryKey).toMatch(
      /^KURO-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/
    );

    const row = await env.DB.prepare(
      "SELECT recovery_hash, recovery_salt FROM instance_config WHERE id = 1"
    ).first<{ recovery_hash: string; recovery_salt: string }>();

    expect(row?.recovery_hash).toHaveLength(64);
    expect(row?.recovery_salt).toHaveLength(32);
    expect(row?.recovery_hash).not.toContain("KURO");
  });

  it("POST /api/auth/change-password validates current password, updates password, and revokes only other Web sessions", async () => {
    const setupRes = await harness.post<{
      profileId: string;
      sessionToken: string;
    }>("/api/setup", {
      masterPassword: "OldPassword123!",
      createSession: true,
    });
    const webToken1 = setupRes.body.sessionToken;
    const profileId = setupRes.body.profileId;

    // Second web session
    const webLogin2 = await harness.post<{ token: string }>("/api/auth/login", {
      password: "OldPassword123!",
    });
    const webToken2 = webLogin2.body.token;

    // Mobile device token (must stay active after password change)
    const mobileLogin = await harness.post<{ deviceToken: string }>("/api/auth/device-login", {
      password: "OldPassword123!",
      profileId,
      deviceName: "Pixel 9",
      deviceType: "mobile",
      platform: "android",
    });
    const mobileToken = mobileLogin.body.deviceToken;

    // Wrong current password -> 401
    harness.setBearerToken(webToken1);
    const badChange = await harness.post("/api/auth/change-password", {
      currentPassword: "WrongPassword!",
      newPassword: "NewPassword456!",
    });
    expect(badChange.status).toBe(401);

    // Too short new password -> 400
    const shortChange = await harness.post("/api/auth/change-password", {
      currentPassword: "OldPassword123!",
      newPassword: "short",
    });
    expect(shortChange.status).toBe(400);

    // Valid change from webToken1
    const okChange = await harness.post<{ ok: boolean; revokedWebSessions: number }>(
      "/api/auth/change-password",
      {
        currentPassword: "OldPassword123!",
        newPassword: "NewPassword456!",
      }
    );
    expect(okChange.status).toBe(200);
    expect(okChange.body.ok).toBe(true);
    expect(okChange.body.revokedWebSessions).toBe(1); // only webToken2 revoked

    // Current webToken1 still works
    expect((await harness.get("/api/auth/security")).status).toBe(200);

    // Other webToken2 is revoked
    harness.setBearerToken(webToken2);
    expect((await harness.get("/api/profiles")).status).toBe(401);

    // Mobile device stays connected
    harness.setBearerToken(mobileToken);
    expect((await harness.get("/api/sync/pull?since=0")).status).toBe(200);

    // Old password rejected at login, new password accepted
    harness.clearAuth();
    expect((await harness.post("/api/auth/login", { password: "OldPassword123!" })).status).toBe(401);
    expect((await harness.post("/api/auth/login", { password: "NewPassword456!" })).status).toBe(200);
  });

  it("POST /api/auth/reset-password resets password via Recovery Key, rotates key, and preserves mobile/TV devices", async () => {
    const setupRes = await harness.post<{
      profileId: string;
      sessionToken: string;
      recoveryKey: string;
    }>("/api/setup", {
      masterPassword: "ForgotThisPassword1!",
      createSession: true,
    });
    const profileId = setupRes.body.profileId;
    const webToken = setupRes.body.sessionToken;
    const recoveryKey = setupRes.body.recoveryKey;

    const mobileLogin = await harness.post<{ deviceToken: string }>("/api/auth/device-login", {
      password: "ForgotThisPassword1!",
      profileId,
      deviceName: "KuroTV Stick",
      deviceType: "tv",
      platform: "android-tv",
    });
    const tvToken = mobileLogin.body.deviceToken;

    // Public status reports recoveryConfigured: true
    const statusRes = await harness.get<{ adminSecretActive: boolean; recoveryConfigured: boolean }>(
      "/api/auth/recovery-status"
    );
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toEqual({
      ok: true,
      adminSecretActive: false,
      recoveryConfigured: true,
    });

    // Wrong recovery key -> 401
    const badReset = await harness.post("/api/auth/reset-password", {
      recoveryKey: "KURO-AAAA-BBBB-CCCC-DDDD-EEEE",
      newPassword: "RecoveredPassword99!",
    });
    expect(badReset.status).toBe(401);

    // Valid recovery key (lowercase & without dashes to test normalization)
    const compactLowerKey = recoveryKey.replace(/-/g, "").toLowerCase();
    const okReset = await harness.post<{
      ok: boolean;
      recoveryKey: string;
      revokedWebSessions: number;
    }>("/api/auth/reset-password", {
      recoveryKey: compactLowerKey,
      newPassword: "RecoveredPassword99!",
    });

    expect(okReset.status).toBe(200);
    expect(okReset.body.ok).toBe(true);
    expect(okReset.body.recoveryKey).toMatch(/^KURO-/);
    expect(okReset.body.recoveryKey).not.toBe(recoveryKey);
    expect(okReset.body.revokedWebSessions).toBe(1);

    // Old recovery key cannot be reused
    const replayReset = await harness.post("/api/auth/reset-password", {
      recoveryKey,
      newPassword: "AnotherPassword99!",
    });
    expect(replayReset.status).toBe(401);

    // Old web session was revoked
    harness.setBearerToken(webToken);
    expect((await harness.get("/api/profiles")).status).toBe(401);

    // TV device remains active
    harness.setBearerToken(tvToken);
    expect((await harness.get("/api/sync/pull?since=0")).status).toBe(200);

    // New password works for login
    harness.clearAuth();
    expect(
      (await harness.post("/api/auth/login", { password: "RecoveredPassword99!" })).status
    ).toBe(200);
  });

  it("POST /api/auth/recovery-key/regenerate rotates recovery key and invalidates previous key", async () => {
    const setupRes = await harness.post<{
      sessionToken: string;
      recoveryKey: string;
    }>("/api/setup", {
      masterPassword: "MasterPassword123!",
      createSession: true,
    });
    const oldKey = setupRes.body.recoveryKey;

    harness.setBearerToken(setupRes.body.sessionToken);

    const badRegen = await harness.post("/api/auth/recovery-key/regenerate", {
      password: "WrongPassword!",
    });
    expect(badRegen.status).toBe(401);

    const okRegen = await harness.post<{ ok: boolean; recoveryKey: string }>(
      "/api/auth/recovery-key/regenerate",
      { password: "MasterPassword123!" }
    );
    expect(okRegen.status).toBe(200);
    expect(okRegen.body.recoveryKey).toMatch(/^KURO-/);
    expect(okRegen.body.recoveryKey).not.toBe(oldKey);

    // Old key fails, new key works
    harness.clearAuth();
    expect(
      (
        await harness.post("/api/auth/reset-password", {
          recoveryKey: oldKey,
          newPassword: "AfterRegenPassword1!",
        })
      ).status
    ).toBe(401);

    expect(
      (
        await harness.post("/api/auth/reset-password", {
          recoveryKey: okRegen.body.recoveryKey,
          newPassword: "AfterRegenPassword1!",
        })
      ).status
    ).toBe(200);
  });

  it("reopening Setup Wizard (setup_completed = 0) preserves existing profiles, data, and mobile/TV devices", async () => {
    const setupRes = await harness.post<{
      profileId: string;
      sessionToken: string;
    }>("/api/setup", {
      masterPassword: "OriginalPassword1!",
      initialProfileName: "Famiglia",
      createSession: true,
    });
    const profileId = setupRes.body.profileId;

    const mobileLogin = await harness.post<{ deviceToken: string }>("/api/auth/device-login", {
      password: "OriginalPassword1!",
      profileId,
      deviceName: "Phone",
      deviceType: "mobile",
      platform: "android",
    });

    harness.setBearerToken(mobileLogin.body.deviceToken);
    await harness.post("/api/sync/push", {
      favorites: [{ id: "naruto", title: "Naruto", updatedAt: Date.now() }],
    });

    // Simulate reopening Setup Wizard via D1 command (`UPDATE instance_config SET setup_completed = 0`)
    await env.DB.prepare("UPDATE instance_config SET setup_completed = 0 WHERE id = 1").run();

    harness.clearAuth();
    expect((await harness.get<{ initialized: boolean }>("/api/health")).body.initialized).toBe(false);

    const reSetupRes = await harness.post<{
      ok: boolean;
      profileId: string;
      sessionToken: string;
      recoveryKey: string;
    }>("/api/setup", {
      masterPassword: "BrandNewPassword2!",
      initialProfileName: "Principale", // should NOT overwrite or duplicate existing profile
      createSession: true,
    });
    expect(reSetupRes.status).toBe(200);
    expect(reSetupRes.body.profileId).toBe(profileId);
    expect(reSetupRes.body.recoveryKey).toMatch(/^KURO-/);

    // Existing profile count is still 1 ('Famiglia') and favorites survived
    harness.setBearerToken(mobileLogin.body.deviceToken);
    const pullRes = await harness.get<any>("/api/sync/pull?since=0");
    expect(pullRes.status).toBe(200);
    expect(pullRes.body.profile.name).toBe("Famiglia");
    expect(pullRes.body.deltas.favorites).toHaveLength(1);
    expect(pullRes.body.deltas.favorites[0].id).toBe("naruto");

    // Old web session was revoked, new password works
    harness.setBearerToken(setupRes.body.sessionToken);
    expect((await harness.get("/api/profiles")).status).toBe(401);
  });

  it("blocks password/recovery management for non-web devices and when SYNC_ADMIN_SECRET is active", async () => {
    const setupRes = await harness.post<{ profileId: string }>("/api/setup", {
      masterPassword: "Password123!",
    });
    const mobileLogin = await harness.post<{ deviceToken: string }>("/api/auth/device-login", {
      password: "Password123!",
      profileId: setupRes.body.profileId,
      deviceName: "Phone",
      deviceType: "mobile",
      platform: "android",
    });

    harness.setBearerToken(mobileLogin.body.deviceToken);
    expect((await harness.get("/api/auth/security")).status).toBe(403);
    expect(
      (
        await harness.post("/api/auth/change-password", {
          currentPassword: "Password123!",
          newPassword: "NewPassword123!",
        })
      ).status
    ).toBe(403);
    expect(
      (
        await harness.post("/api/auth/recovery-key/regenerate", {
          password: "Password123!",
        })
      ).status
    ).toBe(403);

    // SYNC_ADMIN_SECRET mode
    const secretHarness = new TestHarness({ SYNC_ADMIN_SECRET: "env-master-secret" });
    const recStatus = await secretHarness.get<any>("/api/auth/recovery-status");
    expect(recStatus.body).toEqual({
      ok: true,
      adminSecretActive: true,
      recoveryConfigured: false,
    });
    expect(
      (
        await secretHarness.post("/api/auth/reset-password", {
          recoveryKey: "KURO-AAAA-BBBB-CCCC-DDDD-EEEE",
          newPassword: "NewPassword123!",
        })
      ).status
    ).toBe(403);
  });
});
