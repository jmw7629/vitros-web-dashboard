import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const importParts = mutation({
  args: { batch: v.array(v.any()) },
  handler: async (ctx, { batch }) => {
    for (const row of batch) {
      await ctx.db.insert("parts", row);
    }
    return batch.length;
  },
});

export const importEmployees = mutation({
  args: { batch: v.array(v.any()) },
  handler: async (ctx, { batch }) => {
    for (const row of batch) {
      await ctx.db.insert("employees", row);
    }
    return batch.length;
  },
});

export const importKits = mutation({
  args: { batch: v.array(v.any()) },
  handler: async (ctx, { batch }) => {
    for (const row of batch) {
      await ctx.db.insert("kits", row);
    }
    return batch.length;
  },
});

export const importAnalyzers = mutation({
  args: { batch: v.array(v.any()) },
  handler: async (ctx, { batch }) => {
    for (const row of batch) {
      await ctx.db.insert("remAnalyzers", row);
    }
    return batch.length;
  },
});

export const importLvcc = mutation({
  args: { batch: v.array(v.any()) },
  handler: async (ctx, { batch }) => {
    for (const row of batch) {
      await ctx.db.insert("lvccItems", row);
    }
    return batch.length;
  },
});

export const importWeeklyNotes = mutation({
  args: { batch: v.array(v.any()) },
  handler: async (ctx, { batch }) => {
    for (const row of batch) {
      await ctx.db.insert("weeklyNotes", row);
    }
    return batch.length;
  },
});

export const importSettings = mutation({
  args: { batch: v.array(v.any()) },
  handler: async (ctx, { batch }) => {
    for (const row of batch) {
      await ctx.db.insert("appSettings", row);
    }
    return batch.length;
  },
});
