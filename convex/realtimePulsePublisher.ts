import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

/**
 * Publish invalidation only after the authoritative Supabase write has committed.
 * Pulse delivery is deliberately best-effort: a Convex signaling outage must not
 * convert a committed idempotent Supabase write into an apparent failure/retry.
 * The existing 10–15s reconciler remains the fail-safe recovery path.
 */
export async function publishRealtimePulse(ctx: ActionCtx): Promise<void> {
  try {
    await ctx.runMutation(internal.realtimePulse.bump, {});
  } catch {
    console.warn("Realtime invalidation pulse unavailable; fallback reconciliation remains active");
  }
}
