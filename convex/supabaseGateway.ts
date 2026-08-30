import { action, query } from "./_generated/server";
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

// ─── Inventory Queries (read-only, require inventory.read) ───

export const listStock = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.SUPABASE_URL;
    if (!serviceKey || !url) throw new Error("Server config missing");
    const res = await fetch(`${url}/rest/v1/stock?select=*&order=part_number.asc`, {
      headers: sbHeaders(serviceKey),
    });
    if (!res.ok) return [];
    return res.json();
  },
});

export const listAuditLog = query({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.read");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.SUPABASE_URL;
    if (!serviceKey || !url) throw new Error("Server config missing");
    const limit = args.limit || 500;
    const res = await fetch(
      `${url}/rest/v1/audit_log?select=*&order=created_at.desc&limit=${limit}`,
      { headers: sbHeaders(serviceKey) },
    );
    if (!res.ok) return [];
    return res.json();
  },
});

export const listSapStaging = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.SUPABASE_URL;
    if (!serviceKey || !url) throw new Error("Server config missing");
    const res = await fetch(
      `${url}/rest/v1/sap_staging?select=*&order=created_at.desc`,
      { headers: sbHeaders(serviceKey) },
    );
    if (!res.ok) return [];
    return res.json();
  },
});

export const listUsers = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.SUPABASE_URL;
    if (!serviceKey || !url) throw new Error("Server config missing");
    const res = await fetch(
      `${url}/rest/v1/users?select=*&order=display_name.asc`,
      { headers: sbHeaders(serviceKey) },
    );
    if (!res.ok) return [];
    return res.json();
  },
});

export const listSettings = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.SUPABASE_URL;
    if (!serviceKey || !url) throw new Error("Server config missing");
    const res = await fetch(`${url}/rest/v1/settings?select=*`, {
      headers: sbHeaders(serviceKey),
    });
    if (!res.ok) return [];
    return res.json();
  },
});

// ─── Inventory Mutations (require inventory.write) ───

export const updateStock = action({
  args: {
    id: v.string(),
    data: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const res = await fetch(`${url}/rest/v1/stock?id=eq.${args.id}`, {
      method: "PATCH",
      headers: { ...sbHeaders(serviceKey), Prefer: "return=minimal" },
      body: JSON.stringify(args.data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error((body as any).message || "Update failed");
    }
    return null;
  },
});

export const insertStock = action({
  args: { data: v.any() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch(serviceKey, url, "stock", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(args.data),
    });
  },
});

export const deleteStock = action({
  args: { id: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const res = await fetch(`${url}/rest/v1/stock?id=eq.${args.id}`, {
      method: "DELETE",
      headers: { ...sbHeaders(serviceKey), Prefer: "return=minimal" },
    });
    if (!res.ok) throw new Error("Delete failed");
    return null;
  },
});

export const insertAuditLog = action({
  args: { data: v.any() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch(serviceKey, url, "audit_log", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(args.data),
    });
  },
});

export const insertSapStaging = action({
  args: { data: v.any() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch(serviceKey, url, "sap_staging", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(args.data),
    });
  },
});

export const updateSapStaging = action({
  args: { id: v.string(), data: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const res = await fetch(`${url}/rest/v1/sap_staging?id=eq.${args.id}`, {
      method: "PATCH",
      headers: { ...sbHeaders(serviceKey), Prefer: "return=minimal" },
      body: JSON.stringify(args.data),
    });
    if (!res.ok) throw new Error("Update failed");
    return null;
  },
});

export const insertUser = action({
  args: { data: v.any() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch(serviceKey, url, "users", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(args.data),
    });
  },
});

export const updateUser = action({
  args: { id: v.string(), data: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const res = await fetch(`${url}/rest/v1/users?id=eq.${args.id}`, {
      method: "PATCH",
      headers: { ...sbHeaders(serviceKey), Prefer: "return=minimal" },
      body: JSON.stringify(args.data),
    });
    if (!res.ok) throw new Error("Update failed");
    return null;
  },
});

export const deleteUser = action({
  args: { id: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.admin");
    const { url, serviceKey } = getSupabaseConfig();
    const res = await fetch(`${url}/rest/v1/users?id=eq.${args.id}`, {
      method: "DELETE",
      headers: { ...sbHeaders(serviceKey), Prefer: "return=minimal" },
    });
    if (!res.ok) throw new Error("Delete failed");
    return null;
  },
});

// ─── DHR Scanner queries ───

export const listDhrSections = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.SUPABASE_URL;
    if (!serviceKey || !url) throw new Error("Server config missing");
    const res = await fetch(`${url}/rest/v1/dhr_checklist_sections?select=*`, {
      headers: sbHeaders(serviceKey),
    });
    if (!res.ok) return [];
    return res.json();
  },
});

export const listDhrExpectedParts = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.SUPABASE_URL;
    if (!serviceKey || !url) throw new Error("Server config missing");
    const res = await fetch(`${url}/rest/v1/dhr_expected_parts?select=*`, {
      headers: sbHeaders(serviceKey),
    });
    if (!res.ok) return [];
    return res.json();
  },
});

