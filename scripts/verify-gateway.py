#!/usr/bin/env python3
"""
Bayora Inference Gateway - P1 Verification Script
Demonstrates:
  a) Successful generation with a valid token (200 OK + model response)
  b) Authorization failure with an invalid or missing token (401 Unauthorized)
  c) Rate limit breach by firing rapid burst requests (429 Too Many Requests)
  d) OpenAI-compatible chat completions (/v1/chat/completions)
  e) Capability RBAC boundary probe (Tenant Red attempting admin.reset -> 403)
"""

import urllib.request
import urllib.error
import json
import sys
import time

GATEWAY_BASE = "http://localhost:4000"
VALID_TOKEN = "sk-bayora-target-gateway-key-2026"
INVALID_TOKEN = "invalid_compromised_token_999"

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

def print_header(title):
    print(f"\n{BOLD}{CYAN}{'=' * 70}{RESET}")
    print(f"{BOLD}{CYAN} {title}{RESET}")
    print(f"{BOLD}{CYAN}{'=' * 70}{RESET}")

def make_request(path, method="POST", data=None, token=None, extra_headers=None):
    url = f"{GATEWAY_BASE}{path}"
    headers = {"Content-Type": "application/json"}
    
    if token:
        headers["Authorization"] = f"Bearer {token}"
        
    if extra_headers:
        headers.update(extra_headers)

    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            status = response.getcode()
            res_body = response.read().decode("utf-8")
            res_headers = dict(response.info())
            return status, json.loads(res_body) if res_body else {}, res_headers
    except urllib.error.HTTPError as e:
        status = e.code
        err_body = e.read().decode("utf-8")
        res_headers = dict(e.headers)
        try:
            parsed = json.loads(err_body)
        except Exception:
            parsed = {"raw": err_body}
        return status, parsed, res_headers
    except Exception as ex:
        return 0, {"error": str(ex)}, {}

def test_authorization_failure():
    print_header("DEMO A: Authorization Failure with Invalid Token (401 Unauthorized)")
    
    # 1. No token
    print(f"[*] Sending inference request with NO token to {GATEWAY_BASE}/api/v1/generate...")
    status, body, _ = make_request("/api/v1/generate", data={"prompt": "Ping model"})
    print(f"    -> Received HTTP Status: {status}")
    print(f"    -> Response Body: {json.dumps(body, indent=2)}")
    assert status == 401, f"Expected 401 Unauthorized, got {status}"
    assert body.get("error", {}).get("code") == "UNAUTHORIZED"
    print(f"    {GREEN}✔ Verified: Missing token correctly denied with 401 Unauthorized{RESET}")

    # 2. Invalid token
    print(f"\n[*] Sending inference request with INVALID token '{INVALID_TOKEN}'...")
    status, body, _ = make_request("/api/v1/generate", data={"prompt": "Ping model"}, token=INVALID_TOKEN)
    print(f"    -> Received HTTP Status: {status}")
    print(f"    -> Response Body: {json.dumps(body, indent=2)}")
    assert status == 401, f"Expected 401 Unauthorized, got {status}"
    print(f"    {GREEN}✔ Verified: Invalid Bearer token correctly denied with 401 Unauthorized{RESET}")

def test_successful_generation():
    print_header("DEMO B: Successful Generation with Valid Token (200 OK + Model Response)")
    
    prompt = "Analyze adversarial prompt injection resistance in LLM security gateways"
    print(f"[*] Prompt: '{prompt}'")
    print(f"[*] Token: Bearer {VALID_TOKEN}")
    print(f"[*] Sending request to {GATEWAY_BASE}/api/v1/generate...")

    status, body, headers = make_request(
        "/api/v1/generate",
        data={"prompt": prompt, "model": "qwen2.5:7b", "tenant": "blue"},
        token=VALID_TOKEN
    )

    print(f"    -> Received HTTP Status: {status}")
    print(f"    -> Response Model: {body.get('model')}")
    print(f"    -> Cache Salt Assigned: {body.get('cacheSalt')}")
    print(f"    -> Model Output: \"{body.get('text')}\"")
    print(f"    -> Token Usage: {body.get('usage')}")
    print(f"    -> Latency: {body.get('durationMs')}ms")
    print(f"    -> Remaining Rate Limit: {headers.get('x-ratelimit-remaining')}/{headers.get('x-ratelimit-limit')}")

    assert status == 200, f"Expected 200 OK, got {status}"
    assert body.get("success") is True, "Expected success: true"
    assert len(body.get("text", "")) > 0, "Expected non-empty model completion text"
    print(f"    {GREEN}✔ Verified: Generation succeeded with 200 OK and valid model completion{RESET}")

