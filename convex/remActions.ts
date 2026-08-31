import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

const VALID_ANALYZER_STAGES = [
  "Procurement", "Cleaning", "Service/Repair", "Final Line",
  "Packaging", "Release Testing", "QA Release", "SAP Release", "Complete",
];

const VALID_ANALYZER_FIELDS = new Set([
  "serialNumber", "analyzerType", "type", "stage", "progress", "status",
  "yearNumber", "productionOrder", "currentStage", "overallPct",
  "procurementPct", "cleaningPct", "servicePct", "serviceCell",
  "finalLinePct", "releaseTestingPct", "packagingPct", "sapReleasePct",
  "qaReleasePct", "currentPct", "slaDays", "daysInStage", "daysElapsed",
  "startDate", "endDate", "doneWeek", "isComplete", "installDate",
  "installCountry", "installStatus", "installCost", "fpyPercentage",
  "releaseFPY", "fieldStatus", "country", "fpy", "assignedTo",
]);

const VALID_LVCC_FIELDS = new Set([
  "serialNumber", "itemId", "itemType", "category", "batchNumber",
  "quantity", "currentStage", "buildPct", "testPct", "packagingPct",
  "sapReleasePct", "qaReleasePct", "startDate", "endDate", "isComplete",
  "status", "progress",
]);

const VALID_STAFF_FIELDS = new Set([
  "name", "role", "fte", "certifications", "skills", "isLead", "inTraining",
]);

const VALID_TARGET_FIELDS = new Set(["type", "target", "completed"]);

const VALID_WEEKLY_NOTE_FIELDS = new Set(["weekNumber", "weekStart", "quarter", "notes"]);

function pickAllowedFields(input: Record<string, unknown>, allowed: Set<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key) && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function validateAnalyzerPayload(input: Record<string, unknown>): void {
  if (input.serialNumber !== undefined && typeof input.serialNumber !== "string") {
    throw new Error("serialNumber must be a string");
  }
  if (input.currentStage !== undefined && typeof input.currentStage === "string") {
    if (!VALID_ANALYZER_STAGES.includes(input.currentStage)) {
      throw new Error(`Invalid stage: ${input.currentStage}. Must be one of: ${VALID_ANALYZER_STAGES.join(", ")}`);
    }
  }
  const pctFields = [
    "progress", "overallPct", "procurementPct", "cleaningPct", "servicePct",
    "finalLinePct", "releaseTestingPct", "packagingPct", "sapReleasePct",
    "qaReleasePct", "currentPct",
  ];
  for (const field of pctFields) {
    if (input[field] !== undefined) {
      const val = Number(input[field]);
      if (!Number.isFinite(val) || val < 0 || val > 100) {
        throw new Error(`${field} must be a number between 0 and 100`);
      }
    }
  }
  if (input.isComplete !== undefined && typeof input.isComplete !== "boolean") {
    throw new Error("isComplete must be a boolean");
  }
}

function validateLvccPayload(input: Record<string, unknown>): void {
  if (input.serialNumber !== undefined && typeof input.serialNumber !== "string") {
    throw new Error("serialNumber must be a string");
  }
  const pctFields = ["buildPct", "testPct", "packagingPct", "sapReleasePct", "qaReleasePct"];
  for (const field of pctFields) {
    if (input[field] !== undefined) {
      const val = Number(input[field]);
      if (!Number.isFinite(val) || val < 0 || val > 100) {
        throw new Error(`${field} must be a number between 0 and 100`);
      }
    }
  }
}

function validateStaffPayload(input: Record<string, unknown>): void {
  if (input.name !== undefined && (typeof input.name !== "string" || !input.name.trim())) {
    throw new Error("name must be a non-empty string");
  }
  if (input.role !== undefined && typeof input.role !== "string") {
    throw new Error("role must be a string");
  }
  if (input.fte !== undefined) {
    const val = Number(input.fte);
    if (!Number.isFinite(val) || val < 0) {
      throw new Error("fte must be a non-negative number");
    }
  }
}

function validateTargetPayload(input: Record<string, unknown>): void {
  if (input.type !== undefined && typeof input.type !== "string") {
    throw new Error("type must be a string");
  }
  for (const field of ["target", "completed"]) {
    if (input[field] !== undefined) {
      const val = Number(input[field]);
      if (!Number.isFinite(val) || val < 0) {
        throw new Error(`${field} must be a non-negative number`);
      }
    }
  }
}

// ─── Analyzer mutations ───

