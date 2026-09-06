// Validated server-side inventory transition logic.
// Inventory quantity transitions are applied by one transactional Supabase RPC.
// The database function owns locking, idempotency, ledger creation, and SAP staging.
import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    // Provider-controlled PostgREST bodies may contain schema/constraint/policy details.
    // Keep browser-visible failures status-scoped and deterministic.
    throw new Error(`Supabase request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function applyTransition(
  serviceKey: string,
  url: string,
  args: {
    partNumber: string;
    mode: "RECEIVE" | "IN" | "OUT" | "ADJUST" | "STOCKOUT";
    qty: number;
    user: string;
    correlationId: string;
    analyzerSerial?: string;
    batchId?: string;
  },
) {
  return sbFetch<Record<string, unknown>>(serviceKey, url, "rpc/apply_inventory_transition", {
    method: "POST",
    body: JSON.stringify({
      p_part_number: args.partNumber,
      p_mode: args.mode,
      p_qty: args.qty,
      p_user: args.user,
      p_correlation_id: args.correlationId,
      p_analyzer_serial: args.analyzerSerial ?? null,
      p_batch_id: args.batchId ?? null,
    }),
  });
}

function validateSapIds(ids: string[]): string[] {
  const normalized = ids.map((id) => id.trim());
  if (normalized.length === 0 || normalized.length > 250) {
    throw new Error("Select between 1 and 250 SAP staging rows");
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Duplicate SAP staging rows are not allowed");
  }
  if (normalized.some((id) => !UUID_RE.test(id))) {
    throw new Error("Invalid SAP staging row id");
  }
  return normalized;
}

async function sapCorrelationId(targetStatus: "ready" | "exported", ids: string[]): Promise<string> {
  const stableIntent = `${targetStatus}:${[...ids].sort().join(",")}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableIntent));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `legacy-sap:${targetStatus}:${hash}`;
}

