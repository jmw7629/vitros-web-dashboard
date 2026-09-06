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

const trackerPlanningRow = v.object({
  _id: v.string(),
  year: v.number(),
  product: v.string(),
  quarter: v.string(),
  weekNumber: v.number(),
  weekStart: v.optional(v.string()),
  plan: v.number(),
  actual: v.optional(v.number()),
  weeklyForecast: v.optional(v.number()),
  accumulatedForecast: v.optional(v.number()),
});

const buildPlanRow = v.object({
  _id: v.string(),
  year: v.number(),
  quarter: v.string(),
  weekNumber: v.number(),
  weekStart: v.optional(v.string()),
  delivery: v.object({
    analyzer3600: v.optional(v.number()),
    analyzer5600: v.optional(v.number()),
    analyzer7600: v.optional(v.number()),
    vision: v.optional(v.number()),
    electrometer: v.optional(v.number()),
    irWash: v.optional(v.number()),
    total: v.optional(v.number()),
  }),
  capacity: v.object({
    meets: v.optional(v.number()),
    exceeds: v.optional(v.number()),
    capacity: v.optional(v.number()),
    delta: v.optional(v.number()),
    headCount: v.optional(v.number()),
    onboarding: v.optional(v.number()),
    inTraining: v.optional(v.number()),
    holidays: v.optional(v.number()),
    ptoDays: v.optional(v.number()),
  }),
  actuals: v.object({
    analyzer3600: v.optional(v.number()),
    analyzer5600: v.optional(v.number()),
    analyzer7600: v.optional(v.number()),
    vitrosVsPlan: v.optional(v.number()),
    vision: v.optional(v.number()),
    electrometer: v.optional(v.number()),
    irWash: v.optional(v.number()),
  }),
});

const namedValue = v.object({ name: v.string(), value: v.string() });
const staffPlanningRow = v.object({
  _id: v.string(),
  name: v.string(),
  role: v.optional(v.string()),
  wwid: v.optional(v.string()),
  fte: v.optional(v.number()),
  started: v.optional(v.string()),
  completeAfter: v.optional(v.string()),
  trainingUntil: v.optional(v.string()),
  comment: v.optional(v.string()),
  skills: v.array(namedValue),
  certifications: v.array(namedValue),
});

