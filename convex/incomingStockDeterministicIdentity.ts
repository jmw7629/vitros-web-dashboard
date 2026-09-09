// Deterministic identity logic for Incoming Stock receipt lines.
// Pure functions with no side effects - imported by both production actions and test harnesses.

export const MAX_SOURCE_PAGE_CHARS = 50;
export const MAX_DOCUMENT_REF_CHARS = 200;

export function canonicalPartNumber(value: string): string {
  return value.trim().toUpperCase();
}

export function normalizeDocumentRef(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

export function normalizeSourcePage(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ").slice(0, MAX_SOURCE_PAGE_CHARS);
}

export function canonicalReceiptLineIdentity(args: {
  documentRef: string;
  sourcePage: string | null | undefined;
  sourceLineNo: number;
}): string {
  const doc = normalizeDocumentRef(args.documentRef);
  const page = args.sourcePage ? normalizeSourcePage(args.sourcePage) : "PAGE_UNKNOWN";
  const line = Number.isInteger(args.sourceLineNo) && args.sourceLineNo > 0 ? args.sourceLineNo : 0;
  return `incoming:${doc}|${page}|${line}`;
}