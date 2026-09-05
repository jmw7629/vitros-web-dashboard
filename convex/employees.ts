import { internalQuery } from "./_generated/server";

// Legacy Convex employee rows are retained only for backward-compatible dev data.
// Production employee identity is authoritative in Supabase and is exposed through
// authenticated server actions. Keep this compatibility query off the public API so
// unauthenticated callers cannot enumerate the legacy employee directory.
export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("employees").collect();
  },
});
