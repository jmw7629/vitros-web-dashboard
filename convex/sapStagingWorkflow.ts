import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase config missing");
  return { url, serviceKey };
}

async function callTransition(
  url: string,
  serviceKey: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${url}/rest/v1/rpc/apply_sap_staging_status_transition`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message : "SAP staging transition failed";
    throw new Error(message.slice(0, 240));
  }

  return await res.json() as Record<string, unknown>;
}

export const transition = action({
  args: {
    ids: v.array(v.string()),
    targetStatus: v.union(v.literal("ready"), v.literal("exported")),
    correlationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "inventory.write");
    const ids = args.ids.map((id) => id.trim());

    if (ids.length === 0 || ids.length > 250) {
      throw new Error("Select between 1 and 250 SAP staging rows");
    }
    if (new Set(ids).size !== ids.length) {
      throw new Error("Duplicate SAP staging rows are not allowed");
    }
    if (ids.some((id) => !UUID_RE.test(id))) {
      throw new Error("Invalid SAP staging row id");
    }

    const correlationId = args.correlationId.trim();
    if (!correlationId || correlationId.length > 128) {
      throw new Error("Invalid correlation id");
    }

    const { url, serviceKey } = getSupabaseConfig();
    return callTransition(url, serviceKey, {
      p_ids: ids,
      p_target_status: args.targetStatus,
      p_actor: String(actorId),
      p_correlation_id: correlationId,
    });
  },
});
