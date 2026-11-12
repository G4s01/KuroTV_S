# KuroTV Client Integration Guide: KuroTV_M & KuroTV_TV

This guide provides the complete technical integration specification for connecting **KuroTV Mobile (`KuroTV_M`)** and **KuroTV Android TV (`KuroTV_TV`)** to a personal **KuroTV_S** Cloudflare Workers synchronization backend using `@kurosync/sync-client`.

---

## 1. Architectural Overview

KuroTV clients store user state locally using `react-native-mmkv` for sub-millisecond synchronous reads and writes. The `@kurosync/sync-client` SDK acts as an intermediary bridge that exchanges delta mutations with KuroTV_S, preserving local responsiveness while achieving seamless multi-device synchronization.

```
┌────────────────────────────────────────────────────────┐
│             KuroTV Client (Mobile / TV)                │
│                                                        │
│  ┌─────────────────────────┐                           │
│  │   UI & Player Screens   │                           │
│  └────────────┬────────────┘                           │
│               │ state updates                          │
│  ┌────────────▼────────────┐  mergeLocalAndRemote()    │
│  │   MMKV Local Storage    │ ◄──────────────────────┐  │
│  └────────────┬────────────┘                        │  │
│               │ dirty diffs                         │  │
│  ┌────────────▼────────────┐                        │  │
│  │     KuroSyncClient      │                        │  │
│  └────────────┬────────────┘                        │  │
└───────────────┼─────────────────────────────────────┼──┘
                │ HTTPS (pushDelta / pullDelta)       │
                ▼                                     │
┌─────────────────────────────────────────────────────┼──┐
│             KuroTV_S Cloudflare Worker              │  │
│                                                     │  │
│  ┌─────────────────────────┐                        │  │
│  │  Hono Route Handlers    │                        │  │
│  │  (/api/sync/pull, push) ├────────────────────────┘  │
│  └────────────┬────────────┘                           │
│               ▼                                        │
│  ┌─────────────────────────┐                           │
│  │   Cloudflare D1 SQLite  │                           │
│  │ (<= 50 batched queries) │                           │
│  └─────────────────────────┘                           │
└────────────────────────────────────────────────────────┘
```

---

## 2. MMKV Storage Adapter Mapping

KuroTV stores data collections under dedicated keys defined in `StorageKeys` (`app-storage.ts`). The table below outlines how each local MMKV key translates to the remote delta entities:

| MMKV Storage Key | Local Type | Remote Delta Entity | Primary Key / Lookup |
|---|---|---|---|
| `StorageKeys.FAVORITES` (`user.favorites`) | `AnimeItem[]` | `deltas.favorites` | `animeId` (`id`) |
| `StorageKeys.CONTINUE_WATCHING` (`user.continueWatching`) | `ContinueWatchingItem[]` | `deltas.continueWatching` | `animeId` |
| `StorageKeys.WATCH_HISTORY` (`user.history`) | `WatchHistoryItem[]` | `deltas.watchHistory` | `animeId` + `episodeNumber` |
| `StorageKeys.WATCH_PROGRESS_PREFIX` (`user.progress.<animeId>.<epNum>`) | `WatchProgressItem` | `deltas.watchProgress` | `animeId` + `episodeNumber` |
| `StorageKeys.SEARCH_HISTORY` (`user.searchHistory`) | `SearchHistoryItem[]` | `deltas.searchHistory` | `query` |
| `StorageKeys.APP_SETTINGS` / `ANISKIP_SETTINGS` | `AppSettings` / `AniSkipSettings` | `deltas.sharedSettings` | `key` (`aniSkipSettings`, `autoplayNext`, etc.) |

### Tombstone Mapping
When an entity is deleted locally:
- Favorites: append tombstone `{ type: 'favorite', key: animeId, deletedAt: Date.now() }`.
- Continue Watching: append tombstone `{ type: 'continue_watching', key: animeId, deletedAt: Date.now() }`.
- Watch History: append tombstone `{ type: 'watch_history', key: `${animeId}:${episodeNumber}`, deletedAt: Date.now() }`.
- Watch Progress: append tombstone `{ type: 'watch_progress', key: `${animeId}:${episodeNumber}`, deletedAt: Date.now() }`.
- Search History: append tombstone `{ type: 'search_history', key: query, deletedAt: Date.now() }`.

---

## 3. Playback Progress Debouncing & Flush Rules

To protect Cloudflare Free Tier quotas (100,000 writes/day) while guaranteeing accurate watch positions across devices, the player progress sync MUST adhere to the following debouncing rules:

### Standard Debounce Interval
- During continuous video playback, dispatch progress updates to the sync queue every **45 to 60 seconds**.
- Do NOT push on every video playback tick (e.g. 250ms or 1s intervals).

