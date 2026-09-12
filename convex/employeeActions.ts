// Canonical Supabase-backed employee directory boundary.
// Production authority: public.convex_employees (live columns: id uuid default gen_random_uuid,
// name/initials not null, active nullable true, convex_id nullable, created_at nullable timestamp)
// plus migration-added version integer not null default 1 and updated_at timestamptz.
// All writes route through the reviewed atomic RPC public.apply_employee_transition
// (p_action text, p_employee_id text, p_name text, p_initials text, p_active boolean,
// p_expected_version integer, p_correlation_id text, p_actor text, p_reason text DEFAULT NULL)
// RETURNS jsonb canonical row id/name/initials/active/version/created_at/updated_at (ISO timestamps).
// CREATE: id/version null; others require id/version; name/initials null means unchanged.
// Reads use direct Supabase GET on convex_employees. No direct PATCH/POST on the table.
// Authorization: admin.users.manage (verified in authGuard.ts ROLE_CAPABILITIES).
// Server-authoritative actor: String(requireCapability(ctx, "admin.users.manage")).
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";
import { publishRealtimePulse } from "./realtimePulsePublisher";

declare const process: { env: Record<string, string | undefined> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Employee directory service is not configured");
  return { url: url.replace(/\/$/, ""), serviceKey };
}

