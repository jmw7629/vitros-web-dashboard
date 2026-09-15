// Server-only PDF OCR for Incoming Stock packing lists.
// PDFs use the configured free Zen model; no file IDs are persisted.
import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";
import {runZen} from "./zenRuntime";

declare const process: { env: Record<string, string | undefined> };

const MAX_PDF_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_LENGTH = 10_000;
const MAX_FILENAME_LENGTH = 120;
const MAX_REFERENCE_PARTS = 1_000;
const MAX_REFERENCE_PART_CHARS = 80;

function safePdfFilename(filename: string | undefined): string {
  const cleaned = (filename || "packing-list.pdf")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, MAX_FILENAME_LENGTH);
  const base = cleaned || "packing-list.pdf";
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

function boundedReferenceParts(partList: string[] | undefined): string[] {
  return (partList ?? [])
    .slice(0, MAX_REFERENCE_PARTS)
    .map((part) => part.trim().slice(0, MAX_REFERENCE_PART_CHARS))
    .filter(Boolean);
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
    const actor = await requireCapability(ctx, "ai.ocr");
    if (!pdfBase64.startsWith("JVBERi0")) throw new Error("Incoming Stock PDF is not a valid PDF document");
    if (pdfBase64.length > MAX_PDF_SIZE_BYTES * 1.37) {
      throw new Error(`PDF too large (max ${MAX_PDF_SIZE_BYTES / 1024 / 1024}MB)`);
    }
    if (!prompt.trim() || prompt.length > MAX_PROMPT_LENGTH) {
      throw new Error(`Prompt must be 1-${MAX_PROMPT_LENGTH} characters`);
    }

    const referenceParts = boundedReferenceParts(partList);
    const knownParts = referenceParts.length
      ? `Known inventory part numbers (reference only; never invent a match): ${referenceParts.join(", ")}`
      : "No inventory reference list was supplied.";
    const systemPrompt = `You are a document OCR assistant for VITROS Incoming Stock receiving. Read the attached PDF packing list or order packing list as a receiving document, not a DHR/checklist document.\n\n${knownParts}\n\nReturn ONLY a JSON array. Preserve each physical source line separately, including repeated occurrences of the same part number. For every actual inventory line return:\n{\n  "lineNo": number|null,\n  "partNumber": string,\n  "description": string,\n  "orderedQuantity": number|null,\n  "shippedQuantity": number|null,\n  "qty": number|null,\n  "poNumber": string|null,\n  "documentRef": string|null,\n  "page": string|null,\n  "confidence": number\n}\n\nRules:\n- Receiving quantity is SHIP QTY / SHIPPED QTY when the document shows both ordered and shipped columns. Put that value in shippedQuantity and also in qty. Do not substitute Ordered Qty for Ship Qty.\n- If the document has only one unambiguous receiving quantity column, put it in qty and leave shippedQuantity null.\n- Do not collapse repeated part lines. The review layer will aggregate only after a human sees every source line.\n- Part number identity comes only from the printed part/material number. Description is informational and must never be used to invent or fuzzy-match a different part number.\n- Read every page of the PDF; use the page field to preserve provenance.\n- Ignore page headers/footers, tracking numbers, container counts, and blank GTIN fields as inventory lines.\n- Do not treat line numbers, page numbers such as "Page 3 of 8", decimal weights such as 0.01/0.14/0.60, or other weight values as quantities.\n- Keep punctuation, suffixes, and digits in part numbers exactly as visible; do not remove meaningful internal characters.\n- Confidence must be 0 through 1. Use null for a field that is not actually visible instead of guessing.\n- Never return prose or markdown fences.`;

    return (await runZen(ctx, {actor,purpose:"pdf",system:systemPrompt,prompt,attachment:{pdf:pdfBase64,filename:safePdfFilename(filename)}})).text;
  },
});
