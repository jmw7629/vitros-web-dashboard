// Server-side AI/OCR gateway.
// All OpenAI calls happen here in Convex actions (server-side only).
// No client-side secrets or API keys.
import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_PROMPT_LENGTH = 10000;

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured server-side");
  return key;
}

function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Unknown error";
  return msg
    .replace(/sk-[a-zA-Z0-9]+/g, "[REDACTED]")
    .replace(/key[_\s]*[:=]\s*[^\s,]+/gi, "key=[REDACTED]")
    .slice(0, 200);
}

async function callOpenAI(
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs = 90_000,
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = (errBody as any).error?.message || `OpenAI error ${res.status}`;
      throw new Error(msg);
    }
    return res.json();
  } catch (e: any) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error("OpenAI request timed out");
    throw e;
  }
}

export const ocrPackingList = action({
  args: {
    imageBase64: v.string(),
    prompt: v.string(),
    partList: v.optional(v.array(v.string())),
  },
  returns: v.string(),
  handler: async (ctx, { imageBase64, prompt, partList }) => {
    await requireCapability(ctx, "ai.ocr");
    if (imageBase64.length > MAX_IMAGE_SIZE_BYTES * 1.37) throw new Error(`Image too large (max ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB)`);
    if (prompt.length > MAX_PROMPT_LENGTH) throw new Error(`Prompt too long (max ${MAX_PROMPT_LENGTH} chars)`);

    const apiKey = getOpenAIKey();
    const systemPrompt = `You are an OCR assistant for packing list analysis. Extract part numbers, descriptions, and quantities from the image. ${partList?.length ? `Valid part numbers in system: ${partList.join(", ")}` : ""} Return results as JSON array with fields: partNumber, description, qty, confidence (0-1).`;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await callOpenAI(apiKey, {
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
              ],
            },
          ],
          max_tokens: 2000,
        });
        return result.choices?.[0]?.message?.content || "[]";
      } catch (e) {
        lastError = e instanceof Error ? e : new Error("Unknown error");
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    throw new Error(`OCR failed after 3 attempts: ${sanitizeError(lastError)}`);
  },
});

export const ocrDhrPage = action({
  args: {
    imageUrl: v.optional(v.string()),
    imageBase64: v.optional(v.string()),
    prompt: v.string(),
    partList: v.optional(v.array(v.string())),
  },
  returns: v.string(),
  handler: async (ctx, { imageUrl, imageBase64, prompt, partList }) => {
    await requireCapability(ctx, "ai.ocr");
    if (prompt.length > MAX_PROMPT_LENGTH) throw new Error(`Prompt too long (max ${MAX_PROMPT_LENGTH} chars)`);
    if (!!imageUrl === !!imageBase64) throw new Error("Provide exactly one DHR image source");
    if (imageBase64 && imageBase64.length > MAX_IMAGE_SIZE_BYTES * 1.37) throw new Error(`Image too large (max ${MAX_IMAGE_SIZE_BYTES / 1024 / 1024}MB)`);
    if (imageUrl && (!/^https:\/\//i.test(imageUrl) || imageUrl.length > 2048)) throw new Error("Invalid DHR image URL");

    const apiKey = getOpenAIKey();
    const systemPrompt = `You are an OCR assistant for DHR (Device History Record) page analysis. Extract structured data from the document image. ${partList?.length ? `Valid part numbers: ${partList.join(", ")}` : ""} Return results as JSON.`;
    const source = imageBase64 ? `data:image/jpeg;base64,${imageBase64}` : imageUrl!;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await callOpenAI(apiKey, {
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: source } },
              ],
            },
          ],
          max_tokens: 2000,
        });
        return result.choices?.[0]?.message?.content || "{}";
      } catch (e) {
        lastError = e instanceof Error ? e : new Error("Unknown error");
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    throw new Error(`OCR failed after 3 attempts: ${sanitizeError(lastError)}`);
  },
});
