import { v } from "convex/values";
import { action } from "./_generated/server";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

const ALLOWED_STAGES = new Set([
  "Procurement",
  "Cleaning",
  "Service",
  "Final Line",
  "Packaging",
  "Release Testing",
  "QA Release",
  "SAP Release",
  "Complete",
]);

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("REM operational service is not configured");
  return { url: url.replace(/\/$/, ""), serviceKey };
}

function assertUuid(value: string, label: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
}

function cleanNotes(value: string | undefined) {
  const notes = (value ?? "").trim();
  if (notes.length > 4000) throw new Error("REM operator notes exceed 4000 characters");
  return notes;
}

export const getAnalyzerOperational = action({
  args: { analyzerId: v.string() },
  returns: v.object({
    analyzerId: v.string(),
    currentStage: v.string(),
    notes: v.string(),
    isComplete: v.boolean(),
  }),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "rem.read");
    assertUuid(args.analyzerId, "REM analyzer id");
    const { url, serviceKey } = getSupabaseConfig();
    const response = await fetch(`${url}/rest/v1/rem_analyzers?id=eq.${encodeURIComponent(args.analyzerId)}&select=*`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) throw new Error(`REM analyzer operational read failed (${response.status})`);
    const payload = await response.json();
    if (!Array.isArray(payload) || payload.length !== 1) throw new Error("REM analyzer not found");
    const row = payload[0] as Record<string, unknown>;
    return {
      analyzerId: String(row.id ?? ""),
      currentStage: String(row.current_stage ?? ""),
      notes: String(row.operator_notes ?? ""),
      isComplete: row.is_complete === true,
    };
  },
});

export const updateAnalyzerOperational = action({
  args: {
    analyzerId: v.string(),
    expectedStage: v.string(),
    expectedNotes: v.optional(v.string()),
    stage: v.string(),
    notes: v.optional(v.string()),
    correlationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const userId = await requireCapability(ctx, "rem.write");
    assertUuid(args.analyzerId, "REM analyzer id");

    const expectedStage = args.expectedStage.trim();
    const stage = args.stage.trim();
    if (!ALLOWED_STAGES.has(expectedStage) || !ALLOWED_STAGES.has(stage)) {
      throw new Error("Invalid REM analyzer stage");
    }

    const expectedNotes = cleanNotes(args.expectedNotes);
    const notes = cleanNotes(args.notes);
    const correlationId = args.correlationId.trim();
    if (correlationId.length < 12 || correlationId.length > 180 || !/^[A-Za-z0-9:._-]+$/.test(correlationId)) {
      throw new Error("Invalid REM update correlation id");
    }

    const { url, serviceKey } = getSupabaseConfig();
    const response = await fetch(`${url}/rest/v1/rpc/apply_rem_analyzer_operational_update`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_analyzer_id: args.analyzerId,
        p_expected_stage: expectedStage,
        p_expected_notes: expectedNotes,
        p_stage: stage,
        p_notes: notes,
        p_actor: String(userId),
        p_correlation_id: correlationId,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message = (body as { message?: string; error?: string }).message
        || (body as { message?: string; error?: string }).error
        || `REM analyzer update failed (${response.status})`;
      throw new Error(message);
    }

    const payload = await response.json();
    if (!payload || typeof payload !== "object") throw new Error("REM analyzer update returned an invalid receipt");
    return payload;
  },
});
