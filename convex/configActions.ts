/**
 * VITROS server-authoritative configuration lifecycle.
 *
 * Security model:
 * - Every write requires the server-resolved `admin.system_settings.manage`
 *   capability (and draft ownership where applicable). Audit actor/capability
 *   values are ALWAYS server-derived; no public function accepts them.
 * - Audit entries are appended by a private helper inside the same
 *   transaction as the authorized write — there is no public or client
 *   reachable audit-insertion function.
 * - Drafts have an explicit identity (their document id), a server owner,
 *   a monotonically increasing revision, and preserve the published base
 *   revision. Every draft mutation takes an expected-revision precondition,
 *   so two tabs sharing an account cannot overwrite or publish each other's
 *   unseen edits.
 * - Publish names the exact reviewed draft revision, the exact reviewed
 *   content digest, and the expected published version. The value is
 *   re-validated against the shared contract at publication time.
 * - Rollback resolves the exact requested published version from immutable
 *   `configVersions` snapshots (a draft audit event is never a version),
 *   validates it against the current contract, takes an expected-current-
 *   version precondition, and appends a new version plus accurate audit.
 * - Import preview is read-only; apply is ONE authorized mutation that
 *   re-validates the strict envelope, checks per-key version preconditions,
 *   applies every change atomically, and stores a bounded idempotency
 *   receipt so an exact retry returns the previous result while a changed
 *   payload reusing the same correlation id conflicts.
 * - Public reads expose only non-secret presentation values, without actor
 *   metadata, bounded by the registry size.
 *
 * Validation lives in convex/configContract.ts — the single shared contract
 * also used by the browser, so the two sides cannot diverge.
 */

import { internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { requireCapability } from "./authGuard";
import {
  ALL_CONFIG_KEYS,
  IMPORT_SCHEMA_VERSION,
  canonicalJson,
  getConfigEntry,
  importPayloadDigest,
  isPublicConfigKey,
  validateConfigValue,
  validateImportEnvelope,
  valueDigest,
  type NormalizedImportEntry,
} from "./configContract";

// ─── Validators ──────────────────────────────────────────────────────────

const AUDIT_ACTION = v.union(
  v.literal("create"),
  v.literal("update"),
  v.literal("delete"),
  v.literal("rollback"),
  v.literal("publish"),
  v.literal("import"),
);

const publicRow = v.object({
  key: v.string(),
  value: v.any(),
  version: v.number(),
  publishedAt: v.number(),
});

const adminPublishedRow = v.object({
  key: v.string(),
  value: v.any(),
  version: v.number(),
  publishedAt: v.number(),
  publishedBy: v.string(),
});

const draftRow = v.object({
  draftId: v.id("configDrafts"),
  key: v.string(),
  value: v.any(),
  baseVersion: v.number(),
  revision: v.number(),
  owner: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const versionRow = v.object({
  key: v.string(),
  version: v.number(),
  value: v.any(),
  publishedAt: v.number(),
  publishedBy: v.string(),
});

const auditRow = v.object({
  key: v.string(),
  action: AUDIT_ACTION,
  previousValue: v.optional(v.any()),
  newValue: v.optional(v.any()),
  actor: v.string(),
  capability: v.string(),
  timestamp: v.number(),
  correlationId: v.string(),
  reason: v.optional(v.string()),
});

const MAX_OPEN_DRAFTS_PER_OWNER = 20;
const MAX_RECEIPTS = 100;

function checkCorrelationId(raw: string): string {
  const correlationId = raw.trim();
  if (!correlationId || correlationId.length > 200) {
    throw new Error("Invalid correlation id");
  }
  return correlationId;
}

function checkReason(raw: string | undefined): string | undefined {
  const reason = raw?.trim();
  if (reason && reason.length > 500) throw new Error("Reason is too long");
  return reason || undefined;
}

/** Validate and return a config value or throw a bounded error. */
function assertConfigValue(key: string, value: unknown): void {
  const result = validateConfigValue(key, value);
  if (!result.valid) throw new Error(result.error ?? `Invalid value for ${key}`);
}

/**
 * Private audit append — runs inside the SAME transaction as the authorized
 * write that calls it. Actor and capability are server-derived only.
 */
async function appendAudit(
  ctx: MutationCtx,
  entry: {
    key: string;
    action: "create" | "update" | "delete" | "rollback" | "publish" | "import";
    previousValue?: unknown;
    newValue?: unknown;
    actor: string;
    capability: string;
    correlationId: string;
    reason?: string;
  },
): Promise<void> {
  await ctx.db.insert("configAuditLog", {
    key: entry.key,
    action: entry.action,
    ...(entry.previousValue !== undefined ? { previousValue: entry.previousValue } : {}),
    ...(entry.newValue !== undefined ? { newValue: entry.newValue } : {}),
    actor: entry.actor,
    capability: entry.capability,
    timestamp: Date.now(),
    correlationId: entry.correlationId,
    ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
  });
}

async function getPublishedRow(ctx: QueryCtx | MutationCtx, key: string) {
  return ctx.db
    .query("configPublished")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
}

// ─── Public queries (non-secret presentation values only) ────────────────

export const listPublished = query({
  args: {},
  returns: v.array(publicRow),
  handler: async (ctx) => {
    const keys = ALL_CONFIG_KEYS.filter(isPublicConfigKey);
    const rows = await Promise.all(keys.map((key) => getPublishedRow(ctx, key)));
    return rows
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .map((row) => ({
        key: row.key,
        value: row.value,
        version: row.version,
        publishedAt: row.publishedAt,
      }));
  },
});

export const getPublished = query({
  args: { key: v.string() },
  returns: v.union(publicRow, v.null()),
  handler: async (ctx, args) => {
    if (!isPublicConfigKey(args.key)) return null;
    const row = await getPublishedRow(ctx, args.key);
    if (!row) return null;
    return {
      key: row.key,
      value: row.value,
      version: row.version,
      publishedAt: row.publishedAt,
    };
  },
});

// ─── Admin queries ───────────────────────────────────────────────────────

export const listPublishedAdmin = query({
  args: {},
  returns: v.array(adminPublishedRow),
  handler: async (ctx) => {
    await requireCapability(ctx, "admin.system_settings.manage");
    const keys = ALL_CONFIG_KEYS;
    const rows = await Promise.all(keys.map((key) => getPublishedRow(ctx, key)));
    return rows
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .map((row) => ({
        key: row.key,
        value: row.value,
        version: row.version,
        publishedAt: row.publishedAt,
        publishedBy: row.publishedBy,
      }));
  },
});

export const listVersions = query({
  args: { key: v.string(), limit: v.optional(v.number()) },
  returns: v.array(versionRow),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "admin.system_settings.manage");
    if (!getConfigEntry(args.key)) throw new Error(`Unknown config key: ${args.key}`);
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const rows = await ctx.db
      .query("configVersions")
      .withIndex("by_key_and_version", (q) => q.eq("key", args.key))
      .order("desc")
      .take(limit);
    return rows.map((row) => ({
      key: row.key,
      version: row.version,
      value: row.value,
      publishedAt: row.publishedAt,
      publishedBy: row.publishedBy,
    }));
  },
});

export const listDrafts = query({
  args: {},
  returns: v.array(draftRow),
  handler: async (ctx) => {
    const userId = await requireCapability(ctx, "admin.system_settings.manage");
    const rows = await ctx.db
      .query("configDrafts")
      .withIndex("by_owner", (q) => q.eq("owner", String(userId)))
      .order("desc")
      .take(MAX_OPEN_DRAFTS_PER_OWNER);
    return rows.map((row) => ({
      draftId: row._id,
      key: row.key,
      value: row.value,
      baseVersion: row.baseVersion,
      revision: row.revision,
      owner: row.owner,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  },
});

export const getDraft = query({
  args: { draftId: v.id("configDrafts") },
  returns: v.union(draftRow, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "admin.system_settings.manage");
    const row = await ctx.db.get(args.draftId);
    if (!row) return null;
    if (row.owner !== String(userId)) {
      throw new Error("Only the draft owner can access this draft");
    }
    return {
      draftId: row._id,
      key: row.key,
      value: row.value,
      baseVersion: row.baseVersion,
      revision: row.revision,
      owner: row.owner,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  },
});

export const getAuditLog = query({
  args: { key: v.optional(v.string()), limit: v.optional(v.number()) },
  returns: v.array(auditRow),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "admin.audit.read");
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const collectRows = args.key
      ? await ctx.db
          .query("configAuditLog")
          .withIndex("by_key", (q) => q.eq("key", args.key ?? ""))
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("configAuditLog")
          .withIndex("by_timestamp")
          .order("desc")
          .take(limit);
    return collectRows.map((row) => ({
      key: row.key,
      action: row.action,
      previousValue: row.previousValue,
      newValue: row.newValue,
      actor: row.actor,
      capability: row.capability,
      timestamp: row.timestamp,
      correlationId: row.correlationId,
      reason: row.reason,
    }));
  },
});

// ─── Internal queries (trusted; used by actions and the auth guard) ──────

export const getRolePolicyInternal = internalQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("configPublished")
      .withIndex("by_key", (q) => q.eq("key", "roles.policy"))
      .first();
    return row ? row.value : null;
  },
});

