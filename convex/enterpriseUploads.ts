import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireCapability } from "./authGuard";
import { mapping as mappingValidator } from "./enterpriseUploadSchema";

const idArgs = { uploadId: v.id("enterpriseUploads") };
function correlation(value: string) {
  if (!/^[A-Za-z0-9:._-]{12,180}$/.test(value))
    throw Error("A stable upload request ID is required.");
}
function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
export const begin = mutation({
  args: { name: v.string(), mime: v.string(), correlationId: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => {
    const actor = await requireCapability(ctx, "admin.system_settings.manage");
    correlation(args.correlationId);
    if (!args.name.trim() || args.name.length > 500 || args.mime.length > 200)
      throw Error("Check the filename and file type.");
    const old = await ctx.db
      .query("enterpriseUploads")
      .withIndex("by_actor_and_correlationId", q =>
        q.eq("actor", actor).eq("correlationId", args.correlationId),
      )
      .unique();
    if (old && (old.name !== args.name || old.mime !== args.mime))
      throw Error("This upload request already belongs to a different file.");
    const uploadId =
      old?._id ??
      (await ctx.db.insert("enterpriseUploads", {
        ...args,
        actor,
        status: "stored",
        message: "Waiting for original file transfer.",
        revision: 0,
        generation: 0,
        updatedAt: Date.now(),
      }));
    return {
      uploadId,
      uploadUrl: old?.storageId ? null : await ctx.storage.generateUploadUrl(),
      attached: Boolean(old?.storageId),
    };
  },
});
export const attach = mutation({
  args: { ...idArgs, storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "admin.system_settings.manage");
    const row = await ctx.db.get(args.uploadId);
    if (!row) throw Error("Upload not found.");
    if (row.storageId) {
      if (row.storageId !== args.storageId)
        throw Error("An original file is already retained for this upload.");
      return null;
    }
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata)
      throw Error(
        "The file transfer is not complete. Retry from the retained local file.",
      );
    await ctx.db.patch(row._id, {
      storageId: args.storageId,
      size: metadata.size,
      sha256: metadata.sha256,
      status: "stored",
      message: "Original file retained. Ready for analysis.",
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const queue = mutation({
  args: idArgs,
  returns: v.any(),
  handler: async (ctx, args) => {
    const actor = await requireCapability(ctx, "admin.system_settings.manage");
    const row = await ctx.db.get(args.uploadId);
    if (!row?.storageId)
      throw Error("Transfer the original file before starting analysis.");
    if (
      ["queued", "parsing"].includes(row.status) &&
      Date.now() - row.updatedAt < 10 * 60_000
    )
      return { generation: row.generation };
    const generation = row.generation + 1;
    await ctx.db.patch(row._id, {
      generation,
      revision: row.revision + 1,
      status: "queued",
      message: "Analysis queued. Original file is retained.",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.enterpriseUploadActions.process, {
      uploadId: row._id,
      generation,
      actor,
    });
    return { generation };
  },
});
export const attachText = mutation({
  args: { ...idArgs, textStorageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "admin.system_settings.manage");
    const row = await ctx.db.get(args.uploadId);
    if (!row?.storageId) throw Error("Original upload not found.");
    if (
      ["queued", "parsing"].includes(row.status) &&
      Date.now() - row.updatedAt < 10 * 60_000
    )
      throw Error("Wait for the current analysis before adding recovery text.");
    const file = await ctx.db.system.get(args.textStorageId);
    if (!file) throw Error("Recovery text was not uploaded.");
    if (file.size > 2 * 1024 * 1024)
      throw Error(
        "Recovery text exceeds 2 MB. The original file remains retained.",
      );
    await ctx.db.patch(row._id, {
      textStorageId: args.textStorageId,
      revision: row.revision + 1,
      status: "stored",
      message:
        "Recovery text retained alongside the original file. Analyze again to review it.",
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const textUploadURL = mutation({
  args: {},
  returns: v.string(),
  handler: async ctx => {
    await requireCapability(ctx, "admin.system_settings.manage");
    return ctx.storage.generateUploadUrl();
  },
});
export const list = query({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "admin.system_settings.manage");
    const page = await ctx.db
      .query("enterpriseUploads")
      .withIndex("by_updatedAt")
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: 50 });
    return {
      items: page.page,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
export const get = query({
  args: idArgs,
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "admin.system_settings.manage");
    const row = await ctx.db.get(args.uploadId);
    if (!row) throw Error("Upload not found.");
    return {
      ...row,
      originalURL: row.storageId
        ? await ctx.storage.getUrl(row.storageId)
        : null,
    };
  },
});
export const datasets = query({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "inventory.read");
    await requireCapability(ctx, "rem.read");
    const page = await ctx.db
      .query("enterpriseDatasets")
      .withIndex("by_updatedAt")
      .order("desc")
      .paginate({ cursor: args.cursor ?? null, numItems: 50 });
    return {
      items: page.page,
      nextCursor: page.isDone ? null : page.continueCursor,
    };
  },
});
export const loadInternal = internalQuery({
  args: idArgs,
  returns: v.any(),
  handler: async (ctx, args) => ctx.db.get(args.uploadId),
});
export const datasetInternal = internalQuery({
  args: { datasetId: v.id("enterpriseDatasets") },
  returns: v.any(),
  handler: async (ctx, args) => ctx.db.get(args.datasetId),
});
export const existingDatasetInternal = internalQuery({
  args: { ...idArgs, tableKey: v.string() },
  returns: v.any(),
  handler: async (ctx, args) =>
    ctx.db
      .query("enterpriseDatasets")
      .withIndex("by_uploadId_and_tableKey", q =>
        q.eq("uploadId", args.uploadId).eq("tableKey", args.tableKey),
      )
      .unique(),
});
export const markParsing = internalMutation({
  args: { ...idArgs, generation: v.number() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.uploadId);
    if (!row || row.generation !== args.generation || row.status !== "queued")
      return false;
    await ctx.db.patch(row._id, {
      status: "parsing",
      message: "Reading source tables and preparing suggested mappings.",
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const finish = internalMutation({
  args: {
    ...idArgs,
    generation: v.number(),
    parsedStorageId: v.optional(v.id("_storage")),
    status: v.string(),
    message: v.string(),
    aiStatus: v.string(),
    summaries: v.any(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.uploadId);
    if (!row || row.generation !== args.generation) return false;
    await ctx.db.patch(row._id, {
      ...(args.parsedStorageId
        ? { parsedStorageId: args.parsedStorageId }
        : {}),
      status: args.status,
      message: args.message,
      aiStatus: args.aiStatus,
      summaries: args.summaries,
      revision: row.revision + 1,
      updatedAt: Date.now(),
    });
    return true;
  },
});
export const publishInternal = internalMutation({
  args: {
    ...idArgs,
    actor: v.id("users"),
    parsedStorageId: v.id("_storage"),
    tableKey: v.string(),
    expectedRevision: v.number(),
    expectedDatasetRevision: v.number(),
    mapping: mappingValidator,
    rowCount: v.number(),
    correlationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    correlation(args.correlationId);
    const request = canonical({
      uploadId: args.uploadId,
      parsedStorageId: args.parsedStorageId,
      tableKey: args.tableKey,
      expectedRevision: args.expectedRevision,
      expectedDatasetRevision: args.expectedDatasetRevision,
      mapping: args.mapping,
      rowCount: args.rowCount,
    });
    const prior = await ctx.db
      .query("enterpriseUploadAudit")
      .withIndex("by_actor_and_correlationId", q =>
        q.eq("actor", args.actor).eq("correlationId", args.correlationId),
      )
      .unique();
    if (prior) {
      if (prior.request !== request)
        throw Error(
          "The publication request changed. Review again before publishing.",
        );
      return { datasetId: prior.datasetId, duplicate: true };
    }
    const upload = await ctx.db.get(args.uploadId);
    if (
      !upload ||
      upload.revision !== args.expectedRevision ||
      upload.parsedStorageId !== args.parsedStorageId ||
      !["review", "published"].includes(upload.status)
    )
      throw Error(
        "The upload changed. Reload and review the current analysis.",
      );
    const previous = await ctx.db
      .query("enterpriseDatasets")
      .withIndex("by_uploadId_and_tableKey", q =>
        q.eq("uploadId", upload._id).eq("tableKey", args.tableKey),
      )
      .unique();
    if ((previous?.revision ?? 0) !== args.expectedDatasetRevision)
      throw Error(
        "The dashboard mapping changed. Reload and review its current version.",
      );
    const value = {
      uploadId: upload._id,
      tableKey: args.tableKey,
      parsedStorageId: args.parsedStorageId,
      mapping: args.mapping,
      rowCount: args.rowCount,
      sourceHash: upload.sha256 ?? "",
      actor: args.actor,
      revision: (previous?.revision ?? 0) + 1,
      updatedAt: Date.now(),
    };
    let datasetId = previous?._id;
    if (datasetId) await ctx.db.patch(datasetId, value);
    else datasetId = await ctx.db.insert("enterpriseDatasets", value);
    await ctx.db.insert("enterpriseUploadAudit", {
      actor: args.actor,
      uploadId: upload._id,
      operation: "publish_snapshot",
      createdAt: Date.now(),
      correlationId: args.correlationId,
      request,
      before: previous ?? null,
      after: value,
      datasetId,
    });
    await ctx.db.patch(upload._id, {
      status: "published",
      updatedAt: Date.now(),
    });
    return { datasetId, duplicate: false };
  },
});