def test_openai_chat_completions():
    print_header("DEMO C: OpenAI-Compatible Chat Completions (/v1/chat/completions)")
    
    print(f"[*] Sending OpenAI-formatted request to {GATEWAY_BASE}/v1/chat/completions...")
    payload = {
        "model": "qwen2.5:7b",
        "messages": [
            {"role": "system", "content": "You are a cyber security defensive agent."},
            {"role": "user", "content": "Explain prefix-cache timing side-channel attacks."}
        ],
        "temperature": 0.2
    }

    status, body, _ = make_request("/v1/chat/completions", data=payload, token=VALID_TOKEN)
    print(f"    -> Received HTTP Status: {status}")
    print(f"    -> Object Type: {body.get('object')}")
    print(f"    -> Completion ID: {body.get('id')}")
    choices = body.get("choices", [])
    if choices:
        print(f"    -> Assistant Reply: \"{choices[0].get('message', {}).get('content')}\"")
        print(f"    -> Finish Reason: {choices[0].get('finish_reason')}")
    print(f"    -> Usage: {body.get('usage')}")

    assert status == 200, f"Expected 200 OK, got {status}"
    assert body.get("object") == "chat.completion", "Expected object: chat.completion"
    print(f"    {GREEN}✔ Verified: Standard OpenAI format generated correctly{RESET}")

def test_rate_limiting():
    print_header("DEMO D: Rate Limit Breach by Rapid Bursts (429 Too Many Requests)")
    
    burst_token = "sk-bayora-target-gateway-key-2026"
    print(f"[*] Firing rapid burst requests to exceed the rate limit quota...")
    
    breached = False
    for i in range(1, 15):
        status, body, headers = make_request(
            "/api/v1/generate",
            data={"prompt": f"Burst request probe #{i}"},
            token=burst_token
        )
        remaining = headers.get("x-ratelimit-remaining", "N/A")
        print(f"    Request #{i:02d} -> HTTP {status} | Remaining Quota: {remaining}")

        if status == 429:
            breached = True
            retry_after = headers.get("retry-after")
            print(f"\n    {YELLOW}[!] Rate limit successfully triggered at request #{i}!{RESET}")
            print(f"    -> HTTP Status: 429 (Too Many Requests)")
            print(f"    -> Error Code: {body.get('error', {}).get('code')}")
            print(f"    -> Error Message: {body.get('error', {}).get('message')}")
            print(f"    -> Retry-After Header: {retry_after}s")
            print(f"    -> Reset Timestamp: {headers.get('x-ratelimit-reset')}")
            break

    assert breached, "Expected rate limit to breach with HTTP 429"
    print(f"    {GREEN}✔ Verified: Rapid bursts triggered 429 Too Many Requests with Retry-After header{RESET}")

def test_capability_rbac():
    print_header("DEMO E: Capability RBAC Policy Check (Tenant Red admin.reset Probe)")
    
    # Red tenant attempting admin privilege
    print(f"[*] Tenant 'red' attempting 'admin.reset' capability...")
    status, body, _ = make_request(
        "/api/v1/generate",
        data={"prompt": "Reset cache tables", "capability": "admin.reset"},
        token="bayora_red_token_secret"
    )
    print(f"    -> Received HTTP Status: {status}")
    print(f"    -> Response: {json.dumps(body, indent=2)}")
    assert status == 403, f"Expected 403 Forbidden, got {status}"
    print(f"    {GREEN}✔ Verified: Gateway RBAC blocked unauthorized capability probe with 403 Forbidden{RESET}")

def main():
    print(f"{BOLD}{GREEN}Starting Bayora P1 Gateway Verification Suite{RESET}")
    print(f"Target Server: {GATEWAY_BASE}")

    # Check server health
    status, health, _ = make_request("/health", method="GET")
    if status != 200:
        print(f"{RED}[ERROR] Backend server is not running on {GATEWAY_BASE}. Please start it with 'pnpm dev' or 'pnpm start'.{RESET}")
        sys.exit(1)

    print(f"{GREEN}[OK] Connected to API server. System status: {health.get('status')}{RESET}")

    # Reset rate limit bucket to ensure clean run
    make_request("/api/v1/gateway/reset-limits", method="POST", token=VALID_TOKEN)

    try:
        test_authorization_failure()
        test_successful_generation()
        test_openai_chat_completions()
        test_capability_rbac()
        test_rate_limiting()

        print(f"\n{BOLD}{GREEN}{'=' * 70}{RESET}")
        print(f"{BOLD}{GREEN} ALL P1 INFERENCE GATEWAY & MODEL ADAPTER CHECKS PASSED! (100%){RESET}")
        print(f"{BOLD}{GREEN}{'=' * 70}{RESET}\n")
    except AssertionError as ae:
        print(f"\n{RED}[TEST FAILED] {ae}{RESET}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
