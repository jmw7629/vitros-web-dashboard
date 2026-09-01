// DEPRECATED: Stub returning empty array.
// Authoritative source is now Supabase via remSupabase.ts actions.
import { query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async _ctx => {
    return [];
  },
});
