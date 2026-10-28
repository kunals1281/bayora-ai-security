export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
}

export interface ModelGenerateOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stream?: boolean;
  system?: string;
  stop?: string[];
  tenant?: "red" | "blue" | "admin";
  capability?: string;
  cacheSalt?: string;
}

export interface ModelGenerateRequest extends ModelGenerateOptions {
  prompt?: string;
  messages?: ModelMessage[];
}

export interface ModelChoice {
  index: number;
  message: {
    role: "assistant";
    content: string;
  };
  text?: string;
  finish_reason: "stop" | "length" | "content_filter" | null;
}

export interface ModelUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ModelGenerateResponse {
  id: string;
  object: "chat.completion" | "text_completion";
  created: number;
  model: string;
  choices: ModelChoice[];
  usage: ModelUsage;
  output: string;
  durationMs: number;
  provider: string;
  cacheSalt?: string;
  raw?: unknown;
}

export interface ModelAdapter {
  readonly name: string;
  generate(request: ModelGenerateRequest): Promise<ModelGenerateResponse>;
}
