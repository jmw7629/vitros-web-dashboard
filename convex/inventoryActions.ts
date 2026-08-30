// Validated server-side inventory transition logic.
// Stock receive/out/adjust/stockout transitions are computed server-side.
// Correlation/idempotency keys prevent double-apply on retry.
// Partial-failure behavior is documented honestly (Supabase multi-request is not transactional).
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

async function sbFetch<T>(serviceKey: string, url: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).message || (body as any).error || `Supabase error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

type TransitionResult = {
  success: boolean;
  partNumber: string;
  description: string;
  qtyBefore: number;
  qtyAfter: number;
  mode: string;
  correlationId: string;
  auditId?: string;
  sapId?: string;
  partialFailure?: string;
};

export const scanStockTransition = action({
  args: {
    partNumber: v.string(),
    mode: v.union(
      v.literal("RECEIVE"),
      v.literal("IN"),
      v.literal("OUT"),
      v.literal("ADJUST"),
      v.literal("STOCKOUT"),
    ),
    qty: v.number(),
    user: v.string(),
    correlationId: v.string(),
    analyzerSerial: v.optional(v.string()),
    batchId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");

    const { url, serviceKey } = getSupabaseConfig();
    const now = new Date().toISOString();

    // 1. Check for idempotency — same correlationId means already processed
    const existingLogs = await sbFetch<any[]>(
      serviceKey,
      url,
      `audit_log?correlation_id=eq.${args.correlationId}&select=id`,
    );
    if (existingLogs.length > 0) {
      return {
        success: true,
        duplicate: true,
        correlationId: args.correlationId,
        message: "Already processed (idempotent skip)",
      };
    }

    // 2. Read current stock row
    const stockRows = await sbFetch<any[]>(
      serviceKey,
      url,
      `stock?part_number=eq.${args.partNumber}&select=*`,
    );
    if (stockRows.length === 0) {
      return { success: false, error: "Part not found" };
    }
    const stock = stockRows[0];
    const qtyBefore = Number(stock.qty_on_hand) || 0;

    // 3. Compute qtyAfter server-side
    let qtyAfter: number;
    if (args.mode === "RECEIVE" || args.mode === "IN") {
      qtyAfter = qtyBefore + args.qty;
    } else if (args.mode === "OUT") {
      qtyAfter = Math.max(0, qtyBefore - args.qty);
    } else if (args.mode === "STOCKOUT") {
      qtyAfter = qtyBefore; // No inventory impact — traceability only
    } else if (args.mode === "ADJUST") {
      qtyAfter = args.qty; // Direct set
    } else {
      return { success: false, error: `Unknown mode: ${args.mode}` };
    }

    // 4. Validate: qty must be non-negative
    if (qtyAfter < 0) {
      return { success: false, error: "Cannot reduce below zero" };
    }

    // 5. Update stock QOH (skip for STOCKOUT)
    let partialFailure: string | undefined;
    if (args.mode !== "STOCKOUT") {
      try {
        await sbFetch(serviceKey, url, `stock?id=eq.${stock.id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            qty_on_hand: qtyAfter,
            last_activity: now,
            updated_at: now,
          }),
        });
      } catch (e) {
        partialFailure = `Stock update failed: ${e instanceof Error ? e.message : "unknown"}`;
      }
    }

    // 6. Write audit record
    let auditId: string | undefined;
    try {
      const auditRows = await sbFetch<any[]>(serviceKey, url, "audit_log", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          action: args.mode,
          entity_type: "stock",
          entity_id: stock.id,
          part_number: args.partNumber,
          user_name: args.user,
          correlation_id: args.correlationId,
          details: {
            qty: args.qty,
            analyzerSerial: args.analyzerSerial,
            batchId: args.batchId,
          },
          old_value: { qty_on_hand: qtyBefore },
          new_value: {
            qty_on_hand: qtyAfter,
            qty: args.qty,
            qty_before: qtyBefore,
            qty_after: qtyAfter,
            description: stock.description,
          },
          created_at: now,
        }),
      });
      auditId = auditRows[0]?.id;
    } catch (e) {
      partialFailure = (partialFailure ? partialFailure + "; " : "") +
        `Audit log failed: ${e instanceof Error ? e.message : "unknown"}`;
    }

    // 7. Stage SAP record (best-effort, non-blocking)
    let sapId: string | undefined;
    try {
      const settingsRows = await sbFetch<any[]>(serviceKey, url, "settings?select=*").catch(() => []);
      const settingsMap = Object.fromEntries((settingsRows || []).map((s: any) => [s.key, s.value]));
      const sapRows = await sbFetch<any[]>(serviceKey, url, "sap_staging", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          part_number: args.partNumber,
          description: stock.description,
          movement_type: args.mode === "STOCKOUT" ? "STOCKOUT" : args.mode === "OUT" ? "261" : "101",
          plant_code: settingsMap.sapPlantCode || "US08",
          storage_location: settingsMap.sapStorageLocation || "MAIN",
          qty_on_hand: args.qty,
          qty_before: qtyBefore,
          qty_after: qtyAfter,
          mode: args.mode,
          export_status: "pending",
          created_at: now,
        }),
      });
      sapId = sapRows[0]?.id;
    } catch {
      // SAP staging is best-effort
    }

    // 8. Return typed result
    const result: TransitionResult = {
      success: !partialFailure,
      partNumber: args.partNumber,
      description: stock.description,
      qtyBefore,
      qtyAfter,
      mode: args.mode,
      correlationId: args.correlationId,
      auditId,
      sapId,
    };
    if (partialFailure) result.partialFailure = partialFailure;
    return result;
  },
});

