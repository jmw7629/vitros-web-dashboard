import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  // ============ INVENTORY MODULE ============
  // NOTE: Production data is now in Supabase. This schema is kept for
  // backward compatibility with the dev Convex instance only.

  parts: defineTable({
    partNumber: v.string(),
    description: v.string(),
    type: v.string(),
    qoh: v.number(),
    // Support both old (min/max) and new (minQty/maxQty) field names
    minQty: v.optional(v.number()),
    maxQty: v.optional(v.number()),
    min: v.optional(v.number()),
    max: v.optional(v.number()),
    onPlan: v.optional(v.boolean()),
    binLocation: v.optional(v.string()),
    module: v.optional(v.string()),
    lastActivity: v.optional(v.number()),
    status: v.optional(v.string()),
    abcClass: v.optional(v.string()),
    usageScore: v.optional(v.number()),
    daysInStock: v.optional(v.number()),
    unitCost: v.optional(v.number()),
  }).index("by_partNumber", ["partNumber"])
    .index("by_type", ["type"]),

  transactions: defineTable({
    partNumber: v.string(),
    mode: v.string(),
    qty: v.optional(v.number()),
    quantity: v.optional(v.number()),
    qtyBefore: v.optional(v.number()),
    qtyAfter: v.optional(v.number()),
    description: v.optional(v.string()),
    user: v.optional(v.string()),
    archived: v.optional(v.boolean()),
    timestamp: v.union(v.number(), v.string()),
    sapStatus: v.optional(v.string()),
  }).index("by_partNumber", ["partNumber"])
    .index("by_timestamp", ["timestamp"])
    .index("by_sapStatus", ["sapStatus"]),

  kits: defineTable({
    kitId: v.string(),
    name: v.string(),
    basePartNumber: v.optional(v.string()),
    type: v.optional(v.string()),
    revision: v.optional(v.string()),
    totalComponents: v.optional(v.number()),
    components: v.array(v.any()),
  }).index("by_kitId", ["kitId"]),

  employees: defineTable({
    name: v.string(),
    initials: v.string(),
    active: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    role: v.optional(v.string()),
  }).index("by_initials", ["initials"]),

  cycleSchedules: defineTable({
    name: v.string(),
    frequency: v.string(),
    assignedTo: v.string(),
    nextDue: v.number(),
    status: v.string(),
    parts: v.array(v.string()),
    countType: v.optional(v.string()),
    createdAt: v.optional(v.number()),
  }).index("by_status", ["status"])
    .index("by_nextDue", ["nextDue"]),

  cycleResults: defineTable({
    scheduleId: v.string(),
    timestamp: v.number(),
    countedBy: v.string(),
    results: v.array(v.object({
      partNumber: v.string(),
      systemQty: v.number(),
      countedQty: v.number(),
      variance: v.number(),
      wipEntries: v.optional(v.array(v.object({ sn: v.string(), qty: v.number() }))),
      incomingQty: v.optional(v.number()),
    })),
    status: v.string(),
    sortMode: v.optional(v.string()),
    wipSerials: v.optional(v.array(v.string())),
  }).index("by_scheduleId", ["scheduleId"])
    .index("by_timestamp", ["timestamp"]),

  dhrFolders: defineTable({
    instrumentSN: v.string(),
    woNumber: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    scanIds: v.array(v.string()),
    lines: v.array(v.object({
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
    })),
    sentToWip: v.boolean(),
    wipScheduleId: v.optional(v.string()),
    wipScheduleName: v.optional(v.string()),
    wipSentAt: v.optional(v.number()),
  }).index("by_instrumentSN", ["instrumentSN"]),

  incomingBatches: defineTable({
    batchId: v.string(),
    status: v.string(),
    items: v.array(v.any()),
    createdAt: v.union(v.string(), v.number()),
    committedAt: v.optional(v.union(v.string(), v.number())),
  }).index("by_status", ["status"]),

  // ============ REM TRACKER MODULE ============

  remAnalyzers: defineTable({
    serialNumber: v.string(),
    analyzerType: v.optional(v.string()),
    type: v.optional(v.string()),
    stage: v.optional(v.string()),
    progress: v.optional(v.number()),
    status: v.optional(v.string()),
    yearNumber: v.optional(v.string()),
    productionOrder: v.optional(v.string()),
    currentStage: v.optional(v.string()),
    overallPct: v.optional(v.number()),
    procurementPct: v.optional(v.number()),
    cleaningPct: v.optional(v.number()),
    servicePct: v.optional(v.number()),
    serviceCell: v.optional(v.string()),
    finalLinePct: v.optional(v.number()),
    releaseTestingPct: v.optional(v.number()),
    packagingPct: v.optional(v.number()),
    sapReleasePct: v.optional(v.number()),
    qaReleasePct: v.optional(v.number()),
    currentPct: v.optional(v.number()),
    slaDays: v.optional(v.number()),
    daysInStage: v.optional(v.number()),
    daysElapsed: v.optional(v.number()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    doneWeek: v.optional(v.string()),
    isComplete: v.optional(v.boolean()),
    installDate: v.optional(v.string()),
    installCountry: v.optional(v.string()),
    installStatus: v.optional(v.string()),
    installCost: v.optional(v.number()),
    fpyPercentage: v.optional(v.number()),
    releaseFPY: v.optional(v.number()),
    fieldStatus: v.optional(v.string()),
    country: v.optional(v.string()),
    fpy: v.optional(v.number()),
  }).index("by_serialNumber", ["serialNumber"]),

  lvccItems: defineTable({
    serialNumber: v.optional(v.string()),
    itemId: v.optional(v.string()),
    itemType: v.optional(v.string()),
    category: v.optional(v.string()),
    batchNumber: v.optional(v.string()),
    quantity: v.optional(v.number()),
    currentStage: v.optional(v.string()),
    buildPct: v.optional(v.number()),
    testPct: v.optional(v.number()),
    packagingPct: v.optional(v.number()),
    sapReleasePct: v.optional(v.number()),
    qaReleasePct: v.optional(v.number()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    isComplete: v.optional(v.boolean()),
    status: v.optional(v.string()),
    progress: v.optional(v.number()),
  }),

  annualTargets: defineTable({
    type: v.string(),
    target: v.number(),
    completed: v.number(),
  }).index("by_type", ["type"]),

  staffMembers: defineTable({
    name: v.string(),
    role: v.string(),
    fte: v.optional(v.number()),
    certifications: v.optional(v.any()),
    skills: v.optional(v.any()),
    isLead: v.optional(v.boolean()),
    inTraining: v.optional(v.boolean()),
  }),

  weeklyNotes: defineTable({
    weekNumber: v.optional(v.number()),
    weekStart: v.optional(v.string()),
    quarter: v.optional(v.string()),
    notes: v.optional(v.array(v.object({
      product: v.string(),
      content: v.string(),
    }))),
  }),

  appSettings: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),
});
