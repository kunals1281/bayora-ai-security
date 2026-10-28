#!/usr/bin/env bash
# Bayora Inference Gateway - Bash / curl Verification Script
set -e

BASE_URL="http://localhost:4000"
VALID_TOKEN="sk-bayora-target-gateway-key-2026"
INVALID_TOKEN="invalid_compromised_token_999"

echo "======================================================================"
echo " 1. Authorization Failure (HTTP 401) with Invalid Token"
echo "======================================================================"
curl -s -w "\nHTTP Status: %{http_code}\n\n" \
  -X POST "$BASE_URL/api/v1/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $INVALID_TOKEN" \
  -d '{"prompt": "Hello target model"}'

echo "======================================================================"
echo " 2. Successful Generation (HTTP 200) with Valid Bearer Token"
echo "======================================================================"
curl -s -i \
  -X POST "$BASE_URL/api/v1/generate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_TOKEN" \
  -d '{"prompt": "Analyze prompt injection defenses", "model": "qwen2.5:7b"}'

echo -e "\n\n======================================================================"
echo " 3. OpenAI-Compatible Chat Completions (HTTP 200)"
echo "======================================================================"
curl -s \
  -X POST "$BASE_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $VALID_TOKEN" \
  -d '{
    "model": "qwen2.5:7b",
    "messages": [
      {"role": "system", "content": "You are a cyber security defensive agent."},
      {"role": "user", "content": "Explain prefix-cache timing side-channel isolation."}
    ]
  }' | json_pp 2>/dev/null || cat

echo -e "\n\n======================================================================"
echo " 4. Rate Limit Breach (HTTP 429) via Rapid Bursts"
echo "======================================================================"
for i in {1..14}; do
  echo -n "Request #$i: "
  curl -s -o /dev/null -w "HTTP %{http_code}\n" \
    -X POST "$BASE_URL/api/v1/generate" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $VALID_TOKEN" \
    -d "{\"prompt\": \"Burst probe $i\"}"
done
