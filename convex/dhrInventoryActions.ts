// Server-authoritative DHR scanner transition boundary.
// Browser callers never receive Supabase privileged credentials and cannot call
// the service-role-only database RPC directly.
import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase config missing");
  return { url, serviceKey };
}

async function callAtomicDhrRpc(
  serviceKey: string,
  url: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${url}/rest/v1/rpc/apply_dhr_scan_transition`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const message = (payload as { message?: string; error?: string }).message
      || (payload as { message?: string; error?: string }).error
      || `DHR transition failed (${response.status})`;
    throw new Error(message);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

export const applyScanTransition = action({
  args: {
    sessionId: v.string(),
    sectionId: v.string(),
    partNumber: v.string(),
    expectedQty: v.number(),
    newQty: v.number(),
    category: v.string(),
    description: v.string(),
    correlationId: v.string(),
    expectedRevision: v.number(),
    analyzerSerial: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "inventory.write");

    if (!args.sessionId.trim()) throw new Error("sessionId is required");
    if (!args.sectionId.trim()) throw new Error("sectionId is required");
    if (!args.partNumber.trim()) throw new Error("partNumber is required");
    if (!args.category.trim()) throw new Error("category is required");
    if (!args.correlationId.trim()) throw new Error("correlationId is required");
    if (!Number.isInteger(args.expectedQty) || args.expectedQty < 0) {
      throw new Error("expectedQty must be a non-negative integer");
    }
    if (!Number.isInteger(args.newQty) || args.newQty < 0) {
      throw new Error("newQty must be a non-negative integer");
    }
    if (!Number.isInteger(args.expectedRevision) || args.expectedRevision < 0) {
      throw new Error("expectedRevision must be a non-negative integer");
    }

    const { url, serviceKey } = getSupabaseConfig();
    return callAtomicDhrRpc(serviceKey, url, {
      p_session_id: args.sessionId,
      p_section_id: args.sectionId,
      p_part_number: args.partNumber.trim(),
      p_expected_qty: args.expectedQty,
      p_new_qty: args.newQty,
      p_category: args.category.trim(),
      p_description: args.description,
      p_actor: String(actorId),
      p_correlation_id: args.correlationId.trim(),
      p_expected_revision: args.expectedRevision,
      p_analyzer_serial: args.analyzerSerial?.trim() || null,
    });
  },
});
