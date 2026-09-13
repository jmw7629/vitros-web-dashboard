import { v } from "convex/values";
import { action } from "./_generated/server";
import { requireCapability } from "./authGuard";
import { assertOperationalId, assertOperationalYear, operationalDatasetValidator,
  operationalRecordValidator, validateOperationalRecord } from "./remOperationalImportValidation";

declare const process: { env: Record<string, string | undefined> };
const progressValidator = v.object({
  importId: v.string(), planYear: v.number(), expectedRows: v.number(), receivedRows: v.number(),
  status: v.union(v.literal("staging"), v.literal("applied")), nextBatchIndex: v.number(),
});
type Progress = { importId: string; planYear: number; expectedRows: number; receivedRows: number; status: "staging" | "applied"; nextBatchIndex: number };

async function rpc(name: string, payload: Record<string, unknown>): Promise<unknown> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("REM operational import service is not configured");
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    // Never forward PostgREST SQL/provider bodies, which can include source data.
    if ([400, 409, 422].includes(response.status)) throw new Error("REM import validation or retry conflict. Re-select the original workbook and review its upload status.");
    throw new Error(`REM operational request failed (${response.status}). Retry the same upload to recover.`);
  }
  return await response.json();
}
function progress(value: unknown): Progress {
  if (!value || typeof value !== "object") throw new Error("Invalid REM import receipt");
  const p = value as Progress;
  assertOperationalId(p.importId); assertOperationalYear(p.planYear);
  if (![p.expectedRows, p.receivedRows, p.nextBatchIndex].every(Number.isInteger) || p.expectedRows < 0 || p.expectedRows > 100_000 || p.receivedRows < 0 || p.receivedRows > p.expectedRows || p.nextBatchIndex < 0 || p.nextBatchIndex > Math.ceil(p.expectedRows / 250) || p.receivedRows !== Math.min(p.expectedRows, p.nextBatchIndex * 250) || !["staging", "applied"].includes(p.status) || p.status === "applied" && p.receivedRows !== p.expectedRows) throw new Error("Invalid REM import receipt");
  return { importId: p.importId, planYear: p.planYear, expectedRows: p.expectedRows, receivedRows: p.receivedRows, status: p.status, nextBatchIndex: p.nextBatchIndex };
}

export const beginOperationalImport = action({
  args: { fileHash: v.string(), planYear: v.number(), expectedRows: v.number() }, returns: progressValidator,
  handler: async (ctx, args) => {
    const actor = await requireCapability(ctx, "rem.write");
    assertOperationalYear(args.planYear);
    if (!/^[a-f0-9]{64}$/.test(args.fileHash) || !Number.isInteger(args.expectedRows) || args.expectedRows < 0 || args.expectedRows > 100_000) throw new Error("Invalid REM operational import size or fingerprint");
    return progress(await rpc("begin_rem_operational_import", { p_file_hash: args.fileHash, p_plan_year: args.planYear, p_expected_rows: args.expectedRows, p_actor: String(actor) }));
  },
});
export const getOperationalImportProgress = action({
  args: { importId: v.string() }, returns: progressValidator,
  handler: async (ctx, args) => {
    const actor = await requireCapability(ctx, "rem.write"); assertOperationalId(args.importId);
    return progress(await rpc("get_rem_operational_import_progress", { p_import_id: args.importId, p_actor: String(actor) }));
  },
});
export const stageOperationalImport = action({
  args: { importId: v.string(), batchIndex: v.number(), records: v.array(operationalRecordValidator) },
  returns: v.object({ importId: v.string(), planYear: v.number(), expectedRows: v.number(), receivedRows: v.number(), status: v.union(v.literal("staging"), v.literal("applied")), nextBatchIndex: v.number(), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const actor = await requireCapability(ctx, "rem.write"); assertOperationalId(args.importId);
    if (!Number.isInteger(args.batchIndex) || args.batchIndex < 0 || args.batchIndex >= 400 || args.records.length < 1 || args.records.length > 250 || JSON.stringify(args.records).length > 1_000_000) throw new Error("Invalid REM upload batch");
    const p = progress(await rpc("get_rem_operational_import_progress", { p_import_id: args.importId, p_actor: String(actor) }));
    const keys = new Set<string>();
    for (const record of args.records) {
      validateOperationalRecord(record, p.planYear);
      if (keys.has(record.sourceKey)) throw new Error("Duplicate REM operational identity in batch"); keys.add(record.sourceKey);
    }
    const raw = await rpc("stage_rem_operational_import", { p_import_id: args.importId, p_batch_index: args.batchIndex, p_records: args.records, p_actor: String(actor) });
    if (!raw || typeof raw !== "object" || typeof (raw as {duplicate?: unknown}).duplicate !== "boolean") throw new Error("Invalid REM staging receipt");
    return { ...progress(raw), duplicate: (raw as {duplicate: boolean}).duplicate };
  },
});
export const listOperationalRecords = action({
  args: { dataset: operationalDatasetValidator, offset: v.number(), limit: v.number(), query: v.optional(v.string()), product: v.optional(v.string()), planYear: v.optional(v.number()) },
  returns: v.object({ records: v.array(operationalRecordValidator), total: v.number(), offset: v.number(), limit: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "rem.read");
    if (args.planYear !== undefined) assertOperationalYear(args.planYear);
    if (!Number.isInteger(args.offset) || args.offset < 0 || args.offset > 10_000_000 || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100 || (args.query?.length ?? 0) > 160 || (args.product?.length ?? 0) > 80) throw new Error("Invalid REM record page");
    const raw = await rpc("list_rem_operational_records", { p_dataset: args.dataset, p_offset: args.offset, p_limit: args.limit, p_query: args.query?.trim() ?? "", p_product: args.product?.trim().toUpperCase() ?? "", p_plan_year: args.planYear ?? null });
    if (!raw || typeof raw !== "object") throw new Error("Invalid REM record page");
    const page = raw as { records: Array<{dataset: typeof args.dataset; sourceKey: string; sourceSheet: string; sourceRow: number; data: Parameters<typeof validateOperationalRecord>[0]["data"]}>; total: number; offset: number; limit: number; hasMore: boolean };
    if (!Array.isArray(page.records) || page.records.length > args.limit || !Number.isInteger(page.total) || page.total < 0 || page.offset !== args.offset || page.limit !== args.limit || typeof page.hasMore !== "boolean") throw new Error("Invalid REM record page");
    return page;
  },
});
