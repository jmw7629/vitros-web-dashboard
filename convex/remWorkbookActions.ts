import { v } from "convex/values";
import { action } from "./_generated/server";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

const analyzerRow = v.object({
  serialNumber: v.string(),
  analyzerType: v.string(),
  productionOrder: v.optional(v.number()),
  cleaningPct: v.number(),
  servicePct: v.number(),
  finalLinePct: v.number(),
  releaseTestingPct: v.number(),
  packagingPct: v.number(),
});

const trackerRow = v.object({
  sourceKey: v.string(),
  year: v.number(),
  product: v.string(),
  quarter: v.string(),
  weekNumber: v.number(),
  weekStart: v.optional(v.string()),
  plan: v.number(),
  actual: v.optional(v.number()),
  quarterPlan: v.optional(v.number()),
  quarterActual: v.optional(v.number()),
  totalPlan: v.optional(v.number()),
  totalActual: v.optional(v.number()),
  weeklyForecast: v.optional(v.number()),
  accumulatedForecast: v.optional(v.number()),
});

const buildPlanRow = v.object({
  sourceKey: v.string(),
  year: v.number(),
  quarter: v.string(),
  weekNumber: v.number(),
  weekStart: v.optional(v.string()),
  data: v.any(),
});

const staffRow = v.object({
  sourceKey: v.string(),
  year: v.number(),
  wwid: v.string(),
  name: v.string(),
  role: v.optional(v.string()),
  started: v.optional(v.string()),
  completeAfter: v.optional(v.string()),
  fte: v.optional(v.number()),
  trainingUntil: v.optional(v.string()),
  skills: v.any(),
  certifications: v.any(),
  comment: v.optional(v.string()),
});

const weeklyNoteRow = v.object({
  sourceKey: v.string(),
  year: v.number(),
  weekStart: v.optional(v.string()),
  weekNumber: v.number(),
  quarter: v.string(),
  notes: v.object({
    vitros: v.optional(v.string()),
    vision: v.optional(v.string()),
    lvccElectrometer: v.optional(v.string()),
    lvccIrWash: v.optional(v.string()),
  }),
});

const targetRow = v.object({
  sourceKey: v.string(),
  year: v.number(),
  targetType: v.string(),
  targetValue: v.number(),
  actualValue: v.number(),
  data: v.any(),
});

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("REM import service is not configured");
  return { url: url.replace(/\/$/, ""), serviceKey };
}

function assertYear(year: number) {
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error("Invalid REM plan year");
}

function assertSectionKey(value: string, year: number, section: string) {
  if (value.length < 4 || value.length > 180 || !value.startsWith(`${year}:${section}:`)) {
    throw new Error(`Invalid REM ${section} source key`);
  }
}

function assertWeek(week: number) {
  if (!Number.isInteger(week) || week < 1 || week > 53) throw new Error("Invalid REM week number");
}

function assertQuarter(quarter: string) {
  if (!/^Q[1-4]$/.test(quarter)) throw new Error("Invalid REM quarter");
}

function assertFiniteRange(value: number | undefined, min: number, max: number, label: string) {
  if (value === undefined) return;
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`Invalid ${label}`);
}

