// Server-side workbook import engine.
// Parses Excel workbooks containing PartsMaster, StockingPlan, KitMaster,
// KitComponents, and SAP_Mapping sheets. Performs natural-key upserts via
// Supabase REST API with service_role. Default mode is DRY_RUN/METADATA_ONLY
// and MUST NOT modify existing stock.qty_on_hand.
import { action } from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./authGuard";
import * as XLSX from "xlsx";

declare const process: { env: Record<string, string | undefined> };

// ---------------------------------------------------------------------------
// Excel error tokens that must be rejected
// ---------------------------------------------------------------------------
const EXCEL_ERROR_TOKENS = new Set([
  "#NAME?",
  "#REF!",
  "#VALUE!",
  "#DIV/0!",
  "#NULL!",
  "#N/A",
  "#ERROR!",
  "#GETTING_DATA",
  "#SPILL!",
  "#UNKNOWN!",
]);

// ---------------------------------------------------------------------------
// Import mode
// ---------------------------------------------------------------------------
type ImportMode = "DRY_RUN" | "METADATA_ONLY" | "ADMIN_QOH_MIGRATION";

// ---------------------------------------------------------------------------
// Supabase helpers
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

async function sbQuery<T>(
  serviceKey: string,
  url: string,
  path: string,
): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: sbHeaders(serviceKey),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      (body as { message?: string }).message ||
      `Supabase error ${res.status}`;
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function sbUpsert<T>(
  serviceKey: string,
  url: string,
  table: string,
  data: Record<string, unknown>,
  onConflict: string,
): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      ...sbHeaders(serviceKey),
      Prefer: "return=representation,resolution=merge-duplicates",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      (body as { message?: string }).message ||
      `Supabase upsert error ${res.status}`;
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function sbInsert<T>(
  serviceKey: string,
  url: string,
  table: string,
  data: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      ...sbHeaders(serviceKey),
      Prefer: "return=representation",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      (body as { message?: string }).message ||
      `Supabase insert error ${res.status}`;
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function sbUpdate(
  serviceKey: string,
  url: string,
  table: string,
  matchCol: string,
  matchVal: string,
  data: Record<string, unknown>,
): Promise<void> {
  const encoded = encodeURIComponent(matchVal);
  const res = await fetch(`${url}/rest/v1/${table}?${matchCol}=eq.${encoded}`, {
    method: "PATCH",
    headers: { ...sbHeaders(serviceKey), Prefer: "return=minimal" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg =
      (body as { message?: string }).message ||
      `Supabase update error ${res.status}`;
    throw new Error(msg);
  }
}

// ---------------------------------------------------------------------------
// Stock lookup
// ---------------------------------------------------------------------------
async function findStockByPartNumber(
  serviceKey: string,
  url: string,
  partNumber: string,
): Promise<Record<string, unknown> | null> {
  const encoded = encodeURIComponent(partNumber);
  const rows = await sbQuery<any[]>(
    serviceKey,
    url,
    `stock?part_number=eq.${encoded}&select=id,part_number,qty_on_hand,description,type,min_qty,max_qty,on_plan,bin_location,unit_cost,barcode,prime,expense,obsolete`,
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Stocking plan lookup
// ---------------------------------------------------------------------------
async function findStockingPlan(
  serviceKey: string,
  url: string,
  plantSloc: string,
  partNumber: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sbQuery<any[]>(
    serviceKey,
    url,
    `stocking_plan?plant_sloc=eq.${encodeURIComponent(plantSloc)}&part_number=eq.${encodeURIComponent(partNumber)}&select=id`,
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Kit lookup
// ---------------------------------------------------------------------------
async function findKitByKitId(
  serviceKey: string,
  url: string,
  kitId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sbQuery<any[]>(
    serviceKey,
    url,
    `kits?kit_id=eq.${encodeURIComponent(kitId)}&select=id,kit_id`,
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Kit component lookup
// ---------------------------------------------------------------------------
async function findKitComponent(
  serviceKey: string,
  url: string,
  kitId: string,
  partNumber: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sbQuery<any[]>(
    serviceKey,
    url,
    `kit_components?kit_id=eq.${encodeURIComponent(kitId)}&part_number=eq.${encodeURIComponent(partNumber)}&select=id`,
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// SAP mapping lookup
// ---------------------------------------------------------------------------
async function findSapMapping(
  serviceKey: string,
  url: string,
  mappingKey: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sbQuery<any[]>(
    serviceKey,
    url,
    `sap_mapping?mapping_key=eq.${encodeURIComponent(mappingKey)}&select=mapping_key`,
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------
function hasExcelErrorToken(value: unknown): boolean {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (EXCEL_ERROR_TOKENS.has(trimmed)) return true;
    if (trimmed.startsWith("#")) return true;
  }
  return false;
}

function normalizeString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (hasExcelErrorToken(value)) return "";
  return String(value).trim();
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  if (hasExcelErrorToken(value)) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
}

function normalizeInt(value: unknown): number | null {
  const num = normalizeNumber(value);
  if (num === null) return null;
  return Math.round(num);
}

function normalizeBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (["y", "yes", "true", "1", "on"].includes(lower)) return true;
    if (["n", "no", "false", "0", "off", ""].includes(lower)) return false;
  }
  if (typeof value === "number") return value !== 0;
  return false;
}

// ---------------------------------------------------------------------------
// Sheet parsers
// ---------------------------------------------------------------------------
interface ParsedPartsMasterRow {
  partNumber: string;
  description: string;
  type: string;
  qtyOnHand: number | null;
  minQty: number | null;
  maxQty: number | null;
  onPlan: boolean;
  binLocation: string;
  unitCost: number | null;
  prime: boolean;
  expense: boolean;
  obsolete: boolean;
  suggestedReorderQty: number | null;
  barcode: string;
}

function parsePartsMasterRow(row: Record<string, unknown>): ParsedPartsMasterRow {
  const partNumber = normalizeString(row["Part Number"] ?? row["part_number"]);
  const description = normalizeString(row["Description"] ?? row["description"]);
  const type = normalizeString(row["Type"] ?? row["type"]);
  const qtyOnHand = normalizeNumber(row["QOH"] ?? row["qty_on_hand"] ?? row["Qty On Hand"]);
  const minQty = normalizeNumber(row["Min Qty"] ?? row["min_qty"] ?? row["Min"]);
  const maxQty = normalizeNumber(row["Max Qty"] ?? row["max_qty"] ?? row["Max"]);
  const onPlan = normalizeBoolean(row["On Plan"] ?? row["on_plan"]);
  const binLocation = normalizeString(row["Bin Location"] ?? row["bin_location"] ?? row["Bin"]);
  const unitCost = normalizeNumber(row["Unit Cost"] ?? row["unit_cost"]);
  const prime = normalizeBoolean(row["Prime"] ?? row["prime"]);
  const expense = normalizeBoolean(row["Expense"] ?? row["expense"]);
  const obsolete = normalizeBoolean(row["Obsolete"] ?? row["obsolete"]);
  const suggestedReorderQty = normalizeInt(row["Suggested Reorder Qty"] ?? row["suggested_reorder_qty"]);
  const barcode = normalizeString(row["Barcode"] ?? row["barcode"]);
  return {
    partNumber, description, type, qtyOnHand, minQty, maxQty,
    onPlan, binLocation, unitCost, prime, expense, obsolete,
    suggestedReorderQty, barcode,
  };
}

interface ParsedStockingPlanRow {
  plantSloc: string;
  partNumber: string;
  productName: string;
  reorderPoint: number | null;
  reorderQty: number | null;
  prime: boolean;
  expense: boolean;
  obsolete: boolean;
  duplicateFlag: boolean;
}

function parseStockingPlanRow(row: Record<string, unknown>): ParsedStockingPlanRow {
  return {
    plantSloc: normalizeString(row["Plant/SLOC"] ?? row["plant_sloc"]),
    partNumber: normalizeString(row["Part Number"] ?? row["part_number"]),
    productName: normalizeString(row["Product Name"] ?? row["product_name"]),
    reorderPoint: normalizeInt(row["Reorder Point"] ?? row["reorder_point"]),
    reorderQty: normalizeInt(row["Reorder Qty"] ?? row["reorder_qty"]),
    prime: normalizeBoolean(row["Prime"] ?? row["prime"]),
    expense: normalizeBoolean(row["Expense"] ?? row["expense"]),
    obsolete: normalizeBoolean(row["Obsolete"] ?? row["obsolete"]),
    duplicateFlag: normalizeBoolean(row["Duplicate"] ?? row["duplicate_flag"]),
  };
}

interface ParsedKitMasterRow {
  kitId: string;
  name: string;
  basePartNumber: string;
  type: string;
  revision: string;
  kitBarcodeValue: string;
  analyzerType: string;
  active: boolean;
  notes: string;
}

function parseKitMasterRow(row: Record<string, unknown>): ParsedKitMasterRow {
  return {
    kitId: normalizeString(row["Kit ID"] ?? row["kit_id"]),
    name: normalizeString(row["Name"] ?? row["name"]),
    basePartNumber: normalizeString(row["Base Part Number"] ?? row["base_part_number"]),
    type: normalizeString(row["Type"] ?? row["type"]),
    revision: normalizeString(row["Revision"] ?? row["revision"]),
    kitBarcodeValue: normalizeString(row["Kit Barcode"] ?? row["kit_barcode_value"]),
    analyzerType: normalizeString(row["Analyzer Type"] ?? row["analyzer_type"]),
    active: normalizeBoolean(row["Active"] ?? row["active"] ?? true),
    notes: normalizeString(row["Notes"] ?? row["notes"]),
  };
}

interface ParsedKitComponentRow {
  kitId: string;
  partNumber: string;
  qtyPerKit: number | null;
  componentNotes: string;
}

function parseKitComponentRow(row: Record<string, unknown>): ParsedKitComponentRow {
  return {
    kitId: normalizeString(row["Kit ID"] ?? row["kit_id"]),
    partNumber: normalizeString(row["Part Number"] ?? row["part_number"]),
    qtyPerKit: normalizeInt(row["Qty Per Kit"] ?? row["qty_per_kit"] ?? row["Quantity"]),
    componentNotes: normalizeString(row["Notes"] ?? row["component_notes"]),
  };
}

interface ParsedSapMappingRow {
  mappingKey: string;
  mappingValue: string;
  description: string;
}

function parseSapMappingRow(row: Record<string, unknown>): ParsedSapMappingRow {
  return {
    mappingKey: normalizeString(row["Mapping Key"] ?? row["mapping_key"] ?? row["Key"]),
    mappingValue: normalizeString(row["Mapping Value"] ?? row["mapping_value"] ?? row["Value"]),
    description: normalizeString(row["Description"] ?? row["description"]),
  };
}

// ---------------------------------------------------------------------------
// Main import action
// ---------------------------------------------------------------------------
export const runWorkbookImport = action({
  args: {
    workbookBase64: v.string(),
    workbookName: v.string(),
    mode: v.optional(
      v.union(
        v.literal("DRY_RUN"),
        v.literal("METADATA_ONLY"),
        v.literal("ADMIN_QOH_MIGRATION"),
      ),
    ),
  },
  returns: v.any(),
  handler: async (ctx, { workbookBase64, workbookName, mode }) => {
    const importMode: ImportMode = (mode as ImportMode) ?? "METADATA_ONLY";
    const actorId = await requireCapability(ctx, "inventory.write");

    // ADMIN_QOH_MIGRATION requires admin capability
    if (importMode === "ADMIN_QOH_MIGRATION") {
      await requireCapability(ctx, "inventory.admin");
    }

    const { url, serviceKey } = getSupabaseConfig();
    const now = new Date().toISOString();

    // Parse workbook
    const binary = Uint8Array.from(atob(workbookBase64), (c) => c.charCodeAt(0));
    const workbook = XLSX.read(binary, { type: "array" });

    const sheetNames = workbook.SheetNames;

    // Initialize counters
    const counts = {
      inserted: 0,
      metadataUpdated: 0,
      unchanged: 0,
      skippedQuantity: 0,
      invalid: 0,
      duplicateKey: 0,
    };
    const rowErrors: Array<{
      sheet: string;
      row: number;
      error: string;
      data?: unknown;
    }> = [];
    const rowsProcessed: Array<{
      sheet: string;
      action: string;
      key: string;
      detail?: string;
    }> = [];

    // ---------- PartsMaster ----------
    if (sheetNames.includes("PartsMaster")) {
      const sheet = workbook.Sheets["PartsMaster"];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const seenParts = new Set<string>();

      for (let i = 0; i < json.length; i++) {
        const raw = json[i];
        const row = parsePartsMasterRow(raw);
        const rowNum = i + 2;

        if (!row.partNumber) {
          counts.invalid++;
          rowErrors.push({
            sheet: "PartsMaster",
            row: rowNum,
            error: "Missing part_number (natural key)",
            data: raw,
          });
          continue;
        }

        if (seenParts.has(row.partNumber)) {
          counts.duplicateKey++;
          rowErrors.push({
            sheet: "PartsMaster",
            row: rowNum,
            error: `Duplicate part_number in source: ${row.partNumber}`,
          });
          continue;
        }
        seenParts.add(row.partNumber);

        const existing = await findStockByPartNumber(serviceKey, url, row.partNumber);

        if (!existing) {
          // New part — dry run only in DRY_RUN mode
          if (importMode === "DRY_RUN") {
            counts.inserted++;
            rowsProcessed.push({
              sheet: "PartsMaster",
              action: "WOULD_INSERT",
              key: row.partNumber,
            });
          } else {
            const insertData: Record<string, unknown> = {
              part_number: row.partNumber,
              description: row.description,
              type: row.type || "Required",
              qty_on_hand: 0,
              min_qty: row.minQty ?? 0,
              max_qty: row.maxQty ?? 0,
              on_plan: row.onPlan,
              bin_location: row.binLocation,
              unit_cost: row.unitCost ?? 0,
              last_activity: now,
              updated_at: now,
            };
            if (row.barcode) insertData.barcode = row.barcode;
            if (row.prime) insertData.prime = true;
            if (row.expense) insertData.expense = true;
            if (row.obsolete) insertData.obsolete = true;
            if (row.suggestedReorderQty !== null) insertData.suggested_reorder_qty = row.suggestedReorderQty;

            await sbInsert(serviceKey, url, "stock", insertData);
            counts.inserted++;
            rowsProcessed.push({
              sheet: "PartsMaster",
              action: "INSERTED",
              key: row.partNumber,
            });
          }
        } else {
          // Existing part — metadata-only updates (no qty changes)
          const updateData: Record<string, unknown> = {};
          let hasChanges = false;

          if (row.description && row.description !== existing.description) {
            updateData.description = row.description;
            hasChanges = true;
          }
          if (row.type && row.type !== existing.type) {
            updateData.type = row.type;
            hasChanges = true;
          }
          if (row.minQty !== null && row.minQty !== existing.min_qty) {
            updateData.min_qty = row.minQty;
            hasChanges = true;
          }
          if (row.maxQty !== null && row.maxQty !== existing.max_qty) {
            updateData.max_qty = row.maxQty;
            hasChanges = true;
          }
          if (row.onPlan !== existing.on_plan) {
            updateData.on_plan = row.onPlan;
            hasChanges = true;
          }
          if (row.binLocation && row.binLocation !== existing.bin_location) {
            updateData.bin_location = row.binLocation;
            hasChanges = true;
          }
          if (row.unitCost !== null && row.unitCost !== existing.unit_cost) {
            updateData.unit_cost = row.unitCost;
            hasChanges = true;
          }
          if (row.barcode && row.barcode !== existing.barcode) {
            updateData.barcode = row.barcode;
            hasChanges = true;
          }
          if (row.prime !== existing.prime) {
            updateData.prime = row.prime;
            hasChanges = true;
          }
          if (row.expense !== existing.expense) {
            updateData.expense = row.expense;
            hasChanges = true;
          }
          if (row.obsolete !== existing.obsolete) {
            updateData.obsolete = row.obsolete;
            hasChanges = true;
          }
          if (row.suggestedReorderQty !== null && row.suggestedReorderQty !== existing.suggested_reorder_qty) {
            updateData.suggested_reorder_qty = row.suggestedReorderQty;
            hasChanges = true;
          }

          if (row.qtyOnHand !== null && importMode !== "ADMIN_QOH_MIGRATION") {
            counts.skippedQuantity++;
            rowsProcessed.push({
              sheet: "PartsMaster",
              action: "SKIPPED_QTY",
              key: row.partNumber,
              detail: `qty_on_hand=${row.qtyOnHand} (non-migration mode)`,
            });
          } else if (row.qtyOnHand !== null && importMode === "ADMIN_QOH_MIGRATION") {
            // Admin QOH migration: write via audited transition
            const currentQoh = existing.qty_on_hand ?? 0;
            if (row.qtyOnHand !== currentQoh) {
              // Use the atomic transition RPC for audited quantity change
              const correlationId = `wb-import-qoh-${row.partNumber}-${Date.now()}`;
              try {
                await sbQuery(serviceKey, url, "rpc/apply_inventory_transition", {
                  method: "POST",
                  body: JSON.stringify({
                    p_part_number: row.partNumber,
                    p_mode: "ADJUST",
                    p_qty: row.qtyOnHand,
                    p_user: String(actorId),
                    p_correlation_id: correlationId,
                    p_analyzer_serial: null,
                    p_batch_id: null,
                  }),
                });
                counts.metadataUpdated++;
                rowsProcessed.push({
                  sheet: "PartsMaster",
                  action: "QOH_MIGRATED",
                  key: row.partNumber,
                  detail: `${currentQoh} → ${row.qtyOnHand}`,
                });
              } catch (e) {
                rowErrors.push({
                  sheet: "PartsMaster",
                  row: rowNum,
                  error: `QOH migration failed: ${e instanceof Error ? e.message : "unknown"}`,
                  data: { partNumber: row.partNumber, currentQoh, targetQoh: row.qtyOnHand },
                });
                counts.invalid++;
              }
            } else {
              counts.unchanged++;
              rowsProcessed.push({
                sheet: "PartsMaster",
                action: "UNCHANGED",
                key: row.partNumber,
              });
            }
          }

          if (hasChanges) {
            updateData.updated_at = now;
            if (importMode !== "DRY_RUN") {
              await sbUpdate(serviceKey, url, "stock", "part_number", row.partNumber, updateData);
            }
            counts.metadataUpdated++;
            rowsProcessed.push({
              sheet: "PartsMaster",
              action: importMode === "DRY_RUN" ? "WOULD_UPDATE" : "UPDATED",
              key: row.partNumber,
              detail: `metadata fields: ${Object.keys(updateData).filter((k) => k !== "updated_at").join(", ")}`,
            });
          } else if (row.qtyOnHand === null || importMode !== "ADMIN_QOH_MIGRATION") {
            counts.unchanged++;
            rowsProcessed.push({
              sheet: "PartsMaster",
              action: "UNCHANGED",
              key: row.partNumber,
            });
          }
        }
      }
    }

    // ---------- StockingPlan ----------
    if (sheetNames.includes("StockingPlan")) {
      const sheet = workbook.Sheets["StockingPlan"];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const seenPlans = new Set<string>();

      for (let i = 0; i < json.length; i++) {
        const raw = json[i];
        const row = parseStockingPlanRow(raw);
        const rowNum = i + 2;

        if (!row.plantSloc || !row.partNumber) {
          counts.invalid++;
          rowErrors.push({
            sheet: "StockingPlan",
            row: rowNum,
            error: "Missing plant_sloc or part_number (composite natural key)",
            data: raw,
          });
          continue;
        }

        const compositeKey = `${row.plantSloc}|${row.partNumber}`;
        if (seenPlans.has(compositeKey)) {
          counts.duplicateKey++;
          rowErrors.push({
            sheet: "StockingPlan",
            row: rowNum,
            error: `Duplicate composite key in source: ${compositeKey}`,
          });
          continue;
        }
        seenPlans.add(compositeKey);

        // Verify part_number FK exists
        const stock = await findStockByPartNumber(serviceKey, url, row.partNumber);
        if (!stock) {
          counts.invalid++;
          rowErrors.push({
            sheet: "StockingPlan",
            row: rowNum,
            error: `Referenced part_number not in stock: ${row.partNumber}`,
          });
          continue;
        }

        const existing = await findStockingPlan(serviceKey, url, row.plantSloc, row.partNumber);

        if (!existing) {
          if (importMode === "DRY_RUN") {
            counts.inserted++;
            rowsProcessed.push({
              sheet: "StockingPlan",
              action: "WOULD_INSERT",
              key: compositeKey,
            });
          } else {
            await sbInsert(serviceKey, url, "stocking_plan", {
              plant_sloc: row.plantSloc,
              part_number: row.partNumber,
              product_name: row.productName,
              reorder_point: row.reorderPoint,
              reorder_qty: row.reorderQty,
              prime: row.prime,
              expense: row.expense,
              obsolete: row.obsolete,
              duplicate_flag: row.duplicateFlag,
            });
            counts.inserted++;
            rowsProcessed.push({
              sheet: "StockingPlan",
              action: "INSERTED",
              key: compositeKey,
            });
          }
        } else {
          counts.unchanged++;
          rowsProcessed.push({
            sheet: "StockingPlan",
            action: "UNCHANGED",
            key: compositeKey,
          });
        }
      }
    }

    // ---------- KitMaster ----------
    if (sheetNames.includes("KitMaster")) {
      const sheet = workbook.Sheets["KitMaster"];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const seenKits = new Set<string>();

      for (let i = 0; i < json.length; i++) {
        const raw = json[i];
        const row = parseKitMasterRow(raw);
        const rowNum = i + 2;

        if (!row.kitId) {
          counts.invalid++;
          rowErrors.push({
            sheet: "KitMaster",
            row: rowNum,
            error: "Missing kit_id (natural key)",
            data: raw,
          });
          continue;
        }

        if (seenKits.has(row.kitId)) {
          counts.duplicateKey++;
          rowErrors.push({
            sheet: "KitMaster",
            row: rowNum,
            error: `Duplicate kit_id in source: ${row.kitId}`,
          });
          continue;
        }
        seenKits.add(row.kitId);

        const existing = await findKitByKitId(serviceKey, url, row.kitId);

        if (!existing) {
          if (importMode === "DRY_RUN") {
            counts.inserted++;
            rowsProcessed.push({
              sheet: "KitMaster",
              action: "WOULD_INSERT",
              key: row.kitId,
            });
          } else {
            const insertData: Record<string, unknown> = {
              kit_id: row.kitId,
              name: row.name,
              base_part_number: row.basePartNumber,
              type: row.type,
              revision: row.revision,
              active: row.active,
              notes: row.notes,
            };
            if (row.kitBarcodeValue) insertData.kit_barcode_value = row.kitBarcodeValue;
            if (row.analyzerType) insertData.analyzer_type = row.analyzerType;

            await sbInsert(serviceKey, url, "kits", insertData);
            counts.inserted++;
            rowsProcessed.push({
              sheet: "KitMaster",
              action: "INSERTED",
              key: row.kitId,
            });
          }
        } else {
          counts.unchanged++;
          rowsProcessed.push({
            sheet: "KitMaster",
            action: "UNCHANGED",
            key: row.kitId,
          });
        }
      }
    }

    // ---------- KitComponents ----------
    if (sheetNames.includes("KitComponents")) {
      const sheet = workbook.Sheets["KitComponents"];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const seenComponents = new Set<string>();

      for (let i = 0; i < json.length; i++) {
        const raw = json[i];
        const row = parseKitComponentRow(raw);
        const rowNum = i + 2;

        if (!row.kitId || !row.partNumber) {
          counts.invalid++;
          rowErrors.push({
            sheet: "KitComponents",
            row: rowNum,
            error: "Missing kit_id or part_number (composite natural key)",
            data: raw,
          });
          continue;
        }

        if (row.qtyPerKit === null || row.qtyPerKit <= 0) {
          counts.invalid++;
          rowErrors.push({
            sheet: "KitComponents",
            row: rowNum,
            error: `Invalid qty_per_kit: ${row.qtyPerKit}`,
            data: raw,
          });
          continue;
        }

        const compositeKey = `${row.kitId}|${row.partNumber}`;
        if (seenComponents.has(compositeKey)) {
          counts.duplicateKey++;
          rowErrors.push({
            sheet: "KitComponents",
            row: rowNum,
            error: `Duplicate kit_id+part_number in source: ${compositeKey}`,
          });
          continue;
        }
        seenComponents.add(compositeKey);

        // Verify FKs exist
        const kit = await findKitByKitId(serviceKey, url, row.kitId);
        if (!kit) {
          counts.invalid++;
          rowErrors.push({
            sheet: "KitComponents",
            row: rowNum,
            error: `Referenced kit_id not in kits: ${row.kitId}`,
          });
          continue;
        }

        const stock = await findStockByPartNumber(serviceKey, url, row.partNumber);
        if (!stock) {
          counts.invalid++;
          rowErrors.push({
            sheet: "KitComponents",
            row: rowNum,
            error: `Referenced part_number not in stock: ${row.partNumber}`,
          });
          continue;
        }

        const existing = await findKitComponent(serviceKey, url, row.kitId, row.partNumber);

        if (!existing) {
          if (importMode === "DRY_RUN") {
            counts.inserted++;
            rowsProcessed.push({
              sheet: "KitComponents",
              action: "WOULD_INSERT",
              key: compositeKey,
            });
          } else {
            await sbInsert(serviceKey, url, "kit_components", {
              kit_id: row.kitId,
              part_number: row.partNumber,
              qty_per_kit: row.qtyPerKit,
              component_notes: row.componentNotes,
            });
            counts.inserted++;
            rowsProcessed.push({
              sheet: "KitComponents",
              action: "INSERTED",
              key: compositeKey,
            });
          }
        } else {
          counts.unchanged++;
          rowsProcessed.push({
            sheet: "KitComponents",
            action: "UNCHANGED",
            key: compositeKey,
          });
        }
      }
    }

    // ---------- SAP_Mapping ----------
    if (sheetNames.includes("SAP_Mapping")) {
      const sheet = workbook.Sheets["SAP_Mapping"];
      const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const seenMappings = new Set<string>();

      for (let i = 0; i < json.length; i++) {
        const raw = json[i];
        const row = parseSapMappingRow(raw);
        const rowNum = i + 2;

        if (!row.mappingKey) {
          counts.invalid++;
          rowErrors.push({
            sheet: "SAP_Mapping",
            row: rowNum,
            error: "Missing mapping_key (natural key)",
            data: raw,
          });
          continue;
        }

        if (seenMappings.has(row.mappingKey)) {
          counts.duplicateKey++;
          rowErrors.push({
            sheet: "SAP_Mapping",
            row: rowNum,
            error: `Duplicate mapping_key in source: ${row.mappingKey}`,
          });
          continue;
        }
        seenMappings.add(row.mappingKey);

        if (!row.mappingValue) {
          counts.invalid++;
          rowErrors.push({
            sheet: "SAP_Mapping",
            row: rowNum,
            error: "Missing mapping_value",
            data: raw,
          });
          continue;
        }

        const existing = await findSapMapping(serviceKey, url, row.mappingKey);

        if (!existing) {
          if (importMode === "DRY_RUN") {
            counts.inserted++;
            rowsProcessed.push({
              sheet: "SAP_Mapping",
              action: "WOULD_INSERT",
              key: row.mappingKey,
            });
          } else {
            await sbInsert(serviceKey, url, "sap_mapping", {
              mapping_key: row.mappingKey,
              mapping_value: row.mappingValue,
              description: row.description,
            });
            counts.inserted++;
            rowsProcessed.push({
              sheet: "SAP_Mapping",
              action: "INSERTED",
              key: row.mappingKey,
            });
          }
        } else {
          // Update mapping_value if different
          const updateData: Record<string, unknown> = {};
          if (row.mappingValue !== (existing as any).mapping_value) {
            updateData.mapping_value = row.mappingValue;
          }
          if (row.description && row.description !== (existing as any).description) {
            updateData.description = row.description;
          }

          if (Object.keys(updateData).length > 0) {
            updateData.updated_at = now;
            if (importMode !== "DRY_RUN") {
              await sbUpdate(serviceKey, url, "sap_mapping", "mapping_key", row.mappingKey, updateData);
            }
            counts.metadataUpdated++;
            rowsProcessed.push({
              sheet: "SAP_Mapping",
              action: importMode === "DRY_RUN" ? "WOULD_UPDATE" : "UPDATED",
              key: row.mappingKey,
              detail: `updated fields: ${Object.keys(updateData).filter((k) => k !== "updated_at").join(", ")}`,
            });
          } else {
            counts.unchanged++;
            rowsProcessed.push({
              sheet: "SAP_Mapping",
              action: "UNCHANGED",
              key: row.mappingKey,
            });
          }
        }
      }
    }

    // Compute import_key for idempotency
    const importKey = `${workbookName}-${importMode}-${Date.now()}`;

    // Persist workbook_import_runs record
    const runRecord = {
      import_key: importKey,
      workbook_name: workbookName,
      mode: importMode,
      requested_by: String(actorId),
      inserted_count: counts.inserted,
      metadata_updated_count: counts.metadataUpdated,
      unchanged_count: counts.unchanged,
      skipped_quantity_count: counts.skippedQuantity,
      invalid_count: counts.invalid,
      duplicate_key_count: counts.duplicateKey,
      report: {
        sheetsProcessed: sheetNames,
        rowErrors,
        rowsProcessed: rowsProcessed.slice(0, 500),
      },
      started_at: now,
      completed_at: new Date().toISOString(),
    };

    try {
      await sbInsert(serviceKey, url, "workbook_import_runs", runRecord);
    } catch (e) {
      rowErrors.push({
        sheet: "_system",
        row: 0,
        error: `Failed to persist import run record: ${e instanceof Error ? e.message : "unknown"}`,
      });
    }

    return {
      importKey,
      mode: importMode,
      counts,
      sheetNames,
      totalRowErrors: rowErrors.length,
      rowErrors: rowErrors.slice(0, 100),
      rowsProcessed: rowsProcessed.slice(0, 200),
    };
  },
});
