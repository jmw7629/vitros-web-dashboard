import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

const analyzerRow = v.object({
  _id: v.string(),
  serialNumber: v.string(),
  analyzerType: v.string(),
  currentStage: v.string(),
  startDate: v.optional(v.string()),
  productionOrder: v.optional(v.number()),
  procurementPct: v.number(),
  cleaningPct: v.number(),
  servicePct: v.number(),
  finalLinePct: v.number(),
  packagingPct: v.number(),
  releaseTestingPct: v.number(),
  qaReleasePct: v.number(),
  sapReleasePct: v.number(),
  currentPct: v.number(),
  overallPct: v.number(),
  isComplete: v.boolean(),
  daysInStage: v.number(),
  slaDays: v.number(),
});

const lvccRow = v.object({
  _id: v.string(),
  serialNumber: v.string(),
  batchNumber: v.optional(v.string()),
  itemType: v.optional(v.string()),
  currentStage: v.optional(v.string()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  isComplete: v.boolean(),
  buildPct: v.number(),
  testPct: v.number(),
  packagingPct: v.number(),
  qaReleasePct: v.number(),
  sapReleasePct: v.number(),
});

const weeklyNote = v.object({
  content: v.string(),
  product: v.string(),
});

const weeklyNoteRow = v.object({
  _id: v.string(),
  weekStart: v.string(),
  weekNumber: v.number(),
  quarter: v.string(),
  notes: v.array(weeklyNote),
});

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("REM read service is not configured");
  return { url: url.replace(/\/$/, ""), serviceKey };
}

async function readRows(url: string, serviceKey: string, resource: string, query: string): Promise<unknown[]> {
  const response = await fetch(`${url}/rest/v1/${resource}?${query}`, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    },
  });
  if (!response.ok) throw new Error(`REM authoritative read failed (${resource}:${response.status})`);
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error(`REM authoritative read returned invalid ${resource} payload`);
  return payload;
}

const numberOrZero = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const optionalString = (value: unknown) => {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
};

// This is the authenticated row-level REM read boundary. The browser never gets
// a Supabase credential and receives only the explicit fields required by the
// existing REM operator pages.
export const listCore = action({
  args: {},
  returns: v.object({
    analyzers: v.array(analyzerRow),
    lvccItems: v.array(lvccRow),
    weeklyNotes: v.array(weeklyNoteRow),
  }),
  handler: async (ctx) => {
    await requireCapability(ctx, "rem.read");
    const { url, serviceKey } = getSupabaseConfig();

    const [analyzerRows, lvccRows, noteRows] = await Promise.all([
      readRows(
        url,
        serviceKey,
        "rem_analyzers",
        "select=id,serial_number,analyzer_type,production_order,start_date,sla_days,current_stage,days_in_stage,overall_pct,procurement_pct,cleaning_pct,service_pct,final_line_pct,release_testing_pct,qa_release_pct,sap_release_pct,packaging_pct,current_pct,is_complete&order=serial_number.asc&limit=500",
      ),
      readRows(
        url,
        serviceKey,
        "rem_lvcc",
        "select=id,serial_number,item_type,batch_number,start_date,end_date,current_stage,build_pct,test_pct,qa_release_pct,sap_release_pct,packaging_pct,is_complete&order=serial_number.asc&limit=500",
      ),
      readRows(
        url,
        serviceKey,
        "rem_weekly_notes",
        "select=id,week_start,week_number,quarter,notes&order=week_start.desc&limit=104",
      ),
    ]);

    const analyzers = analyzerRows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        _id: String(row.id ?? ""),
        serialNumber: String(row.serial_number ?? ""),
        analyzerType: String(row.analyzer_type ?? ""),
        currentStage: String(row.current_stage ?? ""),
        startDate: optionalString(row.start_date),
        productionOrder: row.production_order === null || row.production_order === undefined
          ? undefined
          : numberOrZero(row.production_order),
        procurementPct: numberOrZero(row.procurement_pct),
        cleaningPct: numberOrZero(row.cleaning_pct),
        servicePct: numberOrZero(row.service_pct),
        finalLinePct: numberOrZero(row.final_line_pct),
        packagingPct: numberOrZero(row.packaging_pct),
        releaseTestingPct: numberOrZero(row.release_testing_pct),
        qaReleasePct: numberOrZero(row.qa_release_pct),
        sapReleasePct: numberOrZero(row.sap_release_pct),
        currentPct: numberOrZero(row.current_pct),
        overallPct: numberOrZero(row.overall_pct),
        isComplete: row.is_complete === true,
        daysInStage: numberOrZero(row.days_in_stage),
        slaDays: numberOrZero(row.sla_days),
      };
    });

    const lvccItems = lvccRows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        _id: String(row.id ?? ""),
        serialNumber: String(row.serial_number ?? ""),
        batchNumber: optionalString(row.batch_number),
        itemType: optionalString(row.item_type),
        currentStage: optionalString(row.current_stage),
        startDate: optionalString(row.start_date),
        endDate: optionalString(row.end_date),
        isComplete: row.is_complete === true,
        buildPct: numberOrZero(row.build_pct),
        testPct: numberOrZero(row.test_pct),
        packagingPct: numberOrZero(row.packaging_pct),
        qaReleasePct: numberOrZero(row.qa_release_pct),
        sapReleasePct: numberOrZero(row.sap_release_pct),
      };
    });

    const weeklyNotes = noteRows.map((raw) => {
      const row = raw as Record<string, unknown>;
      const rawNotes = Array.isArray(row.notes) ? row.notes : [];
      const notes = rawNotes.slice(0, 50).map((entry) => {
        const note = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
        return {
          content: String(note.content ?? "").slice(0, 8000),
          product: String(note.product ?? "").slice(0, 120),
        };
      });
      return {
        _id: String(row.id ?? ""),
        weekStart: String(row.week_start ?? ""),
        weekNumber: numberOrZero(row.week_number),
        quarter: String(row.quarter ?? ""),
        notes,
      };
    });

    return { analyzers, lvccItems, weeklyNotes };
  },
});
