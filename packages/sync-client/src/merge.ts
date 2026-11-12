import type {
  AnimeItem,
  ContinueWatchingItem,
  WatchHistoryItem,
  WatchProgressItem,
  SearchHistoryItem,
  LocalStorageState,
  RemotePullResponse,
  MergeResult,
} from "./types";

/**
 * Pure, deterministic function that merges local MMKV state with server pull deltas.
 * - Deletes local items matching remote tombstones
 * - Applies Last-Write-Wins (LWW) based on updatedAt
 * - Enforces timeline progress safeguard for watch progress and continue watching
 * - Prevents continue watching episode regression when local has higher episode number
 * - Consults tombstones for search history to purge deleted queries
 * - Preserves newer metadata based on timestamp order
 * - Propagates isCaughtUp ('IN PARI') flag
 */
export function mergeLocalAndRemote(
  local: LocalStorageState,
  remote: RemotePullResponse
): MergeResult {
  const tombstoneMap = new Map<string, number>();
  for (const t of remote.tombstones || []) {
    tombstoneMap.set(`${t.type}:${t.key}`, t.deletedAt);
  }

  let appliedDeletions = 0;
  let appliedUpserts = 0;

  // --------------------------------------------------------------------------
  // 1. Favorites: purge tombstones, then merge LWW
  // --------------------------------------------------------------------------
  const favMap = new Map<string, AnimeItem>();
  for (const item of local.favorites || []) {
    const tomb = tombstoneMap.get(`favorite:${item.id}`);
    if (tomb !== undefined && (item.updatedAt || 0) <= tomb) {
      appliedDeletions++;
    } else {
      favMap.set(item.id, { ...item });
    }
  }

  for (const item of remote.deltas?.favorites || []) {
    const tomb = tombstoneMap.get(`favorite:${item.id}`);
    if (tomb !== undefined && (item.updatedAt || 0) <= tomb) {
      continue;
    }
    const existing = favMap.get(item.id);
    if (!existing || (item.updatedAt || 0) >= (existing.updatedAt || 0)) {
      favMap.set(item.id, { ...item });
      appliedUpserts++;
    }
  }

  // --------------------------------------------------------------------------
  // 2. Continue Watching: purge tombstones, merge LWW + timeline safeguard + isCaughtUp
  // --------------------------------------------------------------------------
  const cwMap = new Map<string, ContinueWatchingItem>();
  for (const item of local.continueWatching || []) {
    const tomb = tombstoneMap.get(`continue_watching:${item.animeId}`);
    if (tomb !== undefined && (item.updatedAt || 0) <= tomb) {
      appliedDeletions++;
    } else {
      cwMap.set(item.animeId, { ...item });
    }
  }

  for (const item of remote.deltas?.continueWatching || []) {
    const tomb = tombstoneMap.get(`continue_watching:${item.animeId}`);
    if (tomb !== undefined && (item.updatedAt || 0) <= tomb) {
      continue;
    }
    const existing = cwMap.get(item.animeId);
    if (!existing) {
      cwMap.set(item.animeId, { ...item });
      appliedUpserts++;
    } else {
      const localAhead = existing.episodeNumber > item.episodeNumber;
      const remoteAhead = item.episodeNumber > existing.episodeNumber;
      const sameEpisode = item.episodeNumber === existing.episodeNumber;

      let merged: ContinueWatchingItem;

      if (localAhead) {
        // Local is ahead in episode number! Do NOT regress to older episode.
        merged = {
          ...item,
          ...existing,
          episodeNumber: existing.episodeNumber,
          episodeId: existing.episodeId,
          dataId: existing.dataId,
          serverId: existing.serverId,
          position: existing.position,
          percentage: existing.percentage,
          totalEpisodes: existing.totalEpisodes || item.totalEpisodes,
          // Maintain local's isCaughtUp state (not remote's older episode caught-up flag)
          isCaughtUp: existing.isCaughtUp,
          updatedAt: Math.max(existing.updatedAt || 0, item.updatedAt || 0),
        };
      } else if (remoteAhead) {
        // Remote is ahead in episode number! Adopt newer episode.
        merged = {
          ...existing,
          ...item,
          episodeNumber: item.episodeNumber,
          episodeId: item.episodeId,
          dataId: item.dataId,
          serverId: item.serverId,
          position: item.position,
          percentage: item.percentage,
          totalEpisodes: item.totalEpisodes || existing.totalEpisodes,
          isCaughtUp: item.isCaughtUp !== undefined ? item.isCaughtUp : existing.isCaughtUp,
          updatedAt: Math.max(existing.updatedAt || 0, item.updatedAt || 0),
        };
      } else {
        // Same episode: apply timeline progress safeguard & timestamp metadata order
        const base = (item.updatedAt || 0) >= (existing.updatedAt || 0)
          ? { ...existing, ...item }
          : { ...item, ...existing };

        const maxPos = Math.max(existing.position, item.position);
        const maxPct = Math.max(existing.percentage, item.percentage);

        merged = {
          ...base,
          position: maxPos,
          percentage: maxPct,
          isCaughtUp: item.isCaughtUp !== undefined ? item.isCaughtUp : existing.isCaughtUp,
          updatedAt: Math.max(existing.updatedAt || 0, item.updatedAt || 0),
        };
      }

      cwMap.set(item.animeId, merged);
      appliedUpserts++;
    }
  }

  // --------------------------------------------------------------------------
  // 3. Watch History
  // --------------------------------------------------------------------------
  const whMap = new Map<string, WatchHistoryItem>();
  for (const item of local.watchHistory || []) {
    const key = `${item.animeId}:${item.episodeNumber}`;
    const tomb = tombstoneMap.get(`watch_history:${key}`);
    if (tomb !== undefined && (item.updatedAt || 0) <= tomb) {
      appliedDeletions++;
    } else {
      whMap.set(key, { ...item });
    }
  }

  for (const item of remote.deltas?.watchHistory || []) {
    const key = `${item.animeId}:${item.episodeNumber}`;
    const tomb = tombstoneMap.get(`watch_history:${key}`);
    if (tomb !== undefined && (item.updatedAt || 0) <= tomb) {
      continue;
    }
    const existing = whMap.get(key);
    if (!existing || (item.updatedAt || 0) >= (existing.updatedAt || 0)) {
      whMap.set(key, {
        ...item,
        isCompleted: existing?.isCompleted || item.isCompleted,
      });
      appliedUpserts++;
    }
  }

  // --------------------------------------------------------------------------
  // 4. Watch Progress: timeline progress safeguard & metadata timestamp order
  // --------------------------------------------------------------------------
  const wpMap = new Map<string, WatchProgressItem>();
  for (const item of local.watchProgress || []) {
    const key = `${item.animeId}:${item.episodeNumber}`;
    const tomb = tombstoneMap.get(`watch_progress:${key}`);
    if (tomb !== undefined && (item.updatedAt || 0) <= tomb) {
      appliedDeletions++;
    } else {
      wpMap.set(key, { ...item });
    }
  }

  for (const item of remote.deltas?.watchProgress || []) {
    const key = `${item.animeId}:${item.episodeNumber}`;
    const tomb = tombstoneMap.get(`watch_progress:${key}`);
    if (tomb !== undefined && (item.updatedAt || 0) <= tomb) {
      continue;
    }
    const existing = wpMap.get(key);
    if (!existing) {
      wpMap.set(key, { ...item });
      appliedUpserts++;
    } else {
      // Respect metadata timestamp order so newer local metadata is not clobbered by stale remote metadata
      const base = (item.updatedAt || 0) >= (existing.updatedAt || 0)
        ? { ...existing, ...item }
        : { ...item, ...existing };

      const merged: WatchProgressItem = {
        ...base,
        currentTime: Math.max(existing.currentTime, item.currentTime),
        percentage: Math.max(existing.percentage, item.percentage),
        isCompleted: existing.isCompleted || item.isCompleted,
        updatedAt: Math.max(existing.updatedAt || 0, item.updatedAt || 0),
      };
      wpMap.set(key, merged);
      appliedUpserts++;
    }
  }

  // --------------------------------------------------------------------------
  // 5. Shared Settings
  // --------------------------------------------------------------------------
  const sharedSettings = {
    ...local.sharedSettings,
    ...remote.deltas?.sharedSettings,
  };

  // --------------------------------------------------------------------------
  // 6. Search History: tombstone dominance & timestamp ordering
  // --------------------------------------------------------------------------
  const searchHistoryMap = new Map<string, SearchHistoryItem>();
  for (const s of local.searchHistory || []) {
    const tomb = tombstoneMap.get(`search_history:${s.query}`);
    if (tomb !== undefined && (s.timestamp || 0) <= tomb) {
      appliedDeletions++;
    } else {
      searchHistoryMap.set(s.query, { ...s });
    }
  }

  for (const s of remote.deltas?.searchHistory || []) {
    const tomb = tombstoneMap.get(`search_history:${s.query}`);
    if (tomb !== undefined && (s.timestamp || 0) <= tomb) {
      continue;
    }
    const existing = searchHistoryMap.get(s.query);
    if (!existing || s.timestamp >= existing.timestamp) {
      searchHistoryMap.set(s.query, { ...s });
      appliedUpserts++;
    }
  }

  return {
    state: {
      favorites: Array.from(favMap.values()),
      continueWatching: Array.from(cwMap.values()),
      watchHistory: Array.from(whMap.values()),
      watchProgress: Array.from(wpMap.values()),
      sharedSettings,
      searchHistory: Array.from(searchHistoryMap.values()),
    },
    appliedDeletions,
    appliedUpserts,
  };
}
