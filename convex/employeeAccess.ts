import { v } from "convex/values";
import { internalMutation, internalQuery, type QueryCtx, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

type ReadCtx = QueryCtx | MutationCtx;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function canonicalId(raw: string) {
  const id = raw.trim().toLowerCase();
  if (!uuid.test(id)) throw new Error("Invalid employee identity");
  return id;
}

export async function assertEmployeeAccess(ctx: ReadCtx, rawEmployeeId: string): Promise<void> {
  const employeeId = canonicalId(rawEmployeeId);
  const barrier = await ctx.db.query("employeeAccessBarriers")
    .withIndex("by_employeeId", q => q.eq("employeeId", employeeId)).unique();
  if (!barrier || barrier.blocked || barrier.pendingOperation) {
    throw new Error("Employee access is suspended. Contact an administrator to complete or recover the employee change.");
  }
}

export async function assertUserEmployeeAccess(ctx: ReadCtx, userId: Id<"users">): Promise<void> {
  const account = await ctx.db.query("authAccounts")
    .withIndex("userIdAndProvider", q => q.eq("userId", userId).eq("provider", "vitros-role")).unique();
  if (account?.providerAccountId === "engineer:generic") throw new Error("Employee access requires a fresh canonical employee sign-in");
  if (account?.providerAccountId.startsWith("employee:")) {
    await assertEmployeeAccess(ctx, account.providerAccountId.slice("employee:".length));
  }
}

// Called only after the login action verifies canonical active status in Supabase.
// Missing barriers deny old sessions until that fresh verification succeeds.
export const provisionVerifiedEmployeeAccess = internalMutation({
  args: { employeeId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const employeeId = canonicalId(args.employeeId);
    const barrier = await ctx.db.query("employeeAccessBarriers")
      .withIndex("by_employeeId", q => q.eq("employeeId", employeeId)).unique();
    if (barrier) await assertEmployeeAccess(ctx, employeeId);
    else await ctx.db.insert("employeeAccessBarriers", { employeeId, blocked: false });
    return null;
  },
});

export const assertUserAccess = internalQuery({
  args: { userId: v.id("users") }, returns: v.null(),
  handler: async (ctx, { userId }) => {
    await assertUserEmployeeAccess(ctx, userId);
    return null;
  },
});

// Only the server action calls these transitions, after admin capability checks.
// A pending operation blocks existing sessions and new sign-ins before SQL starts.
export const beginTransition = internalMutation({
  args: { employeeId: v.string(), correlationId: v.string(), requestKey: v.string(), expectedVersion: v.number() },
  returns: v.id("employeeAccessOperations"),
  handler: async (ctx, args) => {
    const employeeId = canonicalId(args.employeeId);
    const previous = await ctx.db.query("employeeAccessOperations")
      .withIndex("by_correlationId", q => q.eq("correlationId", args.correlationId)).unique();
    if (previous) {
      if (previous.employeeId !== employeeId || previous.requestKey !== args.requestKey) {
        throw new Error("Correlation id was already used for a different employee change");
      }
      // Completed replays cannot alter a newer barrier.
      if (previous.status === "completed") return previous._id;
      if (previous.status === "pending") {
        await ctx.db.patch(previous._id, { inFlight: previous.inFlight + 1 });
        return previous._id;
      }
    }
    const barrier = await ctx.db.query("employeeAccessBarriers")
      .withIndex("by_employeeId", q => q.eq("employeeId", employeeId)).unique();
    if (barrier?.pendingOperation) {
      const pending = await ctx.db.get(barrier.pendingOperation);
      throw new Error(`Employee change is pending. Retry the original request with correlation ${pending?.correlationId ?? "unavailable"}; access remains suspended until recovery.`);
    }
    const operationId = previous ? previous._id : await ctx.db.insert("employeeAccessOperations", {
      ...args, employeeId, previousMissing: !barrier, previousBlocked: barrier?.blocked ?? true,
      status: "pending", startedAt: Date.now(), inFlight: 1,
    });
    if (previous) await ctx.db.patch(previous._id, {
      status: "pending", previousMissing: !barrier, previousBlocked: barrier?.blocked ?? true, inFlight: 1,
      finishedAt: undefined,
    });
    if (barrier) await ctx.db.patch(barrier._id, { pendingOperation: operationId });
    else await ctx.db.insert("employeeAccessBarriers", { employeeId, blocked: true, pendingOperation: operationId });
    return operationId;
  },
});

export const completeTransition = internalMutation({
  args: { operationId: v.id("employeeAccessOperations"), employeeId: v.string(), version: v.number(), active: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const op = await ctx.db.get(args.operationId);
    if (!op || op.employeeId !== canonicalId(args.employeeId) || args.version !== op.expectedVersion + 1) {
      throw new Error("Employee access recovery requires a matching committed receipt");
    }
    if (op.status === "completed") {
      if (op.confirmedVersion !== args.version || op.confirmedActive !== args.active) throw new Error("Employee receipt changed on replay");
      return null;
    }
    if (op.status !== "pending") throw new Error("Employee operation was rejected; use a new correlation id");
    const barrier = await ctx.db.query("employeeAccessBarriers")
      .withIndex("by_employeeId", q => q.eq("employeeId", op.employeeId)).unique();
    if (!barrier || barrier.pendingOperation !== op._id) throw new Error("Employee access recovery operation mismatch");
    await ctx.db.patch(barrier._id, { blocked: !args.active, pendingOperation: undefined });
    await ctx.db.patch(op._id, { status: "completed", finishedAt: Date.now(), confirmedVersion: args.version, confirmedActive: args.active });
    return null;
  },
});

// Called ONLY for an explicit SQL error proving that its transaction rolled back.
// Network errors, malformed receipts and missing responses never release a barrier.
export const rejectTransition = internalMutation({
  args: { operationId: v.id("employeeAccessOperations"), supersededVersion: v.optional(v.number()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const op = await ctx.db.get(args.operationId);
    if (!op || op.status !== "pending") return null;
    if (args.supersededVersion !== undefined && (!Number.isInteger(args.supersededVersion) || args.supersededVersion <= op.expectedVersion)) {
      throw new Error("Employee reconciliation requires a superseding version");
    }
    if (op.inFlight > 1 && args.supersededVersion === undefined) {
      await ctx.db.patch(op._id, { inFlight: op.inFlight - 1 });
      return null;
    }
    const barrier = await ctx.db.query("employeeAccessBarriers")
      .withIndex("by_employeeId", q => q.eq("employeeId", op.employeeId)).unique();
    if (!barrier || barrier.pendingOperation !== op._id) throw new Error("Employee access recovery operation mismatch");
    // Rollback restores absence as absence, allowing a fresh canonical login to
    // provision access. It must never turn an unverified rollout row into a
    // confirmed deactivation. Old operations without the snapshot stay blocked.
    if (op.previousMissing === true) await ctx.db.delete(barrier._id);
    else await ctx.db.patch(barrier._id, { blocked: op.previousBlocked, pendingOperation: undefined });
    await ctx.db.patch(op._id, { status: "rejected", finishedAt: Date.now() });
    return null;
  },
});
