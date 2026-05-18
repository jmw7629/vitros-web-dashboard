import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import type { CycleSchedule, CycleResult, Part } from "../../hooks/useConvexData";
import {
  WebCard,
  DashCard,
  StatusBadge,
  ProgressBar,
  EmptyState,
  Pill,
  theme,
  formatDate,
} from "../../components/vitros/SharedComponents";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

// ─── Constants ───
const FREQUENCIES = ["Single", "Weekly", "Bi-Weekly", "Monthly", "Quarterly"] as const;

// ─── Date helpers (UTC-safe to avoid timezone off-by-one) ───
/** Display a timestamp as a date string using UTC so it never shifts a day */
function fmtDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { timeZone: "UTC" });
}
/** Parse a YYYY-MM-DD string to a noon-UTC timestamp (won't drift across timezone boundaries) */
function parseDate(dateStr: string): number {
  return new Date(dateStr + "T12:00:00Z").getTime();
}

// Cycle count data lives on the deployment that has cycleCount functions
const CYCLE_CONVEX_URL = "https://terrific-snail-972.convex.cloud";

async function cycleQuery<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`${CYCLE_CONVEX_URL}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fn, args, format: "json" }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.status === "success") return json.value as T;
      throw new Error(json.errorMessage || "Query failed");
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error("Query failed after retries");
}

async function cycleMutation<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`${CYCLE_CONVEX_URL}/api/mutation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: fn, args, format: "json" }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.status === "success") return json.value as T;
      throw new Error(json.errorMessage || "Mutation failed");
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw new Error("Mutation failed after retries");
}

// ─── Types ───
interface CountLine {
  partNumber: string;
  description: string;
  systemQty: number;
  countedQty: string;
  wipEntries: Record<string, string>; // SN → qty string (dynamic per instrument)
  incomingQty: string;
  type: string;
  onPlan: boolean;
  minQty: number;
  maxQty: number;
  counted: boolean;        // counted field filled
  incomingCounted: boolean; // Incoming field filled
  allCounted: boolean;     // counted + ALL wip cols filled + incoming filled
}

type CountFilter = "all" | "remaining" | "counted";