export const listDhrSessions = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.SUPABASE_URL;
    if (!serviceKey || !url) throw new Error("Server config missing");
    const res = await fetch(
      `${url}/rest/v1/dhr_scan_sessions?select=*&order=created_at.desc`,
      { headers: sbHeaders(serviceKey) },
    );
    if (!res.ok) return [];
    return res.json();
  },
});

export const listDhrEmployees = query({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.SUPABASE_URL;
    if (!serviceKey || !url) throw new Error("Server config missing");
    const res = await fetch(
      `${url}/rest/v1/convex_employees?select=*&active=eq.true&order=name`,
      { headers: sbHeaders(serviceKey) },
    );
    if (!res.ok) return [];
    return res.json();
  },
});

export const listDhrScanResults = query({
  args: { sessionId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.read");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.SUPABASE_URL;
    if (!serviceKey || !url) throw new Error("Server config missing");
    const res = await fetch(
      `${url}/rest/v1/dhr_scan_results?select=*&session_id=eq.${args.sessionId}&order=created_at.asc`,
      { headers: sbHeaders(serviceKey) },
    );
    if (!res.ok) return [];
    return res.json();
  },
});

// ─── DHR Scanner mutations ───

export const insertDhrSession = action({
  args: { data: v.any() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    return sbFetch(serviceKey, url, "dhr_scan_sessions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(args.data),
    });
  },
});

export const updateDhrSession = action({
  args: { id: v.string(), data: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const res = await fetch(`${url}/rest/v1/dhr_scan_sessions?id=eq.${args.id}`, {
      method: "PATCH",
      headers: { ...sbHeaders(serviceKey), Prefer: "return=minimal" },
      body: JSON.stringify(args.data),
    });
    if (!res.ok) throw new Error("Update failed");
    return null;
  },
});

export const deleteDhrSession = action({
  args: { sessionId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.admin");
    const { url, serviceKey } = getSupabaseConfig();
    // Delete scan results first
    await fetch(`${url}/rest/v1/dhr_scan_results?session_id=eq.${args.sessionId}`, {
      method: "DELETE",
      headers: { ...sbHeaders(serviceKey), Prefer: "return=minimal" },
    });
    // Delete session
    const res = await fetch(`${url}/rest/v1/dhr_scan_sessions?id=eq.${args.sessionId}`, {
      method: "DELETE",
      headers: { ...sbHeaders(serviceKey), Prefer: "return=minimal" },
    });
    if (!res.ok) throw new Error("Delete failed");
    return null;
  },
});

export const upsertDhrScanResult = action({
  args: { existingId: v.optional(v.string()), data: v.any() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    if (args.existingId) {
      const res = await fetch(`${url}/rest/v1/dhr_scan_results?id=eq.${args.existingId}`, {
        method: "PATCH",
        headers: { ...sbHeaders(serviceKey), Prefer: "return=representation" },
        body: JSON.stringify(args.data),
      });
      if (!res.ok) throw new Error("Update failed");
      const json = await res.json();
      return Array.isArray(json) ? json[0] : json;
    } else {
      return sbFetch(serviceKey, url, "dhr_scan_results", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(args.data),
      });
    }
  },
});

export const deleteDhrScanResult = action({
  args: { id: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const res = await fetch(`${url}/rest/v1/dhr_scan_results?id=eq.${args.id}`, {
      method: "DELETE",
      headers: { ...sbHeaders(serviceKey), Prefer: "return=minimal" },
    });
    if (!res.ok) throw new Error("Delete failed");
    return null;
  },
});

// ─── OCR Learnings ───

export const listOcrLearnings = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const url = process.env.SUPABASE_URL;
    if (!serviceKey || !url) throw new Error("Server config missing");
    const res = await fetch(
      `${url}/rest/v1/audit_log?action=eq.OCR_LEARNING&select=details&order=created_at.desc&limit=500`,
      { headers: sbHeaders(serviceKey) },
    );
    if (!res.ok) return [];
    return res.json();
  },
});

export const insertOcrLearning = action({
  args: { data: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const res = await fetch(`${url}/rest/v1/audit_log`, {
      method: "POST",
      headers: { ...sbHeaders(serviceKey), Prefer: "return=minimal" },
      body: JSON.stringify(args.data),
    });
    if (!res.ok) throw new Error("Insert failed");
    return null;
  },
});

// ─── Supabase Storage (for DHR image uploads) ───

export const uploadToStorage = action({
  args: {
    bucket: v.string(),
    filename: v.string(),
    contentType: v.string(),
    data: v.string(), // base64-encoded
  },
  returns: v.string(), // public URL
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();

    // Decode base64 to binary
    const binaryStr = atob(args.data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }

    const res = await fetch(`${url}/storage/v1/object/${args.bucket}/${args.filename}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": args.contentType,
        "x-upsert": "true",
      },
      body: bytes,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Upload failed ${res.status}: ${text}`);
    }
    return `${url}/storage/v1/object/public/${args.bucket}/${args.filename}`;
  },
});

export const deleteFromStorage = action({
  args: { bucket: v.string(), filename: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    await fetch(`${url}/storage/v1/object/${args.bucket}/${args.filename}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
    });
    return null;
  },
});
