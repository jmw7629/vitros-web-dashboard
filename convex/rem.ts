import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

const VALID_STAGES = [
  "Procurement", "Cleaning", "Service/Repair", "Final Line",
  "Packaging", "Release Testing", "QA Release", "SAP Release", "Complete",
];

function clampPct(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function validatePercentRange(name: string, value: number): void {
  if (value < 0 || value > 100) {
    throw new Error(`${name} must be between 0 and 100, got ${value}`);
  }
}

function validateStage(stage: string): void {
  if (!VALID_STAGES.includes(stage)) {
    throw new Error(`Invalid stage: ${stage}. Must be one of: ${VALID_STAGES.join(", ")}`);
  }
}

async function recordAuditEntry(
  ctx: { db: { insert: (table: string, doc: Record<string, unknown>) => Promise<string> } },
  args: {
    actorId: string;
    action: string;
    table: string;
    recordId: string;
    previousState?: unknown;
    newState?: unknown;
    correlationId?: string;
  },
): Promise<void> {
  await ctx.db.insert("remAuditLog", {
    actorId: args.actorId,
    action: args.action,
    table: args.table,
    recordId: args.recordId,
    previousState: args.previousState,
    newState: args.newState,
    timestamp: Date.now(),
    correlationId: args.correlationId,
  });
}

// ─── Queries (auth-guarded with rem.read) ───

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
    await requireCapability(ctx, "rem.read");
    return await ctx.db.query("cycleSchedules").collect();
  },
});

export const listIncomingBatches = query({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "rem.read");
    return await ctx.db.query("incomingBatches").collect();
  },
});

// ─── Mutations (auth-guarded with rem.write + audit trail) ───

export const updateAnalyzer = mutation({
  args: {
    id: v.id("remAnalyzers"),
    stage: v.optional(v.string()),
    progress: v.optional(v.number()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "rem.write");

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Analyzer not found");

    if (args.stage !== undefined) validateStage(args.stage);
    if (args.progress !== undefined) validatePercentRange("progress", args.progress);

    const filtered: Record<string, unknown> = {};
    if (args.stage !== undefined) filtered.stage = args.stage;
    if (args.progress !== undefined) filtered.progress = clampPct(args.progress);
    if (args.status !== undefined) filtered.status = args.status;
    if (args.notes !== undefined) filtered.notes = args.notes;

    if (Object.keys(filtered).length === 0) {
      throw new Error("No valid fields to update");
    }

    await recordAuditEntry(ctx, {
      actorId: String(actorId),
      action: "UPDATE",
      table: "remAnalyzers",
      recordId: args.id,
      previousState: { stage: existing.stage, progress: existing.progress, status: existing.status, notes: existing.notes },
      newState: filtered,
      correlationId: `update-analyzer-${args.id}-${Date.now()}`,
    });

    await ctx.db.patch(args.id, filtered);
    return { success: true, updatedFields: Object.keys(filtered) };
  },
});

export const createAnalyzer = mutation({
  args: {
    serialNumber: v.string(),
    analyzerType: v.optional(v.string()),
    stage: v.optional(v.string()),
    progress: v.optional(v.number()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "rem.write");

    if (!args.serialNumber.trim()) throw new Error("serialNumber is required");
    if (args.stage !== undefined) validateStage(args.stage);
    if (args.progress !== undefined) validatePercentRange("progress", args.progress);

    const existing = await ctx.db
      .query("remAnalyzers")
      .withIndex("by_serialNumber", (q) => q.eq("serialNumber", args.serialNumber))
      .first();
    if (existing) throw new Error(`Analyzer with serial ${args.serialNumber} already exists`);

    const doc: Record<string, unknown> = { serialNumber: args.serialNumber.trim() };
    if (args.analyzerType !== undefined) doc.analyzerType = args.analyzerType;
    if (args.stage !== undefined) doc.stage = args.stage;
    if (args.progress !== undefined) doc.progress = clampPct(args.progress);
    if (args.status !== undefined) doc.status = args.status;
    if (args.notes !== undefined) doc.notes = args.notes;

    const id = await ctx.db.insert("remAnalyzers", doc);

    await recordAuditEntry(ctx, {
      actorId: String(actorId),
      action: "CREATE",
      table: "remAnalyzers",
      recordId: id,
      newState: doc,
      correlationId: `create-analyzer-${id}-${Date.now()}`,
    });

    return { success: true, id };
  },
});