// ─── Hook: load cycle data from the cycle-count deployment ───
function useCycleData() {
  const [schedules, setSchedules] = useState<CycleSchedule[]>([]);
  const [results, setResults] = useState<CycleResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasLoadedOnce = useRef(false);

  const load = useCallback(async () => {
    try {
      // Load schedules and results separately — if one fails, we still get the other
      let s: CycleSchedule[] | null = null;
      let r: CycleResult[] | null = null;
      let lastErr = "";
      try { s = await cycleQuery<CycleSchedule[]>("cycleCount:listSchedules"); } catch (e: any) { lastErr = e?.message || "unknown"; }
      try { r = await cycleQuery<CycleResult[]>("cycleCount:listResults"); } catch (e: any) { lastErr = e?.message || "unknown"; }

      if (s !== null) { setSchedules(s); hasLoadedOnce.current = true; }
      if (r !== null) setResults(r);

      // Only show error if we've never loaded data at all
      if (s === null && r === null && !hasLoadedOnce.current) {
        setError(`Load failed: ${lastErr}`);
      } else {
        setError(null);
      }
    } catch (e: any) {
      console.error("Failed to load cycle data:", e);
      if (!hasLoadedOnce.current) setError(`Load failed: ${e?.message || "unknown"}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Gentle background refresh every 30s — never shows errors if we have data
  useEffect(() => {
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [load]);

  return { schedules, results, loading, error, refresh: load };
}

// ─── Main Component ───
export function CycleCount() {
  const data = useConvexData();
  const cycle = useCycleData();
  const [activeTab, setActiveTab] = useState<"schedules" | "active" | "history">("schedules");

  const schedules = cycle.schedules;
  const results = cycle.results;
  const parts = data.parts || [];

  // Active count state
  const [activeSchedule, setActiveSchedule] = useState<CycleSchedule | null>(null);
  const [countLines, setCountLines] = useState<CountLine[]>([]);
  const [wipSerials, setWipSerials] = useState<string[]>([]); // dynamic WIP instrument SNs
  const [sortMode, setSortMode] = useState<"alpha" | "w2w">("alpha");
  const [submitting, setSubmitting] = useState(false);
  const [autoSaveTime, setAutoSaveTime] = useState<string | null>(null);
  const [countFilter, setCountFilter] = useState<CountFilter>("all");
  const [countSearch, setCountSearch] = useState("");

  // New schedule modal
  const [showNewSchedule, setShowNewSchedule] = useState(false);

  // ─── Computed Stats ───
  const now = Date.now();

  const overdueCount = useMemo(
    () => schedules.filter((s) => s.status === "active" && s.nextDue < now).length,
    [schedules, now]
  );

  const completedThisMonth = useMemo(() => {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    return results.filter((r) => r.timestamp >= monthStart.getTime()).length;
  }, [results]);

  // ─── Start Count (loads any previous partial results) ───
  const startCount = useCallback(
    (schedule: CycleSchedule) => {
      // Find the most recent partial result for this schedule to pre-load counts
      const previousPartial = results
        .filter(r => r.scheduleId === schedule._id && r.status === "partial")
        .sort((a, b) => b.timestamp - a.timestamp)[0];

      // Reconstruct previous counts + WIP serial numbers
      const previousCounts = new Map<string, { countedQty: number; wipEntries?: { sn: string; qty: number }[]; incomingQty?: number }>();
      const restoredSerials = new Set<string>();
      if (previousPartial) {
        // First: restore saved wipSerials list (authoritative — includes SNs with no data yet)
        const savedWipSerials = (previousPartial as any).wipSerials as string[] | undefined;
        if (savedWipSerials) savedWipSerials.forEach(sn => restoredSerials.add(sn));
        // Also pick up any SNs from individual result entries (backward compat)
        for (const r of previousPartial.results) {
          const wipArr = (r as any).wipEntries as { sn: string; qty: number }[] | undefined;
          if (wipArr) wipArr.forEach(e => restoredSerials.add(e.sn));
          previousCounts.set(r.partNumber, {
            countedQty: r.countedQty,
            wipEntries: wipArr,
            incomingQty: (r as any).incomingQty,
          });
        }
      }
      const serialsList = Array.from(restoredSerials);

      const lines: CountLine[] = schedule.parts.map((pn) => {
        const part = parts.find((p) => p.partNumber === pn);
        const prev = previousCounts.get(pn);
        // -1 sentinel means "user didn't fill this field"; also handle old data where 0 meant unfilled
        const hasCounted = prev?.countedQty !== undefined && prev.countedQty >= 0;
        const hasIncoming = prev?.incomingQty !== undefined && prev.incomingQty >= 0;

        // Build wipEntries record from previous saved entries
        const wipEntries: Record<string, string> = {};
        for (const sn of serialsList) wipEntries[sn] = ""; // init all
        if (prev?.wipEntries) {
          for (const e of prev.wipEntries) wipEntries[e.sn] = String(e.qty);
        }

        const wipFilled = serialsList.length > 0 && serialsList.every(sn => wipEntries[sn] !== undefined && wipEntries[sn] !== "");
        return {
          partNumber: pn,
          description: part?.description ?? "",
          systemQty: part?.qoh ?? 0,
          countedQty: hasCounted ? String(prev!.countedQty) : "",
          wipEntries,
          incomingQty: hasIncoming ? String(prev!.incomingQty) : "",
          type: part?.type ?? "Not on BOM",
          onPlan: part?.onPlan ?? false,
          minQty: (part as any)?.minQty ?? (part as any)?.min ?? 0,
          maxQty: (part as any)?.maxQty ?? (part as any)?.max ?? 0,
          counted: hasCounted,
          incomingCounted: hasIncoming,
          allCounted: hasCounted && wipFilled && hasIncoming,
        };
      });
      setActiveSchedule(schedule);
      setWipSerials(serialsList);
      setCountLines(lines);
      setSortMode("alpha");
      setCountFilter("all");
      setCountSearch("");
      setAutoSaveTime(null);
      setActiveTab("active");
    },
    [parts, results]
  );

  // ─── Auto-save effect ───
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const hasAnyEntry = countLines.some(l => l.counted || l.incomingCounted || Object.values(l.wipEntries).some(v => v !== ""));
    if (!activeSchedule || !hasAnyEntry) return;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      const now = new Date();
      setAutoSaveTime(now.toLocaleTimeString());
    }, 2000);
    return () => { if (autoSaveRef.current) clearTimeout(autoSaveRef.current); };
  }, [countLines, activeSchedule]);

  // ─── Helper: build results payload with wipEntries ───
  const buildResultsPayload = useCallback((lines: CountLine[]) => {
    return lines
      .filter((l) => l.counted || l.incomingCounted || Object.values(l.wipEntries).some(v => v !== ""))
      .map((l) => ({
        partNumber: l.partNumber,
        systemQty: l.systemQty,
        // Use -1 as sentinel for "user didn't fill this field" so restore can distinguish from real 0
        countedQty: l.counted ? parseInt(l.countedQty, 10) || 0 : -1,
        wipEntries: Object.entries(l.wipEntries)
          .filter(([, v]) => v !== "")
          .map(([sn, qty]) => ({ sn, qty: parseInt(qty, 10) || 0 })),
        incomingQty: l.incomingCounted ? parseInt(l.incomingQty, 10) || 0 : -1,
        variance: (l.counted ? parseInt(l.countedQty, 10) : 0) - l.systemQty,
      }));
  }, []);

  // ─── Save & Exit (update QOH for counted parts, save progress, keep schedule active) ───
  const handleSaveAndExit = useCallback(async () => {
    if (!activeSchedule) return;
    setSubmitting(true);
    try {
      const resultsPayload = buildResultsPayload(countLines);

      if (resultsPayload.length > 0 || wipSerials.length > 0) {
        // Save partial results so the count can be resumed later with green highlights
        // Always include wipSerials so they restore even if no parts have WIP values yet
        await cycleMutation("cycleCount:submitCount", {
          scheduleId: activeSchedule._id,
          countedBy: "Web User",
          results: resultsPayload,
          sortMode: sortMode === "w2w" ? "w2w" : "alphanumeric",
          status: "partial",
          wipSerials: wipSerials,
        });

        // Update QOH in Stock Summary for parts that were actually counted
        // Physical inventory = counted + WIP (all serials) + incoming
        const countedLines = countLines.filter(l => l.counted);
        for (const line of countedLines) {
          const stockPart = parts.find((p) => p.partNumber === line.partNumber);
          if (stockPart && stockPart._id) {
            const counted = parseInt(line.countedQty, 10) || 0;
            const wipTotal = Object.values(line.wipEntries).reduce((sum, v) => sum + (parseInt(v, 10) || 0), 0);
            const incoming = line.incomingCounted ? (parseInt(line.incomingQty, 10) || 0) : 0;
            await data.updatePart(stockPart._id, { qoh: counted + wipTotal + incoming });
          }
        }
      }

      // Schedule stays ACTIVE — user can reopen and resume counting
      // Previously counted parts will show green-highlighted and still be editable
      setActiveSchedule(null);
      setCountLines([]);
      setWipSerials([]);
      setActiveTab("schedules");
      await cycle.refresh();
    } catch (e) {
      console.error("Save & Exit failed:", e);
    } finally {
      setSubmitting(false);
    }
  }, [activeSchedule, countLines, sortMode, cycle, parts, data, buildResultsPayload]);

  // ─── Confirm & Close (update QOH for counted parts, close the schedule) ───
  const handleConfirmAndClose = useCallback(async () => {
    if (!activeSchedule) return;
    setSubmitting(true);
    try {
      const resultsPayload = buildResultsPayload(countLines);

      // Submit the final count results
      await cycleMutation("cycleCount:submitCount", {
        scheduleId: activeSchedule._id,
        countedBy: "Web User",
        results: resultsPayload,
        sortMode: sortMode === "w2w" ? "w2w" : "alphanumeric",
        wipSerials: wipSerials,
      });

      // Update QOH in Stock Summary ONLY for parts that were actually counted
      // Physical inventory = counted + WIP (all serials) + incoming
      // Uncounted parts keep their existing QOH
      for (const r of resultsPayload) {
        if (r.countedQty !== undefined && r.countedQty >= 0) {
          const stockPart = parts.find((p) => p.partNumber === r.partNumber);
          if (stockPart && stockPart._id) {
            const wipTotal = (r.wipEntries || []).reduce((sum: number, w: { sn: string; qty: number }) => sum + (w.qty || 0), 0);
            const incoming = (r.incomingQty !== undefined && r.incomingQty >= 0) ? r.incomingQty : 0;
            await data.updatePart(stockPart._id, { qoh: r.countedQty + wipTotal + incoming });
          }
        }
      }

      // Mark schedule as completed — no longer shows as active
      await cycleMutation("cycleCount:updateSchedule", {
        id: activeSchedule._id,
        status: "completed",
      });

      setActiveSchedule(null);
      setCountLines([]);
      setWipSerials([]);
      setActiveTab("schedules");
      await cycle.refresh();
    } catch (e) {
      console.error("Confirm & Close failed:", e);
    } finally {
      setSubmitting(false);
    }
  }, [activeSchedule, countLines, sortMode, cycle, parts, data, buildResultsPayload]);

  // ─── Sort & Filter Lines ───
  const sortedAndFilteredLines = useMemo(() => {
    let lines = [...countLines];

    // Search filter
    if (countSearch) {
      const q = countSearch.toLowerCase();
      lines = lines.filter(l =>
        l.partNumber.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q)
      );
    }

    // Count filter — "counted" = all 3 fields filled, "remaining" = at least 1 missing
    if (countFilter === "counted") {
      lines = lines.filter(l => l.allCounted);
    } else if (countFilter === "remaining") {
      lines = lines.filter(l => !l.allCounted);
    }

    // Sort — W2W: Required parts first (alpha), then all other types commingled (alpha)
    if (sortMode === "w2w") {
      const required = lines
        .filter((l) => (l.type || "").toLowerCase() === "required")
        .sort((a, b) => a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true }));
      const remaining = lines
        .filter((l) => (l.type || "").toLowerCase() !== "required")
        .sort((a, b) => a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true }));
      return [...required, ...remaining];
    }

    return lines.sort((a, b) =>
      a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true })
    );
  }, [countLines, sortMode, countFilter, countSearch]);

  const countedCount = countLines.filter(l => l.counted).length;
  const incomingCount = countLines.filter(l => l.incomingCounted).length;
  const allCountedCount = countLines.filter(l => l.allCounted).length;
  const remainingCount = countLines.filter(l => !l.allCounted).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>
            Cycle Count
          </h2>
          <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>
            Schedule and execute inventory counts
          </p>
        </div>
      </div>

      {/* Connection error banner */}
      {cycle.error && (
        <div className="px-4 py-3 rounded-xl text-sm font-bold"
          style={{ backgroundColor: "#ef444420", color: "#ef4444", border: "1px solid #ef444440" }}>
          <div className="flex items-center gap-2">
            <span>⚠️ {cycle.error}</span>
            <button onClick={cycle.refresh} className="ml-auto px-3 py-1 rounded-lg text-xs font-bold"
              style={{ backgroundColor: "#ef4444", color: "white" }}>Retry</button>
          </div>
          <button onClick={async () => {
            try {
              const r = await fetch(`${CYCLE_CONVEX_URL}/api/query`, {
                method: "POST", headers: {"Content-Type":"application/json"},
                body: JSON.stringify({path:"cycleCount:listSchedules",args:{},format:"json"})
              });
              const t = await r.text();
              alert(`Status: ${r.status}\nBody: ${t.substring(0, 200)}`);
            } catch (e: any) {
              alert(`Fetch error: ${e?.name}: ${e?.message}`);
            }
          }} className="mt-2 text-xs underline opacity-70">Test Connection</button>
        </div>
      )}

      {/* Tab Pills */}
      <div className="flex gap-2">
        <Pill label="Schedules" active={activeTab === "schedules"} onClick={() => setActiveTab("schedules")} />
        <Pill label="Active Counts" active={activeTab === "active"} onClick={() => setActiveTab("active")} />
        <Pill label="History & Variance" active={activeTab === "history"} onClick={() => setActiveTab("history")} />
      </div>

      {/* ═══════════════════ SCHEDULES TAB ═══════════════════ */}
      {activeTab === "schedules" && (
        <SchedulesTab
          schedules={schedules}
          overdueCount={overdueCount}
          completedThisMonth={completedThisMonth}
          now={now}
          onStartCount={startCount}
          onNewSchedule={() => setShowNewSchedule(true)}
          onDeleteSchedule={async (id) => {
            try {
              await cycleMutation("cycleCount:deleteSchedule", { id });
              await cycle.refresh();
            } catch (e) {
              console.warn("Delete failed:", e);
            }
          }}
          onReopenSchedule={async (id) => {
            try {
              await cycleMutation("cycleCount:updateSchedule", { id, status: "active" });
              await cycle.refresh();
            } catch (e) {
              console.warn("Reopen failed:", e);
            }
          }}
          onEditSchedule={async (id, updates) => {
            try {
              await cycleMutation("cycleCount:updateSchedule", { id, ...updates });
              await cycle.refresh();
            } catch (e) {
              console.warn("Edit schedule failed:", e);
            }
          }}
          parts={parts}
        />
      )}

      {/* ═══════════════════ ACTIVE COUNTS TAB ═══════════════════ */}
      {activeTab === "active" && (
        activeSchedule ? (
          <ActiveCountView
            schedule={activeSchedule}
            lines={sortedAndFilteredLines}
            allLines={countLines}
            wipSerials={wipSerials}
            sortMode={sortMode}
            setSortMode={setSortMode}
            countFilter={countFilter}
            setCountFilter={setCountFilter}
            countSearch={countSearch}
            setCountSearch={setCountSearch}
            countedCount={countedCount}
            incomingCount={incomingCount}
            allCountedCount={allCountedCount}
            remainingCount={remainingCount}
            autoSaveTime={autoSaveTime}
            submitting={submitting}
            onUpdateLine={(partNumber, field, value) => {
              setCountLines(prev =>
                prev.map(l => {
                  if (l.partNumber !== partNumber) return l;
                  const updated = { ...l, wipEntries: { ...l.wipEntries } };
                  if (field === "counted") {
                    updated.countedQty = value;
                    updated.counted = value !== "";
                  } else if (field.startsWith("wip:")) {
                    const sn = field.slice(4);
                    updated.wipEntries[sn] = value;
                  } else if (field === "incoming") {
                    updated.incomingQty = value;
                    updated.incomingCounted = value !== "";
                  }
                  const wipFilled = wipSerials.length === 0 || wipSerials.every(sn => updated.wipEntries[sn] !== undefined && updated.wipEntries[sn] !== "");
                  updated.allCounted = updated.counted && wipFilled && updated.incomingCounted;
                  return updated;
                })
              );
            }}
            onAddWipSerial={(sn: string) => {
              if (wipSerials.includes(sn)) return;
              setWipSerials(prev => [...prev, sn]);
              setCountLines(prev => prev.map(l => ({
                ...l,
                wipEntries: { ...l.wipEntries, [sn]: "" },
                allCounted: false, // new column means not fully counted
              })));
            }}
            onRemoveWipSerial={(sn: string) => {
              const newSerials = wipSerials.filter(s => s !== sn);
              setWipSerials(newSerials);
              setCountLines(prev => prev.map(l => {
                const entries = { ...l.wipEntries };
                delete entries[sn];
                const wipFilled = newSerials.length === 0 || newSerials.every(s => entries[s] !== undefined && entries[s] !== "");
                return { ...l, wipEntries: entries, allCounted: l.counted && wipFilled && l.incomingCounted };
              }));
            }}
            onRenameWipSerial={(oldSN: string, newSN: string) => {
              const upper = newSN.toUpperCase().trim();
              if (!upper || upper === oldSN || wipSerials.includes(upper)) return;
              setWipSerials(prev => prev.map(s => s === oldSN ? upper : s));
              setCountLines(prev => prev.map(l => {
                const entries = { ...l.wipEntries };
                const val = entries[oldSN];
                delete entries[oldSN];
                entries[upper] = val ?? "";
                return { ...l, wipEntries: entries };
              }));
            }}
            onSaveAndExit={handleSaveAndExit}
            onConfirmAndClose={handleConfirmAndClose}
          />
        ) : (
          <EmptyState icon="🔢" title="No active count" message="Start a count from the Schedules tab" />
        )
      )}

      {/* ═══════════════════ HISTORY TAB ═══════════════════ */}
      {activeTab === "history" && (
        <HistoryTab results={results} schedules={schedules} onDeleteResult={async (id: string) => {
            try {
              await cycleMutation("cycleCount:deleteResult", { id });
              await cycle.refresh();
            } catch (e) { console.warn("Delete result failed:", e); }
          }} />
      )}

      {/* ═══════════════════ NEW SCHEDULE MODAL ═══════════════════ */}
      {showNewSchedule && (
        <NewScheduleModal
          parts={parts}
          onClose={() => setShowNewSchedule(false)}
          onCreated={() => {
            setShowNewSchedule(false);
            cycle.refresh();
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SCHEDULES TAB
// ═══════════════════════════════════════════════════════════════
function SchedulesTab({
  schedules, overdueCount, completedThisMonth, now,
  onStartCount, onNewSchedule, onDeleteSchedule, onReopenSchedule, onEditSchedule, parts,
}: {
  schedules: CycleSchedule[];
  overdueCount: number;
  completedThisMonth: number;
  now: number;
  onStartCount: (s: CycleSchedule) => void;
  onNewSchedule: () => void;
  onDeleteSchedule: (id: string) => void;
  onReopenSchedule: (id: string) => void;
  onEditSchedule: (id: string, updates: Record<string, unknown>) => void;
  parts: Part[];
}) {
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmDeleteSchedule = schedules.find(s => s._id === confirmDeleteId);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; frequency: string; assignedTo: string; nextDue: string; parts: Set<string> }>({
    name: "", frequency: "Weekly", assignedTo: "", nextDue: "", parts: new Set(),
  });
  const [editSearch, setEditSearch] = useState("");

  const openEdit = (s: CycleSchedule) => {
    setEditingId(s._id);
    setEditForm({
      name: s.name,
      frequency: s.frequency,
      assignedTo: s.assignedTo,
      nextDue: new Date(s.nextDue).toISOString().slice(0, 10),
      parts: new Set(s.parts),
    });
    setEditSearch("");
  };

  const saveEdit = () => {
    if (!editingId) return;
    onEditSchedule(editingId, {
      name: editForm.name,
      frequency: editForm.frequency,
      assignedTo: editForm.assignedTo,
      nextDue: parseDate(editForm.nextDue),
      parts: Array.from(editForm.parts),
    });
    setEditingId(null);
  };

  // ─── Excel Export ───
  const exportToExcel = (s: CycleSchedule) => {
    const wb = XLSX.utils.book_new();
    // Header info rows
    const header = [
      ["Schedule:", s.name],
      ["Frequency:", s.frequency],
      ["Assigned To:", s.assignedTo],
      ["Due Date:", fmtDate(s.nextDue)],
      ["Status:", s.status.toUpperCase()],
      ["Total Parts:", s.parts.length],
      [],
    ];
    // Column headers matching on-screen layout
    const colHeaders = ["Part #", "Description", "Type", "System QOH", "Counted", "WIP", "Incoming", "Variance", "Min", "Max"];
    // Part rows
    const rows = s.parts.map(pn => {
      const part = parts.find(p => p.partNumber === pn);
      const nType = (!part?.type || part.type === "0" || part.type === "") ? "Not on BOM" : part.type;
      return [
        pn,
        part?.description ?? "",
        nType,
        part?.qoh ?? 0,
        "", // Counted — blank for manual entry
        "", // WIP — blank
        "", // Incoming — blank
        "", // Variance — formula will go here
        (part as any)?.minQty ?? (part as any)?.min ?? 0,
        (part as any)?.maxQty ?? (part as any)?.max ?? 0,
      ];
    });
    const sheetData = [...header, colHeaders, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);

    // Column widths matching on-screen proportions
    ws["!cols"] = [
      { wch: 12 }, // Part #
      { wch: 35 }, // Description
      { wch: 14 }, // Type
      { wch: 12 }, // System QOH
      { wch: 12 }, // Counted
      { wch: 12 }, // WIP
      { wch: 12 }, // Incoming
      { wch: 12 }, // Variance
      { wch: 8 },  // Min
      { wch: 8 },  // Max
    ];

    // Add Variance formulas: =E{row}-D{row} for each data row
    const dataStartRow = header.length + 1 + 1; // 1-indexed, after header + colHeaders
    for (let i = 0; i < rows.length; i++) {
      const r = dataStartRow + i;
      const cell = XLSX.utils.encode_cell({ r: r - 1, c: 7 }); // H column (Variance)
      ws[cell] = { t: "n", f: `E${r}-D${r}` };
    }

    XLSX.utils.book_append_sheet(wb, ws, "Cycle Count");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    saveAs(blob, `${s.name.replace(/[^a-zA-Z0-9]/g, "_")}_CycleCount.xlsx`);
  };

  const editFilteredParts = useMemo(() => {
    if (!editSearch) return parts;
    const q = editSearch.toLowerCase();
    return parts.filter(p => p.partNumber.toLowerCase().includes(q) || (p.description ?? "").toLowerCase().includes(q));
  }, [parts, editSearch]);

  return (
    <div className="space-y-4">
      {/* Delete Confirmation Modal */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setConfirmDeleteId(null)}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border shadow-2xl" style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder }}
            onClick={e => e.stopPropagation()}>
            <div className="p-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto" style={{ backgroundColor: "#ef444420" }}>
                <span className="text-xl">⚠️</span>
              </div>
              <h3 className="text-lg font-bold" style={{ color: theme.textPrimary }}>Are you sure?</h3>
              <p className="text-sm" style={{ color: theme.textSecondary }}>
                This will permanently delete schedule{confirmDeleteSchedule ? ` "${confirmDeleteSchedule.name}"` : ""}.
              </p>
            </div>
            <div className="flex gap-2 p-4 border-t" style={{ borderColor: theme.cardBorder }}>
              <button onClick={() => setConfirmDeleteId(null)} className="flex-1 py-2.5 rounded-xl text-sm font-bold border"
                style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>Cancel</button>
              <button onClick={() => { onDeleteSchedule(confirmDeleteId); setConfirmDeleteId(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: "#ef4444" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Schedule Modal ── */}
      {editingId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setEditingId(null)}>
          <div className="w-full max-w-lg mx-4 rounded-2xl border shadow-2xl max-h-[90vh] overflow-y-auto"
            style={{ backgroundColor: theme.cardBg, borderColor: theme.cardBorder }}
            onClick={e => e.stopPropagation()}>
            <div className="p-6 space-y-4">
              <h3 className="text-lg font-bold" style={{ color: theme.textPrimary }}>✏️ Edit Schedule</h3>

              {/* Name */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: theme.textMuted }}>Name</label>
                <input className="w-full px-3 py-2 rounded-xl border text-sm" style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textPrimary }}
                  value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
              </div>

              {/* Frequency */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: theme.textMuted }}>Frequency</label>
                <select className="w-full px-3 py-2 rounded-xl border text-sm" style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textPrimary }}
                  value={editForm.frequency} onChange={e => setEditForm(p => ({ ...p, frequency: e.target.value }))}>
                  {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>

              {/* Assigned To */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: theme.textMuted }}>Assigned To</label>
                <input className="w-full px-3 py-2 rounded-xl border text-sm" style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textPrimary }}
                  value={editForm.assignedTo} onChange={e => setEditForm(p => ({ ...p, assignedTo: e.target.value }))} />
              </div>

              {/* Due Date */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: theme.textMuted }}>Due Date</label>
                <input type="date" className="w-full px-3 py-2 rounded-xl border text-sm" style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textPrimary }}
                  value={editForm.nextDue} onChange={e => setEditForm(p => ({ ...p, nextDue: e.target.value }))} />
              </div>

              {/* Parts Selection */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: theme.textMuted }}>
                  Parts ({editForm.parts.size} selected)
                </label>
                <input className="w-full px-3 py-2 rounded-xl border text-sm mb-2" style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textPrimary }}
                  placeholder="Search parts..." value={editSearch} onChange={e => setEditSearch(e.target.value)} />
                <div className="flex gap-2 mb-2">
                  <button onClick={() => setEditForm(p => ({ ...p, parts: new Set(parts.map(pt => pt.partNumber)) }))}
                    className="text-[10px] px-2 py-1 rounded-lg font-bold" style={{ backgroundColor: `${theme.accentBlue}20`, color: theme.accentBlue }}>Select All</button>
                  <button onClick={() => setEditForm(p => ({ ...p, parts: new Set() }))}
                    className="text-[10px] px-2 py-1 rounded-lg font-bold" style={{ backgroundColor: `${theme.statusOut}20`, color: theme.statusOut }}>Clear All</button>
                </div>
                <div className="max-h-48 overflow-y-auto rounded-xl border" style={{ borderColor: theme.cardBorder }}>
                  {editFilteredParts.map(p => (
                    <label key={p.partNumber} className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/5 text-xs" style={{ color: theme.textPrimary }}>
                      <input type="checkbox" checked={editForm.parts.has(p.partNumber)}
                        onChange={() => {
                          setEditForm(prev => {
                            const next = new Set(prev.parts);
                            if (next.has(p.partNumber)) next.delete(p.partNumber); else next.add(p.partNumber);
                            return { ...prev, parts: next };
                          });
                        }} />
                      <span className="font-medium" style={{ color: "#3b82f6" }}>{p.partNumber}</span>
                      <span className="truncate" style={{ color: theme.textSecondary }}>{p.description}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex gap-2 p-4 border-t" style={{ borderColor: theme.cardBorder }}>
              <button onClick={() => setEditingId(null)} className="flex-1 py-2.5 rounded-xl text-sm font-bold border"
                style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>Cancel</button>
              <button onClick={saveEdit} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: theme.accentBlue }}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {/* Calendar */}
      <CycleCalendar
        year={calendarMonth.year}
        month={calendarMonth.month}
        schedules={schedules}
        now={now}
        onPrev={() => setCalendarMonth(p => { const d = new Date(p.year, p.month - 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
        onNext={() => setCalendarMonth(p => { const d = new Date(p.year, p.month + 1); return { year: d.getFullYear(), month: d.getMonth() }; })}
        onToday={() => { const d = new Date(); setCalendarMonth({ year: d.getFullYear(), month: d.getMonth() }); }}
      />

      {/* All Schedules Table */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>All Schedules</h3>
        <button
          onClick={onNewSchedule}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold text-white"
          style={{ backgroundColor: theme.accentBlue }}
        >
          + Create New Schedule
        </button>
      </div>

      {schedules.length === 0 ? (
        <EmptyState icon="📅" title="No schedules" message="Create a cycle count schedule to get started" />
      ) : (
        <WebCard className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: "700px" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.cardBorder}`, backgroundColor: theme.navBg }}>
                  {["NAME", "FREQUENCY", "ASSIGNED TO", "DUE DATE", "STATUS", "PARTS", "ACTIONS"].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.textMuted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {schedules
                  .sort((a, b) => a.nextDue - b.nextDue)
                  .map(s => {
                    const isOverdue = s.status === "active" && s.nextDue < now;
                    const isCompleted = s.status === "completed";
                    const freqColor = s.frequency === "Single" ? "#8b5cf6" : s.frequency === "Weekly" ? "#3b82f6" : s.frequency === "Monthly" ? "#f59e0b" : theme.textSecondary;
                    return (
                      <tr key={s._id} style={{
                        borderBottom: `1px solid ${theme.cardBorder}`,
                        backgroundColor: isOverdue ? `${theme.statusOut}11` : undefined,
                      }}>
                        {/* NAME */}
                        <td className="px-3 py-3">
                          <span className="text-sm font-semibold" style={{ color: theme.textPrimary }}>{s.name}</span>
                        </td>
                        {/* FREQUENCY */}
                        <td className="px-3 py-3">
                          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold" style={{ backgroundColor: `${freqColor}20`, color: freqColor }}>
                            {s.frequency}
                          </span>
                        </td>
                        {/* ASSIGNED TO */}
                        <td className="px-3 py-3">
                          <span className="text-sm" style={{ color: theme.textSecondary }}>{s.assignedTo || "—"}</span>
                        </td>
                        {/* DUE DATE */}
                        <td className="px-3 py-3">
                          <span className="text-sm font-medium" style={{ color: isOverdue ? theme.statusOut : theme.textPrimary }}>
                            {fmtDate(s.nextDue)}
                          </span>
                        </td>
                        {/* STATUS */}
                        <td className="px-3 py-3">
                          <StatusBadge
                            text={isCompleted ? "COMPLETED" : isOverdue ? "OVERDUE" : "SCHEDULED"}
                            color={isCompleted ? theme.accentBlue : isOverdue ? theme.statusOut : theme.statusOk}
                          />
                        </td>
                        {/* PARTS */}
                        <td className="px-3 py-3">
                          <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>{s.parts.length}</span>
                        </td>
                        {/* ACTIONS */}
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1.5">
                            {/* Edit */}
                            <button onClick={() => openEdit(s)}
                              className="w-8 h-8 rounded-lg flex items-center justify-center border" style={{ borderColor: theme.cardBorder }} title="Edit">
                              <span className="text-sm">✏️</span>
                            </button>
                            {/* Export Excel */}
                            <button onClick={() => exportToExcel(s)}
                              className="w-8 h-8 rounded-lg flex items-center justify-center border" style={{ borderColor: theme.cardBorder }} title="Export Excel">
                              <span className="text-sm">📥</span>
                            </button>
                            {/* Start Count */}
                            {!isCompleted && (
                              <button onClick={() => onStartCount(s)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: theme.statusOk }} title="Start Count">
                                <span className="text-white text-sm">▶</span>
                              </button>
                            )}
                            {/* Reopen */}
                            {isCompleted && (
                              <button onClick={() => onReopenSchedule(s._id)}
                                className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: "#f59e0b" }} title="Reopen">
                                <span className="text-white text-sm">↩</span>
                              </button>
                            )}
                            {/* Delete */}
                            <button onClick={() => setConfirmDeleteId(s._id)}
                              className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: theme.statusOut }} title="Delete">
                              <span className="text-white text-sm">🗑</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </WebCard>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CALENDAR
// ═══════════════════════════════════════════════════════════════
function CycleCalendar({
  year, month, schedules, now, onPrev, onNext, onToday,
}: {
  year: number; month: number; schedules: CycleSchedule[];
  now: number; onPrev: () => void; onNext: () => void; onToday: () => void;
}) {
  const monthName = new Date(year, month).toLocaleString("default", { month: "long", year: "numeric" });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();
  const todayDate = today.getFullYear() === year && today.getMonth() === month ? today.getDate() : -1;

  const scheduleDays = useMemo(() => {
    const map: Record<number, { overdue: boolean; scheduled: boolean; completed: boolean }> = {};
    for (const s of schedules) {
      const d = new Date(s.nextDue);
      if (d.getUTCFullYear() === year && d.getUTCMonth() === month) {
        const day = d.getUTCDate();
        if (!map[day]) map[day] = { overdue: false, scheduled: false, completed: false };
        if (s.status === "completed") map[day].completed = true;
        else if (s.nextDue < now) map[day].overdue = true;
        else map[day].scheduled = true;
      }
    }
    return map;
  }, [schedules, year, month, now]);

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <WebCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>📅 {monthName}</span>
        <div className="flex items-center gap-2">
          <button onClick={onToday} className="text-xs font-semibold px-2 py-1 rounded" style={{ color: theme.accentBlue }}>Today</button>
          <button onClick={onPrev} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: theme.cardBorder }}>
            <span style={{ color: theme.textPrimary }}>‹</span>
          </button>
          <button onClick={onNext} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: theme.cardBorder }}>
            <span style={{ color: theme.textPrimary }}>›</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 mb-1">
        {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map(d => (
          <div key={d} className="text-center text-[9px] font-bold py-1" style={{ color: theme.textMuted }}>{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, i) => {
          const info = day ? scheduleDays[day] : null;
          const isToday = day === todayDate;
          return (
            <div key={i} className="aspect-square flex flex-col items-center justify-center rounded-lg"
              style={{ backgroundColor: isToday ? `${theme.accentBlue}22` : undefined }}>
              {day && (
                <>
                  <span className="text-xs font-medium" style={{ color: isToday ? theme.accentBlue : theme.textSecondary }}>{day}</span>
                  {info && (
                    <div className="flex gap-0.5 mt-0.5">
                      {info.overdue && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.statusOut }} />}
                      {info.scheduled && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.statusOk }} />}
                      {info.completed && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: theme.accentBlue }} />}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-4 mt-3 justify-center">
        {[
          { color: theme.statusOut, label: "Overdue" },
          { color: theme.accentBlue, label: "Today" },
          { color: theme.statusOk, label: "Scheduled" },
          { color: theme.accentBlue, label: "Completed" },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: l.color }} />
            <span className="text-[10px]" style={{ color: theme.textMuted }}>{l.label}</span>
          </div>
        ))}
      </div>
    </WebCard>
  );
}

