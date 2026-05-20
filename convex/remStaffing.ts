import { query } from "./_generated/server";

export const getTrainingMatrix = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("staffMembers").collect();
  },
});
