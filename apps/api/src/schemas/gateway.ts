import { z } from "zod";

export const generateRequestSchema = z.object({
  prompt: z.string().min(1, "Prompt cannot be empty"),
  model: z.string().optional(),
  system: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  capability: z.string().optional(),
  evaluationId: z.string().optional(),
});

export const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  name: z.string().optional(),
});

export const chatCompletionRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(chatMessageSchema).min(1, "Messages array must contain at least 1 message"),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(), // alias
  top_p: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional(),
  stop: z.array(z.string()).optional(),
  capability: z.string().optional(),
  evaluationId: z.string().optional(),
});

export const issueTokenSchema = z.object({
  tenant: z.enum(["red", "blue", "admin", "standard"]),
  evaluationId: z.string().min(1),
  capabilities: z.array(z.string()).min(1),
  expiresInSeconds: z.number().int().min(0).optional(),
});

export const createEvaluationSchema = z.object({
  modelId: z.string().default("qwen2.5:3b"),
  dataset: z.string().default("HarmBench"),
  seed: z.number().int().default(42),
});

export type GenerateRequestInput = z.infer<typeof generateRequestSchema>;
export type ChatCompletionRequestInput = z.infer<typeof chatCompletionRequestSchema>;
export type IssueTokenInput = z.infer<typeof issueTokenSchema>;
export type CreateEvaluationInput = z.infer<typeof createEvaluationSchema>;