export const getConfigValueInternal = internalQuery({
  args: { key: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    if (!getConfigEntry(args.key)) return null;
    const row = await ctx.db
      .query("configPublished")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    return row ? row.value : null;
  },
});

// ─── Draft lifecycle mutations ───────────────────────────────────────────

export const createDraft = mutation({
  args: {
    key: v.string(),
    value: v.any(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: draftRow,
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "admin.system_settings.manage");
    if (!getConfigEntry(args.key)) throw new Error(`Unknown config key: ${args.key}`);
    assertConfigValue(args.key, args.value);
    const correlationId = checkCorrelationId(args.correlationId);
    const reason = checkReason(args.reason);

    const published = await getPublishedRow(ctx, args.key);
    const baseVersion = published ? published.version : 0;

    // Bound the number of open drafts per owner so drafts cannot accumulate
    // without limit. Each draft is a separate row — createDraft NEVER
    // overwrites an existing draft.
    const openDrafts = await ctx.db
      .query("configDrafts")
      .withIndex("by_owner", (q) => q.eq("owner", String(userId)))
      .order("desc")
      .take(MAX_OPEN_DRAFTS_PER_OWNER + 1);
    if (openDrafts.length >= MAX_OPEN_DRAFTS_PER_OWNER) {
      throw new Error(
        `Too many open drafts (limit ${MAX_OPEN_DRAFTS_PER_OWNER}). Publish or delete existing drafts first.`,
      );
    }

    const now = Date.now();
    const draftId = await ctx.db.insert("configDrafts", {
      key: args.key,
      value: args.value,
      baseVersion,
      revision: 1,
      owner: String(userId),
      createdAt: now,
      updatedAt: now,
    });

    await appendAudit(ctx, {
      key: args.key,
      action: "create",
      previousValue: published ? published.value : undefined,
      newValue: args.value,
      actor: String(userId),
      capability: "admin.system_settings.manage",
      correlationId,
      reason,
    });

    return {
      draftId,
      key: args.key,
      value: args.value,
      baseVersion,
      revision: 1,
      owner: String(userId),
      createdAt: now,
      updatedAt: now,
    };
  },
});

export const updateDraft = mutation({
  args: {
    draftId: v.id("configDrafts"),
    expectedRevision: v.number(),
    value: v.any(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: draftRow,
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "admin.system_settings.manage");
    const correlationId = checkCorrelationId(args.correlationId);
    const reason = checkReason(args.reason);

    const draft = await ctx.db.get(args.draftId);
    if (!draft) throw new Error("Draft not found");
    if (draft.owner !== String(userId)) {
      throw new Error("Only the draft owner can modify this draft");
    }
    if (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 1) {
      throw new Error("Expected revision must be a positive integer");
    }
    if (draft.revision !== args.expectedRevision) {
      throw new Error(
        `Draft conflict: the draft changed since it was loaded (expected revision ${args.expectedRevision}, current ${draft.revision}). Refresh and review before saving again.`,
      );
    }
    assertConfigValue(draft.key, args.value);

    const now = Date.now();
    await ctx.db.patch(args.draftId, {
      value: args.value,
      revision: draft.revision + 1,
      updatedAt: now,
    });

    await appendAudit(ctx, {
      key: draft.key,
      action: "update",
      previousValue: draft.value,
      newValue: args.value,
      actor: String(userId),
      capability: "admin.system_settings.manage",
      correlationId,
      reason,
    });

    return {
      draftId: args.draftId,
      key: draft.key,
      value: args.value,
      baseVersion: draft.baseVersion,
      revision: draft.revision + 1,
      owner: draft.owner,
      createdAt: draft.createdAt,
      updatedAt: now,
    };
  },
});

