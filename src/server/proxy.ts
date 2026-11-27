export interface ProxyConfig {
  trustProxy: boolean;
  publicOrigin?: string;
}

function firstHeaderToken(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const first = raw.split(",")[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}

export function normalizeRemoteIp(remoteAddress?: string | null): string | undefined {
  if (!remoteAddress) return undefined;
  const trimmed = remoteAddress.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
}

function sanitizeProto(raw?: string): "http" | "https" | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower === "http" || lower === "https") {
    return lower;
  }
  return undefined;
}

function sanitizeHost(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || /[\s/@\\]/.test(trimmed)) {
    return undefined;
  }
  try {
    const parsed = new URL(`http://${trimmed}`);
    return parsed.host;
  } catch {
    return undefined;
  }
}

export function resolvePublicOrigin(rawPublicUrl?: string): string | undefined {
  if (!rawPublicUrl || rawPublicUrl.trim().length === 0) {
    return undefined;
  }
  const parsed = new URL(rawPublicUrl.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid PUBLIC_URL protocol '${parsed.protocol}'; expected http: or https:`);
  }
  return parsed.origin;
}

/**
 * Rebuilds the Web Request URL and client IP headers for reverse proxies (e.g. Nginx Proxy Manager).
 * When `trustProxy` is false, client-supplied forwarding headers are stripped to prevent rate-limit spoofing.
 */
export function normalizeProxyRequest(
  request: Request,
  remoteAddress: string | undefined,
  config: ProxyConfig
): Request {
  const rawUrl = new URL(request.url);
  const headers = new Headers(request.headers);
  const normalizedIp = normalizeRemoteIp(remoteAddress) || "127.0.0.1";

  let targetOrigin = rawUrl.origin;

  if (config.publicOrigin) {
    targetOrigin = config.publicOrigin;
  } else if (config.trustProxy) {
    const proto =
      sanitizeProto(firstHeaderToken(headers.get("x-forwarded-proto"))) ||
      sanitizeProto(firstHeaderToken(headers.get("x-forwarded-scheme"))) ||
      (rawUrl.protocol === "https:" ? "https" : "http");
    const host =
      sanitizeHost(firstHeaderToken(headers.get("x-forwarded-host"))) ||
      sanitizeHost(headers.get("host")) ||
      rawUrl.host;
    targetOrigin = `${proto}://${host}`;
  }

  if (config.trustProxy) {
    if (
      !headers.get("cf-connecting-ip") &&
      !headers.get("x-forwarded-for") &&
      !headers.get("x-real-ip")
    ) {
      headers.set("x-real-ip", normalizedIp);
    }
  } else {
    headers.delete("cf-connecting-ip");
    headers.delete("x-forwarded-for");
    headers.delete("x-forwarded-proto");
    headers.delete("x-forwarded-scheme");
    headers.delete("x-forwarded-host");
    headers.delete("forwarded");
    headers.set("x-real-ip", normalizedIp);
  }

  const targetUrl = `${targetOrigin}${rawUrl.pathname}${rawUrl.search}`;
  const hasBody =
    request.method !== "GET" &&
    request.method !== "HEAD" &&
    request.body !== null;

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
  };

  if (hasBody) {
    init.body = request.body;
    init.duplex = "half";
  }

  return new Request(targetUrl, init);
}
