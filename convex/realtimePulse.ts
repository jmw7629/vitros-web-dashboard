import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

const SHARED_SIGNAL_KEY = "shared-authoritative-data";

/**
 * Authenticated, payload-free invalidation signal for Supabase-backed shared data.
 * The browser learns only a monotonically increasing version and commit timestamp;
 * business data still comes through the existing server-authoritative read paths.
 */
export const watch = query({
  args: {},
  returns: v.object({ version: v.number(), updatedAt: v.number() }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Authentication required");

    const row = await ctx.db
      .query("realtimeSignals")
      .withIndex("by_key", (q) => q.eq("key", SHARED_SIGNAL_KEY))
      .unique();

    return row
      ? { version: row.version, updatedAt: row.updatedAt }
      : { version: 0, updatedAt: 0 };
  },
});

/** Server-only pulse. Convex serializes concurrent increments, preventing lost signals. */
export const bump = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("realtimeSignals")
      .withIndex("by_key", (q) => q.eq("key", SHARED_SIGNAL_KEY))
      .unique();
    const updatedAt = Date.now();

    if (!row) {
      await ctx.db.insert("realtimeSignals", {
        key: SHARED_SIGNAL_KEY,
        version: 1,
        updatedAt,
      });
      return 1;
    }

    const version = row.version + 1;
    await ctx.db.patch(row._id, { version, updatedAt });
    return version;
  },
});
