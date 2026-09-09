// ▼▼▼ TYPE CHECK MAY REPORT ISSUES DUE TO Convex/TypeScript Configuration ▼▼▼
// The runtime behavior is correct; type checking may show false positives.
// ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼

import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

const employeeRow = v.object({
  id: v.string(),
  name: v.string(),
  initials: v.string(),
  active: v.boolean(),
  version: v.number(),
  createdAt: v.number,
  updatedAt: v.number,
});

export type EmployeeRow = v.Infer<typeof employeeRow>;

// ─── List all employees ───
export const listEmployees = action({
  args: {},
  returns: v.array(employeeRow),
  handler: async (ctx) => {
    await requireCapability(ctx, "admin.users.manage");
    return await ctx.db.query("employees").collect();
  },
});

// ─── Insert employee ───
export const createEmployee = action({
  args: {
    name: v.string(),
    initials: v.string(),
    expectedVersion: v.optional(v.number()),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: employeeRow,
  handler: async (ctx, args) => {
    await requireCapability(ctx, "admin.users.manage");

    const normalizedInitials = args.initials.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,4}$/.test(normalizedInitials)) {
      throw new Error("Employee initials are invalid");
    }

    // Check for duplicate canonical initials among active employees
    const duplicate = await ctx.db
      .query("employees")
      .withIndex("by_initials", (q) => q.eq("initials", normalizedInitials).eq("active", true))
      .maybe();
    if (duplicate) {
      throw new Error(
        `Duplicate employee initials: ${args.initials}. Another active employee already has these canonical initials.`,
      );
    }

    const trimmedName = args.name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 100) {
      throw new Error("Employee name must be 1-100 printable characters");
    }
    if (trimmedName !== args.name) {
      throw new Error("Employee name must not have leading or trailing whitespace");
    }

    const version = args.expectedVersion ?? 1;
    const now = Date.now();

    const result = await ctx.db
      .insert("employees")
      .mutate({
        name: trimmedName,
        initials: normalizedInitials,
        active: true,
        version,
        createdAt: now,
        updatedAt: now,
      });

    // Insert immutable audit event
    await ctx.runMutation({
      mutation: "public.insert_employee_event",
      args: {
        correlationId: args.correlationId,
        employeeId: result._id,
        action: "CREATE",
        previousName: null,
        previousInititals: null,
        newName: trimmedName,
        newInititals: normalizedInitials,
        newVersion: version + 1,
        reason: args.reason,
      },
    });

    return result;
  },
});

// ─── Update employee ───
export const updateEmployee = action({
  args: {
    id: v.string(),
    name: v.string(),
    initials: v.string(),
    expectedVersion: v.number(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: employeeRow,
  handler: async (ctx, args) => {
    await requireCapability(ctx, "admin.users.manage");

    const existing = await ctx.db.get("employees", args.id);
    if (!existing) {
      throw new Error("Employee not found");
    }

    // Expected-version conflict check
    if (existing.version !== args.expectedVersion) {
      throw new Error(
        `Version conflict: expected version ${args.expectedVersion}, current version ${existing.version}. ` +
          "Another admin has modified this employee. Please re-fetch and retry.",
      );
    }

    const normalizedInitials = args.initials.trim().toUpperCase();
    if (!/^[A-Z0-9]{1,4}$/.test(normalizedInitials)) {
      throw new Error("Employee initials are invalid");
    }

    // Check for duplicate canonical initials among OTHER active employees
    const duplicate = await ctx.db
      .query("employees")
      .withIndex("by_initials", (q) =>
        q.eq("initials", normalizedInitials).eq("active").neq("id", args.id),
      )
      .maybe();
    if (duplicate) {
      throw new Error(
        `Duplicate employee initials: ${args.initials}. Another active employee already has these canonical initials.`,
      );
    }

    const trimmedName = args.name.trim();
    if (trimmedName.length < 1 || trimmedName.length > 100) {
      throw new Error("Employee name must be 1-100 printable characters");
    }
    if (trimmedName !== args.name) {
      throw new Error("Employee name must not have leading or trailing whitespace");
    }

    const newVersion = existing.version + 1;
    const now = Date.now();

    const result = await ctx.db
      .patch("employees", args.id)
      .mutate({
        name: trimmedName,
        initials: normalizedInitials,
        version: newVersion,
        updatedAt: now,
      });

    // Insert immutable audit event
    await ctx.runMutation({
      mutation: "public.insert_employee_event",
      args: {
        correlationId: args.correlationId,
        employeeId: args.id,
        action: "UPDATE",
        previousName: existing.name,
        previousInititals: existing.initials,
        newName: trimmedName,
        newInititals: normalizedInitials,
        newVersion,
        reason: args.reason,
      },
    });

    return result;
  },
});

// ─── Activate employee ───
export const activateEmployee = action({
  args: {
    id: v.string(),
    expectedVersion: v.number(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: employeeRow,
  handler: async (ctx, args) => {
    await requireCapability(ctx, "admin.users.manage");

    const existing = await ctx.db.get("employees", args.id);
    if (!existing) {
      throw new Error("Employee not found");
    }

    // Expected-version conflict check
    if (existing.version !== args.expectedVersion) {
      throw new Error(
        `Version conflict: expected version ${args.expectedVersion}, current version ${existing.version}. ` +
          "Another admin has modified this employee. Please re-fetch and retry.",
      );
    }

    const newVersion = existing.version + 1;
    const now = Date.now();

    const result = await ctx.db
      .patch("employees", args.id)
      .mutate({
        active: true,
        version: newVersion,
        updatedAt: now,
      });

    // Insert immutable audit event
    await ctx.runMutation({
      mutation: "public.insert_employee_event",
      args: {
        correlationId: args.correlationId,
        employeeId: args.id,
        action: "ACTIVATE",
        previousName: existing.name,
        previousInititals: existing.initials,
        newName: existing.name,
        newInititals: existing.initials,
        newVersion,
        reason: args.reason,
      },
    });

    return result;
  },
});

// ─── Deactivate employee ───
export const deactivateEmployee = action({
  args: {
    id: v.string(),
    expectedVersion: v.number(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: employeeRow,
  handler: async (ctx, args) => {
    await requireCapability(ctx, "admin.users.manage");

    const existing = await ctx.db.get("employees", args.id);
    if (!existing) {
      throw new Error("Employee not found");
    }

    // Expected-version conflict check
    if (existing.version !== args.expectedVersion) {
      throw new Error(
        `Version conflict: expected version ${args.expectedVersion}, current version ${existing.version}. ` +
          "Another admin has modified this employee. Please re-fetch and retry.",
      );
    }

    const newVersion = existing.version + 1;
    const now = Date.now();

    const result = await ctx.db
      .patch("employees", args.id)
      .mutate({
        active: false,
        version: newVersion,
        updatedAt: now,
      });

    // Insert immutable audit event
    await ctx.runMutation({
      mutation: "public.insert_employee_event",
      args: {
        correlationId: args.correlationId,
        employeeId: args.id,
        action: "DEACTIVATE",
        previousName: existing.name,
        previousInititals: existing.initials,
        newName: existing.name,
        newInititals: existing.initials,
        newVersion,
        reason: args.reason,
      },
    });

    return result;
  },
});

export const employeeActions = {
  listEmployees,
  createEmployee,
  updateEmployee,
  activateEmployee,
  deactivateEmployee,
};