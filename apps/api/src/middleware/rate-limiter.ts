import type { FastifyRequest, FastifyReply } from "fastify";

export interface RateLimitOptions {
  maxRequests: number;
  windowMs: number;
  keyGenerator?: (request: FastifyRequest) => string;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTimeMs: number;
  retryAfterSec: number;
}

export class SlidingWindowRateLimiter {
  private requests = new Map<string, number[]>();
  private maxRequests: number;
  private windowMs: number;
  private keyGenerator: (request: FastifyRequest) => string;

  constructor(options?: Partial<RateLimitOptions>) {
    this.maxRequests =
      options?.maxRequests ??
      Number(process.env.GATEWAY_RATE_LIMIT_MAX ?? 10);
    this.windowMs =
      options?.windowMs ??
      Number(process.env.GATEWAY_RATE_LIMIT_WINDOW_MS ?? 60000);

    this.keyGenerator =
      options?.keyGenerator ??
      ((req) => {
        // Prefer client token or API key, fallback to IP
        const auth =
          (req.headers["authorization"] as string) ||
          (req.headers["x-api-key"] as string) ||
          req.ip ||
          "127.0.0.1";
        return auth;
      });
  }

  check(clientId: string, now: number = Date.now()): RateLimitResult {
    let timestamps = this.requests.get(clientId) || [];

    // Filter out timestamps outside sliding window
    const windowStart = now - this.windowMs;
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      const oldestInWindow = timestamps[0];
      const resetTimeMs = oldestInWindow + this.windowMs;
      const retryAfterSec = Math.max(
        1,
        Math.ceil((resetTimeMs - now) / 1000),
      );

      this.requests.set(clientId, timestamps);

      return {
        allowed: false,
        limit: this.maxRequests,
        remaining: 0,
        resetTimeMs,
        retryAfterSec,
      };
    }

    // Record this request
    timestamps.push(now);
    this.requests.set(clientId, timestamps);

    const remaining = this.maxRequests - timestamps.length;
    const resetTimeMs = timestamps[0] + this.windowMs;

    return {
      allowed: true,
      limit: this.maxRequests,
      remaining,
      resetTimeMs,
      retryAfterSec: 0,
    };
  }

  middleware() {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const clientId = this.keyGenerator(request);
      const result = this.check(clientId);

      reply.header("X-RateLimit-Limit", String(result.limit));
      reply.header("X-RateLimit-Remaining", String(result.remaining));
      reply.header(
        "X-RateLimit-Reset",
        String(Math.ceil(result.resetTimeMs / 1000)),
      );

      if (!result.allowed) {
        reply.header("Retry-After", String(result.retryAfterSec));
        return reply.status(429).send({
          success: false,
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: `Too Many Requests: Rate limit exceeded. Limit is ${result.limit} requests per ${Math.round(this.windowMs / 1000)}s. Please retry in ${result.retryAfterSec} seconds.`,
            limit: result.limit,
            remaining: 0,
            retryAfter: result.retryAfterSec,
          },
        });
      }
    };
  }

  reset(clientId?: string) {
    if (clientId) {
      this.requests.delete(clientId);
    } else {
      this.requests.clear();
    }
  }

  getStats() {
    return {
      activeClients: this.requests.size,
      maxRequests: this.maxRequests,
      windowMs: this.windowMs,
    };
  }
}

export const defaultGatewayRateLimiter = new SlidingWindowRateLimiter();
