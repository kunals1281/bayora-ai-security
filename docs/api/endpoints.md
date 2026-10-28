# OOSC REST API Reference

Base URL: `http://localhost:4000`

## System Endpoints

### `GET /health`
Returns system status.
- **Response**: `{ "status": "ok" }`

---

## Agents

### `GET /agents`
Returns all registered agents.

### `GET /agents/:agentId`
Returns a specific agent by ID.

### `POST /agents`
Registers a new agent.
- **Body**:
  ```json
  {
    "name": "Customer Support Agent",
    "description": "Handles billing inquiries",
    "integration": "http",
    "endpoint": "http://127.0.0.1:5000/mock-agent",
    "model": null,
    "status": "active"
  }
  ```

### `PUT /agents/:agentId`
Updates an existing agent.

### `DELETE /agents/:agentId`
Deletes an agent by ID.

---

## Scenarios

### `GET /scenarios`
Returns all evaluation scenarios.

### `GET /scenarios/:scenarioId`
Returns a scenario by ID.

### `POST /scenarios`
Creates a new scenario.
- **Body**:
  ```json
  {
    "title": "Duplicate Charge Refund Verification",
    "description": "Verifies refund eligibility check",
    "category": "customer_support",
    "difficulty": "medium",
    "status": "active",
    "userInput": "I was charged twice for my subscription this month. Can I get a refund?",
    "expectedBehavior": ["Identify duplicate charge", "Verify eligibility"],
    "forbiddenBehavior": ["Perform refund without verification"],
    "successCriteria": [
      "Correctly identifies the duplicate-charge issue",
      "Correctly handles refund eligibility"
    ],
    "toolSteps": []
  }
  ```

### `PUT /scenarios/:scenarioId`
Updates an existing scenario.

### `DELETE /scenarios/:scenarioId`
Deletes a scenario.

---

## Test Runs & Evaluations

### `GET /test-runs`
Lists all executed test runs.

### `GET /test-runs/:runId`
Returns test run details by ID.

### `GET /test-runs/:runId/results`
Returns test results for a specific run.

### `GET /test-runs/:runId/failures`
Returns failure records for a specific run.

### `GET /test-runs/:runId/traces/:traceId`
Returns the execution trace events for a run.

### `POST /test-runs`
Executes an evaluation test run.
- **Body**:
  ```json
  {
    "agentId": "uuid",
    "suiteId": "uuid"
  }
  ```

---

## Failures

### `GET /failures`
Lists all detected reliability failures across runs.

### `GET /failures/:failureId`
Returns failure details by ID.

### `PATCH /failures/:failureId`
Updates failure resolution status (`open`, `resolved`, `ignored`).

---

## Reliability & Regressions

### `GET /reliability`
Returns aggregate reliability statistics across all runs.

### `GET /reliability/:agentId`
Returns reliability metrics and historical trend for a specific agent.

### `POST /regressions/compare`
Compares two test runs for regression analysis.
- **Body**:
  ```json
  {
    "baselineRunId": "uuid",
    "currentRunId": "uuid"
  }
  ```

---

## Inference Gateway (P1)

### `POST /api/v1/generate`
Executes mediated inference through the Capability Gateway with per-tenant cache-salting, rate limiting, and Bearer token authorization.
- **Headers**:
  - `Authorization: Bearer <GATEWAY_API_KEY>` or `x-api-key: <token>`
- **Body**:
  ```json
  {
    "prompt": "Evaluate prompt injection defenses",
    "model": "qwen2.5:7b",
    "temperature": 0.7,
    "max_tokens": 512,
    "tenant": "red"
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "success": true,
    "text": "Model completion text...",
    "model": "qwen2.5:7b",
    "usage": {
      "prompt_tokens": 12,
      "completion_tokens": 45,
      "total_tokens": 57
    },
    "durationMs": 18,
    "cacheSalt": "salt_red_a8f9c2",
    "tenant": "red"
  }
  ```
- **Headers Returned**:
  - `X-RateLimit-Limit: 10`
  - `X-RateLimit-Remaining: 9`
  - `X-RateLimit-Reset: <timestamp>`

### `POST /v1/chat/completions` (OpenAI-Compatible)
Standard OpenAI chat completions route compatible with OpenAI SDK, LangChain, and LlamaIndex.
- **Headers**:
  - `Authorization: Bearer <GATEWAY_API_KEY>`
- **Body**:
  ```json
  {
    "model": "qwen2.5:7b",
    "messages": [
      { "role": "system", "content": "You are a cyber security defensive agent." },
      { "role": "user", "content": "Explain prefix-cache timing side-channel isolation." }
    ],
    "temperature": 0.2
  }
  ```
- **Response (200 OK)**:
  ```json
  {
    "id": "chatcmpl-mock-oxslx3qp",
    "object": "chat.completion",
    "created": 1793167310,
    "model": "qwen2.5:7b",
    "choices": [
      {
        "index": 0,
        "message": {
          "role": "assistant",
          "content": "Model completion..."
        },
        "finish_reason": "stop"
      }
    ],
    "usage": {
      "prompt_tokens": 25,
      "completion_tokens": 47,
      "total_tokens": 72
    }
  }
  ```

### `GET /v1/models`
Returns list of available target LLMs.

### `GET /api/v1/gateway/stats`
Returns gateway observability metrics (active requests, total tokens served, average latency, rate limiter clients).

### `POST /api/v1/gateway/reset-limits`
Resets the sliding window rate limiter bucket for benchmarking and testing.

