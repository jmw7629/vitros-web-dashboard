// Server-side Supabase data gateway.
// All external fetches execute in Convex actions and use server-only credentials.
import { action, internalQuery } from "./_generated/server";
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

async function sbFetch<T>(serviceKey: string, url: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...sbHeaders(serviceKey), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    // Never surface PostgREST/provider-controlled bodies to a browser caller. Those
    // bodies can contain schema, constraint, policy, SQL, or internal diagnostic
    // details. Keep the HTTP status for server-side triage only.
    throw new Error(`Supabase request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function idPath(table: string, id: string) {
  return `${table}?id=eq.${encodeURIComponent(id)}`;
}

export const getReadConfig = internalQuery({
  args: {},
  handler: async () => ({
    hasSupabase: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
  }),
});

export const listStock = action({
  args: {}, returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "stock?select=*&order=part_number.asc");
  },
});

export const listAuditLog = action({
  args: {}, returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "audit_log?select=*&order=created_at.desc&limit=500");
  },
});

export const listSapStaging = action({
  args: {}, returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "sap_staging?select=*&order=created_at.desc");
  },
});

export const listUsers = action({
  args: {}, returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "users?select=id,username,display_name,role,is_active,last_login,created_at,updated_at&order=display_name.asc");
  },
});

export const listSettings = action({
  args: {}, returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "settings?select=key,value,updated_at&order=key.asc");
  },
});

export const listDhrSections = action({
  args: {}, returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "dhr_checklist_sections?select=*");
  },
});

export const listDhrExpectedParts = action({
  args: {}, returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "dhr_expected_parts?select=*");
  },
});

export const listDhrSessions = action({
  args: {}, returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "dhr_scan_sessions?select=*&order=created_at.desc");
  },
});

export const listDhrScanResults = action({
  args: { sessionId: v.optional(v.string()) }, returns: v.any(),
  handler: async (ctx, { sessionId }) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    const params = sessionId
      ? `session_id=eq.${encodeURIComponent(sessionId)}&select=*`
      : "select=*&order=created_at.desc";
    return sbFetch<any[]>(serviceKey, url, `dhr_scan_results?${params}`);
  },
});

export const listOcrLearnings = action({
  args: {}, returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch<any[]>(serviceKey, url, "audit_log?action=eq.OCR_LEARNING&select=*&order=created_at.desc&limit=100");
  },
});

// Compatibility action for metadata-only stock edits. Quantity is explicitly blocked.
export const updateStock = action({
  args: { id: v.string(), data: v.any() }, returns: v.any(),
  handler: async (ctx, { id, data }) => {
    await requireCapability(ctx, "inventory.write");
    const input = (data ?? {}) as Record<string, unknown>;
    const forbidden = ["qty_on_hand", "id", "created_at"];
    if (forbidden.some((key) => key in input)) {
      throw new Error("Direct quantity/identity changes are not permitted; use inventoryActions");
    }
    const allowed = new Set(["part_number","description","type","min_qty","max_qty","on_plan","bin_location","module","unit_cost","status","last_activity","updated_at"]);
    const safe = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.has(key)));
    if (!Object.keys(safe).length) throw new Error("No permitted stock fields supplied");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<void>(serviceKey, url, idPath("stock", id), {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(safe),
    });
    return { success: true };
  },
});

export const insertStock = action({
  args: { data: v.any() }, returns: v.any(),
  handler: async (ctx, { data }) => {
    await requireCapability(ctx, "inventory.admin");
    const input = (data ?? {}) as Record<string, unknown>;
    const qoh = Number(input.qty_on_hand ?? 0);
    if (!Number.isFinite(qoh) || qoh < 0) throw new Error("Invalid starting quantity");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<any[]>(serviceKey, url, "stock", {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(input),
    });
    return rows[0];
  },
});

export const deleteStock = action({
  args: { id: v.string() }, returns: v.any(),
  handler: async (ctx, { id }) => {
    await requireCapability(ctx, "inventory.admin");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<void>(serviceKey, url, idPath("stock", id), { method: "DELETE" });
    return { success: true };
  },
});

export const insertAuditLog = action({
  args: { data: v.any() }, returns: v.any(),
  handler: async (ctx, { data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<any[]>(serviceKey, url, "audit_log", {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(data),
    });
    return rows[0];
  },
});

export const insertSapStaging = action({
  args: { data: v.any() }, returns: v.any(),
  handler: async (ctx, { data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<any[]>(serviceKey, url, "sap_staging", {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(data),
    });
    return rows[0];
  },
});

export const updateSapStaging = action({
  args: { id: v.string(), data: v.any() }, returns: v.any(),
  handler: async (ctx, { id, data }) => {
    await requireCapability(ctx, "inventory.write");
    const input = (data ?? {}) as Record<string, unknown>;
    const allowed = new Set(["export_status","exported_at","exported_by","error_message"]);
    const safe = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.has(key)));
    if (!Object.keys(safe).length) throw new Error("No permitted SAP fields supplied");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<void>(serviceKey, url, idPath("sap_staging", id), {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(safe),
    });
    return { success: true };
  },
});

export const insertUser = action({
  args: { data: v.any() }, returns: v.any(),
  handler: async (ctx, { data }) => {
    await requireCapability(ctx, "inventory.admin");
    const input = (data ?? {}) as Record<string, unknown>;
    const role = input.role ?? "viewer";
    if (!new Set(["superuser","engineer","viewer"]).has(String(role))) throw new Error("Invalid role");
    const safe = {
      username: String(input.username ?? "").trim(),
      display_name: String(input.display_name ?? "").trim(),
      role,
      is_active: input.is_active !== false,
    };
    if (!safe.username || !safe.display_name) throw new Error("username and display_name are required");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<any[]>(serviceKey, url, "users", {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(safe),
    });
    return rows[0];
  },
});

export const updateUser = action({
  args: { id: v.string(), data: v.any() }, returns: v.any(),
  handler: async (ctx, { id, data }) => {
    await requireCapability(ctx, "inventory.admin");
    const input = (data ?? {}) as Record<string, unknown>;
    if (input.role !== undefined && !new Set(["superuser","engineer","viewer"]).has(String(input.role))) {
      throw new Error("Invalid role");
    }
    const allowed = new Set(["username","display_name","role","is_active"]);
    const safe = Object.fromEntries(Object.entries(input).filter(([key]) => allowed.has(key)));
    if (!Object.keys(safe).length) throw new Error("No permitted user fields supplied");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<void>(serviceKey, url, idPath("users", id), {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(safe),
    });
    return { success: true };
  },
});

export const deleteUser = action({
  args: { id: v.string() }, returns: v.any(),
  handler: async (ctx, { id }) => {
    await requireCapability(ctx, "inventory.admin");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<void>(serviceKey, url, idPath("users", id), { method: "DELETE" });
    return { success: true };
  },
});

export const insertDhrSession = action({
  args: { data: v.any() }, returns: v.any(),
  handler: async (ctx, { data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<any[]>(serviceKey, url, "dhr_scan_sessions", {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(data),
    });
    return rows[0];
  },
});

export const updateDhrSession = action({
  args: { id: v.string(), data: v.any() }, returns: v.any(),
  handler: async (ctx, { id, data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<void>(serviceKey, url, idPath("dhr_scan_sessions", id), {
      method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(data),
    });
    return { success: true };
  },
});

export const deleteDhrSession = action({
  args: { id: v.string() }, returns: v.any(),
  handler: async (ctx, { id }) => {
    await requireCapability(ctx, "inventory.admin");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<void>(serviceKey, url, idPath("dhr_scan_sessions", id), { method: "DELETE" });
    return { success: true };
  },
});

export const deleteDhrSessionWithResults = action({
  args: { sessionId: v.string() }, returns: v.any(),
  handler: async (ctx, { sessionId }) => {
    await requireCapability(ctx, "inventory.admin");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<void>(serviceKey, url, `dhr_scan_results?session_id=eq.${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    await sbFetch<void>(serviceKey, url, idPath("dhr_scan_sessions", sessionId), { method: "DELETE" });
    return { success: true };
  },
});

