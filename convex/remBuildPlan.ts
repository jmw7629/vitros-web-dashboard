import { query } from "./_generated/server";
import { requireCapability } from "./authGuard";

export const list = query({
  args: {},
  handler: async (_ctx) => {
    await requireCapability(_ctx, "rem.read");
    return [];
  },
});