const targetPlanningRow = v.object({
  _id: v.string(),
  year: v.number(),
  targetType: v.string(),
  product: v.optional(v.string()),
  targetValue: v.number(),
  actualValue: v.number(),
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

const optionalNumber = (value: unknown) => {
  if (value === null || value === undefined || String(value).trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const optionalString = (value: unknown, max = 2000) => {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : undefined;
};

const objectValue = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

const namedValues = (value: unknown) => Object.entries(objectValue(value))
  .slice(0, 40)
  .map(([name, raw]) => ({ name: name.slice(0, 120), value: String(raw ?? "").slice(0, 300) }))
  .filter((entry) => entry.value.trim().length > 0);

const nestedNumbers = (value: unknown) => objectValue(value);

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

// Planning/staff reads intentionally tolerate the additive authoritative workbook
// migration by reading the server-only rows and normalizing both legacy JSONB
// storage and the newer promoted columns. This means the UI remains fail-safe
// before and after the migration without ever exposing the service-role key.
export const listPlanning = action({
  args: {},
  returns: v.object({
    trackerWeekly: v.array(trackerPlanningRow),
    buildPlan: v.array(buildPlanRow),
    staff: v.array(staffPlanningRow),
    targets: v.array(targetPlanningRow),
  }),
  handler: async (ctx) => {
    await requireCapability(ctx, "rem.read");
    const { url, serviceKey } = getSupabaseConfig();

    const [trackerRows, buildRows, staffRows, targetRows] = await Promise.all([
      readRows(url, serviceKey, "rem_tracker_weekly", "select=*&order=created_at.asc&limit=260"),
      readRows(url, serviceKey, "rem_build_plan", "select=*&order=created_at.asc&limit=80"),
      readRows(url, serviceKey, "rem_staff", "select=*&order=name.asc&limit=300"),
      readRows(url, serviceKey, "rem_targets", "select=*&order=year.desc,target_type.asc&limit=100"),
    ]);

    const trackerWeekly = trackerRows.map((raw) => {
      const row = raw as Record<string, unknown>;
      const data = objectValue(row.data);
      return {
        _id: String(row.id ?? ""),
        year: numberOrZero(row.plan_year ?? data.year),
        product: String(row.product ?? data.product ?? "").slice(0, 80),
        quarter: String(row.quarter ?? data.quarter ?? "").slice(0, 8),
        weekNumber: numberOrZero(row.week_number ?? data.weekNumber),
        weekStart: optionalString(row.week_start ?? data.weekStart, 40),
        plan: numberOrZero(data.plan),
        actual: optionalNumber(data.actual),
        weeklyForecast: optionalNumber(data.weeklyForecast),
        accumulatedForecast: optionalNumber(data.accumulatedForecast),
      };
    }).filter((row) => row.weekNumber >= 1 && row.weekNumber <= 53 && row.product.length > 0)
      .sort((a, b) => a.year - b.year || a.weekNumber - b.weekNumber || a.product.localeCompare(b.product));

    const buildPlan = buildRows.map((raw) => {
      const row = raw as Record<string, unknown>;
      const data = objectValue(row.data);
      const delivery = nestedNumbers(data.delivery);
      const capacity = nestedNumbers(data.capacity);
      const actuals = nestedNumbers(data.actuals);
      return {
        _id: String(row.id ?? ""),
        year: numberOrZero(row.plan_year ?? data.year),
        quarter: String(row.quarter ?? data.quarter ?? "").slice(0, 8),
        weekNumber: numberOrZero(row.week_number ?? data.weekNumber),
        weekStart: optionalString(row.week_start ?? data.weekStart, 40),
        delivery: {
          analyzer3600: optionalNumber(delivery.analyzer3600),
          analyzer5600: optionalNumber(delivery.analyzer5600),
          analyzer7600: optionalNumber(delivery.analyzer7600),
          vision: optionalNumber(delivery.vision),
          electrometer: optionalNumber(delivery.electrometer),
          irWash: optionalNumber(delivery.irWash),
          total: optionalNumber(delivery.total),
        },
        capacity: {
          meets: optionalNumber(capacity.meets),
          exceeds: optionalNumber(capacity.exceeds),
          capacity: optionalNumber(capacity.capacity),
          delta: optionalNumber(capacity.delta),
          headCount: optionalNumber(capacity.headCount),
          onboarding: optionalNumber(capacity.onboarding),
          inTraining: optionalNumber(capacity.inTraining),
          holidays: optionalNumber(capacity.holidays),
          ptoDays: optionalNumber(capacity.ptoDays),
        },
        actuals: {
          analyzer3600: optionalNumber(actuals.analyzer3600),
          analyzer5600: optionalNumber(actuals.analyzer5600),
          analyzer7600: optionalNumber(actuals.analyzer7600),
          vitrosVsPlan: optionalNumber(actuals.vitrosVsPlan),
          vision: optionalNumber(actuals.vision),
          electrometer: optionalNumber(actuals.electrometer),
          irWash: optionalNumber(actuals.irWash),
        },
      };
    }).filter((row) => row.weekNumber >= 1 && row.weekNumber <= 53)
      .sort((a, b) => a.year - b.year || a.weekNumber - b.weekNumber);

    const staff = staffRows.map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        _id: String(row.id ?? ""),
        name: String(row.name ?? "").slice(0, 160),
        role: optionalString(row.role, 120),
        wwid: optionalString(row.wwid, 20),
        fte: optionalNumber(row.fte),
        started: optionalString(row.started, 80),
        completeAfter: optionalString(row.complete_after, 80),
        trainingUntil: optionalString(row.training_until, 80),
        comment: optionalString(row.comment, 1000),
        skills: namedValues(row.skills),
        certifications: namedValues(row.certifications),
      };
    }).filter((row) => row.name.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name));

    const targets = targetRows.map((raw) => {
      const row = raw as Record<string, unknown>;
      const data = objectValue(row.data);
      const targetType = String(row.target_type ?? "").slice(0, 160);
      const product = optionalString(data.product, 80)
        ?? optionalString(targetType.replace(/_ANNUAL_PLAN$/i, ""), 80);
      return {
        _id: String(row.id ?? ""),
        year: numberOrZero(row.year),
        targetType,
        product,
        targetValue: numberOrZero(row.target_value),
        actualValue: numberOrZero(row.actual_value),
      };
    }).filter((row) => row.targetType.length > 0)
      .sort((a, b) => b.year - a.year || a.targetType.localeCompare(b.targetType));

    return { trackerWeekly, buildPlan, staff, targets };
  },
});
