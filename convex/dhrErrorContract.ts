/** Public DHR error vocabulary. Never include provider messages or row values. */
export const DHR_ERROR_MESSAGES = {
  REVISION_CONFLICT: "This DHR changed on another device. Refresh and review the current values before submitting another change.",
  PART_NOT_FOUND: "The inventory part is missing from Stock Summary. This change was rejected; ask an administrator to check the part mapping.",
  AMBIGUOUS_PART: "The part mapping is ambiguous. This change was rejected; ask an administrator to review the inventory master.",
  INSUFFICIENT_STOCK: "There is not enough available stock for this DHR quantity. Review Stock Summary before trying again.",
  SESSION_CLOSED: "This DHR is not open for inventory changes. Refresh and review its current status.",
  IDEMPOTENCY_CONFLICT: "This request conflicts with a previous DHR operation. Refresh and review the current values before submitting another change.",
  LEGACY_RECONCILIATION_REQUIRED: "This legacy DHR requires administrator inventory reconciliation before it can be changed.",
  OPERATION_UNCONFIRMED: "The DHR operation could not be confirmed. Refresh and review the current values before trying again.",
} as const;

export type DhrErrorCode = keyof typeof DHR_ERROR_MESSAGES;

/** Match the bounded, known SQL business errors, not arbitrary diagnostic text. */
export function dhrProviderErrorCode(payload: unknown): DhrErrorCode {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "OPERATION_UNCONFIRMED";
  const { code, message } = payload as { code?: unknown; message?: unknown };
  if (typeof message !== "string" || message.length > 600) return "OPERATION_UNCONFIRMED";
  if ((code === "P0001" || code === "40001") && /^DHR (?:session )?revision conflict: expected \d+, current \d+$/.test(message)) return "REVISION_CONFLICT";
  if (code === "23505" && message === "DHR lifecycle correlation id reused with different intent") return "IDEMPOTENCY_CONFLICT";
  if (code !== "P0001") return "OPERATION_UNCONFIRMED";
  if (/^(?:Part not found: |Inventory part not found for controlled DHR part: )[^\r\n]{1,120}$/.test(message)) return "PART_NOT_FOUND";
  if (/^(?:Ambiguous canonical stock part: |Ambiguous canonical DHR result for part |Ambiguous inventory part for controlled DHR part: )[^\r\n]{1,120}$/.test(message)) return "AMBIGUOUS_PART";
  if (/^Insufficient stock: requested \d+, available \d+$/.test(message)) return "INSUFFICIENT_STOCK";
  if (message === "DHR session is not open for inventory consumption") return "SESSION_CLOSED";
  if (message === "correlationId already used for a different DHR event") return "IDEMPOTENCY_CONFLICT";
  if (message === "Legacy DHR result requires inventory reconciliation before scanner mutation") return "LEGACY_RECONCILIATION_REQUIRED";
  return "OPERATION_UNCONFIRMED";
}
