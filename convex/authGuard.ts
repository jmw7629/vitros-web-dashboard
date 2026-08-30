import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";

export type Capability =
  | "inventory.read"
  | "inventory.write"
  | "inventory.admin"
  | "ai.ocr"
  | "rem.read"
  | "rem.write";

export const ROLE_CAPABILITIES: Record<string, Capability[]> = {
  superuser: [
    "inventory.read",
    "inventory.write",
    "inventory.admin",
    "ai.ocr",
    "rem.read",
    "rem.write",
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
  return userId;
}

async function getUserRole(ctx: DbCtx, userId: Id<"users">): Promise<string> {
  const user = await ctx.db.get(userId);
  return user?.role ?? "viewer";
}

export async function requireCapability(
  ctx: AuthCtx,
  capability: Capability,
): Promise<Id<"users">> {
  const userId = await requireAuth(ctx);

  const role = "runQuery" in ctx
    ? await ctx.runQuery(internal.users.getUserRole, { userId })
    : await getUserRole(ctx, userId);

  const caps = ROLE_CAPABILITIES[role] ?? ROLE_CAPABILITIES.viewer;
  if (!caps.includes(capability)) {
    throw new Error(`Missing capability: ${capability}`);
  }
  return userId;
}
