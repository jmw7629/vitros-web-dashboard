// Server-side part master administration actions.
// All writes route through the authoritative Supabase RPCs with version concurrency,
// typed allowlisted payloads, server-derived actor identity, immutable audit trail,
// and idempotency via correlation IDs.
import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";
import { publishRealtimePulse } from "./realtimePulsePublisher";

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
    throw new Error(`Supabase request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const partMasterUpdatableFields = [
  "description",
  "type",
  "min_qty",
  "max_qty",
  "on_plan",
  "bin_location",
  "module",
  "unit_cost",
] as const;

type PartMasterUpdatableField = (typeof partMasterUpdatableFields)[number];

const allowedPartTypes = new Set(["Required", "Optional", "Not on BOM", "Consumable"]);

function validatePartMasterUpdates(updates: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (!partMasterUpdatableFields.includes(key as PartMasterUpdatableField)) {
      throw new Error(`Field ${key} is not editable via part master administration`);
    }
    if (key === "type" && typeof value === "string" && !allowedPartTypes.has(value)) {
      throw new Error("Invalid part type");
    }
    if (["min_qty", "max_qty", "unit_cost"].includes(key)) {
      const num = Number(value);
      if (!Number.isFinite(num) || num < 0) {
        throw new Error(`${key} cannot be negative`);
      }
      safe[key] = num;
      continue;
    }
    if (key === "on_plan" && typeof value !== "boolean") {
      throw new Error("on_plan must be boolean");
    }
    safe[key] = value;
  }
  if (Object.keys(safe).length === 0) {
    throw new Error("No permitted part master fields supplied");
  }
  return safe;
}

export const listPartMaster = action({
  args: {},
  returns: v.array(v.object({
    id: v.string(),
    partNumber: v.string(),
    description: v.string(),
    type: v.string(),
    qtyOnHand: v.number(),
    minQty: v.number(),
    maxQty: v.number(),
    onPlan: v.boolean(),
    binLocation: v.string(),
    module: v.string(),
    unitCost: v.number(),
    version: v.number(),
    updatedAt: v.string(),
  })),
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<Array<Record<string, unknown>>>(
      serviceKey,
      url,
      "stock?select=id,part_number,description,type,qty_on_hand,min_qty,max_qty,on_plan,bin_location,module,unit_cost,version,updated_at&order=part_number.asc",
    );
    return rows.map((row) => ({
      id: String(row.id ?? ""),
      partNumber: String(row.part_number ?? ""),
      description: String(row.description ?? ""),
      type: String(row.type ?? ""),
      qtyOnHand: Number(row.qty_on_hand ?? 0),
      minQty: Number(row.min_qty ?? 0),
      maxQty: Number(row.max_qty ?? 0),
      onPlan: row.on_plan === true,
      binLocation: String(row.bin_location ?? ""),
      module: String(row.module ?? ""),
      unitCost: Number(row.unit_cost ?? 0),
      version: Number(row.version ?? 1),
      updatedAt: String(row.updated_at ?? ""),
    }));
  },
});

export const updatePartMaster = action({
  args: {
    partId: v.string(),
    updates: v.object({
      description: v.optional(v.string()),
      type: v.optional(v.string()),
      min_qty: v.optional(v.number()),
      max_qty: v.optional(v.number()),
      on_plan: v.optional(v.boolean()),
      bin_location: v.optional(v.string()),
      module: v.optional(v.string()),
      unit_cost: v.optional(v.number()),
    }),
    expectedVersion: v.number(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    eventId: v.number(),
    partId: v.string(),
    partNumber: v.string(),
    version: v.number(),
    updatedAt: v.string(),
    duplicate: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "inventory.admin");
    if (!args.correlationId.trim() || args.correlationId.length > 200) {
      throw new Error("Invalid correlation id");
    }
    if (args.reason && args.reason.length > 500) {
      throw new Error("Reason is too long");
    }
    if (!Number.isInteger(args.expectedVersion) || args.expectedVersion < 1) {
      throw new Error("Expected version must be a positive integer");
    }

    const safeUpdates = validatePartMasterUpdates(args.updates as Record<string, unknown>);

    const { url, serviceKey } = getSupabaseConfig();
    const payload = await sbFetch<any[]>(serviceKey, url, "rpc/apply_part_master_change", {
      method: "POST",
      body: JSON.stringify({
        p_part_id: args.partId,
        p_updates: safeUpdates,
        p_expected_version: args.expectedVersion,
        p_actor: String(actorId),
        p_correlation_id: args.correlationId,
        p_reason: args.reason?.trim() || null,
      }),
    });

    if (!Array.isArray(payload) || payload.length !== 1) {
      throw new Error("Part master update returned an invalid receipt");
    }
    const row = payload[0] as Record<string, unknown>;
    const eventId = Number(row.event_id);
    const partId = String(row.part_id);
    const partNumber = String(row.part_number);
    const version = Number(row.version);
    if (!Number.isInteger(eventId) || !partId || !partNumber || !Number.isInteger(version)) {
      throw new Error("Part master update returned an invalid receipt");
    }

    await publishRealtimePulse(ctx);
    return {
      eventId,
      partId,
      partNumber,
      version,
      updatedAt: String(row.updated_at ?? ""),
      duplicate: row.duplicate === true,
    };
  },
});

export const createPartMaster = action({
  args: {
    partNumber: v.string(),
    description: v.string(),
    type: v.optional(v.string()),
    minQty: v.optional(v.number()),
    maxQty: v.optional(v.number()),
    onPlan: v.optional(v.boolean()),
    binLocation: v.optional(v.string()),
    module: v.optional(v.string()),
    unitCost: v.optional(v.number()),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    partId: v.string(),
    partNumber: v.string(),
    version: v.number(),
    createdAt: v.string(),
    eventId: v.number(),
  }),
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "inventory.admin");
    if (!args.correlationId.trim() || args.correlationId.length > 200) {
      throw new Error("Invalid correlation id");
    }
    if (args.reason && args.reason.length > 500) {
      throw new Error("Reason is too long");
    }

    const partNumber = args.partNumber.trim().toUpperCase();
    if (!partNumber || partNumber.length > 64) {
      throw new Error("Part number must be 1-64 characters");
    }
    const description = args.description.trim();
    if (!description || description.length > 255) {
      throw new Error("Description must be 1-255 characters");
    }
    const type = (args.type ?? "Required").trim();
    if (!allowedPartTypes.has(type)) {
      throw new Error("Invalid part type");
    }
    const minQty = args.minQty ?? 0;
    const maxQty = args.maxQty ?? 0;
    if (!Number.isInteger(minQty) || minQty < 0) throw new Error("minQty must be a non-negative integer");
    if (!Number.isInteger(maxQty) || maxQty < 0) throw new Error("maxQty must be a non-negative integer");
    const unitCost = args.unitCost ?? 0;
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error("unitCost cannot be negative");

    const { url, serviceKey } = getSupabaseConfig();
    const payload = await sbFetch<any[]>(serviceKey, url, "rpc/create_part_master", {
      method: "POST",
      body: JSON.stringify({
        p_part_number: partNumber,
        p_description: description,
        p_type: type,
        p_min_qty: minQty,
        p_max_qty: maxQty,
        p_on_plan: args.onPlan ?? false,
        p_bin_location: args.binLocation ?? "",
        p_module: args.module ?? "",
        p_unit_cost: unitCost,
        p_actor: String(actorId),
        p_correlation_id: args.correlationId,
        p_reason: args.reason?.trim() || null,
      }),
    });

    if (!Array.isArray(payload) || payload.length !== 1) {
      throw new Error("Part master creation returned an invalid receipt");
    }
    const row = payload[0] as Record<string, unknown>;
    const partId = String(row.part_id);
    const partNumberOut = String(row.part_number);
    const version = Number(row.version);
    const eventId = Number(row.event_id);
    if (!partId || !partNumberOut || !Number.isInteger(version) || !Number.isInteger(eventId)) {
      throw new Error("Part master creation returned an invalid receipt");
    }

    await publishRealtimePulse(ctx);
    return {
      partId,
      partNumber: partNumberOut,
      version,
      createdAt: String(row.created_at ?? ""),
      eventId,
    };
  },
});
