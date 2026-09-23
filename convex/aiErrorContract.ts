/** Public AI/OCR errors. Never include provider response bodies, credentials, or request data. */
export const AI_ERROR_MESSAGES = {
  ZEN_NOT_CONFIGURED: "AI OCR is unavailable because OpenCode Zen is not configured on the server. Ask an administrator to configure the Zen connection.",
  MODEL_CATALOG_UNAVAILABLE: "AI OCR cannot load the approved free-model catalog. Try again later or ask an administrator to refresh AI models.",
  AI_PAUSED: "AI OCR is disabled in AI Administration. Ask a superuser to enable the required AI feature.",
  MODEL_UNAVAILABLE: "The configured free OCR model is unavailable. Ask a superuser to refresh the free models and select a supported model.",
  RATE_LIMIT: "Free OCR is rate limited or its dashboard usage limit was reached. Try again later.",
  FREE_ACCESS_UNAVAILABLE: "Free OCR access is unavailable. No paid fallback was used.",
  PROVIDER_ACCESS_REJECTED: "The free OCR provider rejected server access. Ask an administrator to check the OpenCode Zen connection.",
  PROVIDER_RESTRICTED: "The selected free OCR model is restricted to supported OpenCode clients. Ask an administrator to select another free OCR model.",
  TIMEOUT: "OCR timed out. Try a smaller or clearer document, or try again later.",
  UNSUPPORTED_INPUT: "The selected free OCR model does not support this document type.",
  OUTPUT_LIMIT: "OCR output reached the free model limit. Split the document into smaller pages and try again.",
  PROVIDER_UNAVAILABLE: "OCR could not be completed by the free AI provider. No inventory changes were made.",
} as const;

export type AiErrorCode = keyof typeof AI_ERROR_MESSAGES;

type TaggedError = { code?: unknown; message?: unknown };
const ZEN_CODE_MAP: Record<string, AiErrorCode> = {
  provider_rate_limit: "RATE_LIMIT",
  free_access_exhausted: "FREE_ACCESS_UNAVAILABLE",
  provider_auth: "PROVIDER_ACCESS_REJECTED",
  provider_restricted: "PROVIDER_RESTRICTED",
  timeout: "TIMEOUT",
  unsupported_input: "UNSUPPORTED_INPUT",
  output_limit: "OUTPUT_LIMIT",
  invalid_response: "PROVIDER_UNAVAILABLE",
  provider_error: "PROVIDER_UNAVAILABLE",
  request_failed: "PROVIDER_UNAVAILABLE",
};

/** Map only internal, bounded error categories to the public browser contract. */
export function aiPublicErrorCode(error: unknown): AiErrorCode {
  const tagged = error && typeof error === "object" ? error as TaggedError : null;
  if (tagged && typeof tagged.code === "string" && ZEN_CODE_MAP[tagged.code]) return ZEN_CODE_MAP[tagged.code];
  const message = error instanceof Error ? error.message : "";
  if (message === "OpenCode Zen key is not configured. Add OPENCODE_ZEN_API_KEY in the server environment.") return "ZEN_NOT_CONFIGURED";
  if (/^(?:Free-model catalog|Could not refresh free models|No supported free Zen models)/.test(message)) return "MODEL_CATALOG_UNAVAILABLE";
  if (message === "Dashboard AI is paused by Superuser." || message === "This AI feature is disabled by Superuser.") return "AI_PAUSED";
  if (message.startsWith("Selected model is not currently free or does not support ")) return "MODEL_UNAVAILABLE";
  if (message.startsWith("Dashboard AI minute limit reached") || message.startsWith("Dashboard AI daily limit reached")) return "RATE_LIMIT";
  return "PROVIDER_UNAVAILABLE";
}
