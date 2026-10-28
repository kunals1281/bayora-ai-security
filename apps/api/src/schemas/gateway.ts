import { z } from "zod";

export const generateRequestSchema = z.object({
  prompt: z.string().min(1, "Prompt cannot be empty"),
  model: z.string().optional(),
  system: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  tenant: z.enum(["red", "blue", "admin"]).optional(),
  capability: z.string().optional(),
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
  top_p: z.number().min(0).max(1).optional(),
  stream: z.boolean().optional(),
  stop: z.array(z.string()).optional(),
  tenant: z.enum(["red", "blue", "admin"]).optional(),
  capability: z.string().optional(),
});

export type GenerateRequestInput = z.infer<typeof generateRequestSchema>;
export type ChatCompletionRequestInput = z.infer<typeof chatCompletionRequestSchema>;
