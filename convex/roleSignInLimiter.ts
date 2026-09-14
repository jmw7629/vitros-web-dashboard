import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

const WINDOW_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 6;
const ticket = v.object({ reservationId: v.string(), windowStartedAt: v.number() });

// Fixed server bucket; callers cannot choose a role, key, clock or allowance.
// Reservations count before Scrypt runs, so parallel actions cannot oversubscribe.
// Failures/crashed actions retain their slot until expiry. Only a successful
// verifier releases its own slot, and can never release a newer window's slot.
export const reserveSuperuserAttempt = internalMutation({
  args: {}, returns: v.union(v.null(), ticket),
  handler: async ctx => {
    const now = Date.now();
    const current = await ctx.db.query("roleSignInLimits")
      .withIndex("by_key", q => q.eq("key", "superuser")).unique();
    const expired = !current || now - current.windowStartedAt >= WINDOW_MS;
    const reservations = expired ? [] : current.reservations;
    if (reservations.length >= MAX_ATTEMPTS) return null;
    const windowStartedAt = expired ? now : current.windowStartedAt;
    const sequence = (expired ? 0 : current.sequence) + 1;
    if (!Number.isSafeInteger(sequence)) return null;
    const reservationId = String(sequence);
    const values = { key: "superuser" as const, windowStartedAt, sequence, reservations: [...reservations, reservationId] };
    if (current) await ctx.db.patch(current._id, values);
    else await ctx.db.insert("roleSignInLimits", values);
    return { reservationId, windowStartedAt };
  },
});

export const releaseSuccessfulSuperuserAttempt = internalMutation({
  args: { reservationId: v.string(), windowStartedAt: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const current = await ctx.db.query("roleSignInLimits")
      .withIndex("by_key", q => q.eq("key", "superuser")).unique();
    if (current && current.windowStartedAt === args.windowStartedAt && current.reservations.includes(args.reservationId)) {
      await ctx.db.patch(current._id, { reservations: current.reservations.filter(id => id !== args.reservationId) });
    }
    return null;
  },
});
