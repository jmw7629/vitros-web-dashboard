import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// Separate from the retired generic account and from canonical employee logins.
export const SHARED_ENGINEER_ACCOUNT_ID = "engineer:open-v1";
export const SHARED_ENGINEER_NAME = "Engineer (shared access)";

export async function resolveServerIdentity(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!user) return null;
  const account = await ctx.db.query("authAccounts")
    .withIndex("userIdAndProvider", q => q.eq("userId", userId).eq("provider", "vitros-role")).unique();
  const accountId = account?.providerAccountId ?? "";
  const shared = accountId === SHARED_ENGINEER_ACCOUNT_ID;
  return {
    user,
    // The shared account can never acquire elevated privileges or an employee
    // attribution through a mutable profile, including on an existing session.
    role: shared ? "engineer" : user.role ?? "viewer",
    name: shared ? SHARED_ENGINEER_NAME : user.name?.trim() || null,
    employeeId: !shared && accountId.startsWith("employee:") ? accountId.slice("employee:".length) : null,
  };
}