// ─── Domain-specific validated mutations ───

export const createStockItem = action({
  args: {
    partNumber: v.string(),
    description: v.string(),
    type: v.optional(v.string()),
    qtyOnHand: v.optional(v.number()),
    minQty: v.optional(v.number()),
    maxQty: v.optional(v.number()),
    onPlan: v.optional(v.boolean()),
    binLocation: v.optional(v.string()),
    module: v.optional(v.string()),
    unitCost: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const now = new Date().toISOString();
    const json = await sbFetch<any[]>(serviceKey, url, "stock", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        part_number: args.partNumber,
        description: args.description,
        type: args.type || "Required",
        qty_on_hand: args.qtyOnHand ?? 0,
        min_qty: args.minQty ?? 0,
        max_qty: args.maxQty ?? 0,
        on_plan: args.onPlan ?? false,
        bin_location: args.binLocation ?? "",
        module: args.module ?? "",
        unit_cost: args.unitCost ?? 0,
        last_activity: now,
      }),
    });
    return Array.isArray(json) ? json[0] : json;
  },
});

export const updateStockItem = action({
  args: {
    id: v.string(),
    partNumber: v.optional(v.string()),
    description: v.optional(v.string()),
    type: v.optional(v.string()),
    qtyOnHand: v.optional(v.number()),
    minQty: v.optional(v.number()),
    maxQty: v.optional(v.number()),
    onPlan: v.optional(v.boolean()),
    binLocation: v.optional(v.string()),
    module: v.optional(v.string()),
    unitCost: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const now = new Date().toISOString();
    const mapped: Record<string, unknown> = { updated_at: now, last_activity: now };
    if (args.partNumber !== undefined) mapped.part_number = args.partNumber;
    if (args.description !== undefined) mapped.description = args.description;
    if (args.type !== undefined) mapped.type = args.type;
    if (args.qtyOnHand !== undefined) mapped.qty_on_hand = args.qtyOnHand;
    if (args.minQty !== undefined) mapped.min_qty = args.minQty;
    if (args.maxQty !== undefined) mapped.max_qty = args.maxQty;
    if (args.onPlan !== undefined) mapped.on_plan = args.onPlan;
    if (args.binLocation !== undefined) mapped.bin_location = args.binLocation;
    if (args.module !== undefined) mapped.module = args.module;
    if (args.unitCost !== undefined) mapped.unit_cost = args.unitCost;

    await sbFetch(serviceKey, url, `stock?id=eq.${args.id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(mapped),
    });
    return { success: true };
  },
});

export const deleteStockItem = action({
  args: { id: v.string() },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await requireCapability(ctx, "inventory.admin");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch(serviceKey, url, `stock?id=eq.${id}`, {
      method: "DELETE",
    });
    return { success: true };
  },
});

export const updateSapStatus = action({
  args: {
    id: v.string(),
    status: v.union(v.literal("ready"), v.literal("posted"), v.literal("error"), v.literal("pending")),
  },
  returns: v.any(),
  handler: async (ctx, { id, status }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const update: Record<string, unknown> = { export_status: status };
    if (status === "posted") update.exported_at = new Date().toISOString();
    await sbFetch(serviceKey, url, `sap_staging?id=eq.${id}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(update),
    });
    return { success: true };
  },
});

export const markSapBatchReady = action({
  args: { ids: v.array(v.string()) },
  returns: v.any(),
  handler: async (ctx, { ids }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    await Promise.all(
      ids.map((id) =>
        sbFetch(serviceKey, url, `sap_staging?id=eq.${id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ export_status: "ready" }),
        }),
      ),
    );
    return { success: true, count: ids.length };
  },
});

export const markSapBatchExported = action({
  args: { ids: v.array(v.string()) },
  returns: v.any(),
  handler: async (ctx, { ids }) => {
    await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    const now = new Date().toISOString();
    await Promise.all(
      ids.map((id) =>
        sbFetch(serviceKey, url, `sap_staging?id=eq.${id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ export_status: "posted", exported_at: now }),
        }),
      ),
    );
    return { success: true, count: ids.length };
  },
});
