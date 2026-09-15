import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";
import { getSupabaseConfig } from "./supabaseGateway";

// Read explicit stock movements, excluding the duplicate automatic stock audit
// rows and part-master edits. Pages share a fixed upper timestamp from the UI.
export const listPeriod = action({
  args: { start: v.number(), end: v.number(), offset: v.number() },
  returns: v.object({
    items: v.array(v.object({ _id: v.string(), timestamp: v.number(), mode: v.string(), partNumber: v.string(), description: v.string(), qty: v.number() })),
    hasMore: v.boolean(),
  }),
  handler: async (ctx, { start, end, offset }) => {
    await requireCapability(ctx, "inventory.read");
    if (![start, end, offset].every(Number.isSafeInteger) || start < 0 || end < start || end - start > 367 * 86400000 || offset < 0 || offset > 100000 || offset % 500 !== 0) throw new Error("Invalid report range");
    const { url, serviceKey } = getSupabaseConfig();
    const params = new URLSearchParams({ select: "id,created_at,action,part_number,new_value", entity_type: "eq.stock", action: "in.(IN,OUT,RECEIVE,ADJUST)", order: "created_at.desc,id.desc", limit: "501", offset: String(offset) });
    params.append("created_at", `gte.${new Date(start).toISOString()}`);
    params.append("created_at", `lte.${new Date(end).toISOString()}`);
    const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/audit_log?${params}`, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
    if (!response.ok) throw new Error("Inventory reporting data could not be loaded");
    const rows = await response.json() as Array<{ id: string; created_at: string; action: string; part_number: string; new_value: Record<string, unknown> | null }>;
    if (!Array.isArray(rows)) throw new Error("Invalid inventory report response");
    const items = rows.slice(0, 500).map(row => {
      const value = row.new_value ?? {};
      const before = Number(value.qty_before ?? value.qtyBefore);
      const after = Number(value.qty_after ?? value.qtyAfter);
      const qty = Number(value.qty ?? (Number.isFinite(before) && Number.isFinite(after) ? Math.abs(after - before) : NaN));
      const timestamp = Date.parse(row.created_at);
      if (!Number.isFinite(timestamp) || !Number.isFinite(qty)) throw new Error("A stock movement is missing its date or quantity");
      return { _id: row.id, timestamp, mode: row.action, partNumber: row.part_number ?? "", description: String(value.description ?? ""), qty: Math.abs(qty) };
    });
    return { items, hasMore: rows.length > 500 };
  },
});