function supabaseHeaders(serviceKey: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

class EmployeeSqlRejection extends Error {
  readonly sqlCode?: string;
  constructor(message: string, sqlCode?: string) { super(message); this.sqlCode = sqlCode; }
}

async function sbFetch<T>(serviceKey: string, url: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...supabaseHeaders(serviceKey), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let code: string | undefined;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object" && "code" in (parsed as Record<string, unknown>)) {
        code = String((parsed as Record<string, unknown>).code ?? "");
      }
    } catch {
      // Not JSON – treat as opaque
    }
    // Fixed mappings ordered by spec: 40001 version conflict before 409 duplicate
    if (code === "40001") {
      throw new EmployeeSqlRejection("Version conflict: expected version does not match current version. Please refresh and retry.", code);
    }
    if (code === "23505") {
      throw new EmployeeSqlRejection("Duplicate employee initials: another active employee already uses those initials");
    }
    if (code === "P0001") {
      throw new EmployeeSqlRejection("Correlation id was already used for a different employee change");
    }
    if (code === "22023" || code === "P0002") throw new EmployeeSqlRejection("Employee change was rejected. Refresh the directory and correct the request.");
    if (res.status === 409) {
      throw new Error("Duplicate employee initials: another active employee already uses those initials");
    }
    throw new Error(`Supabase request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json()) as T;
  return json;
}

function validateUuid(value: string, label: string): string {
  const normalized = value.trim();
  if (!UUID_RE.test(normalized)) throw new Error(`Invalid ${label}`);
  return normalized;
}

function validateName(raw: string): string {
  const name = raw.trim();
  if (name.length < 1 || name.length > 100) throw new Error("Employee name must be 1-100 printable characters");
  if (raw !== name) throw new Error("Employee name must not have leading or trailing whitespace");
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error("Employee name must be 1-100 printable characters");
  return name;
}

function validateInitials(raw: string): string {
  const normalized = raw.trim().toUpperCase();
  if (!/^[A-Z0-9]{1,4}$/.test(normalized)) throw new Error("Employee initials are invalid");
  return normalized;
}

function validateCorrelationId(raw: string): string {
  const id = raw.trim();
  if (!id || id.length > 200) throw new Error("Invalid correlation id");
  return id;
}

function validateReason(raw: string | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const reason = raw.trim();
  if (!reason) return null;
  if (reason.length > 500) throw new Error("Reason is too long");
  return reason;
}

function validateExpectedVersion(value: number): number {
  if (!Number.isInteger(value) || value < 1) throw new Error("Expected version must be a positive integer");
  return value;
}

function toNumberTs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function mapEmployeeRowFromTable(row: Record<string, unknown>, actorId: string | null = null) {
  return {
    id: String(row.id ?? ""),
    actorId,
    name: String(row.name ?? ""),
    initials: String(row.initials ?? ""),
    active: row.active === true,
    version: Number(row.version ?? 1),
    createdAt: row.created_at === null ? null : toNumberTs(row.created_at),
    updatedAt: row.updated_at === null ? null : toNumberTs(row.updated_at),
  };
}

function validateAndMapEmployeeReceipt(row: Record<string, unknown>) {
  // Strict validation – no invented defaults. Reject malformed receipt.
  const idRaw = row.id;
  const id = typeof idRaw === "string" ? idRaw.trim() : "";
  if (!UUID_RE.test(id)) throw new Error("Employee transition returned invalid receipt");
  const nameRaw = row.name;
  if (typeof nameRaw !== "string" || nameRaw.trim().length < 1 || nameRaw.trim().length > 100) {
    throw new Error("Employee transition returned invalid receipt");
  }
  const name = nameRaw.trim();
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error("Employee transition returned invalid receipt");
  const initialsRaw = row.initials;
  if (typeof initialsRaw !== "string" || !/^[A-Z0-9]{1,4}$/.test(initialsRaw.trim().toUpperCase())) {
    throw new Error("Employee transition returned invalid receipt");
  }
  const initials = initialsRaw.trim().toUpperCase();
  if (row.active !== null && typeof row.active !== "boolean") throw new Error("Employee transition returned invalid receipt");
  const active = row.active === true;
  const versionRaw = row.version;
  if (!Number.isInteger(versionRaw) || (versionRaw as number) < 1) throw new Error("Employee transition returned invalid receipt");
  const version = Number(versionRaw);
  const createdAtRaw = row.created_at;
  const updatedAtRaw = row.updated_at;
  const createdAt = createdAtRaw === null ? null : toNumberTs(createdAtRaw);
  const updatedAt = toNumberTs(updatedAtRaw);
  if (createdAt !== null && (!Number.isFinite(createdAt) || createdAt === 0)) throw new Error("Employee transition returned invalid receipt");
  if (!Number.isFinite(updatedAt) || updatedAt === 0) throw new Error("Employee transition returned invalid receipt");
  return {
    id,
    actorId: null,
    name,
    initials,
    active,
    version,
    createdAt,
    updatedAt,
  };
}

const employeeRow = v.object({
  id: v.string(),
  actorId: v.union(v.string(), v.null()),
  name: v.string(),
  initials: v.string(),
  active: v.boolean(),
  version: v.number(),
  createdAt: v.union(v.number(), v.null()),
  updatedAt: v.union(v.number(), v.null()),
});

export type EmployeeRow = {
  id: string;
  actorId: string | null;
  name: string;
  initials: string;
  active: boolean;
  version: number;
  createdAt: number | null;
  updatedAt: number | null;
};

async function callApplyEmployeeTransition(
  ctx: ActionCtx,
  serviceKey: string,
  url: string,
  payload: {
    p_action: "CREATE" | "UPDATE" | "ACTIVATE" | "DEACTIVATE";
    p_employee_id: string | null;
    p_name: string | null;
    p_initials: string | null;
    p_active: boolean | null;
    p_expected_version: number | null;
    p_correlation_id: string;
    p_actor: string;
    p_reason: string | null;
  },
): Promise<Record<string, unknown>> {
  const operationId = payload.p_employee_id === null ? null : await ctx.runMutation(internal.employeeAccess.beginTransition, {
    employeeId: payload.p_employee_id,
    correlationId: payload.p_correlation_id,
    requestKey: JSON.stringify(payload),
    expectedVersion: payload.p_expected_version!,
  });
  let raw: unknown;
  try {
    raw = await sbFetch<unknown>(serviceKey, url, "rpc/apply_employee_transition", {
      method: "POST", body: JSON.stringify(payload),
    });
  } catch (error) {
    if (operationId && error instanceof EmployeeSqlRejection && error.sqlCode === "40001") {
      const proof = await sbFetch<Record<string, unknown>>(serviceKey, url, "rpc/reconcile_employee_transition", {
        method: "POST", body: JSON.stringify({ p_request: payload }),
      });
      if (proof?.outcome === "committed") {
        raw = proof.receipt;
      } else if (proof?.outcome === "superseded"
        && proof.employee_id === payload.p_employee_id?.toLowerCase()
        && proof.correlation_id === payload.p_correlation_id && proof.actor === payload.p_actor
        && proof.expected_version === payload.p_expected_version
        && Number.isInteger(proof.current_version) && Number(proof.current_version) > payload.p_expected_version!) {
        await ctx.runMutation(internal.employeeAccess.rejectTransition, { operationId, supersededVersion: Number(proof.current_version) });
        throw error;
      } else {
        // Equal/future versions and malformed proofs cannot safely resolve a lost invocation.
        throw error;
      }
    } else {
      if (operationId && error instanceof EmployeeSqlRejection) {
        await ctx.runMutation(internal.employeeAccess.rejectTransition, { operationId });
      }
      throw error;
    }
  }
  const row = Array.isArray(raw) && raw.length === 1 ? raw[0] : raw;
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Employee transition returned invalid receipt");
  const receipt = validateAndMapEmployeeReceipt(row as Record<string, unknown>);
  if (payload.p_active !== null && receipt.active !== payload.p_active) throw new Error("Employee transition returned invalid receipt");
  if (operationId) {
    await ctx.runMutation(internal.employeeAccess.completeTransition, {
      operationId, employeeId: receipt.id, version: receipt.version, active: receipt.active,
    });
  }
  return row as Record<string, unknown>;
}

export const listEmployees = action({
  args: {},
  returns: v.array(employeeRow),
  handler: async (ctx): Promise<EmployeeRow[]> => {
    await requireCapability(ctx, "admin.users.manage");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      "convex_employees?select=id,name,initials,active,version,created_at,updated_at&order=name.asc&limit=500",
    );
    if (!Array.isArray(rows)) throw new Error("Employee read returned invalid payload");
    const identities: { employeeId: string; actorId: string | null }[] = await ctx.runQuery(internal.employeeIdentity.resolveEmployeeActorIds, {
      employeeIds: rows.map((row) => String(row.id ?? "")),
    });
    const actors = new Map(identities.map(({ employeeId, actorId }) => [employeeId, actorId]));
    return rows.map((row) => mapEmployeeRowFromTable(row, actors.get(String(row.id).toLowerCase()) ?? null)) as EmployeeRow[];
  },
});

export const getEmployee = action({
  args: { id: v.string() },
  returns: v.union(employeeRow, v.null()),
  handler: async (ctx, args): Promise<EmployeeRow | null> => {
    await requireCapability(ctx, "admin.users.manage");
    const id = validateUuid(args.id, "employee id");
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<Record<string, unknown>[]>(
      serviceKey,
      url,
      `convex_employees?select=id,name,initials,active,version,created_at,updated_at&id=eq.${encodeURIComponent(id)}&limit=1`,
    );
    if (!Array.isArray(rows)) throw new Error("Employee read returned invalid payload");
    const row = rows[0];
    if (!row) return null;
    const identities: { employeeId: string; actorId: string | null }[] = await ctx.runQuery(internal.employeeIdentity.resolveEmployeeActorIds, { employeeIds: [String(row.id)] });
    return mapEmployeeRowFromTable(row, identities[0]?.actorId ?? null) as EmployeeRow;
  },
});

export const createEmployee = action({
  args: {
    name: v.string(),
    initials: v.string(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
    expectedVersion: v.optional(v.number()),
  },
  returns: employeeRow,
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "admin.users.manage");
    const name = validateName(args.name);
    const initials = validateInitials(args.initials);
    const correlationId = validateCorrelationId(args.correlationId);
    const reason = validateReason(args.reason);
    if (args.expectedVersion !== undefined && args.expectedVersion !== null) {
      validateExpectedVersion(args.expectedVersion);
    }
    const { url, serviceKey } = getSupabaseConfig();
    const row = await callApplyEmployeeTransition(ctx, serviceKey, url, {
      p_action: "CREATE",
      p_employee_id: null,
      p_name: name,
      p_initials: initials,
      p_active: true,
      p_expected_version: null,
      p_correlation_id: correlationId,
      p_actor: String(actorId),
      p_reason: reason,
    });
    const mapped = validateAndMapEmployeeReceipt(row) as EmployeeRow;
    await publishRealtimePulse(ctx);
    return mapped;
  },
});

export const updateEmployee = action({
  args: {
    id: v.string(),
    name: v.optional(v.string()),
    initials: v.optional(v.string()),
    active: v.optional(v.boolean()),
    expectedVersion: v.number(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: employeeRow,
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "admin.users.manage");
    const id = validateUuid(args.id, "employee id");
    const expectedVersion = validateExpectedVersion(args.expectedVersion);
    const correlationId = validateCorrelationId(args.correlationId);
    const reason = validateReason(args.reason);
    let pName: string | null = null;
    let pInitials: string | null = null;
    let pActive: boolean | null = null;
    let hasPatch = false;
    if (args.name !== undefined) {
      pName = validateName(args.name);
      hasPatch = true;
    }
    if (args.initials !== undefined) {
      pInitials = validateInitials(args.initials);
      hasPatch = true;
    }
    if (args.active !== undefined) {
      if (typeof args.active !== "boolean") throw new Error("Active must be boolean");
      pActive = args.active;
      hasPatch = true;
    }
    if (!hasPatch) throw new Error("No fields to update: provide name, initials, or active");
    const { url, serviceKey } = getSupabaseConfig();
    const row = await callApplyEmployeeTransition(ctx, serviceKey, url, {
      p_action: "UPDATE",
      p_employee_id: id,
      p_name: pName,
      p_initials: pInitials,
      p_active: pActive,
      p_expected_version: expectedVersion,
      p_correlation_id: correlationId,
      p_actor: String(actorId),
      p_reason: reason,
    });
    const mapped = validateAndMapEmployeeReceipt(row) as EmployeeRow;
    await publishRealtimePulse(ctx);
    return mapped;
  },
});

export const activateEmployee = action({
  args: {
    id: v.string(),
    expectedVersion: v.number(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: employeeRow,
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "admin.users.manage");
    const id = validateUuid(args.id, "employee id");
    const expectedVersion = validateExpectedVersion(args.expectedVersion);
    const correlationId = validateCorrelationId(args.correlationId);
    const reason = validateReason(args.reason);
    const { url, serviceKey } = getSupabaseConfig();
    const row = await callApplyEmployeeTransition(ctx, serviceKey, url, {
      p_action: "ACTIVATE",
      p_employee_id: id,
      p_name: null,
      p_initials: null,
      p_active: true,
      p_expected_version: expectedVersion,
      p_correlation_id: correlationId,
      p_actor: String(actorId),
      p_reason: reason,
    });
    const mapped = validateAndMapEmployeeReceipt(row) as EmployeeRow;
    await publishRealtimePulse(ctx);
    return mapped;
  },
});

export const deactivateEmployee = action({
  args: {
    id: v.string(),
    expectedVersion: v.number(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: employeeRow,
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "admin.users.manage");
    const id = validateUuid(args.id, "employee id");
    const expectedVersion = validateExpectedVersion(args.expectedVersion);
    const correlationId = validateCorrelationId(args.correlationId);
    const reason = validateReason(args.reason);
    const { url, serviceKey } = getSupabaseConfig();
    const row = await callApplyEmployeeTransition(ctx, serviceKey, url, {
      p_action: "DEACTIVATE",
      p_employee_id: id,
      p_name: null,
      p_initials: null,
      p_active: false,
      p_expected_version: expectedVersion,
      p_correlation_id: correlationId,
      p_actor: String(actorId),
      p_reason: reason,
    });
    const mapped = validateAndMapEmployeeReceipt(row) as EmployeeRow;
    await publishRealtimePulse(ctx);
    return mapped;
  },
});
