/**
 * Server-side configuration read helpers and feature gates.
 *
 * This module contains NO registered Convex functions (it is imported as a
 * plain module by queries/mutations), so it requires no generated API
 * entries. Actions read configuration through the internal queries
 * registered in convex/configActions.ts instead.
 *
 * Feature gates default to ENABLED when no published value exists, which
 * matches the pre-configuration behavior of every workflow. Publishing
 * `false` disables the corresponding server write path.
 */

import type { QueryCtx, MutationCtx } from "./_generated/server";
import { effectiveRoleCapabilities } from "./configContract";

type DbCtx = QueryCtx | MutationCtx;

/** Read a published config value (or null when never published). */
export async function readPublishedConfigValue(ctx: DbCtx, key: string): Promise<unknown> {
  const row = await ctx.db
    .query("configPublished")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  return row ? row.value : null;
}

/** Read the published role policy (or null when never published). */
export async function readRolePolicy(ctx: DbCtx): Promise<unknown> {
  return readPublishedConfigValue(ctx, "roles.policy");
}

/**
 * Effective capabilities for a role under the published policy. Fail-closed:
 * a missing or malformed policy falls back to the immutable defaults, and
 * the result is always clamped inside the ceiling plus the mandatory set.
 */
export async function effectiveCapabilitiesFor(
  ctx: DbCtx,
  role: string,
): Promise<string[]> {
  const policy = await readRolePolicy(ctx);
  return effectiveRoleCapabilities(role, policy);
}

/** Whether a feature flag is enabled (defaults to true = current behavior). */
export async function isFeatureEnabled(ctx: DbCtx, featureKey: string): Promise<boolean> {
  const value = await readPublishedConfigValue(ctx, featureKey);
  return typeof value === "boolean" ? value : true;
}

/**
 * Server-side feature gate for mutations. Throws a bounded, operator-readable
 * error when the workflow is disabled by configuration.
 */
export async function requireFeatureEnabled(
  ctx: DbCtx,
  featureKey: string,
  workflowLabel: string,
): Promise<void> {
  if (!(await isFeatureEnabled(ctx, featureKey))) {
    throw new Error(`${workflowLabel} is currently disabled by configuration`);
  }
}
