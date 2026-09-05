export type BrowserSafeDataset = "stock" | "audit" | "sap" | "settings" | "rem_summary";

/**
 * Legacy compatibility hook. Inventory/REM/SAP reads are server-authoritative and
 * must flow through authenticated Convex actions. The former unauthenticated
 * Supabase Edge fallback is intentionally retired rather than silently exposing
 * operational data when the authenticated server boundary is unavailable. A
 * deny-all staging endpoint is exercised by CI to prevent regression.
 */
export async function browserSafeRead<T>(_dataset: BrowserSafeDataset): Promise<T[]> {
  throw new Error("Authenticated server data is unavailable");
}
