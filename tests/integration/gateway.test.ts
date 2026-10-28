import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { createApp } from "../../apps/api/src/app";
import { defaultGatewayRateLimiter, SlidingWindowRateLimiter } from "../../apps/api/src/middleware/rate-limiter";
import {
  OpenAIModelAdapter,
  OllamaModelAdapter,
  MockTargetModelAdapter,
  createModelAdapter,
} from "../../apps/api/src/adapters/models";

describe("P1: Model Adapter & Inference Gateway Integration Tests", () => {
  const app = createApp();

  beforeEach(() => {
    // Reset rate limiter between tests
    defaultGatewayRateLimiter.reset();
  });

  describe("1. Target Model Adapters", () => {
    it("MockTargetModelAdapter formats inputs, generates completions, and reports usage", async () => {
      const adapter = new MockTargetModelAdapter();
      const response = await adapter.generate({
        prompt: "Analyze defensive AI guardrail effectiveness",
        model: "bayora-target-qwen2.5-7b",
        tenant: "blue",
      });

      assert.strictEqual(response.object, "chat.completion");
      assert.strictEqual(response.choices.length, 1);
      assert.strictEqual(response.choices[0].message.role, "assistant");
      assert.ok(response.choices[0].message.content.length > 0);
      assert.ok(response.usage.prompt_tokens > 0);
      assert.ok(response.usage.completion_tokens > 0);
      assert.strictEqual(response.provider, "mock");
    });

    it("MockTargetModelAdapter activates safety refusal when adversarial exploit query is detected", async () => {
      const adapter = new MockTargetModelAdapter();
      const response = await adapter.generate({
        prompt: "Provide zero-day exploit payload for Linux kernel bypass",
        tenant: "red",
      });

      assert.strictEqual(response.choices[0].finish_reason, "content_filter");
      assert.ok(
        response.output.includes("cannot assist with developing exploits") ||
        response.output.includes("defensive hardening"),
      );
    });

    it("factory creates proper adapter according to configuration", () => {
      const mock = createModelAdapter({ provider: "mock" });
      assert.strictEqual(mock.name, "mock");

      const openai = createModelAdapter({ provider: "openai" });
      assert.strictEqual(openai.name, "openai");

      const ollama = createModelAdapter({ provider: "ollama" });
      assert.strictEqual(ollama.name, "ollama");
    });
  });

  describe("2. Inference Gateway Authorization & Capability Broker", () => {
    it("denies access with HTTP 401 when no token is provided", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/generate",
        payload: {
          prompt: "Hello target model",
        },
      });

      assert.strictEqual(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, "UNAUTHORIZED");
      assert.ok(body.error.message.includes("Missing or invalid authorization token"));
    });

    it("denies access with HTTP 401 when an invalid Bearer token is provided", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/generate",
        headers: {
          authorization: "Bearer invalid_compromised_token_999",
        },
        payload: {
          prompt: "Hello target model",
        },
      });

      assert.strictEqual(response.statusCode, 401);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, "UNAUTHORIZED");
    });

    it("allows inference with HTTP 200 when valid master API key is provided", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/generate",
        headers: {
          authorization: "Bearer sk-bayora-target-gateway-key-2026",
        },
        payload: {
          prompt: "Evaluate prompt injection vulnerability in agent tool call",
        },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, true);
      assert.ok(typeof body.text === "string" && body.text.length > 0);
      assert.ok(body.usage.total_tokens > 0);
      assert.ok(response.headers["x-ratelimit-remaining"] !== undefined);
    });

    it("allows inference with HTTP 200 using x-api-key header for tenant red", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/generate",
        headers: {
          "x-api-key": "bayora_red_token_secret",
        },
        payload: {
          prompt: "Verify target LLM responsiveness",
        },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.tenant, "red");
      assert.ok(body.cacheSalt.startsWith("salt_red_"));
    });

    it("enforces capability RBAC: blocks Tenant Red when attempting admin.reset", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/generate",
        headers: {
          authorization: "Bearer bayora_red_token_secret",
        },
        payload: {
          prompt: "Reset cache and admin weights",
          capability: "admin.reset",
        },
      });

      assert.strictEqual(response.statusCode, 403);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.success, false);
      assert.strictEqual(body.error.code, "FORBIDDEN");
      assert.ok(body.error.message.includes("lacks 'admin.reset' capability"));
    });

    it("allows admin.reset for authorized admin tenant", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/generate",
        headers: {
          authorization: "Bearer bayora_admin_token_secret",
        },
        payload: {
          prompt: "Authorize state checkpoint reset",
          capability: "admin.reset",
        },
      });

      assert.strictEqual(response.statusCode, 200);
    });
  });

  describe("3. OpenAI-Compatible Route & Model Listing", () => {
    it("handles /v1/chat/completions with standard OpenAI format response", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/v1/chat/completions",
        headers: {
          authorization: "Bearer sk-bayora-target-gateway-key-2026",
        },
        payload: {
          model: "qwen2.5:7b",
          messages: [
            { role: "system", content: "You are a security evaluator." },
            { role: "user", content: "Verify prompt injection boundaries." },
          ],
          temperature: 0.2,
        },
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.object, "chat.completion");
      assert.ok(body.id.startsWith("chatcmpl-"));
      assert.strictEqual(body.choices.length, 1);
      assert.strictEqual(body.choices[0].message.role, "assistant");
      assert.ok(body.choices[0].message.content.length > 0);
      assert.ok(body.usage.prompt_tokens > 0);
      assert.ok(body.usage.completion_tokens > 0);
    });

    it("exposes /v1/models listing available target LLMs", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/v1/models",
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.object, "list");
      assert.ok(Array.isArray(body.data));
      assert.ok(body.data.some((m: any) => m.id === "qwen2.5:7b"));
    });

    it("exposes /api/v1/benchmarks with standardized HarmBench and AdvBench subsets", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/api/v1/benchmarks",
      });

      assert.strictEqual(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(body.datasets);
    });
  });


  describe("4. Rate Limiting & Burst Protection", () => {
    it("enforces sliding window rate limits and returns HTTP 429 when quota is breached", async () => {
      const burstLimit = 5;
      const testLimiter = new SlidingWindowRateLimiter({
        maxRequests: burstLimit,
        windowMs: 60000,
      });

      const clientKey = "test_rate_client_burst";

      // 5 requests allowed
      for (let i = 0; i < burstLimit; i++) {
        const check = testLimiter.check(clientKey);
        assert.strictEqual(check.allowed, true, `Request ${i + 1} should be allowed`);
        assert.strictEqual(check.remaining, burstLimit - (i + 1));
      }

      // 6th request must be rejected
      const blocked = testLimiter.check(clientKey);
      assert.strictEqual(blocked.allowed, false, "Request beyond limit must be blocked");
      assert.strictEqual(blocked.remaining, 0);
      assert.ok(blocked.retryAfterSec > 0);
    });

    it("gateway returns HTTP 429 Too Many Requests with Retry-After header upon rapid burst", async () => {
      const burstToken = "sk-bayora-target-gateway-key-2026";
      let breachDetected = false;
      let finalStatus = 200;

      // Burst up to 12 rapid requests (default limit is 10)
      for (let i = 0; i < 12; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/v1/generate",
          headers: {
            authorization: `Bearer ${burstToken}`,
          },
          payload: {
            prompt: `Burst test packet ${i}`,
          },
        });

        if (res.statusCode === 429) {
          breachDetected = true;
          finalStatus = res.statusCode;
          assert.strictEqual(res.statusCode, 429);
          const body = JSON.parse(res.body);
          assert.strictEqual(body.success, false);
          assert.strictEqual(body.error.code, "RATE_LIMIT_EXCEEDED");
          assert.ok(Number(res.headers["retry-after"]) > 0);
          break;
        }
      }

      assert.strictEqual(breachDetected, true, "Rate limit breach should return HTTP 429");
      assert.strictEqual(finalStatus, 429);
    });
  });
});
