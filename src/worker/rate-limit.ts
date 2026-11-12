/**
 * In-Memory Sliding-Window Rate Limiter for Cloudflare Workers
 * Operates per isolate by client IP without incurring D1 write costs.
 */

import type { MiddlewareHandler, Context } from "hono";
import type { AppEnv } from "./types";

export interface RateLimitOptions {
  windowSeconds?: number;
  maxRequests?: number;
  limit?: number; // alias for maxRequests
  prefix?: string;
  keyPrefix?: string; // alias for prefix
  message?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset: number;       // epoch timestamp in seconds
  retryAfter: number;  // seconds until earliest request rolls off
}

export class MemoryRateLimiter {
  private store = new Map<string, number[]>();
  private operationCount = 0;

  public consume(
    key: string,
    limit: number,
    windowSeconds: number,
    now: number = Date.now()
  ): RateLimitResult {
    this.operationCount++;
    const windowMs = windowSeconds * 1000;

    if (this.operationCount % 100 === 0 || this.store.size > 2000) {
      this.pruneExpired(now, windowMs);
    }

    const cutoff = now - windowMs;
    const existing = this.store.get(key) || [];
    const valid = existing.filter((ts) => ts > cutoff);

    if (valid.length >= limit) {
      const oldest = valid[0];
      const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      const reset = Math.ceil((oldest + windowMs) / 1000);
      this.store.set(key, valid);
      return {
        allowed: false,
        remaining: 0,
        reset,
        retryAfter,
      };
    }

    valid.push(now);
    this.store.set(key, valid);
    const reset = Math.ceil((now + windowMs) / 1000);

    return {
      allowed: true,
      remaining: limit - valid.length,
      reset,
      retryAfter: 0,
    };
  }

  private pruneExpired(now: number, maxAgeMs: number): void {
    const cutoff = now - maxAgeMs;
    for (const [key, timestamps] of this.store.entries()) {
      if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
        this.store.delete(key);
      }
    }
  }

  public reset(): void {
    this.store.clear();
    this.operationCount = 0;
  }
}

// Module-level singleton rate limiter per worker isolate
export const globalRateLimiter = new MemoryRateLimiter();

export function resetRateLimits(): void {
  globalRateLimiter.reset();
}

/**
 * Extracts client IP with Cloudflare edge priority and local test fallbacks.
 */
export function getClientIp(c: Context): string {
  const cfIp = c.req.header("cf-connecting-ip");
  if (cfIp) return cfIp.trim();

  const xForwardedFor = c.req.header("x-forwarded-for");
  if (xForwardedFor) {
    const firstIp = xForwardedFor.split(",")[0].trim();
    if (firstIp) return firstIp;
  }

  const realIp = c.req.header("x-real-ip");
  if (realIp) return realIp.trim();

  return "127.0.0.1";
}

/**
 * Hono middleware creating sliding-window rate limit protection.
 */
export function rateLimit(options: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const windowSeconds = options.windowSeconds ?? 60;
  const maxRequests = options.maxRequests ?? options.limit ?? 10;
  const keyPrefix = options.keyPrefix ?? options.prefix ?? "rl";
  const message =
    options.message ??
    `Rate limit exceeded. Please try again later.`;

  return async (c, next) => {
    const ip = getClientIp(c);
    const key = `${keyPrefix}:${ip}`;
    const result = globalRateLimiter.consume(key, maxRequests, windowSeconds);

    c.header("X-RateLimit-Limit", maxRequests.toString());
    c.header("X-RateLimit-Remaining", result.remaining.toString());
    c.header("X-RateLimit-Reset", result.reset.toString());

    if (!result.allowed) {
      c.header("Retry-After", result.retryAfter.toString());
      return c.json(
        {
          error: "Too Many Requests",
          message,
          retryAfter: result.retryAfter,
        },
        429
      );
    }

    await next();
  };
}

export const rateLimiter = rateLimit;
