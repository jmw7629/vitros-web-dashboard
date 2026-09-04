// Server-authoritative DHR scanner boundaries.
// Browser callers never receive Supabase privileged credentials and cannot call
// service-role-only database RPCs or base-table reads directly.
import { internal } from "./_generated/api";
import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";

declare const process: { env: Record<string, string | undefined> };

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase config missing");
  return { url: url.replace(/\/$/, ""), serviceKey };
}

function supabaseHeaders(serviceKey: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

async function readSupabaseRows<T>(
  serviceKey: string,
  url: string,
  path: string,
): Promise<T[]> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method: "GET",
    headers: supabaseHeaders(serviceKey),
  });
  if (!response.ok) throw new Error(`DHR read failed (${response.status})`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("DHR read returned invalid payload");
  return payload as T[];
}

async function writeSupabaseRows<T>(
  serviceKey: string,
  url: string,
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
): Promise<T[]> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { ...supabaseHeaders(serviceKey), Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = (payload as { message?: string; error?: string }).message
      || (payload as { message?: string; error?: string }).error
      || `DHR write failed (${response.status})`;
    throw new Error(message);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("DHR write returned invalid payload");
  return payload as T[];
}

async function callAtomicDhrRpc(
  serviceKey: string,
  url: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${url}/rest/v1/rpc/apply_dhr_scan_transition`, {
    method: "POST",
    headers: supabaseHeaders(serviceKey),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = (payload as { message?: string; error?: string }).message
      || (payload as { message?: string; error?: string }).error
      || `DHR transition failed (${response.status})`;
    throw new Error(message);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

async function callDhrLifecycleRpc(
  serviceKey: string,
  url: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${url}/rest/v1/rpc/apply_dhr_session_lifecycle`, {
    method: "POST",
    headers: supabaseHeaders(serviceKey),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = (payload as { message?: string; error?: string }).message
      || (payload as { message?: string; error?: string }).error
      || `DHR lifecycle transition failed (${response.status})`;
    throw new Error(message);
  }
  return response.json() as Promise<Record<string, unknown>>;
}

async function resolveAuditActor(
  ctx: ActionCtx,
  userId: Id<"users">,
  serviceKey: string,
  url: string,
): Promise<string> {
  const profile = await ctx.runQuery(internal.users.getUserAuditIdentity, { userId });
  if (profile.role === "superuser") return profile.name || "Superuser";
  if (profile.role !== "engineer" || !profile.employeeId) {
    throw new Error("Authenticated DHR operator identity is unavailable");
  }
  const employeeId = validateUuid(profile.employeeId, "employee identity");
  const rows = await readSupabaseRows<{ id?: string; name?: string; initials?: string; active?: boolean }>(
    serviceKey,
    url,
    `convex_employees?select=id,name,initials,active&id=eq.${encodeURIComponent(employeeId)}&active=is.true&limit=2`,
  );
  if (rows.length !== 1 || !rows[0].name?.trim() || !rows[0].initials?.trim()) {
    throw new Error("Authenticated DHR employee identity is missing or inactive");
  }
  const initials = rows[0].initials!.trim().toUpperCase();
  return `${rows[0].name!.trim()} (${initials})`;
}

function validateUuid(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)) {
    throw new Error(`Invalid ${label}`);
  }
  return normalized;
}

/**
 * Authenticated bootstrap for the DHR Scanner. The browser previously queried
 * RLS-protected Supabase base tables with the anon key; those tables intentionally
 * have no anonymous policies. Keep the read on the same server-authoritative
 * boundary as DHR writes and expose only the fields the scanner actually uses.
 */
export const loadScannerData = action({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();

    const [sections, expectedParts, sessions, employees] = await Promise.all([
      readSupabaseRows<Record<string, unknown>>(
        serviceKey,
        url,
        "dhr_checklist_sections?select=id,analyzer_model,section_id,section_name,section_type,has_parts,page_number,notes&order=analyzer_model.asc,section_id.asc&limit=2000",
      ),
      readSupabaseRows<Record<string, unknown>>(
        serviceKey,
        url,
        "dhr_expected_parts?select=id,analyzer_model,section_id,part_number,description,bom_qty,category,notes,sort_order&order=analyzer_model.asc,section_id.asc,sort_order.asc&limit=5000",
      ),
      readSupabaseRows<Record<string, unknown>>(
        serviceKey,
        url,
        "dhr_scan_sessions?select=id,instrument_sn,wo_number,analyzer_model,started_at,completed_at,status,started_by,notes,revision&order=created_at.desc&limit=250",
      ),
      readSupabaseRows<Record<string, unknown>>(
        serviceKey,
        url,
        "convex_employees?select=id,name,initials,active&active=is.true&order=name.asc&limit=500",
      ),
    ]);

    return { sections, expectedParts, sessions, employees };
  },
});

/** Load one DHR's current authoritative result state, including optimistic revision. */
export const loadSessionResults = action({
  args: { sessionId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.read");
    const sessionId = validateUuid(args.sessionId, "DHR session id");

    const { url, serviceKey } = getSupabaseConfig();
    return readSupabaseRows<Record<string, unknown>>(
      serviceKey,
      url,
      `dhr_scan_results?select=id,session_id,section_id,part_number,description,expected_qty,scanned_qty,category,status,stock_before,stock_after,stock_id,scanned_at,scanned_by,notes,revision&session_id=eq.${encodeURIComponent(sessionId)}&order=created_at.asc&limit=5000`,
    );
  },
});

