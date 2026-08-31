// Server-side REM data gateway via Supabase.
// All reads/writes execute in Convex actions with server-only credentials.
// RBAC enforced via authGuard; audit logged for every mutation.

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

// ─── Typed validation schemas ───

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
  certifications: v.optional(v.any()),
  skills: v.optional(v.any()),
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

// ─── Row-to-Type mapping (Supabase snake_case → App camelCase) ───

function mapAnalyzerRow(row: any) {
  return {
    _id: row.id,
    serialNumber: row.serial_number || "",
    analyzerType: row.analyzer_type || "",
    type: row.type || "",
    stage: row.stage || "",
    progress: Number(row.progress) || 0,
    status: row.status || "",
    yearNumber: row.year_number || "",
    productionOrder: row.production_order || "",
    currentStage: row.current_stage || "",
    overallPct: Number(row.overall_pct) || 0,
    procurementPct: Number(row.procurement_pct) || 0,
    cleaningPct: Number(row.cleaning_pct) || 0,
    servicePct: Number(row.service_pct) || 0,
    serviceCell: row.service_cell || "",
    finalLinePct: Number(row.final_line_pct) || 0,
    releaseTestingPct: Number(row.release_testing_pct) || 0,
    packagingPct: Number(row.packaging_pct) || 0,
    sapReleasePct: Number(row.sap_release_pct) || 0,
    qaReleasePct: Number(row.qa_release_pct) || 0,
    currentPct: Number(row.current_pct) || 0,
    slaDays: Number(row.sla_days) || 0,
    daysInStage: Number(row.days_in_stage) || 0,
    daysElapsed: Number(row.days_elapsed) || 0,
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    doneWeek: row.done_week || "",
    isComplete: row.is_complete ?? false,
    installDate: row.install_date || "",
    installCountry: row.install_country || "",
    installStatus: row.install_status || "",
    installCost: Number(row.install_cost) || 0,
    fpyPercentage: Number(row.fpy_percentage) || 0,
    releaseFPY: Number(row.release_fpy) || 0,
    fieldStatus: row.field_status || "",
    country: row.country || "",
    fpy: Number(row.fpy) || 0,
    notes: row.notes || "",
  };
}

function mapLvccRow(row: any) {
  return {
    _id: row.id,
    serialNumber: row.serial_number || "",
    batchNumber: row.batch_number || "",
    itemType: row.item_type || "",
    currentStage: row.current_stage || "",
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    isComplete: row.is_complete ?? false,
    buildPct: Number(row.build_pct) || 0,
    testPct: Number(row.test_pct) || 0,
    packagingPct: Number(row.packaging_pct) || 0,
    qaReleasePct: Number(row.qa_release_pct) || 0,
    sapReleasePct: Number(row.sap_release_pct) || 0,
  };
}

function mapTargetRow(row: any) {
  return {
    _id: row.id,
    type: row.type || "",
    target: Number(row.target) || 0,
    completed: Number(row.completed) || 0,
  };
}

function mapStaffRow(row: any) {
  return {
    _id: row.id,
    name: row.name || "",
    role: row.role || "",
    skills: (row.skills || {}) as Record<string, string>,
  };
}

function mapWeeklyNoteRow(row: any) {
  return {
    _id: row.id,
    weekStart: row.week_start || "",
    weekNumber: Number(row.week_number) || 0,
    quarter: row.quarter || "",
    notes: (row.notes || []) as { content: string; product: string }[],
  };
}

function mapBuildPlanRow(row: any) {
  return {
    _id: row.id,
    weekOf: row.week_of || "",
    planned: Number(row.planned) || 0,
    actual: Number(row.actual) || 0,
    notes: row.notes || "",
  };
}

