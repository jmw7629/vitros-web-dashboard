import { v } from "convex/values";
import { internalQuery } from "./_generated/server";

// Internal read-only bridge from canonical directory UUIDs to immutable audit actors.
// Callers enforce admin.users.manage; account secrets/profile fields never leave here.
export const resolveEmployeeActorIds = internalQuery({
  args: { employeeIds: v.array(v.string()) },
  returns: v.array(v.object({
    employeeId: v.string(),
    actorId: v.union(v.id("users"), v.null()),
  })),
  handler: async (ctx, args) => {
    if (args.employeeIds.length > 500) throw new Error("Employee identity lookup exceeds 500 rows");
    const employeeIds = [...new Set(args.employeeIds.map((id) => {
      const canonical = id.trim().toLowerCase();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(canonical)) {
        throw new Error("Invalid canonical employee id");
      }
      return canonical;
    }))];
    return await Promise.all(employeeIds.map(async (employeeId) => {
      const accounts = await ctx.db.query("authAccounts")
        .withIndex("providerAndAccountId", (q) => q
          .eq("provider", "vitros-role")
          .eq("providerAccountId", `employee:${employeeId}`))
        .take(2);
      // Missing or ambiguous accounts never get a guessed name/initials association.
      return { employeeId, actorId: accounts.length === 1 ? accounts[0].userId : null };
    }));
  },
});
