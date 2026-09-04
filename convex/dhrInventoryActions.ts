// Server-authoritative DHR scanner boundaries.
// Browser callers never receive Supabase privileged credentials and cannot call
// service-role-only database RPCs or base-table reads directly.
import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase config missing");
  return { url, serviceKey };
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
  if (!response.ok) {
    throw new Error(`DHR read failed (${response.status})`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error("DHR read returned invalid payload");
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
        "dhr_scan_sessions?select=id,instrument_sn,wo_number,analyzer_model,started_at,completed_at,status,started_by,notes&order=created_at.desc&limit=250",
      ),
      readSupabaseRows<Record<string, unknown>>(
        serviceKey,
        url,
        "convex_employees?select=id,name,initials,active&active=eq.true&order=name.asc&limit=500",
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
    const sessionId = args.sessionId.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
      throw new Error("Invalid DHR session id");
    }

    const { url, serviceKey } = getSupabaseConfig();
    return readSupabaseRows<Record<string, unknown>>(
      serviceKey,
      url,
      `dhr_scan_results?select=id,session_id,section_id,part_number,description,expected_qty,scanned_qty,category,status,stock_before,stock_after,stock_id,scanned_at,scanned_by,notes,revision&session_id=eq.${encodeURIComponent(sessionId)}&order=created_at.asc&limit=5000`,
    );
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
    const actorId = await requireCapability(ctx, "inventory.write");

    if (!args.sessionId.trim()) throw new Error("sessionId is required");
    if (!args.sectionId.trim()) throw new Error("sectionId is required");
    if (!args.partNumber.trim()) throw new Error("partNumber is required");
    if (!args.category.trim()) throw new Error("category is required");
    if (!args.correlationId.trim()) throw new Error("correlationId is required");
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
    return callAtomicDhrRpc(serviceKey, url, {
      p_session_id: args.sessionId,
      p_section_id: args.sectionId,
      p_part_number: args.partNumber.trim(),
      p_expected_qty: args.expectedQty,
      p_new_qty: args.newQty,
      p_category: args.category.trim(),
      p_description: args.description,
      p_actor: String(actorId),
      p_correlation_id: args.correlationId.trim(),
      p_expected_revision: args.expectedRevision,
      p_analyzer_serial: args.analyzerSerial?.trim() || null,
    });
  },
});
