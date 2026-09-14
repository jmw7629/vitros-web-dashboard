import { getAuthUserId } from "@convex-dev/auth/server";
import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { resolveServerIdentity } from "./roleIdentity";

export const getUserRole = internalQuery({
  args: { userId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, { userId }) => {
    return (await resolveServerIdentity(ctx, userId))?.role ?? "viewer";
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
    const identity = await resolveServerIdentity(ctx, userId);
    let role: "superuser" | "engineer" | "viewer" = "viewer";
    if (identity?.role === "superuser" || identity?.role === "engineer") role = identity.role;
    return { name: identity?.name ?? null, role, employeeId: identity?.employeeId ?? null };
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

// Identity fields participate in enterprise attribution and authentication. They
// must not be writable directly by a browser session, even by the account owner.
// Preserve the public function and wire shape for compatibility, but fail closed
// until the reviewed admin identity lifecycle owns these changes with RBAC/audit.
export const updateMyProfile = mutation({
  args: {
    name: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    throw new Error(
      "Profile identity changes are disabled. Use the reviewed enterprise user-management workflow.",
    );
  },
});

// Account deletion removes authentication identity and sessions and is therefore
// a destructive enterprise lifecycle operation. Keep the endpoint fail-closed so
// legacy clients receive a deterministic error instead of deleting identity data.
export const deleteAccount = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    throw new Error(
      "Account deletion is disabled. Use a reviewed, audited enterprise user-lifecycle workflow.",
    );
  },
});
