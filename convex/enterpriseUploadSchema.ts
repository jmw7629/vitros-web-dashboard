import { defineTable } from "convex/server";
import { v } from "convex/values";

export const destination = v.union(
  v.literal("inventory"),
  v.literal("production"),
);
export const field = v.object({
  column: v.number(),
  label: v.string(),
  role: v.string(),
  kind: v.union(v.literal("text"), v.literal("number"), v.literal("date")),
  visible: v.boolean(),
  metric: v.boolean(),
});
export const mapping = v.object({
  name: v.string(),
  destination,
  headerRow: v.number(),
  excludedRows: v.array(v.number()),
  fields: v.array(field),
  dateFormat: v.optional(
    v.union(v.literal("iso"), v.literal("mdy"), v.literal("dmy")),
  ),
  numberFormat: v.optional(
    v.union(v.literal("plain"), v.literal("us"), v.literal("eu")),
  ),
});
export const enterpriseTables = {
  enterpriseUploads: defineTable({
    actor: v.id("users"),
    correlationId: v.string(),
    name: v.string(),
    mime: v.string(),
    storageId: v.optional(v.id("_storage")),
    textStorageId: v.optional(v.id("_storage")),
    parsedStorageId: v.optional(v.id("_storage")),
    size: v.optional(v.number()),
    sha256: v.optional(v.string()),
    status: v.string(),
    message: v.string(),
    revision: v.number(),
    generation: v.number(),
    updatedAt: v.number(),
    aiStatus: v.optional(v.string()),
    summaries: v.optional(v.any()),
  })
    .index("by_actor_and_correlationId", ["actor", "correlationId"])
    .index("by_updatedAt", ["updatedAt"]),
  enterpriseDatasets: defineTable({
    uploadId: v.id("enterpriseUploads"),
    tableKey: v.string(),
    parsedStorageId: v.id("_storage"),
    mapping,
    revision: v.number(),
    rowCount: v.number(),
    sourceHash: v.string(),
    actor: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_uploadId_and_tableKey", ["uploadId", "tableKey"])
    .index("by_updatedAt", ["updatedAt"]),
  enterpriseUploadAudit: defineTable({
    actor: v.id("users"),
    uploadId: v.id("enterpriseUploads"),
    operation: v.string(),
    createdAt: v.number(),
    correlationId: v.string(),
    request: v.string(),
    before: v.any(),
    after: v.any(),
    datasetId: v.optional(v.id("enterpriseDatasets")),
  })
    .index("by_actor_and_correlationId", ["actor", "correlationId"])
    .index("by_uploadId", ["uploadId"]),
};
