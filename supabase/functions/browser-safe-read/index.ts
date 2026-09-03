const SAFE_DATASETS = new Set(["stock", "audit", "sap", "settings"]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type SupabaseServerKey = {
  value: string;
  kind: "secret" | "legacy_service_role";
};

function getSupabaseServerKey(): SupabaseServerKey | null {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern) as Record<string, string>;
      if (typeof parsed.default === "string" && parsed.default.startsWith("sb_secret_")) {
        return { value: parsed.default, kind: "secret" };
      }
    } catch {
      // Fall through to the legacy server-only key during the 2026 key migration window.
    }
  }

  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return legacy ? { value: legacy, kind: "legacy_service_role" } : null;
}

async function postgrest(path: string): Promise<unknown[]> {
  const baseUrl = Deno.env.get("SUPABASE_URL");
  const serverKey = getSupabaseServerKey();
  if (!baseUrl || !serverKey) throw new Error("server_configuration_missing");

  const headers: Record<string, string> = {
    apikey: serverKey.value,
    Accept: "application/json",
  };

  // Modern sb_secret keys are API keys, not JWTs, and must not be sent as Bearer tokens.
  // The legacy service-role key is JWT-based and retains its Authorization header only
  // for migration compatibility until it is retired.
  if (serverKey.kind === "legacy_service_role") {
    headers.Authorization = `Bearer ${serverKey.value}`;
  }

  const response = await fetch(`${baseUrl}/rest/v1/${path}`, {
    method: "GET",
    headers,
    cache: "no-store",
  });

  if (!response.ok) throw new Error("upstream_read_failed");
  const body = await response.json();
  if (!Array.isArray(body)) throw new Error("upstream_shape_invalid");
  return body;
}

function sanitizeAuditRow(row: Record<string, unknown>) {
  const raw = (row.new_value && typeof row.new_value === "object")
    ? row.new_value as Record<string, unknown>
    : {};

  return {
    id: row.id,
    action: row.action,
    part_number: row.part_number,
    user_name: row.user_name,
    created_at: row.created_at,
    new_value: {
      description: typeof raw.description === "string" ? raw.description : "",
      qty: Number.isFinite(Number(raw.qty)) ? Number(raw.qty) : 0,
      qty_before: Number.isFinite(Number(raw.qty_before ?? raw.qtyBefore))
        ? Number(raw.qty_before ?? raw.qtyBefore)
        : 0,
      qty_after: Number.isFinite(Number(raw.qty_after ?? raw.qtyAfter))
        ? Number(raw.qty_after ?? raw.qtyAfter)
        : 0,
      sap_status: typeof raw.sap_status === "string" ? raw.sap_status : "NOT_PUSHED",
    },
  };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "GET") return jsonResponse({ error: "method_not_allowed" }, 405);

  const url = new URL(request.url);
  const dataset = url.searchParams.get("dataset") || "";
  if (!SAFE_DATASETS.has(dataset)) return jsonResponse({ error: "invalid_dataset" }, 400);

  try {
    switch (dataset) {
      case "stock": {
        const rows = await postgrest(
          "stock?select=id,part_number,description,type,qty_on_hand,min_qty,max_qty,on_plan,bin_location,module,unit_cost,last_activity,status,updated_at&order=part_number.asc",
        );
        return jsonResponse(rows);
      }
      case "audit": {
        const rows = await postgrest(
          "audit_log?select=id,action,part_number,user_name,created_at,new_value&order=created_at.desc&limit=500",
        );
        return jsonResponse(rows.map((row) => sanitizeAuditRow(row as Record<string, unknown>)));
      }
      case "sap": {
        const rows = await postgrest(
          "sap_staging?select=id,created_at,mode,part_number,description,qty_on_hand,qty_before,qty_after,movement_type,plant_code,storage_location,export_status&order=created_at.desc",
        );
        return jsonResponse(rows.map((row) => {
          const r = row as Record<string, unknown>;
          return {
            id: r.id,
            tx_id: null,
            created_at: r.created_at,
            mode: typeof r.mode === "string" && r.mode ? r.mode : "RECEIVE",
            part_number: r.part_number,
            description: r.description,
            qty: r.qty_on_hand,
            qty_before: r.qty_before,
            qty_after: r.qty_after,
            movement_type: r.movement_type,
            plant_code: r.plant_code,
            storage_location: r.storage_location,
            status: r.export_status,
            exported: r.export_status === "EXPORTED",
          };
        }));
      }
      case "settings": {
        const allowed = "sapHeaderText,sapMovementADJUST,sapMovementIN,sapMovementOUT,sapPlantCode,sapStorageLocation";
        const rows = await postgrest(
          `settings?select=key,value&key=in.(${allowed})&order=key.asc`,
        );
        return jsonResponse(rows);
      }
      default:
        return jsonResponse({ error: "invalid_dataset" }, 400);
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : "read_failed";
    const status = code === "server_configuration_missing" ? 503 : 502;
    return jsonResponse({ error: code }, status);
  }
});
