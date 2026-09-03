export type BrowserSafeDataset = "stock" | "audit" | "sap" | "settings";

function getBrowserSafeReadUrl(): string {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").trim().replace(/\/$/, "");
  if (!supabaseUrl) {
    throw new Error("Browser data service is not configured");
  }
  return `${supabaseUrl}/functions/v1/browser-safe-read`;
}

export async function browserSafeRead<T>(dataset: BrowserSafeDataset): Promise<T[]> {
  const url = new URL(getBrowserSafeReadUrl());
  url.searchParams.set("dataset", dataset);

  const response = await fetch(url.toString(), {
    method: "GET",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Browser data service unavailable (${response.status})`);
  }

  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new Error("Browser data service returned an invalid response");
  }

  return body as T[];
}