/** Create a DHR session with server-resolved operator identity and bounded fields. */
export const createScannerSession = action({
  args: {
    instrumentSn: v.string(),
    woNumber: v.optional(v.string()),
    analyzerModel: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "inventory.write");
    const instrumentSn = args.instrumentSn.trim().toUpperCase();
    const woNumber = args.woNumber?.trim() || null;
    const analyzerModel = args.analyzerModel.trim();
    if (!instrumentSn || instrumentSn.length > 80) throw new Error("Instrument serial is required");
    if (woNumber && woNumber.length > 80) throw new Error("Work order is too long");
    if (!/^[A-Za-z0-9._ -]{1,40}$/.test(analyzerModel)) throw new Error("Invalid analyzer model");

    const { url, serviceKey } = getSupabaseConfig();
    const knownModel = await readSupabaseRows<{ analyzer_model: string }>(
      serviceKey,
      url,
      `dhr_checklist_sections?select=analyzer_model&analyzer_model=eq.${encodeURIComponent(analyzerModel)}&limit=1`,
    );
    if (knownModel.length !== 1) throw new Error("Analyzer model has no configured DHR checklist");
    const actor = await resolveAuditActor(ctx, userId, serviceKey, url);

    const rows = await writeSupabaseRows<Record<string, unknown>>(
      serviceKey,
      url,
      "dhr_scan_sessions",
      "POST",
      {
        instrument_sn: instrumentSn,
        wo_number: woNumber,
        analyzer_model: analyzerModel,
        status: "in_progress",
        started_by: actor,
      },
    );
    if (rows.length !== 1) throw new Error("DHR session creation returned an unexpected result");
    return rows[0];
  },
});

/**
 * Finalize or reopen a DHR session through an immutable, revision-checked lifecycle
 * event. This path never moves inventory; quantity changes remain in applyScanTransition.
 */
export const setScannerSessionLifecycle = action({
  args: {
    sessionId: v.string(),
    status: v.union(v.literal("in_progress"), v.literal("completed")),
    expectedRevision: v.number(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "inventory.write");
    const sessionId = validateUuid(args.sessionId, "DHR session id");
    if (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 0) {
      throw new Error("DHR session revision must be a non-negative integer");
    }
    const { url, serviceKey } = getSupabaseConfig();
    const actor = await resolveAuditActor(ctx, userId, serviceKey, url);

    // Correlation is derived from the browser-observed revision, not a fresh server
    // read. If the response is lost, a retry carries the same revision and returns
    // the original immutable event. A genuinely stale browser instead receives the
    // RPC revision conflict and must reload before changing lifecycle state.
    const correlationId = `dhr-lifecycle:${sessionId}:${args.expectedRevision}:${args.status}`;
    return callDhrLifecycleRpc(serviceKey, url, {
      p_session_id: sessionId,
      p_target_status: args.status,
      p_actor: actor,
      p_correlation_id: correlationId,
      p_expected_revision: args.expectedRevision,
    });
  },
});

export const applyScanTransition = action({
  args: {
    sessionId: v.string(),
    sectionId: v.string(),
    partNumber: v.string(),
    expectedQty: v.number(),
    newQty: v.number(),
    category: v.string(),
    description: v.string(),
    correlationId: v.string(),
    expectedRevision: v.number(),
    analyzerSerial: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "inventory.write");

    const sessionId = validateUuid(args.sessionId, "DHR session id");
    if (!args.sectionId.trim() || args.sectionId.length > 80) throw new Error("sectionId is required");
    if (!args.partNumber.trim() || args.partNumber.length > 120) throw new Error("partNumber is required");
    if (!args.category.trim() || args.category.length > 40) throw new Error("category is required");
    if (!args.correlationId.trim() || args.correlationId.length > 400) throw new Error("correlationId is required");
    if (args.description.length > 1000) throw new Error("description is too long");
    if (!Number.isInteger(args.expectedQty) || args.expectedQty < 0) {
      throw new Error("expectedQty must be a non-negative integer");
    }
    if (!Number.isInteger(args.newQty) || args.newQty < 0) {
      throw new Error("newQty must be a non-negative integer");
    }
    if (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 0) {
      throw new Error("expectedRevision must be a non-negative integer");
    }

    const { url, serviceKey } = getSupabaseConfig();
    const actor = await resolveAuditActor(ctx, userId, serviceKey, url);
    return callAtomicDhrRpc(serviceKey, url, {
      p_session_id: sessionId,
      p_section_id: args.sectionId.trim(),
      p_part_number: args.partNumber.trim(),
      p_expected_qty: args.expectedQty,
      p_new_qty: args.newQty,
      p_category: args.category.trim(),
      p_description: args.description,
      p_actor: actor,
      p_correlation_id: args.correlationId.trim(),
      p_expected_revision: args.expectedRevision,
      p_analyzer_serial: args.analyzerSerial?.trim() || null,
    });
  },
});
