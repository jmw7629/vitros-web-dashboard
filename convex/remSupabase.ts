// Server-side REM data gateway via Supabase.
// All reads/writes execute in Convex actions with server-only credentials.
// RBAC enforced via authGuard; audit logged for every mutation.
// Issue #48: strict validation, bounded structures, native JSONB persistence.

import { v } from "convex/values";
import { action } from "./_generated/server";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

// ─── Supabase helpers ───

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set server-side",
    );
  }
  return { url, serviceKey };
}

function sbHeaders(serviceKey: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

async function sbFetch<T>(
  serviceKey: string,
  url: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...sbHeaders(serviceKey), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      (body as { message?: string; error?: string }).message ||
      (body as { message?: string; error?: string }).error ||
      `Supabase error ${res.status}`;
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function idPath(table: string, id: string) {
  return `${table}?id=eq.${encodeURIComponent(id)}`;
}

// ─── Validation helpers ───

const MAX_NOTES_LENGTH = 5000;
const MAX_TEXT_LENGTH = 1000;
const MAX_FTE = 10;
const MAX_TARGET = 1_000_000;
const MAX_METRIC = 100_000;

function assertPercentage(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(
      `${field} must be a number between 0 and 100, got ${value}`,
    );
  }
}

function assertNonNegative(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number, got ${value}`);
  }
}

function assertBoundedNonNegative(value: number, field: string, max: number) {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`${field} must be between 0 and ${max}, got ${value}`);
  }
}

function assertBoundedText(value: string, field: string, maxLen: number) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  if (value.length > maxLen) {
    throw new Error(
      `${field} must be at most ${maxLen} characters, got ${value.length}`,
    );
  }
}

function assertDateString(value: string, field: string) {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }
  if (value && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    throw new Error(
      `${field} must be a valid date string (YYYY-MM-DD), got ${value}`,
    );
  }
}

// ─── Typed validation schemas ───

const certificationItem = v.object({
  name: v.string(),
  issueDate: v.optional(v.string()),
  expiryDate: v.optional(v.string()),
  isValid: v.optional(v.boolean()),
});

const analyzerFields = {
  serialNumber: v.string(),
  analyzerType: v.optional(v.string()),
  type: v.optional(v.string()),
  stage: v.optional(v.string()),
  progress: v.optional(v.number()),
  status: v.optional(v.string()),
  yearNumber: v.optional(v.string()),
  productionOrder: v.optional(v.string()),
  currentStage: v.optional(v.string()),
  overallPct: v.optional(v.number()),
  procurementPct: v.optional(v.number()),
  cleaningPct: v.optional(v.number()),
  servicePct: v.optional(v.number()),
  serviceCell: v.optional(v.string()),
  finalLinePct: v.optional(v.number()),
  releaseTestingPct: v.optional(v.number()),
  packagingPct: v.optional(v.number()),
  sapReleasePct: v.optional(v.number()),
  qaReleasePct: v.optional(v.number()),
  currentPct: v.optional(v.number()),
  slaDays: v.optional(v.number()),
  daysInStage: v.optional(v.number()),
  daysElapsed: v.optional(v.number()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  doneWeek: v.optional(v.string()),
  isComplete: v.optional(v.boolean()),
  installDate: v.optional(v.string()),
  installCountry: v.optional(v.string()),
  installStatus: v.optional(v.string()),
  installCost: v.optional(v.number()),
  fpyPercentage: v.optional(v.number()),
  releaseFPY: v.optional(v.number()),
  fieldStatus: v.optional(v.string()),
  country: v.optional(v.string()),
  fpy: v.optional(v.number()),
  notes: v.optional(v.string()),
};

const lvccFields = {
  serialNumber: v.optional(v.string()),
  itemId: v.optional(v.string()),
  itemType: v.optional(v.string()),
  category: v.optional(v.string()),
  batchNumber: v.optional(v.string()),
  quantity: v.optional(v.number()),
  currentStage: v.optional(v.string()),
  buildPct: v.optional(v.number()),
  testPct: v.optional(v.number()),
  packagingPct: v.optional(v.number()),
  sapReleasePct: v.optional(v.number()),
  qaReleasePct: v.optional(v.number()),
  startDate: v.optional(v.string()),
  endDate: v.optional(v.string()),
  isComplete: v.optional(v.boolean()),
  status: v.optional(v.string()),
  progress: v.optional(v.number()),
};

const targetFields = {
  type: v.string(),
  target: v.number(),
  completed: v.number(),
};

const staffFields = {
  name: v.string(),
  role: v.string(),
  fte: v.optional(v.number()),
  certifications: v.optional(v.array(certificationItem)),
  skills: v.optional(v.record(v.string(), v.string())),
  isLead: v.optional(v.boolean()),
  inTraining: v.optional(v.boolean()),
};

const weeklyNoteFields = {
  weekNumber: v.optional(v.number()),
  weekStart: v.optional(v.string()),
  quarter: v.optional(v.string()),
  notes: v.optional(
    v.array(
      v.object({
        product: v.string(),
        content: v.string(),
      }),
    ),
  ),
};

const buildPlanFields = {
  weekOf: v.string(),
  planned: v.number(),
  actual: v.number(),
  notes: v.optional(v.string()),
};

const trackerWeeklyFields = {
  weekOf: v.string(),
  teardown: v.number(),
  cleaning: v.number(),
  rebuild: v.number(),
  testing: v.number(),
  qa: v.number(),
  shipping: v.number(),
  complete: v.number(),
};

// ─── Business validation ───

function validateAnalyzerWrite(
  data: Record<string, unknown>,
  isInsert: boolean,
) {
  if (isInsert && !data.serial_number) {
    throw new Error("serial_number is required");
  }
  const pctFields = [
    "progress",
    "overall_pct",
    "procurement_pct",
    "cleaning_pct",
    "service_pct",
    "final_line_pct",
    "release_testing_pct",
    "packaging_pct",
    "sap_release_pct",
    "qa_release_pct",
    "current_pct",
    "fpy_percentage",
    "release_fpy",
    "fpy",
  ];
  for (const field of pctFields) {
    const val = data[field];
    if (val !== undefined && val !== null) {
      assertPercentage(Number(val), field);
    }
  }
  const nonNegFields = [
    "sla_days",
    "days_in_stage",
    "days_elapsed",
    "install_cost",
  ];
  for (const field of nonNegFields) {
    const val = data[field];
    if (val !== undefined && val !== null) {
      assertBoundedNonNegative(Number(val), field, MAX_METRIC);
    }
  }
  if (data.notes !== undefined && data.notes !== null) {
    assertBoundedText(String(data.notes), "notes", MAX_NOTES_LENGTH);
  }
  const dateFields = ["start_date", "end_date", "install_date"];
  for (const field of dateFields) {
    const val = data[field];
    if (val !== undefined && val !== null && val !== "") {
      assertDateString(String(val), field);
    }
  }
  const textFieldMax = [
    "serial_number",
    "analyzer_type",
    "type",
    "stage",
    "status",
    "year_number",
    "production_order",
    "current_stage",
    "service_cell",
    "done_week",
    "install_country",
    "install_status",
    "field_status",
    "country",
  ];
  for (const field of textFieldMax) {
    const val = data[field];
    if (val !== undefined && val !== null && val !== "") {
      assertBoundedText(String(val), field, MAX_TEXT_LENGTH);
    }
  }
}

function validateTargetWrite(data: Record<string, unknown>) {
  assertBoundedNonNegative(Number(data.target), "target", MAX_TARGET);
  assertBoundedNonNegative(Number(data.completed), "completed", MAX_TARGET);
  assertBoundedText(String(data.type), "type", MAX_TEXT_LENGTH);
}

function validateStaffWrite(data: Record<string, unknown>) {
  if (data.fte !== undefined && data.fte !== null) {
    assertBoundedNonNegative(Number(data.fte), "fte", MAX_FTE);
  }
  assertBoundedText(String(data.name), "name", MAX_TEXT_LENGTH);
  assertBoundedText(String(data.role), "role", MAX_TEXT_LENGTH);
  if (data.certifications !== undefined && data.certifications !== null) {
    const certs = data.certifications as unknown[];
    if (!Array.isArray(certs) || certs.length > 50) {
      throw new Error("certifications must be an array with at most 50 items");
    }
  }
  if (data.skills !== undefined && data.skills !== null) {
    const skills = data.skills as Record<string, unknown>;
    const keys = Object.keys(skills);
    if (keys.length > 100) {
      throw new Error("skills must have at most 100 entries");
    }
    for (const [k, v] of Object.entries(skills)) {
      assertBoundedText(k, `skill key`, MAX_TEXT_LENGTH);
      if (typeof v === "string") {
        assertBoundedText(v, `skill[${k}]`, MAX_TEXT_LENGTH);
      }
    }
  }
}

function validateBuildPlanWrite(data: Record<string, unknown>) {
  assertNonNegative(Number(data.planned), "planned");
  assertNonNegative(Number(data.actual), "actual");
  assertBoundedText(String(data.weekOf), "weekOf", MAX_TEXT_LENGTH);
  if (data.notes !== undefined && data.notes !== null) {
    assertBoundedText(String(data.notes), "notes", MAX_NOTES_LENGTH);
  }
}

function validateTrackerWeeklyWrite(data: Record<string, unknown>) {
  const metrics = [
    "teardown",
    "cleaning",
    "rebuild",
    "testing",
    "qa",
    "shipping",
    "complete",
  ];
  for (const m of metrics) {
    assertNonNegative(Number(data[m]), m);
  }
  assertBoundedText(String(data.weekOf), "weekOf", MAX_TEXT_LENGTH);
}

function validateWeeklyNotesWrite(data: Record<string, unknown>) {
  if (data.weekNumber !== undefined && data.weekNumber !== null) {
    assertNonNegative(Number(data.weekNumber), "weekNumber");
  }
  if (data.weekStart !== undefined && data.weekStart !== null) {
    assertDateString(String(data.weekStart), "weekStart");
  }
  if (data.notes !== undefined && data.notes !== null) {
    const notes = data.notes as unknown[];
    if (!Array.isArray(notes) || notes.length > 200) {
      throw new Error("notes must be an array with at most 200 items");
    }
    for (const n of notes) {
      const note = n as Record<string, unknown>;
      if (!note.product || typeof note.product !== "string") {
        throw new Error("each note must have a string product field");
      }
      if (!note.content || typeof note.content !== "string") {
        throw new Error("each note must have a string content field");
      }
      assertBoundedText(String(note.content), "note content", MAX_NOTES_LENGTH);
    }
  }
}

// ─── Row-to-Type mapping (Supabase snake_case → App camelCase) ───

function mapAnalyzerRow(row: Record<string, unknown>) {
  return {
    _id: row.id,
    serialNumber: row.serial_number ?? "",
    analyzerType: row.analyzer_type ?? "",
    type: row.type ?? "",
    stage: row.stage ?? "",
    progress: Number(row.progress) || 0,
    status: row.status ?? "",
    yearNumber: row.year_number ?? "",
    productionOrder: row.production_order ?? "",
    currentStage: row.current_stage ?? "",
    overallPct: Number(row.overall_pct) || 0,
    procurementPct: Number(row.procurement_pct) || 0,
    cleaningPct: Number(row.cleaning_pct) || 0,
    servicePct: Number(row.service_pct) || 0,
    serviceCell: row.service_cell ?? "",
    finalLinePct: Number(row.final_line_pct) || 0,
    releaseTestingPct: Number(row.release_testing_pct) || 0,
    packagingPct: Number(row.packaging_pct) || 0,
    sapReleasePct: Number(row.sap_release_pct) || 0,
    qaReleasePct: Number(row.qa_release_pct) || 0,
    currentPct: Number(row.current_pct) || 0,
    slaDays: Number(row.sla_days) || 0,
    daysInStage: Number(row.days_in_stage) || 0,
    daysElapsed: Number(row.days_elapsed) || 0,
    startDate: row.start_date ?? "",
    endDate: row.end_date ?? "",
    doneWeek: row.done_week ?? "",
    isComplete: row.is_complete ?? false,
    installDate: row.install_date ?? "",
    installCountry: row.install_country ?? "",
    installStatus: row.install_status ?? "",
    installCost: Number(row.install_cost) || 0,
    fpyPercentage: Number(row.fpy_percentage) || 0,
    releaseFPY: Number(row.release_fpy) || 0,
    fieldStatus: row.field_status ?? "",
    country: row.country ?? "",
    fpy: Number(row.fpy) || 0,
    notes: row.notes ?? "",
  };
}

function mapLvccRow(row: Record<string, unknown>) {
  return {
    _id: row.id,
    serialNumber: row.serial_number ?? "",
    batchNumber: row.batch_number ?? "",
    itemType: row.item_type ?? "",
    currentStage: row.current_stage ?? "",
    startDate: row.start_date ?? "",
    endDate: row.end_date ?? "",
    isComplete: row.is_complete ?? false,
    buildPct: Number(row.build_pct) || 0,
    testPct: Number(row.test_pct) || 0,
    packagingPct: Number(row.packaging_pct) || 0,
    qaReleasePct: Number(row.qa_release_pct) || 0,
    sapReleasePct: Number(row.sap_release_pct) || 0,
  };
}

function mapTargetRow(row: Record<string, unknown>) {
  return {
    _id: row.id,
    type: row.type ?? "",
    target: Number(row.target) || 0,
    completed: Number(row.completed) || 0,
  };
}

function mapStaffRow(row: Record<string, unknown>) {
  let skills: Record<string, string> = {};
  if (
    row.skills &&
    typeof row.skills === "object" &&
    !Array.isArray(row.skills)
  ) {
    skills = row.skills as Record<string, string>;
  }
  return {
    _id: row.id,
    name: row.name ?? "",
    role: row.role ?? "",
    fte: Number(row.fte) || 0,
    certifications: Array.isArray(row.certifications) ? row.certifications : [],
    skills,
    isLead: row.is_lead ?? false,
    inTraining: row.in_training ?? false,
  };
}

function mapWeeklyNoteRow(row: Record<string, unknown>) {
  let notes: { content: string; product: string }[] = [];
  if (Array.isArray(row.notes)) {
    notes = row.notes as { content: string; product: string }[];
  }
  return {
    _id: row.id,
    weekStart: row.week_start ?? "",
    weekNumber: Number(row.week_number) || 0,
    quarter: row.quarter ?? "",
    notes,
  };
}

function mapBuildPlanRow(row: Record<string, unknown>) {
  return {
    _id: row.id,
    weekOf: row.week_of ?? "",
    planned: Number(row.planned) || 0,
    actual: Number(row.actual) || 0,
    notes: row.notes ?? "",
  };
}

function mapTrackerRow(row: Record<string, unknown>) {
  return {
    _id: row.id,
    weekOf: row.week_of ?? "",
    teardown: Number(row.teardown) || 0,
    cleaning: Number(row.cleaning) || 0,
    rebuild: Number(row.rebuild) || 0,
    testing: Number(row.testing) || 0,
    qa: Number(row.qa) || 0,
    shipping: Number(row.shipping) || 0,
    complete: Number(row.complete) || 0,
  };
}

// ─── Read actions (rem.read) ───

export const listAnalyzers = action({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await requireCapability(ctx, "rem.read");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      "rem_analyzers?select=*&order=serial_number.asc",
    );
    return rows.map(mapAnalyzerRow);
  },
});

export const getAnalyzerBySerial = action({
  args: { serialNumber: v.string() },
  returns: v.any(),
  handler: async (ctx, { serialNumber }) => {
    await requireCapability(ctx, "rem.read");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      `rem_analyzers?serial_number=eq.${encodeURIComponent(serialNumber)}&select=*`,
    );
    return rows.length > 0 ? mapAnalyzerRow(rows[0]) : null;
  },
});

export const listLvccItems = action({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await requireCapability(ctx, "rem.read");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      "rem_lvcc?select=*&order=serial_number.asc",
    );
    return rows.map(mapLvccRow);
  },
});

export const listTargets = action({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await requireCapability(ctx, "rem.read");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      "rem_targets?select=*&order=type.asc",
    );
    return rows.map(mapTargetRow);
  },
});

export const listStaff = action({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await requireCapability(ctx, "rem.read");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      "rem_staff?select=*&order=name.asc",
    );
    return rows.map(mapStaffRow);
  },
});

export const listWeeklyNotes = action({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await requireCapability(ctx, "rem.read");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      "rem_weekly_notes?select=*&order=week_start.desc",
    );
    return rows.map(mapWeeklyNoteRow);
  },
});

export const listBuildPlan = action({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await requireCapability(ctx, "rem.read");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      "rem_build_plan?select=*&order=week_of.desc",
    );
    return rows.map(mapBuildPlanRow);
  },
});

export const listTrackerWeekly = action({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await requireCapability(ctx, "rem.read");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      "rem_tracker_weekly?select=*&order=week_of.desc",
    );
    return rows.map(mapTrackerRow);
  },
});

// ─── Audit helper ───

async function insertAuditEntry(
  serviceKey: string,
  url: string,
  tableName: string,
  recordId: string,
  operation: string,
  actorId: string,
  actorRole: string,
  beforeState: Record<string, unknown> | null,
  afterState: Record<string, unknown> | null,
) {
  const entry = {
    table_name: tableName,
    record_id: recordId,
    operation,
    actor_id: actorId,
    actor_role: actorRole,
    before_state: beforeState,
    after_state: afterState,
  };
  await sbFetch<unknown[]>(serviceKey, url, "audit_rem", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(entry),
  });
}

// ─── Write actions (rem.write + RBAC + audit + validation) ───

export const updateAnalyzer = action({
  args: {
    id: v.string(),
    stage: v.optional(v.string()),
    progress: v.optional(v.number()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
    currentStage: v.optional(v.string()),
    overallPct: v.optional(v.number()),
    isComplete: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "rem.write");
    const { url, serviceKey } = getSupabaseConfig();

    // Fetch current state for audit
    const currentRows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      `rem_analyzers?id=eq.${encodeURIComponent(args.id)}&select=*`,
    );
    if (currentRows.length === 0) throw new Error("Analyzer not found");
    const beforeState = currentRows[0];

    // Build update payload — only non-undefined fields
    const updates: Record<string, unknown> = {};
    if (args.stage !== undefined) updates.stage = args.stage;
    if (args.progress !== undefined) {
      assertPercentage(args.progress, "progress");
      updates.progress = args.progress;
    }
    if (args.status !== undefined) updates.status = args.status;
    if (args.notes !== undefined) {
      assertBoundedText(args.notes, "notes", MAX_NOTES_LENGTH);
      updates.notes = args.notes;
    }
    if (args.currentStage !== undefined)
      updates.current_stage = args.currentStage;
    if (args.overallPct !== undefined) {
      assertPercentage(args.overallPct, "overallPct");
      updates.overall_pct = args.overallPct;
    }
    if (args.isComplete !== undefined) updates.is_complete = args.isComplete;

    if (Object.keys(updates).length === 0) {
      throw new Error("No valid fields supplied for update");
    }

    await sbFetch<void>(serviceKey, url, idPath("rem_analyzers", args.id), {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(updates),
    });

    // Fetch after state for audit
    const afterRows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      `rem_analyzers?id=eq.${encodeURIComponent(args.id)}&select=*`,
    );
    const afterState = afterRows.length > 0 ? afterRows[0] : null;

    // Get server-authoritative actor identity
    const role = await ctx.runQuery(
      (await import("./_generated/api")).internal.users.getUserRole,
      { userId },
    );

    await insertAuditEntry(
      serviceKey,
      url,
      "rem_analyzers",
      args.id,
      "UPDATE",
      userId,
      role || "unknown",
      beforeState,
      afterState,
    );

    return { success: true, id: args.id };
  },
});

export const insertAnalyzer = action({
  args: { data: v.object(analyzerFields) },
  returns: v.any(),
  handler: async (ctx, { data }) => {
    const userId = await requireCapability(ctx, "rem.write");
    const { url, serviceKey } = getSupabaseConfig();

    const payload: Record<string, unknown> = {
      serial_number: data.serialNumber,
      analyzer_type: data.analyzerType ?? null,
      type: data.type ?? null,
      stage: data.stage ?? null,
      progress: data.progress ?? null,
      status: data.status ?? null,
      year_number: data.yearNumber ?? null,
      production_order: data.productionOrder ?? null,
      current_stage: data.currentStage ?? null,
      overall_pct: data.overallPct ?? 0,
      procurement_pct: data.procurementPct ?? 0,
      cleaning_pct: data.cleaningPct ?? 0,
      service_pct: data.servicePct ?? 0,
      service_cell: data.serviceCell ?? null,
      final_line_pct: data.finalLinePct ?? 0,
      release_testing_pct: data.releaseTestingPct ?? 0,
      packaging_pct: data.packagingPct ?? 0,
      sap_release_pct: data.sapReleasePct ?? 0,
      qa_release_pct: data.qaReleasePct ?? 0,
      current_pct: data.currentPct ?? 0,
      sla_days: data.slaDays ?? 0,
      days_in_stage: data.daysInStage ?? 0,
      days_elapsed: data.daysElapsed ?? 0,
      start_date: data.startDate ?? null,
      end_date: data.endDate ?? null,
      done_week: data.doneWeek ?? null,
      is_complete: data.isComplete ?? false,
      install_date: data.installDate ?? null,
      install_country: data.installCountry ?? null,
      install_status: data.installStatus ?? null,
      install_cost: data.installCost ?? null,
      fpy_percentage: data.fpyPercentage ?? null,
      release_fpy: data.releaseFPY ?? null,
      field_status: data.fieldStatus ?? null,
      country: data.country ?? null,
      fpy: data.fpy ?? null,
      notes: data.notes ?? null,
    };

    validateAnalyzerWrite(payload, true);

    const rows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      "rem_analyzers",
      {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(payload),
      },
    );

    const role = await ctx.runQuery(
      (await import("./_generated/api")).internal.users.getUserRole,
      { userId },
    );

    await insertAuditEntry(
      serviceKey,
      url,
      "rem_analyzers",
      rows[0].id as string,
      "INSERT",
      userId,
      role || "unknown",
      null,
      rows[0],
    );

    return { success: true, id: rows[0].id };
  },
});

export const deleteAnalyzer = action({
  args: { id: v.string() },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const userId = await requireCapability(ctx, "rem.write");
    const { url, serviceKey } = getSupabaseConfig();

    const currentRows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      `rem_analyzers?id=eq.${encodeURIComponent(id)}&select=*`,
    );
    if (currentRows.length === 0) throw new Error("Analyzer not found");

    await sbFetch<void>(serviceKey, url, idPath("rem_analyzers", id), {
      method: "DELETE",
    });

    const role = await ctx.runQuery(
      (await import("./_generated/api")).internal.users.getUserRole,
      { userId },
    );

    await insertAuditEntry(
      serviceKey,
      url,
      "rem_analyzers",
      id,
      "DELETE",
      userId,
      role || "unknown",
      currentRows[0],
      null,
    );

    return { success: true };
  },
});

// ─── LVCC mutations ───

export const updateLvccItem = action({
  args: {
    id: v.string(),
    data: v.object(lvccFields),
  },
  returns: v.any(),
  handler: async (ctx, { id, data }) => {
    const userId = await requireCapability(ctx, "rem.write");
    const { url, serviceKey } = getSupabaseConfig();

    const currentRows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      `rem_lvcc?id=eq.${encodeURIComponent(id)}&select=*`,
    );
    if (currentRows.length === 0) throw new Error("LVCC item not found");

    const updates: Record<string, unknown> = {};
    if (data.serialNumber !== undefined)
      updates.serial_number = data.serialNumber;
    if (data.itemType !== undefined) updates.item_type = data.itemType;
    if (data.batchNumber !== undefined) updates.batch_number = data.batchNumber;
    if (data.currentStage !== undefined)
      updates.current_stage = data.currentStage;
    if (data.buildPct !== undefined) {
      assertPercentage(data.buildPct, "buildPct");
      updates.build_pct = data.buildPct;
    }
    if (data.testPct !== undefined) {
      assertPercentage(data.testPct, "testPct");
      updates.test_pct = data.testPct;
    }
    if (data.packagingPct !== undefined) {
      assertPercentage(data.packagingPct, "packagingPct");
      updates.packaging_pct = data.packagingPct;
    }
    if (data.qaReleasePct !== undefined) {
      assertPercentage(data.qaReleasePct, "qaReleasePct");
      updates.qa_release_pct = data.qaReleasePct;
    }
    if (data.sapReleasePct !== undefined) {
      assertPercentage(data.sapReleasePct, "sapReleasePct");
      updates.sap_release_pct = data.sapReleasePct;
    }
    if (data.startDate !== undefined) updates.start_date = data.startDate;
    if (data.endDate !== undefined) updates.end_date = data.endDate;
    if (data.isComplete !== undefined) updates.is_complete = data.isComplete;
    if (data.status !== undefined) updates.status = data.status;
    if (data.progress !== undefined) {
      assertPercentage(data.progress, "progress");
      updates.progress = data.progress;
    }

    if (Object.keys(updates).length === 0) {
      throw new Error("No valid fields supplied for update");
    }

    await sbFetch<void>(serviceKey, url, idPath("rem_lvcc", id), {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(updates),
    });

    const role = await ctx.runQuery(
      (await import("./_generated/api")).internal.users.getUserRole,
      { userId },
    );

    await insertAuditEntry(
      serviceKey,
      url,
      "rem_lvcc",
      id,
      "UPDATE",
      userId,
      role || "unknown",
      currentRows[0],
      { ...currentRows[0], ...updates },
    );

    return { success: true };
  },
});

// ─── Target mutations ───

export const upsertTarget = action({
  args: { data: v.object(targetFields) },
  returns: v.any(),
  handler: async (ctx, { data }) => {
    const userId = await requireCapability(ctx, "rem.write");
    const { url, serviceKey } = getSupabaseConfig();

    validateTargetWrite({
      type: data.type,
      target: data.target,
      completed: data.completed,
    });

    // Check existing
    const existing = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      `rem_targets?type=eq.${encodeURIComponent(data.type)}&select=id`,
    );

    const payload = {
      type: data.type,
      target: data.target,
      completed: data.completed,
    };

    let recordId: string;
    if (existing.length > 0) {
      recordId = existing[0].id as string;
      await sbFetch<void>(serviceKey, url, idPath("rem_targets", recordId), {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(payload),
      });
    } else {
      const rows = await sbFetch<Record<string, unknown>[]>(
        serviceKey,
        url,
        "rem_targets",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            ...payload,
            created_at: new Date().toISOString(),
          }),
        },
      );
      recordId = rows[0].id as string;
    }

    const role = await ctx.runQuery(
      (await import("./_generated/api")).internal.users.getUserRole,
      { userId },
    );

    await insertAuditEntry(
      serviceKey,
      url,
      "rem_targets",
      recordId,
      existing.length > 0 ? "UPDATE" : "INSERT",
      userId,
      role || "unknown",
      existing.length > 0 ? (existing[0] as Record<string, unknown>) : null,
      payload,
    );

    return { success: true, id: recordId };
  },
});

// ─── Weekly notes mutations ───

export const upsertWeeklyNotes = action({
  args: { data: v.object(weeklyNoteFields) },
  returns: v.any(),
  handler: async (ctx, { data }) => {
    const userId = await requireCapability(ctx, "rem.write");
    const { url, serviceKey } = getSupabaseConfig();

    validateWeeklyNotesWrite({
      weekNumber: data.weekNumber,
      weekStart: data.weekStart,
      quarter: data.quarter,
      notes: data.notes,
    });

    // Persist JSONB as native object/array, NOT as JSON.stringify string
    const payload: Record<string, unknown> = {
      week_number: data.weekNumber ?? null,
      week_start: data.weekStart ?? null,
      quarter: data.quarter ?? null,
      notes: data.notes ?? null,
    };

    // Find existing by week_start
    let recordId: string;
    let beforeState: Record<string, unknown> | null = null;
    if (data.weekStart) {
      const existing = await sbFetch<Record<string, unknown>[]>(
        serviceKey,
        url,
        `rem_weekly_notes?week_start=eq.${encodeURIComponent(data.weekStart)}&select=id`,
      );
      if (existing.length > 0) {
        recordId = existing[0].id as string;
        beforeState = existing[0];
        await sbFetch<void>(
          serviceKey,
          url,
          idPath("rem_weekly_notes", recordId),
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify(payload),
          },
        );
      } else {
        const rows = await sbFetch<Record<string, unknown>[]>(
          serviceKey,
          url,
          "rem_weekly_notes",
          {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({
              ...payload,
              created_at: new Date().toISOString(),
            }),
          },
        );
        recordId = rows[0].id as string;
      }
    } else {
      const rows = await sbFetch<Record<string, unknown>[]>(
        serviceKey,
        url,
        "rem_weekly_notes",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            ...payload,
            created_at: new Date().toISOString(),
          }),
        },
      );
      recordId = rows[0].id as string;
    }

    const role = await ctx.runQuery(
      (await import("./_generated/api")).internal.users.getUserRole,
      { userId },
    );

    await insertAuditEntry(
      serviceKey,
      url,
      "rem_weekly_notes",
      recordId,
      beforeState ? "UPDATE" : "INSERT",
      userId,
      role || "unknown",
      beforeState,
      payload,
    );

    return { success: true, id: recordId };
  },
});

// ─── Build plan mutations ───

export const upsertBuildPlan = action({
  args: { data: v.object(buildPlanFields) },
  returns: v.any(),
  handler: async (ctx, { data }) => {
    const userId = await requireCapability(ctx, "rem.write");
    const { url, serviceKey } = getSupabaseConfig();

    validateBuildPlanWrite({
      weekOf: data.weekOf,
      planned: data.planned,
      actual: data.actual,
      notes: data.notes,
    });

    const existing = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      `rem_build_plan?week_of=eq.${encodeURIComponent(data.weekOf)}&select=id`,
    );

    const payload = {
      week_of: data.weekOf,
      planned: data.planned,
      actual: data.actual,
      notes: data.notes ?? null,
    };

    let recordId: string;
    if (existing.length > 0) {
      recordId = existing[0].id as string;
      await sbFetch<void>(serviceKey, url, idPath("rem_build_plan", recordId), {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(payload),
      });
    } else {
      const rows = await sbFetch<Record<string, unknown>[]>(
        serviceKey,
        url,
        "rem_build_plan",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            ...payload,
            created_at: new Date().toISOString(),
          }),
        },
      );
      recordId = rows[0].id as string;
    }

    const role = await ctx.runQuery(
      (await import("./_generated/api")).internal.users.getUserRole,
      { userId },
    );

    await insertAuditEntry(
      serviceKey,
      url,
      "rem_build_plan",
      recordId,
      existing.length > 0 ? "UPDATE" : "INSERT",
      userId,
      role || "unknown",
      existing.length > 0 ? (existing[0] as Record<string, unknown>) : null,
      payload,
    );

    return { success: true, id: recordId };
  },
});

// ─── Tracker weekly mutations ───

export const upsertTrackerWeekly = action({
  args: { data: v.object(trackerWeeklyFields) },
  returns: v.any(),
  handler: async (ctx, { data }) => {
    const userId = await requireCapability(ctx, "rem.write");
    const { url, serviceKey } = getSupabaseConfig();

    validateTrackerWeeklyWrite({
      weekOf: data.weekOf,
      teardown: data.teardown,
      cleaning: data.cleaning,
      rebuild: data.rebuild,
      testing: data.testing,
      qa: data.qa,
      shipping: data.shipping,
      complete: data.complete,
    });

    const existing = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      `rem_tracker_weekly?week_of=eq.${encodeURIComponent(data.weekOf)}&select=id`,
    );

    const payload = {
      week_of: data.weekOf,
      teardown: data.teardown,
      cleaning: data.cleaning,
      rebuild: data.rebuild,
      testing: data.testing,
      qa: data.qa,
      shipping: data.shipping,
      complete: data.complete,
    };

    let recordId: string;
    if (existing.length > 0) {
      recordId = existing[0].id as string;
      await sbFetch<void>(
        serviceKey,
        url,
        idPath("rem_tracker_weekly", recordId),
        {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(payload),
        },
      );
    } else {
      const rows = await sbFetch<Record<string, unknown>[]>(
        serviceKey,
        url,
        "rem_tracker_weekly",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            ...payload,
            created_at: new Date().toISOString(),
          }),
        },
      );
      recordId = rows[0].id as string;
    }

    const role = await ctx.runQuery(
      (await import("./_generated/api")).internal.users.getUserRole,
      { userId },
    );

    await insertAuditEntry(
      serviceKey,
      url,
      "rem_tracker_weekly",
      recordId,
      existing.length > 0 ? "UPDATE" : "INSERT",
      userId,
      role || "unknown",
      existing.length > 0 ? (existing[0] as Record<string, unknown>) : null,
      payload,
    );

    return { success: true, id: recordId };
  },
});

// ─── Staff mutations ───

export const upsertStaff = action({
  args: { data: v.object(staffFields) },
  returns: v.any(),
  handler: async (ctx, { data }) => {
    const userId = await requireCapability(ctx, "rem.write");
    const { url, serviceKey } = getSupabaseConfig();

    validateStaffWrite({
      name: data.name,
      role: data.role,
      fte: data.fte,
      certifications: data.certifications,
      skills: data.skills,
    });

    // Find by name
    const existing = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      `rem_staff?name=eq.${encodeURIComponent(data.name)}&select=id`,
    );

    // Persist JSONB as native objects/arrays, NOT as JSON.stringify strings
    const payload: Record<string, unknown> = {
      name: data.name,
      role: data.role,
      fte: data.fte ?? null,
      certifications: data.certifications ?? null,
      skills: data.skills ?? null,
      is_lead: data.isLead ?? false,
      in_training: data.inTraining ?? false,
    };

    let recordId: string;
    if (existing.length > 0) {
      recordId = existing[0].id as string;
      await sbFetch<void>(serviceKey, url, idPath("rem_staff", recordId), {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(payload),
      });
    } else {
      const rows = await sbFetch<Record<string, unknown>[]>(
        serviceKey,
        url,
        "rem_staff",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            ...payload,
            created_at: new Date().toISOString(),
          }),
        },
      );
      recordId = rows[0].id as string;
    }

    const role = await ctx.runQuery(
      (await import("./_generated/api")).internal.users.getUserRole,
      { userId },
    );

    await insertAuditEntry(
      serviceKey,
      url,
      "rem_staff",
      recordId,
      existing.length > 0 ? "UPDATE" : "INSERT",
      userId,
      role || "unknown",
      existing.length > 0 ? (existing[0] as Record<string, unknown>) : null,
      payload,
    );

    return { success: true, id: recordId };
  },
});