### Immediate Flush Triggers
Sync must immediately flush pending playback progress without debounce delay when any of the following lifecycle events occur:
1. **Video Pause**: The user pauses playback.
2. **Completion Threshold Reached**: The progress reaches or exceeds **90%** (or the user-defined `endingThresholdSeconds`).
3. **Player Screen Exit**: The player component unmounts or navigation pops back to the anime details or home screen.
4. **App Blur / Background Transition**: `AppState` transitions from `'active'` to `'inactive'` or `'background'`.

### Implementation Pattern
```typescript
import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { syncManager } from "./sync-manager";

export function usePlaybackSync(animeId: string, episodeNumber: number, duration: number) {
  const lastPushedPos = useRef<number>(0);
  const currentPos = useRef<number>(0);
  const debounceTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const flush = async (isCompleted = false) => {
    if (Math.abs(currentPos.current - lastPushedPos.current) > 2 || isCompleted) {
      lastPushedPos.current = currentPos.current;
      await syncManager.recordProgress({
        animeId,
        episodeNumber,
        currentTime: currentPos.current,
        duration,
        percentage: duration > 0 ? (currentPos.current / duration) * 100 : 0,
        isCompleted,
        updatedAt: Date.now(),
      });
    }
  };

  useEffect(() => {
    // 45-second debounce loop during active playback
    debounceTimer.current = setInterval(() => {
      flush(false);
    }, 45000);

    const subscription = AppState.addEventListener("change", (nextState: AppStateStatus) => {
      if (nextState !== "active") {
        flush(false);
      }
    });

    return () => {
      if (debounceTimer.current) clearInterval(debounceTimer.current);
      subscription.remove();
      // Immediate flush on player unmount
      flush(false);
    };
  }, [animeId, episodeNumber, duration]);

  const onProgress = (position: number) => {
    currentPos.current = position;
    if (duration > 0 && position / duration >= 0.9) {
      flush(true);
    }
  };

  const onPause = () => {
    flush(false);
  };

  return { onProgress, onPause };
}
```

---

## 4. App Lifecycle Synchronization Hooks

Clients synchronize bidirectionally based on mobile and Android TV application state transitions:

```
                      ┌──────────────────────┐
                      │    App Cold Start    │
                      └──────────┬───────────┘
                                 │
                     pullDelta() │ mergeLocalAndRemote()
                                 ▼
                      ┌──────────────────────┐
       ┌─────────────►│  AppState: 'active'  │◄────────────┐
       │              │     (Foreground)     │             │
       │              └──────────┬───────────┘             │
       │                         │                         │
       │ App returns to focus    │ App goes to background  │
       │ pullDelta(lastSyncTime) │ pushDelta(pendingQueue) │
       │                         ▼                         │
       │              ┌──────────────────────┐             │
       └──────────────┤AppState: 'background'├─────────────┘
                      │     (Background)     │
                      └──────────────────────┘
```

### Foreground Transition (`active`)
1. Read `lastSyncTimestamp` from MMKV (`sync.last_timestamp`).
2. Invoke `client.pullDelta(lastSyncTimestamp)`.
3. Feed current MMKV state and remote pull deltas into `mergeLocalAndRemote()`.
4. Atomically persist merged results back to MMKV.
5. Notify active React navigation hooks and UI stores to re-render fresh library items.
6. Record `newLastSyncTimestamp = remotePull.serverTime`.

### Background / Exit Transition (`background` / `inactive`)
1. Gather all queued/unpushed mutations recorded during the session.
2. If pending mutations exist, dispatch `client.pushDelta(pendingMutations)`.
3. Clear mutation queue upon successful HTTP 200 response.

---

## 5. TV Simple-Login Pairing Protocol (Step-by-Step)

The pairing protocol allows an Android TV device without a physical keyboard to authenticate effortlessly in seconds via an unambiguous 6-character code or QR scan.

```
Android TV                              KuroTV_S Worker                    Mobile / Web Console
    │                                          │                                     │
    │  1. POST /api/pair/start                 │                                     │
    ├─────────────────────────────────────────►│                                     │
    │  ◄───────────────────────────────────────┤                                     │
    │  { code: "K7X9P2", pairSecret: "..." }   │                                     │
    │                                          │                                     │
    │  [Display Code & QR on TV screen]        │                                     │
    │                                          │                                     │
    │  2. GET /api/pair/status?code=K7X9P2     │                                     │
    │     (Poll every 3s with X-Pair-Secret)   │                                     │
    ├─────────────────────────────────────────►│                                     │
    │  ◄───────────────────────────────────────┤                                     │
    │  { status: "pending" }                   │                                     │
    │                                          │  3. Scan QR or open /pair           │
    │                                          │     Enter PIN & select profile      │
    │                                          │  4. POST /api/pair/approve          │
    │                                          │◄────────────────────────────────────┤
    │                                          │  { ok: true, deviceId: "..." }      │
    │                                          ├────────────────────────────────────►│
    │  5. GET /api/pair/status?code=K7X9P2     │                                     │
    │     (Next poll cycle)                    │                                     │
    ├─────────────────────────────────────────►│                                     │
    │  ◄───────────────────────────────────────┤                                     │
    │  { status: "approved", deviceToken }     │ [Atomic consumption of pairing code]│
    │                                          │                                     │
    │  [Store deviceToken in MMKV]             │                                     │
    │  [Transition to Home Screen]             │                                     │
```

