// Server-side AI/OCR gateway.
// All OpenAI calls happen here in Convex actions (server-side only).
// No client-side secrets or API keys.
import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_PROMPT_LENGTH = 10000;
const MAX_REFERENCE_PARTS = 1000;
const MAX_PART_NUMBER_LENGTH = 128;
const MAX_REFERENCE_PART_CHARS = 50000;

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured server-side");
  return key;
}

function normalizeReferenceParts(partList?: string[]): string[] | undefined {
  if (!partList?.length) return undefined;
  if (partList.length > MAX_REFERENCE_PARTS) {
    throw new Error(`Too many reference parts (max ${MAX_REFERENCE_PARTS})`);
  }

  let totalChars = 0;
  return partList.map((part, index) => {
    const normalized = part.trim();
    if (!normalized) throw new Error(`Reference part ${index + 1} is blank`);
    if (normalized.length > MAX_PART_NUMBER_LENGTH) {
      throw new Error(`Reference part ${index + 1} is too long (max ${MAX_PART_NUMBER_LENGTH} chars)`);
    }
    totalChars += normalized.length;
    if (totalChars > MAX_REFERENCE_PART_CHARS) {
      throw new Error(`Reference part list is too large (max ${MAX_REFERENCE_PART_CHARS} chars)`);
    }
    return normalized;
  });
}

function safeOpenAIError(err: unknown): string {
  if (!(err instanceof Error)) return "OpenAI request failed";
  if (err.message === "OpenAI request timed out") return err.message;
  if (err.message === "OpenAI returned an invalid response") return err.message;
  if (/^OpenAI request failed with status [1-5]\d\d$/.test(err.message)) return err.message;
  return "OpenAI request failed";
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
    if (!res.ok) {
      throw new Error(`OpenAI request failed with status ${res.status}`);
    }
    try {
      return await res.json();
    } catch {
      throw new Error("OpenAI returned an invalid response");
    }
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error("OpenAI request timed out");
    throw e;
  } finally {
    clearTimeout(timer);
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
    const referenceParts = normalizeReferenceParts(partList);
    const knownParts = referenceParts?.length
      ? `Known inventory part numbers (reference only; never invent a match): ${referenceParts.join(", ")}`
      : "No inventory reference list was supplied.";
    const systemPrompt = `You are a document OCR assistant for VITROS Incoming Stock receiving. Read packing lists and order packing lists as receiving documents, not DHR/checklist documents.

${knownParts}

Return ONLY a JSON array. Preserve each physical source line separately, including repeated occurrences of the same part number. For every actual inventory line return:
{
  "lineNo": number|null,
  "partNumber": string,
  "description": string,
  "orderedQuantity": number|null,
  "shippedQuantity": number|null,
  "qty": number|null,
  "poNumber": string|null,
  "documentRef": string|null,
  "page": string|null,
  "confidence": number
}

Rules:
- Receiving quantity is SHIP QTY / SHIPPED QTY when the document shows both ordered and shipped columns. Put that value in shippedQuantity and also in qty. Do not substitute Ordered Qty for Ship Qty.
- If the document has only one unambiguous receiving quantity column, put it in qty and leave shippedQuantity null.
- Do not collapse repeated part lines. The review layer will aggregate only after a human sees every source line.
- Part number identity comes only from the printed part/material number. Description is informational and must never be used to invent or fuzzy-match a different part number.
- Auto-read pages that are rotated about 90 degrees, skewed, or photographed at an angle.
- Ignore page headers/footers, tracking numbers, container counts, and blank GTIN fields as inventory lines.
- Do not treat line numbers, page numbers such as "Page 3 of 8", decimal weights such as 0.01/0.14/0.60, or other weight values as quantities.
- Keep punctuation, suffixes, and digits in part numbers exactly as visible; do not remove meaningful internal characters.
- Confidence must be 0 through 1. Use null for a field that is not actually visible instead of guessing.
- Never return prose or markdown fences.`;

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
          max_tokens: 3000,
        });
        return result.choices?.[0]?.message?.content || "[]";
      } catch (e) {
        lastError = e instanceof Error ? e : new Error("Unknown error");
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    throw new Error(`OCR failed after 3 attempts: ${safeOpenAIError(lastError)}`);
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
    const referenceParts = normalizeReferenceParts(partList);
    const systemPrompt = `You are an OCR assistant for DHR (Device History Record) page analysis. Extract structured data from the document image. ${referenceParts?.length ? `Valid part numbers: ${referenceParts.join(", ")}` : ""} Return results as JSON.`;
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
    throw new Error(`OCR failed after 3 attempts: ${safeOpenAIError(lastError)}`);
  },
});