export const upsertDhrScanResult = action({
  args: { id: v.optional(v.string()), data: v.any() }, returns: v.any(),
  handler: async (ctx, { id, data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    if (id) {
      await sbFetch<void>(serviceKey, url, idPath("dhr_scan_results", id), {
        method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(data),
      });
      return { success: true, id };
    }
    const rows = await sbFetch<any[]>(serviceKey, url, "dhr_scan_results", {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(data),
    });
    return { success: true, id: rows[0]?.id };
  },
});

export const deleteDhrScanResult = action({
  args: { id: v.string() }, returns: v.any(),
  handler: async (ctx, { id }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<void>(serviceKey, url, idPath("dhr_scan_results", id), { method: "DELETE" });
    return { success: true };
  },
});

export const insertOcrLearning = action({
  args: { data: v.any() }, returns: v.any(),
  handler: async (ctx, { data }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<any[]>(serviceKey, url, "audit_log", {
      method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(data),
    });
    return rows[0];
  },
});

export const uploadToStorage = action({
  args: { bucket: v.string(), path: v.string(), data: v.string(), contentType: v.string() },
  returns: v.any(),
  handler: async (ctx, { bucket, path, data, contentType }) => {
    await requireCapability(ctx, "inventory.write");
    if (!new Set(["dhr-scans"]).has(bucket)) throw new Error("Unsupported storage bucket");
    if (data.length > 14_000_000) throw new Error("Upload too large");
    const { url, serviceKey } = getSupabaseConfig();
    const binary = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": contentType },
      body: binary,
    });
    if (!res.ok) {
      throw new Error(`Storage upload failed (${res.status})`);
    }
    return { success: true, path };
  },
});

export const deleteFromStorage = action({
  args: { bucket: v.string(), paths: v.array(v.string()) }, returns: v.any(),
  handler: async (ctx, { bucket, paths }) => {
    await requireCapability(ctx, "inventory.admin");
    if (!new Set(["dhr-scans"]).has(bucket)) throw new Error("Unsupported storage bucket");
    const { url, serviceKey } = getSupabaseConfig();
    const res = await fetch(`${url}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(paths),
    });
    if (!res.ok) {
      throw new Error(`Storage delete failed (${res.status})`);
    }
    return { success: true };
  },
});
