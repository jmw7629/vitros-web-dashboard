import { getAuthUserId } from "@convex-dev/auth/server";
import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const getUserRole = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return user?.role ?? "viewer";
  },
});

// Server-only identity projection used when an external durable audit trail must
// carry a human-recognizable actor. Engineer identity is anchored to the immutable
// vitros-role provider account (`employee:<Supabase employee id>`), not mutable
// browser profile/localStorage fields.
export const getUserAuditIdentity = internalQuery({
  args: { userId: v.id("users") },
  returns: v.object({
    name: v.union(v.string(), v.null()),
    role: v.union(v.literal("superuser"), v.literal("engineer"), v.literal("viewer")),
    employeeId: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    let role: "superuser" | "engineer" | "viewer" = "viewer";
    if (user?.role === "superuser" || user?.role === "engineer") role = user.role;

    const account = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", userId).eq("provider", "vitros-role"))
      .unique();
    const providerAccountId = account?.providerAccountId ?? "";
    const employeeId = providerAccountId.startsWith("employee:")
      ? providerAccountId.slice("employee:".length)
      : null;

    return { name: user?.name?.trim() || null, role, employeeId };
  },
});

export const getMyProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

export const updateMyProfile = mutation({
  args: {
    name: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const updates: { name?: string; email?: string } = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.email !== undefined) updates.email = args.email;

    if (Object.keys(updates).length > 0) {
      await ctx.db.patch(userId, updates);
    }
    return { success: true };
  },
});

export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const authAccounts = await ctx.db
      .query("authAccounts")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();
    for (const account of authAccounts) {
      await ctx.db.delete(account._id);
    }

    const authSessions = await ctx.db
      .query("authSessions")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();
    for (const session of authSessions) {
      await ctx.db.delete(session._id);
    }

    await ctx.db.delete(userId);

    return { success: true };
  },
});
