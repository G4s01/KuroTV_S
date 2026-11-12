/**
 * KuroSync Client SDK - Type Definitions
 * Pure TypeScript, zero runtime dependencies.
 * Compatible with Hermes, React Native, Android TV, Node.js, and Web browsers.
 */

// ============================================================================
// Domain Entity Interfaces (Matching KuroTV_M MMKV Schemas)
// ============================================================================

export interface AnimeItem {
  id: string;
  title: string;
  japaneseTitle?: string | null;
  thumbnail: string;
  type?: string;
  releaseYear?: number;
  status?: string;
  totalEpisodes?: string | number;
  genres: string[];
  link: string;
  subOrDub?: string;
  updatedAt?: number;
}

export interface ContinueWatchingItem {
  animeId: string;
  title: string;
  thumbnail: string;
  episodeId: string;
  episodeNumber: number;
  totalEpisodes?: string | number;
  position: number;
  duration: number;
  percentage: number;
  updatedAt: number;
  dataId?: string;
  serverId?: string;
  isCaughtUp?: boolean;
  lastCheckedAt?: number;
}

export interface WatchHistoryItem {
  animeId: string;
  title: string;
  thumbnail: string;
  episodeId: string;
  episodeNumber: number;
  position: number;
  duration: number;
  progressPercent: number;
  updatedAt: number;
  isCompleted?: boolean;
  dataId?: string;
  serverId?: string;
}

export interface WatchProgressItem {
  animeId: string;
  animeTitle: string;
  thumbnail: string;
  episodeId: string;
  episodeNumber: number;
  totalEpisodes?: string | number;
  currentTime: number;
  duration: number;
  percentage: number;
  isCompleted: boolean;
  updatedAt: number;
  dataId?: string;
  serverId?: string;
}

export interface SearchHistoryItem {
  query: string;
  timestamp: number;
}

export type AniSkipMode = "manual" | "auto" | "disabled";

export interface AniSkipSettings {
  mode: AniSkipMode;
  enableOpening: boolean;
  enableEnding: boolean;
  enableRecap: boolean;
  buttonDuration: number;
}

export const DEFAULT_ANISKIP_SETTINGS: AniSkipSettings = {
  mode: "manual",
  enableOpening: true,
  enableEnding: true,
  enableRecap: true,
  buttonDuration: 10,
};

export interface SharedSettings {
  aniSkipSettings?: AniSkipSettings;
  endingThresholdSeconds?: number;
  preferredQuality?: string;
  autoplayNext?: boolean;
  defaultServer?: string;
  tld?: string;
  customDomain?: string;
  historyRetentionDays?: number;
  searchHistoryRetentionDays?: number;
  search_history?: SearchHistoryItem[];
  [key: string]: any;
}

// ============================================================================
// API DTOs (Request / Response Contracts)
// ============================================================================

export interface KuroSyncClientOptions {
  baseUrl: string;
  deviceToken?: string;
}

export interface ClientHealthResponse {
  ok: boolean;
  initialized: boolean;
  version: string;
  error?: string;
}

export interface DeviceLoginRequest {
  password: string;
  profileId: string;
  deviceName?: string;
  deviceType?: "mobile" | "tv" | "web" | string;
  platform?: string;
}

export interface DeviceLoginResponse {
  ok: boolean;
  deviceToken: string;
  deviceId: string;
  profile: {
    id: string;
    name: string;
  };
}

export interface PairingStartRequest {
  deviceName: string;
  deviceType?: "tv" | "mobile" | string;
  platform?: string;
}

export interface PairingStartResponse {
  code: string;
  pairSecret: string;
  expiresIn: number;
  verifyUrl: string;
}

export interface PairingStatusResponse {
  status: "pending" | "approved" | "expired" | "consumed" | string;
  deviceToken?: string;
  deviceId?: string;
  profileId?: string;
  profileName?: string;
}

export interface PairingApproveRequest {
  code: string;
  profileId: string;
  deviceLabel?: string;
}

export interface PairingApproveResponse {
  ok: boolean;
  deviceId: string;
}

export interface TombstoneItem {
  type: "favorite" | "continue_watching" | "watch_history" | "watch_progress" | "search_history" | string;
  key: string;
  deletedAt: number;
}

export interface DeltaPushDeletion {
  type: "favorite" | "continue_watching" | "watch_history" | "watch_progress" | "search_history" | string;
  key: string;
  deletedAt?: number;
}

export interface DeltaPushRequest {
  favorites?: AnimeItem[];
  continueWatching?: ContinueWatchingItem[];
  watchHistory?: WatchHistoryItem[];
  watchProgress?: WatchProgressItem[];
  sharedSettings?: Record<string, any>;
  searchHistory?: SearchHistoryItem[];
  deletions?: DeltaPushDeletion[];
}

export interface DeltaPushResponse {
  ok: boolean;
  serverTime: number;
  appliedCount: number;
}

export interface RemotePullResponse {
  serverTime: number;
  profile?: { id: string; name: string };
  deltas: {
    favorites: AnimeItem[];
    continueWatching: ContinueWatchingItem[];
    watchHistory: WatchHistoryItem[];
    watchProgress: WatchProgressItem[];
    sharedSettings: Record<string, any>;
    searchHistory: SearchHistoryItem[];
  };
  tombstones: TombstoneItem[];
}

export interface BackupExportData {
  version: number;
  exportedAt: number;
  profiles: any[];
  favorites: any[];
  continueWatching: any[];
  watchHistory: any[];
  watchProgress: any[];
  sharedSettings: any[];
  tombstones: any[];
}

export interface BackupImportResponse {
  ok: boolean;
  restoredCount: number;
}

// ============================================================================
// Local Storage & Merge Engine State
// ============================================================================

export interface LocalStorageState {
  favorites: AnimeItem[];
  continueWatching: ContinueWatchingItem[];
  watchHistory: WatchHistoryItem[];
  watchProgress: WatchProgressItem[];
  sharedSettings: Record<string, any>;
  searchHistory: SearchHistoryItem[];
}

export interface MergeResult {
  state: LocalStorageState;
  appliedDeletions: number;
  appliedUpserts: number;
}
