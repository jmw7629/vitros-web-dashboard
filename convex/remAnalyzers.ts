// DEPRECATED: This file queries the parallel Convex REM table.
// Authoritative source is now Supabase via remSupabase.ts actions.
// Retained as fallback during migration only.
import { query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("remAnalyzers").collect();
  },
});
