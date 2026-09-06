import { query } from "./_generated/server";
import { requireCapability } from "./authGuard";

export const listWeekly = query({
  args: {},
  handler: async (ctx) => {
    await requireCapability(ctx, "rem.read");
    return [];
  },
});
