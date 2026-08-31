// Workbook import action.
// Accepts structured workbook data from the client, validates authorization,
// applies import modes (DRY_RUN, METADATA_ONLY, ADMIN_QOH_MIGRATION),
// and records import runs for audit.
import { v } from "convex/values";

import { action, query } from "./_generated/server";
import { requireCapability } from "./authGuard";

declare const process: { env: Record<string, string | undefined> };

// ---------------------------------------------------------------------------
// Payload bounds
// ---------------------------------------------------------------------------
const MAX_BASE64_LENGTH = 68_000_000; // ~50 MB base64 ≈ 37.5 MB decoded
const MAX_DECODED_BYTES = 52_428_800; // 50 MB decoded workbook
const MAX_ROWS_PER_SHEET = 10_000;

// ---------------------------------------------------------------------------
// Supabase helpers (server-side only, duplicated to avoid cross-import cycles)
// ---------------------------------------------------------------------------
function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase config missing");
  return { url, serviceKey };
}

function sbHeaders(serviceKey: string) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
  };
}

async function sbFetch<T>(
  serviceKey: string,
  url: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { ...sbHeaders(serviceKey), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      (body as { message?: string; error?: string }).message ||
      (body as { message?: string; error?: string }).error ||
      `Supabase error ${res.status}`;
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Apply inventory transition via the atomic Supabase RPC.
// MUST use POST with a JSON body.  Fail closed on non-2xx.
// ---------------------------------------------------------------------------
async function applyInventoryTransition(
  serviceKey: string,
  url: string,
  args: {
    partNumber: string;
    mode: "RECEIVE" | "IN" | "OUT" | "ADJUST" | "STOCKOUT";
    qty: number;
    user: string;
    correlationId: string;
  },
) {
  return sbFetch<Record<string, unknown>>(
    serviceKey,
    url,
    "rpc/apply_inventory_transition",
    {
      method: "POST",
      body: JSON.stringify({
        p_part_number: args.partNumber,
        p_mode: args.mode,
        p_qty: args.qty,
        p_user: args.user,
        p_correlation_id: args.correlationId,
      }),
    },
  );
}

// ---------------------------------------------------------------------------
// SAP mapping query — selects mapping_key, mapping_value, description
// so reruns can distinguish unchanged vs changed mappings.
// ---------------------------------------------------------------------------
async function findSapMappings(serviceKey: string, url: string) {
  return sbFetch<
    Array<{
      mapping_key: string;
      mapping_value: string;
      description: string | null;
    }>
  >(
    serviceKey,
    url,
    "sap_mapping?select=mapping_key,mapping_value,description&order=mapping_key",
  );
}

// ---------------------------------------------------------------------------
// Record an import run
// ---------------------------------------------------------------------------
interface ImportRunReport {
  insertedCount: number;
  metadataUpdatedCount: number;
  unchangedCount: number;
  skippedQuantityCount: number;
  invalidCount: number;
  duplicateKeyCount: number;
  details: Record<string, unknown>;
}

async function recordImportRun(
  serviceKey: string,
  url: string,
  run: {
    importKey: string;
    workbookName: string;
    workbookSha256: string | null;
    mode: "DRY_RUN" | "METADATA_ONLY" | "ADMIN_QOH_MIGRATION";
    requestedBy: string;
    report: ImportRunReport;
  },
) {
  const rows = await sbFetch<Array<{ id: string }>>(
    serviceKey,
    url,
    "workbook_import_runs",
    {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        import_key: run.importKey,
        workbook_name: run.workbookName,
        workbook_sha256: run.workbookSha256,
        mode: run.mode,
        requested_by: run.requestedBy,
        inserted_count: run.report.insertedCount,
        metadata_updated_count: run.report.metadataUpdatedCount,
        unchanged_count: run.report.unchangedCount,
        skipped_quantity_count: run.report.skippedQuantityCount,
        invalid_count: run.report.invalidCount,
        duplicate_key_count: run.report.duplicateKeyCount,
        report: run.report.details,
        completed_at: new Date().toISOString(),
      }),
    },
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Check for duplicate natural key in a list of rows. */
function findDuplicateKeys(rows: Array<{ part_number: string }>): {
  duplicates: string[];
  unique: Map<string, number>;
} {
  const seen = new Map<string, number>();
  const duplicates: string[] = [];
  for (const row of rows) {
    const key = row.part_number?.trim();
    if (!key) continue;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count === 2) duplicates.push(key);
  }
  return { duplicates, unique: seen };
}

// ---------------------------------------------------------------------------
// Types for workbook data sent from the client.
// The client parses the .xlsx and sends structured JSON.
// ---------------------------------------------------------------------------
interface WorkbookStockRow {
  part_number: string;
  description: string;
  type?: string;
  qty_on_hand?: number;
  min_qty?: number;
  max_qty?: number;
  on_plan?: boolean;
  bin_location?: string;
  module?: string;
  unit_cost?: number;
}

interface WorkbookKitRow {
  kit_id: string;
  name: string;
  base_part_number?: string;
  analyzer_type?: string;
  active?: boolean;
}

interface WorkbookEmployeeRow {
  name: string;
  initials: string;
  role?: string;
  active?: boolean;
}

interface WorkbookSapMappingRow {
  mapping_key: string;
  mapping_value: string;
  description?: string;
}

interface WorkbookData {
  stock?: WorkbookStockRow[];
  kits?: WorkbookKitRow[];
  employees?: WorkbookEmployeeRow[];
  sapMapping?: WorkbookSapMappingRow[];
}

// ---------------------------------------------------------------------------
// Main action
// ---------------------------------------------------------------------------
export const runImport = action({
  args: {
    workbookData: v.any(),
    mode: v.union(
      v.literal("DRY_RUN"),
      v.literal("METADATA_ONLY"),
      v.literal("ADMIN_QOH_MIGRATION"),
    ),
    workbookName: v.optional(v.string()),
    base64Length: v.optional(v.number()),
    decodedBytes: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    // ---- Authorization ----
    if (args.mode === "ADMIN_QOH_MIGRATION") {
      await requireCapability(ctx, "inventory.admin");
    } else {
      await requireCapability(ctx, "inventory.write");
    }

    // ---- Payload bounds (defense-in-depth; client already validated) ----
    if (
      args.base64Length !== undefined &&
      args.base64Length > MAX_BASE64_LENGTH
    ) {
      throw new Error(
        `Base64 payload too large: ${args.base64Length} chars exceeds limit of ${MAX_BASE64_LENGTH}`,
      );
    }
    if (
      args.decodedBytes !== undefined &&
      args.decodedBytes > MAX_DECODED_BYTES
    ) {
      throw new Error(
        `Decoded workbook too large: ${args.decodedBytes} bytes exceeds limit of ${MAX_DECODED_BYTES}`,
      );
    }

    // ---- Validate workbook data shape ----
    const data: WorkbookData = args.workbookData;
    if (!data || typeof data !== "object") {
      throw new Error(
        "Invalid workbook data: expected an object with stock/kits/employees/sapMapping sheets",
      );
    }

    const report: ImportRunReport = {
      insertedCount: 0,
      metadataUpdatedCount: 0,
      unchangedCount: 0,
      skippedQuantityCount: 0,
      invalidCount: 0,
      duplicateKeyCount: 0,
      details: {},
    };

    const { url, serviceKey } = getSupabaseConfig();

    // ---- Process Stock sheet ----
    if (Array.isArray(data.stock) && data.stock.length > 0) {
      if (data.stock.length > MAX_ROWS_PER_SHEET) {
        throw new Error(
          `Stock sheet exceeds maximum of ${MAX_ROWS_PER_SHEET} rows`,
        );
      }

      const { duplicates } = findDuplicateKeys(
        data.stock.map(r => ({ part_number: r.part_number })),
      );
      report.duplicateKeyCount = duplicates.length;
      if (duplicates.length > 0) {
        report.details = {
          ...report.details,
          duplicatePartNumbers: duplicates,
        };
      }

      // Fetch existing stock for comparison
      const existingStock = await sbFetch<
        Array<{ part_number: string; qty_on_hand: number; description: string }>
      >(serviceKey, url, "stock?select=part_number,qty_on_hand,description");
      const existingMap = new Map(existingStock.map(r => [r.part_number, r]));

      for (const row of data.stock) {
        const pn = row.part_number?.trim();
        if (!pn) {
          report.invalidCount++;
          continue;
        }

        const existing = existingMap.get(pn);

        if (args.mode === "DRY_RUN") {
          if (existing) {
            report.unchangedCount++;
          } else {
            report.insertedCount++;
          }
          continue;
        }

        if (args.mode === "METADATA_ONLY") {
          // Update metadata only — never touch qty_on_hand
          if (existing) {
            const safeFields: Record<string, unknown> = {
              updated_at: new Date().toISOString(),
            };
            if (
              row.description !== undefined &&
              row.description !== existing.description
            ) {
              safeFields.description = row.description;
            }
            if (row.type !== undefined) safeFields.type = row.type;
            if (row.min_qty !== undefined) safeFields.min_qty = row.min_qty;
            if (row.max_qty !== undefined) safeFields.max_qty = row.max_qty;
            if (row.on_plan !== undefined) safeFields.on_plan = row.on_plan;
            if (row.bin_location !== undefined)
              safeFields.bin_location = row.bin_location;
            if (row.module !== undefined) safeFields.module = row.module;
            if (row.unit_cost !== undefined)
              safeFields.unit_cost = row.unit_cost;

            if (Object.keys(safeFields).length > 1) {
              await sbFetch<void>(
                serviceKey,
                url,
                `stock?part_number=eq.${encodeURIComponent(pn)}`,
                {
                  method: "PATCH",
                  headers: { Prefer: "return=minimal" },
                  body: JSON.stringify(safeFields),
                },
              );
              report.metadataUpdatedCount++;
            } else {
              report.unchangedCount++;
            }
          } else {
            // Insert new stock with qty=0 (metadata only)
            const now = new Date().toISOString();
            await sbFetch<any[]>(serviceKey, url, "stock", {
              method: "POST",
              headers: { Prefer: "return=representation" },
              body: JSON.stringify({
                part_number: pn,
                description: row.description || "",
                type: row.type || "Required",
                qty_on_hand: 0,
                min_qty: row.min_qty ?? 0,
                max_qty: row.max_qty ?? 0,
                on_plan: row.on_plan ?? false,
                bin_location: row.bin_location ?? "",
                module: row.module ?? "",
                unit_cost: row.unit_cost ?? 0,
                last_activity: now,
                updated_at: now,
              }),
            });
            report.insertedCount++;
          }
          continue;
        }

        if (args.mode === "ADMIN_QOH_MIGRATION") {
          if (existing) {
            const qty = Number(row.qty_on_hand ?? 0);
            if (qty === existing.qty_on_hand) {
              report.unchangedCount++;
              continue;
            }
            if (!Number.isFinite(qty) || qty < 0) {
              report.invalidCount++;
              continue;
            }
            // Use the atomic inventory transition RPC — POST with JSON body
            await applyInventoryTransition(serviceKey, url, {
              partNumber: pn,
              mode: "ADJUST",
              qty,
              user: "workbook-import",
              correlationId: `wb-migration-${pn}-${Date.now()}`,
            });
            report.metadataUpdatedCount++;
          } else {
            const now = new Date().toISOString();
            await sbFetch<any[]>(serviceKey, url, "stock", {
              method: "POST",
              headers: { Prefer: "return=representation" },
              body: JSON.stringify({
                part_number: pn,
                description: row.description || "",
                type: row.type || "Required",
                qty_on_hand: row.qty_on_hand ?? 0,
                min_qty: row.min_qty ?? 0,
                max_qty: row.max_qty ?? 0,
                on_plan: row.on_plan ?? false,
                bin_location: row.bin_location ?? "",
                module: row.module ?? "",
                unit_cost: row.unit_cost ?? 0,
                last_activity: now,
                updated_at: now,
              }),
            });
            report.insertedCount++;
          }
        }
      }
    }

    // ---- Process Kits sheet ----
    if (Array.isArray(data.kits) && data.kits.length > 0) {
      if (data.kits.length > MAX_ROWS_PER_SHEET) {
        throw new Error(
          `Kits sheet exceeds maximum of ${MAX_ROWS_PER_SHEET} rows`,
        );
      }
      const existingKits = await sbFetch<Array<{ kit_id: string }>>(
        serviceKey,
        url,
        "kits?select=kit_id",
      );
      const existingKitIds = new Set(existingKits.map(k => k.kit_id));

      for (const row of data.kits) {
        const kitId = row.kit_id?.trim();
        if (!kitId) {
          report.invalidCount++;
          continue;
        }
        if (existingKitIds.has(kitId)) {
          report.unchangedCount++;
          continue;
        }
        if (args.mode === "DRY_RUN") {
          report.insertedCount++;
          continue;
        }
        await sbFetch<any[]>(serviceKey, url, "kits", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            kit_id: kitId,
            name: row.name || kitId,
            base_part_number: row.base_part_number || null,
            analyzer_type: row.analyzer_type || null,
            active: row.active !== false,
          }),
        });
        report.insertedCount++;
      }
    }

    // ---- Process Employees sheet ----
    if (Array.isArray(data.employees) && data.employees.length > 0) {
      if (data.employees.length > MAX_ROWS_PER_SHEET) {
        throw new Error(
          `Employees sheet exceeds maximum of ${MAX_ROWS_PER_SHEET} rows`,
        );
      }
      const existingEmps = await sbFetch<Array<{ initials: string }>>(
        serviceKey,
        url,
        "employees?select=initials",
      );
      const existingInitials = new Set(existingEmps.map(e => e.initials));

      for (const row of data.employees) {
        const initials = row.initials?.trim();
        if (!initials) {
          report.invalidCount++;
          continue;
        }
        if (existingInitials.has(initials)) {
          report.unchangedCount++;
          continue;
        }
        if (args.mode === "DRY_RUN") {
          report.insertedCount++;
          continue;
        }
        await sbFetch<any[]>(serviceKey, url, "employees", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({
            name: row.name,
            initials,
            role: row.role || null,
            active: row.active !== false,
          }),
        });
        report.insertedCount++;
      }
    }

    // ---- Process SAP Mapping sheet ----
    if (Array.isArray(data.sapMapping) && data.sapMapping.length > 0) {
      if (data.sapMapping.length > MAX_ROWS_PER_SHEET) {
        throw new Error(
          `SAP Mapping sheet exceeds maximum of ${MAX_ROWS_PER_SHEET} rows`,
        );
      }
      // Select mapping_key, mapping_value, description for idempotency comparison
      const existingMappings = await findSapMappings(serviceKey, url);
      const existingMap = new Map(
        existingMappings.map(m => [m.mapping_key, m]),
      );

      for (const row of data.sapMapping) {
        const key = row.mapping_key?.trim();
        if (!key) {
          report.invalidCount++;
          continue;
        }
        const existing = existingMap.get(key);
        if (
          existing &&
          existing.mapping_value === row.mapping_value &&
          existing.description === (row.description ?? null)
        ) {
          report.unchangedCount++;
          continue;
        }
        if (args.mode === "DRY_RUN") {
          report.insertedCount++;
          continue;
        }
        const now = new Date().toISOString();
        await sbFetch<void>(
          serviceKey,
          url,
          `sap_mapping?mapping_key=eq.${encodeURIComponent(key)}`,
          {
            method: "PATCH",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify({
              mapping_value: row.mapping_value,
              description: row.description ?? null,
              updated_at: now,
            }),
          },
        );
        report.insertedCount++;
      }
    }

    // ---- Record import run (not for DRY_RUN) ----
    if (args.mode !== "DRY_RUN") {
      const importKey = `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await recordImportRun(serviceKey, url, {
        importKey,
        workbookName: args.workbookName ?? "unknown",
        workbookSha256: null,
        mode: args.mode,
        requestedBy: "workbook-import",
        report,
      });
    }

    return {
      mode: args.mode,
      ...report,
    };
  },
});

// ---------------------------------------------------------------------------
// Query: list recent import runs (for audit)
// ---------------------------------------------------------------------------
export const listImportRuns = query({
  args: {
    limit: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (_ctx, { limit }) => {
    const { url, serviceKey } = getSupabaseConfig();
    const rows = await sbFetch<
      Array<{
        id: string;
        import_key: string;
        workbook_name: string;
        mode: string;
        requested_by: string;
        inserted_count: number;
        metadata_updated_count: number;
        unchanged_count: number;
        skipped_quantity_count: number;
        invalid_count: number;
        duplicate_key_count: number;
        report: Record<string, unknown>;
        started_at: string;
        completed_at: string | null;
      }>
    >(
      serviceKey,
      url,
      `workbook_import_runs?select=*&order=started_at.desc&limit=${limit ?? 20}`,
    );
    return rows;
  },
});