export const createLvccItem = mutation({
  args: {
    serialNumber: v.optional(v.string()),
    itemId: v.optional(v.string()),
    itemType: v.optional(v.string()),
    batchNumber: v.optional(v.string()),
    quantity: v.optional(v.number()),
    currentStage: v.optional(v.string()),
    buildPct: v.optional(v.number()),
    testPct: v.optional(v.number()),
    packagingPct: v.optional(v.number()),
    qaReleasePct: v.optional(v.number()),
    sapReleasePct: v.optional(v.number()),
    isComplete: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "rem.write");

    if (args.quantity !== undefined && args.quantity < 0) {
      throw new Error("quantity must be >= 0");
    }
    for (const pctField of ["buildPct", "testPct", "packagingPct", "qaReleasePct", "sapReleasePct"] as const) {
      if (args[pctField] !== undefined) validatePercentRange(pctField, args[pctField]);
    }

    const doc: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(args)) {
      if (val !== undefined) doc[key] = val;
    }

    const id = await ctx.db.insert("lvccItems", doc);

    await recordAuditEntry(ctx, {
      actorId: String(actorId),
      action: "CREATE",
      table: "lvccItems",
      recordId: id,
      newState: doc,
      correlationId: `create-lvcc-${id}-${Date.now()}`,
    });

    return { success: true, id };
  },
});

export const updateLvccItem = mutation({
  args: {
    id: v.id("lvccItems"),
    currentStage: v.optional(v.string()),
    buildPct: v.optional(v.number()),
    testPct: v.optional(v.number()),
    packagingPct: v.optional(v.number()),
    qaReleasePct: v.optional(v.number()),
    sapReleasePct: v.optional(v.number()),
    quantity: v.optional(v.number()),
    isComplete: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "rem.write");

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("LVCC item not found");

    if (args.quantity !== undefined && args.quantity < 0) {
      throw new Error("quantity must be >= 0");
    }
    for (const pctField of ["buildPct", "testPct", "packagingPct", "qaReleasePct", "sapReleasePct"] as const) {
      if (args[pctField] !== undefined) validatePercentRange(pctField, args[pctField]);
    }

    const filtered: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(args)) {
      if (key !== "id" && val !== undefined) filtered[key] = val;
    }

    if (Object.keys(filtered).length === 0) {
      throw new Error("No valid fields to update");
    }

    await recordAuditEntry(ctx, {
      actorId: String(actorId),
      action: "UPDATE",
      table: "lvccItems",
      recordId: args.id,
      previousState: existing,
      newState: filtered,
      correlationId: `update-lvcc-${args.id}-${Date.now()}`,
    });

    await ctx.db.patch(args.id, filtered);
    return { success: true };
  },
});

export const createTarget = mutation({
  args: {
    type: v.string(),
    target: v.number(),
    completed: v.number(),
  },
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "rem.write");

    if (args.target < 0) throw new Error("target must be >= 0");
    if (args.completed < 0) throw new Error("completed must be >= 0");

    const existing = await ctx.db
      .query("annualTargets")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .first();
    if (existing) throw new Error(`Target for type ${args.type} already exists`);

    const id = await ctx.db.insert("annualTargets", args);

    await recordAuditEntry(ctx, {
      actorId: String(actorId),
      action: "CREATE",
      table: "annualTargets",
      recordId: id,
      newState: args,
      correlationId: `create-target-${id}-${Date.now()}`,
    });

    return { success: true, id };
  },
});

