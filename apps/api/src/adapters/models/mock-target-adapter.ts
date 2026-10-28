import type {
  ModelAdapter,
  ModelGenerateRequest,
  ModelGenerateResponse,
  ModelMessage,
} from "./types";

export class MockTargetModelAdapter implements ModelAdapter {
  readonly name = "mock";
  private defaultModel = "bayora-target-qwen2.5-7b";

  async generate(
    request: ModelGenerateRequest,
  ): Promise<ModelGenerateResponse> {
    const startedAt = Date.now();
    const model = request.model || this.defaultModel;

    let inputText = "";
    if (request.messages && request.messages.length > 0) {
      inputText = request.messages.map((m) => m.content).join(" ");
    } else if (request.prompt) {
      inputText = request.prompt;
    } else {
      throw new Error("Invalid request: either prompt or messages must be provided");
    }

    const lower = inputText.toLowerCase();

    // Determine target LLM response behavior
    let outputText = "";
    let finishReason: "stop" | "length" | "content_filter" = "stop";

    if (
      lower.includes("zero-day") ||
      lower.includes("exploit") ||
      lower.includes("bypass") ||
      lower.includes("malware") ||
      lower.includes("inject")
    ) {
      // Model safety refusal simulation for red-team probes
      outputText =
        "I cannot assist with developing exploits, malware, or unauthorized penetration payloads. " +
        "However, I can provide technical analysis of vulnerability mitigation and defensive hardening techniques.";
      finishReason = "content_filter";
    } else if (lower.includes("refund") || lower.includes("charge")) {
      outputText =
        "I understand you are inquiring about a transaction charge. To assist with refund verification, " +
        "I will examine the transaction records and verify billing eligibility.";
    } else {
      outputText =
        `[${model}] Response processed successfully through Bayora Inference Gateway. ` +
        `Tenant: ${request.tenant ?? "standard"} | Echo: "${inputText.slice(0, 80)}"`;
    }

    const promptTokens = Math.max(12, Math.ceil(inputText.length / 4));
    const completionTokens = Math.max(8, Math.ceil(outputText.length / 4));

    // Optional subtle latency simulation for side-channel lab alignment
    const simulatedLatency = request.cacheSalt ? 15 : 25;

    return {
      id: `chatcmpl-mock-${Math.random().toString(36).slice(2, 10)}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: outputText,
          },
          text: outputText,
          finish_reason: finishReason,
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
      output: outputText,
      durationMs: simulatedLatency,
      provider: "mock",
      cacheSalt: request.cacheSalt,
      raw: {
        mock: true,
        tenant: request.tenant,
        capability: request.capability,
      },
    };
  }
}
