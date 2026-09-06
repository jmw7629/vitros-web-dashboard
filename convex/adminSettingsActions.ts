import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

const settingKey = v.union(
  v.literal("sapPlantCode"),
  v.literal("sapStorageLocation"),
  v.literal("sapMovementIN"),
  v.literal("sapMovementOUT"),
  v.literal("sapMovementADJUST"),
  v.literal("sapHeaderText"),
);

const settingRow = v.object({
  key: settingKey,
  value: v.string(),
  version: v.number(),
  updatedAt: v.string(),
});

const updateReceipt = v.object({
  eventId: v.number(),
  key: settingKey,
  value: v.string(),
  version: v.number(),
  updatedAt: v.string(),
  duplicate: v.boolean(),
});

type EditableSettingKey =
  | "sapPlantCode"
  | "sapStorageLocation"
  | "sapMovementIN"
  | "sapMovementOUT"
  | "sapMovementADJUST"
  | "sapHeaderText";

const EDITABLE_SETTING_KEYS = new Set<EditableSettingKey>([
  "sapPlantCode",
  "sapStorageLocation",
  "sapMovementIN",
  "sapMovementOUT",
  "sapMovementADJUST",
  "sapHeaderText",
]);

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Enterprise settings service is not configured");
  return { url: url.replace(/\/$/, ""), serviceKey };
}

async function sbFetch(serviceKey: string, url: string, path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    // Keep raw database details server-side. Operators receive a bounded error.
    await response.text().catch(() => "");
    if (response.status === 409) throw new Error("The setting changed. Refresh and review before saving again.");
    throw new Error(`Enterprise setting update failed (${response.status})`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function normalizeSettingValue(key: EditableSettingKey, rawValue: string) {
  let value = rawValue.trim();
  if (key === "sapPlantCode" || key === "sapStorageLocation") value = value.toUpperCase();

  if (key === "sapPlantCode" && !/^[A-Z0-9]{2,8}$/.test(value)) {
    throw new Error("Plant code must be 2-8 letters or digits");
  }
  if (key === "sapStorageLocation" && !/^[A-Z0-9_-]{1,12}$/.test(value)) {
    throw new Error("Storage location must be 1-12 letters, digits, underscore, or hyphen");
  }
  if (["sapMovementIN", "sapMovementOUT", "sapMovementADJUST"].includes(key) && !/^\d{3}$/.test(value)) {
    throw new Error("SAP movement type must be three digits");
  }
  if (key === "sapHeaderText" && (value.length < 1 || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value))) {
    throw new Error("SAP header text must be 1-120 printable characters");
  }
  return value;
}

export const listEditableSettings = action({
  args: {},
  returns: v.array(settingRow),
  handler: async (ctx) => {
    await requireCapability(ctx, "admin.system_settings.manage");
    const { url, serviceKey } = getSupabaseConfig();
    const payload = await sbFetch(
      serviceKey,
      url,
      "settings?select=key,value,version,updated_at&order=key.asc&limit=100",
    );
    if (!Array.isArray(payload)) throw new Error("Enterprise settings read returned an invalid payload");

    return payload.flatMap((raw) => {
      const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      const key = String(row.key ?? "") as EditableSettingKey;
      if (!EDITABLE_SETTING_KEYS.has(key)) return [];
      const version = Number(row.version);
      if (!Number.isInteger(version) || version < 1) throw new Error("Enterprise setting version is invalid");
      return [{
        key,
        value: String(row.value ?? ""),
        version,
        updatedAt: String(row.updated_at ?? ""),
      }];
    });
  },
});

export const updateEditableSetting = action({
  args: {
    key: settingKey,
    value: v.string(),
    expectedVersion: v.number(),
    correlationId: v.string(),
    reason: v.optional(v.string()),
  },
  returns: updateReceipt,
  handler: async (ctx, args) => {
    const actorId = await requireCapability(ctx, "admin.system_settings.manage");
    if (!Number.isInteger(args.expectedVersion) || args.expectedVersion < 1) {
      throw new Error("Expected version must be a positive integer");
    }
    const correlationId = args.correlationId.trim();
    if (!correlationId || correlationId.length > 200) throw new Error("Invalid correlation id");
    const reason = args.reason?.trim();
    if (reason && reason.length > 500) throw new Error("Reason is too long");
    const value = normalizeSettingValue(args.key, args.value);

    const { url, serviceKey } = getSupabaseConfig();
    const payload = await sbFetch(serviceKey, url, "rpc/apply_admin_setting_change", {
      method: "POST",
      body: JSON.stringify({
        p_key: args.key,
        p_value: value,
        p_expected_version: args.expectedVersion,
        p_actor: String(actorId),
        p_correlation_id: correlationId,
        p_reason: reason || null,
      }),
    });

    if (!Array.isArray(payload) || payload.length !== 1) {
      throw new Error("Enterprise setting update returned an invalid receipt");
    }
    const row = (payload[0] && typeof payload[0] === "object" ? payload[0] : {}) as Record<string, unknown>;
    const key = String(row.setting_key ?? "") as EditableSettingKey;
    const eventId = Number(row.event_id);
    const version = Number(row.version);
    if (!EDITABLE_SETTING_KEYS.has(key) || !Number.isInteger(eventId) || !Number.isInteger(version)) {
      throw new Error("Enterprise setting update returned an invalid receipt");
    }

    return {
      eventId,
      key,
      value: String(row.value ?? ""),
      version,
      updatedAt: String(row.updated_at ?? ""),
      duplicate: row.duplicate === true,
    };
  },
});