// ═══════════════════════════════════════════════════════════════
// ACTIVE COUNT VIEW — Two buttons: Save & Exit / Confirm & Close
// ═══════════════════════════════════════════════════════════════
function ActiveCountView({
  schedule, lines, allLines, wipSerials, sortMode, setSortMode,
  countFilter, setCountFilter, countSearch, setCountSearch,
  countedCount, incomingCount, allCountedCount, remainingCount,
  autoSaveTime, submitting,
  onUpdateLine, onAddWipSerial, onRemoveWipSerial, onRenameWipSerial, onSaveAndExit, onConfirmAndClose,
}: {
  schedule: CycleSchedule;
  lines: CountLine[];
  allLines: CountLine[];
  wipSerials: string[];
  sortMode: "alpha" | "w2w";
  setSortMode: (m: "alpha" | "w2w") => void;
  countFilter: CountFilter;
  setCountFilter: (f: CountFilter) => void;
  countSearch: string;
  setCountSearch: (s: string) => void;
  countedCount: number;
  incomingCount: number;
  allCountedCount: number;
  remainingCount: number;
  autoSaveTime: string | null;
  submitting: boolean;
  onUpdateLine: (partNumber: string, field: string, value: string) => void;
  onAddWipSerial: (sn: string) => void;
  onRemoveWipSerial: (sn: string) => void;
  onRenameWipSerial: (oldSN: string, newSN: string) => void;
  onSaveAndExit: () => void;
  onConfirmAndClose: () => void;
}) {
  const totalParts = allLines.length;
  const [isFullScreen, setIsFullScreen] = useState(true);
  const [showAddSN, setShowAddSN] = useState(false);
  const [newSN, setNewSN] = useState("");
  const [confirmRemoveSN, setConfirmRemoveSN] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState("");
  const [displayName, setDisplayName] = useState(schedule.name);
  const [editingWipSN, setEditingWipSN] = useState<string | null>(null);
  const [editWipSNValue, setEditWipSNValue] = useState("");
  const [showEditPanel, setShowEditPanel] = useState(false);
  const [editFields, setEditFields] = useState({
    name: schedule.name,
    frequency: schedule.frequency,
    assignedTo: schedule.assignedTo,
    nextDue: new Date(schedule.nextDue).toISOString().slice(0, 10),
  });

  // Dynamic grid: Part# | Desc | Type | SysQOH | Counted | [WIP SN1] [WIP SN2] ... | Incoming | Var | Min | Max
  const wipColCount = wipSerials.length;
  const wipCols = wipSerials.map(() => "80px").join(" ");
  const gridCols = `90px minmax(120px, 2fr) 80px 70px 80px ${wipCols}${wipColCount > 0 ? " " : ""}80px 60px 60px 60px 36px`;
  const minW = 856 + wipColCount * 80;

  const handleAddSN = () => {
    const sn = newSN.trim().toUpperCase();
    if (sn) {
      onAddWipSerial(sn);
      setNewSN("");
      setShowAddSN(false);
    }
  };

  return (
    <div className={isFullScreen ? "fixed inset-0 z-50 overflow-y-auto" : "space-y-4"}
      style={isFullScreen ? { backgroundColor: theme.pageBg, padding: "16px" } : undefined}>
      <div className={isFullScreen ? "space-y-4 max-w-full" : ""}>
      {/* ── Header Card ── */}
      <WebCard className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-lg">✅</span>
          <div className="flex-1">
            {editingName ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  type="text"
                  value={editNameValue}
                  onChange={e => setEditNameValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") {
                      const trimmed = editNameValue.trim();
                      if (trimmed && trimmed !== displayName) {
                        cycleMutation("cycleCount:updateSchedule", { id: schedule._id, name: trimmed }).catch(() => {});
                        setDisplayName(trimmed);
                      }
                      setEditingName(false);
                    } else if (e.key === "Escape") { setEditingName(false); }
                  }}
                  onBlur={() => {
                    const trimmed = editNameValue.trim();
                    if (trimmed && trimmed !== displayName) {
                      cycleMutation("cycleCount:updateSchedule", { id: schedule._id, name: trimmed }).catch(() => {});
                      setDisplayName(trimmed);
                    }
                    setEditingName(false);
                  }}
                  className="text-base font-bold px-2 py-0.5 rounded-lg border focus:outline-none focus:ring-2"
                  style={{ backgroundColor: theme.inputBg, borderColor: theme.accentBlue, color: theme.textPrimary, width: "100%" }}
                />
              </div>
            ) : (
              <h3 className="text-base font-bold cursor-pointer hover:opacity-70 flex items-center gap-1.5"
                style={{ color: theme.textPrimary }}
                onClick={() => { setEditNameValue(displayName); setEditingName(true); }}
                title="Tap to rename"
              >
                {displayName}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
                </svg>
              </h3>
            )}
            <span className="text-xs" style={{ color: theme.textSecondary }}>{totalParts} parts</span>
          </div>
          <button
            onClick={() => { setShowEditPanel(!showEditPanel); if (!showEditPanel) setEditFields({ name: displayName, frequency: schedule.frequency, assignedTo: schedule.assignedTo, nextDue: new Date(schedule.nextDue).toISOString().slice(0, 10) }); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors"
            style={{
              borderColor: showEditPanel ? "#f59e0b" : theme.cardBorder,
              backgroundColor: showEditPanel ? "#f59e0b15" : theme.cardBg,
              color: showEditPanel ? "#f59e0b" : theme.textSecondary,
            }}
          >
            ✏️ Edit
          </button>
          <button
            onClick={() => setIsFullScreen(!isFullScreen)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-colors"
            style={{
              borderColor: isFullScreen ? theme.accentBlue : theme.cardBorder,
              backgroundColor: isFullScreen ? `${theme.accentBlue}15` : theme.cardBg,
              color: isFullScreen ? theme.accentBlue : theme.textSecondary,
            }}
          >
            {isFullScreen ? "⬜ Shrink" : "⬛ Expand"}
          </button>
        </div>

        {/* ── Inline Edit Panel ── */}
        {showEditPanel && (
          <div className="mt-3 p-3 rounded-xl border" style={{ borderColor: "#f59e0b44", backgroundColor: `${theme.cardBg}` }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: theme.textMuted }}>Schedule Name</label>
                <input type="text" value={editFields.name}
                  onChange={e => setEditFields(p => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2"
                  style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textPrimary }} />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: theme.textMuted }}>Frequency</label>
                <select value={editFields.frequency}
                  onChange={e => setEditFields(p => ({ ...p, frequency: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2"
                  style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textPrimary }}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="biweekly">Biweekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annually">Annually</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: theme.textMuted }}>Assigned To</label>
                <input type="text" value={editFields.assignedTo}
                  onChange={e => setEditFields(p => ({ ...p, assignedTo: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2"
                  style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textPrimary }} />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: theme.textMuted }}>Next Due Date</label>
                <input type="date" value={editFields.nextDue}
                  onChange={e => setEditFields(p => ({ ...p, nextDue: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2"
                  style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textPrimary }} />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  try {
                    await cycleMutation("cycleCount:updateSchedule", {
                      id: schedule._id,
                      name: editFields.name.trim(),
                      frequency: editFields.frequency,
                      assignedTo: editFields.assignedTo.trim(),
                      nextDue: parseDate(editFields.nextDue),
                    });
                    setDisplayName(editFields.name.trim());
                    schedule.name = editFields.name.trim();
                    schedule.frequency = editFields.frequency;
                    schedule.assignedTo = editFields.assignedTo.trim();
                    schedule.nextDue = parseDate(editFields.nextDue);
                    setShowEditPanel(false);
                  } catch (e) { console.error("Failed to save schedule:", e); }
                }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: "#22c55e" }}>
                💾 Save Changes
              </button>
              <button onClick={() => setShowEditPanel(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-bold border"
                style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {autoSaveTime && (
          <div className="text-xs mb-3" style={{ color: theme.statusOk }}>
            Auto-saved {autoSaveTime}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 flex-wrap">
          <button onClick={onSaveAndExit} disabled={submitting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: "#22c55e" }}>
            {submitting ? "Saving..." : "✅ Save & Exit"}
          </button>
          <button onClick={onConfirmAndClose} disabled={submitting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: "#ef4444" }}>
            {submitting ? "Confirming..." : "Confirm & Close"}
          </button>
        </div>

        {/* Progress */}
        <div className="mt-3">
          <ProgressBar value={allCountedCount} maxValue={totalParts} color={theme.statusOk} height={6} />
          <span className="text-[10px] mt-1 block font-bold" style={{ color: theme.statusOk }}>
            {allCountedCount}/{totalParts} fully counted • {remainingCount} remaining
          </span>
        </div>

        <div className="mt-2">
          <span className="text-[10px] px-2 py-1 rounded-md" style={{ backgroundColor: `${theme.accentBlue}20`, color: theme.accentBlue }}>
            📦 Counted: {countedCount}/{totalParts}
          </span>
        </div>

        {/* ── WIP Instruments (serial number pills + add button) ── */}
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.textMuted }}>🔧 WIP Instruments:</span>
          {wipSerials.map(sn => (
            <span key={sn} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold"
              style={{ backgroundColor: "#f59e0b22", color: "#f59e0b", border: "1px solid #f59e0b44" }}>
              <button onClick={() => { setEditingWipSN(sn); setEditWipSNValue(sn); }} className="hover:underline" title={`Tap to rename ${sn}`}>{sn}</button>
              <button onClick={() => setConfirmRemoveSN(sn)} className="ml-0.5 hover:opacity-70" title={`Remove ${sn}`}>✕</button>
            </span>
          ))}
          {showAddSN ? (
            <span className="inline-flex items-center gap-1">
              <input
                autoFocus
                type="text"
                value={newSN}
                onChange={e => setNewSN(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleAddSN(); if (e.key === "Escape") { setShowAddSN(false); setNewSN(""); } }}
                placeholder="J5600xxxx"
                className="w-28 px-2 py-1 rounded-lg text-xs border focus:outline-none focus:ring-2"
                style={{ backgroundColor: theme.inputBg, borderColor: "#f59e0b", color: theme.textPrimary }}
              />
              <button onClick={handleAddSN}
                className="px-2 py-1 rounded-lg text-xs font-bold text-white"
                style={{ backgroundColor: "#f59e0b" }}>Add</button>
              <button onClick={() => { setShowAddSN(false); setNewSN(""); }}
                className="text-xs" style={{ color: theme.textMuted }}>✕</button>
            </span>
          ) : (
            <button onClick={() => setShowAddSN(true)}
              className="px-2.5 py-1 rounded-lg text-xs font-bold border border-dashed transition-colors hover:border-solid"
              style={{ borderColor: "#f59e0b88", color: "#f59e0b" }}>
              + Add SN
            </button>
          )}
        </div>
      </WebCard>

      {/* ── Search ── */}
      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border"
        style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg }}>
        <span style={{ color: theme.textMuted }}>🔍</span>
        <input className="flex-1 bg-transparent text-sm outline-none min-w-0"
          style={{ color: theme.textPrimary }} placeholder="Search..."
          value={countSearch} onChange={e => setCountSearch(e.target.value)} />
        {countSearch && (
          <button onClick={() => setCountSearch("")}>
            <span className="text-xs" style={{ color: theme.textMuted }}>✕</span>
          </button>
        )}
      </div>

      {/* ── Filter Tabs ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setCountFilter("all")}
          className="px-3 py-1.5 rounded-lg text-xs font-bold"
          style={{
            backgroundColor: countFilter === "all" ? theme.accentBlue : theme.cardBg,
            color: countFilter === "all" ? "#fff" : theme.textSecondary,
            border: `1px solid ${countFilter === "all" ? theme.accentBlue : theme.cardBorder}`,
          }}>All ({totalParts})</button>
        <button onClick={() => setCountFilter("remaining")}
          className="px-3 py-1.5 rounded-lg text-xs font-bold"
          style={{
            backgroundColor: countFilter === "remaining" ? "#92400e" : theme.cardBg,
            color: countFilter === "remaining" ? "#fbbf24" : theme.textSecondary,
            border: `1px solid ${countFilter === "remaining" ? "#92400e" : theme.cardBorder}`,
          }}>Remaining ({remainingCount})</button>
        <button onClick={() => setCountFilter("counted")}
          className="px-3 py-1.5 rounded-lg text-xs font-bold"
          style={{
            backgroundColor: countFilter === "counted" ? theme.statusOk : theme.cardBg,
            color: countFilter === "counted" ? "#fff" : theme.textSecondary,
            border: `1px solid ${countFilter === "counted" ? theme.statusOk : theme.cardBorder}`,
          }}>Counted ({allCountedCount})</button>
        <button onClick={() => setSortMode(sortMode === "w2w" ? "alpha" : "w2w")}
          className="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold"
          style={{
            backgroundColor: sortMode === "w2w" ? "#92400e" : theme.cardBg,
            color: sortMode === "w2w" ? "#fbbf24" : theme.textSecondary,
            border: `1px solid ${sortMode === "w2w" ? "#92400e" : theme.cardBorder}`,
          }}>W2W</button>
      </div>

      <div className="text-xs" style={{ color: theme.textMuted }}>{lines.length} shown</div>

      {/* ── Count Lines Table ── */}
      <WebCard className="overflow-hidden" style={isFullScreen ? { overflow: "visible" } : undefined}>
        <div style={isFullScreen ? { overflow: "visible" } : { overflowX: "auto" }}>
          {/* Header — sticky in fullscreen */}
          <div className="grid items-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider border-b z-10"
            style={{
              gridTemplateColumns: gridCols,
              minWidth: `${minW}px`,
              backgroundColor: theme.navBg,
              borderColor: theme.cardBorder,
              color: theme.textMuted,
              ...(isFullScreen ? { position: "sticky" as const, top: 0 } : {}),
            }}>
            <span>Part # ▲</span>
            <span>Description ↕</span>
            <span>Type ↕</span>
            <span className="text-center">System QOH ↕</span>
            <span className="text-center">Counted</span>
            {wipSerials.map(sn => (
              <span key={sn} className="text-center flex flex-col items-center gap-0.5" style={{ color: "#f59e0b" }}>
                {editingWipSN === sn ? (
                  <input
                    autoFocus
                    type="text"
                    value={editWipSNValue}
                    onChange={e => setEditWipSNValue(e.target.value.toUpperCase())}
                    onKeyDown={e => {
                      if (e.key === "Enter") {
                        const trimmed = editWipSNValue.trim();
                        if (trimmed && trimmed !== sn) onRenameWipSerial(sn, trimmed);
                        setEditingWipSN(null);
                      } else if (e.key === "Escape") setEditingWipSN(null);
                    }}
                    onBlur={() => {
                      const trimmed = editWipSNValue.trim();
                      if (trimmed && trimmed !== sn) onRenameWipSerial(sn, trimmed);
                      setEditingWipSN(null);
                    }}
                    className="w-[72px] px-1 py-0.5 rounded text-[9px] text-center font-bold border focus:outline-none focus:ring-1"
                    style={{ backgroundColor: theme.inputBg, borderColor: "#f59e0b", color: "#f59e0b" }}
                  />
                ) : (
                  <button
                    onClick={() => { setEditingWipSN(sn); setEditWipSNValue(sn); }}
                    className="text-[9px] truncate max-w-[72px] cursor-pointer hover:underline"
                    title={`Tap to rename ${sn}`}>
                    🔧 {sn}
                  </button>
                )}
              </span>
            ))}
            <span className="text-center">Incoming</span>
            <span className="text-center">Variance</span>
            <span className="text-center">Min</span>
            <span className="text-center">Max</span>
            <button
              onClick={() => { setShowEditPanel(!showEditPanel); if (!showEditPanel) setEditFields({ name: displayName, frequency: schedule.frequency, assignedTo: schedule.assignedTo, nextDue: new Date(schedule.nextDue).toISOString().slice(0, 10) }); }}
              className="flex items-center justify-center rounded-md transition-colors"
              style={{ color: showEditPanel ? "#f59e0b" : theme.textMuted }}
              title="Edit schedule">
              ✏️
            </button>
          </div>

          {/* Lines */}
          <div className={`divide-y ${isFullScreen ? "" : "overflow-y-auto max-h-[55vh]"}`}
            style={{ borderColor: theme.cardBorder, minWidth: `${minW}px` }}>
          {lines.length === 0 ? (
            <div className="py-8 text-center text-sm" style={{ color: theme.textSecondary }}>
              {countFilter === "counted" ? "No parts counted yet" : "No parts remaining"}
            </div>
          ) : (
            lines.map(line => {
              const countedVal = parseInt(line.countedQty);
              const variance = line.counted ? countedVal - line.systemQty : 0;
              const isMatch = line.counted && countedVal === line.systemQty;
              const nType = (!line.type || line.type === "0" || line.type === "") ? "Not on BOM" : line.type;
              const tBg = nType === "Required" ? "#ea580c" : nType === "Optional" ? "#ca8a04" : "#475569";
              const tColor = nType === "Required" || nType === "Optional" ? "#fff" : "#e2e8f0";

              return (
                <div key={line.partNumber}
                  className="grid items-center px-4 py-3 transition-colors"
                  style={{
                    gridTemplateColumns: gridCols,
                    minWidth: `${minW}px`,
                    backgroundColor: line.counted
                      ? isMatch ? "#16a34a22" : "#ef444422"
                      : undefined,
                    borderLeft: line.counted
                      ? `4px solid ${isMatch ? "#16a34a" : "#ef4444"}`
                      : "4px solid transparent",
                    boxShadow: line.counted ? `inset 0 0 0 1px ${isMatch ? "#16a34a33" : "#ef444433"}` : undefined,
                  }}>
                  {/* Part # */}
                  <div className="flex items-center gap-1.5">
                    {line.counted && <span className="text-xs">{isMatch ? "✅" : "⚠️"}</span>}
                    <span className="text-sm font-medium" style={{ color: theme.accentBlue }}>{line.partNumber}</span>
                  </div>
                  {/* Description */}
                  <span className="text-sm truncate pr-2" style={{ color: theme.textPrimary }}>{line.description}</span>
                  {/* Type Badge */}
                  <span>
                    <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium whitespace-nowrap"
                      style={{ backgroundColor: tBg, color: tColor }}>{nType}</span>
                  </span>
                  {/* System QOH */}
                  <span className="text-sm font-bold text-center" style={{ color: theme.textPrimary }}>{line.systemQty}</span>
                  {/* Counted Input */}
                  <div className="flex justify-center">
                    <input type="number" inputMode="numeric"
                      className="w-16 px-2 py-1.5 rounded-lg text-sm text-center font-bold border focus:outline-none focus:ring-2"
                      style={{
                        borderColor: line.counted ? isMatch ? theme.statusOk : theme.statusOut : theme.cardBorder,
                        backgroundColor: line.counted ? `${theme.statusOk}15` : theme.inputBg,
                        color: theme.textPrimary,
                        boxShadow: line.counted ? `0 0 0 2px ${isMatch ? theme.statusOk + "44" : theme.statusOut + "44"}` : undefined,
                      }}
                      placeholder="—" value={line.countedQty}
                      onChange={e => onUpdateLine(line.partNumber, "counted", e.target.value)} />
                  </div>
                  {/* Dynamic WIP Columns */}
                  {wipSerials.map(sn => {
                    const val = line.wipEntries[sn] ?? "";
                    const filled = val !== "";
                    return (
                      <div key={sn} className="flex justify-center">
                        <input type="number" inputMode="numeric"
                          className="w-16 px-2 py-1.5 rounded-lg text-sm text-center font-bold border focus:outline-none focus:ring-2"
                          style={{
                            borderColor: filled ? "#f59e0b" : theme.cardBorder,
                            backgroundColor: filled ? "#f59e0b15" : theme.inputBg,
                            color: theme.textPrimary,
                            boxShadow: filled ? "0 0 0 2px #f59e0b44" : undefined,
                          }}
                          placeholder="—" value={val}
                          onChange={e => onUpdateLine(line.partNumber, `wip:${sn}`, e.target.value)} />
                      </div>
                    );
                  })}
                  {/* Incoming Input */}
                  <div className="flex justify-center">
                    <input type="number" inputMode="numeric"
                      className="w-16 px-2 py-1.5 rounded-lg text-sm text-center font-bold border focus:outline-none focus:ring-2"
                      style={{
                        borderColor: line.incomingCounted ? "#8b5cf6" : theme.cardBorder,
                        backgroundColor: line.incomingCounted ? "#8b5cf615" : theme.inputBg,
                        color: theme.textPrimary,
                        boxShadow: line.incomingCounted ? "0 0 0 2px #8b5cf644" : undefined,
                      }}
                      placeholder="—" value={line.incomingQty}
                      onChange={e => onUpdateLine(line.partNumber, "incoming", e.target.value)} />
                  </div>
                  {/* Variance */}
                  <div className="flex justify-center">
                    <span className="inline-flex items-center justify-center w-12 h-8 rounded-lg text-sm font-bold" style={{
                      backgroundColor: !line.counted ? "#1e293b" : variance === 0 ? "#1e293b" : variance < 0 ? "#7f1d1d" : "#78350f",
                      color: !line.counted ? theme.textMuted : variance === 0 ? theme.textPrimary : variance < 0 ? "#fca5a5" : "#fde68a",
                      border: `1px solid ${!line.counted ? "#334155" : variance === 0 ? "#334155" : variance < 0 ? "#dc2626" : "#f59e0b"}`,
                    }}>
                      {line.counted ? (variance > 0 ? `+${variance}` : variance) : "—"}
                    </span>
                  </div>
                  {/* Min */}
                  <div className="flex justify-center">
                    <span className="inline-flex items-center justify-center w-12 h-8 rounded-lg text-sm font-bold" style={{
                      backgroundColor: "#1e293b", color: theme.textPrimary, border: "1px solid #334155",
                    }}>{line.minQty ?? 0}</span>
                  </div>
                  {/* Max */}
                  <div className="flex justify-center">
                    <span className="inline-flex items-center justify-center w-12 h-8 rounded-lg text-sm font-bold" style={{
                      backgroundColor: "#1e293b", color: theme.textPrimary, border: "1px solid #334155",
                    }}>{line.maxQty ?? 0}</span>
                  </div>
                  <span />
                </div>
              );
            })
          )}
        </div>
        </div>
      </WebCard>

      {/* ── Confirm Remove WIP Serial Modal ── */}
      {confirmRemoveSN && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setConfirmRemoveSN(null)}>
          <div className="rounded-2xl p-6 w-80 shadow-2xl" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }} onClick={e => e.stopPropagation()}>
            <div className="text-center mb-4">
              <span className="text-3xl">⚠️</span>
              <h3 className="text-base font-bold mt-2" style={{ color: theme.textPrimary }}>Remove WIP Instrument?</h3>
              <p className="text-xs mt-1" style={{ color: theme.textSecondary }}>
                This will remove the <span className="font-bold" style={{ color: "#f59e0b" }}>{confirmRemoveSN}</span> column and all WIP counts for this instrument.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setConfirmRemoveSN(null)} className="flex-1 py-2.5 rounded-xl text-sm font-bold border"
                style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>Cancel</button>
              <button onClick={() => { onRemoveWipSerial(confirmRemoveSN); setConfirmRemoveSN(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: "#ef4444" }}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// HISTORY & VARIANCE TAB
// ═══════════════════════════════════════════════════════════════
function HistoryTab({ results, schedules, onDeleteResult }: { results: CycleResult[]; schedules: CycleSchedule[]; onDeleteResult: (id: string) => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const overallAccuracy = useMemo(() => {
    const allLines = results.flatMap(r => r.results);
    if (allLines.length === 0) return 0;
    return Math.round((allLines.filter(l => l.variance === 0).length / allLines.length) * 100);
  }, [results]);

  const totalVariances = useMemo(
    () => results.reduce((sum, r) => sum + r.results.filter(l => l.variance !== 0).length, 0),
    [results]
  );

  const sorted = useMemo(() => [...results].sort((a, b) => b.timestamp - a.timestamp), [results]);

  if (results.length === 0) {
    return <EmptyState icon="📊" title="No results yet" message="Completed cycle counts will appear here" />;
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <DashCard label="ACCURACY" value={overallAccuracy + "%"} icon="✅" color={overallAccuracy >= 95 ? theme.statusOk : theme.statusLow} />
        <DashCard label="TOTAL COUNTS" value={results.length} icon="📊" color={theme.accentBlue} />
        <DashCard label="VARIANCES" value={totalVariances} icon="⚠️" color={theme.statusOut} />
      </div>

      <WebCard className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold" style={{ color: theme.textSecondary }}>Accuracy Target: 95%</span>
          <span className="text-xs font-bold" style={{ color: overallAccuracy >= 95 ? theme.statusOk : theme.statusLow }}>{overallAccuracy}%</span>
        </div>
        <ProgressBar value={overallAccuracy} maxValue={100} color={overallAccuracy >= 95 ? theme.statusOk : theme.statusLow} height={8} />
      </WebCard>

      <WebCard className="overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Count History</h3>
        </div>
        <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
          {sorted.map(r => {
            const schedule = schedules.find(s => s._id === r.scheduleId);
            const accuratePct = r.results.length === 0 ? 100
              : Math.round((r.results.filter(l => l.variance === 0).length / r.results.length) * 100);
            const totalVar = r.results.reduce((s, l) => s + Math.abs(l.variance), 0);
            const expanded = expandedId === r._id;

            return (
              <div key={r._id}>
                <div className="px-4 py-3 cursor-pointer hover:brightness-110 transition"
                  onClick={() => setExpandedId(expanded ? null : r._id)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{ color: theme.textPrimary }}>{schedule?.name ?? r.scheduleId}</span>
                      <StatusBadge text={r.status} color={theme.statusOk} />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px]" style={{ color: theme.textMuted }}>{formatDate(r.timestamp)}</span>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(r._id); }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-500/20 transition-colors"
                        title="Delete"
                      >
                        <span className="text-sm">🗑</span>
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-3 mt-1 flex-wrap">
                    <span className="text-xs" style={{ color: theme.textSecondary }}>{r.results.length} parts</span>
                    <span className="text-xs font-medium" style={{ color: accuratePct >= 95 ? theme.statusOk : theme.statusLow }}>
                      Accuracy: {accuratePct}%
                    </span>
                    <span className="text-xs" style={{ color: totalVar === 0 ? theme.statusOk : theme.statusOut }}>
                      Variance: {totalVar}
                    </span>
                    <span className="text-xs" style={{ color: theme.textSecondary }}>By: {r.countedBy}</span>
                  </div>
                </div>

                {expanded && (
                  <div className="px-4 pb-3">
                    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${theme.cardBorder}` }}>
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ backgroundColor: `${theme.cardBorder}44` }}>
                            {["Part #", "System", "Counted", "Variance"].map(h => (
                              <th key={h} className="px-3 py-1.5 text-left font-bold" style={{ color: theme.textMuted }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {r.results.map(line => (
                            <tr key={line.partNumber} style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                              <td className="px-3 py-1.5 font-medium" style={{ color: theme.textPrimary }}>{line.partNumber}</td>
                              <td className="px-3 py-1.5" style={{ color: theme.textSecondary }}>{line.systemQty}</td>
                              <td className="px-3 py-1.5" style={{ color: theme.textPrimary }}>{line.countedQty}</td>
                              <td className="px-3 py-1.5 font-bold" style={{ color: line.variance === 0 ? theme.statusOk : theme.statusOut }}>
                                {line.variance === 0 ? "✓" : (line.variance > 0 ? "+" : "") + line.variance}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </WebCard>

      {/* ── Confirm Delete Result Modal ── */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setConfirmDeleteId(null)}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border shadow-2xl" style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder }} onClick={e => e.stopPropagation()}>
            <div className="p-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto" style={{ backgroundColor: "#ef444420" }}>
                <span className="text-xl">⚠️</span>
              </div>
              <h3 className="text-lg font-bold" style={{ color: theme.textPrimary }}>Are you sure?</h3>
              <p className="text-sm" style={{ color: theme.textSecondary }}>
                This will permanently delete this count record from the archive.
              </p>
            </div>
            <div className="flex gap-2 p-4 border-t" style={{ borderColor: theme.cardBorder }}>
              <button onClick={() => setConfirmDeleteId(null)} className="flex-1 py-2.5 rounded-xl text-sm font-bold border"
                style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>Cancel</button>
              <button onClick={() => { onDeleteResult(confirmDeleteId); setConfirmDeleteId(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: "#ef4444" }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// NEW SCHEDULE MODAL
// ═══════════════════════════════════════════════════════════════
function NewScheduleModal({
  parts, onClose, onCreated,
}: {
  parts: Part[]; onClose: () => void; onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState("Weekly");
  const [assignedTo, setAssignedTo] = useState("");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [selectedParts, setSelectedParts] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [abcFilter, setAbcFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All Types");
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    let result = [...parts];
    if (abcFilter !== "All") result = result.filter(p => p.partNumber.toUpperCase().startsWith(abcFilter));
    if (typeFilter !== "All Types") result = result.filter(p => p.type === typeFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p => p.partNumber.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }
    return result.sort((a, b) => a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true }));
  }, [parts, abcFilter, typeFilter, search]);

  const types = useMemo(() => {
    const t = new Set(parts.map(p => p.type));
    return ["All Types", ...Array.from(t).sort()];
  }, [parts]);

  const [createError, setCreateError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name || selectedParts.size === 0) return;
    setCreating(true);
    setCreateError(null);
    try {
      const parsedDate = parseDate(startDate);
      if (isNaN(parsedDate)) throw new Error("Invalid start date");
      await cycleMutation("cycleCount:createSchedule", {
        name,
        frequency,
        assignedTo: assignedTo || "Unassigned",
        startDate: parsedDate,
        parts: Array.from(selectedParts),
      });
      onCreated();
    } catch (e: any) {
      console.error("Create failed:", e);
      setCreateError(e?.message || "Failed to create schedule. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const selectAll = () => setSelectedParts(new Set(filtered.map(p => p.partNumber)));
  const deselectAll = () => setSelectedParts(new Set());
  const selectTop = (n: number) => {
    const sorted = [...parts].sort((a, b) => (b.qoh > 0 ? 1 : 0) - (a.qoh > 0 ? 1 : 0));
    setSelectedParts(new Set(sorted.slice(0, n).map(p => p.partNumber)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: theme.cardBorder }}>
          <h3 className="text-base font-bold" style={{ color: theme.textPrimary }}>Create New Schedule</h3>
          <button onClick={onClose} className="text-xl" style={{ color: theme.textMuted }}>✕</button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: theme.textSecondary }}>Schedule Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm border focus:outline-none focus:ring-2"
              style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textPrimary }}
              placeholder="e.g. W2W Inventory, Monthly Full Count" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: theme.textSecondary }}>Frequency</label>
              <select value={frequency} onChange={e => setFrequency(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm border"
                style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textPrimary }}>
                {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: theme.textSecondary }}>Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-sm border"
                style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textPrimary }} />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold uppercase tracking-wider block mb-1" style={{ color: theme.textSecondary }}>Assigned To</label>
            <input type="text" value={assignedTo} onChange={e => setAssignedTo(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm border"
              style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textPrimary }}
              placeholder="e.g. Engineer, John" />
          </div>

          {/* Part Selection */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider block mb-2" style={{ color: theme.textSecondary }}>Select Parts</label>

            <div className="flex items-center gap-1 mb-2 flex-wrap">
              <span className="text-[10px] font-bold mr-1" style={{ color: theme.textMuted }}>ABC:</span>
              {["All", "A", "B", "C"].map(f => (
                <button key={f} onClick={() => setAbcFilter(f)}
                  className="px-2.5 py-1 rounded text-xs font-bold"
                  style={{
                    backgroundColor: abcFilter === f ? theme.accentBlue : theme.cardBorder,
                    color: abcFilter === f ? "#fff" : theme.textSecondary,
                  }}>{f}</button>
              ))}
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}
                className="ml-auto px-2 py-1 rounded text-xs border"
                style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textSecondary }}>
                {types.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm border mb-2"
              style={{ backgroundColor: theme.inputBg, borderColor: theme.cardBorder, color: theme.textPrimary }}
              placeholder="🔍 Search..." />

            <div className="flex gap-2 mb-2 flex-wrap">
              <button onClick={selectAll} className="px-2.5 py-1 rounded text-xs font-bold"
                style={{ backgroundColor: theme.accentBlue, color: "#fff" }}>Select All ({filtered.length})</button>
              <button onClick={deselectAll} className="px-2.5 py-1 rounded text-xs font-bold"
                style={{ backgroundColor: theme.cardBorder, color: theme.textSecondary }}>Deselect All</button>
              <button onClick={() => selectTop(10)} className="px-2.5 py-1 rounded text-xs font-bold"
                style={{ backgroundColor: "#92400e", color: "#fbbf24" }}>Top 10 High Usage</button>
              <button onClick={() => selectTop(25)} className="px-2.5 py-1 rounded text-xs font-bold"
                style={{ backgroundColor: "#92400e", color: "#fbbf24" }}>Top 25</button>
              <button onClick={() => selectTop(50)} className="px-2.5 py-1 rounded text-xs font-bold"
                style={{ backgroundColor: "#92400e", color: "#fbbf24" }}>Top 50</button>
            </div>

            <div className="text-right mb-1">
              <span className="text-xs font-bold" style={{ color: theme.accentBlue }}>{selectedParts.size} selected</span>
            </div>

            <div className="rounded-lg overflow-hidden max-h-48 overflow-y-auto"
              style={{ border: `1px solid ${theme.cardBorder}` }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0" style={{ backgroundColor: theme.cardBg }}>
                  <tr style={{ borderBottom: `1px solid ${theme.cardBorder}` }}>
                    <th className="px-3 py-1.5 text-left w-6" style={{ color: theme.textMuted }}>✓</th>
                    <th className="px-3 py-1.5 text-left" style={{ color: theme.textMuted }}>Part #</th>
                    <th className="px-3 py-1.5 text-left" style={{ color: theme.textMuted }}>Description</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => {
                    const selected = selectedParts.has(p.partNumber);
                    return (
                      <tr key={p._id} className="cursor-pointer hover:brightness-110 transition"
                        style={{
                          borderTop: `1px solid ${theme.cardBorder}`,
                          backgroundColor: selected ? `${theme.accentBlue}15` : undefined,
                        }}
                        onClick={() => {
                          setSelectedParts(prev => {
                            const next = new Set(prev);
                            if (next.has(p.partNumber)) next.delete(p.partNumber);
                            else next.add(p.partNumber);
                            return next;
                          });
                        }}>
                        <td className="px-3 py-1.5">
                          <div className="w-4 h-4 rounded border flex items-center justify-center"
                            style={{
                              borderColor: selected ? theme.accentBlue : theme.cardBorder,
                              backgroundColor: selected ? theme.accentBlue : "transparent",
                            }}>
                            {selected && <span className="text-[10px] text-white">✓</span>}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 font-medium" style={{ color: theme.accentBlue }}>{p.partNumber}</td>
                        <td className="px-3 py-1.5 truncate max-w-[200px]" style={{ color: theme.textSecondary }}>{p.description}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t" style={{ borderColor: theme.cardBorder }}>
          {createError && (
            <div className="mb-3 px-3 py-2 rounded-lg text-xs font-bold" style={{ backgroundColor: "#ef444420", color: "#ef4444" }}>
              ⚠️ {createError}
            </div>
          )}
          <div className="flex items-center gap-3">
            <span className="text-xs" style={{ color: theme.textMuted }}>{selectedParts.size} parts selected</span>
            <div className="flex-1" />
            <button onClick={onClose} className="px-4 py-2.5 rounded-xl text-sm font-bold"
              style={{ backgroundColor: theme.cardBorder, color: theme.textSecondary }}>Cancel</button>
            <button onClick={handleCreate} disabled={creating || !name || selectedParts.size === 0}
              className="px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
              style={{ backgroundColor: theme.accentBlue }}>
              {creating ? "Creating..." : "+ Create Schedule"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
