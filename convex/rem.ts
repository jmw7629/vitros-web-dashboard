import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listAnalyzers = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("remAnalyzers").collect();
  },
});

export const getAnalyzerBySerial = query({
  args: { serialNumber: v.string() },
  handler: async (ctx, { serialNumber }) => {
    return await ctx.db
      .query("remAnalyzers")
      .withIndex("by_serialNumber", (q) => q.eq("serialNumber", serialNumber))
      .first();
  },
});

export const listLvccItems = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("lvccItems").collect();
  },
});

export const listTargets = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("annualTargets").collect();
  },
});

export const listStaff = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("staffMembers").collect();
  },
});

export const listWeeklyNotes = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("weeklyNotes").order("desc").collect();
  },
});

export const listEmployees = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("employees").collect();
  },
});

export const listCycleSchedules = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("cycleSchedules").collect();
  },
});

export const listIncomingBatches = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("incomingBatches").collect();
  },
});

export const updateAnalyzer = mutation({
  args: {
    id: v.id("remAnalyzers"),
    stage: v.optional(v.string()),
    progress: v.optional(v.number()),
    status: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch(id, filtered);
  },
});
