// Server-side Supabase data gateway.
// All reads/writes go through Convex actions with server-side credentials.
// Queries use ctx.runQuery for auth; actions fetch from Supabase directly.
// All external fetch MUST be in action handlers (never queries/mutations).
import { action, query, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set server-side");
  }
  return { url, serviceKey };
}

function sbHeaders(serviceKey: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

async function sbFetch<T>(
  serviceKey: string,
  url: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...sbHeaders(serviceKey),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = (body as any).message || (body as any).error || `Supabase error ${res.status}`;
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

// ─── READ QUERIES (require inventory.read) ───
// These are Convex queries that require auth but do NOT call external APIs.
// They delegate to actions via ctx.runQuery or runAction for actual data.

export const getReadConfig = internalQuery({
  args: {},
  handler: async () => {
    return {
      hasSupabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    };
  },
});

export const listStock = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "stock?select=*&order=part_number.asc");
  },
});

export const listAuditLog = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "audit_log?select=*&order=created_at.desc&limit=500");
  },
});

export const listSapStaging = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "sap_staging?select=*&order=created_at.desc");
  },
});

export const listUsers = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "users?select=*&order=display_name.asc");
  },
});

export const listSettings = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "settings?select=*");
  },
});

export const listDhrSections = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "dhr_sections?select=*");
  },
});

export const listDhrExpectedParts = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "dhr_expected_parts?select=*");
  },
});

export const listDhrSessions = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "dhr_sessions?select=*&order=created_at.desc");
  },
});

export const listDhrScanResults = action({
  args: { sessionId: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { sessionId }) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    const params = sessionId
      ? `session_id=eq.${sessionId}&select=*`
      : "select=*&order=created_at.desc";
    return sbFetch<any[]>(serviceKey, url, `dhr_scan_results?${params}`);
  },
});

export const listOcrLearnings = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "audit_log?action=eq.OCR_LEARNING&select=*&order=created_at.desc&limit=100");
  },
});

// ─── WRITE MUTATIONS (require inventory.write or inventory.admin) ───

export const updateStock = action({
  args: {
    id: v.string(),
    data: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, { id, data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<any>(serviceKey, url, `stock?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(data),
    });
    return { success: true };
  },
});

export const insertStock = action({
  args: { data: v.any() },
  returns: v.any(),
  handler: async (ctx, { data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const json = await sbFetch<any>(serviceKey, url, "stock", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    return Array.isArray(json) ? json[0] : json;
  },
});

export const deleteStock = action({
  args: { id: v.string() },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await requireCapability(ctx, "inventory.admin");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<any>(serviceKey, url, `stock?id=eq.${id}`, {
      method: "DELETE",
    });
    return { success: true };
  },
});

export const insertAuditLog = action({
  args: { data: v.any() },
  returns: v.any(),
  handler: async (ctx, { data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const json = await sbFetch<any>(serviceKey, url, "audit_log", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    return Array.isArray(json) ? json[0] : json;
  },
});

export const insertSapStaging = action({
  args: { data: v.any() },
  returns: v.any(),
  handler: async (ctx, { data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const json = await sbFetch<any>(serviceKey, url, "sap_staging", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    return Array.isArray(json) ? json[0] : json;
  },
});

export const updateSapStaging = action({
  args: { id: v.string(), data: v.any() },
  returns: v.any(),
  handler: async (ctx, { id, data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<any>(serviceKey, url, `sap_staging?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(data),
    });
    return { success: true };
  },
});

export const insertUser = action({
  args: { data: v.any() },
  returns: v.any(),
  handler: async (ctx, { data }) => {
    await requireCapability(ctx, "inventory.admin");
    const { url, serviceKey } = getSupabaseConfig();
    const json = await sbFetch<any>(serviceKey, url, "users", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    return Array.isArray(json) ? json[0] : json;
  },
});

export const updateUser = action({
  args: { id: v.string(), data: v.any() },
  returns: v.any(),
  handler: async (ctx, { id, data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<any>(serviceKey, url, `users?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(data),
    });
    return { success: true };
  },
});

export const deleteUser = action({
  args: { id: v.string() },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await requireCapability(ctx, "inventory.admin");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<any>(serviceKey, url, `users?id=eq.${id}`, {
      method: "DELETE",
    });
    return { success: true };
  },
});

export const insertDhrSession = action({
  args: { data: v.any() },
  returns: v.any(),
  handler: async (ctx, { data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const json = await sbFetch<any>(serviceKey, url, "dhr_sessions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    return Array.isArray(json) ? json[0] : json;
  },
});

export const updateDhrSession = action({
  args: { id: v.string(), data: v.any() },
  returns: v.any(),
  handler: async (ctx, { id, data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<any>(serviceKey, url, `dhr_sessions?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(data),
    });
    return { success: true };
  },
});

export const deleteDhrSession = action({
  args: { id: v.string() },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await requireCapability(ctx, "inventory.admin");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<any>(serviceKey, url, `dhr_sessions?id=eq.${id}`, {
      method: "DELETE",
    });
    return { success: true };
  },
});

export const deleteDhrSessionWithResults = action({
  args: { sessionId: v.string() },
  returns: v.any(),
  handler: async (ctx, { sessionId }) => {
    await requireCapability(ctx, "inventory.admin");
    const { url, serviceKey } = getSupabaseConfig();
    // Delete scan results first
    await sbFetch<any>(serviceKey, url, `dhr_scan_results?session_id=eq.${sessionId}`, {
      method: "DELETE",
    });
    // Delete session
    await sbFetch<any>(serviceKey, url, `dhr_scan_sessions?id=eq.${sessionId}`, {
      method: "DELETE",
    });
    return { success: true };
  },
});

export const upsertDhrScanResult = action({
  args: { id: v.optional(v.string()), data: v.any() },
  returns: v.any(),
  handler: async (ctx, { id, data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    if (id) {
      await sbFetch<any>(serviceKey, url, `dhr_scan_results?id=eq.${id}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(data),
      });
      return { success: true, id };
    }
    const json = await sbFetch<any>(serviceKey, url, "dhr_scan_results", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    return { success: true, id: (Array.isArray(json) ? json[0] : json)?.id };
  },
});

export const deleteDhrScanResult = action({
  args: { id: v.string() },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<any>(serviceKey, url, `dhr_scan_results?id=eq.${id}`, {
      method: "DELETE",
    });
    return { success: true };
  },
});

export const insertOcrLearning = action({
  args: { data: v.any() },
  returns: v.any(),
  handler: async (ctx, { data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const json = await sbFetch<any>(serviceKey, url, "audit_log", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(data),
    });
    return Array.isArray(json) ? json[0] : json;
  },
});

export const uploadToStorage = action({
  args: {
    bucket: v.string(),
    path: v.string(),
    data: v.string(), // base64
    contentType: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, { bucket, path, data, contentType }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const binary = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": contentType,
      },
      body: binary,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any).message || `Storage upload failed: ${res.status}`);
    }
    return { success: true, path };
  },
});

export const deleteFromStorage = action({
  args: { bucket: v.string(), paths: v.array(v.string()) },
  returns: v.any(),
  handler: async (ctx, { bucket, paths }) => {
    await requireCapability(ctx, "inventory.admin");
    const { url, serviceKey } = getSupabaseConfig();
    const res = await fetch(`${url}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(paths),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any).message || `Storage delete failed: ${res.status}`);
    }
    return { success: true };
  },
});
