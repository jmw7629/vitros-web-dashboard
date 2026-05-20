import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ============ QUERIES ============

export const listSchedules = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("cycleSchedules").collect();
  },
});

export const listResults = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("cycleResults").collect();
  },
});

export const getSchedule = query({
  args: { id: v.id("cycleSchedules") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

export const getResultsBySchedule = query({
  args: { scheduleId: v.string() },
  handler: async (ctx, { scheduleId }) => {
    return await ctx.db
      .query("cycleResults")
      .withIndex("by_scheduleId", (q) => q.eq("scheduleId", scheduleId))
      .collect();
  },
});

// ============ MUTATIONS ============

// Creates a new cycle count schedule
// Works with both web (startDate) and iOS (nextDue) callers
export const createSchedule = mutation({
  args: {
    name: v.string(),
    frequency: v.string(),           // "Single", "Daily", "Weekly", "Bi-Weekly", "Monthly", "Quarterly"
    assignedTo: v.string(),
    nextDue: v.optional(v.number()),  // iOS sends nextDue directly
    startDate: v.optional(v.number()), // Web sends startDate
    status: v.optional(v.string()),   // iOS sends status
    parts: v.array(v.string()),       // array of part numbers
    countType: v.optional(v.string()), // "standard" | "w2w"
  },
  handler: async (ctx, args) => {
    const due = args.nextDue ?? args.startDate ?? Date.now();
    const id = await ctx.db.insert("cycleSchedules", {
      name: args.name,
      frequency: args.frequency,
      assignedTo: args.assignedTo,
      nextDue: due,
      status: args.status ?? "active",
      parts: args.parts,
      countType: args.countType ?? "standard",
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
    const { id, ...updates } = args;
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([, val]) => val !== undefined)
    );
    await ctx.db.patch(id, filtered);
  },
});

export const deleteSchedule = mutation({
  args: { id: v.id("cycleSchedules") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

// ─── Submit / Create Result ───
// Called by web as submitCount, and by iOS as createResult
// Both are identical — createResult is an alias for iOS compatibility

const submitCountHandler = async (
  ctx: any,
  args: {
    scheduleId: string;
    timestamp?: number;
    countedBy: string;
    results: { partNumber: string; systemQty: number; countedQty: number; variance: number }[];
    status?: string;
    sortMode?: string;
    wipSerials?: string[];
  }
) => {
  const ts = args.timestamp ?? Date.now();
  const doc: any = {
    scheduleId: args.scheduleId,
    timestamp: ts,
    countedBy: args.countedBy,
    results: args.results,
    status: args.status ?? "completed",
    sortMode: args.sortMode ?? "alphanumeric",
  };
  if (args.wipSerials) doc.wipSerials = args.wipSerials;
  const id = await ctx.db.insert("cycleResults", doc);

  // Update schedule nextDue based on frequency
  try {
    const allSchedules = await ctx.db.query("cycleSchedules").collect();
    const schedule = allSchedules.find(
      (s: any) => s._id === args.scheduleId || s._id.toString() === args.scheduleId
    );
    if (schedule) {
      // Partial saves (Save & Exit) should keep the schedule active — skip schedule updates
      if (args.status === "partial") {
        // Don't touch the schedule — keep it active for resume
      } else {
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
            nextDue = now + 7 * 24 * 60 * 60 * 1000;
        }
        await ctx.db.patch(schedule._id, { nextDue, status: "active" });
      }
    }
  } catch (e) {
    // Non-critical — schedule update failure shouldn't block result save
    console.error("Failed to update schedule nextDue:", e);
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
    })
  ),
  status: v.optional(v.string()),
  sortMode: v.optional(v.string()),
  wipSerials: v.optional(v.array(v.string())),
};

// Web calls this
export const submitCount = mutation({
  args: resultArgs,
  handler: async (ctx, args) => submitCountHandler(ctx, args),
});

// iOS calls this (alias)
export const createResult = mutation({
  args: resultArgs,
  handler: async (ctx, args) => submitCountHandler(ctx, args),
});

export const deleteResult = mutation({
  args: { id: v.id("cycleResults") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
