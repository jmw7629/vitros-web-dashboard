// Seed file - not used in production (data lives in Supabase)
// Kept as placeholder for Convex schema compatibility

import { internalMutation } from "./_generated/server";

export const seedAll = internalMutation({
  args: {},
  handler: async (_ctx) => {
    // No-op: production data is in Supabase
    console.log("Seed skipped — production uses Supabase");
  },
});