export const updateAnalyzer = mutation({
  args: {
    id: v.id("remAnalyzers"),
    currentStage: v.optional(v.string()),
    stage: v.optional(v.string()),
    progress: v.optional(v.number()),
    overallPct: v.optional(v.number()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
    isComplete: v.optional(v.boolean()),
    procurementPct: v.optional(v.number()),
    cleaningPct: v.optional(v.number()),
    servicePct: v.optional(v.number()),
    finalLinePct: v.optional(v.number()),
    packagingPct: v.optional(v.number()),
    releaseTestingPct: v.optional(v.number()),
    qaReleasePct: v.optional(v.number()),
    sapReleasePct: v.optional(v.number()),
    currentPct: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "rem.write");
    const { id, ...raw } = args;
    const updates = pickAllowedFields(raw as Record<string, unknown>, VALID_ANALYZER_FIELDS);
    if (Object.keys(updates).length === 0) return { success: true };
    validateAnalyzerPayload(updates);
    const before = await ctx.db.get(id);
    if (!before) throw new Error("Analyzer not found");
    await ctx.db.patch(id, updates);
    const after = await ctx.db.get(id);
    await ctx.db.insert("remAudit", {
      action: "UPDATE_ANALYZER",
      actor: "user",
      timestamp: Date.now(),
      table: "remAnalyzers",
      recordId: id,
      before,
      after,
    });
    return { success: true };
  },
});

export const createAnalyzer = mutation({
  args: {
    serialNumber: v.string(),
    analyzerType: v.optional(v.string()),
    currentStage: v.optional(v.string()),
    isComplete: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "rem.write");
    if (!args.serialNumber.trim()) throw new Error("serialNumber is required");
    const existing = await ctx.db
      .query("remAnalyzers")
      .withIndex("by_serialNumber", (q) => q.eq("serialNumber", args.serialNumber))
      .first();
    if (existing) throw new Error("Analyzer with this serial number already exists");
    const row = await ctx.db.insert("remAnalyzers", {
      serialNumber: args.serialNumber.trim(),
      analyzerType: args.analyzerType,
      currentStage: args.currentStage || "Procurement",
      isComplete: args.isComplete ?? false,
      overallPct: 0,
    });
    await ctx.db.insert("remAudit", {
      action: "CREATE_ANALYZER",
      actor: "user",
      timestamp: Date.now(),
      table: "remAnalyzers",
      recordId: row,
      after: { serialNumber: args.serialNumber, analyzerType: args.analyzerType },
    });
    return { success: true, id: row };
  },
});

// ─── LVCC mutations ───

export const updateLvccItem = mutation({
  args: {
    id: v.id("lvccItems"),
    currentStage: v.optional(v.string()),
    buildPct: v.optional(v.number()),
    testPct: v.optional(v.number()),
    packagingPct: v.optional(v.number()),
    sapReleasePct: v.optional(v.number()),
    qaReleasePct: v.optional(v.number()),
    isComplete: v.optional(v.boolean()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "rem.write");
    const { id, ...raw } = args;
    const updates = pickAllowedFields(raw as Record<string, unknown>, VALID_LVCC_FIELDS);
    if (Object.keys(updates).length === 0) return { success: true };
    validateLvccPayload(updates);
    const before = await ctx.db.get(id);
    if (!before) throw new Error("LVCC item not found");
    await ctx.db.patch(id, updates);
    const after = await ctx.db.get(id);
    await ctx.db.insert("remAudit", {
      action: "UPDATE_LVCC",
      actor: "user",
      timestamp: Date.now(),
      table: "lvccItems",
      recordId: id,
      before,
      after,
    });
    return { success: true };
  },
});

export const createLvccItem = mutation({
  args: {
    serialNumber: v.optional(v.string()),
    itemType: v.optional(v.string()),
    category: v.optional(v.string()),
    batchNumber: v.optional(v.string()),
    quantity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "rem.write");
    const row = await ctx.db.insert("lvccItems", {
      serialNumber: args.serialNumber,
      itemType: args.itemType,
      category: args.category,
      batchNumber: args.batchNumber,
      quantity: args.quantity,
      currentStage: "Build",
      buildPct: 0,
      testPct: 0,
      packagingPct: 0,
      sapReleasePct: 0,
      qaReleasePct: 0,
      isComplete: false,
    });
    await ctx.db.insert("remAudit", {
      action: "CREATE_LVCC",
      actor: "user",
      timestamp: Date.now(),
      table: "lvccItems",
      recordId: row,
      after: { serialNumber: args.serialNumber, itemType: args.itemType },
    });
    return { success: true, id: row };
  },
});

// ─── Staff mutations ───

