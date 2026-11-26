import { describe, it, expect } from "vitest";
import {
  mergeLocalAndRemote,
  type LocalStorageState,
  type RemotePullResponse,
  type MalAuthSyncRecord,
} from "@kurosync/sync-client";

const BASE_MAL_AUTH: MalAuthSyncRecord = {
  profileId: "prof-1",
  clientId: "mal-client-1",
  accessToken: "acc-1",
  refreshToken: "ref-1",
  expiresAt: 1700003600000,
  tokenType: "Bearer",
  username: "kuro_user",
  userId: 42,
  picture: "https://example.com/avatar.jpg",
  updatedAt: 1000,
};

function makeLocalState(malAuth?: MalAuthSyncRecord | null): LocalStorageState {
  return {
    favorites: [],
    continueWatching: [],
    watchHistory: [],
    watchProgress: [],
    sharedSettings: {},
    searchHistory: [],
    ...(malAuth !== undefined ? { malAuth } : {}),
  };
}

function makeRemotePull(
  malAuth?: MalAuthSyncRecord | null,
  tombstones: RemotePullResponse["tombstones"] = []
): RemotePullResponse {
  return {
    serverTime: 5000,
    profile: { id: "prof-1", name: "Main" },
    deltas: {
      favorites: [],
      continueWatching: [],
      watchHistory: [],
      watchProgress: [],
      sharedSettings: {},
      searchHistory: [],
      ...(malAuth !== undefined ? { malAuth } : {}),
    },
    tombstones,
  };
}

describe("Client SDK: mergeLocalAndRemote() for malAuth", () => {
  it("hydrates empty local malAuth from remote delta", () => {
    const result = mergeLocalAndRemote(makeLocalState(null), makeRemotePull(BASE_MAL_AUTH));
    expect(result.state.malAuth).toEqual(BASE_MAL_AUTH);
    expect(result.appliedUpserts).toBe(1);
    expect(result.appliedDeletions).toBe(0);
  });

  it("preserves local malAuth when remote deltas.malAuth is null (no delta change) and no tombstone", () => {
    const result = mergeLocalAndRemote(makeLocalState(BASE_MAL_AUTH), makeRemotePull(null));
    expect(result.state.malAuth).toEqual(BASE_MAL_AUTH);
    expect(result.appliedUpserts).toBe(0);
    expect(result.appliedDeletions).toBe(0);
  });

  it("resolves LWW on malAuth.updatedAt (remote >= local wins, older remote ignored)", () => {
    const localNewer = { ...BASE_MAL_AUTH, accessToken: "local-new", updatedAt: 3000 };
    const remoteOlder = { ...BASE_MAL_AUTH, accessToken: "remote-old", updatedAt: 2000 };
    const keepLocal = mergeLocalAndRemote(makeLocalState(localNewer), makeRemotePull(remoteOlder));
    expect(keepLocal.state.malAuth?.accessToken).toBe("local-new");
    expect(keepLocal.appliedUpserts).toBe(0);

    const remoteNewer = { ...BASE_MAL_AUTH, accessToken: "remote-new", updatedAt: 4000 };
    const adoptRemote = mergeLocalAndRemote(makeLocalState(localNewer), makeRemotePull(remoteNewer));
    expect(adoptRemote.state.malAuth?.accessToken).toBe("remote-new");
    expect(adoptRemote.appliedUpserts).toBe(1);

    const remoteEqual = { ...BASE_MAL_AUTH, accessToken: "remote-equal", updatedAt: 3000 };
    const adoptTie = mergeLocalAndRemote(makeLocalState(localNewer), makeRemotePull(remoteEqual));
    expect(adoptTie.state.malAuth?.accessToken).toBe("remote-equal");
  });

  it("enforces tombstone dominance for both mal_auth:default and mal_auth:malAuth", () => {
    // mal_auth:default deletes local
    const resDefault = mergeLocalAndRemote(
      makeLocalState({ ...BASE_MAL_AUTH, updatedAt: 1000 }),
      makeRemotePull(null, [{ type: "mal_auth", key: "default", deletedAt: 1500 }])
    );
    expect(resDefault.state.malAuth).toBeNull();
    expect(resDefault.appliedDeletions).toBe(1);

    // mal_auth:malAuth deletes local and blocks stale remote
    const resAlt = mergeLocalAndRemote(
      makeLocalState({ ...BASE_MAL_AUTH, updatedAt: 1000 }),
      makeRemotePull(
        { ...BASE_MAL_AUTH, updatedAt: 1500 },
        [{ type: "mal_auth", key: "malAuth", deletedAt: 1500 }]
      )
    );
    expect(resAlt.state.malAuth).toBeNull();
    expect(resAlt.appliedDeletions).toBe(1);
    expect(resAlt.appliedUpserts).toBe(0);
  });

  it("allows re-login strictly newer than mal_auth tombstone", () => {
    const relogin = { ...BASE_MAL_AUTH, accessToken: "relogin-token", updatedAt: 2500 };
    const res = mergeLocalAndRemote(
      makeLocalState(relogin),
      makeRemotePull(null, [{ type: "mal_auth", key: "default", deletedAt: 1500 }])
    );
    expect(res.state.malAuth?.accessToken).toBe("relogin-token");
    expect(res.appliedDeletions).toBe(0);
  });
});
