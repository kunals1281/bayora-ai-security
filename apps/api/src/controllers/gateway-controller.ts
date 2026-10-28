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
  issueCapabilityToken,
  type GatewayClient,
} from "../middleware/gateway-auth";
import {
  generateRequestSchema,
  chatCompletionRequestSchema,
  issueTokenSchema,
  createEvaluationSchema,
} from "../schemas/gateway";
import { isolationProbeService } from "../services/security/isolation-service";
import { auditChainService } from "../services/audit/audit-chain.service";
import { evaluationRunnerService } from "../services/evaluation/evaluation-runner.service";
import { sideChannelService } from "../services/security/side-channel-service";
import { db } from "../services/db/database";

export async function gatewayController(app: FastifyInstance) {
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
        provider: result.provider,
        isMock: result.isMock,
        cacheSalt: result.cacheSalt,
        tenant: request.gatewayClient?.tenant,
        correlationId: request.correlationId,
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
      provider: result.provider,
      isMock: result.isMock,
      tenant: request.gatewayClient?.tenant,
      cacheSalt: result.cacheSalt,
      correlationId: request.correlationId,
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
   * 4. Standardized Adversarial Safety Benchmarks (HarmBench / AdvBench / Gandalf)
   * GET /api/v1/benchmarks
   */
  app.get("/api/v1/benchmarks", async () => {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const benchmarkPath = path.resolve(
        process.cwd(),
        "data/benchmarks/adversarial-benchmarks.json",
      );
      if (fs.existsSync(benchmarkPath)) {
        return JSON.parse(fs.readFileSync(benchmarkPath, "utf-8"));
      }
    } catch {}
    return {
      version: "1.0.0",
      datasets: ["HarmBench", "AdvBench-GCG", "Gandalf-Lakera", "JailbreakBench"],
    };
  });

  /*
   * 5. Capability Token Issuance
   * POST /api/v1/tokens
   */
  app.post(
    "/api/v1/tokens",
    {
      preHandler: [gatewayAuthMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Only admin can issue capability tokens
      if (request.gatewayClient?.tenant !== "admin") {
        return reply.status(403).send({
          error: { code: "FORBIDDEN", message: "Only admin can issue capability tokens" },
        });
      }

      const input = issueTokenSchema.parse(request.body);
      const tokenResult = issueCapabilityToken(input);
      return reply.status(201).send(tokenResult);
    },
  );

  /*
   * 6. Evaluations Lifecycle (Section 8)
   * POST /api/v1/evaluations
   * GET /api/v1/evaluations
   * GET /api/v1/evaluations/:id
   * POST /api/v1/evaluations/:id/run
   * POST /api/v1/evaluations/:id/kill
   * GET /api/v1/evaluations/:id/capsule
   */
  app.post(
    "/api/v1/evaluations",
    {
      preHandler: [gatewayAuthMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const input = createEvaluationSchema.parse(request.body || {});
      const evaluation = evaluationRunnerService.createEvaluation(input);
      return reply.status(201).send(evaluation);
    },
  );

  app.get("/api/v1/evaluations", async () => {
    return evaluationRunnerService.listEvaluations();
  });

  app.get(
    "/api/v1/evaluations/:id",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const evaluation = evaluationRunnerService.getEvaluation(request.params.id);
      if (!evaluation) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Evaluation ${request.params.id} not found` },
        });
      }
      return reply.send(evaluation);
    },
  );

  app.post(
    "/api/v1/evaluations/:id/run",
    {
      preHandler: [gatewayAuthMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      try {
        const result = await evaluationRunnerService.runEvaluation(id);
        return reply.send(result);
      } catch (err: any) {
        return reply.status(400).send({
          error: { code: "EVALUATION_FAILED", message: err.message },
        });
      }
    },
  );

  app.post(
    "/api/v1/evaluations/:id/kill",
    {
      preHandler: [gatewayAuthMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const killed = evaluationRunnerService.killEvaluation(id);
      if (!killed) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Evaluation ${id} not found` },
        });
      }
      return reply.send(killed);
    },
  );

  app.get(
    "/api/v1/evaluations/:id/capsule",
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const capsule = evaluationRunnerService.getCapsule(request.params.id);
      if (!capsule) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Evaluation ${request.params.id} not found` },
        });
      }
      return reply.send(capsule);
    },
  );

  /*
   * 7. Isolation Probes (Section 8)
   * POST /api/v1/security/probes/run
   * GET /api/v1/security/probes
   */
  app.post(
    "/api/v1/security/probes/run",
    {
      preHandler: [gatewayAuthMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const results = await isolationProbeService.executeAllProbes();
      return reply.send({
        success: true,
        count: results.length,
        probes: results,
      });
    },
  );

  app.get("/api/v1/security/probes", async () => {
    return isolationProbeService.getLatestResults();
  });

  /*
   * 8. Cryptographic Audit Chain & Tamper Demo (Section 8)
   * GET /api/v1/audit
   * GET /api/v1/audit/verify
   * POST /api/v1/audit/tamper-demo
   */
  app.get(
    "/api/v1/audit",
    {
      preHandler: [gatewayAuthMiddleware],
    },
    async () => {
      return auditChainService.getEvents();
    },
  );

  app.get(
    "/api/v1/audit/verify",
    {
      preHandler: [gatewayAuthMiddleware],
    },
    async () => {
      return auditChainService.verifyChain();
    },
  );

  app.post(
    "/api/v1/audit/tamper-demo",
    {
      preHandler: [gatewayAuthMiddleware],
    },
    async () => {
      return auditChainService.tamperDemo();
    },
  );

  /*
   * 9. Side-Channel Timing Experiment
   * POST /api/v1/security/side-channel/run
   */
  app.post(
    "/api/v1/security/side-channel/run",
    {
      preHandler: [gatewayAuthMiddleware],
    },
    async (request: FastifyRequest) => {
      const body = request.body as any;
      const mode = body?.mode || "cache_salted";
      return sideChannelService.runTimingExperiment(mode);
    },
  );

  /*
   * 10. Tenant-Filtered Telemetry (Section 8)
   * GET /api/v1/telemetry
   */
  app.get(
    "/api/v1/telemetry",
    {
      preHandler: [gatewayAuthMiddleware],
    },
    async (request: FastifyRequest) => {
      const client = request.gatewayClient!;
      const allEvents = auditChainService.getEvents();

      // Tenant sees ONLY their own events (Admin sees all)
      if (client.tenant === "admin") {
        return allEvents;
      }

      return allEvents.filter((e) => {
        try {
          const payload = JSON.parse(e.payload);
          return payload.tenant === client.tenant;
        } catch {
          return false;
        }
      });
    },
  );

  /*
   * 11. Gateway Observability & Telemetry Stats
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
   * 12. Testing & Reset Endpoint
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
