// DEPRECATED: This file's queries read from the parallel Convex REM tables.
// Authoritative source is migrating to Supabase via secure server actions.
// Legacy writes are internal-only so browser/API callers cannot mutate fallback state.

import { internalMutation, query } from "./_generated/server";
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

// Internal-only compatibility path. Browser/API callers must use the secure
// authoritative REM server actions once the Supabase cutover lands.
export const updateAnalyzer = internalMutation({
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
      Object.entries(updates).filter(([, value]) => value !== undefined)
    );
    await ctx.db.patch(id, filtered);
  },
});
