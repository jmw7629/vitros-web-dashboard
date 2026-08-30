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
  // Strip any sensitive info from error messages
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
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
    partList: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "ai.ocr");

    if (args.imageBase64.length > MAX_IMAGE_SIZE_BYTES * 1.5) {
      // base64 is ~33% larger than binary
      throw new Error("Image too large. Maximum size is 10MB.");
    }

    if (args.prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error("Prompt exceeds maximum length");
    }

    const apiKey = getOpenAIKey();

    const body = {
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        { role: "system", content: args.prompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Read this QuidelOrtho packing list. Extract every line item with part number and quantity. The document may be rotated sideways. Remember: LINE number ≠ quantity. Use QTY/UNIT for Container lists or SHIP QTY for Order lists." },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${args.imageBase64}`, detail: "high" } },
          ],
        },
      ],
    };

    let lastErr = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const json = await callOpenAI(apiKey, body);
        const raw = json.choices?.[0]?.message?.content || "";
        let parsed: any;
        try {
          const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
          parsed = JSON.parse(cleaned);
        } catch {
          const m = raw.match(/\{[\s\S]*\}/);
          if (m) parsed = JSON.parse(m[0]);
          else throw new Error("Could not parse AI response");
        }
        return parsed;
      } catch (e: any) {
        lastErr = sanitizeError(e);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
      }
    }
    throw new Error(`OCR failed after 3 attempts: ${lastErr}`);
  },
});

export const ocrDhrPage = action({
  args: {
    imageUrl: v.string(),
    prompt: v.string(),
    partList: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "ai.ocr");

    if (args.prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error("Prompt exceeds maximum length");
    }

    const apiKey = getOpenAIKey();

    const body = {
      model: "gpt-4o",
      max_tokens: 4096,
      messages: [
        { role: "system", content: args.prompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Read this DHR page and extract all part numbers with quantities. The page may be rotated or at an angle." },
            { type: "image_url", image_url: { url: args.imageUrl, detail: "high" } },
          ],
        },
      ],
    };

    let lastErr = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const json = await callOpenAI(apiKey, body);
        const content = json.choices?.[0]?.message?.content || "";
        const cleaned = content.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
        return JSON.parse(cleaned);
      } catch (e: any) {
        lastErr = sanitizeError(e);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
      }
    }
    throw new Error(`DHR OCR failed after 3 attempts: ${lastErr}`);
  },
});