export const deleteDraft = mutation({
  args: {
    draftId: v.id("configDrafts"),
    expectedRevision: v.number(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "admin.system_settings.manage");
    const correlationId = checkCorrelationId(args.correlationId);
    const reason = checkReason(args.reason);

    const draft = await ctx.db.get(args.draftId);
    if (!draft) return false;
    if (draft.owner !== String(userId)) {
      throw new Error("Only the draft owner can delete this draft");
    }
    if (draft.revision !== args.expectedRevision) {
      throw new Error(
        `Draft conflict: the draft changed since it was loaded (expected revision ${args.expectedRevision}, current ${draft.revision}). Refresh and review before deleting.`,
      );
    }

    await ctx.db.delete(args.draftId);
    await appendAudit(ctx, {
      key: draft.key,
      action: "delete",
      previousValue: draft.value,
      actor: String(userId),
      capability: "admin.system_settings.manage",
      correlationId,
      reason: reason ?? "Draft deleted",
    });
    return true;
  },
});

export const publishDraft = mutation({
  args: {
    draftId: v.id("configDrafts"),
    expectedDraftRevision: v.number(),
    expectedValueDigest: v.string(),
    expectedPublishedVersion: v.number(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: adminPublishedRow,
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "admin.system_settings.manage");
    const correlationId = checkCorrelationId(args.correlationId);
    const reason = checkReason(args.reason);

    const draft = await ctx.db.get(args.draftId);
    if (!draft) throw new Error("Draft not found");
    if (draft.owner !== String(userId)) {
      throw new Error("Only the draft owner can publish this draft");
    }

    // Publish must name the EXACT reviewed draft revision and content. A
    // concurrent edit (revision bump) or a stale review conflicts explicitly
    // instead of publishing the latest unseen draft.
    if (!Number.isInteger(args.expectedDraftRevision) || args.expectedDraftRevision < 1) {
      throw new Error("Expected draft revision must be a positive integer");
    }
    if (draft.revision !== args.expectedDraftRevision) {
      throw new Error(
        `Draft conflict: the draft changed after review (expected revision ${args.expectedDraftRevision}, current ${draft.revision}). Review the latest draft before publishing.`,
      );
    }
    const digest = valueDigest(draft.value);
    if (digest !== args.expectedValueDigest) {
      throw new Error(
        "Draft conflict: the reviewed content no longer matches the stored draft. Review the latest draft before publishing.",
      );
    }

    // Re-validate at publication time against the CURRENT shared contract.
    assertConfigValue(draft.key, draft.value);

    const published = await getPublishedRow(ctx, draft.key);
    const currentVersion = published ? published.version : 0;
    if (!Number.isInteger(args.expectedPublishedVersion) || args.expectedPublishedVersion < 0) {
      throw new Error("Expected published version must be a non-negative integer");
    }
    if (currentVersion !== args.expectedPublishedVersion) {
      throw new Error(
        `Version conflict: expected v${args.expectedPublishedVersion} but current is v${currentVersion}. Refresh and review before publishing again.`,
      );
    }

    const now = Date.now();
    const newVersion = currentVersion + 1;
    if (published) {
      await ctx.db.patch(published._id, {
        value: draft.value,
        version: newVersion,
        publishedAt: now,
        publishedBy: String(userId),
      });
    } else {
      await ctx.db.insert("configPublished", {
        key: draft.key,
        value: draft.value,
        version: newVersion,
        publishedAt: now,
        publishedBy: String(userId),
      });
    }

    // Immutable version snapshot — the only source for exact rollback.
    await ctx.db.insert("configVersions", {
      key: draft.key,
      version: newVersion,
      value: draft.value,
      publishedAt: now,
      publishedBy: String(userId),
    });

    await ctx.db.delete(args.draftId);

    await appendAudit(ctx, {
      key: draft.key,
      action: "publish",
      previousValue: published ? published.value : undefined,
      newValue: draft.value,
      actor: String(userId),
      capability: "admin.system_settings.manage",
      correlationId,
      reason,
    });

    return {
      key: draft.key,
      value: draft.value,
      version: newVersion,
      publishedAt: now,
      publishedBy: String(userId),
    };
  },
});

