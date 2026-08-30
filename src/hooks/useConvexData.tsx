import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useAction, useConvexAuth } from "convex/react";
import { api } from "../../convex/_generated/api";

// ─── Supabase anon read-only fallback (for reads when actions are unavailable) ───
// SECURITY: Only the anon key is used here for reads. The service_role key is NEVER in the browser.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "";
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

async function sbAnonQuery<T>(table: string, params: string = ""): Promise<T[]> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return [];
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*${params ? "&" + params : ""}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return [];
  return (await res.json()) as T[];
}

// ─── Convex HTTP helpers (for REM data still on Convex production backend) ───
const CONVEX_URL = "https://accurate-newt-938.convex.cloud";
const CYCLE_CONVEX_URL = "https://accurate-newt-938.convex.cloud";

async function convexQuery<T>(url: string, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${url}/api/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: fn, args, format: "json" }),
  });
  const json = await res.json();
  if (json.status === "success") return json.value as T;
  throw new Error(json.errorMessage || "Query failed");
}

async function safeConvexQuery<T>(url: string, fn: string, fallback: T): Promise<T> {
  try { return await convexQuery<T>(url, fn); } catch { return fallback; }
}

// ─── Types ───

export interface Part {
  _id: string;
  partNumber: string;
  description: string;
  type: string;
  qoh: number;
  minQty: number;
  maxQty: number;
  onPlan: boolean;
  binLocation: string;
  module: string;
  unitCost?: number;
  lastActivity?: string;
  status: string;
}

export function getStatus(p: Part): string {
  if (p.qoh <= 0) return "OUT";
  if (p.qoh < p.minQty) return "LOW";
  if (p.qoh > p.maxQty) return "OVER";
  return "OK";
}

export interface Transaction {
  _id: string;
  timestamp: number;
  user: string;
  mode: string;
  partNumber: string;
  description: string;
  qty: number;
  qtyBefore: number;
  qtyAfter: number;
  analyzerSerial?: string;
  batchId?: string;
  sapStatus: string;
  archived: boolean;
}

export interface Kit {
  _id: string;
  kitId: string;
  name: string;
  basePartNumber: string;
  revision: string;
  components: KitComponent[];
}

export interface KitComponent {
  partNumber: string;
  description: string;
  qtyRequired: number;
}

export interface SapRecord {
  _id: string;
  txId?: string;
  timestamp: number;
  mode: string;
  partNumber: string;
  description: string;
  qty: number;
  qtyBefore: number;
  qtyAfter: number;
  analyzerSerial?: string;
  movementType: string;
  plantCode: string;
  storageLocation: string;
  status: string;
  postedAt?: number;
  exported: boolean;
  exportedCount?: number;
}

export interface CycleSchedule {
  _id: string;
  name: string;
  frequency: string;
  assignedTo: string;
  nextDue: number;
  status: string;
  parts: string[];
}

export interface CycleResult {
  _id: string;
  scheduleId: string;
  timestamp: number;
  countedBy: string;
  results: { partNumber: string; systemQty: number; countedQty: number; variance: number }[];
  status: string;
  sortMode?: string;
}

export interface Employee {
  _id: string;
  name: string;
  initials: string;
  email?: string;
  active: boolean;
  createdAt: number;
  role?: string;
}

export interface AppSetting {
  _id: string;
  key: string;
  value: string;
}

export interface REMAnalyzer {
  _id: string;
  serialNumber: string;
  analyzerType: string;
  currentStage: string;
  assignedTo?: string;
  startDate?: string;
  targetDate?: string;
  productionOrder?: number;
  procurementPct: number;
  cleaningPct: number;
  servicePct: number;
  finalLinePct: number;
  packagingPct: number;
  releaseTestingPct: number;
  qaReleasePct: number;
  sapReleasePct: number;
  currentPct: number;
  overallPct: number;
  isComplete: boolean;
  daysInStage: number;
  slaDays: number;
  notes?: string;
}

export interface LVCCItem {
  _id: string;
  serialNumber: string;
  batchNumber?: string;
  itemType?: string;
  currentStage?: string;
  startDate?: string;
  endDate?: string;
  isComplete?: boolean;
  buildPct: number;
  testPct: number;
  packagingPct: number;
  qaReleasePct: number;
  sapReleasePct: number;
}

export interface StaffMember {
  _id: string;
  name: string;
  role: string;
  skills: Record<string, string>;
}

export interface WeeklyNoteEntry {
  _id?: string;
  weekStart: string;
  weekNumber: number;
  quarter: string;
  notes: { content: string; product: string }[];
}

