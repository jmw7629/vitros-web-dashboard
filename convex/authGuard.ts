import { getAuthUserId } from "@convex-dev/auth/server";
import type { DataModel } from "./_generated/dataModel";

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

// Works with any Convex context type (query, mutation, or action)
export async function requireAuth(ctx: any) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  return userId;
}

export async function getUserRole(ctx: any, userId: string): Promise<string> {
  if (!ctx.db) return "viewer";
  const user = await ctx.db.get(userId);
  if (!user) return "viewer";
  return (user as any).role || "viewer";
}

export async function requireCapability(
  ctx: any,
  capability: Capability,
): Promise<string> {
  const userId = await requireAuth(ctx);
  // For actions, use runQuery to check role; for queries/mutations, use ctx.db directly
  let role: string;
  if (ctx.runQuery) {
    // Action context — delegate to internal query
    role = await ctx.runQuery(("users" as any).getUserRole, { userId });
  } else if (ctx.db) {
    role = await getUserRole(ctx, userId);
  } else {
    role = "viewer";
  }
  const caps = ROLE_CAPABILITIES[role] || ROLE_CAPABILITIES.viewer;
  if (!caps.includes(capability)) {
    throw new Error(`Missing capability: ${capability}`);
  }
  return userId;
}
