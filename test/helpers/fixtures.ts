/**
 * Authentic test fixtures for KuroTV_S E2E testing
 * Conforms to types from KuroTV_M reference client and packages/sync-client
 */

import type {
  AnimeItem,
  ContinueWatchingItem,
  WatchHistoryItem,
  WatchProgressItem,
  SearchHistoryItem,
  AniSkipSettings,
} from "@kurosync/sync-client";

export const FIXTURE_ANIME_1: AnimeItem = {
  id: "anime-solo-leveling",
  title: "Solo Leveling",
  japaneseTitle: "Ore dake Level Up na Ken",
  thumbnail: "https://example.com/thumbnails/solo-leveling.jpg",
  type: "TV",
  releaseYear: 2024,
  status: "Completed",
  totalEpisodes: 12,
  genres: ["Action", "Fantasy", "Adventure"],
  link: "https://animeworld.so/play/solo-leveling",
  subOrDub: "SUB",
  updatedAt: 1700000000000,
};

export const FIXTURE_ANIME_2: AnimeItem = {
  id: "anime-frieren",
  title: "Frieren: Beyond Journey's End",
  japaneseTitle: "Sousou no Frieren",
  thumbnail: "https://example.com/thumbnails/frieren.jpg",
  type: "TV",
  releaseYear: 2023,
  status: "Completed",
  totalEpisodes: 28,
  genres: ["Adventure", "Drama", "Fantasy"],
  link: "https://animeworld.so/play/sousou-no-frieren",
  subOrDub: "SUB",
  updatedAt: 1700001000000,
};

export const FIXTURE_ANIME_3: AnimeItem = {
  id: "anime-jujutsu-kaisen-s2",
  title: "Jujutsu Kaisen Season 2",
  japaneseTitle: "Jujutsu Kaisen 2nd Season",
  thumbnail: "https://example.com/thumbnails/jjk-s2.jpg",
  type: "TV",
  releaseYear: 2023,
  status: "Completed",
  totalEpisodes: 23,
  genres: ["Action", "Fantasy", "Supernatural"],
  link: "https://animeworld.so/play/jujutsu-kaisen-2nd-season",
  subOrDub: "SUB",
  updatedAt: 1700002000000,
};

export const FIXTURE_PROGRESS_1: WatchProgressItem = {
  animeId: "anime-solo-leveling",
  animeTitle: "Solo Leveling",
  thumbnail: "https://example.com/thumbnails/solo-leveling.jpg",
  episodeId: "ep-12",
  episodeNumber: 12,
  totalEpisodes: 12,
  currentTime: 1350,
  duration: 1420,
  percentage: 95.0,
  isCompleted: true,
  dataId: "data-ep-12",
  serverId: "server-stream-1",
  updatedAt: 1700000000000,
};

export const FIXTURE_PROGRESS_2: WatchProgressItem = {
  animeId: "anime-frieren",
  animeTitle: "Frieren: Beyond Journey's End",
  thumbnail: "https://example.com/thumbnails/frieren.jpg",
  episodeId: "ep-14",
  episodeNumber: 14,
  totalEpisodes: 28,
  currentTime: 640,
  duration: 1440,
  percentage: 44.4,
  isCompleted: false,
  dataId: "data-ep-14",
  serverId: "server-stream-1",
  updatedAt: 1700001000000,
};

export const FIXTURE_CONTINUE_WATCHING_1: ContinueWatchingItem = {
  animeId: "anime-solo-leveling",
  title: "Solo Leveling",
  thumbnail: "https://example.com/thumbnails/solo-leveling.jpg",
  episodeId: "ep-12",
  episodeNumber: 12,
  totalEpisodes: 12,
  position: 1350,
  duration: 1420,
  percentage: 95.0,
  isCaughtUp: true,
  lastCheckedAt: 1700000000000,
  updatedAt: 1700000000000,
  dataId: "data-ep-12",
  serverId: "server-stream-1",
};

export const FIXTURE_CONTINUE_WATCHING_2: ContinueWatchingItem = {
  animeId: "anime-frieren",
  title: "Frieren: Beyond Journey's End",
  thumbnail: "https://example.com/thumbnails/frieren.jpg",
  episodeId: "ep-14",
  episodeNumber: 14,
  totalEpisodes: 28,
  position: 640,
  duration: 1440,
  percentage: 44.4,
  isCaughtUp: false,
  lastCheckedAt: 1700001000000,
  updatedAt: 1700001000000,
  dataId: "data-ep-14",
  serverId: "server-stream-1",
};

export const FIXTURE_WATCH_HISTORY_1: WatchHistoryItem = {
  animeId: "anime-solo-leveling",
  title: "Solo Leveling",
  thumbnail: "https://example.com/thumbnails/solo-leveling.jpg",
  episodeId: "ep-12",
  episodeNumber: 12,
  position: 1350,
  duration: 1420,
  progressPercent: 95.0,
  isCompleted: true,
  dataId: "data-ep-12",
  serverId: "server-stream-1",
  updatedAt: 1700000000000,
};

export const FIXTURE_WATCH_HISTORY_2: WatchHistoryItem = {
  animeId: "anime-frieren",
  title: "Frieren: Beyond Journey's End",
  thumbnail: "https://example.com/thumbnails/frieren.jpg",
  episodeId: "ep-13",
  episodeNumber: 13,
  position: 1400,
  duration: 1440,
  progressPercent: 97.2,
  isCompleted: true,
  dataId: "data-ep-13",
  serverId: "server-stream-1",
  updatedAt: 1700000500000,
};

export const FIXTURE_ANISKIP_SETTINGS: AniSkipSettings = {
  mode: "auto",
  enableOpening: true,
  enableEnding: true,
  enableRecap: false,
  buttonDuration: 5,
};

export const FIXTURE_SEARCH_HISTORY_1: SearchHistoryItem = {
  query: "Solo Leveling",
  timestamp: 1700000000000,
};

export const FIXTURE_PROFILE_PRIMARY = {
  id: "profile-principale-uuid-1",
  name: "Principale",
  avatarColor: "#E50914",
};

export const FIXTURE_PROFILE_SECONDARY = {
  id: "profile-salotto-uuid-2",
  name: "Salotto TV",
  avatarColor: "#3B82F6",
};

export const FIXTURE_DEVICE_MOBILE = {
  id: "device-mobile-uuid-1",
  name: "Pixel 8 Pro",
  deviceType: "mobile" as const,
  platform: "android",
};

export const FIXTURE_DEVICE_TV = {
  id: "device-tv-uuid-2",
  name: "Sony Bravia 4K TV",
  deviceType: "tv" as const,
  platform: "android-tv",
};

export function createAnimeFixture(overrides: Partial<AnimeItem> = {}): AnimeItem {
  return {
    ...FIXTURE_ANIME_1,
    id: `anime-${crypto.randomUUID()}`,
    ...overrides,
  };
}

export function createProgressFixture(overrides: Partial<WatchProgressItem> = {}): WatchProgressItem {
  return {
    ...FIXTURE_PROGRESS_1,
    ...overrides,
  };
}

export function createContinueWatchingFixture(overrides: Partial<ContinueWatchingItem> = {}): ContinueWatchingItem {
  return {
    ...FIXTURE_CONTINUE_WATCHING_1,
    ...overrides,
  };
}