export const updateStaffMember = mutation({
  args: {
    id: v.id("staffMembers"),
    name: v.optional(v.string()),
    role: v.optional(v.string()),
    fte: v.optional(v.number()),
    isLead: v.optional(v.boolean()),
    inTraining: v.optional(v.boolean()),
    certifications: v.optional(v.any()),
    skills: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "rem.write");
    const { id, ...raw } = args;
    const updates = pickAllowedFields(raw as Record<string, unknown>, VALID_STAFF_FIELDS);
    if (Object.keys(updates).length === 0) return { success: true };
    validateStaffPayload(updates);
    const before = await ctx.db.get(id);
    if (!before) throw new Error("Staff member not found");
    await ctx.db.patch(id, updates);
    const after = await ctx.db.get(id);
    await ctx.db.insert("remAudit", {
      action: "UPDATE_STAFF",
      actor: "user",
      timestamp: Date.now(),
      table: "staffMembers",
      recordId: id,
      before,
      after,
    });
    return { success: true };
  },
});

export const createStaffMember = mutation({
  args: {
    name: v.string(),
    role: v.string(),
    fte: v.optional(v.number()),
    skills: v.optional(v.any()),
    certifications: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "rem.write");
    if (!args.name.trim()) throw new Error("name is required");
    if (!args.role.trim()) throw new Error("role is required");
    const row = await ctx.db.insert("staffMembers", {
      name: args.name.trim(),
      role: args.role.trim(),
      fte: args.fte,
      skills: args.skills,
      certifications: args.certifications,
    });
    await ctx.db.insert("remAudit", {
      action: "CREATE_STAFF",
      actor: "user",
      timestamp: Date.now(),
      table: "staffMembers",
      recordId: row,
      after: { name: args.name, role: args.role },
    });
    return { success: true, id: row };
  },
});

// ─── Target mutations ───

export const updateTarget = mutation({
  args: {
    id: v.id("annualTargets"),
    type: v.optional(v.string()),
    target: v.optional(v.number()),
    completed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "rem.write");
    const { id, ...raw } = args;
    const updates = pickAllowedFields(raw as Record<string, unknown>, VALID_TARGET_FIELDS);
    if (Object.keys(updates).length === 0) return { success: true };
    validateTargetPayload(updates);
    const before = await ctx.db.get(id);
    if (!before) throw new Error("Target not found");
    await ctx.db.patch(id, updates);
    const after = await ctx.db.get(id);
    await ctx.db.insert("remAudit", {
      action: "UPDATE_TARGET",
      actor: "user",
      timestamp: Date.now(),
      table: "annualTargets",
      recordId: id,
      before,
      after,
    });
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
    await requireCapability(ctx, "rem.write");
    if (!args.type.trim()) throw new Error("type is required");
    const existing = await ctx.db
      .query("annualTargets")
      .withIndex("by_type", (q) => q.eq("type", args.type))
      .first();
    if (existing) throw new Error("Target for this type already exists");
    const row = await ctx.db.insert("annualTargets", {
      type: args.type.trim(),
      target: args.target,
      completed: args.completed,
    });
    await ctx.db.insert("remAudit", {
      action: "CREATE_TARGET",
      actor: "user",
      timestamp: Date.now(),
      table: "annualTargets",
      recordId: row,
      after: { type: args.type, target: args.target, completed: args.completed },
    });
    return { success: true, id: row };
  },
});

// ─── Weekly Notes mutations ───

export const updateWeeklyNote = mutation({
  args: {
    id: v.id("weeklyNotes"),
    weekNumber: v.optional(v.number()),
    weekStart: v.optional(v.string()),
    quarter: v.optional(v.string()),
    notes: v.optional(v.array(v.object({ product: v.string(), content: v.string() }))),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "rem.write");
    const { id, ...raw } = args;
    const updates = pickAllowedFields(raw as Record<string, unknown>, VALID_WEEKLY_NOTE_FIELDS);
    if (Object.keys(updates).length === 0) return { success: true };
    const before = await ctx.db.get(id);
    if (!before) throw new Error("Weekly note not found");
    await ctx.db.patch(id, updates);
    const after = await ctx.db.get(id);
    await ctx.db.insert("remAudit", {
      action: "UPDATE_WEEKLY_NOTE",
      actor: "user",
      timestamp: Date.now(),
      table: "weeklyNotes",
      recordId: id,
      before,
      after,
    });
    return { success: true };
  },
});

export const createWeeklyNote = mutation({
  args: {
    weekNumber: v.number(),
    weekStart: v.string(),
    quarter: v.string(),
    notes: v.array(v.object({ product: v.string(), content: v.string() })),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "rem.write");
    const row = await ctx.db.insert("weeklyNotes", {
      weekNumber: args.weekNumber,
      weekStart: args.weekStart,
      quarter: args.quarter,
      notes: args.notes,
    });
    await ctx.db.insert("remAudit", {
      action: "CREATE_WEEKLY_NOTE",
      actor: "user",
      timestamp: Date.now(),
      table: "weeklyNotes",
      recordId: row,
      after: { weekNumber: args.weekNumber, quarter: args.quarter },
    });
    return { success: true, id: row };
  },
});
