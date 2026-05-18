import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, theme } from "../../components/vitros/SharedComponents";
import {
  Camera, Upload, Loader2, Pencil, Check, Trash2, X, Plus,
  ChevronDown, ChevronUp, Send, Download, AlertTriangle,
  CheckCircle2, Circle, Package, BarChart3, ClipboardList,
} from "lucide-react";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

// ─── Supabase direct helpers (same config as useConvexData) ───
const SUPABASE_URL = "https://oykqiiydpwngasvzdthh.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95a3FpaXlkcHduZ2FzdnpkdGhoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NjA1MzMsImV4cCI6MjA5MzUzNjUzM30.h415RO8X7fpSKUqL--qQiErvYlO8etV1IHplmYbRwxY";
const SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im95a3FpaXlkcHduZ2FzdnpkdGhoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3Nzk2MDUzMywiZXhwIjoyMDkzNTM2NTMzfQ.30U3H8Rol0XgoMFvaljZD2e8J0AYXlPUPdzlOe97RIw";

const sbH = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function sbQuery<T>(table: string, params = ""): Promise<T[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*${params ? "&" + params : ""}`, { headers: sbH });
  if (!res.ok) return [];
  return (await res.json()) as T[];
}
async function sbInsert<T>(table: string, data: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST", headers: { ...sbH, Prefer: "return=representation" }, body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "Insert failed");
  return Array.isArray(json) ? json[0] : json;
}
async function sbUpdate(table: string, filter: string, data: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "PATCH", headers: { ...sbH, Prefer: "return=minimal" }, body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Update failed");
}
async function sbDelete(table: string, filter: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: "DELETE", headers: { ...sbH, Prefer: "return=minimal" },
  });
  if (!res.ok) throw new Error("Delete failed");
}
async function sbUpsert<T>(table: string, data: Record<string, unknown>, onConflict: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...sbH, Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify(data),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.message || "Upsert failed");
  return Array.isArray(json) ? json[0] : json;
}

// ─── Types ───
interface DhrSection {
  id: string;
  analyzer_model: string;
  section_id: string;
  section_name: string;
  section_type: string;
  has_parts: boolean;
  page_number: number | null;
  notes: string | null;
}
interface DhrExpectedPart {
  id: string;
  analyzer_model: string;
  section_id: string;
  part_number: string;
  description: string;
  bom_qty: number;
  category: string;
  notes: string | null;
  sort_order: number;
}
interface DhrSession {
  id: string;
  instrument_sn: string;
  wo_number: string | null;
  analyzer_model: string;
  started_at: string;
  completed_at: string | null;
  status: string;
  started_by: string | null;
  notes: string | null;
}
interface DhrScanResult {
  id: string;
  session_id: string;
  section_id: string;
  part_number: string;
  description: string | null;
  expected_qty: number;
  scanned_qty: number;
  category: string;
  status: string;
  stock_before: number | null;
  stock_after: number | null;
  stock_id: string | null;
  scanned_at: string | null;
  notes: string | null;
}
interface StockPart {
  _id: string;
  partNumber: string;
  description: string;
  qoh: number;
  minQty: number;
  maxQty: number;
  status: string;
}

// ─── Sort section IDs numerically ───
function sectionSort(a: string, b: string): number {
  const na = parseFloat(a);
  const nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a.localeCompare(b);
}

// ─── Category colors ───
function catColor(cat: string) {
  switch (cat) {
    case "required": return { bg: "#ef444418", text: "#ef4444", border: "#ef444440", label: "REQ" };
    case "optional": return { bg: "#6366f118", text: "#6366f1", border: "#6366f140", label: "OPT" };
    case "tool":     return { bg: "#f59e0f18", text: "#f59e0f", border: "#f59e0f40", label: "TOOL" };
    default:         return { bg: "#64748b18", text: "#64748b", border: "#64748b40", label: cat.toUpperCase() };
  }
}

// ─── Status badge ───
function statusIcon(status: string) {
  switch (status) {
    case "matched": return <CheckCircle2 className="w-4 h-4" style={{ color: "#12a573" }} />;
    case "short":   return <AlertTriangle className="w-4 h-4" style={{ color: "#ef4444" }} />;
    case "over":    return <BarChart3 className="w-4 h-4" style={{ color: "#14b8d4" }} />;
    case "skipped": return <X className="w-4 h-4" style={{ color: "#64748b" }} />;
    default:        return <Circle className="w-4 h-4" style={{ color: "#64748b" }} />;
  }
}

// ════════════════════════════════════════════════
// MAIN COMPONENT
// ════════════════════════════════════════════════
export function DhrScanner() {
  const data = useConvexData();

  // ── Master data ──
  const [sections, setSections] = useState<DhrSection[]>([]);
  const [expectedParts, setExpectedParts] = useState<DhrExpectedPart[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Session state ──
  const [sessions, setSessions] = useState<DhrSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [scanResults, setScanResults] = useState<DhrScanResult[]>([]);

  // ── View state ──
  const [view, setView] = useState<"sessions" | "checklist">("sessions");
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // ── New session form ──
  const [showNewSession, setShowNewSession] = useState(false);
  const [newSN, setNewSN] = useState("");
  const [newWO, setNewWO] = useState("");
  const [newModel, setNewModel] = useState("5600");

  // ── Employee / user identity ──
  const [employees, setEmployees] = useState<{id:string;name:string;initials:string}[]>([]);
  const [activeUser, setActiveUser] = useState<string | null>(() => {
    try { return localStorage.getItem("vitros_dhr_user"); } catch { return null; }
  });
  const setAndPersistUser = (name: string | null) => {
    setActiveUser(name);
    try { if (name) localStorage.setItem("vitros_dhr_user", name); else localStorage.removeItem("vitros_dhr_user"); } catch {}
  };

  // ── Saving indicator ──
  const [saving, setSaving] = useState<string | null>(null);

  // ── Scan / Upload state ──
  const [scanMode, setScanMode] = useState<"idle" | "scanning" | "results">("idle");
  const [scanProgress, setScanProgress] = useState("");
  const [scanPreviewUrl, setScanPreviewUrl] = useState<string | null>(null);
  const [scanDetected, setScanDetected] = useState<{ part_number: string; description: string; qty: number; section_hint: string; matched: boolean }[]>([]);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  // ── Additional Service (5.24) — manual part add ──
  const [addPartNumber, setAddPartNumber] = useState("");
  const [addPartDesc, setAddPartDesc] = useState("");
  const [addPartQty, setAddPartQty] = useState("1");
  const [addPartSection, setAddPartSection] = useState("");

  // ── Toast ──
  const [toast, setToast] = useState<string | null>(null);
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  // ── Active session ──
  const activeSession = useMemo(() => sessions.find(s => s.id === activeSessionId), [sessions, activeSessionId]);

  // ── Sections for active model ──
  const modelSections = useMemo(() => {
    const model = activeSession?.analyzer_model || "5600";
    return sections.filter(s => s.analyzer_model === model).sort((a, b) => sectionSort(a.section_id, b.section_id));
  }, [sections, activeSession]);

  // ── Expected parts for active model ──
  const modelParts = useMemo(() => {
    const model = activeSession?.analyzer_model || "5600";
    return expectedParts.filter(p => p.analyzer_model === model);
  }, [expectedParts, activeSession]);

  // ── Parts for active section ──
  const sectionParts = useMemo(() => {
    if (!activeSectionId) return [];
    return modelParts.filter(p => p.section_id === activeSectionId).sort((a, b) => a.sort_order - b.sort_order);
  }, [modelParts, activeSectionId]);

  // ── Results map for quick lookup ──
  const resultsMap = useMemo(() => {
    const map = new Map<string, DhrScanResult>();
    for (const r of scanResults) {
      map.set(`${r.section_id}::${r.part_number}`, r);
    }
    return map;
  }, [scanResults]);

  // ── Section progress ──
  const sectionProgress = useMemo(() => {
    const prog: Record<string, { total: number; filled: number; required: number; reqFilled: number }> = {};
    for (const sec of modelSections) {
      if (!sec.has_parts) continue;
      const secParts = modelParts.filter(p => p.section_id === sec.section_id);
      const reqParts = secParts.filter(p => p.category === "required");
      let filled = 0;
      let reqFilled = 0;
      for (const p of secParts) {
        const r = resultsMap.get(`${sec.section_id}::${p.part_number}`);
        if (r && r.scanned_qty > 0) filled++;
      }
      for (const p of reqParts) {
        const r = resultsMap.get(`${sec.section_id}::${p.part_number}`);
        if (r && r.scanned_qty >= p.bom_qty) reqFilled++;
      }
      prog[sec.section_id] = { total: secParts.length, filled, required: reqParts.length, reqFilled };
    }
    return prog;
  }, [modelSections, modelParts, resultsMap]);

  // ── Overall progress ──
  const overallProgress = useMemo(() => {
    let totalReq = 0, filledReq = 0, totalParts = 0, filledParts = 0;
    for (const p of Object.values(sectionProgress)) {
      totalReq += p.required;
      filledReq += p.reqFilled;
      totalParts += p.total;
      filledParts += p.filled;
    }
    return { totalReq, filledReq, totalParts, filledParts };
  }, [sectionProgress]);

  // ════════════════════════════════════════════════
  // LOAD DATA
  // ════════════════════════════════════════════════
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [sec, parts, sess, emps] = await Promise.all([
          sbQuery<DhrSection>("dhr_checklist_sections"),
          sbQuery<DhrExpectedPart>("dhr_expected_parts"),
          sbQuery<DhrSession>("dhr_scan_sessions", "order=created_at.desc"),
          sbQuery<{id:string;name:string;initials:string;active:boolean}>("convex_employees", "active=eq.true&order=name"),
        ]);
        setSections(sec);
        setExpectedParts(parts);
        setSessions(sess);
        setEmployees(emps.map(e => ({id:e.id, name:e.name, initials:e.initials})));
      } catch (e) {
        console.error("Failed to load DHR data:", e);
      }
      setLoading(false);
    })();
  }, []);

  // ── Load scan results when session changes ──
  useEffect(() => {
    if (!activeSessionId) { setScanResults([]); return; }
    (async () => {
      const results = await sbQuery<DhrScanResult>("dhr_scan_results", `session_id=eq.${activeSessionId}&order=created_at.asc`);
      setScanResults(results);
    })();
  }, [activeSessionId]);

  // ════════════════════════════════════════════════
  // CREATE SESSION
  // ════════════════════════════════════════════════
  const createSession = async () => {
    if (!newSN.trim()) return;
    try {
      const session = await sbInsert<DhrSession>("dhr_scan_sessions", {
        instrument_sn: newSN.trim().toUpperCase(),
        wo_number: newWO.trim() || null,
        analyzer_model: newModel,
        status: "in_progress",
      });
      setSessions(prev => [session, ...prev]);
      setActiveSessionId(session.id);
      setView("checklist");
      setShowNewSession(false);
      setNewSN("");
      setNewWO("");
      showToast(`✅ Session created for ${session.instrument_sn}`);
    } catch (e: any) {
      showToast(`⚠ ${e.message}`);
    }
  };

  // ════════════════════════════════════════════════
  // OPEN SESSION
  // ════════════════════════════════════════════════
  const openSession = (session: DhrSession) => {
    setActiveSessionId(session.id);
    setActiveSectionId(null);
    setView("checklist");
  };

  // ════════════════════════════════════════════════
  // UPDATE SCANNED QTY — CHECKLIST ONLY (no stock changes until Save)
  // ════════════════════════════════════════════════
  const updateScannedQty = useCallback(async (
    sectionId: string,
    partNumber: string,
    newQty: number,
    expectedQty: number,
    category: string,
    description: string,
  ) => {
    if (!activeSessionId) return;
    if (category === "tool") {
      // Tools: save checklist only, no stock impact
      return updateChecklist(sectionId, partNumber, newQty, expectedQty, category, description);
    }

    const key = `${sectionId}::${partNumber}`;
    const existing = resultsMap.get(key);
    const oldQty = existing?.scanned_qty || 0;
    const delta = newQty - oldQty;
    if (delta === 0) return;

    const userName = activeUser || "Unknown";
    setSaving(key);
    try {
      // Find stock part
      const stockPart = data.parts.find(
        (p: StockPart) => p.partNumber.toUpperCase() === partNumber.toUpperCase()
      );
      const stockId = stockPart?._id || null;
      const stockBefore = stockPart?.qoh ?? null;

      // Determine status
      let status = "pending";
      if (newQty === 0) status = "pending";
      else if (newQty === expectedQty) status = "matched";
      else if (newQty < expectedQty) status = "short";
      else status = "over";

      // ── REAL-TIME STOCK UPDATE ──
      let stockAfter = stockBefore;
      if (stockPart && delta !== 0) {
        stockAfter = (stockBefore ?? 0) - delta; // +delta consumes, -delta returns
        await sbUpdate("stock", `id=eq.${stockPart._id}`, {
          qty_on_hand: stockAfter,
          last_activity: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        // Audit log — real-time transaction
        await sbInsert("audit_log", {
          action: delta > 0 ? "OUT" : "IN",
          entity_type: "stock",
          entity_id: stockPart._id,
          part_number: partNumber,
          user_name: userName,
          details: {
            qty: Math.abs(delta),
            analyzerSerial: activeSession?.instrument_sn,
            source: "DHR Scanner (Auto)",
            section: sectionId,
            session_id: activeSessionId,
            prev_qty: oldQty,
            new_qty: newQty,
          },
          old_value: { qty_on_hand: stockBefore },
          new_value: { qty_on_hand: stockAfter, qty: Math.abs(delta), description },
        });

        // SAP staging
        await sbInsert("sap_staging", {
          part_number: partNumber,
          description,
          mode: delta > 0 ? "OUT" : "IN",
          movement_type: delta > 0 ? "261" : "101",
          plant_code: "US08",
          storage_location: "MAIN",
          qty: Math.abs(delta),
          status: "PENDING",
          source: `DHR-${activeSession?.instrument_sn || ""}-${userName}`,
        });
      }

      // Upsert scan result (with stock state)
      const resultData = {
        session_id: activeSessionId,
        section_id: sectionId,
        part_number: partNumber,
        description,
        expected_qty: expectedQty,
        scanned_qty: newQty,
        category,
        status,
        stock_before: stockBefore,
        stock_after: stockAfter,
        stock_id: stockId,
        scanned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (existing) {
        await sbUpdate("dhr_scan_results", `id=eq.${existing.id}`, resultData);
        setScanResults(prev => prev.map(r => r.id === existing.id ? { ...r, ...resultData } as DhrScanResult : r));
      } else {
        const newResult = await sbInsert<DhrScanResult>("dhr_scan_results", resultData);
        setScanResults(prev => [...prev, newResult]);
      }

      // Refresh stock data so QOH column updates immediately
      data.refresh();

      const action = delta > 0 ? `−${delta} from stock` : `+${Math.abs(delta)} returned`;
      showToast(`✅ ${partNumber}: qty ${oldQty}→${newQty} (${action}) — ${userName}`);
    } catch (e: any) {
      console.error("updateScannedQty failed:", e);
      showToast(`⚠ Failed: ${e.message}`);
    } finally {
      setSaving(null);
    }
  }, [activeSessionId, activeSession, activeUser, resultsMap, data]);

  // Tool-only checklist save (no stock impact)
  const updateChecklist = useCallback(async (
    sectionId: string, partNumber: string, newQty: number,
    expectedQty: number, category: string, description: string,
  ) => {
    if (!activeSessionId) return;
    const key = `${sectionId}::${partNumber}`;
    const existing = resultsMap.get(key);
    setSaving(key);
    try {
      let status = newQty === 0 ? "pending" : newQty === expectedQty ? "matched" : newQty < expectedQty ? "short" : "over";
      const resultData = {
        session_id: activeSessionId, section_id: sectionId, part_number: partNumber,
        description, expected_qty: expectedQty, scanned_qty: newQty, category, status,
        stock_before: null, stock_after: null, stock_id: null,
        scanned_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      if (existing) {
        await sbUpdate("dhr_scan_results", `id=eq.${existing.id}`, resultData);
        setScanResults(prev => prev.map(r => r.id === existing.id ? { ...r, ...resultData } as DhrScanResult : r));
      } else {
        const newResult = await sbInsert<DhrScanResult>("dhr_scan_results", resultData);
        setScanResults(prev => [...prev, newResult]);
      }
      showToast(`✅ ${partNumber}: qty set to ${newQty} (tool — no stock impact)`);
    } catch (e: any) { showToast(`⚠ Failed: ${e.message}`); }
    finally { setSaving(null); }
  }, [activeSessionId, resultsMap]);

  // ════════════════════════════════════════════════
  // MANUAL ADD PART (for 5.24 Additional Service)
  // ════════════════════════════════════════════════
  const addManualPart = useCallback(async () => {
    if (!activeSessionId || !addPartNumber.trim()) return;
    const pn = addPartNumber.trim().toUpperCase();
    const desc = addPartDesc.trim() || "Additional service part";
    const qty = Math.max(1, parseInt(addPartQty) || 1);
    const secRef = addPartSection.trim() || "5.24";
    const userName = activeUser || "Unknown";

    setSaving(`5.24::${pn}`);
    try {
      const key = `5.24::${pn}`;
      const existing = resultsMap.get(key);
      const oldQty = existing?.scanned_qty || 0;
      const delta = qty - oldQty;

      const stockPart = data.parts.find(
        (p: StockPart) => p.partNumber.toUpperCase() === pn
      );
      const stockBefore = stockPart?.qoh ?? null;
      let stockAfter = stockBefore;

      // Real-time stock update
      if (stockPart && delta !== 0) {
        stockAfter = (stockBefore ?? 0) - delta;
        await sbUpdate("stock", `id=eq.${stockPart._id}`, {
          qty_on_hand: stockAfter, last_activity: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
        await sbInsert("audit_log", {
          action: delta > 0 ? "OUT" : "IN", entity_type: "stock", entity_id: stockPart._id,
          part_number: pn, user_name: userName,
          details: { qty: Math.abs(delta), analyzerSerial: activeSession?.instrument_sn, source: "DHR Scanner 5.24 (Auto)", section: `5.24 ref §${secRef}`, session_id: activeSessionId },
          old_value: { qty_on_hand: stockBefore }, new_value: { qty_on_hand: stockAfter, qty: Math.abs(delta), description: desc },
        });
        await sbInsert("sap_staging", {
          part_number: pn, description: desc, mode: delta > 0 ? "OUT" : "IN",
          movement_type: delta > 0 ? "261" : "101", plant_code: "US08", storage_location: "MAIN",
          qty: Math.abs(delta), status: "PENDING", source: `DHR-${activeSession?.instrument_sn || ""}-5.24-${userName}`,
        });
      }

      const fullDesc = desc + (secRef !== "5.24" ? ` (ref §${secRef})` : "");
      const resultData = {
        session_id: activeSessionId, section_id: "5.24", part_number: pn,
        description: fullDesc, expected_qty: qty, scanned_qty: qty,
        category: "ADDITIONAL", status: "matched",
        stock_before: stockBefore, stock_after: stockAfter,
        stock_id: stockPart?._id || null,
        scanned_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };

      if (existing) {
        await sbUpdate("dhr_scan_results", `id=eq.${existing.id}`, resultData);
        setScanResults(prev => prev.map(r => r.id === existing.id ? { ...r, ...resultData } as DhrScanResult : r));
      } else {
        const newResult = await sbInsert<DhrScanResult>("dhr_scan_results", resultData);
        setScanResults(prev => [...prev, newResult]);
      }

      data.refresh();
      const stockMsg = stockPart ? ` (−${qty} from stock)` : " (not in stock table)";
      showToast(`✅ Added ${pn} × ${qty}${stockMsg} — ${userName}`);
      setAddPartNumber(""); setAddPartDesc(""); setAddPartQty("1"); setAddPartSection("");
    } catch (e: any) {
      showToast(`⚠ Failed to add: ${e.message}`);
    } finally {
      setSaving(null);
    }
  }, [activeSessionId, activeUser, activeSession, addPartNumber, addPartDesc, addPartQty, addPartSection, resultsMap, data]);

  // Delete a manual part from 5.24
  const deleteManualPart = useCallback(async (resultId: string, partNumber: string) => {
    if (!confirm(`Remove ${partNumber} from Additional Service?`)) return;
    try {
      await sbDelete("dhr_scan_results", `id=eq.${resultId}`);
      setScanResults(prev => prev.filter(r => r.id !== resultId));
      showToast(`🗑 Removed ${partNumber}`);
    } catch (e: any) {
      showToast(`⚠ Failed: ${e.message}`);
    }
  }, []);

  // ════════════════════════════════════════════════
  // COMPLETE / SAVE — COMMIT TO STOCK SUMMARY
  // Applies delta between last-committed qtys and current qtys.
  // Session stays active & editable. Can be saved repeatedly.
  // ════════════════════════════════════════════════
  // Stock is now updated in real time — no batch save needed.
  // Kept isSaving for delete operations.
  const [isSaving, setIsSaving] = useState(false);

  // ════════════════════════════════════════════════
  // DELETE SESSION
  // ════════════════════════════════════════════════
  const deleteSession = async (sessionId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!confirm("Delete this DHR session? Stock adjustments already saved will remain.")) return;
    try {
      // Delete scan results first
      await fetch(`${SUPABASE_URL}/rest/v1/dhr_scan_results?session_id=eq.${sessionId}`, {
        method: "DELETE", headers: sbH,
      });
      // Delete session
      await fetch(`${SUPABASE_URL}/rest/v1/dhr_scan_sessions?id=eq.${sessionId}`, {
        method: "DELETE", headers: sbH,
      });
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        setActiveSessionId(null);
        setView("sessions");
      }
      showToast("🗑 Session deleted");
    } catch (e: any) {
      showToast(`⚠ Delete failed: ${e.message}`);
    }
  };

  // ════════════════════════════════════════════════
  // EXPORT TO EXCEL
  // ════════════════════════════════════════════════
  const exportSession = () => {
    if (!activeSession) return;
    const rows = scanResults.map(r => ({
      Section: r.section_id,
      "Part Number": r.part_number,
      Description: r.description || "",
      Category: r.category,
      "BOM Qty": r.expected_qty,
      "Scanned Qty": r.scanned_qty,
      Status: r.status,
      "Stock Before": r.stock_before ?? "",
      "Stock After": r.stock_after ?? "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DHR Results");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    saveAs(new Blob([buf]), `DHR_${activeSession.instrument_sn}_${activeSession.analyzer_model}.xlsx`);
  };

  // ════════════════════════════════════════════════
  // SCAN / UPLOAD — AI PAGE READER
  // ════════════════════════════════════════════════
  // Embedded API key — no user config needed
  const EMBEDDED_AI_KEY = "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";
  const getApiKey = (): string => EMBEDDED_AI_KEY;

  const handleScanClick = () => {
    cameraInputRef.current?.click();
  };

  const handleUploadClick = () => {
    uploadInputRef.current?.click();
  };

  // Compress image for iOS (camera photos are 3-12MB, too large for API)
  // Compress image → returns Blob directly (no data URL intermediary — Safari-safe)
  const compressImageToBlob = (file: File, maxWidth = 1400, quality = 0.75): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        try {
          const canvas = document.createElement("canvas");
          let w = img.width, h = img.height;
          if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) { reject(new Error("Canvas not supported")); return; }
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            (blob) => {
              if (blob) resolve(blob);
              else reject(new Error("Compression produced empty result"));
            },
            "image/jpeg",
            quality
          );
        } catch (e: any) {
          reject(new Error(`Compress error: ${e.message}`));
        }
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Image load error")); };
      img.src = objectUrl;
    });
  };

  const handleImageCapture = async (file: File) => {
    const apiKey = getApiKey();

    // Preview
    const url = URL.createObjectURL(file);
    setScanPreviewUrl(url);
    setScanMode("scanning");
    setScanProgress("📷 Reading image…");

    try {
      // Step 1: Compress image (iOS photos can be 10MB+)
      setScanProgress(`📷 Compressing ${(file.size / 1024 / 1024).toFixed(1)}MB photo…`);
      let blob: Blob;
      try {
        blob = await compressImageToBlob(file, 1400, 0.75);
      } catch (ce: any) {
        throw new Error(`Step 1 compress: ${ce.message}`);
      }
      const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
      setScanProgress(`⬆️ Uploading ${sizeMB}MB…`);

      // Step 2: Upload to Supabase Storage (avoids Safari payload size limits)
      const filename = `scan_${Date.now()}.jpg`;
      let uploadResp: Response;
      try {
        uploadResp = await fetch(`${SUPABASE_URL}/storage/v1/object/dhr-scans/${filename}`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${SERVICE_KEY}`,
            "apikey": SERVICE_KEY,
            "Content-Type": "image/jpeg",
            "x-upsert": "true",
          },
          body: blob,
        });
      } catch (ue: any) {
        throw new Error(`Step 2 upload: ${ue.message}`);
      }
      if (!uploadResp.ok) {
        const uerr = await uploadResp.text().catch(() => "");
        throw new Error(`Step 2 upload ${uploadResp.status}: ${uerr}`);
      }
      const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/dhr-scans/${filename}`;

      // Step 3: Send lightweight URL to OpenAI Vision (with retry + timeout)
      setScanProgress("🔍 Analyzing with AI…");
      const partList = modelParts.map(p => `${p.part_number} (${p.description}, §${p.section_id})`).join("\n");

      const aiBody = JSON.stringify({
        model: "gpt-4o",
        max_tokens: 4096,
        messages: [
          {
            role: "system",
            content: `You are an expert OCR reader for QuidelOrtho VITROS Device History Record (DHR) pages.