### TV Device Implementation Steps
1. **Start Pairing**: Call `client.startTvPairing({ deviceName: "Living Room TV", deviceType: "tv", platform: "android-tv" })`.
2. **Display UI**: Render the 6-character uppercase `code` in monospace and draw a QR code pointing to `verifyUrl`.
3. **Polling Loop**:
   - Poll `client.pollTvPairing(code, pairSecret)` every 3000 ms.
   - Stop polling if timeout expires (300 seconds / 5 minutes).
   - If response `status === 'approved'`, save `deviceToken` to MMKV and route to TV home screen.

### Mobile App / Web Console Approval Steps
1. The user scans the QR code or navigates to `/pair?code=K7X9P2`.
2. The user selects the desired Profile (e.g. "Principale" or "Salotto TV").
3. Mobile app calls `client.approveTvPairing({ code: "K7X9P2", profileId: "prof-1", deviceLabel: "Living Room TV" })`.
4. Backend issues credentials and links the TV to the profile.

---

## 6. Smart "IN PARI" (Caught-Up) Sync Flow

In KuroTV, an anime marked as **"IN PARI"** (`isCaughtUp = true`) indicates that the user has watched the most recently released episode of an ongoing simulcast series and is waiting for new episodes to air.

### 1. Dual Passive & Remote Detection in KuroTV_M
- **Home List Check (`syncCaughtUpWithHomeList`)**: Zero-network passive check comparing home carousel banners with caught-up titles. If a new episode number is detected in recent releases, the anime is promoted to the front of the Continue Watching list at position 0.
- **Background Remote Scraper (`syncCaughtUpWithRemote`)**: Periodically (every 4 hours), the client checks the scraper backend for new episode releases or series completion.

### 2. Multi-Device Conflict Prevention
When synchronizing Continue Watching across devices, `mergeLocalAndRemote()` prevents state corruption through these invariants:
- **Episode Regression Prevention**: If Device A watched Episode 13 locally, while a sync delta arrives from Device B containing Episode 12 with `isCaughtUp = true`:
  - The SDK preserves Episode 13 metadata (`episodeNumber: 13`, `episodeId`, `dataId`, `position`, `percentage`).
  - The SDK does **NOT** adopt `isCaughtUp = true` from the older Episode 12.
- **Advance Progression**: If Device B watched ahead to Episode 14, the SDK immediately promotes local state to Episode 14 and inherits the newer `isCaughtUp` flag.
- **Tombstone Dominance**: If the user dismisses or removes an anime from Continue Watching on any device, a tombstone is generated (`continue_watching:<animeId>`). Subsequent pulls will purge the item across all connected devices regardless of episode number or position.

---

## 7. Zero-Dependency Client Initialization Example

```typescript
import { KuroSyncClient, mergeLocalAndRemote, type LocalStorageState } from "@kurosync/sync-client";
import { MMKV } from "react-native-mmkv";

const mmkv = new MMKV({ id: "kurotv-storage" });

export const syncClient = new KuroSyncClient({
  baseUrl: "https://kurosync.your-domain.workers.dev",
  deviceToken: mmkv.getString("sync.device_token"),
});

export async function performFullSync(): Promise<void> {
  const token = syncClient.getDeviceToken();
  if (!token) return;

  const lastSync = mmkv.getNumber("sync.last_timestamp") || 0;
  const remotePull = await syncClient.pullDelta(lastSync);

  const localState: LocalStorageState = {
    favorites: JSON.parse(mmkv.getString("user.favorites") || "[]"),
    continueWatching: JSON.parse(mmkv.getString("user.continueWatching") || "[]"),
    watchHistory: JSON.parse(mmkv.getString("user.history") || "[]"),
    watchProgress: [], // Gathered from user.progress.*
    sharedSettings: JSON.parse(mmkv.getString("settings.appSettings") || "{}"),
    searchHistory: JSON.parse(mmkv.getString("user.searchHistory") || "[]"),
  };

  const { state: mergedState } = mergeLocalAndRemote(localState, remotePull);

  mmkv.set("user.favorites", JSON.stringify(mergedState.favorites));
  mmkv.set("user.continueWatching", JSON.stringify(mergedState.continueWatching));
  mmkv.set("user.history", JSON.stringify(mergedState.watchHistory));
  mmkv.set("user.searchHistory", JSON.stringify(mergedState.searchHistory));
  mmkv.set("sync.last_timestamp", remotePull.serverTime);
}
```
