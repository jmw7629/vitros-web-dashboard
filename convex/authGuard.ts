import { getAuthUserId } from "@convex-dev/auth/server";
import { assertUserEmployeeAccess } from "./employeeAccess";
import { internal } from "./_generated/api";
import { resolveServerIdentity } from "./roleIdentity";
import { effectiveRoleCapabilities } from "./configContract";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";

export type Capability =
  | "inventory.read"
  | "inventory.write"
  | "inventory.admin"
  | "ai.ocr"
  | "rem.read"
  | "rem.write"
  | "admin.system_settings.manage"
  | "admin.users.manage"
  | "admin.audit.read";

export const ROLE_CAPABILITIES: Record<string, Capability[]> = {
  superuser: [
    "inventory.read",
    "inventory.write",
    "inventory.admin",
    "ai.ocr",
    "rem.read",
    "rem.write",
    "admin.system_settings.manage",
    "admin.users.manage",
    "admin.audit.read",
  ],
  engineer: [
    "inventory.read",
    "inventory.write",
    "ai.ocr",
    "rem.read",
    "rem.write",
  ],
  viewer: ["inventory.read", "rem.read"],
};

export const VALID_ROLES = Object.keys(ROLE_CAPABILITIES);

type AuthCtx = QueryCtx | MutationCtx | ActionCtx;
type DbCtx = QueryCtx | MutationCtx;

export async function requireAuth(ctx: AuthCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  if ("runQuery" in ctx) await ctx.runQuery(internal.employeeAccess.assertUserAccess, { userId });
  else await assertUserEmployeeAccess(ctx, userId);
  return userId;
}

async function getUserRole(ctx: DbCtx, userId: Id<"users">): Promise<string> {
  return (await resolveServerIdentity(ctx, userId))?.role ?? "viewer";
}

async function getRolePolicy(ctx: AuthCtx): Promise<unknown> {
  if ("db" in ctx) {
    const row = await ctx.db
      .query("configPublished")
      .withIndex("by_key", (q) => q.eq("key", "roles.policy"))
      .first();
    return row ? row.value : null;
  }
  return await ctx.runQuery(internal.configActions.getRolePolicyInternal, {});
}

export async function requireCapability(
  ctx: AuthCtx,
  capability: Capability,
): Promise<Id<"users">> {
  const userId = await requireAuth(ctx);

  const role = "runQuery" in ctx
    ? await ctx.runQuery(internal.users.getUserRole, { userId })
    : await getUserRole(ctx, userId);

  // Fail closed for any stored role that is not part of the server allowlist.
  // Unknown/corrupt/future role values must never inherit viewer access implicitly.
  const caps = ROLE_CAPABILITIES[role];
  if (!caps || !caps.includes(capability)) {
    throw new Error(`Missing capability: ${capability}`);
  }

  // Server-side role policy enforcement: the published policy may only REMOVE
  // optional capabilities inside the immutable ceiling (and can never remove
  // mandatory recovery access). effectiveRoleCapabilities clamps the stored
  // policy inside the ceiling and mandatory set, and falls back to the
  // immutable defaults when no valid policy exists — it can never widen.
  const policy = await getRolePolicy(ctx);
  const effective = effectiveRoleCapabilities(role, policy);
  if (!effective.includes(capability)) {
    throw new Error(`Capability disabled by role policy: ${capability}`);
  }
  return userId;
}
