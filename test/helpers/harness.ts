import worker from "../../src/worker/index";
import {
  env as testEnv,
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";

export interface TestResponse<T = any> {
  status: number;
  ok: boolean;
  headers: Headers;
  text: string;
  body: T;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string> | Headers;
  body?: any;
  envOverride?: Partial<Cloudflare.Env>;
}

export class TestHarness {
  private customEnv: Partial<Cloudflare.Env> = {};
  private defaultHeaders: Record<string, string> = {};

  constructor(envOverride?: Partial<Cloudflare.Env>) {
    if (envOverride) {
      this.customEnv = { ...envOverride };
    }
  }

  public setBearerToken(token: string): this {
    this.defaultHeaders["Authorization"] = `Bearer ${token}`;
    return this;
  }

  public setPairSecret(secret: string): this {
    this.defaultHeaders["X-Pair-Secret"] = secret;
    return this;
  }

  public setHeader(key: string, value: string): this {
    this.defaultHeaders[key] = value;
    return this;
  }

  public clearAuth(): this {
    delete this.defaultHeaders["Authorization"];
    delete this.defaultHeaders["X-Pair-Secret"];
    return this;
  }

  public getEffectiveEnv(): Cloudflare.Env {
    return Object.assign({}, testEnv, this.customEnv);
  }

  public async request<T = any>(
    path: string,
    options: RequestOptions = {}
  ): Promise<TestResponse<T>> {
    const url = path.startsWith("http")
      ? path
      : `https://kurosync.local${path.startsWith("/") ? "" : "/"}${path}`;

    const headers = new Headers(this.defaultHeaders);
    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((val, key) => headers.set(key, val));
      } else {
        for (const [key, val] of Object.entries(options.headers)) {
          headers.set(key, val);
        }
      }
    }

    let reqBody: BodyInit | undefined = undefined;
    if (options.body !== undefined) {
      if (
        typeof options.body === "string" ||
        options.body instanceof FormData ||
        options.body instanceof URLSearchParams
      ) {
        reqBody = options.body;
      } else {
        reqBody = JSON.stringify(options.body);
        if (!headers.has("Content-Type")) {
          headers.set("Content-Type", "application/json");
        }
      }
    }

    const req = new Request(url, {
      method: options.method || "GET",
      headers,
      body: reqBody,
    });

    const ctx = createExecutionContext();
    const activeEnv = options.envOverride
      ? Object.assign({}, this.getEffectiveEnv(), options.envOverride)
      : this.getEffectiveEnv();

    const fetchFn =
      typeof (worker as any).fetch === "function"
        ? (worker as any).fetch.bind(worker)
        : (worker as any);

    const res = await fetchFn(req, activeEnv, ctx);
    await waitOnExecutionContext(ctx);

    const text = await res.text();
    let parsedBody: any = null;
    try {
      parsedBody = JSON.parse(text);
    } catch {
      parsedBody = text;
    }

    return {
      status: res.status,
      ok: res.ok,
      headers: res.headers,
      text,
      body: parsedBody as T,
    };
  }

  public get<T = any>(path: string, headers?: Record<string, string>): Promise<TestResponse<T>> {
    return this.request<T>(path, { method: "GET", headers });
  }

  public post<T = any>(path: string, body?: any, headers?: Record<string, string>): Promise<TestResponse<T>> {
    return this.request<T>(path, { method: "POST", body, headers });
  }

  public put<T = any>(path: string, body?: any, headers?: Record<string, string>): Promise<TestResponse<T>> {
    return this.request<T>(path, { method: "PUT", body, headers });
  }

  public delete<T = any>(path: string, headers?: Record<string, string>): Promise<TestResponse<T>> {
    return this.request<T>(path, { method: "DELETE", headers });
  }
}

/**
 * Foreign-key safe database truncation helper.
 * Deletes rows in reverse-dependency order within a single D1 batch.
 */
export async function clearDatabase(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM tombstones"),
    db.prepare("DELETE FROM shared_settings"),
    db.prepare("DELETE FROM watch_progress"),
    db.prepare("DELETE FROM watch_history"),
    db.prepare("DELETE FROM continue_watching"),
    db.prepare("DELETE FROM favorites"),
    db.prepare("DELETE FROM pairing_codes"),
    db.prepare("DELETE FROM devices"),
    db.prepare("DELETE FROM profiles"),
    db.prepare("DELETE FROM instance_config"),
  ]);
}
