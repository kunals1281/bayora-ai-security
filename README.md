# BAYORA: Secure Adversarial AI Safety-Testing Platform

> **"Test the AI. Trust the Arena."**  
> *Policy-enforced multi-tenant infrastructure for concurrent Red Team attacks, Blue Team defenses, and target LLM evaluations with zero cross-tenant leakage.*  
> **Solution for PS-04: Securing Adversarial AI Safety Testing Infrastructure (Hack in Hills)**

[![Test Suite](https://img.shields.io/badge/Tests-48%20Passing-brightgreen?style=flat-square)](tests/integration/)
[![Security Plane](https://img.shields.io/badge/Security-Docker%20Hardened%20%7C%20Internal%20Nets%20%7C%20Non--Root-blue?style=flat-square)](docker-compose.yml)
[![Inference Gateway](https://img.shields.io/badge/Gateway-Fastify%20%7C%20OpenAI--Compatible%20%7C%20Ollama-orange?style=flat-square)](apps/api/)
[![Audit Chain](https://img.shields.io/badge/Audit-SHA--256%20Append--Only%20%7C%20Ed25519-indigo?style=flat-square)](apps/api/src/services/audit/)
[![Persistence](https://img.shields.io/badge/Database-Native%20SQLite%20(node%3Asqlite)-teal?style=flat-square)](apps/api/src/services/db/)
[![Benchmarks](https://img.shields.io/badge/Datasets-HarmBench%20%7C%20AdvBench%20%7C%20Gandalf%20%7C%20JBB-purple?style=flat-square)](data/benchmarks/)

---

## 1. Problem Statement & Core Thesis

In standard AI safety evaluations, Red Teams (adversaries), Blue Teams (defenders), and the Target LLM often execute within a flat, shared container environment. This creates severe security risks:
- **Payload Leakage:** Red Team attack payloads can be passively observed by Blue defenders before test completion.
- **Model Inversion:** Blue Team defensive classification weights can be inferred or reverse-engineered by Red adversaries.
- **Shared Prefix-Cache Timing Side-Channel:** Shared KV caches in modern inference engines (e.g., vLLM) leak timing data, allowing one tenant to infer prompts queried by another tenant.
- **Context Contamination:** Host state and dirty session context survive evaluation teardowns.

**The Core Rule of Bayora:**  
> *"Communication is allowed; observation is not."*

```
RED RUNNER (Tenant: red) ──┐
                           │       Capability-Authorized & Rate-Limited
                           ├──────> INFERENCE GATEWAY (Port 4000) ──────> TARGET LLM (Qwen / Ollama / OpenAI)
                           │        (Per-Tenant Salted Cache Space)
BLUE DEFENDER (Tenant: blue)┘

RED  -X- BLUE        (Internal Docker networks: no direct routing or bridge egress)
RED  -X- host        (cap_drop: ALL, read_only: true rootfs, user 1000:1000, no-new-privileges)
BLUE -X- host        (cap_drop: ALL, read_only: true rootfs, user 1000:1000, no-new-privileges)
RED  -X- target raw  (Direct socket bypass blocked; Gateway mediation only)
BLUE -X- target raw  (Direct socket bypass blocked; Gateway mediation only)
```

---

## 2. Verified vs. Simulated vs. Planned Status

In strict adherence to engineering honesty, Bayora clearly distinguishes features that run live and are reproducible via terminal commands from simulations or future architectural roadmap targets:

| Capability | Status | Implementation Mechanism | Reproduction / Verification Command |
|---|---|---|---|
| **Multi-Provider Target LLM Adapter** | **VERIFIED** | `OpenAIModelAdapter`, `OllamaModelAdapter`, `MockTargetModelAdapter` with `isMock` flag | `npx tsx --test tests/integration/gateway.test.ts` |
| **Inference Gateway & Capability Auth** | **VERIFIED** | Fastify routes (`/api/v1/generate`, `/v1/chat/completions`), Bearer token validation, 401 on expired/invalid | `node scripts/verify-gateway.mjs` |
| **Sliding-Window Rate Limiting** | **VERIFIED** | Dynamic sliding-window rate limiter per token/IP, returns 429 + `Retry-After` header | `node scripts/verify-gateway.mjs` |
| **SQLite Persistence** | **VERIFIED** | Built-in `node:sqlite` (`data/bayora.sqlite`) storing evaluations, audit events, probes, and findings | Checked via tests and DB inspector |
| **Cryptographic Forensic Audit Chain** | **VERIFIED** | Linear SHA-256 hash chain with Ed25519 signatures, zero-copy tamper demo detecting alterations | `curl http://localhost:4000/api/v1/audit/verify` |
| **Container Hardening & Isolation Topology** | **VERIFIED** | Multi-zone Docker Compose (`red_net`, `blue_net`, `target_net` `internal: true`, `cap_drop: ALL`, `read_only: true`) | `docker compose config` |
| **8 Host & Network Boundary Probes** | **VERIFIED** | Real Node.js network and filesystem probe runners with exit codes and outputs | `curl -X POST http://localhost:4000/api/v1/security/probes/run -H "Authorization: Bearer bayora_admin_token_secret"` |
| **Standardized Benchmark Datasets** | **VERIFIED** | 95 benchmark rows in `data/benchmarks/` with normalized IDs, version tags, and SHA-256 hashes | `curl http://localhost:4000/api/v1/benchmarks` |
| **Side-Channel Timing Benchmark** | **SIMULATED** | Parametric TTFT distribution (N=50) modeling shared KV cache jitter vs cache-salted isolation | Explicitly marked `isSimulated: true` in API output |
| **Kubernetes Cilium eBPF & gVisor runsc** | **PRODUCTION PATH** | Manifests compiled in `infra/isolation-policy.md` and `docs/`; targeted for production cluster deployment | Documented under Future Work / Production Path |

---

## 3. Threat Model & Residual Risk Analysis

### Security Invariants
1. **Tenant Identity Integrity:** Tenant identity is **strictly derived from the validated authorization token** (`request.gatewayClient.tenant`) and never accepted from request body or unverified headers.
2. **Network Segmentation:** Red and Blue containers reside on distinct internal Docker bridge networks (`red_net` and `blue_net`) with `internal: true`. They cannot route packets directly to each other or egress to the public internet.
3. **Gateway Exclusivity:** The Target LLM listens on `target_net` which is accessible **only** to the Inference Gateway. Red and Blue containers cannot connect to port 11434 directly.
4. **Per-Tenant Cache Salting:** Every inference request receives a cache salt derived via `HMAC-SHA256(secret, tenant:evalId)`. This prevents cross-tenant prompt extraction via KV-cache timing side channels.
5. **Audit Chain Immutability:** Audit records are linked via `H_i = SHA256(H_{i-1} || payload_i)`. Any tampering with historical logs invalidates the chain head immediately.

### Residual Risk Matrix
- **Shared Host Kernel:** Under standard Docker runtime, containers share the host Linux kernel. In production, this residual risk is mitigated by running gVisor (`runsc`) user-space application kernels or Firecracker microVMs.
- **Side-Channel Noise:** Hardware-level timing variations (CPU cache lines, power consumption) require physical bare-metal isolation for multi-tenant defense certification.

---

## 4. Standardized Datasets

The repository includes curated adversarial benchmark subsets located in `data/benchmarks/`:

| Dataset | File | Count | Focus Area |
|---|---|---|---|
| **HarmBench** | [`data/benchmarks/harmbench.json`](data/benchmarks/harmbench.json) | 30 | Cyber attacks, malware synthesis, credential exfiltration, prompt injection |
| **AdvBench-GCG** | [`data/benchmarks/advbench.json`](data/benchmarks/advbench.json) | 20 | Universal Greedy Coordinate Gradient token suffixes, affirmative force |
| **Gandalf (Lakera)** | [`data/benchmarks/gandalf.json`](data/benchmarks/gandalf.json) | 30 | Instruction hierarchy hijack, context smuggling, multilingual translation tricks |
| **JailbreakBench** | [`data/benchmarks/jailbreakbench.json`](data/benchmarks/jailbreakbench.json) | 15 | Multi-turn fictional deception, hypothetical scenario extraction |
| **Manifest Index** | [`data/benchmarks/index.json`](data/benchmarks/index.json) | — | SHA-256 prompt hashes, version tags, refusal benchmarks |

Regenerate datasets anytime using:
```bash
node scripts/seed-datasets.mjs
```

---

## 5. API Reference & Contracts

Base URL: `http://localhost:4000`

### Authentication
All requests to protected routes require a Bearer token or `x-api-key`:
- **Master Admin Token:** `Bearer bayora_admin_token_secret` (or `sk-bayora-target-gateway-key-2026`)
- **Red Tenant Token:** `Bearer bayora_red_token_secret`
- **Blue Tenant Token:** `Bearer bayora_blue_token_secret`

### Key Endpoints

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/tokens` | Admin | Issue dynamic capability token with expiration |
| `POST` | `/api/v1/generate` | Any Tenant | Gateway inference with rate limiting & cache-salting |
| `POST` | `/v1/chat/completions` | Any Tenant | OpenAI-compatible chat completion endpoint |
| `GET` | `/v1/models` | Public | List available target models |
| `GET` | `/api/v1/benchmarks` | Public | Inspect benchmark catalog and prompt hashes |
| `POST` | `/api/v1/evaluations` | Admin | Create frozen evaluation record in SQLite |
| `GET` | `/api/v1/evaluations` | Public | List evaluation history |
| `GET` | `/api/v1/evaluations/:id` | Public | Get single evaluation details |
| `POST` | `/api/v1/evaluations/:id/run` | Admin | Execute evaluation across benchmark test cases |
| `POST` | `/api/v1/evaluations/:id/kill` | Admin | Trigger emergency kill switch & revoke tokens |
| `GET` | `/api/v1/evaluations/:id/capsule`| Admin | Export tamper-evident capsule with SHA-256 checksum |
| `POST` | `/api/v1/security/probes/run` | Admin | Run 8 boundary probes and persist results |
| `GET` | `/api/v1/security/probes` | Public | Get latest boundary probe results |
| `GET` | `/api/v1/audit/verify` | Admin | Verify unbroken SHA-256 forensic audit chain |
| `POST` | `/api/v1/audit/tamper-demo` | Admin | Zero-copy audit tampering detection demonstration |
| `POST` | `/api/v1/security/side-channel/run`| Admin | Run side-channel timing benchmark (`isSimulated: true`) |
| `GET` | `/api/v1/telemetry` | Any Tenant | Tenant-isolated performance and token telemetry |

---

## 6. Getting Started & Verification

### Prerequisites
- Node.js `v20+` or `v24+`
- pnpm or npm
- (Optional) Docker & Docker Compose

### 1. Installation
```powershell
pnpm install
```

### 2. Run Test Suite (All 48 Tests)
```powershell
npx pnpm --filter @oosc/api test
```
*Executes all 48 unit & integration tests covering model adapters, gateway auth, rate limiting, SQLite lifecycle, probe execution, audit verification, and tamper detection.*

### 3. Start Development Servers
```powershell
# Terminal 1: Backend API Gateway (Port 4000)
node --env-file=.env ./node_modules/tsx/dist/cli.mjs apps/api/src/server.ts

# Terminal 2: Frontend Security Console (Port 3000)
pnpm --filter @oosc/web dev
```
- **Web Console:** [http://localhost:3000](http://localhost:3000)
- **Backend API:** [http://localhost:4000](http://localhost:4000)

### 4. Run Gateway Verification Script
Tests 401 Unauthorized, 200 Generation, and 429 Rate Limiting in sequence:
```powershell
node scripts/verify-gateway.mjs
```

### 5. Run via Docker Compose (Hardened Multi-Zone Topology)
```bash
docker compose up --build
```

---

## 7. Video Pitch Script (1 Minute 30 Seconds)

> **Role & Context:** Hack in Hills 2026, Problem Statement 04: Securing Adversarial AI Safety Testing Infrastructure.  
> **Target Duration:** 90 seconds (1:30)

| Time | Visual / Screen Action | Spoken Script |
|---|---|---|
| **0:00 - 0:15** | Open Bayora Console (`/console/overview`). Red vs Blue architecture diagram on screen. | *"Hi everyone, we are team HackHeights, presenting our solution for Problem Statement 04: Bayora — policy-enforced multi-tenant infrastructure for AI safety testing. Today, AI safety evaluations run Red Teams, Blue Teams, and Target LLMs in flat environments where attack payloads leak, defense weights are exposed, and shared KV caches leak prompts."* |
| **0:15 - 0:35** | Navigate to `/console/gateway`. Trigger a prompt generation. Open terminal and run `node scripts/verify-gateway.mjs`. | *"Our core thesis is: Communication is allowed; observation is not. Here is our Inference Gateway. Tenant identity is strictly extracted from verified tokens — never request bodies. When an adversary attempts an unauthorized capability or bursts requests, the gateway enforces sliding-window rate limits, returning HTTP 429 with Retry-After."* |
| **0:35 - 0:55** | Switch to `/console/probes`. Click 'Run All Probes'. Show live execution of network, filesystem, and secret probes. | *"To prevent container escape and lateral movement, our Docker topology isolates Red, Blue, and Target on internal networks with dropped capabilities and read-only filesystems. Watch our real-time boundary probes verify that cross-tenant TCP connections are dropped, host procfs is isolated, and honeytoken canary exfiltration is blocked."* |
| **0:55 - 1:15** | Switch to `/console/audit`. Click 'Verify Audit Chain' (green verified). Click 'Run Tamper Demo' (red breach detected). | *"Evidence integrity is guaranteed by our cryptographic append-only audit chain. Every inference and probe is linked via SHA-256 and signed with Ed25519. When we simulate a single-character modification to a historical log, our verifier catches the tamper index immediately."* |
| **1:15 - 1:30** | Switch to `/console/evaluation`. Show evaluation capsule export with SHA-256 checksum. | *"Evaluations persist in SQLite, with normalized benchmarks from HarmBench, AdvBench, and Gandalf, and export into tamper-evident capsules with full reproducibility proofs. With Bayora, organizations can test the AI while trusting the arena. Thank you!"* |

---

## 8. License
MIT License. Built for **PS-04: Securing Adversarial AI Safety Testing Infrastructure (Hack in Hills)**.
