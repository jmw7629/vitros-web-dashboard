import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const lineValidator = v.object({
  id: v.string(),
  partNumber: v.string(),
  description: v.string(),
  qty: v.number(),
  category: v.string(),
  consumed: v.boolean(),
  section: v.string(),
  sectionLabel: v.string(),
  confidence: v.number(),
  matchStatus: v.string(),
  isEditing: v.boolean(),
  scanId: v.optional(v.string()),
  addedAt: v.optional(v.number()),
});

// ============ QUERIES ============

export const listFolders = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("dhrFolders").collect();
  },
});

export const getFolder = query({
  args: { id: v.id("dhrFolders") },
  handler: async (ctx, { id }) => {
    return await ctx.db.get(id);
  },
});

// ============ MUTATIONS ============

export const createFolder = mutation({
  args: {
    instrumentSN: v.string(),
    woNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("dhrFolders", {
      instrumentSN: args.instrumentSN,
      woNumber: args.woNumber,
      createdAt: now,
      updatedAt: now,
      scanIds: [],
      lines: [],
      sentToWip: false,
    });
  },
});

export const addLinesToFolder = mutation({
  args: {
    id: v.id("dhrFolders"),
    lines: v.array(lineValidator),
    scanId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.id);
    if (!folder) throw new Error("Folder not found");
    const newScanIds = args.scanId
      ? [...folder.scanIds, args.scanId]
      : folder.scanIds;
    await ctx.db.patch(args.id, {
      lines: [...folder.lines, ...args.lines],
      scanIds: newScanIds,
      updatedAt: Date.now(),
    });
  },
});

export const updateLine = mutation({
  args: {
    folderId: v.id("dhrFolders"),
    lineId: v.string(),
    updates: v.object({
      partNumber: v.optional(v.string()),
      description: v.optional(v.string()),
      qty: v.optional(v.number()),
      category: v.optional(v.string()),
      section: v.optional(v.string()),
      sectionLabel: v.optional(v.string()),
      isEditing: v.optional(v.boolean()),
    }),
  },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder) throw new Error("Folder not found");
    const lines = folder.lines.map((l) =>
      l.id === args.lineId ? { ...l, ...args.updates } : l
    );
    await ctx.db.patch(args.folderId, { lines, updatedAt: Date.now() });
  },
});

export const removeLine = mutation({
  args: {
    folderId: v.id("dhrFolders"),
    lineId: v.string(),
  },
  handler: async (ctx, args) => {
    const folder = await ctx.db.get(args.folderId);
    if (!folder) throw new Error("Folder not found");
    const lines = folder.lines.filter((l) => l.id !== args.lineId);
    await ctx.db.patch(args.folderId, { lines, updatedAt: Date.now() });
  },
});

export const updateFolder = mutation({
  args: {
    id: v.id("dhrFolders"),
    instrumentSN: v.optional(v.string()),
    woNumber: v.optional(v.string()),
    sentToWip: v.optional(v.boolean()),
    wipScheduleId: v.optional(v.string()),
    wipScheduleName: v.optional(v.string()),
    wipSentAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const filtered = Object.fromEntries(
      Object.entries(updates).filter(([, val]) => val !== undefined)
    );
    await ctx.db.patch(id, { ...filtered, updatedAt: Date.now() });
  },
});

export const deleteFolder = mutation({
  args: { id: v.id("dhrFolders") },
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
  },
});
