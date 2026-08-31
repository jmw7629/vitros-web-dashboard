import { query } from "./_generated/server";
import { requireCapability } from "./authGuard";

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "rem.read");
    return await ctx.db.query("annualTargets").collect();
  },
});