export const rollbackToVersion = mutation({
  args: {
    key: v.string(),
    targetVersion: v.number(),
    expectedCurrentVersion: v.number(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: adminPublishedRow,
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "admin.system_settings.manage");
    const correlationId = checkCorrelationId(args.correlationId);
    const reason = checkReason(args.reason);
    if (!getConfigEntry(args.key)) throw new Error(`Unknown config key: ${args.key}`);
    if (!Number.isInteger(args.targetVersion) || args.targetVersion < 1) {
      throw new Error("Target version must be a positive integer");
    }
    if (!Number.isInteger(args.expectedCurrentVersion) || args.expectedCurrentVersion < 0) {
      throw new Error("Expected current version must be a non-negative integer");
    }

    const published = await getPublishedRow(ctx, args.key);
    if (!published) throw new Error("No published value found for this config key");
    if (published.version !== args.expectedCurrentVersion) {
      throw new Error(
        `Version conflict: expected v${args.expectedCurrentVersion} but current is v${published.version}. Refresh and review before rolling back.`,
      );
    }
    if (args.targetVersion === published.version) {
      throw new Error("Target version is already the current published version");
    }

    // Exact lookup of the requested published version in the immutable
    // snapshot table. Draft audit events are never versions.
    const snapshot = await ctx.db
      .query("configVersions")
      .withIndex("by_key_and_version", (q) =>
        q.eq("key", args.key).eq("version", args.targetVersion),
      )
      .first();
    if (!snapshot) {
      throw new Error(
        `Unknown published version v${args.targetVersion} for ${args.key}`,
      );
    }

    // The old value must still satisfy the CURRENT contract.
    assertConfigValue(args.key, snapshot.value);

    const now = Date.now();
    const newVersion = published.version + 1;
    await ctx.db.patch(published._id, {
      value: snapshot.value,
      version: newVersion,
      publishedAt: now,
      publishedBy: String(userId),
    });
    await ctx.db.insert("configVersions", {
      key: args.key,
      version: newVersion,
      value: snapshot.value,
      publishedAt: now,
      publishedBy: String(userId),
    });

    await appendAudit(ctx, {
      key: args.key,
      action: "rollback",
      previousValue: published.value,
      newValue: snapshot.value,
      actor: String(userId),
      capability: "admin.system_settings.manage",
      correlationId,
      reason: reason ?? `Rolled back to version ${args.targetVersion}`,
    });

    return {
      key: args.key,
      value: snapshot.value,
      version: newVersion,
      publishedAt: now,
      publishedBy: String(userId),
    };
  },
});

// ─── Import / export ─────────────────────────────────────────────────────

