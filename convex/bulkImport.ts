// DEPRECATED: Legacy imports write to parallel Convex tables.
// Authoritative REM/business imports must use reviewed server-authoritative gateways.
// These compatibility mutations are internal-only so browser/API callers cannot bypass
// RBAC, validation, audit, canonical identity, or authoritative Supabase state.

import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

export const importParts = internalMutation({
  args: { batch: v.array(v.any()) },
  handler: async (ctx, { batch }) => {
    for (const row of batch) {
      await ctx.db.insert("parts", row);
    }
    return batch.length;
  },
});

export const importEmployees = internalMutation({
  args: { batch: v.array(v.any()) },
  handler: async (ctx, { batch }) => {
    for (const row of batch) {
      await ctx.db.insert("employees", row);
    }
    return batch.length;
  },
});

export const importKits = internalMutation({
  args: { batch: v.array(v.any()) },
  handler: async (ctx, { batch }) => {
    for (const row of batch) {
      await ctx.db.insert("kits", row);
    }
    return batch.length;
  },
});

export const importAnalyzers = internalMutation({
  args: { batch: v.array(v.any()) },
  handler: async (ctx, { batch }) => {
    for (const row of batch) {
      await ctx.db.insert("remAnalyzers", row);
    }
    return batch.length;
  },
});

export const importLvcc = internalMutation({
  args: { batch: v.array(v.any()) },
  handler: async (ctx, { batch }) => {
    for (const row of batch) {
      await ctx.db.insert("lvccItems", row);
    }
    return batch.length;
  },
});

export const importWeeklyNotes = internalMutation({
  args: { batch: v.array(v.any()) },
  handler: async (ctx, { batch }) => {
    for (const row of batch) {
      await ctx.db.insert("weeklyNotes", row);
    }
    return batch.length;
  },
});

export const importSettings = internalMutation({
  args: { batch: v.array(v.any()) },
  handler: async (ctx, { batch }) => {
    for (const row of batch) {
      await ctx.db.insert("appSettings", row);
    }
    return batch.length;
  },
});
