import type { FastifyRequest, FastifyReply } from "fastify";

export interface GatewayClient {
  id: string;
  tenant: "red" | "blue" | "admin" | "standard";
  capabilities: string[];
  token: string;
}

declare module "fastify" {
  interface FastifyRequest {
    gatewayClient?: GatewayClient;
  }
}

const DEFAULT_KNOWN_TOKENS: Record<
  string,
  { tenant: GatewayClient["tenant"]; capabilities: string[] }
> = {
  // Master API Key
  "sk-bayora-target-gateway-key-2026": {
    tenant: "admin",
    capabilities: ["model.inference", "model.tokenize", "admin.reset"],
  },
  // Red Team tenant token
  "bayora_red_token_secret": {
    tenant: "red",
    capabilities: ["model.inference", "model.tokenize"],
  },
  // Blue Team tenant token
  "bayora_blue_token_secret": {
    tenant: "blue",
    capabilities: ["model.inference", "model.tokenize"],
  },
  // Admin token
  "bayora_admin_token_secret": {
    tenant: "admin",
    capabilities: ["model.inference", "model.tokenize", "admin.reset"],
  },
};

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

export function verifyGatewayToken(token: string | null): GatewayClient | null {
  if (!token) return null;

  // Check known hardcoded/preconfigured tenant tokens
  if (DEFAULT_KNOWN_TOKENS[token]) {
    const info = DEFAULT_KNOWN_TOKENS[token];
    return {
      id: `client-${info.tenant}-${token.slice(0, 8)}`,
      tenant: info.tenant,
      capabilities: info.capabilities,
      token,
    };
  }

  // Check env variable GATEWAY_API_KEY
  const envKey = process.env.GATEWAY_API_KEY;
  if (envKey && token === envKey) {
    return {
      id: "client-env-admin",
      tenant: "admin",
      capabilities: ["model.inference", "model.tokenize", "admin.reset"],
      token,
    };
  }

  // Check env variable GATEWAY_ALLOWED_KEYS (comma separated)
  const allowedKeys = (process.env.GATEWAY_ALLOWED_KEYS || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (allowedKeys.includes(token)) {
    return {
      id: `client-key-${token.slice(0, 8)}`,
      tenant: "standard",
      capabilities: ["model.inference", "model.tokenize"],
      token,
    };
  }

  return null;
}

export async function gatewayAuthMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = extractToken(request);
  const client = verifyGatewayToken(token);

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

  // Check requested capability if specified in body
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
