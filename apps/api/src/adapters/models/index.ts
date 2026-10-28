import type { ModelAdapter } from "./types";
import { OpenAIModelAdapter, type OpenAIModelAdapterConfig } from "./openai-adapter";
import { OllamaModelAdapter, type OllamaModelAdapterConfig } from "./ollama-adapter";
import { MockTargetModelAdapter } from "./mock-target-adapter";

export type ModelProviderType = "openai" | "ollama" | "mock" | "auto";

export interface ModelAdapterFactoryOptions {
  provider?: ModelProviderType;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}

export function createModelAdapter(
  options: ModelAdapterFactoryOptions = {},
): ModelAdapter {
  const provider =
    options.provider ??
    (process.env.TARGET_LLM_PROVIDER as ModelProviderType) ??
    "auto";

  if (provider === "ollama") {
    return new OllamaModelAdapter({
      endpoint: options.endpoint,
      defaultModel: options.model,
      timeoutMs: options.timeoutMs,
    });
  }

  if (provider === "openai") {
    return new OpenAIModelAdapter({
      endpoint: options.endpoint,
      apiKey: options.apiKey,
      defaultModel: options.model,
      timeoutMs: options.timeoutMs,
    });
  }

  if (provider === "mock") {
    return new MockTargetModelAdapter();
  }

  // "auto": if endpoint contains 11434, pick ollama; if API key provided or endpoint is openai/vllm, pick openai; else fallback to mock
  const endpoint = options.endpoint ?? process.env.TARGET_LLM_ENDPOINT ?? "";
  const apiKey =
    options.apiKey ??
    process.env.TARGET_LLM_API_KEY ??
    process.env.OPENAI_API_KEY ??
    "";

  if (endpoint.includes("11434")) {
    return new OllamaModelAdapter({
      endpoint: options.endpoint,
      defaultModel: options.model,
      timeoutMs: options.timeoutMs,
    });
  }

  if (apiKey || endpoint.includes("openai") || endpoint.includes("8000")) {
    return new OpenAIModelAdapter({
      endpoint: options.endpoint,
      apiKey,
      defaultModel: options.model,
      timeoutMs: options.timeoutMs,
    });
  }

  // Default to Mock target model for high reliability and zero external dependency
  return new MockTargetModelAdapter();
}

export * from "./types";
export * from "./openai-adapter";
export * from "./ollama-adapter";
export * from "./mock-target-adapter";
