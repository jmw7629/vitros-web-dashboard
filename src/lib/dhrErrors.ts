import { DHR_ERROR_MESSAGES, type DhrErrorCode } from "../../convex/dhrErrorContract";

/** Convex preserves structured application error data even when message is redacted. */
export function safeDhrError(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data: unknown = error.data;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const { kind, code } = data as { kind?: unknown; code?: unknown };
      if (kind === "dhr" && typeof code === "string" && Object.prototype.hasOwnProperty.call(DHR_ERROR_MESSAGES, code)) {
        return DHR_ERROR_MESSAGES[code as DhrErrorCode];
      }
    }
  }
  return DHR_ERROR_MESSAGES.OPERATION_UNCONFIRMED;
}
