import type {
  KuroSyncClientOptions,
  ClientHealthResponse,
  DeviceLoginRequest,
  DeviceLoginResponse,
  PairingStartRequest,
  PairingStartResponse,
  PairingStatusResponse,
  PairingApproveRequest,
  PairingApproveResponse,
  DeltaPushRequest,
  DeltaPushResponse,
  RemotePullResponse,
  BackupExportData,
  BackupImportResponse,
  TokenExchangeRequest,
  TokenExchangeResponse,
  LogoutResponse,
} from "./types";

/**
 * KuroSyncClient
 * Pure TypeScript HTTP Client SDK for KuroTV_S Cloudflare Workers backend.
 * Zero external runtime dependencies. Compatible with Hermes, React Native, Android TV, and Web browsers.
 */
export class KuroSyncClient {
  private deviceToken?: string;

  constructor(public readonly options: KuroSyncClientOptions) {
    this.deviceToken = options.deviceToken;
  }

  setDeviceToken(token: string): void {
    this.deviceToken = token;
  }

  getDeviceToken(): string | undefined {
    return this.deviceToken;
  }

  private getUrl(path: string): string {
    const base = this.options.baseUrl.replace(/\/+$/, "");
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }

  private getHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...extraHeaders,
    };
    if (this.deviceToken) {
      headers["Authorization"] = `Bearer ${this.deviceToken}`;
    }
    return headers;
  }

  private async handleErrorResponse(res: Response, fallbackAction: string): Promise<never> {
    let errorMessage = `${fallbackAction} failed with status: ${res.status}`;
    try {
      const data = await res.json();
      if (data && typeof data === "object") {
        const msg = (data as any).message || (data as any).error;
        if (msg) {
          errorMessage = `${fallbackAction} failed (${res.status}): ${msg}`;
        }
      }
    } catch {
      // Body not JSON or already consumed
    }
    throw new Error(errorMessage);
  }

  // --------------------------------------------------------------------------
  // 1. Health & Status
  // --------------------------------------------------------------------------
  async checkHealth(): Promise<ClientHealthResponse> {
    const res = await fetch(this.getUrl("/api/health"), {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      await this.handleErrorResponse(res, "Health check");
    }

    return (await res.json()) as ClientHealthResponse;
  }

  // --------------------------------------------------------------------------
  // 2. Device Direct Login (Password + Profile)
  // --------------------------------------------------------------------------
  async loginDevice(req: DeviceLoginRequest): Promise<DeviceLoginResponse> {
    const res = await fetch(this.getUrl("/api/auth/device-login"), {
      method: "POST",
      headers: this.getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      await this.handleErrorResponse(res, "Device login");
    }

    const data = (await res.json()) as DeviceLoginResponse;
    if (data.deviceToken) {
      this.deviceToken = data.deviceToken;
    }
    return data;
  }

  // --------------------------------------------------------------------------
  // 2b. Ephemeral QR Token Exchange & Device Logout
  // --------------------------------------------------------------------------
  async exchangeToken(req: TokenExchangeRequest): Promise<TokenExchangeResponse> {
    const res = await fetch(this.getUrl("/api/auth/exchange"), {
      method: "POST",
      headers: this.getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      await this.handleErrorResponse(res, "Token exchange");
    }

    const data = (await res.json()) as TokenExchangeResponse;
    if (data.deviceToken) {
      this.deviceToken = data.deviceToken;
    }
    return data;
  }

  async logout(): Promise<LogoutResponse> {
    const res = await fetch(this.getUrl("/api/auth/logout"), {
      method: "POST",
      headers: this.getHeaders({ "Content-Type": "application/json" }),
    });

    if (!res.ok) {
      await this.handleErrorResponse(res, "Logout");
    }

    const data = (await res.json()) as LogoutResponse;
    this.deviceToken = undefined;
    return data;
  }

  // --------------------------------------------------------------------------
  // 3. Simple-Login TV Pairing Flow
  // --------------------------------------------------------------------------
  async startTvPairing(req: PairingStartRequest): Promise<PairingStartResponse> {
    const res = await fetch(this.getUrl("/api/pair/start"), {
      method: "POST",
      headers: this.getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      await this.handleErrorResponse(res, "Start TV pairing");
    }

    return (await res.json()) as PairingStartResponse;
  }

  async pollTvPairing(code: string, pairSecret: string): Promise<PairingStatusResponse> {
    const normalizedCode = code.trim().toUpperCase();
    const res = await fetch(
      this.getUrl(`/api/pair/status?code=${encodeURIComponent(normalizedCode)}`),
      {
        method: "GET",
        headers: this.getHeaders({
          "X-Pair-Secret": pairSecret,
        }),
      }
    );

    if (!res.ok) {
      await this.handleErrorResponse(res, "Poll TV pairing");
    }

    const data = (await res.json()) as PairingStatusResponse;
    if (data.status === "approved" && data.deviceToken) {
      this.deviceToken = data.deviceToken;
    }
    return data;
  }

  async approveTvPairing(req: PairingApproveRequest): Promise<PairingApproveResponse> {
    const res = await fetch(this.getUrl("/api/pair/approve"), {
      method: "POST",
      headers: this.getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      await this.handleErrorResponse(res, "Approve TV pairing");
    }

    return (await res.json()) as PairingApproveResponse;
  }

  // --------------------------------------------------------------------------
  // 4. Delta Synchronization (Pull & Push)
  // --------------------------------------------------------------------------
  async pullDelta(since = 0): Promise<RemotePullResponse> {
    const res = await fetch(this.getUrl(`/api/sync/pull?since=${since}`), {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      await this.handleErrorResponse(res, "Pull delta");
    }

    return (await res.json()) as RemotePullResponse;
  }

  async pushDelta(delta: DeltaPushRequest): Promise<DeltaPushResponse> {
    const res = await fetch(this.getUrl("/api/sync/push"), {
      method: "POST",
      headers: this.getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(delta),
    });

    if (!res.ok) {
      await this.handleErrorResponse(res, "Push delta");
    }

    return (await res.json()) as DeltaPushResponse;
  }

  // --------------------------------------------------------------------------
  // 5. Backup Export & Import
  // --------------------------------------------------------------------------
  async exportBackup(profileId?: string): Promise<BackupExportData> {
    const query = profileId ? `?profileId=${encodeURIComponent(profileId)}` : "";
    const res = await fetch(this.getUrl(`/api/sync/export${query}`), {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      await this.handleErrorResponse(res, "Export backup");
    }

    return (await res.json()) as BackupExportData;
  }

  async importBackup(backup: BackupExportData): Promise<BackupImportResponse> {
    const res = await fetch(this.getUrl("/api/sync/import"), {
      method: "POST",
      headers: this.getHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ backup }),
    });

    if (!res.ok) {
      await this.handleErrorResponse(res, "Import backup");
    }

    return (await res.json()) as BackupImportResponse;
  }
}