export const updateTarget = mutation({
  args: {
    id: v.id("annualTargets"),
    target: v.optional(v.number()),
    completed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "rem.write");

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Target not found");

    if (args.target !== undefined && args.target < 0) throw new Error("target must be >= 0");
    if (args.completed !== undefined && args.completed < 0) throw new Error("completed must be >= 0");

    const filtered: Record<string, unknown> = {};
    if (args.target !== undefined) filtered.target = args.target;
    if (args.completed !== undefined) filtered.completed = args.completed;

    if (Object.keys(filtered).length === 0) {
      throw new Error("No valid fields to update");
    }

    await recordAuditEntry(ctx, {
      actorId: String(actorId),
      action: "UPDATE",
      table: "annualTargets",
      recordId: args.id,
      previousState: { target: existing.target, completed: existing.completed },
      newState: filtered,
      correlationId: `update-target-${args.id}-${Date.now()}`,
    });

    await ctx.db.patch(args.id, filtered);
    return { success: true };
  },
});

export const createStaffMember = mutation({
  args: {
    name: v.string(),
    role: v.string(),
    fte: v.optional(v.number()),
    certifications: v.optional(v.any()),
    skills: v.optional(v.any()),
    isLead: v.optional(v.boolean()),
    inTraining: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "rem.write");

    if (!args.name.trim()) throw new Error("name is required");
    if (args.fte !== undefined && args.fte < 0) throw new Error("fte must be >= 0");

    const id = await ctx.db.insert("staffMembers", {
      name: args.name.trim(),
      role: args.role,
      fte: args.fte,
      certifications: args.certifications,
      skills: args.skills,
      isLead: args.isLead,
      inTraining: args.inTraining,
    });

    await recordAuditEntry(ctx, {
      actorId: String(actorId),
      action: "CREATE",
      table: "staffMembers",
      recordId: id,
      newState: args,
      correlationId: `create-staff-${id}-${Date.now()}`,
    });

    return { success: true, id };
  },
});

export const updateStaffMember = mutation({
  args: {
    id: v.id("staffMembers"),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    fte: v.optional(v.number()),
    certifications: v.optional(v.any()),
    skills: v.optional(v.any()),
    isLead: v.optional(v.boolean()),
    inTraining: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "rem.write");

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Staff member not found");

    if (args.fte !== undefined && args.fte < 0) throw new Error("fte must be >= 0");

    const filtered: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(args)) {
      if (key !== "id" && val !== undefined) filtered[key] = val;
    }

    if (Object.keys(filtered).length === 0) {
      throw new Error("No valid fields to update");
    }

    await recordAuditEntry(ctx, {
      actorId: String(actorId),
      action: "UPDATE",
      table: "staffMembers",
      recordId: args.id,
      previousState: existing,
      newState: filtered,
      correlationId: `update-staff-${args.id}-${Date.now()}`,
    });

    await ctx.db.patch(args.id, filtered);
    return { success: true };
  },
});

export const createWeeklyNote = mutation({
  args: {
    weekNumber: v.number(),
    weekStart: v.string(),
    quarter: v.string(),
    notes: v.array(v.object({
      product: v.string(),
      content: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "rem.write");

    if (args.weekNumber < 0) throw new Error("weekNumber must be >= 0");
    if (!args.weekStart.trim()) throw new Error("weekStart is required");

    const id = await ctx.db.insert("weeklyNotes", args);

    await recordAuditEntry(ctx, {
      actorId: String(actorId),
      action: "CREATE",
      table: "weeklyNotes",
      recordId: id,
      newState: args,
      correlationId: `create-weekly-note-${id}-${Date.now()}`,
    });

    return { success: true, id };
  },
});

export const updateWeeklyNote = mutation({
  args: {
    id: v.id("weeklyNotes"),
    notes: v.array(v.object({
      product: v.string(),
      content: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "rem.write");

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Weekly note not found");

    await recordAuditEntry(ctx, {
      actorId: String(actorId),
      action: "UPDATE",
      table: "weeklyNotes",
      recordId: args.id,
      previousState: { notes: existing.notes },
      newState: { notes: args.notes },
      correlationId: `update-weekly-note-${args.id}-${Date.now()}`,
    });

    await ctx.db.patch(args.id, { notes: args.notes });
    return { success: true };
  },
});

// ─── Audit log query ───

export const getAuditLog = query({
  args: {
    recordId: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "rem.read");
    const limit = Math.min(args.limit ?? 50, 200);

    if (args.recordId) {
      return await ctx.db
        .query("remAuditLog")
        .withIndex("by_recordId", (q) => q.eq("recordId", args.recordId!))
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("remAuditLog")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);
  },
});
