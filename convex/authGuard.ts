import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericQueryCtx, GenericMutationCtx, GenericActionCtx } from "convex/server";
import type { DataModel } from "./_generated/dataModel";

type Ctx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel> | GenericActionCtx<DataModel>;

export type Capability =
  | "inventory.read"
  | "inventory.write"
  | "inventory.admin"
  | "ai.ocr"
  | "rem.read"
  | "rem.write";

const ROLE_CAPABILITIES: Record<string, Capability[]> = {
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

export async function requireAuth(ctx: Ctx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

export async function getUserRole(
  ctx: GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>,
  userId: string,
): Promise<string> {
  const user = await ctx.db.get(userId as any);
  if (!user) return "viewer";
  return (user as any).role || "viewer";
}

export async function hasCapability(
  ctx: Ctx,
  userId: string,
  capability: Capability,
): Promise<boolean> {
  const role = await getUserRole(ctx as any, userId);
  const caps = ROLE_CAPABILITIES[role] || ROLE_CAPABILITIES.viewer;
  return caps.includes(capability);
}

export async function requireCapability(
  ctx: Ctx,
  capability: Capability,
) {
  const userId = await requireAuth(ctx);
  const allowed = await hasCapability(ctx, userId, capability);
  if (!allowed) throw new Error(`Missing capability: ${capability}`);
  return userId;
}
