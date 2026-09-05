import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "inventory.read");
    return await ctx.db.query("transactions").order("desc").collect();
  },
});

export const getBySapStatus = query({
  args: { sapStatus: v.string() },
  handler: async (ctx, { sapStatus }) => {
    await requireCapability(ctx, "inventory.read");
    return await ctx.db
      .query("transactions")
      .withIndex("by_sapStatus", (q) => q.eq("sapStatus", sapStatus))
      .collect();
  },
});

export const scanPart = mutation({
  args: {
    mode: v.string(),
    partNumber: v.string(),
    qty: v.number(),
    user: v.string(),
    analyzerSerial: v.optional(v.string()),
    batchId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // This is a legacy dev-Convex compatibility mutation. Production inventory
    // is authoritative in Supabase, so keep this alternate quantity path
    // restricted to inventory administrators and never trust caller identity.
    const actorId = await requireCapability(ctx, "inventory.admin");
    const actor = await ctx.db.get(actorId);
    const actorLabel = actor?.name?.trim() || `user:${actorId}`;

    // Find the part
    const part = await ctx.db
      .query("parts")
      .withIndex("by_partNumber", (q) => q.eq("partNumber", args.partNumber))
      .first();
    if (!part) {
      return { success: false, error: "Part not found" };
    }

    const qtyBefore = part.qoh;
    let qtyAfter: number;

    if (args.mode === "RECEIVE" || args.mode === "IN") {
      qtyAfter = qtyBefore + args.qty;
    } else if (args.mode === "OUT") {
      qtyAfter = Math.max(0, qtyBefore - args.qty);
    } else if (args.mode === "ADJUST") {
      qtyAfter = args.qty; // Direct set in legacy dev compatibility only.
    } else {
      qtyAfter = qtyBefore + args.qty;
    }

    // Update the legacy Convex part QOH. This is not a production stock write.
    await ctx.db.patch(part._id, {
      qoh: qtyAfter,
      lastActivity: Date.now(),
    });

    // Create legacy transaction record with server-derived actor identity.
    await ctx.db.insert("transactions", {
      partNumber: args.partNumber,
      mode: args.mode,
      qty: args.qty,
      qtyBefore,
      qtyAfter,
      description: part.description,
      user: actorLabel,
      archived: false,
      timestamp: Date.now(),
      sapStatus: "NOT_PUSHED",
    });

    return {
      success: true,
      partNumber: args.partNumber,
      description: part.description,
      qtyBefore,
      qtyAfter,
      mode: args.mode,
    };
  },
});

export const create = mutation({
  args: {
    partNumber: v.string(),
    mode: v.string(),
    qty: v.number(),
    user: v.optional(v.string()),
    description: v.optional(v.string()),
    timestamp: v.number(),
    sapStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "inventory.admin");
    const actor = await ctx.db.get(actorId);
    const actorLabel = actor?.name?.trim() || `user:${actorId}`;

    return await ctx.db.insert("transactions", {
      ...args,
      user: actorLabel,
      archived: false,
      sapStatus: args.sapStatus ?? "NOT_PUSHED",
    });
  },
});
