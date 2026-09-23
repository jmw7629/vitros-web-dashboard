import { AI_ERROR_MESSAGES, type AiErrorCode } from "../../convex/aiErrorContract";

/** Return a safe public AI message only for the structured server AI contract. */
export function safeAiError(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("data" in error)) return null;
  const data: unknown = error.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const { kind, code } = data as { kind?: unknown; code?: unknown };
  if (kind !== "ai" || typeof code !== "string" || !Object.prototype.hasOwnProperty.call(AI_ERROR_MESSAGES, code)) return null;
  return AI_ERROR_MESSAGES[code as AiErrorCode];
}

/** OCR parsing/network errors may contain source text; never reflect their message. */
export function safeOcrError(error: unknown): string {
  return safeAiError(error) ?? AI_ERROR_MESSAGES.PROVIDER_UNAVAILABLE;
}
