/**
 * KuroSync Web Console Typed API Client
 * Wraps backend endpoints with token injection and error handling.
 */

export interface HealthResponse {
  ok: boolean;
  initialized: boolean;
  version: string;
  error?: string;
}

export interface SetupResponse {
  ok: boolean;
  profileId?: string;
  sessionToken?: string;
  token?: string;
  deviceId?: string;
  profile?: { id: string; name: string };
  error?: string;
  message?: string;
}

export interface LoginResponse {
  ok: boolean;
  token?: string;
  sessionToken?: string;
  deviceId?: string;
  profileId?: string;
  profile?: { id: string; name: string };
  error?: string;
  message?: string;
}

export interface PairInfoResponse {
  ok: boolean;
  code: string;
  deviceName: string;
  deviceType: 'tv' | 'mobile';
  platform: string;
  status: 'pending' | 'approved' | 'expired' | 'consumed';
  expiresAt: number;
  error?: string;
}

export interface ProfileRecord {
  id: string;
  name: string;
  avatarColor: string;
  avatar_color?: string;
  created_at: number;
  updated_at: number;
}

export interface DeviceRecord {
  id: string;
  profile_id: string;
  name: string;
  device_type: 'tv' | 'mobile' | 'web';
  platform: string;
  last_seen_at: number;
  created_at: number;
  revoked_at: number | null;
}

export interface ContinueWatchingViewItem {
  animeId: string;
  title: string;
  thumbnail?: string;
  episodeId: string;
  episodeNumber: number;
  totalEpisodes?: number;
  position: number;
  duration: number;
  percentage: number;
  isCaughtUp: boolean;
  lastCheckedAt?: number;
  updatedAt?: number;
}

export interface FavoriteViewItem {
  id: string;
  title: string;
  japaneseTitle?: string;
  thumbnail?: string;
  type?: string;
  releaseYear?: string;
  status?: string;
  totalEpisodes?: number;
  genres?: string[];
  link?: string;
  subOrDub?: string;
  updatedAt?: number;
}

export interface WatchHistoryViewItem {
  animeId: string;
  title: string;
  thumbnail?: string;
  episodeId: string;
  episodeNumber: number;
  position: number;
  duration: number;
  progressPercent: number;
  isCompleted: boolean;
  updatedAt?: number;
}

export interface PullLibraryResponse {
  serverTime: number;
  profile: { id: string; name: string };
  deltas: {
    favorites: FavoriteViewItem[];
    continueWatching: ContinueWatchingViewItem[];
    watchHistory: WatchHistoryViewItem[];
    watchProgress: any[];
    sharedSettings: Record<string, any>;
    searchHistory: any[];
  };
  tombstones: Array<{ type: string; key: string; deletedAt: number }>;
}

export class KuroSyncApi {
  private token: string | null = null;
  private activeProfileId: string | null = null;

  constructor() {
    if (typeof window !== 'undefined' && window.localStorage) {
      this.token = localStorage.getItem('kurosync_token');
      this.activeProfileId = localStorage.getItem('kurosync_profile_id');
    }
  }

  public setToken(token: string | null) {
    this.token = token;
    if (typeof window !== 'undefined' && window.localStorage) {
      if (token) {
        localStorage.setItem('kurosync_token', token);
      } else {
        localStorage.removeItem('kurosync_token');
      }
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  public setActiveProfileId(profileId: string | null) {
    this.activeProfileId = profileId;
    if (typeof window !== 'undefined' && window.localStorage) {
      if (profileId) {
        localStorage.setItem('kurosync_profile_id', profileId);
      } else {
        localStorage.removeItem('kurosync_profile_id');
      }
    }
  }

  public getActiveProfileId(): string | null {
    return this.activeProfileId;
  }

  public async logout(): Promise<void> {
    try {
      if (this.token) {
        await this.request('/api/auth/logout', { method: 'POST' });
      }
    } catch (e) {
      console.warn('Backend logout notification failed:', e);
    } finally {
      this.setToken(null);
      this.setActiveProfileId(null);
    }
  }

  /**
   * Generate Ephemeral Single-Use QR Connect Token
   */
  public async createQrToken(profileId?: string): Promise<{
    ok: boolean;
    qrToken: string;
    expiresAt: number;
    expiresInSeconds: number;
    profileId: string;
  }> {
    return this.request<{
      ok: boolean;
      qrToken: string;
      expiresAt: number;
      expiresInSeconds: number;
      profileId: string;
    }>('/api/auth/qr-token', {
      method: 'POST',
      body: JSON.stringify({ profileId }),
    });
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers = new Headers(options.headers || {});
    headers.set('Accept', 'application/json');

    if (this.token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(path, {
      ...options,
      headers,
    });

    const data: any = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMsg =
        (data && (data.error || data.message)) ||
        `HTTP ${response.status}: ${response.statusText}`;
      const err = new Error(errorMsg);
      (err as any).status = response.status;
      (err as any).data = data;
      throw err;
    }

    return data as T;
  }

  /**
   * Check reachability and initialization status
   */
  public async checkHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/api/health');
  }

  /**
   * First-run Zero-Config Setup
   */
  public async setup(
    masterPassword: string,
    initialProfileName: string = 'Principale',
    avatarColor: string = '#E50914'
  ): Promise<SetupResponse> {
    const res = await this.request<SetupResponse>('/api/setup', {
      method: 'POST',
      body: JSON.stringify({
        masterPassword,
        initialProfileName,
        avatarColor,
        createSession: true,
      }),
    });

    if (res.sessionToken || res.token) {
      this.setToken(res.sessionToken || res.token || null);
    }
    if (res.profileId) {
      this.setActiveProfileId(res.profileId);
    }
    return res;
  }

  /**
   * Master Password Login
   */
  public async login(password: string): Promise<LoginResponse> {
    const res = await this.request<LoginResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });

    if (res.sessionToken || res.token) {
      this.setToken(res.sessionToken || res.token || null);
    }
    if (res.profileId) {
      this.setActiveProfileId(res.profileId);
    }
    return res;
  }

  /**
   * Inspect pairing code metadata without private secret
   */
  public async getPairInfo(code: string): Promise<PairInfoResponse> {
    return this.request<PairInfoResponse>(
      `/api/pair/info?code=${encodeURIComponent(code.trim())}`
    );
  }

  /**
   * Approve TV pairing code
   */
  public async approvePair(
    code: string,
    profileId: string,
    deviceLabel?: string
  ): Promise<{ ok: boolean; deviceId: string }> {
    return this.request<{ ok: boolean; deviceId: string }>('/api/pair/approve', {
      method: 'POST',
      body: JSON.stringify({
        code: code.trim().toUpperCase(),
        profileId,
        deviceLabel: deviceLabel?.trim(),
      }),
    });
  }

  /**
   * Profiles CRUD
   */
  public async listProfiles(): Promise<{ ok: boolean; profiles: ProfileRecord[] }> {
    return this.request<{ ok: boolean; profiles: ProfileRecord[] }>('/api/profiles');
  }

  public async createProfile(
    name: string,
    avatarColor: string = '#E50914'
  ): Promise<{ ok: boolean; profile: ProfileRecord }> {
    return this.request<{ ok: boolean; profile: ProfileRecord }>('/api/profiles', {
      method: 'POST',
      body: JSON.stringify({ name, avatarColor }),
    });
  }

  public async updateProfile(
    id: string,
    data: { name?: string; avatarColor?: string }
  ): Promise<{ ok: boolean; profile: ProfileRecord }> {
    return this.request<{ ok: boolean; profile: ProfileRecord }>(
      `/api/profiles/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      }
    );
  }

  public async deleteProfile(id: string): Promise<{ ok: boolean; deletedId: string }> {
    return this.request<{ ok: boolean; deletedId: string }>(`/api/profiles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Connected Devices
   */
  public async listDevices(profileId?: string): Promise<{ ok: boolean; devices: DeviceRecord[] }> {
    const url = profileId
      ? `/api/devices?profileId=${encodeURIComponent(profileId)}`
      : '/api/devices';
    return this.request<{ ok: boolean; devices: DeviceRecord[] }>(url);
  }

  public async revokeDevice(id: string): Promise<{ ok: boolean; revokedId?: string; revokedAt?: number; deletedId?: string; purged?: boolean }> {
    return this.request<{ ok: boolean; revokedId?: string; revokedAt?: number; deletedId?: string; purged?: boolean }>(
      `/api/devices/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    );
  }

  public async deleteDevicePermanently(id: string): Promise<{ ok: boolean; deletedId: string; purged: boolean }> {
    return this.request<{ ok: boolean; deletedId: string; purged: boolean }>(
      `/api/devices/${encodeURIComponent(id)}?purge=true`,
      {
        method: 'DELETE',
      }
    );
  }

  public async purgeRevokedDevices(profileId?: string): Promise<{ ok: boolean; purgedCount: number }> {
    const url = profileId
      ? `/api/devices/revoked?profileId=${encodeURIComponent(profileId)}`
      : '/api/devices/revoked';
    return this.request<{ ok: boolean; purgedCount: number }>(url, {
      method: 'DELETE',
    });
  }

  /**
   * Delta Sync & Library
   */
  public async pullLibrary(since: number = 0): Promise<PullLibraryResponse> {
    return this.request<PullLibraryResponse>(`/api/sync/pull?since=${since}`);
  }

  public async pushDelta(payload: {
    favorites?: any[];
    continueWatching?: any[];
    watchHistory?: any[];
    watchProgress?: any[];
    sharedSettings?: Record<string, any>;
    searchHistory?: any[];
    deletions?: Array<{ type: string; key: string; deletedAt?: number }>;
  }): Promise<{ ok: boolean; serverTime: number; appliedCount: number }> {
    return this.request<{ ok: boolean; serverTime: number; appliedCount: number }>('/api/sync/push', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  public async deleteLibraryItem(type: 'continue_watching' | 'favorite' | 'watch_history', key: string): Promise<void> {
    await this.pushDelta({
      deletions: [{ type, key, deletedAt: Date.now() }],
    });
  }

  /**
   * Backup & Restore
   */
  public async exportBackup(): Promise<any> {
    return this.request<any>('/api/sync/export');
  }

  public async importBackup(payload: any): Promise<{ ok: boolean; message: string; counts?: any }> {
    return this.request<{ ok: boolean; message: string; counts?: any }>('/api/sync/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}

export const api = new KuroSyncApi();
