import type {
  ModelAdapter,
  ModelGenerateRequest,
  ModelGenerateResponse,
  ModelMessage,
} from "./types";

export interface OpenAIModelAdapterConfig {
  endpoint?: string;
  apiKey?: string;
  defaultModel?: string;
  timeoutMs?: number;
}

export class OpenAIModelAdapter implements ModelAdapter {
  readonly name = "openai";
  private endpoint: string;
  private apiKey: string;
  private defaultModel: string;
  private timeoutMs: number;

  constructor(config: OpenAIModelAdapterConfig = {}) {
    this.endpoint =
      config.endpoint ??
      process.env.TARGET_LLM_ENDPOINT ??
      "https://api.openai.com/v1/chat/completions";
    this.apiKey =
      config.apiKey ??
      process.env.TARGET_LLM_API_KEY ??
      process.env.OPENAI_API_KEY ??
      "";
    this.defaultModel =
      config.defaultModel ??
      process.env.TARGET_LLM_MODEL ??
      "gpt-4o-mini";
    this.timeoutMs = config.timeoutMs ?? 30000;
  }

  async generate(
    request: ModelGenerateRequest,
  ): Promise<ModelGenerateResponse> {
    const startedAt = Date.now();
    const model = request.model || this.defaultModel;

    // Normalize prompt vs messages
    const messages: ModelMessage[] = [];

    if (request.system) {
      messages.push({ role: "system", content: request.system });
    }

    if (request.messages && request.messages.length > 0) {
      for (const msg of request.messages) {
        // Prevent duplicate system message if already added
        if (msg.role === "system" && request.system) continue;
        messages.push(msg);
      }
    } else if (request.prompt) {
      messages.push({ role: "user", content: request.prompt });
    } else {
      throw new Error("Invalid request: either prompt or messages must be provided");
    }

    // Determine target URL
    let url = this.endpoint;
    if (!url.endsWith("/chat/completions") && !url.endsWith("/completions")) {
      url = `${url.replace(/\/+$/, "")}/v1/chat/completions`;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    // Optional vLLM prefix-cache salting for tenant isolation
    if (request.cacheSalt) {
      headers["X-Cache-Salt"] = request.cacheSalt;
    }

    const payload: Record<string, unknown> = {
      model,
      messages,
      temperature: request.temperature ?? 0.7,
      stream: false,
    };

    if (request.max_tokens) {
      payload.max_tokens = request.max_tokens;
    }

    if (request.top_p !== undefined) {
      payload.top_p = request.top_p;
    }

    if (request.stop) {
      payload.stop = request.stop;
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
        `OpenAI-compatible target LLM returned HTTP ${response.status}: ${rawBody}`,
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new Error(
        `Failed to parse response JSON from target LLM: ${rawBody}`,
      );
    }

    const choice = parsed.choices?.[0];
    const outputText =
      choice?.message?.content ??
      choice?.text ??
      parsed.output_text ??
      parsed.response ??
      "";

    const promptTokens =
      parsed.usage?.prompt_tokens ??
      Math.ceil(JSON.stringify(messages).length / 4);
    const completionTokens =
      parsed.usage?.completion_tokens ?? Math.ceil(outputText.length / 4);

    return {
      id: parsed.id ?? `chatcmpl-${Math.random().toString(36).slice(2, 10)}`,
      object: "chat.completion",
      created: parsed.created ?? Math.floor(Date.now() / 1000),
      model: parsed.model ?? model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: outputText,
          },
          text: outputText,
          finish_reason: choice?.finish_reason ?? "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens:
          parsed.usage?.total_tokens ?? promptTokens + completionTokens,
      },
      output: outputText,
      durationMs: Date.now() - startedAt,
      provider: "openai",
      isMock: false,
      cacheSalt: request.cacheSalt,
      raw: parsed,
    };
  }
}
