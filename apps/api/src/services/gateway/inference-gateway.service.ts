import {
  createModelAdapter,
  type ModelAdapter,
  type ModelGenerateRequest,
  type ModelGenerateResponse,
} from "../../adapters/models";
import { RequestBalancer } from "./request-balancer";
import { auditChainService } from "../audit/audit-chain.service";
import type { GatewayClient } from "../../middleware/gateway-auth";

export interface GenerateApiInput {
  prompt: string;
  model?: string;
  system?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  capability?: string;
  evaluationId?: string;
}

export interface OpenAIChatCompletionInput {
  model?: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  maxTokens?: number;
  top_p?: number;
  stream?: boolean;
  stop?: string[];
  capability?: string;
  evaluationId?: string;
}

export class InferenceGatewayService {
  private balancer: RequestBalancer;
  private primaryAdapter: ModelAdapter;
  private totalRequestsServed = 0;
  private totalTokensServed = 0;
  private averageLatencyMs = 0;

  constructor(customAdapter?: ModelAdapter) {
    this.primaryAdapter = customAdapter ?? createModelAdapter();
    this.balancer = new RequestBalancer("primary-fallback");

    this.balancer.addMember({
      id: "primary-adapter",
      name: `Primary (${this.primaryAdapter.name})`,
      adapter: this.primaryAdapter,
    });
  }

  getPrimaryAdapter(): ModelAdapter {
    return this.primaryAdapter;
  }

  setPrimaryAdapter(adapter: ModelAdapter) {
    this.primaryAdapter = adapter;
    this.balancer = new RequestBalancer("primary-fallback");
    this.balancer.addMember({
      id: "primary-adapter",
      name: `Primary (${adapter.name})`,
      adapter,
    });
  }

  async generate(
    input: GenerateApiInput,
    client?: GatewayClient,
  ): Promise<ModelGenerateResponse> {
    // Tenant STRICTLY comes from verified token
    const tenant = client?.tenant ?? "standard";
    const cacheSalt = client?.cacheSalt ?? `salt_${tenant}_default`;

    const modelRequest: ModelGenerateRequest = {
      prompt: input.prompt,
      system: input.system,
      model: input.model,
      temperature: input.temperature,
      max_tokens: input.max_tokens,
      top_p: input.top_p,
      tenant: tenant as any,
      capability: input.capability ?? "model.inference",
      cacheSalt,
    };

    try {
      const response = await this.primaryAdapter.generate(modelRequest);
      this.updateStats(response);

      // Record in cryptographic audit chain
      auditChainService.recordEvent("GATEWAY_INFERENCE", {
        tenant,
        evaluationId: client?.evaluationId ?? input.evaluationId ?? "eval_default",
        capability: input.capability ?? "model.inference",
        model: response.model,
        provider: response.provider,
        isMock: response.isMock,
        cacheSalt: response.cacheSalt,
        durationMs: response.durationMs,
        tokens: response.usage.total_tokens,
      });

      return response;
    } catch (err: any) {
      auditChainService.recordEvent("MODEL_ERROR", {
        tenant,
        capability: input.capability ?? "model.inference",
        error: err.message,
        provider: this.primaryAdapter.name,
      });
      throw err;
    }
  }

  async chatCompletions(
    input: OpenAIChatCompletionInput,
    client?: GatewayClient,
  ): Promise<ModelGenerateResponse> {
    // Tenant STRICTLY comes from verified token
    const tenant = client?.tenant ?? "standard";
    const cacheSalt = client?.cacheSalt ?? `salt_${tenant}_default`;

    const modelRequest: ModelGenerateRequest = {
      messages: input.messages,
      model: input.model,
      temperature: input.temperature,
      max_tokens: input.max_tokens ?? input.maxTokens,
      top_p: input.top_p,
      stream: input.stream,
      stop: input.stop,
      tenant: tenant as any,
      capability: input.capability ?? "model.inference",
      cacheSalt,
    };

    try {
      const response = await this.primaryAdapter.generate(modelRequest);
      this.updateStats(response);

      auditChainService.recordEvent("GATEWAY_INFERENCE", {
        tenant,
        evaluationId: client?.evaluationId ?? input.evaluationId ?? "eval_default",
        capability: input.capability ?? "model.inference",
        model: response.model,
        provider: response.provider,
        isMock: response.isMock,
        cacheSalt: response.cacheSalt,
        durationMs: response.durationMs,
        tokens: response.usage.total_tokens,
      });

      return response;
    } catch (err: any) {
      auditChainService.recordEvent("MODEL_ERROR", {
        tenant,
        capability: input.capability ?? "model.inference",
        error: err.message,
        provider: this.primaryAdapter.name,
      });
      throw err;
    }
  }

  getAvailableModels() {
    return [
      {
        id: "qwen2.5:3b",
        object: "model",
        created: 1718000000,
        owned_by: "alibaba-qwen",
        isDefault: true,
      },
      {
        id: "qwen2.5:7b",
        object: "model",
        created: 1718000000,
        owned_by: "alibaba-qwen",
      },
      {
        id: "gpt-4o-mini",
        object: "model",
        created: 1718000000,
        owned_by: "openai",
      },
      {
        id: "bayora-target-mock",
        object: "model",
        created: 1718000000,
        owned_by: "bayora-security",
        isMock: true,
      },
    ];
  }

  private updateStats(res: ModelGenerateResponse) {
    this.totalRequestsServed++;
    this.totalTokensServed += res.usage.total_tokens;
    this.averageLatencyMs =
      this.averageLatencyMs === 0
        ? res.durationMs
        : Math.round(this.averageLatencyMs * 0.8 + res.durationMs * 0.2);
  }

  getStats() {
    return {
      status: "healthy",
      adapter: this.primaryAdapter.name,
      totalRequestsServed: this.totalRequestsServed,
      totalTokensServed: this.totalTokensServed,
      averageLatencyMs: this.averageLatencyMs,
      pool: this.balancer.getPoolStats(),
    };
  }
}

export const inferenceGatewayService = new InferenceGatewayService();