export const applyAuthoritativeWorkbookImport = action({
  args: {
    fileName: v.string(),
    fileHash: v.string(),
    planYear: v.number(),
    sourceSheet: v.string(),
    sourceWeek: v.optional(v.number()),
    analyzers: v.array(analyzerRow),
    trackerWeekly: v.array(trackerRow),
    buildPlan: v.array(buildPlanRow),
    staff: v.array(staffRow),
    weeklyNotes: v.array(weeklyNoteRow),
    targets: v.array(targetRow),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "rem.write");
    assertYear(args.planYear);
    if (args.fileName.trim().length < 1 || args.fileName.length > 255) throw new Error("Invalid workbook file name");
    if (!/^[a-f0-9]{64}$/.test(args.fileHash)) throw new Error("Invalid workbook fingerprint");
    if (args.sourceSheet.trim().length < 1 || args.sourceSheet.length > 160) throw new Error("Invalid REM source sheet");
    if (args.sourceWeek !== undefined) assertWeek(args.sourceWeek);
    if (args.analyzers.length < 5 || args.analyzers.length > 250) throw new Error("Invalid analyzer row count");
    if (args.trackerWeekly.length < 40 || args.trackerWeekly.length > 260) throw new Error("Invalid REM tracker row count");
    if (args.buildPlan.length < 20 || args.buildPlan.length > 53) throw new Error("Invalid REM build-plan row count");
    if (args.staff.length < 5 || args.staff.length > 250) throw new Error("Invalid REM staff row count");
    if (args.weeklyNotes.length > 53) throw new Error("Invalid REM weekly-note row count");
    if (args.targets.length < 1 || args.targets.length > 32) throw new Error("Invalid REM target row count");

    const analyzerSerials = new Set<string>();
    for (const row of args.analyzers) {
      const serial = row.serialNumber.trim().toUpperCase();
      if (!/^\d{8}$/.test(serial)) throw new Error("Invalid analyzer serial");
      if (analyzerSerials.has(serial)) throw new Error("Duplicate analyzer serial");
      analyzerSerials.add(serial);
      if (!/^(3600|5600|7600)$/.test(row.analyzerType)) throw new Error("Invalid analyzer type");
      assertFiniteRange(row.productionOrder, 0, 1_000_000, "production order");
      for (const [label, value] of Object.entries({
        cleaningPct: row.cleaningPct,
        servicePct: row.servicePct,
        finalLinePct: row.finalLinePct,
        releaseTestingPct: row.releaseTestingPct,
        packagingPct: row.packagingPct,
      })) assertFiniteRange(value, 0, 100, label);
    }

    const trackerKeys = new Set<string>();
    for (const row of args.trackerWeekly) {
      if (row.year !== args.planYear) throw new Error("Tracker row year mismatch");
      assertSectionKey(row.sourceKey, args.planYear, "tracker");
      assertWeek(row.weekNumber);
      assertQuarter(row.quarter);
      if (!/^(VITROS|VISION|LVCC_ELECTROMETER|LVCC_IR_WASH)$/.test(row.product)) throw new Error("Invalid tracker product");
      if (trackerKeys.has(row.sourceKey)) throw new Error("Duplicate tracker source key");
      trackerKeys.add(row.sourceKey);
      for (const [label, value] of Object.entries({
        plan: row.plan,
        actual: row.actual,
        quarterPlan: row.quarterPlan,
        quarterActual: row.quarterActual,
        totalPlan: row.totalPlan,
        totalActual: row.totalActual,
        weeklyForecast: row.weeklyForecast,
        accumulatedForecast: row.accumulatedForecast,
      })) assertFiniteRange(value, 0, 1_000_000, `tracker ${label}`);
    }

    const buildKeys = new Set<string>();
    for (const row of args.buildPlan) {
      if (row.year !== args.planYear) throw new Error("Build-plan row year mismatch");
      assertSectionKey(row.sourceKey, args.planYear, "build-plan");
      assertWeek(row.weekNumber);
      assertQuarter(row.quarter);
      if (buildKeys.has(row.sourceKey)) throw new Error("Duplicate build-plan source key");
      buildKeys.add(row.sourceKey);
    }

    const staffKeys = new Set<string>();
    for (const row of args.staff) {
      if (row.year !== args.planYear) throw new Error("Staff row year mismatch");
      assertSectionKey(row.sourceKey, args.planYear, "staff");
      if (!/^\d{6,12}$/.test(row.wwid)) throw new Error("Invalid staff WWID");
      if (!row.name.trim() || row.name.length > 160) throw new Error("Invalid staff name");
      assertFiniteRange(row.fte, 0, 5, "staff FTE");
      if (staffKeys.has(row.sourceKey)) throw new Error("Duplicate staff source key");
      staffKeys.add(row.sourceKey);
    }

    const noteKeys = new Set<string>();
    for (const row of args.weeklyNotes) {
      if (row.year !== args.planYear) throw new Error("Note row year mismatch");
      assertSectionKey(row.sourceKey, args.planYear, "notes");
      assertWeek(row.weekNumber);
      assertQuarter(row.quarter);
      if (noteKeys.has(row.sourceKey)) throw new Error("Duplicate note source key");
      noteKeys.add(row.sourceKey);
    }

    const targetKeys = new Set<string>();
    for (const row of args.targets) {
      if (row.year !== args.planYear) throw new Error("Target row year mismatch");
      assertSectionKey(row.sourceKey, args.planYear, "target");
      if (!/^[A-Z0-9_]{3,80}$/.test(row.targetType)) throw new Error("Invalid REM target type");
      assertFiniteRange(row.targetValue, 0, 10_000_000, "target value");
      assertFiniteRange(row.actualValue, 0, 10_000_000, "actual value");
      if (targetKeys.has(row.sourceKey)) throw new Error("Duplicate target source key");
      targetKeys.add(row.sourceKey);
    }

    const { url, serviceKey } = getSupabaseConfig();
    const response = await fetch(`${url}/rest/v1/rpc/apply_rem_authoritative_workbook_import`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_file_hash: args.fileHash,
        p_file_name: args.fileName,
        p_plan_year: args.planYear,
        p_source_sheet: args.sourceSheet,
        p_source_week: args.sourceWeek ?? null,
        p_actor: String(userId),
        p_analyzers: args.analyzers,
        p_tracker_weekly: args.trackerWeekly,
        p_build_plan: args.buildPlan,
        p_staff: args.staff,
        p_weekly_notes: args.weeklyNotes,
        p_targets: args.targets,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message = (body as { message?: string; error?: string }).message
        || (body as { message?: string; error?: string }).error
        || `REM authoritative import failed (${response.status})`;
      throw new Error(message);
    }
    return await response.json();
  },
});