async function applySapStagingStatusTransition(
  serviceKey: string,
  url: string,
  actorId: string,
  ids: string[],
  targetStatus: "ready" | "exported",
) {
  const normalizedIds = validateSapIds(ids);
  const correlationId = await sapCorrelationId(targetStatus, normalizedIds);
  return sbFetch<Record<string, unknown>>(serviceKey, url, "rpc/apply_sap_staging_status_transition", {
    method: "POST",
    body: JSON.stringify({
      p_ids: normalizedIds,
      p_target_status: targetStatus,
      p_actor: actorId,
      p_correlation_id: correlationId,
    }),
  });
}

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
    // Retained for backwards-compatible UI payloads only. This value is never
    // authoritative for ledger attribution; the authenticated Convex user ID is.
    user: v.string(),
    correlationId: v.string(),
    analyzerSerial: v.optional(v.string()),
    batchId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!args.partNumber.trim()) throw new Error("Part number is required");
    if (!args.correlationId.trim()) throw new Error("correlationId is required");

    let actorId;
    if (args.mode === "ADJUST") {
      actorId = await requireCapability(ctx, "inventory.admin");
      if (args.qty < 0) throw new Error("Adjusted quantity cannot be negative");
    } else {
      actorId = await requireCapability(ctx, "inventory.write");
      if (args.mode !== "STOCKOUT" && args.qty <= 0) {
        throw new Error("Quantity must be greater than zero");
      }
    }

    const { url, serviceKey } = getSupabaseConfig();
    return applyTransition(serviceKey, url, {
      partNumber: args.partNumber,
      mode: args.mode,
      qty: args.qty,
      user: String(actorId),
      correlationId: args.correlationId,
      analyzerSerial: args.analyzerSerial,
      batchId: args.batchId,
    });
  },
});

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
    if (!args.partNumber.trim()) throw new Error("Part number is required");
    if ((args.minQty ?? 0) < 0 || (args.maxQty ?? 0) < 0 || (args.unitCost ?? 0) < 0) {
      throw new Error("Inventory numeric fields cannot be negative");
    }
    if ((args.qtyOnHand ?? 0) !== 0) {
      await requireCapability(ctx, "inventory.admin");
      if ((args.qtyOnHand ?? 0) < 0) throw new Error("Quantity cannot be negative");
    }

    const { url, serviceKey } = getSupabaseConfig();
    const now = new Date().toISOString();
    const rows = await sbFetch<any[]>(serviceKey, url, "stock", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        part_number: args.partNumber.trim(),
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
        updated_at: now,
      }),
    });
    return rows[0];
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
    const userId = await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();

    if ((args.minQty ?? 0) < 0 || (args.maxQty ?? 0) < 0 || (args.unitCost ?? 0) < 0) {
      throw new Error("Inventory numeric fields cannot be negative");
    }

    // Quantity is never patched directly. Admin quantity edits are converted
    // into the same audited ADJUST transition used by the scan workflow.
    if (args.qtyOnHand !== undefined) {
      await requireCapability(ctx, "inventory.admin");
      if (args.qtyOnHand < 0) throw new Error("Quantity cannot be negative");
      const stockRows = await sbFetch<any[]>(serviceKey, url, `stock?id=eq.${encodeURIComponent(args.id)}&select=part_number`);
      if (!stockRows[0]?.part_number) throw new Error("Part not found");
      await applyTransition(serviceKey, url, {
        partNumber: stockRows[0].part_number,
        mode: "ADJUST",
        qty: args.qtyOnHand,
        user: String(userId),
        correlationId: `manual-adjust-${args.id}-${Date.now()}`,
      });
    }

    const mapped: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (args.partNumber !== undefined) mapped.part_number = args.partNumber.trim();
    if (args.description !== undefined) mapped.description = args.description;
    if (args.type !== undefined) mapped.type = args.type;
    if (args.minQty !== undefined) mapped.min_qty = args.minQty;
    if (args.maxQty !== undefined) mapped.max_qty = args.maxQty;
    if (args.onPlan !== undefined) mapped.on_plan = args.onPlan;
    if (args.binLocation !== undefined) mapped.bin_location = args.binLocation;
    if (args.module !== undefined) mapped.module = args.module;
    if (args.unitCost !== undefined) mapped.unit_cost = args.unitCost;

    if (Object.keys(mapped).length > 1) {
      await sbFetch<void>(serviceKey, url, `stock?id=eq.${encodeURIComponent(args.id)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(mapped),
      });
    }
    return { success: true };
  },
});

export const deleteStockItem = action({
  args: { id: v.string() },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    await requireCapability(ctx, "inventory.admin");
    const { url, serviceKey } = getSupabaseConfig();
    await sbFetch<void>(serviceKey, url, `stock?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
    return { success: true };
  },
});

// Legacy wire-compatible SAP actions now route only through the reviewed,
// atomic authoritative status RPC introduced by the parent SAP workflow PR.
// They cannot directly PATCH sap_staging, invent exported actors/timestamps,
// or transition rows back to pending/error.
export const updateSapStatus = action({
  args: {
    id: v.string(),
    status: v.union(v.literal("ready"), v.literal("posted"), v.literal("error"), v.literal("pending")),
  },
  returns: v.any(),
  handler: async (ctx, { id, status }) => {
    const actorId = await requireCapability(ctx, "inventory.write");
    if (status !== "ready" && status !== "posted") {
      throw new Error("Legacy SAP status changes only support reviewed ready/exported transitions");
    }
    const { url, serviceKey } = getSupabaseConfig();
    return applySapStagingStatusTransition(
      serviceKey,
      url,
      String(actorId),
      [id],
      status === "posted" ? "exported" : "ready",
    );
  },
});

export const markSapBatchReady = action({
  args: { ids: v.array(v.string()) },
  returns: v.any(),
  handler: async (ctx, { ids }) => {
    const actorId = await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    return applySapStagingStatusTransition(serviceKey, url, String(actorId), ids, "ready");
  },
});

export const markSapBatchExported = action({
  args: { ids: v.array(v.string()) },
  returns: v.any(),
  handler: async (ctx, { ids }) => {
    const actorId = await requireCapability(ctx, "inventory.write");
    const { url, serviceKey } = getSupabaseConfig();
    return applySapStagingStatusTransition(serviceKey, url, String(actorId), ids, "exported");
  },
});
