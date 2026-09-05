// Server-only PDF OCR for Incoming Stock packing lists.
// PDFs are passed inline to the OpenAI Responses API; no file IDs are persisted.
import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

const MAX_PDF_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 10_000;
const MAX_FILENAME_LENGTH = 120;

function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY not configured server-side");
  return key;
}

function sanitizeError(err: unknown): string {
  const message = err instanceof Error ? err.message : "Unknown error";
  return message
    .replace(/sk-[a-zA-Z0-9_-]+/g, "[REDACTED]")
    .replace(/key[_\s]*[:=]\s*[^\s,]+/gi, "key=[REDACTED]")
    .slice(0, 240);
}

function safePdfFilename(filename: string | undefined): string {
  const cleaned = (filename || "packing-list.pdf")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, MAX_FILENAME_LENGTH);
  const base = cleaned || "packing-list.pdf";
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

function extractResponseText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  for (const item of payload?.output ?? []) {
    if (item?.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return "[]";
}

async function callResponses(apiKey: string, body: Record<string, unknown>): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const message = (errorBody as any).error?.message || `OpenAI error ${response.status}`;
      throw new Error(message);
    }
    return response.json();
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error("OpenAI PDF request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export const ocrPackingListPdf = action({
  args: {
    pdfBase64: v.string(),
    filename: v.optional(v.string()),
    prompt: v.string(),
    partList: v.optional(v.array(v.string())),
  },
  returns: v.string(),
  handler: async (ctx, { pdfBase64, filename, prompt, partList }) => {
    await requireCapability(ctx, "ai.ocr");
    if (!pdfBase64.startsWith("JVBERi0")) throw new Error("Incoming Stock PDF is not a valid PDF document");
    if (pdfBase64.length > MAX_PDF_SIZE_BYTES * 1.37) {
      throw new Error(`PDF too large (max ${MAX_PDF_SIZE_BYTES / 1024 / 1024}MB)`);
    }
    if (!prompt.trim() || prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Prompt must be 1-${MAX_PROMPT_LENGTH} characters`);
    }

    const knownParts = partList?.length
      ? `Known inventory part numbers (reference only; never invent a match): ${partList.join(", ")}`
      : "No inventory reference list was supplied.";
    const systemPrompt = `You are a document OCR assistant for VITROS Incoming Stock receiving. Read the attached PDF packing list or order packing list as a receiving document, not a DHR/checklist document.\n\n${knownParts}\n\nReturn ONLY a JSON array. Preserve each physical source line separately, including repeated occurrences of the same part number. For every actual inventory line return:\n{\n  "lineNo": number|null,\n  "partNumber": string,\n  "description": string,\n  "orderedQuantity": number|null,\n  "shippedQuantity": number|null,\n  "qty": number|null,\n  "poNumber": string|null,\n  "documentRef": string|null,\n  "page": string|null,\n  "confidence": number\n}\n\nRules:\n- Receiving quantity is SHIP QTY / SHIPPED QTY when the document shows both ordered and shipped columns. Put that value in shippedQuantity and also in qty. Do not substitute Ordered Qty for Ship Qty.\n- If the document has only one unambiguous receiving quantity column, put it in qty and leave shippedQuantity null.\n- Do not collapse repeated part lines. The review layer will aggregate only after a human sees every source line.\n- Part number identity comes only from the printed part/material number. Description is informational and must never be used to invent or fuzzy-match a different part number.\n- Read every page of the PDF; use the page field to preserve provenance.\n- Ignore page headers/footers, tracking numbers, container counts, and blank GTIN fields as inventory lines.\n- Do not treat line numbers, page numbers such as "Page 3 of 8", decimal weights such as 0.01/0.14/0.60, or other weight values as quantities.\n- Keep punctuation, suffixes, and digits in part numbers exactly as visible; do not remove meaningful internal characters.\n- Confidence must be 0 through 1. Use null for a field that is not actually visible instead of guessing.\n- Never return prose or markdown fences.`;

    const apiKey = getOpenAIKey();
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await callResponses(apiKey, {
          model: "gpt-5-mini",
          instructions: systemPrompt,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                {
                  type: "input_file",
                  filename: safePdfFilename(filename),
                  file_data: `data:application/pdf;base64,${pdfBase64}`,
                },
              ],
            },
          ],
          max_output_tokens: 3000,
        });
        return extractResponseText(result);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("Unknown error");
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
    throw new Error(`PDF OCR failed after 3 attempts: ${sanitizeError(lastError)}`);
  },
});