CONTEXT: This is a photo of a DHR checklist page from a VITROS analyzer build. Each page belongs to a section (e.g., 5.1, 5.2, … 5.23) and lists parts that need to be installed.

YOUR TASK:
1. Identify which DHR section this page belongs to (look for section numbers like "5.7" or headings like "Microwell Incubator")
2. Extract every part number visible on the page
3. For each part, extract the required quantity if visible (default to 1 if unclear)

KNOWN PARTS IN THE SYSTEM:
${partList}

PART NUMBER FORMATS:
- J##### (e.g., J37203, J10944)
- J#####-## (with suffix)
- 1H#### (e.g., 1H4534)
- 1C#### (e.g., 1C3537)
- 192### (e.g., 192418)
- 6-digit numbers (e.g., 354984)

Return ONLY valid JSON (no markdown, no code fences):
{
  "section_hint": "5.7",
  "section_name": "name if visible",
  "parts": [
    {"part_number": "J37203", "description": "short description if visible", "qty": 1}
  ]
}

If you cannot read anything useful, return: {"section_hint":"","section_name":"","parts":[]}`
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Read this DHR page and extract all part numbers with quantities. The page may be rotated or at an angle." },
              { type: "image_url", image_url: { url: publicUrl, detail: "high" } },
            ],
          },
        ],
      });

      // Retry up to 3 attempts with timeout
      let response: Response | null = null;
      let lastError = "";
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (attempt > 1) setScanProgress(`🔍 Retry ${attempt}/3…`);
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 90000); // 90s timeout
          response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
            body: aiBody,
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (response.ok) break; // success
          const errBody = await response.json().catch(() => ({}));
          lastError = `${response.status}: ${errBody.error?.message || "unknown"}`;
          if (response.status === 401 || response.status === 403) break; // don't retry auth errors
        } catch (ae: any) {
          lastError = ae.name === "AbortError" ? "Request timed out (90s)" : ae.message;
          response = null;
        }
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000)); // wait 2s before retry
      }

      if (!response) {
        throw new Error(`Step 3 AI call failed after 3 attempts: ${lastError}`);
      }
      if (!response.ok) {
        throw new Error(`Step 3 AI ${lastError}`);
      }

      setScanProgress("🧠 Processing results…");

      // Cleanup: delete temp image from storage (fire and forget)
      fetch(`${SUPABASE_URL}/storage/v1/object/dhr-scans/${filename}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${SERVICE_KEY}`, "apikey": SERVICE_KEY },
      }).catch(() => {});
      const json = await response.json();
      const content = json.choices?.[0]?.message?.content || "";

      // Parse JSON from response (strip markdown fences if present)
      const cleaned = content.replace(/^```json?\s*/i, "").replace(/\s*```$/i, "").trim();
      const parsed = JSON.parse(cleaned);

      // Match detected parts against expected parts
      const detected = (parsed.parts || []).map((p: any) => {
        const pn = (p.part_number || "").toUpperCase().trim();
        const match = modelParts.find(mp => mp.part_number.toUpperCase() === pn);
        return {
          part_number: match ? match.part_number : p.part_number,
          description: match ? match.description : (p.description || "Unknown"),
          qty: p.qty || 1,
          section_hint: match ? match.section_id : (parsed.section_hint || ""),
          matched: !!match,
        };
      });

      setScanDetected(detected);
      setScanMode("results");
      setScanProgress("");

      const matchCount = detected.filter((d: any) => d.matched).length;
      showToast(`🔍 Found ${detected.length} parts (${matchCount} matched to checklist)`);
    } catch (e: any) {
      console.error("Scan failed:", e);
      setScanMode("idle");
      setScanProgress("");
      showToast(`⚠ Scan failed: ${e.message}`);
    }
  };

  const applyScanResults = async () => {
    if (!activeSessionId || scanDetected.length === 0) return;
    setScanMode("scanning");
    setScanProgress("📋 Applying to checklist…");

    let applied = 0;
    for (const det of scanDetected) {
      if (!det.matched) continue;
      // Find the expected part to get section, bom_qty, category, description
      const ep = modelParts.find(p => p.part_number === det.part_number);
      if (!ep) continue;

      // Check if already filled — if so, skip (don't overwrite manual entries)
      const existing = resultsMap.get(`${ep.section_id}::${ep.part_number}`);
      if (existing && existing.scanned_qty > 0) continue;

      try {
        await updateScannedQty(ep.section_id, ep.part_number, det.qty, ep.bom_qty, ep.category, ep.description);
        applied++;
        setScanProgress(`📋 Applied ${applied} of ${scanDetected.filter(d => d.matched).length}…`);
      } catch (e) {
        console.error(`Failed to apply ${det.part_number}:`, e);
      }
    }

    setScanMode("idle");
    setScanPreviewUrl(null);
    setScanDetected([]);
    setScanProgress("");
    showToast(`✅ Applied ${applied} parts from scan`);
  };

  const dismissScan = () => {
    setScanMode("idle");
    setScanPreviewUrl(null);
    setScanDetected([]);
    setScanProgress("");
  };

  // ════════════════════════════════════════════════
  // TOGGLE SECTION
  // ════════════════════════════════════════════════
  const toggleCollapse = (sectionId: string) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      next.has(sectionId) ? next.delete(sectionId) : next.add(sectionId);
      return next;
    });
  };

  // ════════════════════════════════════════════════
  // LOADING
  // ════════════════════════════════════════════════
  if (loading || data.isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: theme.accentBlue }} />
        <span className="text-sm" style={{ color: theme.textSecondary }}>Loading DHR checklist…</span>
      </div>
    );
  }

  // ════════════════════════════════════════════════
  // SESSION LIST VIEW
  // ════════════════════════════════════════════════
  if (view === "sessions") {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: theme.textPrimary }}>
              <ClipboardList className="w-6 h-6" style={{ color: theme.accentBlue }} />
              DHR Scanner
            </h1>
            <p className="text-xs mt-1" style={{ color: theme.textSecondary }}>
              Certified Analyzer Service &amp; Testing Checklist
            </p>
          </div>
          <button
            onClick={() => setShowNewSession(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ backgroundColor: theme.accentBlue }}
          >
            <Plus className="w-4 h-4" /> New Session
          </button>
        </div>

        {/* New Session Form */}
        {showNewSession && (
          <WebCard className="p-4 space-y-3" style={{ border: `2px solid ${theme.accentBlue}` }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>📋 New DHR Session</span>
              <button onClick={() => setShowNewSession(false)}><X className="w-4 h-4" style={{ color: theme.textMuted }} /></button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold block mb-1" style={{ color: theme.textSecondary }}>Instrument S/N *</label>
                <input
                  value={newSN} onChange={e => setNewSN(e.target.value)}
                  placeholder="e.g. 08001234"
                  className="w-full px-3 py-2 rounded-lg text-sm border-0 outline-none"
                  style={{ backgroundColor: theme.inputBg, color: theme.textPrimary }}
                  onKeyDown={e => e.key === "Enter" && createSession()}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold block mb-1" style={{ color: theme.textSecondary }}>W/O Number</label>
                <input
                  value={newWO} onChange={e => setNewWO(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 rounded-lg text-sm border-0 outline-none"
                  style={{ backgroundColor: theme.inputBg, color: theme.textPrimary }}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold block mb-1" style={{ color: theme.textSecondary }}>Model</label>
                <select
                  value={newModel} onChange={e => setNewModel(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm border-0 outline-none"
                  style={{ backgroundColor: theme.inputBg, color: theme.textPrimary }}
                >
                  <option value="5600">VITROS 5600</option>
                  <option value="3600">VITROS 3600</option>
                  <option value="XT7600">VITROS XT7600</option>
                </select>
              </div>
            </div>
            <button
              onClick={createSession}
              disabled={!newSN.trim()}
              className="w-full py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40"
              style={{ backgroundColor: theme.accentBlue }}
            >
              Create Session
            </button>
          </WebCard>
        )}

        {/* Session List */}
        {sessions.length === 0 ? (
          <WebCard className="p-8 text-center">
            <div className="text-3xl mb-3">📋</div>
            <div className="text-sm font-bold mb-1" style={{ color: theme.textPrimary }}>No DHR sessions yet</div>
            <div className="text-xs" style={{ color: theme.textSecondary }}>Create a new session to start scanning parts</div>
          </WebCard>
        ) : (
          <div className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} onClick={() => openSession(s)} className="cursor-pointer">
              <WebCard className="p-4 hover:brightness-110 transition-all">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                      style={{ backgroundColor: s.status === "completed" ? "#12a57318" : "#6366f118" }}>
                      {s.status === "completed"
                        ? <CheckCircle2 className="w-5 h-5" style={{ color: "#12a573" }} />
                        : <ClipboardList className="w-5 h-5" style={{ color: "#6366f1" }} />}
                    </div>
                    <div>
                      <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>
                        {s.instrument_sn}
                        {s.wo_number && <span className="ml-2 text-xs font-normal" style={{ color: theme.textMuted }}>WO: {s.wo_number}</span>}
                      </div>
                      <div className="text-[10px]" style={{ color: theme.textSecondary }}>
                        VITROS {s.analyzer_model} · {new Date(s.started_at).toLocaleDateString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 rounded-lg text-[10px] font-bold"
                      style={{
                        backgroundColor: "#6366f118",
                        color: "#6366f1",
                      }}>
                      ACTIVE
                    </span>
                    <button
                      onClick={(e) => deleteSession(s.id, e)}
                      className="p-1.5 rounded-lg hover:brightness-125 transition-all"
                      style={{ backgroundColor: "#ef444412" }}
                      title="Delete session"
                    >
                      <Trash2 className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                    </button>
                    <ChevronDown className="w-4 h-4" style={{ color: theme.textMuted }} />
                  </div>
                </div>
              </WebCard>
              </div>
            ))}
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-bold shadow-lg z-50"
            style={{ backgroundColor: theme.cardBg, color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>
            {toast}
          </div>
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════════
  // CHECKLIST VIEW (inside a session)
  // ════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <button onClick={() => { setView("sessions"); setActiveSessionId(null); setActiveSectionId(null); }}
            className="p-2 rounded-xl" style={{ backgroundColor: theme.cardBg }}>
            <ChevronUp className="w-5 h-5" style={{ color: theme.textPrimary }} />
          </button>
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2" style={{ color: theme.textPrimary }}>
              📋 {activeSession?.instrument_sn}
              <span className="text-xs font-normal px-2 py-0.5 rounded-lg" style={{ backgroundColor: "#6366f118", color: "#6366f1" }}>
                VITROS {activeSession?.analyzer_model}
              </span>
            </h2>
            {activeSession?.wo_number && (
              <p className="text-xs" style={{ color: theme.textSecondary }}>WO: {activeSession.wo_number}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportSession} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold"
            style={{ backgroundColor: theme.cardBg, color: theme.textSecondary, border: `1px solid ${theme.cardBorder}` }}>
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button onClick={(e) => activeSessionId && deleteSession(activeSessionId, e)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold"
            style={{ color: "#ef4444", backgroundColor: "#ef444412", border: "1px solid #ef444430" }}>
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* ── User Identity Bar ── */}
        <WebCard className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.textMuted }}>Technician:</span>
            <select
              value={activeUser || ""}
              onChange={e => setAndPersistUser(e.target.value || null)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold border-0 outline-none flex-1 min-w-[140px]"
              style={{ backgroundColor: activeUser ? "#12a57318" : "#ef444418", color: activeUser ? "#12a573" : "#ef4444" }}
            >
              <option value="">— Select your name —</option>
              {employees.map(e => <option key={e.id} value={e.name}>{e.name} ({e.initials})</option>)}
            </select>
            {!activeUser && (
              <span className="text-[10px] font-bold" style={{ color: "#ef4444" }}>⚠ Required for transactions</span>
            )}
            {activeUser && (
              <span className="text-[10px]" style={{ color: "#12a573" }}>✓ Stock updates in real time</span>
            )}
          </div>
        </WebCard>

        {/* ── Scan / Upload Toolbar ── */}
        <WebCard className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleScanClick}
              disabled={scanMode === "scanning"}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
              style={{ background: "linear-gradient(135deg, #7c3aed, #6366f1)" }}
            >
              <Camera className="w-4 h-4" /> Scan Page
            </button>
            <button
              onClick={handleUploadClick}
              disabled={scanMode === "scanning"}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50"
              style={{ backgroundColor: theme.cardBg, color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}
            >
              <Upload className="w-4 h-4" /> Upload
            </button>
            {scanMode === "scanning" && (
              <div className="flex items-center gap-2 ml-2">
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: theme.accentBlue }} />
                <span className="text-xs" style={{ color: theme.textSecondary }}>{scanProgress}</span>
              </div>
            )}
            {/* AI key embedded — no config needed */}
          </div>
          {/* Hidden file inputs — iOS compatible */}
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", zIndex: -1 }}
            onChange={e => {
              try {
                const f = e.target.files?.[0];
                if (f) { handleImageCapture(f); } else { showToast("⚠ No photo captured"); }
              } catch (err: any) { showToast(`⚠ Camera error: ${err.message}`); }
              e.target.value = "";
            }} />
          <input ref={uploadInputRef} type="file" accept="image/*"
            style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", zIndex: -1 }}
            onChange={e => {
              try {
                const f = e.target.files?.[0];
                if (f) { handleImageCapture(f); } else { showToast("⚠ No file selected"); }
              } catch (err: any) { showToast(`⚠ Upload error: ${err.message}`); }
              e.target.value = "";
            }} />
        </WebCard>

      {/* ── Scanning Indicator (full-width visible feedback) ── */}
      {scanMode === "scanning" && (
        <WebCard className="p-4" style={{ border: "2px solid #7c3aed", background: "linear-gradient(135deg, #1a1033, #0f172a)" }}>
          <div className="flex flex-col items-center gap-3 py-4">
            {scanPreviewUrl && <img src={scanPreviewUrl} alt="Scanning…" className="w-32 h-32 object-cover rounded-xl opacity-70" />}
            <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#7c3aed" }} />
            <span className="text-sm font-bold" style={{ color: "#c4b5fd" }}>{scanProgress || "Processing…"}</span>
          </div>
        </WebCard>
      )}

      {/* ── Scan Results Modal ── */}
      {scanMode === "results" && scanDetected.length > 0 && (
        <WebCard className="p-4 space-y-3" style={{ border: "2px solid #7c3aed" }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Camera className="w-5 h-5" style={{ color: "#7c3aed" }} />
              <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>
                Scan Results — {scanDetected.length} parts detected
              </span>
            </div>
            <button onClick={dismissScan}><X className="w-5 h-5" style={{ color: theme.textMuted }} /></button>
          </div>
          {scanPreviewUrl && (
            <div className="rounded-xl overflow-hidden max-h-40">
              <img src={scanPreviewUrl} alt="Scanned page" className="w-full h-full object-cover" style={{ maxHeight: "160px" }} />
            </div>
          )}
          <div className="space-y-1">
            <div className="grid items-center px-2 py-1 text-[10px] font-bold uppercase tracking-wider"
              style={{ gridTemplateColumns: "24px 1fr 80px 50px", color: theme.textSecondary }}>
              <span></span><span>Part</span><span className="text-center">Section</span><span className="text-center">Qty</span>
            </div>
            {scanDetected.map((d, i) => (
              <div key={i} className="grid items-center px-2 py-2 rounded-lg"
                style={{
                  gridTemplateColumns: "24px 1fr 80px 50px",
                  backgroundColor: d.matched ? "#12a57310" : "#ef444410",
                }}>
                <span>{d.matched ? "✅" : "⚠️"}</span>
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate" style={{ color: d.matched ? "#6366f1" : "#ef4444" }}>
                    {d.part_number}
                  </div>
                  <div className="text-[10px] truncate" style={{ color: theme.textMuted }}>{d.description}</div>
                </div>
                <div className="text-center text-[10px]" style={{ color: theme.textSecondary }}>§{d.section_hint}</div>
                <div className="text-center text-xs font-bold" style={{ color: theme.textPrimary }}>{d.qty}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px]" style={{ color: theme.textMuted }}>
              ✅ {scanDetected.filter(d => d.matched).length} matched · ⚠️ {scanDetected.filter(d => !d.matched).length} unmatched
            </span>
            <div className="flex items-center gap-2">
              <button onClick={dismissScan}
                className="px-4 py-2 rounded-xl text-xs font-bold"
                style={{ backgroundColor: theme.cardBg, color: theme.textSecondary }}>
                Dismiss
              </button>
              <button onClick={applyScanResults}
                disabled={scanDetected.filter(d => d.matched).length === 0}
                className="px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-40"
                style={{ background: "linear-gradient(135deg, #7c3aed, #6366f1)" }}>
                <Check className="w-3.5 h-3.5 inline mr-1" />
                Apply {scanDetected.filter(d => d.matched).length} Parts to Checklist
              </button>
            </div>
          </div>
        </WebCard>
      )}

      {/* API key is embedded — no modal needed */}

      {/* Overall Progress Bar */}
      <WebCard className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold" style={{ color: theme.textSecondary }}>OVERALL PROGRESS</span>
          <span className="text-xs font-bold" style={{ color: theme.textPrimary }}>
            {overallProgress.filledReq}/{overallProgress.totalReq} required · {overallProgress.filledParts}/{overallProgress.totalParts} total
          </span>
        </div>
        <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: "#1e293b" }}>
          <div className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${overallProgress.totalParts > 0 ? (overallProgress.filledParts / overallProgress.totalParts) * 100 : 0}%`,
              backgroundColor: overallProgress.filledReq === overallProgress.totalReq ? "#12a573" : "#6366f1",
            }} />
        </div>
      </WebCard>

      {/* Sections */}
      {modelSections.map(sec => {
        const prog = sectionProgress[sec.section_id];
        const isOpen = !collapsedSections.has(sec.section_id);
        const secParts = modelParts.filter(p => p.section_id === sec.section_id).sort((a, b) => a.sort_order - b.sort_order);
        const allReqDone = prog ? prog.reqFilled === prog.required : false;

        return (
          <WebCard key={sec.section_id} className="overflow-hidden">
            {/* Section Header */}
            <button
              onClick={() => toggleCollapse(sec.section_id)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
              style={{ borderBottom: isOpen ? `1px solid ${theme.cardBorder}` : "none" }}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black"
                  style={{
                    backgroundColor: allReqDone ? "#12a57320" : sec.has_parts ? "#6366f120" : "#64748b20",
                    color: allReqDone ? "#12a573" : sec.has_parts ? "#6366f1" : "#64748b",
                  }}>
                  {allReqDone ? "✓" : sec.section_id}
                </div>
                <div>
                  <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>{sec.section_name}</div>
                  {prog && (
                    <div className="text-[10px] mt-0.5" style={{ color: theme.textMuted }}>
                      {prog.reqFilled}/{prog.required} required · {prog.filled}/{prog.total} total
                    </div>
                  )}
                  {!sec.has_parts && (
                    <div className="text-[10px] mt-0.5" style={{ color: theme.textMuted }}>Service activity — no parts</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {prog && (
                  <div className="w-16 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "#1e293b" }}>
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width: `${prog.total > 0 ? (prog.filled / prog.total) * 100 : 0}%`,
                        backgroundColor: allReqDone ? "#12a573" : "#6366f1",
                      }} />
                  </div>
                )}
                {isOpen ? <ChevronUp className="w-4 h-4" style={{ color: theme.textMuted }} /> : <ChevronDown className="w-4 h-4" style={{ color: theme.textMuted }} />}
              </div>
            </button>

            {/* Section Parts Table */}
            {isOpen && sec.has_parts && secParts.length > 0 && (
              <div className="overflow-x-auto">
                {/* Table Header */}
                <div className="grid items-center px-4 py-2 text-[10px] font-bold uppercase tracking-wider border-b"
                  style={{ gridTemplateColumns: "28px 1fr 100px 70px 70px 70px 70px", borderColor: theme.cardBorder, color: theme.textSecondary, minWidth: "560px" }}>
                  <span></span>
                  <span>Part</span>
                  <span className="text-center">Category</span>
                  <span className="text-center">BOM</span>
                  <span className="text-center">Qty</span>
                  <span className="text-center">QOH</span>
                  <span className="text-center">Status</span>
                </div>
                {/* Part Rows */}
                <div className="divide-y" style={{ borderColor: theme.cardBorder, minWidth: "560px" }}>
                  {secParts.map(ep => {
                    const result = resultsMap.get(`${sec.section_id}::${ep.part_number}`);
                    const scannedQty = result?.scanned_qty || 0;
                    const stockPart = data.parts.find((p: StockPart) => p.partNumber.toUpperCase() === ep.part_number.toUpperCase());
                    const qoh = stockPart?.qoh ?? null;
                    const isSaving = saving === `${sec.section_id}::${ep.part_number}`;
                    const cat = catColor(ep.category);
                    const status = result?.status || "pending";

                    return (
                      <PartRow
                        key={ep.id}
                        partNumber={ep.part_number}
                        description={ep.description}
                        category={ep.category}
                        catStyle={cat}
                        bomQty={ep.bom_qty}
                        scannedQty={scannedQty}
                        qoh={qoh}
                        status={status}
                        isSaving={isSaving}
                        notes={ep.notes}
                        sessionCompleted={false}
                        onQtyChange={(newQty) => updateScannedQty(sec.section_id, ep.part_number, newQty, ep.bom_qty, ep.category, ep.description)}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Service activity section */}
            {isOpen && !sec.has_parts && (
              <div className="px-4 py-4 text-center">
                <div className="text-xs" style={{ color: theme.textMuted }}>
                  {sec.notes || "Service activity — verify and proceed"}
                </div>
              </div>
            )}
          </WebCard>
        );
      })}

      {/* ═══ 5.24 Additional Service ═══ */}
      {activeSessionId && (
        <WebCard className="overflow-hidden">
          <button
            onClick={() => toggleCollapse("5.24")}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
            style={{ borderBottom: !collapsedSections.has("5.24") ? `1px solid ${theme.cardBorder}` : "none" }}
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black"
                style={{ backgroundColor: "#f59e0b20", color: "#f59e0b" }}>
                5.24
              </div>
              <div>
                <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>Additional Service</div>
                <div className="text-[10px] mt-0.5" style={{ color: theme.textMuted }}>
                  Not included in XLMR Checklist · Manual entry
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: "#f59e0b20", color: "#f59e0b" }}>
                {scanResults.filter(r => r.section_id === "5.24" && r.session_id === activeSessionId).length} parts
              </span>
              {!collapsedSections.has("5.24") ? <ChevronUp className="w-4 h-4" style={{ color: theme.textMuted }} /> : <ChevronDown className="w-4 h-4" style={{ color: theme.textMuted }} />}
            </div>
          </button>

          {!collapsedSections.has("5.24") && (
            <div className="px-4 py-3 space-y-3">
              {/* Add Part Form */}
              <div className="p-3 rounded-xl space-y-2" style={{ backgroundColor: theme.inputBg }}>
                <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#f59e0b" }}>+ Add Part</div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    value={addPartNumber}
                    onChange={e => setAddPartNumber(e.target.value)}
                    placeholder="Part # (e.g. J56802)"
                    className="px-2.5 py-2 rounded-lg text-xs border-0 outline-none"
                    style={{ backgroundColor: theme.cardBg, color: theme.textPrimary }}
                  />
                  <input
                    value={addPartDesc}
                    onChange={e => setAddPartDesc(e.target.value)}
                    placeholder="Description"
                    className="px-2.5 py-2 rounded-lg text-xs border-0 outline-none"
                    style={{ backgroundColor: theme.cardBg, color: theme.textPrimary }}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    value={addPartSection}
                    onChange={e => setAddPartSection(e.target.value)}
                    placeholder="Ref section (e.g. 5.9)"
                    className="px-2.5 py-2 rounded-lg text-xs border-0 outline-none"
                    style={{ backgroundColor: theme.cardBg, color: theme.textPrimary }}
                  />
                  <input
                    type="number"
                    value={addPartQty}
                    onChange={e => setAddPartQty(e.target.value)}
                    placeholder="Qty"
                    min="1"
                    className="px-2.5 py-2 rounded-lg text-xs border-0 outline-none text-center"
                    style={{ backgroundColor: theme.cardBg, color: theme.textPrimary }}
                  />
                  <button
                    onClick={addManualPart}
                    disabled={!addPartNumber.trim() || !!saving}
                    className="px-3 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-40 flex items-center justify-center gap-1"
                    style={{ backgroundColor: "#f59e0b" }}
                  >
                    <Plus className="w-3 h-3" /> Add
                  </button>
                </div>
              </div>

              {/* List of added parts */}
              {(() => {
                const addlParts = scanResults.filter(r => r.section_id === "5.24" && r.session_id === activeSessionId);
                if (addlParts.length === 0) return (
                  <div className="text-center py-3">
                    <div className="text-xs" style={{ color: theme.textMuted }}>No additional service parts added yet</div>
                  </div>
                );
                return (
                  <div className="overflow-x-auto">
                    <div className="grid items-center px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider border-b"
                      style={{ gridTemplateColumns: "1fr 80px 60px 60px 36px", borderColor: theme.cardBorder, color: theme.textSecondary, minWidth: "380px" }}>
                      <span>Part</span>
                      <span className="text-center">Ref §</span>
                      <span className="text-center">Qty</span>
                      <span className="text-center">QOH</span>
                      <span></span>
                    </div>
                    <div className="divide-y" style={{ borderColor: theme.cardBorder, minWidth: "380px" }}>
                      {addlParts.map(r => {
                        const stockPart = data.parts.find((p: StockPart) => p.partNumber.toUpperCase() === r.part_number.toUpperCase());
                        const qoh = stockPart?.qoh ?? "—";
                        // Extract ref section from description if present
                        const refMatch = (r.description ?? "").match(/\(ref §([\d.]+)\)/);
                        const refSec = refMatch ? refMatch[1] : "—";
                        const cleanDesc = (r.description ?? "").replace(/\s*\(ref §[\d.]+\)/, "");
                        return (
                          <div key={r.id} className="grid items-center px-2 py-2.5"
                            style={{ gridTemplateColumns: "1fr 80px 60px 60px 36px" }}>
                            <div>
                              <div className="text-xs font-bold" style={{ color: "#f59e0b" }}>{r.part_number}</div>
                              <div className="text-[10px] truncate" style={{ color: theme.textMuted }}>{cleanDesc}</div>
                            </div>
                            <div className="text-xs text-center" style={{ color: theme.textSecondary }}>{refSec}</div>
                            <div className="text-xs text-center font-bold" style={{ color: theme.textPrimary }}>{r.scanned_qty}</div>
                            <div className="text-xs text-center" style={{ color: theme.textMuted }}>{qoh}</div>
                            <button
                              onClick={() => deleteManualPart(r.id, r.part_number)}
                              className="flex items-center justify-center"
                            >
                              <Trash2 className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </WebCard>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl text-sm font-bold shadow-lg z-50"
          style={{ backgroundColor: theme.cardBg, color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>
          {toast}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════
// PART ROW COMPONENT
// ════════════════════════════════════════════════
function PartRow({
  partNumber, description, category, catStyle, bomQty, scannedQty, qoh, status, isSaving, notes, sessionCompleted, onQtyChange,
}: {
  partNumber: string;
  description: string;
  category: string;
  catStyle: { bg: string; text: string; border: string; label: string };
  bomQty: number;
  scannedQty: number;
  qoh: number | null;
  status: string;
  isSaving: boolean;
  notes: string | null;
  sessionCompleted?: boolean;
  onQtyChange: (qty: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(String(scannedQty));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(String(scannedQty));
  }, [scannedQty]);

  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);

  const commitEdit = () => {
    const val = parseInt(editValue) || 0;
    if (val !== scannedQty && val >= 0) {
      onQtyChange(val);
    }
    setEditing(false);
  };

  // Quick-fill: click BOM qty to auto-fill
  const quickFill = () => {
    if (scannedQty === 0 && bomQty > 0) {
      onQtyChange(bomQty);
    }
  };

  return (
    <div className="grid items-center px-4 py-2.5 gap-2 group"
      style={{
        gridTemplateColumns: "28px 1fr 100px 70px 70px 70px 70px",
        backgroundColor: status === "matched" ? "#12a57308" : status === "short" ? "#ef444408" : "transparent",
      }}>
      {/* Status icon */}
      <div className="flex justify-center">
        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" style={{ color: theme.accentBlue }} /> : statusIcon(status)}
      </div>

      {/* Part info */}
      <div className="min-w-0">
        <div className="text-sm font-medium truncate" style={{ color: "#6366f1" }}>{partNumber}</div>
        <div className="text-[10px] truncate" style={{ color: theme.textMuted }}>
          {description}
          {notes && <span className="ml-1 italic" style={{ color: theme.warning }}>({notes})</span>}
        </div>
      </div>

      {/* Category badge */}
      <div className="flex justify-center">
        <span className="px-2 py-0.5 rounded text-[9px] font-bold"
          style={{ backgroundColor: catStyle.bg, color: catStyle.text, border: `1px solid ${catStyle.border}` }}>
          {catStyle.label}
        </span>
      </div>

      {/* BOM Qty — clickable to quick-fill */}
      <div className="text-center">
        <button
          onClick={quickFill}
          className="text-sm font-bold hover:underline"
          style={{ color: theme.textPrimary }}
          title="Click to auto-fill"
        >
          {bomQty}
        </button>
      </div>

      {/* Scanned Qty — editable */}
      <div className="flex justify-center">
        {editing ? (
          <input
            ref={inputRef}
            type="number"
            min={0}
            value={editValue}
            onChange={e => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={e => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") { setEditValue(String(scannedQty)); setEditing(false); } }}
            className="w-14 px-1 py-0.5 rounded text-center text-sm font-bold border-0 outline-none"
            style={{ backgroundColor: theme.inputBg, color: theme.textPrimary, border: `2px solid ${theme.accentBlue}` }}
          />
        ) : (
          <button
            onClick={() => !sessionCompleted && setEditing(true)}
            className="w-14 py-0.5 rounded text-center text-sm font-bold transition-colors"
            style={{
              backgroundColor: scannedQty > 0 ? "#12a57320" : theme.inputBg,
              color: scannedQty > 0 ? "#12a573" : theme.textMuted,
              cursor: sessionCompleted ? "default" : "pointer",
            }}
            title={sessionCompleted ? "Session completed" : "Click to edit"}
          >
            {scannedQty || "—"}
          </button>
        )}
      </div>

      {/* Current QOH */}
      <div className="text-center text-xs font-medium" style={{ color: qoh !== null ? (qoh <= 0 ? "#ef4444" : theme.textSecondary) : theme.textMuted }}>
        {qoh !== null ? qoh : "—"}
      </div>

      {/* Status text */}
      <div className="text-center">
        <span className="text-[10px] font-bold"
          style={{
            color: status === "matched" ? "#12a573" : status === "short" ? "#ef4444" : status === "over" ? "#14b8d4" : theme.textMuted,
          }}>
          {status === "pending" ? "—" : status.toUpperCase()}
        </span>
      </div>
    </div>
  );
}
