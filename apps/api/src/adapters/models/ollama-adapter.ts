import type {
  ModelAdapter,
  ModelGenerateRequest,
  ModelGenerateResponse,
  ModelMessage,
} from "./types";

export interface OllamaModelAdapterConfig {
  endpoint?: string;
  defaultModel?: string;
  timeoutMs?: number;
}

export class OllamaModelAdapter implements ModelAdapter {
  readonly name = "ollama";
  private endpoint: string;
  private defaultModel: string;
  private timeoutMs: number;

  constructor(config: OllamaModelAdapterConfig = {}) {
    this.endpoint =
      config.endpoint ??
      process.env.TARGET_LLM_ENDPOINT ??
      "http://localhost:11434";
    this.defaultModel =
      config.defaultModel ??
      process.env.TARGET_LLM_MODEL ??
      "qwen2.5:7b";
    this.timeoutMs = config.timeoutMs ?? 60000;
  }

  async generate(
    request: ModelGenerateRequest,
  ): Promise<ModelGenerateResponse> {
    const startedAt = Date.now();
    const model = request.model || this.defaultModel;
    const base = this.endpoint.replace(/\/+$/, "");

    // Prepare options
    const options: Record<string, unknown> = {};
    if (request.temperature !== undefined) {
      options.temperature = request.temperature;
    }
    if (request.max_tokens !== undefined) {
      options.num_predict = request.max_tokens;
    }
    if (request.top_p !== undefined) {
      options.top_p = request.top_p;
    }
    if (request.stop) {
      options.stop = request.stop;
    }

    let url: string;
    let payload: Record<string, unknown>;
    let messages: ModelMessage[] = [];

    if (request.messages && request.messages.length > 0) {
      url = `${base}/api/chat`;
      messages = [...request.messages];
      if (request.system && !messages.some((m) => m.role === "system")) {
        messages.unshift({ role: "system", content: request.system });
      }

      payload = {
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        stream: false,
        options,
      };
    } else if (request.prompt) {
      url = `${base}/api/generate`;
      messages = [{ role: "user", content: request.prompt }];
      payload = {
        model,
        prompt: request.prompt,
        system: request.system,
        stream: false,
        options,
      };
    } else {
      throw new Error("Invalid request: either prompt or messages must be provided");
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (request.cacheSalt) {
      headers["X-Cache-Salt"] = request.cacheSalt;
    }

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const rawBody = await response.text();

    if (!response.ok) {
      throw new Error(
        `Ollama/Qwen target LLM returned HTTP ${response.status}: ${rawBody}`,
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new Error(`Failed to parse Ollama JSON response: ${rawBody}`);
    }

    // Extract output text based on whether /api/chat or /api/generate was called
    const outputText =
      parsed.message?.content ??
      parsed.response ??
      "";

    const promptTokens =
      parsed.prompt_eval_count ??
      Math.ceil(JSON.stringify(messages).length / 4);
    const completionTokens =
      parsed.eval_count ?? Math.ceil(outputText.length / 4);

    return {
      id: `ollama-${Math.random().toString(36).slice(2, 10)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: parsed.model ?? model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: outputText,
          },
          text: outputText,
          finish_reason: parsed.done ? "stop" : null,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
      output: outputText,
      durationMs: Date.now() - startedAt,
      provider: "ollama",
      isMock: false,
      cacheSalt: request.cacheSalt,
      raw: parsed,
    };
  }
}
