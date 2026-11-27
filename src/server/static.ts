import fs from "node:fs";
import path from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

const ASSET_EXTENSIONS = new Set(Object.keys(MIME_TYPES).filter((ext) => ext !== ".html"));

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function getCacheControl(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.startsWith("assets/")) {
    return "public, max-age=31536000, immutable";
  }
  if (normalized.endsWith(".html")) {
    return "no-cache";
  }
  return "public, max-age=3600";
}

function serveFileResponse(
  filePath: string,
  relativePath: string,
  method: string
): Response {
  const data = fs.readFileSync(filePath);
  const headers = new Headers({
    "Content-Type": getContentType(filePath),
    "Content-Length": String(data.byteLength),
    "Cache-Control": getCacheControl(relativePath),
  });

  if (method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(data, { status: 200, headers });
}

/**
 * Serves built frontend assets from `staticDir` with Cloudflare-compatible
 * `single-page-application` fallback for client-side routes.
 */
export function createStaticAssetsFetcher(staticDir: string): Fetcher {
  const rootDir = path.resolve(staticDir);
  const indexHtmlPath = path.join(rootDir, "index.html");

  return {
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const request = input instanceof Request ? input : new Request(input, init);
      const method = request.method.toUpperCase();
      if (method !== "GET" && method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405 });
      }

      const url = new URL(request.url);
      let decodedPath: string;
      try {
        decodedPath = decodeURIComponent(url.pathname);
      } catch {
        return new Response("Bad Request", { status: 400 });
      }

      const cleanRelPath = decodedPath.replace(/^\/+/, "");
      const candidatePath = path.resolve(rootDir, cleanRelPath || "index.html");

      // Prevent path traversal outside static root
      if (candidatePath !== rootDir && !candidatePath.startsWith(rootDir + path.sep)) {
        return new Response("Forbidden", { status: 403 });
      }

      if (cleanRelPath && isFile(candidatePath)) {
        return serveFileResponse(candidatePath, cleanRelPath, method);
      }

      // Missing hashed asset or static resource should return 404 rather than HTML
      const ext = path.extname(cleanRelPath).toLowerCase();
      if (cleanRelPath.startsWith("assets/") || ASSET_EXTENSIONS.has(ext)) {
        return new Response("Not Found", { status: 404 });
      }

      if (isFile(indexHtmlPath)) {
        return serveFileResponse(indexHtmlPath, "index.html", method);
      }

      return new Response("Frontend assets not found. Run 'npm run build:client'.", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    },
  } as Fetcher;
}
