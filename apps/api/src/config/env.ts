const port = Number(
  process.env.PORT ?? 4000,
);

export const env = {
  NODE_ENV:
    process.env.NODE_ENV ?? "development",

  HOST:
    process.env.HOST ?? "0.0.0.0",

  PORT: port,

  CORS_ORIGIN:
    process.env.CORS_ORIGIN ??
    "http://localhost:3000",

  OPENAI_API_KEY:
    process.env.OPENAI_API_KEY ?? "",

  OPENAI_EVALUATION_MODEL:
    process.env.OPENAI_EVALUATION_MODEL ??
    "gpt-4o-mini",

  TARGET_LLM_PROVIDER:
    process.env.TARGET_LLM_PROVIDER ?? "mock",

  TARGET_LLM_ENDPOINT:
    process.env.TARGET_LLM_ENDPOINT ?? "http://localhost:11434",

  TARGET_LLM_MODEL:
    process.env.TARGET_LLM_MODEL ?? "qwen2.5:7b",

  TARGET_LLM_API_KEY:
    process.env.TARGET_LLM_API_KEY ?? "",

  GATEWAY_API_KEY:
    process.env.GATEWAY_API_KEY ?? "sk-bayora-target-gateway-key-2026",

  GATEWAY_RATE_LIMIT_MAX: Number(
    process.env.GATEWAY_RATE_LIMIT_MAX ?? 10,
  ),

  GATEWAY_RATE_LIMIT_WINDOW_MS: Number(
    process.env.GATEWAY_RATE_LIMIT_WINDOW_MS ?? 60000,
  ),
};