export interface WeeklyBuildPlan {
  _id: string;
  weekOf: string;
  planned: number;
  actual: number;
  notes?: string;
}

export interface TrackerWeekly {
  _id: string;
  weekOf: string;
  teardown: number;
  cleaning: number;
  rebuild: number;
  testing: number;
  qa: number;
  shipping: number;
  complete: number;
}

export interface IncomingStockBatch {
  _id: string;
  intakeBatchId: string;
  poNumber?: string;
  deliveryNumber?: string;
  trackingNumber?: string;
  status: string;
  createdAt: number;
  createdBy?: string;
  lines: BatchLine[];
}

export interface BatchLine {
  lineNo: number;
  partNumber_OCR?: string;
  partNumber_Final?: string;
  description_OCR?: string;
  description_Final?: string;
  qty_OCR?: number;
  qty_Final?: number;
  uom?: string;
  confidence?: number;
  matchStatus: string;
  resolvedPartNumber?: string;
  isSelected: boolean;
}

export interface IncomingStockLog {
  _id: string;
  intakeBatchId: string;
  timestamp: number;
  user: string;
  poNumber?: string;
  deliveryNumber?: string;
  trackingNumber?: string;
  partNumber: string;
  description: string;
  qtyAdded: number;
  qtyBefore: number;
  qtyAfter: number;
}

export interface AnnualTarget {
  _id: string;
  year: number;
  target: number;
  actual: number;
}

// ─── Supabase → App type mappers ───

function mapStockToPart(row: any): Part {
  const p: Part = {
    _id: row.id,
    partNumber: row.part_number || "",
    description: row.description || "",
    type: row.type || "Required",
    qoh: Number(row.qty_on_hand) || 0,
    minQty: Number(row.min_qty) || 0,
    maxQty: Number(row.max_qty) || 0,
    onPlan: row.on_plan ?? false,
    binLocation: row.bin_location || "",
    module: row.module || "",
    unitCost: Number(row.unit_cost) || 0,
    lastActivity: row.last_activity || row.updated_at,
    status: "",
  };
  p.status = getStatus(p);
  return p;
}

function mapAuditToTransaction(row: any): Transaction {
  const nv = row.new_value || {};
  return {
    _id: row.id,
    timestamp: new Date(row.created_at).getTime(),
    user: row.user_name || "",
    mode: row.action || "",
    partNumber: row.part_number || "",
    description: nv.description || "",
    qty: Number(nv.qty) || 0,
    qtyBefore: Number(nv.qty_before || nv.qtyBefore) || 0,
    qtyAfter: Number(nv.qty_after || nv.qtyAfter) || 0,
    sapStatus: nv.sap_status || "NOT_PUSHED",
    archived: false,
  };
}

function mapUserToEmployee(row: any): Employee {
  return {
    _id: row.id,
    name: row.display_name || row.username || "",
    initials: (row.display_name || row.username || "").split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 2),
    email: row.username,
    active: row.is_active ?? true,
    createdAt: new Date(row.created_at).getTime(),
    role: row.role || "engineer",
  };
}

// ─── Data Context ───

interface ConvexData {
  parts: Part[];
  transactions: Transaction[];
  kits: Kit[];
  sapRecords: SapRecord[];
  cycleSchedules: CycleSchedule[];
  cycleResults: CycleResult[];
  batches: IncomingStockBatch[];
  stockLog: IncomingStockLog[];
  employees: Employee[];
  settings: AppSetting[];
  analyzers: REMAnalyzer[];
  lvccItems: LVCCItem[];
  annualTargets: AnnualTarget[];
  staffMembers: StaffMember[];
  weeklyNotes: WeeklyNoteEntry[];
  weeklyBuildPlan: WeeklyBuildPlan[];
  trackerWeekly: TrackerWeekly[];
  isLoading: boolean;
  error: string | null;
  totalSKUs: number;
  totalQOH: number;
  outCount: number;
  lowCount: number;
  okCount: number;
  overCount: number;
  onPlanCount: number;
  refresh: () => Promise<void>;
  scanPart: (mode: string, partNumber: string, qty: number, user: string, analyzerSerial?: string, batchId?: string) => Promise<unknown>;
  updatePart: (id: string, updates: Record<string, unknown>) => Promise<void>;
  deletePart: (id: string) => Promise<void>;
  createPart: (data: Record<string, unknown>) => Promise<void>;
  markAsReady: (ids: string[]) => Promise<void>;
  markExported: (ids: string[]) => Promise<void>;
  updateSapStatus: (id: string, status: string) => Promise<void>;
  addEmployee: (name: string, initials: string) => Promise<void>;
  updateEmployee: (id: string, updates: { name?: string; initials?: string; email?: string; role?: string }) => Promise<void>;
  toggleEmployeeActive: (id: string, currentlyActive: boolean) => Promise<void>;
  deleteEmployee: (id: string) => Promise<void>;
}

