#!/usr/bin/env node

/**
 * Bayora Inference Gateway - P1 Verification Script (Node.js)
 * Demonstrates:
 *   a) Successful generation with a valid token (200 OK + model response)
 *   b) Authorization failure with an invalid or missing token (401 Unauthorized)
 *   c) Rate limit breach by firing rapid burst requests (429 Too Many Requests)
 *   d) OpenAI-compatible chat completions (/v1/chat/completions)
 *   e) Capability RBAC boundary probe (Tenant Red attempting admin.reset -> 403)
 */

const BASE_URL = process.env.GATEWAY_URL || "http://localhost:4000";
const VALID_TOKEN = "sk-bayora-target-gateway-key-2026";
const INVALID_TOKEN = "invalid_compromised_token_999";

const colors = {
  green: "\x1b[92m",
  red: "\x1b[91m",
  yellow: "\x1b[93m",
  cyan: "\x1b[96m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

function header(title) {
  console.log(`\n${colors.bold}${colors.cyan}${"=".repeat(70)}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan} ${title}${colors.reset}`);
  console.log(`${colors.bold}${colors.cyan}${"=".repeat(70)}${colors.reset}`);
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = { "Content-Type": "application/json", ...options.headers };

  if (options.token) {
    headers["Authorization"] = `Bearer ${options.token}`;
  }

  const res = await fetch(url, {
    method: options.method || "POST",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  return {
    status: res.status,
    body: json,
    headers: Object.fromEntries(res.headers.entries()),
  };
}

async function run() {
  console.log(`${colors.bold}${colors.green}Starting Bayora P1 Gateway Verification Suite${colors.reset}`);
  console.log(`Target Server: ${BASE_URL}\n`);

  // Health check
  try {
    const health = await request("/health", { method: "GET" });
    if (health.status !== 200) {
      throw new Error(`Server returned HTTP ${health.status}`);
    }
    console.log(`${colors.green}[OK] Server is reachable. Health: ${JSON.stringify(health.body)}${colors.reset}`);
  } catch (err) {
    console.error(`${colors.red}[ERROR] Cannot connect to API server at ${BASE_URL}. Ensure it is running.${colors.reset}`);
    process.exit(1);
  }

  // Reset rate limits for clean test
  await request("/api/v1/gateway/reset-limits", { token: VALID_TOKEN, body: {} });

  // 1. Authorization Failure
  header("DEMO A: Authorization Failure with Invalid Token (401 Unauthorized)");
  console.log(`[*] Sending request with NO token to /api/v1/generate...`);
  const noToken = await request("/api/v1/generate", {
    body: { prompt: "Test prompt" },
  });
  console.log(`    -> HTTP Status: ${noToken.status}`);
  console.log(`    -> Response: ${JSON.stringify(noToken.body, null, 2)}`);
  if (noToken.status !== 401) throw new Error(`Expected 401, got ${noToken.status}`);
  console.log(`    ${colors.green}✔ Verified: Missing token blocked with 401 Unauthorized${colors.reset}`);

  console.log(`\n[*] Sending request with INVALID token '${INVALID_TOKEN}'...`);
  const invalidToken = await request("/api/v1/generate", {
    token: INVALID_TOKEN,
    body: { prompt: "Test prompt" },
  });
  console.log(`    -> HTTP Status: ${invalidToken.status}`);
  console.log(`    -> Response: ${JSON.stringify(invalidToken.body, null, 2)}`);
  if (invalidToken.status !== 401) throw new Error(`Expected 401, got ${invalidToken.status}`);
  console.log(`    ${colors.green}✔ Verified: Invalid token blocked with 401 Unauthorized${colors.reset}`);

  // 2. Successful Generation
  header("DEMO B: Successful Generation with Valid Token (200 OK + Model Response)");
  const prompt = "Evaluate adversarial prompt injection boundary controls";
  console.log(`[*] Prompt: "${prompt}"`);
  console.log(`[*] Token: Bearer ${VALID_TOKEN}`);
  const validRes = await request("/api/v1/generate", {
    token: VALID_TOKEN,
    body: { prompt, model: "qwen2.5:7b", tenant: "blue" },
  });
  console.log(`    -> HTTP Status: ${validRes.status}`);
  console.log(`    -> Target Model: ${validRes.body.model}`);
  console.log(`    -> Tenant Cache Salt: ${validRes.body.cacheSalt}`);
  console.log(`    -> Output: "${validRes.body.text}"`);
  console.log(`    -> Token Usage: ${JSON.stringify(validRes.body.usage)}`);
  console.log(`    -> Latency: ${validRes.body.durationMs}ms`);
  console.log(`    -> Quota Remaining: ${validRes.headers["x-ratelimit-remaining"]}/${validRes.headers["x-ratelimit-limit"]}`);
  if (validRes.status !== 200 || !validRes.body.success) {
    throw new Error(`Expected 200 OK, got ${validRes.status}`);
  }
  console.log(`    ${colors.green}✔ Verified: Generation succeeded with 200 OK + model response${colors.reset}`);

  // 3. OpenAI Chat Completions Route
  header("DEMO C: OpenAI-Compatible Chat Completions (/v1/chat/completions)");
  const chatRes = await request("/v1/chat/completions", {
    token: VALID_TOKEN,
    body: {
      model: "qwen2.5:7b",
      messages: [
        { role: "system", content: "You are a cyber security defensive evaluator." },
        { role: "user", content: "Explain prefix-cache timing side-channel isolation." },
      ],
      temperature: 0.3,
    },
  });
  console.log(`    -> HTTP Status: ${chatRes.status}`);
  console.log(`    -> Object: ${chatRes.body.object}`);
  console.log(`    -> ID: ${chatRes.body.id}`);
  console.log(`    -> Completion: "${chatRes.body.choices?.[0]?.message?.content}"`);
  console.log(`    -> Finish Reason: ${chatRes.body.choices?.[0]?.finish_reason}`);
  console.log(`    -> Usage: ${JSON.stringify(chatRes.body.usage)}`);
  if (chatRes.status !== 200 || chatRes.body.object !== "chat.completion") {
    throw new Error(`Expected OpenAI chat.completion format`);
  }
  console.log(`    ${colors.green}✔ Verified: OpenAI-compatible format returned successfully${colors.reset}`);

  // 4. Capability RBAC
  header("DEMO D: Capability RBAC Policy Check (Tenant Red admin.reset Probe)");
  console.log(`[*] Tenant 'red' attempting 'admin.reset' capability...`);
  const rbacRes = await request("/api/v1/generate", {
    token: "bayora_red_token_secret",
    body: {
      prompt: "Reset cache and admin state",
      capability: "admin.reset",
    },
  });
  console.log(`    -> HTTP Status: ${rbacRes.status}`);
  console.log(`    -> Response: ${JSON.stringify(rbacRes.body, null, 2)}`);
  if (rbacRes.status !== 403) throw new Error(`Expected 403 Forbidden, got ${rbacRes.status}`);
  console.log(`    ${colors.green}✔ Verified: Unauthorized capability probe blocked with 403 Forbidden${colors.reset}`);

  // 5. Rate Limiting Breach
  header("DEMO E: Rate Limit Breach by Rapid Bursts (429 Too Many Requests)");
  console.log(`[*] Firing rapid burst requests to exceed the per-client rate limit...`);
  let breached = false;
  for (let i = 1; i <= 14; i++) {
    const burstRes = await request("/api/v1/generate", {
      token: VALID_TOKEN,
      body: { prompt: `Burst request packet #${i}` },
    });
    const remaining = burstRes.headers["x-ratelimit-remaining"] ?? "N/A";
    console.log(`    Request #${String(i).padStart(2, "0")} -> HTTP ${burstRes.status} | Remaining: ${remaining}`);

    if (burstRes.status === 429) {
      breached = true;
      console.log(`\n    ${colors.yellow}[!] Rate limit successfully breached at request #${i}!${colors.reset}`);
      console.log(`    -> HTTP Status: 429 (Too Many Requests)`);
      console.log(`    -> Code: ${burstRes.body.error?.code}`);
      console.log(`    -> Message: ${burstRes.body.error?.message}`);
      console.log(`    -> Retry-After Header: ${burstRes.headers["retry-after"]}s`);
      console.log(`    -> Reset Timestamp: ${burstRes.headers["x-ratelimit-reset"]}`);
      break;
    }
  }

  if (!breached) throw new Error("Expected rate limit breach to return HTTP 429");
  console.log(`    ${colors.green}✔ Verified: Rapid bursts triggered 429 Too Many Requests with Retry-After header${colors.reset}`);

  console.log(`\n${colors.bold}${colors.green}${"=".repeat(70)}${colors.reset}`);
  console.log(`${colors.bold}${colors.green} ALL P1 INFERENCE GATEWAY & MODEL ADAPTER CHECKS PASSED! (100%)${colors.reset}`);
  console.log(`${colors.bold}${colors.green}${"=".repeat(70)}${colors.reset}\n`);
}

run().catch((err) => {
  console.error(`\n${colors.red}[TEST FAILED] ${err.message}${colors.reset}\n`);
  process.exit(1);
});