function mapTrackerRow(row: any) {
  return {
    _id: row.id,
    weekOf: row.week_of || "",
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
    const rows = await sbFetch<any[]>(
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
    const rows = await sbFetch<any[]>(
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
    const rows = await sbFetch<any[]>(
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
    const rows = await sbFetch<any[]>(
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
    const rows = await sbFetch<any[]>(
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
    const rows = await sbFetch<any[]>(
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
    const rows = await sbFetch<any[]>(
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
    const rows = await sbFetch<any[]>(
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
  await sbFetch<any[]>(serviceKey, url, "audit_rem", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(entry),
  });
}

// ─── Write actions (rem.write + RBAC + audit) ───

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
    const currentRows = await sbFetch<any[]>(
      serviceKey,
      url,
      `rem_analyzers?id=eq.${encodeURIComponent(args.id)}&select=*`,
    );
    if (currentRows.length === 0) throw new Error("Analyzer not found");
    const beforeState = currentRows[0];

    // Build update payload — only non-undefined fields
    const updates: Record<string, unknown> = {};
    if (args.stage !== undefined) updates.stage = args.stage;
    if (args.progress !== undefined) updates.progress = args.progress;
    if (args.status !== undefined) updates.status = args.status;
    if (args.notes !== undefined) updates.notes = args.notes;
    if (args.currentStage !== undefined)
      updates.current_stage = args.currentStage;
    if (args.overallPct !== undefined) updates.overall_pct = args.overallPct;
    if (args.isComplete !== undefined) updates.is_complete = args.isComplete;
    updates.updated_at = new Date().toISOString();

    if (Object.keys(updates).length <= 1) {
      throw new Error("No valid fields supplied for update");
    }

    await sbFetch<void>(serviceKey, url, idPath("rem_analyzers", args.id), {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(updates),
    });

    // Fetch after state for audit
    const afterRows = await sbFetch<any[]>(
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

    const rows = await sbFetch<any[]>(serviceKey, url, "rem_analyzers", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });

    const role = await ctx.runQuery(
      (await import("./_generated/api")).internal.users.getUserRole,
      { userId },
    );

    await insertAuditEntry(
      serviceKey,
      url,
      "rem_analyzers",
      rows[0].id,
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

    const currentRows = await sbFetch<any[]>(
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

    const currentRows = await sbFetch<any[]>(
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
    if (data.buildPct !== undefined) updates.build_pct = data.buildPct;
    if (data.testPct !== undefined) updates.test_pct = data.testPct;
    if (data.packagingPct !== undefined)
      updates.packaging_pct = data.packagingPct;
    if (data.qaReleasePct !== undefined)
      updates.qa_release_pct = data.qaReleasePct;
    if (data.sapReleasePct !== undefined)
      updates.sap_release_pct = data.sapReleasePct;
    if (data.startDate !== undefined) updates.start_date = data.startDate;
    if (data.endDate !== undefined) updates.end_date = data.endDate;
    if (data.isComplete !== undefined) updates.is_complete = data.isComplete;
    if (data.status !== undefined) updates.status = data.status;
    if (data.progress !== undefined) updates.progress = data.progress;
    updates.updated_at = new Date().toISOString();

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

    // Check existing
    const existing = await sbFetch<any[]>(
      serviceKey,
      url,
      `rem_targets?type=eq.${encodeURIComponent(data.type)}&select=id`,
    );

    const payload = {
      type: data.type,
      target: data.target,
      completed: data.completed,
      updated_at: new Date().toISOString(),
    };

    let recordId: string;
    if (existing.length > 0) {
      recordId = existing[0].id;
      await sbFetch<void>(serviceKey, url, idPath("rem_targets", recordId), {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(payload),
      });
    } else {
      const rows = await sbFetch<any[]>(serviceKey, url, "rem_targets", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          ...payload,
          created_at: new Date().toISOString(),
        }),
      });
      recordId = rows[0].id;
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
      existing.length > 0 ? existing[0] : null,
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

    const payload: Record<string, unknown> = {
      week_number: data.weekNumber ?? null,
      week_start: data.weekStart ?? null,
      quarter: data.quarter ?? null,
      notes: data.notes ? JSON.stringify(data.notes) : null,
      updated_at: new Date().toISOString(),
    };

    // Find existing by week_start
    let recordId: string;
    let beforeState: any = null;
    if (data.weekStart) {
      const existing = await sbFetch<any[]>(
        serviceKey,
        url,
        `rem_weekly_notes?week_start=eq.${encodeURIComponent(data.weekStart)}&select=id`,
      );
      if (existing.length > 0) {
        recordId = existing[0].id;
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
        const rows = await sbFetch<any[]>(serviceKey, url, "rem_weekly_notes", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            ...payload,
            created_at: new Date().toISOString(),
          }),
        });
        recordId = rows[0].id;
      }
    } else {
      const rows = await sbFetch<any[]>(serviceKey, url, "rem_weekly_notes", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          ...payload,
          created_at: new Date().toISOString(),
        }),
      });
      recordId = rows[0].id;
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

    const existing = await sbFetch<any[]>(
      serviceKey,
      url,
      `rem_build_plan?week_of=eq.${encodeURIComponent(data.weekOf)}&select=id`,
    );

    const payload = {
      week_of: data.weekOf,
      planned: data.planned,
      actual: data.actual,
      notes: data.notes ?? null,
      updated_at: new Date().toISOString(),
    };

    let recordId: string;
    if (existing.length > 0) {
      recordId = existing[0].id;
      await sbFetch<void>(serviceKey, url, idPath("rem_build_plan", recordId), {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(payload),
      });
    } else {
      const rows = await sbFetch<any[]>(serviceKey, url, "rem_build_plan", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          ...payload,
          created_at: new Date().toISOString(),
        }),
      });
      recordId = rows[0].id;
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
      existing.length > 0 ? existing[0] : null,
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

    const existing = await sbFetch<any[]>(
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
      updated_at: new Date().toISOString(),
    };

    let recordId: string;
    if (existing.length > 0) {
      recordId = existing[0].id;
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
      const rows = await sbFetch<any[]>(serviceKey, url, "rem_tracker_weekly", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          ...payload,
          created_at: new Date().toISOString(),
        }),
      });
      recordId = rows[0].id;
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
      existing.length > 0 ? existing[0] : null,
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

    // Find by name
    const existing = await sbFetch<any[]>(
      serviceKey,
      url,
      `rem_staff?name=eq.${encodeURIComponent(data.name)}&select=id`,
    );

    const payload: Record<string, unknown> = {
      name: data.name,
      role: data.role,
      fte: data.fte ?? null,
      certifications: data.certifications
        ? JSON.stringify(data.certifications)
        : null,
      skills: data.skills ? JSON.stringify(data.skills) : null,
      is_lead: data.isLead ?? false,
      in_training: data.inTraining ?? false,
      updated_at: new Date().toISOString(),
    };

    let recordId: string;
    if (existing.length > 0) {
      recordId = existing[0].id;
      await sbFetch<void>(serviceKey, url, idPath("rem_staff", recordId), {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(payload),
      });
    } else {
      const rows = await sbFetch<any[]>(serviceKey, url, "rem_staff", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          ...payload,
          created_at: new Date().toISOString(),
        }),
      });
      recordId = rows[0].id;
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
      existing.length > 0 ? existing[0] : null,
      payload,
    );

    return { success: true, id: recordId };
  },
});
