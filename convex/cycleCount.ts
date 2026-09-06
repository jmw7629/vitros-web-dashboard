import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

const MAX_SCHEDULE_NAME = 160;
const MAX_ASSIGNEE = 160;
const MAX_PARTS_PER_SCHEDULE = 2_000;
const MAX_RESULTS_PER_SUBMISSION = 2_000;
const MAX_PART_NUMBER = 96;
const MAX_SERIAL = 128;
const MAX_STATUS = 32;
const MAX_SORT_MODE = 64;
const VALID_FREQUENCIES = new Set([
  "Single",
  "Daily",
  "Weekly",
  "Bi-Weekly",
  "Monthly",
  "Quarterly",
]);
const VALID_COUNT_TYPES = new Set(["standard", "w2w"]);
const VALID_RESULT_STATUSES = new Set(["partial", "completed"]);

function boundedString(value: string, label: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`${label} is invalid`);
  }
  return normalized;
}

function boundedOptionalString(
  value: string | undefined,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  return boundedString(value, label, maxLength);
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function normalizeParts(parts: string[]): string[] {
  if (parts.length > MAX_PARTS_PER_SCHEDULE) {
    throw new Error("Too many parts in cycle count schedule");
  }
  return parts.map((partNumber) =>
    boundedString(partNumber, "Part number", MAX_PART_NUMBER),
  );
}

function normalizeFrequency(frequency: string): string {
  if (!VALID_FREQUENCIES.has(frequency)) {
    throw new Error("Unsupported cycle count frequency");
  }
  return frequency;
}

function normalizeCountType(countType: string | undefined): string | undefined {
  if (countType === undefined) return undefined;
  if (!VALID_COUNT_TYPES.has(countType)) {
    throw new Error("Unsupported cycle count type");
  }
  return countType;
}

async function resolveServerActor(ctx: any, userId: any): Promise<string> {
  const user = await ctx.db.get(userId);
  const name = user?.name?.trim();
  return name || `user:${String(userId)}`;
}

// ============ QUERIES ============

export const listSchedules = query({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    return await ctx.db.query("cycleSchedules").collect();
  },
});

export const listResults = query({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    return await ctx.db.query("cycleResults").collect();
  },
});

export const getSchedule = query({
  args: { id: v.id("cycleSchedules") },
  handler: async (ctx, { id }) => {
    await requireCapability(ctx, "inventory.read");
    return await ctx.db.get(id);
  },
});

export const getResultsBySchedule = query({
  args: { scheduleId: v.string() },
  handler: async (ctx, { scheduleId }) => {
    await requireCapability(ctx, "inventory.read");
    return await ctx.db
      .query("cycleResults")
      .withIndex("by_scheduleId", (q) => q.eq("scheduleId", scheduleId))
      .collect();
  },
});

// ============ MUTATIONS ============

// Creates a new cycle count schedule.
// Works with both web (startDate) and iOS (nextDue) callers.
export const createSchedule = mutation({
  args: {
    name: v.string(),
    frequency: v.string(),
    assignedTo: v.string(),
    nextDue: v.optional(v.number()),
    startDate: v.optional(v.number()),
    status: v.optional(v.string()),
    parts: v.array(v.string()),
    countType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");

    const due = args.nextDue ?? args.startDate ?? Date.now();
    if (!Number.isFinite(due) || due < 0) throw new Error("Invalid cycle count due date");

    const status = boundedOptionalString(args.status, "Status", MAX_STATUS) ?? "active";
    const id = await ctx.db.insert("cycleSchedules", {
      name: boundedString(args.name, "Schedule name", MAX_SCHEDULE_NAME),
      frequency: normalizeFrequency(args.frequency),
      assignedTo: boundedString(args.assignedTo, "Assigned user", MAX_ASSIGNEE),
      nextDue: due,
      status,
      parts: normalizeParts(args.parts),
      countType: normalizeCountType(args.countType) ?? "standard",
      createdAt: Date.now(),
    });
    return id;
  },
});

export const updateSchedule = mutation({
  args: {
    id: v.id("cycleSchedules"),
    name: v.optional(v.string()),
    frequency: v.optional(v.string()),
    assignedTo: v.optional(v.string()),
    status: v.optional(v.string()),
    nextDue: v.optional(v.number()),
    parts: v.optional(v.array(v.string())),
    countType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.write");

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new Error("Cycle count schedule not found");

    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) updates.name = boundedString(args.name, "Schedule name", MAX_SCHEDULE_NAME);
    if (args.frequency !== undefined) updates.frequency = normalizeFrequency(args.frequency);
    if (args.assignedTo !== undefined) updates.assignedTo = boundedString(args.assignedTo, "Assigned user", MAX_ASSIGNEE);
    if (args.status !== undefined) updates.status = boundedString(args.status, "Status", MAX_STATUS);
    if (args.nextDue !== undefined) {
      if (!Number.isFinite(args.nextDue) || args.nextDue < 0) throw new Error("Invalid cycle count due date");
      updates.nextDue = args.nextDue;
    }
    if (args.parts !== undefined) updates.parts = normalizeParts(args.parts);
    if (args.countType !== undefined) updates.countType = normalizeCountType(args.countType);

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(args.id, updates);
    }
  },
});

export const deleteSchedule = mutation({
  args: { id: v.id("cycleSchedules") },
  handler: async (ctx, { id }) => {
    await requireCapability(ctx, "inventory.admin");
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Cycle count schedule not found");
    await ctx.db.delete(id);
  },
});

