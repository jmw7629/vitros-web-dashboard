import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export async function resolveServerIdentity(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  if (!user) return null;
  const account = await ctx.db.query("authAccounts")
    .withIndex("userIdAndProvider", q => q.eq("userId", userId).eq("provider", "vitros-role")).unique();
  const accountId = account?.providerAccountId ?? "";

  // VITROS role sessions are authoritative from their immutable provider account.
  // A named engineer must always map to employee:<canonical employee UUID>. Any
  // retired/open/shared role account fails closed instead of inheriting a mutable
  // user-profile role or human attribution it cannot prove.
  if (account) {
    if (accountId === "superuser") {
      return { user, role: "superuser", name: user.name?.trim() || "Superuser", employeeId: null };
    }
    if (accountId.startsWith("employee:")) {
      return {
        user,
        role: "engineer",
        name: user.name?.trim() || null,
        employeeId: accountId.slice("employee:".length),
      };
    }
    return null;
  }

  // Non-role auth providers retain their server-stored least-privilege role.
  return { user, role: user.role ?? "viewer", name: user.name?.trim() || null, employeeId: null };
}