const ConvexDataContext = createContext<ConvexData | null>(null);

export function ConvexDataProvider({ children }: { children: ReactNode }) {
  const [parts, setParts] = useState<Part[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [kits, setKits] = useState<Kit[]>([]);
  const [sapRecords, setSapRecords] = useState<SapRecord[]>([]);
  const [cycleSchedules, setCycleSchedules] = useState<CycleSchedule[]>([]);
  const [cycleResults, setCycleResults] = useState<CycleResult[]>([]);
  const [batches, setBatches] = useState<IncomingStockBatch[]>([]);
  const [stockLog, setStockLog] = useState<IncomingStockLog[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [settings, setSettings] = useState<AppSetting[]>([]);
  const [analyzers, setAnalyzers] = useState<REMAnalyzer[]>([]);
  const [lvccItems, setLvccItems] = useState<LVCCItem[]>([]);
  const [annualTargets, setAnnualTargets] = useState<AnnualTarget[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [weeklyNotes, setWeeklyNotes] = useState<WeeklyNoteEntry[]>([]);
  const [weeklyBuildPlan, setWeeklyBuildPlan] = useState<WeeklyBuildPlan[]>([]);
  const [trackerWeekly, setTrackerWeekly] = useState<TrackerWeekly[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  // Convex action hooks for server-side data access
  const convexListStock = useAction(api.supabaseGateway.listStock);
  const convexListAuditLog = useAction(api.supabaseGateway.listAuditLog);
  const convexListSapStaging = useAction(api.supabaseGateway.listSapStaging);
  const convexListUsers = useAction(api.supabaseGateway.listUsers);
  const convexListSettings = useAction(api.supabaseGateway.listSettings);

  const loadAll = useCallback(async () => {
    if (!hasLoadedOnce.current) setIsLoading(true);
    setError(null);
    try {
      // ─── Inventory reads: prefer Convex actions (server-side, authenticated) ───
      // Falls back to anon Supabase reads if actions fail (e.g., not authenticated yet)
      let stockRows: any[] = [];
      let auditRows: any[] = [];
      let sapRows: any[] = [];
      let userRows: any[] = [];
      let settingsRows: any[] = [];

      try {
        [stockRows, auditRows, sapRows, userRows, settingsRows] = await Promise.all([
          convexListStock(),
          convexListAuditLog(),
          convexListSapStaging(),
          convexListUsers(),
          convexListSettings(),
        ]);
      } catch {
        // Auth may not be ready yet — fall back to anon reads
        [stockRows, auditRows, sapRows, userRows, settingsRows] = await Promise.all([
          sbAnonQuery<any>("stock", "order=part_number.asc"),
          sbAnonQuery<any>("audit_log", "order=created_at.desc&limit=500"),
          sbAnonQuery<any>("sap_staging", "order=created_at.desc"),
          sbAnonQuery<any>("users", "order=display_name.asc"),
          sbAnonQuery<any>("settings").catch(() => [] as any[]),
        ]);
      }

      const mappedParts = stockRows.map(mapStockToPart);
      const mappedTx = auditRows.map(mapAuditToTransaction);
      const mappedEmployees = userRows.map(mapUserToEmployee);
      const mappedSettings: AppSetting[] = (settingsRows || []).map((s: any) => ({
        _id: s.id || s.key,
        key: s.key,
        value: s.value,
      }));
      const mappedSap: SapRecord[] = sapRows.map((s: any) => ({
        _id: s.id,
        txId: s.tx_id,
        timestamp: new Date(s.created_at).getTime(),
        mode: s.mode || "RECEIVE",
        partNumber: s.part_number || "",
        description: s.description || "",
        qty: Number(s.qty) || 0,
        qtyBefore: Number(s.qty_before) || 0,
        qtyAfter: Number(s.qty_after) || 0,
        movementType: s.movement_type || "101",
        plantCode: s.plant_code || "US08",
        storageLocation: s.storage_location || "MAIN",
        status: s.status || "NOT_PUSHED",
        exported: s.exported || false,
      }));

      setParts(mappedParts);
      setTransactions(mappedTx);
      setSapRecords(mappedSap);
      setSettings(mappedSettings);

      // ─── Employees & Kits from Convex production backend ───
      const [convexEmployees, convexKits] = await Promise.all([
        safeConvexQuery<any[]>(CONVEX_URL, "employees:list", []),
        safeConvexQuery<any[]>(CONVEX_URL, "kits:list", []),
      ]);

      if (convexEmployees.length > 0) {
        const mapped: Employee[] = convexEmployees.map((e: any) => ({
          _id: e._id,
          name: e.name || "",
          initials: e.initials || e.name?.split(" ").map((w: string) => w[0]).join("").toUpperCase().slice(0, 3) || "",
          email: e.email || undefined,
          active: e.active ?? true,
          createdAt: e.createdAt || e._creationTime || Date.now(),
          role: e.role || "engineer",
        }));
        setEmployees(mapped);
      } else {
        setEmployees(mappedEmployees);
      }

      const mappedKits: Kit[] = convexKits.map((k: any) => ({
        _id: k._id,
        kitId: k.basePartNumber || k._id,
        name: k.name || "",
        basePartNumber: k.basePartNumber || "",
        revision: k.revision || "1",
        components: (k.components || []).map((c: any) => ({
          partNumber: c.partNumber || "",
          description: c.description || "",
          qtyRequired: c.qtyRequired || 0,
        })),
      }));
      setKits(mappedKits);
      setCycleSchedules([]);
      setCycleResults([]);
      setBatches([]);
      setStockLog([]);

      // ─── Convex queries (REM tracker - read only until migrated) ───
      const [an, lv, at2, sm, wn, wb, tw] = await Promise.all([
        safeConvexQuery<REMAnalyzer[]>(CONVEX_URL, "remAnalyzers:list", []),
        safeConvexQuery<LVCCItem[]>(CONVEX_URL, "remLvcc:list", []),
        safeConvexQuery<AnnualTarget[]>(CONVEX_URL, "remTargets:list", []),
        safeConvexQuery<StaffMember[]>(CONVEX_URL, "remStaffing:getTrainingMatrix", []),
        safeConvexQuery<WeeklyNoteEntry[]>(CONVEX_URL, "remWeeklyNotes:list", []),
        safeConvexQuery<WeeklyBuildPlan[]>(CONVEX_URL, "remBuildPlan:list", []),
        safeConvexQuery<TrackerWeekly[]>(CONVEX_URL, "remTracker:listWeekly", []),
      ]);
      setAnalyzers(an); setLvccItems(lv); setAnnualTargets(at2); setStaffMembers(sm);
      setWeeklyNotes(wn); setWeeklyBuildPlan(wb); setTrackerWeekly(tw);

      const [cs, cr] = await Promise.all([
        safeConvexQuery<CycleSchedule[]>(CYCLE_CONVEX_URL, "cycleCount:listSchedules", []),
        safeConvexQuery<CycleResult[]>(CYCLE_CONVEX_URL, "cycleCount:listResults", []),
      ]);
      setCycleSchedules(cs); setCycleResults(cr);

      hasLoadedOnce.current = true;
      setIsLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
      hasLoadedOnce.current = true;
      setIsLoading(false);
    }
  }, [convexListStock, convexListAuditLog, convexListSapStaging, convexListUsers, convexListSettings]);

  useEffect(() => {
    loadAll();
    const interval = setInterval(loadAll, 15000);
    return () => clearInterval(interval);
  }, [loadAll]);

  const totalSKUs = parts.length;
  const totalQOH = parts.reduce((s, p) => s + p.qoh, 0);
  const outCount = parts.filter(p => p.qoh <= 0).length;
  const lowCount = parts.filter(p => p.qoh > 0 && p.qoh < p.minQty).length;
  const okCount = parts.filter(p => p.qoh >= p.minQty && p.qoh <= p.maxQty).length;
  const overCount = parts.filter(p => p.qoh > p.maxQty).length;
  const onPlanCount = parts.filter(p => p.onPlan).length;

  const refresh = loadAll;

  // ─── Mutations: route through Convex server-side actions ───
  const convexScanStock = useAction(api.inventoryActions.scanStockTransition);
  const convexCreateStock = useAction(api.inventoryActions.createStockItem);
  const convexUpdateStock = useAction(api.inventoryActions.updateStockItem);
  const convexDeleteStock = useAction(api.inventoryActions.deleteStockItem);
  const convexUpdateSapStatus = useAction(api.inventoryActions.updateSapStatus);
  const convexMarkSapReady = useAction(api.inventoryActions.markSapBatchReady);
  const convexMarkSapExported = useAction(api.inventoryActions.markSapBatchExported);
  const convexInsertUser = useAction(api.supabaseGateway.insertUser);
  const convexUpdateUser = useAction(api.supabaseGateway.updateUser);
  const convexDeleteUser = useAction(api.supabaseGateway.deleteUser);

  const scanPart = async (mode: string, partNumber: string, qty: number, user: string, _analyzerSerial?: string, _batchId?: string) => {
    const correlationId = `scan-${partNumber}-${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const result = await convexScanStock({
      partNumber,
      mode: mode as any,
      qty,
      user,
      correlationId,
      analyzerSerial: _analyzerSerial,
      batchId: _batchId,
    });
    debouncedLoadAll();
    return result;
  };

  // Debounced loadAll
  const debouncedLoadAll = useCallback(() => {
    if ((debouncedLoadAll as any)._t) clearTimeout((debouncedLoadAll as any)._t);
    (debouncedLoadAll as any)._t = setTimeout(() => loadAll(), 300);
  }, [loadAll]);

  const updatePart = async (id: string, updates: Record<string, unknown>) => {
    await convexUpdateStock({
      id,
      partNumber: updates.partNumber as string | undefined,
      description: updates.description as string | undefined,
      type: updates.type as string | undefined,
      qtyOnHand: updates.qoh as number | undefined,
      minQty: updates.minQty as number | undefined,
      maxQty: updates.maxQty as number | undefined,
      onPlan: updates.onPlan as boolean | undefined,
      binLocation: updates.binLocation as string | undefined,
      module: updates.module as string | undefined,
      unitCost: updates.unitCost as number | undefined,
    });
    debouncedLoadAll();
  };

  const deletePart = async (id: string) => {
    await convexDeleteStock({ id });
    debouncedLoadAll();
  };

  const createPart = async (data: Record<string, unknown>) => {
    await convexCreateStock({
      partNumber: (data.partNumber || data.part_number) as string,
      description: (data.description as string) || "",
      type: (data.type as string) || "Required",
      qtyOnHand: Number(data.qoh ?? data.qty_on_hand ?? 0),
      minQty: Number(data.minQty ?? data.min_qty ?? data.min ?? 0),
      maxQty: Number(data.maxQty ?? data.max_qty ?? data.max ?? 0),
      onPlan: (data.onPlan ?? data.on_plan) as boolean | undefined,
      binLocation: (data.binLocation ?? data.bin_location) as string | undefined,
      module: data.module as string | undefined,
      unitCost: Number(data.unitCost ?? data.unit_cost ?? 0),
    });
    debouncedLoadAll();
  };

  const markAsReady = async (ids: string[]) => {
    await convexMarkSapReady({ ids });
    debouncedLoadAll();
  };

  const markExported = async (ids: string[]) => {
    await convexMarkSapExported({ ids });
    debouncedLoadAll();
  };

  const updateSapStatusFn = async (id: string, status: string) => {
    await convexUpdateSapStatus({ id, status: status as any });
    debouncedLoadAll();
  };

  const addEmployee = async (name: string, _initials: string) => {
    await convexInsertUser({
      data: {
        username: name.toLowerCase().replace(/\s+/g, "."),
        display_name: name,
        role: "engineer",
        is_active: true,
      },
    });
    debouncedLoadAll();
  };

  const updateEmployee = async (id: string, updates: { name?: string; initials?: string; email?: string; role?: string }) => {
    const mapped: Record<string, unknown> = {};
    if (updates.name !== undefined) mapped.display_name = updates.name;
    if (updates.email !== undefined) mapped.username = updates.email;
    if (updates.role !== undefined) mapped.role = updates.role;
    await convexUpdateUser({ id, data: mapped });
    debouncedLoadAll();
  };

  const toggleEmployeeActive = async (id: string, currentlyActive: boolean) => {
    await convexUpdateUser({ id, data: { is_active: !currentlyActive } });
    debouncedLoadAll();
  };

  const deleteEmployee = async (id: string) => {
    await convexDeleteUser({ id });
    debouncedLoadAll();
  };

  return (
    <ConvexDataContext.Provider value={{
      parts, transactions, kits, sapRecords, cycleSchedules, cycleResults,
      batches, stockLog, employees, settings,
      analyzers, lvccItems, annualTargets, staffMembers, weeklyNotes, weeklyBuildPlan, trackerWeekly,
      isLoading, error,
      totalSKUs, totalQOH, outCount, lowCount, okCount, overCount, onPlanCount,
      refresh, scanPart, updatePart, deletePart, createPart,
      markAsReady, markExported, updateSapStatus: updateSapStatusFn, addEmployee,
      updateEmployee, toggleEmployeeActive, deleteEmployee,
    }}>
      {children}
    </ConvexDataContext.Provider>
  );
}

export function useConvexData() {
  const ctx = useContext(ConvexDataContext);
  if (!ctx) throw new Error("useConvexData must be used within ConvexDataProvider");
  return ctx;
}
