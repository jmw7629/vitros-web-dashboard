import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// NOTE: Production data is now in Supabase. These functions are kept
// for backward compatibility with the dev Convex instance.

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("parts").collect();
  },
});

export const updatePart = mutation({
  args: {
    id: v.id("parts"),
    partNumber: v.optional(v.string()),
    description: v.optional(v.string()),
    type: v.optional(v.string()),
    qoh: v.optional(v.number()),
    minQty: v.optional(v.number()),
    maxQty: v.optional(v.number()),
    onPlan: v.optional(v.boolean()),
    binLocation: v.optional(v.string()),
    module: v.optional(v.string()),
    lastActivity: v.optional(v.number()),
    unitCost: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const clean: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(updates)) {
      if (val !== undefined) clean[k] = val;
    }
    await ctx.db.patch(id, clean);
  },
});

export const deletePart = mutation({
  args: { id: v.id("parts") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});

export const createPart = mutation({
  args: {
    partNumber: v.string(),
    description: v.string(),
    type: v.string(),
    qoh: v.number(),
    minQty: v.optional(v.number()),
    maxQty: v.optional(v.number()),
    min: v.optional(v.number()),
    max: v.optional(v.number()),
    onPlan: v.optional(v.boolean()),
    binLocation: v.optional(v.string()),
    module: v.optional(v.string()),
    lastActivity: v.optional(v.number()),
    unitCost: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("parts", {
      partNumber: args.partNumber,
      description: args.description,
      type: args.type,
      qoh: args.qoh,
      minQty: args.minQty ?? args.min ?? 0,
      maxQty: args.maxQty ?? args.max ?? 0,
      onPlan: args.onPlan ?? false,
      binLocation: args.binLocation ?? "",
      module: args.module ?? "",
      lastActivity: args.lastActivity ?? Date.now(),
    });
  },
});

export const addPart = createPart;