export const exportConfig = query({
  args: {},
  returns: v.object({
    schemaVersion: v.literal(IMPORT_SCHEMA_VERSION),
    exportedAt: v.number(),
    entries: v.array(
      v.object({
        key: v.string(),
        value: v.any(),
        version: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    await requireCapability(ctx, "admin.system_settings.manage");
    // Bounded read: registry size is fixed (32 keys), so take slightly more than max
    const rows = await ctx.db.query("configPublished").take(ALL_CONFIG_KEYS.length + 10);
    // Only registry keys are exported; secrets, operational records and
    // immutable audit/ledger data are not part of this table. Every exported
    // value round-trips through the strict importer.
    return {
      schemaVersion: IMPORT_SCHEMA_VERSION as 1,
      exportedAt: Date.now(),
      entries: rows
        .filter((row) => !!getConfigEntry(row.key))
        .map((row) => ({ key: row.key, value: row.value, version: row.version })),
    };
  },
});

const importEntryFields = {
  key: v.string(),
  action: v.union(
    v.literal("add"),
    v.literal("update"),
    v.literal("unchanged"),
    v.literal("rejected"),
  ),
  reason: v.optional(v.string()),
  currentVersion: v.optional(v.number()),
  newVersion: v.optional(v.number()),
};

const importEntryResult = v.object(importEntryFields);

const importReceiptFields = {
  adds: v.number(),
  updates: v.number(),
  unchanged: v.number(),
  rejected: v.number(),
  entries: v.array(importEntryResult),
};

/**
 * Read-only dry run: identifies exactly what an import would change and the
 * version preconditions the apply call must carry. Never mutates.
 */
export const previewImportConfig = query({
  args: { payload: v.any(), correlationId: v.string() },
  returns: v.object({
    ...importReceiptFields,
    payloadDigest: v.string(),
  }),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "admin.system_settings.manage");
    checkCorrelationId(args.correlationId);
    const envelope = validateImportEnvelope(args.payload);
    if (!envelope.valid || !envelope.entries) {
      throw new Error(envelope.error ?? "Invalid import payload");
    }

    const results: Array<{
      key: string;
      action: "add" | "update" | "unchanged" | "rejected";
      reason?: string;
      currentVersion?: number;
      newVersion?: number;
    }> = [];
    let adds = 0;
    let updates = 0;
    let unchanged = 0;
    let rejected = 0;

    for (const entry of envelope.entries) {
      const published = await getPublishedRow(ctx, entry.key);
      if (published) {
        if (canonicalJson(published.value) === canonicalJson(entry.value)) {
          results.push({ key: entry.key, action: "unchanged", currentVersion: published.version });
          unchanged++;
        } else {
          results.push({
            key: entry.key,
            action: "update",
            currentVersion: published.version,
            newVersion: published.version + 1,
          });
          updates++;
        }
      } else {
        results.push({ key: entry.key, action: "add", currentVersion: 0, newVersion: 1 });
        adds++;
      }
    }

    return {
      adds,
      updates,
      unchanged,
      rejected,
      entries: results,
      payloadDigest: importPayloadDigest(envelope.entries),
    };
  },
});

/**
 * Atomic import apply. Re-validates the strict envelope, checks idempotency
 * and per-key version preconditions, then applies every change in this ONE
 * transaction (partial imports are impossible). An exact retry with the same
 * correlation id returns the previous receipt; the same correlation id with
 * a changed payload conflicts. The caller MUST provide the exact payloadDigest
 * returned by previewImportConfig to prove the reviewed payload matches.
 */
export const applyImportConfig = mutation({
  args: {
    payload: v.any(),
    expectedVersions: v.array(
      v.object({
        key: v.string(),
        version: v.number(),
      }),
    ),
    expectedPayloadDigest: v.string(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    duplicate: v.boolean(),
    ...importReceiptFields,
    appliedVersions: v.array(
      v.object({
        key: v.string(),
        version: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "admin.system_settings.manage");
    const correlationId = checkCorrelationId(args.correlationId);
    const reason = checkReason(args.reason);

    const envelope = validateImportEnvelope(args.payload);
    if (!envelope.valid || !envelope.entries) {
      throw new Error(envelope.error ?? "Invalid import payload");
    }
    const entries: NormalizedImportEntry[] = envelope.entries;
    const payloadDigest = importPayloadDigest(entries);

    // Enforce exact canonical equality with the reviewed payload digest.
    if (payloadDigest !== args.expectedPayloadDigest) {
      throw new Error(
        "Import conflict: payload does not match the reviewed preview. Re-run previewImportConfig and review the changes before applying.",
      );
    }

    // Idempotency receipt check.
    const priorReceipt = await ctx.db
      .query("configImportReceipts")
      .withIndex("by_correlationId", (q) => q.eq("correlationId", correlationId))
      .first();
    if (priorReceipt) {
      if (priorReceipt.payloadDigest !== payloadDigest) {
        throw new Error(
          "Import conflict: this correlation id was already used with a different payload",
        );
      }
      const stored = priorReceipt.result as unknown;
      if (
        !stored ||
        typeof stored !== "object" ||
        !Array.isArray((stored as Record<string, unknown>).entries) ||
        !Array.isArray((stored as Record<string, unknown>).appliedVersions)
      ) {
        throw new Error("Stored import receipt is invalid; use a new correlation id");
      }
      const typed = stored as {
        adds: number;
        updates: number;
        unchanged: number;
        rejected: number;
        entries: Array<{
          key: string;
          action: "add" | "update" | "unchanged" | "rejected";
          reason?: string;
          currentVersion?: number;
          newVersion?: number;
        }>;
        appliedVersions: Array<{ key: string; version: number }>;
      };
      return {
        duplicate: true,
        adds: typed.adds,
        updates: typed.updates,
        unchanged: typed.unchanged,
        rejected: typed.rejected,
        entries: typed.entries,
        appliedVersions: typed.appliedVersions,
      };
    }

    // Compute the exact change set with version preconditions.
    const expectedByKey = new Map<string, number>();
    for (const expected of args.expectedVersions) {
      if (!getConfigEntry(expected.key)) {
        throw new Error(`Unknown config key in version preconditions: ${expected.key}`);
      }
      if (!Number.isInteger(expected.version) || expected.version < 0) {
        throw new Error("Expected versions must be non-negative integers");
      }
      if (expectedByKey.has(expected.key)) {
        throw new Error(`Duplicate version precondition for ${expected.key}`);
      }
      expectedByKey.set(expected.key, expected.version);
    }

    type Planned = { entry: NormalizedImportEntry; currentVersion: number; newVersion: number };
    const planned: Planned[] = [];
    const results: Array<{
      key: string;
      action: "add" | "update" | "unchanged" | "rejected";
      reason?: string;
      currentVersion?: number;
      newVersion?: number;
    }> = [];
    let adds = 0;
    let updates = 0;
    let unchanged = 0;
    const rejected = 0; // invalid entries are rejected by the envelope validator

    for (const entry of entries) {
      const published = await getPublishedRow(ctx, entry.key);
      const currentVersion = published ? published.version : 0;
      if (published && canonicalJson(published.value) === canonicalJson(entry.value)) {
        results.push({ key: entry.key, action: "unchanged", currentVersion });
        unchanged++;
        continue;
      }
      const expectedVersion = expectedByKey.get(entry.key);
      if (expectedVersion === undefined) {
        throw new Error(
          `Missing version precondition for ${entry.key}. Run the preview and review the changes first.`,
        );
      }
      if (expectedVersion !== currentVersion) {
        throw new Error(
          `Version conflict for ${entry.key}: expected v${expectedVersion} but current is v${currentVersion}. Refresh the preview before applying.`,
        );
      }
      expectedByKey.delete(entry.key);
      planned.push({ entry, currentVersion, newVersion: currentVersion + 1 });
      results.push({
        key: entry.key,
        action: published ? "update" : "add",
        currentVersion,
        newVersion: currentVersion + 1,
      });
      if (published) updates++;
      else adds++;
    }
    for (const key of expectedByKey.keys()) {
      throw new Error(
        `Version precondition for ${key} does not match the reviewed payload (it is unchanged or absent)`,
      );
    }

    const now = Date.now();
    const appliedVersions: Array<{ key: string; version: number }> = [];

    // Apply the whole reviewed change set inside this single transaction.
    for (const change of planned) {
      const published = await getPublishedRow(ctx, change.entry.key);
      if (published) {
        await ctx.db.patch(published._id, {
          value: change.entry.value,
          version: change.newVersion,
          publishedAt: now,
          publishedBy: String(userId),
        });
      } else {
        await ctx.db.insert("configPublished", {
          key: change.entry.key,
          value: change.entry.value,
          version: change.newVersion,
          publishedAt: now,
          publishedBy: String(userId),
        });
      }
      await ctx.db.insert("configVersions", {
        key: change.entry.key,
        version: change.newVersion,
        value: change.entry.value,
        publishedAt: now,
        publishedBy: String(userId),
      });
      await appendAudit(ctx, {
        key: change.entry.key,
        action: "import",
        previousValue: published ? published.value : undefined,
        newValue: change.entry.value,
        actor: String(userId),
        capability: "admin.system_settings.manage",
        correlationId: `${correlationId}:${change.entry.key}`,
        reason: reason ?? "Config import",
      });
      appliedVersions.push({ key: change.entry.key, version: change.newVersion });
    }

    // Bounded idempotency receipt (pruned to the most recent MAX_RECEIPTS).
    // Table is new; every write enforces this bound. No operational data deletion.
    const receiptResult = { adds, updates, unchanged, rejected, entries: results };
    await ctx.db.insert("configImportReceipts", {
      correlationId,
      payloadDigest,
      result: { ...receiptResult, appliedVersions },
      appliedAt: now,
      actor: String(userId),
    });
    const receipts = await ctx.db
      .query("configImportReceipts")
      .withIndex("by_appliedAt")
      .order("desc")
      .take(MAX_RECEIPTS + 1);
    const keepIds = new Set(receipts.map((row) => row._id));
    if (receipts.length > MAX_RECEIPTS) {
      for (const row of receipts.slice(MAX_RECEIPTS)) {
        await ctx.db.delete(row._id);
      }
    }

    return {
      duplicate: false,
      ...receiptResult,
      appliedVersions,
    };
  },
});
