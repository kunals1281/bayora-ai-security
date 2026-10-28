import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import {
  inferenceGatewayService,
} from "../services/gateway/inference-gateway.service";
import {
  defaultGatewayRateLimiter,
} from "../middleware/rate-limiter";
import {
  gatewayAuthMiddleware,
} from "../middleware/gateway-auth";
import {
  generateRequestSchema,
  chatCompletionRequestSchema,
} from "../schemas/gateway";

export async function gatewayController(app: FastifyInstance) {
  // Pre-handlers array for protected inference routes:
  // 1. Rate limiter checks quota (sliding window) -> 429 if breached
  // 2. Auth middleware verifies Bearer token / API key -> 401 if missing/invalid
  const inferenceGuards = [
    defaultGatewayRateLimiter.middleware(),
    gatewayAuthMiddleware,
  ];

  /*
   * 1. Standard Prompt Generation Endpoint
   * POST /api/v1/generate
   */
  app.post(
    "/api/v1/generate",
    {
      preHandler: inferenceGuards,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const input = generateRequestSchema.parse(request.body);
      const result = await inferenceGatewayService.generate(
        input,
        request.gatewayClient,
      );

      return reply.status(200).send({
        success: true,
        text: result.output,
        model: result.model,
        usage: result.usage,
        durationMs: result.durationMs,
        cacheSalt: result.cacheSalt,
        tenant: request.gatewayClient?.tenant,
      });
    },
  );

  /*
   * 2. OpenAI-Compatible Chat Completions Endpoint
   * POST /v1/chat/completions (and alias POST /api/v1/chat/completions)
   */
  const handleChatCompletions = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    const input = chatCompletionRequestSchema.parse(request.body);
    const result = await inferenceGatewayService.chatCompletions(
      input,
      request.gatewayClient,
    );

    return reply.status(200).send({
      id: result.id,
      object: "chat.completion",
      created: result.created,
      model: result.model,
      choices: result.choices,
      usage: result.usage,
      tenant: request.gatewayClient?.tenant,
      cacheSalt: result.cacheSalt,
    });
  };

  app.post(
    "/v1/chat/completions",
    {
      preHandler: inferenceGuards,
    },
    handleChatCompletions,
  );

  app.post(
    "/api/v1/chat/completions",
    {
      preHandler: inferenceGuards,
    },
    handleChatCompletions,
  );

  /*
   * 3. Model Listing Endpoints (OpenAI-Compatible)
   * GET /v1/models and GET /api/v1/models
   */
  const handleModels = async () => {
    return {
      object: "list",
      data: inferenceGatewayService.getAvailableModels(),
    };
  };

  app.get("/v1/models", handleModels);
  app.get("/api/v1/models", handleModels);

  /*
   * 3.5 Standardized Adversarial Safety Benchmarks (HarmBench / AdvBench / Gandalf)
   * GET /api/v1/benchmarks
   */
  app.get("/api/v1/benchmarks", async () => {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const benchmarkPath = path.resolve(
        process.cwd(),
        "../../data/benchmarks/adversarial-benchmarks.json",
      );
      if (fs.existsSync(benchmarkPath)) {
        return JSON.parse(fs.readFileSync(benchmarkPath, "utf-8"));
      }
      const altPath = path.resolve(
        process.cwd(),
        "data/benchmarks/adversarial-benchmarks.json",
      );
      if (fs.existsSync(altPath)) {
        return JSON.parse(fs.readFileSync(altPath, "utf-8"));
      }
    } catch {}
    return {
      version: "1.0.0",
      datasets: ["HarmBench", "AdvBench-GCG", "Gandalf-Lakera", "JailbreakBench"],
    };
  });


  /*
   * 4. Gateway Observability & Telemetry Stats
   * GET /api/v1/gateway/stats
   */
  app.get(
    "/api/v1/gateway/stats",
    {
      preHandler: [gatewayAuthMiddleware],
    },
    async () => {
      return {
        ...inferenceGatewayService.getStats(),
        rateLimiter: defaultGatewayRateLimiter.getStats(),
      };
    },
  );

  /*
   * 5. Testing & Reset Endpoint
   * POST & GET /api/v1/gateway/reset-limits
   */
  const handleResetLimits = async () => {
    defaultGatewayRateLimiter.reset();
    return {
      success: true,
      message: "Rate limits have been successfully reset.",
    };
  };

  app.post(
    "/api/v1/gateway/reset-limits",
    {
      preHandler: [gatewayAuthMiddleware],
    },
    handleResetLimits,
  );

  app.get(
    "/api/v1/gateway/reset-limits",
    {
      preHandler: [gatewayAuthMiddleware],
    },
    handleResetLimits,
  );

}
