// DEPRECATED: This file's queries read from the parallel Convex REM tables.
// Authoritative source is Supabase. Legacy writes remain internal-only.
// The public workbook import action below is server-authoritative and writes only
// through the reviewed transactional Supabase RPC.

import { action, internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

export const listAnalyzers = query({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "rem.read");
    return await ctx.db.query("remAnalyzers").collect();
  },
});

export const getAnalyzerBySerial = query({
  args: { serialNumber: v.string() },
  handler: async (ctx, { serialNumber }) => {
    await requireCapability(ctx, "rem.read");
    return await ctx.db
      .query("remAnalyzers")
      .withIndex("by_serialNumber", (q) => q.eq("serialNumber", serialNumber))
      .first();
  },
});

export const listLvccItems = query({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "rem.read");
    return await ctx.db.query("lvccItems").collect();
  },
});

export const listTargets = query({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "rem.read");
    return await ctx.db.query("annualTargets").collect();
  },
});

export const listStaff = query({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "rem.read");
    return await ctx.db.query("staffMembers").collect();
  },
});

export const listWeeklyNotes = query({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "rem.read");
    return await ctx.db.query("weeklyNotes").order("desc").collect();
  },
});

export const listEmployees = query({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "rem.read");
    return await ctx.db.query("employees").collect();
  },
});

export const listCycleSchedules = query({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    return await ctx.db.query("cycleSchedules").collect();
  },
});

export const listIncomingBatches = query({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    return await ctx.db.query("incomingBatches").collect();
  },
});

// Internal-only compatibility path. Browser/API callers must use the secure
// authoritative REM server actions.
export const updateAnalyzer = internalMutation({
  args: {
    id: v.id("remAnalyzers"),
    stage: v.optional(v.string()),
    progress: v.optional(v.number()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined)
    );
    await ctx.db.patch(id, filtered);
  },
});

const remWorkbookAnalyzer = v.object({
  serialNumber: v.string(),
  analyzerType: v.string(),
  productionOrder: v.optional(v.number()),
  cleaningPct: v.number(),
  servicePct: v.number(),
  finalLinePct: v.number(),
  releaseTestingPct: v.number(),
  packagingPct: v.number(),
});

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("REM import service is not configured");
  }
  return { url: url.replace(/\/$/, ""), serviceKey };
}

function assertPercent(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${field} must be between 0 and 100`);
  }
}

// Browser upload -> local XLSX structure parser -> this authenticated action ->
// service-role-only SQL RPC. Actor authority is derived from Convex auth, never
// from caller-supplied role/name/initials.
export const applyWorkbookImport = action({
  args: {
    fileName: v.string(),
    fileHash: v.string(),
    sourceSheet: v.string(),
    sourceWeek: v.optional(v.number()),
    analyzers: v.array(remWorkbookAnalyzer),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "rem.write");

    if (args.fileName.trim().length < 1 || args.fileName.length > 255) {
      throw new Error("Invalid workbook file name");
    }
    if (!/^[a-f0-9]{64}$/.test(args.fileHash)) {
      throw new Error("Invalid workbook fingerprint");
    }
    if (args.sourceSheet.trim().length < 1 || args.sourceSheet.length > 160) {
      throw new Error("Invalid REM source sheet");
    }
    if (args.sourceWeek !== undefined && (!Number.isInteger(args.sourceWeek) || args.sourceWeek < 1 || args.sourceWeek > 53)) {
      throw new Error("Invalid REM source week");
    }
    if (args.analyzers.length < 1 || args.analyzers.length > 250) {
      throw new Error("REM import must contain 1 to 250 analyzer rows");
    }

    const seen = new Set<string>();
    const rows = args.analyzers.map((row) => {
      const serialNumber = row.serialNumber.trim().toUpperCase();
      if (!/^[A-Z0-9-]{4,32}$/.test(serialNumber)) {
        throw new Error(`Invalid analyzer serial: ${row.serialNumber}`);
      }
      if (seen.has(serialNumber)) {
        throw new Error(`Duplicate analyzer serial in workbook: ${serialNumber}`);
      }
      seen.add(serialNumber);

      const analyzerType = row.analyzerType.trim();
      if (!analyzerType || analyzerType.length > 40) {
        throw new Error(`Invalid analyzer type for ${serialNumber}`);
      }
      if (row.productionOrder !== undefined && (!Number.isFinite(row.productionOrder) || row.productionOrder < 0 || row.productionOrder > 1_000_000)) {
        throw new Error(`Invalid production order for ${serialNumber}`);
      }
      assertPercent(row.cleaningPct, "cleaningPct");
      assertPercent(row.servicePct, "servicePct");
      assertPercent(row.finalLinePct, "finalLinePct");
      assertPercent(row.releaseTestingPct, "releaseTestingPct");
      assertPercent(row.packagingPct, "packagingPct");

      return {
        serial_number: serialNumber,
        analyzer_type: analyzerType,
        production_order: row.productionOrder ?? null,
        cleaning_pct: row.cleaningPct,
        service_pct: row.servicePct,
        final_line_pct: row.finalLinePct,
        release_testing_pct: row.releaseTestingPct,
        packaging_pct: row.packagingPct,
      };
    });

    const { url, serviceKey } = getSupabaseConfig();
    const response = await fetch(`${url}/rest/v1/rpc/apply_rem_workbook_import`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_file_hash: args.fileHash,
        p_file_name: args.fileName,
        p_source_sheet: args.sourceSheet,
        p_source_week: args.sourceWeek ?? null,
        p_actor: String(userId),
        p_rows: rows,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message = (body as { message?: string; error?: string }).message
        || (body as { message?: string; error?: string }).error
        || `REM import failed (${response.status})`;
      throw new Error(message);
    }

    return await response.json();
  },
});
