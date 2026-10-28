import type { FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";

export interface GatewayClient {
  id: string;
  tenant: "red" | "blue" | "admin" | "standard";
  evaluationId: string;
  capabilities: string[];
  token: string;
  expiresAt: number | null;
  cacheSalt: string;
}

declare module "fastify" {
  interface FastifyRequest {
    gatewayClient?: GatewayClient;
    correlationId?: string;
  }
}

const HMAC_SALT_SECRET = process.env.GATEWAY_SALT_SECRET || "bayora-secret-salt-key-2026";

// In-memory or persisted dynamic token registry issued by POST /api/v1/tokens
export const dynamicTokens = new Map<
  string,
  {
    tenant: GatewayClient["tenant"];
    evaluationId: string;
    capabilities: string[];
    expiresAt: number | null;
  }
>();

// Preconfigured static fallback tokens
const STATIC_KNOWN_TOKENS: Record<
  string,
  {
    tenant: GatewayClient["tenant"];
    evaluationId: string;
    capabilities: string[];
    expiresAt: number | null;
  }
> = {
  "sk-bayora-target-gateway-key-2026": {
    tenant: "admin",
    evaluationId: "eval_global_admin",
    capabilities: ["model.inference", "model.tokenize", "admin.reset", "eval.run"],
    expiresAt: null,
  },
  "bayora_red_token_secret": {
    tenant: "red",
    evaluationId: "eval_red_active",
    capabilities: ["model.inference", "model.tokenize"],
    expiresAt: null,
  },
  "bayora_blue_token_secret": {
    tenant: "blue",
    evaluationId: "eval_blue_active",
    capabilities: ["model.inference", "model.tokenize", "defense.configure"],
    expiresAt: null,
  },
  "bayora_admin_token_secret": {
    tenant: "admin",
    evaluationId: "eval_admin_active",
    capabilities: ["model.inference", "model.tokenize", "admin.reset", "eval.run"],
    expiresAt: null,
  },
};

export function computeStableCacheSalt(tenant: string, evaluationId: string): string {
  const hmac = crypto.createHmac("sha256", HMAC_SALT_SECRET);
  hmac.update(`${tenant}:${evaluationId}`);
  const hash = hmac.digest("hex").slice(0, 16);
  return `salt_${tenant}_${hash}`;
}

export function issueCapabilityToken(params: {
  tenant: GatewayClient["tenant"];
  evaluationId: string;
  capabilities: string[];
  expiresInSeconds?: number;
}): { token: string; tenant: string; evaluationId: string; capabilities: string[]; expiresAt: string } {
  const token = `byt_${params.tenant}_${crypto.randomBytes(16).toString("hex")}`;
  const now = Date.now();
  const expiresAtMs =
    params.expiresInSeconds !== undefined
      ? params.expiresInSeconds === 0
        ? now - 1000
        : now + params.expiresInSeconds * 1000
      : null;

  dynamicTokens.set(token, {
    tenant: params.tenant,
    evaluationId: params.evaluationId,
    capabilities: params.capabilities,
    expiresAt: expiresAtMs,
  });

  return {
    token,
    tenant: params.tenant,
    evaluationId: params.evaluationId,
    capabilities: params.capabilities,
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : "never",
  };
}

export function revokeTokensForEvaluation(evaluationId: string) {
  for (const [token, data] of dynamicTokens.entries()) {
    if (data.evaluationId === evaluationId) {
      dynamicTokens.delete(token);
    }
  }
}

export function extractToken(request: FastifyRequest): string | null {
  const authHeader = request.headers["authorization"];
  if (authHeader && typeof authHeader === "string") {
    if (authHeader.startsWith("Bearer ")) {
      return authHeader.slice(7).trim();
    }
    return authHeader.trim();
  }

  const apiKeyHeader = request.headers["x-api-key"];
  if (apiKeyHeader && typeof apiKeyHeader === "string") {
    return apiKeyHeader.trim();
  }

  return null;
}

export function verifyGatewayToken(token: string | null): {
  client: GatewayClient | null;
  expired?: boolean;
} {
  if (!token) return { client: null };

  const now = Date.now();

  // Check dynamically issued tokens
  if (dynamicTokens.has(token)) {
    const info = dynamicTokens.get(token)!;
    if (info.expiresAt && now > info.expiresAt) {
      return { client: null, expired: true };
    }
    const cacheSalt = computeStableCacheSalt(info.tenant, info.evaluationId);
    return {
      client: {
        id: `client-${info.tenant}-${token.slice(0, 8)}`,
        tenant: info.tenant,
        evaluationId: info.evaluationId,
        capabilities: info.capabilities,
        token,
        expiresAt: info.expiresAt,
        cacheSalt,
      },
    };
  }

  // Check static known tokens
  if (STATIC_KNOWN_TOKENS[token]) {
    const info = STATIC_KNOWN_TOKENS[token];
    if (info.expiresAt && now > info.expiresAt) {
      return { client: null, expired: true };
    }
    const cacheSalt = computeStableCacheSalt(info.tenant, info.evaluationId);
    return {
      client: {
        id: `client-${info.tenant}-${token.slice(0, 8)}`,
        tenant: info.tenant,
        evaluationId: info.evaluationId,
        capabilities: info.capabilities,
        token,
        expiresAt: info.expiresAt,
        cacheSalt,
      },
    };
  }

  // Check env variable GATEWAY_API_KEY
  const envKey = process.env.GATEWAY_API_KEY;
  if (envKey && token === envKey) {
    return {
      client: {
        id: "client-env-admin",
        tenant: "admin",
        evaluationId: "eval_global_admin",
        capabilities: ["model.inference", "model.tokenize", "admin.reset", "eval.run"],
        token,
        expiresAt: null,
        cacheSalt: computeStableCacheSalt("admin", "eval_global_admin"),
      },
    };
  }

  return { client: null };
}

export async function gatewayAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  request.correlationId = `corr_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

  const token = extractToken(request);
  const { client, expired } = verifyGatewayToken(token);

  if (expired) {
    return reply.status(401).send({
      success: false,
      error: {
        code: "TOKEN_EXPIRED",
        message: "Authorization token has expired. Request rejected by Gateway.",
      },
    });
  }

  if (!client) {
    return reply.status(401).send({
      success: false,
      error: {
        code: "UNAUTHORIZED",
        message:
          "Missing or invalid authorization token. Access denied. Please provide a valid Bearer token or x-api-key header.",
      },
    });
  }

  // Capability check
  const body = request.body as any;
  const requestedCapability = body?.capability;

  if (requestedCapability) {
    if (!client.capabilities.includes(requestedCapability)) {
      return reply.status(403).send({
        success: false,
        error: {
          code: "FORBIDDEN",
          message: `Policy Violation: Tenant '${client.tenant}' lacks '${requestedCapability}' capability. Blocked by Gateway RBAC.`,
        },
      });
    }
  }

  request.gatewayClient = client;
}
