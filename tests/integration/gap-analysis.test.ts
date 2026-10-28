import { describe, it, beforeEach } from "node:test";
import assert from "node:assert";
import { createApp } from "../../apps/api/src/app";
import { defaultGatewayRateLimiter } from "../../apps/api/src/middleware/rate-limiter";

describe("Gap Analysis & Section 8 API Contract Verification", () => {
  const app = createApp();
  const adminHeaders = {
    authorization: "Bearer bayora_admin_token_secret",
  };

  beforeEach(() => {
    defaultGatewayRateLimiter.reset();
  });

  describe("1. Dynamic Token Issuance & Expiry Verification", () => {
    it("issues dynamic scoped token with correct expiry timestamp", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/tokens",
        headers: adminHeaders,
        payload: {
          tenant: "red",
          evaluationId: "eval_test_token_001",
          capabilities: ["model.inference"],
          expiresInSeconds: 3600,
        },
      });

      assert.strictEqual(response.statusCode, 201);
      const body = JSON.parse(response.body);
      assert.strictEqual(body.tenant, "red");
      assert.strictEqual(body.evaluationId, "eval_test_token_001");
      assert.ok(body.token.startsWith("byt_red_"));
      assert.ok(body.expiresAt !== "never");
    });

    it("rejects request with 401 when token is expired", async () => {
      // 1. Issue token with 0 seconds expiration
      const issueRes = await app.inject({
        method: "POST",
        url: "/api/v1/tokens",
        headers: adminHeaders,
        payload: {
          tenant: "blue",
          evaluationId: "eval_expired_test",
          capabilities: ["model.inference"],
          expiresInSeconds: 0,
        },
      });

      assert.strictEqual(issueRes.statusCode, 201);
      const issued = JSON.parse(issueRes.body);
      const token = issued.token;

      // Small delay to ensure expiration timestamp is in the past
      await new Promise((r) => setTimeout(r, 20));

      // 2. Attempt to use expired token
      const genRes = await app.inject({
        method: "POST",
        url: "/api/v1/generate",
        headers: {
          authorization: `Bearer ${token}`,
        },
        payload: {
          prompt: "Verify refusal on expired token",
        },
      });

      assert.strictEqual(genRes.statusCode, 401);
      const genBody = JSON.parse(genRes.body);
      assert.strictEqual(genBody.success, false);
      assert.strictEqual(genBody.error.code, "TOKEN_EXPIRED");
    });
  });

  describe("2. Real Probe Runner Execution", () => {
    it("runs 8 real host/container security probes and returns results", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/security/probes/run",
        headers: adminHeaders,
      });

      assert.strictEqual(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.strictEqual(body.success, true);
      assert.ok(Array.isArray(body.probes));
      assert.strictEqual(body.probes.length, 8);

      // Verify probe structure
      for (const probe of body.probes) {
        assert.ok(probe.id);
        assert.ok(probe.name);
        assert.strictEqual(typeof probe.blocked, "boolean");
        assert.strictEqual(typeof probe.exitCode, "number");
        assert.ok(typeof probe.output === "string");
      }
    });
  });

  describe("3. SQLite Evaluation Lifecycle & Capsule", () => {
    let evalId = "";

    it("creates an evaluation record in SQLite", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/evaluations",
        headers: adminHeaders,
        payload: {
          dataset: "HarmBench",
          modelId: "qwen2.5:3b",
          seed: 42,
        },
      });

      assert.strictEqual(res.statusCode, 201);
      const evalObj = JSON.parse(res.body);
      assert.ok(evalObj.id.startsWith("eval_"));
      assert.strictEqual(evalObj.status, "created");
      assert.ok(evalObj.datasetVersions.includes("HarmBench"));
      evalId = evalObj.id;
    });

    it("executes the evaluation with before/after defense metrics and sample size n", async () => {
      assert.ok(evalId);
      const res = await app.inject({
        method: "POST",
        url: `/api/v1/evaluations/${evalId}/run`,
        headers: adminHeaders,
      });

      assert.strictEqual(res.statusCode, 200);
      const completed = JSON.parse(res.body);
      assert.strictEqual(completed.status, "completed");
      assert.ok(completed.sampleCount > 0);
      assert.ok(typeof completed.redSuccessBefore === "number");
      assert.ok(typeof completed.redSuccessAfter === "number");
      assert.ok(completed.redSuccessBefore >= completed.redSuccessAfter);
    });

    it("exports a tamper-evident evaluation capsule with sha256 checksum", async () => {
      assert.ok(evalId);
      const res = await app.inject({
        method: "GET",
        url: `/api/v1/evaluations/${evalId}/capsule`,
        headers: adminHeaders,
      });

      assert.strictEqual(res.statusCode, 200);
      const capsule = JSON.parse(res.body);
      assert.strictEqual(capsule.evaluationId, evalId);
      assert.ok(capsule.checksum.sha256);
      assert.ok(capsule.audit.totalEvents >= 1);
    });

    it("supports killing an active or pending evaluation", async () => {
      // Create new evaluation to test kill
      const createRes = await app.inject({
        method: "POST",
        url: "/api/v1/evaluations",
        headers: adminHeaders,
        payload: {
          dataset: "AdvBench-GCG",
          modelId: "qwen2.5:3b",
          seed: 101,
        },
      });
      const toKill = JSON.parse(createRes.body).id;

      const killRes = await app.inject({
        method: "POST",
        url: `/api/v1/evaluations/${toKill}/kill`,
        headers: adminHeaders,
      });

      assert.strictEqual(killRes.statusCode, 200);
      const killed = JSON.parse(killRes.body);
      assert.strictEqual(killed.status, "killed");
    });
  });

  describe("4. Cryptographic Forensic Audit Chain & Tamper Demo", () => {
    it("verifies unbroken cryptographic chain with valid signatures", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/v1/audit/verify",
        headers: adminHeaders,
      });

      assert.strictEqual(res.statusCode, 200);
      const vBody = JSON.parse(res.body);
      assert.strictEqual(vBody.valid, true);
      assert.strictEqual(vBody.brokenAt, null);
      assert.ok(vBody.count >= 1);
    });

    it("detects single-character tamper demo immediately without modifying live chain", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/audit/tamper-demo",
        headers: adminHeaders,
      });

      assert.strictEqual(res.statusCode, 200);
      const tBody = JSON.parse(res.body);
      assert.strictEqual(tBody.originalValid, true);
      assert.strictEqual(typeof tBody.copyBrokenAt, "number");
      assert.strictEqual(typeof tBody.tamperedBlockIndex, "number");
      assert.ok(tBody.tamperedPayload.includes("ALLOWED_FORGED"));
    });
  });

  describe("5. Side-Channel Benchmark Endpoint", () => {
    it("returns side-channel measurements explicitly marked as simulated", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/security/side-channel/run",
        headers: adminHeaders,
        payload: {
          mode: "cache_salted",
        },
      });

      assert.strictEqual(res.statusCode, 200);
      const sBody = JSON.parse(res.body);
      assert.strictEqual(sBody.isSimulated, true);
      assert.strictEqual(sBody.sampleSize, 50);
      assert.ok(Array.isArray(sBody.samples));
      assert.ok(typeof sBody.auc === "number");
      assert.ok(typeof sBody.deltaTTFT === "number");
    });
  });
});