// ─── Submit / Create Result ───
// Web calls submitCount and iOS calls createResult. The caller-provided countedBy
// field is retained only for wire compatibility; persisted actor identity is
// always derived from the authenticated server session.

const submitCountHandler = async (
  ctx: any,
  args: {
    scheduleId: string;
    timestamp?: number;
    countedBy: string;
    results: {
      partNumber: string;
      systemQty: number;
      countedQty: number;
      variance: number;
      wipEntries?: { sn: string; qty: number }[];
      incomingQty?: number;
    }[];
    status?: string;
    sortMode?: string;
    wipSerials?: string[];
  },
  actorName: string,
) => {
  const scheduleId = boundedString(args.scheduleId, "Schedule id", 128);
  if (args.results.length > MAX_RESULTS_PER_SUBMISSION) {
    throw new Error("Too many cycle count result lines");
  }

  const status = args.status ?? "completed";
  if (!VALID_RESULT_STATUSES.has(status)) {
    throw new Error("Unsupported cycle count result status");
  }

  const normalizedResults = args.results.map((result) => {
    const systemQty = nonNegativeInteger(result.systemQty, "System quantity");
    const countedQty = nonNegativeInteger(result.countedQty, "Counted quantity");
    const wipEntries = result.wipEntries?.map((entry) => ({
      sn: boundedString(entry.sn, "WIP serial", MAX_SERIAL),
      qty: nonNegativeInteger(entry.qty, "WIP quantity"),
    }));
    if (wipEntries && wipEntries.length > MAX_RESULTS_PER_SUBMISSION) {
      throw new Error("Too many WIP entries on cycle count line");
    }

    return {
      partNumber: boundedString(result.partNumber, "Part number", MAX_PART_NUMBER),
      systemQty,
      countedQty,
      variance: countedQty - systemQty,
      ...(wipEntries ? { wipEntries } : {}),
      ...(result.incomingQty === undefined
        ? {}
        : { incomingQty: nonNegativeInteger(result.incomingQty, "Incoming quantity") }),
    };
  });

  const allSchedules = await ctx.db.query("cycleSchedules").collect();
  const schedule = allSchedules.find(
    (candidate: any) => candidate._id === scheduleId || candidate._id.toString() === scheduleId,
  );
  if (!schedule) throw new Error("Cycle count schedule not found");

  const ts = args.timestamp ?? Date.now();
  if (!Number.isFinite(ts) || ts < 0) throw new Error("Invalid cycle count timestamp");

  const normalizedWipSerials = args.wipSerials?.map((serial) =>
    boundedString(serial, "WIP serial", MAX_SERIAL),
  );
  if (normalizedWipSerials && normalizedWipSerials.length > MAX_RESULTS_PER_SUBMISSION) {
    throw new Error("Too many WIP serials");
  }

  const doc: any = {
    scheduleId,
    timestamp: ts,
    countedBy: actorName,
    results: normalizedResults,
    status,
    sortMode: boundedOptionalString(args.sortMode, "Sort mode", MAX_SORT_MODE) ?? "alphanumeric",
  };
  if (normalizedWipSerials) doc.wipSerials = normalizedWipSerials;

  const id = await ctx.db.insert("cycleResults", doc);

  // Convex mutations are transactional. Do not swallow schedule-update failures:
  // result persistence and lifecycle update must commit or roll back together.
  if (status !== "partial") {
    const now = Date.now();
    let nextDue = now;
    switch (schedule.frequency) {
      case "Daily":
        nextDue = now + 1 * 24 * 60 * 60 * 1000;
        break;
      case "Weekly":
        nextDue = now + 7 * 24 * 60 * 60 * 1000;
        break;
      case "Bi-Weekly":
        nextDue = now + 14 * 24 * 60 * 60 * 1000;
        break;
      case "Monthly":
        nextDue = now + 30 * 24 * 60 * 60 * 1000;
        break;
      case "Quarterly":
        nextDue = now + 90 * 24 * 60 * 60 * 1000;
        break;
      case "Single":
        await ctx.db.patch(schedule._id, { status: "completed", nextDue: now });
        return id;
      default:
        throw new Error("Cycle count schedule has unsupported frequency");
    }
    await ctx.db.patch(schedule._id, { nextDue, status: "active" });
  }

  return id;
};

const resultArgs = {
  scheduleId: v.string(),
  timestamp: v.optional(v.number()),
  countedBy: v.string(),
  results: v.array(
    v.object({
      partNumber: v.string(),
      systemQty: v.number(),
      countedQty: v.number(),
      variance: v.number(),
      wipEntries: v.optional(v.array(v.object({ sn: v.string(), qty: v.number() }))),
      incomingQty: v.optional(v.number()),
    }),
  ),
  status: v.optional(v.string()),
  sortMode: v.optional(v.string()),
  wipSerials: v.optional(v.array(v.string())),
};

export const submitCount = mutation({
  args: resultArgs,
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "inventory.write");
    const actorName = await resolveServerActor(ctx, userId);
    return await submitCountHandler(ctx, args, actorName);
  },
});

export const createResult = mutation({
  args: resultArgs,
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "inventory.write");
    const actorName = await resolveServerActor(ctx, userId);
    return await submitCountHandler(ctx, args, actorName);
  },
});

export const deleteResult = mutation({
  args: { id: v.id("cycleResults") },
  handler: async (ctx, { id }) => {
    await requireCapability(ctx, "inventory.admin");
    const existing = await ctx.db.get(id);
    if (!existing) throw new Error("Cycle count result not found");
    await ctx.db.delete(id);
  },
});
