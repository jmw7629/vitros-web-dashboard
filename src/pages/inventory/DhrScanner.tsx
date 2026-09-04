import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Download,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { WebCard, theme } from "../../components/vitros/SharedComponents";
import { useConvexData } from "../../hooks/useConvexData";
import { useServerActions, type DhrTransitionReceipt } from "../../hooks/useServerActions";

interface DhrSection {
  id: string;
  analyzer_model: string;
  section_id: string;
  section_name: string;
  section_type: string | null;
  has_parts: boolean | null;
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
  sort_order: number | null;
}

interface DhrSession {
  id: string;
  instrument_sn: string;
  wo_number: string | null;
  analyzer_model: string;
  started_at: string | null;
  completed_at: string | null;
  status: string | null;
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
  status: string | null;
  stock_before: number | null;
  stock_after: number | null;
  stock_id: string | null;
  scanned_at: string | null;
  scanned_by: string | null;
  notes: string | null;
  revision: number;
}

interface DhrEmployee {
  id: string;
  name: string;
  initials: string;
  active: boolean;
}

interface OcrDraftRow {
  id: string;
  partNumber: string;
  description: string;
  qty: number;
  sectionHint: string;
  sectionId: string | null;
  matched: boolean;
  reason?: string;
}

function canonicalPart(partNumber: string) {
  return partNumber.trim().toUpperCase();
}

function resultKey(sectionId: string, partNumber: string) {
  return `${sectionId}::${canonicalPart(partNumber)}`;
}

function sectionSort(a: string, b: string) {
  const aNumber = Number(a);
  const bNumber = Number(b);
  if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
  return a.localeCompare(b, undefined, { numeric: true });
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Operation failed";
  if (/revision conflict/i.test(message)) return "This DHR line changed on another device. The latest value has been reloaded.";
  if (/part not found/i.test(message)) return "Part number is not present in Stock Summary. Nothing was consumed.";
  if (/ambiguous canonical/i.test(message)) return "This part number is ambiguous in the inventory master. Nothing was consumed.";
  if (/insufficient|negative/i.test(message)) return "There is not enough available stock for this DHR quantity.";
  return message.slice(0, 240);
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function categoryStyle(category: string) {
  switch (category.toLowerCase()) {
    case "required": return { bg: "#ef444418", text: "#ef4444", border: "#ef444440", label: "REQ" };
    case "optional": return { bg: "#6366f118", text: "#818cf8", border: "#6366f140", label: "OPT" };
    case "tool": return { bg: "#f59e0f18", text: "#f59e0b", border: "#f59e0f40", label: "TOOL" };
    default: return { bg: "#64748b18", text: "#94a3b8", border: "#64748b40", label: category.toUpperCase() };
  }
}

function receiptMessage(receipt: DhrTransitionReceipt) {
  if (receipt.duplicate) return "Already synchronized — no duplicate inventory movement was created.";
  if (receipt.delta > 0) return `Consumed ${receipt.delta} from Stock Summary.`;
  if (receipt.delta < 0) return `Returned ${Math.abs(receipt.delta)} to Stock Summary.`;
  return "DHR line synchronized. No inventory movement was required.";
}

async function fileToBase64(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("Unable to read DHR image"));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("Unable to read DHR image"));
    reader.readAsDataURL(file);
  });
}

function parseOcrPayload(raw: string): unknown[] {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const parsed = JSON.parse(cleaned) as unknown;
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const candidate = parsed as Record<string, unknown>;
    if (Array.isArray(candidate.parts)) return candidate.parts;
    if (Array.isArray(candidate.lines)) return candidate.lines;
    if (Array.isArray(candidate.items)) return candidate.items;
  }
  throw new Error("DHR OCR did not return a reviewable part list");
}

export function DhrScanner() {
  const data = useConvexData();
  const {
    loadDhrScannerData,
    loadDhrSessionResults,
    createDhrScannerSession,
    setDhrScannerSessionLifecycle,
    applyDhrChecklistChange,
    ocrDhrPage,
  } = useServerActions();

  const [sections, setSections] = useState<DhrSection[]>([]);
  const [expectedParts, setExpectedParts] = useState<DhrExpectedPart[]>([]);
  const [sessions, setSessions] = useState<DhrSession[]>([]);
  const [employees, setEmployees] = useState<DhrEmployee[]>([]);
  const [scanResults, setScanResults] = useState<DhrScanResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [view, setView] = useState<"sessions" | "checklist">("sessions");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionFilter, setSessionFilter] = useState<"active" | "archived">("active");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [showNewSession, setShowNewSession] = useState(false);
  const [newSN, setNewSN] = useState("");
  const [newWO, setNewWO] = useState("");
  const [newModel, setNewModel] = useState("5600");

  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrRows, setOcrRows] = useState<OcrDraftRow[]>([]);
  const [ocrPreview, setOcrPreview] = useState<string | null>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const [manualPartNumber, setManualPartNumber] = useState("");
  const [manualDescription, setManualDescription] = useState("");
  const [manualQty, setManualQty] = useState("1");

  const resultPollBusy = useRef(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    if (ocrPreview) URL.revokeObjectURL(ocrPreview);
  }, [ocrPreview]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  const configuredModels = useMemo(() => {
    const models = Array.from(new Set(sections.map((section) => section.analyzer_model).filter(Boolean))).sort();
    return models.length > 0 ? models : ["5600"];
  }, [sections]);

  useEffect(() => {
    if (!configuredModels.includes(newModel)) setNewModel(configuredModels[0]);
  }, [configuredModels, newModel]);

  const modelSections = useMemo(() => {
    const model = activeSession?.analyzer_model || newModel;
    return sections
      .filter((section) => section.analyzer_model === model)
      .slice()
      .sort((a, b) => sectionSort(a.section_id, b.section_id));
  }, [sections, activeSession, newModel]);

  const modelExpectedParts = useMemo(() => {
    const model = activeSession?.analyzer_model || newModel;
    return expectedParts.filter((part) => part.analyzer_model === model);
  }, [expectedParts, activeSession, newModel]);

  const resultsMap = useMemo(() => {
    const map = new Map<string, DhrScanResult>();
    for (const result of scanResults) map.set(resultKey(result.section_id, result.part_number), result);
    return map;
  }, [scanResults]);

  const loadBootstrap = useCallback(async () => {
    setLoadError(null);
    const bootstrap = await loadDhrScannerData();
    setSections(bootstrap.sections as unknown as DhrSection[]);
    setExpectedParts(bootstrap.expectedParts as unknown as DhrExpectedPart[]);
    setSessions(bootstrap.sessions as unknown as DhrSession[]);
    setEmployees(bootstrap.employees as unknown as DhrEmployee[]);
  }, [loadDhrScannerData]);

  const refreshSessionResults = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    const rows = await loadDhrSessionResults(sessionId);
    setScanResults(rows as unknown as DhrScanResult[]);
  }, [loadDhrSessionResults]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        await loadBootstrap();
      } catch (error) {
        setLoadError(safeError(error));
      } finally {
        setLoading(false);
      }
    })();
  }, [loadBootstrap]);

  useEffect(() => {
    if (!activeSessionId) {
      setScanResults([]);
      return;
    }
    void refreshSessionResults(activeSessionId).catch((error) => setLoadError(safeError(error)));
  }, [activeSessionId, refreshSessionResults]);

  // Bounded, jittered authoritative reconciliation for shared DHR sessions. Own writes
  // refresh immediately; this poll is the cross-browser fallback until subscriptions land.
  useEffect(() => {
    if (!activeSessionId || view !== "checklist") return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      if (!cancelled && document.visibilityState === "visible" && !resultPollBusy.current) {
        resultPollBusy.current = true;
        try {
          await refreshSessionResults(activeSessionId);
        } catch {
          // A transient reconciliation failure must not overwrite the last authoritative state.
        } finally {
          resultPollBusy.current = false;
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, 1650 + Math.random() * 450);
    };
    timer = window.setTimeout(poll, 1300 + Math.random() * 400);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeSessionId, refreshSessionResults, view]);

  const filteredSessions = useMemo(() => sessions.filter((session) => {
    const archived = session.status === "completed";
    return sessionFilter === "archived" ? archived : !archived;
  }), [sessions, sessionFilter]);

  const progress = useMemo(() => {
    let required = 0;
    let requiredComplete = 0;
    let recorded = 0;
    for (const part of modelExpectedParts) {
      const result = resultsMap.get(resultKey(part.section_id, part.part_number));
      if (result) recorded += 1;
      if (part.category === "required") {
        required += 1;
        if (result && result.scanned_qty >= part.bom_qty) requiredComplete += 1;
      }
    }
    return { required, requiredComplete, recorded, total: modelExpectedParts.length };
  }, [modelExpectedParts, resultsMap]);

  const createSession = async () => {
    if (!newSN.trim()) {
      showToast("Instrument serial number is required.");
      return;
    }
    setLifecycleBusy(true);
    try {
      const created = await createDhrScannerSession({
        instrumentSn: newSN,
        woNumber: newWO.trim() || undefined,
        analyzerModel: newModel,
      }) as unknown as DhrSession;
      await loadBootstrap();
      setActiveSessionId(created.id);
      setView("checklist");
      setShowNewSession(false);
      setNewSN("");
      setNewWO("");
      showToast(`DHR session created for ${created.instrument_sn}.`);
    } catch (error) {
      showToast(safeError(error));
    } finally {
      setLifecycleBusy(false);
    }
  };

  const setLifecycle = async (status: "in_progress" | "completed") => {
    if (!activeSession) return;
    setLifecycleBusy(true);
    try {
      await setDhrScannerSessionLifecycle({ sessionId: activeSession.id, status });
      await loadBootstrap();
      showToast(status === "completed"
        ? "DHR finalized. Finalization did not change inventory."
        : "DHR reopened. Existing consumption history remains intact.");
    } catch (error) {
      showToast(safeError(error));
    } finally {
      setLifecycleBusy(false);
    }
  };

  const applyQuantity = useCallback(async (
    sectionId: string,
    partNumber: string,
    newQty: number,
    expectedQty: number,
    category: string,
    description: string,
  ) => {
    if (!activeSession) return;
    if (!Number.isInteger(newQty) || newQty < 0) {
      showToast("DHR quantity must be a non-negative whole number.");
      return;
    }
    const key = resultKey(sectionId, partNumber);
    const existing = resultsMap.get(key);
    setSavingKey(key);
    try {
      const receipt = await applyDhrChecklistChange({
        sessionId: activeSession.id,
        sectionId,
        partNumber,
        expectedQty,
        newQty,
        category,
        description,
        expectedRevision: existing?.revision ?? 0,
        analyzerSerial: activeSession.instrument_sn,
      });
      await Promise.all([
        refreshSessionResults(activeSession.id),
        data.refresh(),
      ]);
      showToast(receiptMessage(receipt));
    } catch (error) {
      try {
        await refreshSessionResults(activeSession.id);
        await data.refresh();
      } catch {
        // Preserve the original mutation error; the next reconciliation poll will retry the read.
      }
      showToast(safeError(error));
    } finally {
      setSavingKey(null);
    }
  }, [activeSession, applyDhrChecklistChange, data, refreshSessionResults, resultsMap, showToast]);

  const addManualPart = async () => {
    if (!activeSession) return;
    const partNumber = canonicalPart(manualPartNumber);
    const qty = Number(manualQty);
    if (!partNumber) {
      showToast("Part number is required.");
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      showToast("Additional Service quantity must be a positive whole number.");
      return;
    }
    const existing = resultsMap.get(resultKey("5.24", partNumber));
    if (existing) {
      showToast("That Additional Service part is already listed. Edit its quantity instead.");
      return;
    }
    await applyQuantity("5.24", partNumber, qty, qty, "optional", manualDescription.trim() || "Additional Service part");
    setManualPartNumber("");
    setManualDescription("");
    setManualQty("1");
  };

  const processDhrImage = async (file: File) => {
    if (!activeSession) return;
    if (!file.type.startsWith("image/")) {
      showToast("DHR OCR currently accepts image files. Use a page photo or image export.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast("DHR image is larger than the 10 MB OCR limit.");
      return;
    }

    setOcrBusy(true);
    setOcrRows([]);
    if (ocrPreview) URL.revokeObjectURL(ocrPreview);
    setOcrPreview(URL.createObjectURL(file));
    try {
      const imageBase64 = await fileToBase64(file);
      const raw = await ocrDhrPage({
        imageBase64,
        partList: modelExpectedParts.map((part) => part.part_number),
        prompt: `Read this VITROS ${activeSession.analyzer_model} DHR/checklist page. Extract only actual part-consumption or tool checklist rows. Return ONLY a JSON array with {"part_number":"string","description":"string","qty":integer,"section_hint":"string"}. Preserve an explicit printed quantity of 0 as 0. Never infer a part from description. Never treat packing-list SHIP QTY/ORDER QTY fields as DHR consumption. Do not invent a part number or quantity.`,
      });
      const parsed = parseOcrPayload(raw);
      const reviewRows: OcrDraftRow[] = [];
      parsed.forEach((item, index) => {
        if (!item || typeof item !== "object") return;
        const row = item as Record<string, unknown>;
        const partNumber = canonicalPart(String(row.part_number ?? row.partNumber ?? ""));
        const description = String(row.description ?? "").trim();
        const sectionHint = String(row.section_hint ?? row.sectionHint ?? "").trim();
        const qtyRaw = row.qty ?? row.quantity;
        if (!partNumber || typeof qtyRaw !== "number" || !Number.isFinite(qtyRaw) || !Number.isInteger(qtyRaw) || qtyRaw < 0) {
          reviewRows.push({
            id: `${Date.now()}-${index}`,
            partNumber: partNumber || "Unreadable",
            description,
            qty: typeof qtyRaw === "number" && Number.isFinite(qtyRaw) ? qtyRaw : -1,
            sectionHint,
            sectionId: null,
            matched: false,
            reason: "Part number or non-negative whole quantity needs review",
          });
          return;
        }

        const matches = modelExpectedParts.filter((part) => canonicalPart(part.part_number) === partNumber);
        let matchedPart: DhrExpectedPart | undefined;
        if (matches.length === 1) matchedPart = matches[0];
        else if (matches.length > 1 && sectionHint) {
          const hinted = matches.filter((part) => part.section_id === sectionHint);
          if (hinted.length === 1) matchedPart = hinted[0];
        }
        reviewRows.push({
          id: `${Date.now()}-${index}`,
          partNumber,
          description: description || matchedPart?.description || "",
          qty: qtyRaw,
          sectionHint,
          sectionId: matchedPart?.section_id ?? null,
          matched: !!matchedPart,
          reason: matchedPart ? undefined : matches.length > 1 ? "Part exists in multiple DHR sections; verify manually" : "Not an exact expected-part match",
        });
      });
      setOcrRows(reviewRows);
      showToast(reviewRows.length ? "DHR OCR complete. Review each row before applying it." : "No reviewable DHR part rows were detected.");
    } catch (error) {
      showToast(safeError(error));
    } finally {
      setOcrBusy(false);
    }
  };

  const applyOcrRow = async (row: OcrDraftRow) => {
    if (!row.matched || !row.sectionId || row.qty < 0) return;
    const expected = modelExpectedParts.find(
      (part) => part.section_id === row.sectionId && canonicalPart(part.part_number) === canonicalPart(row.partNumber),
    );
    if (!expected) {
      showToast("OCR row no longer matches the configured DHR. Nothing was changed.");
      return;
    }
    await applyQuantity(
      expected.section_id,
      expected.part_number,
      row.qty,
      expected.bom_qty,
      expected.category,
      expected.description,
    );
    setOcrRows((current) => current.filter((candidate) => candidate.id !== row.id));
  };

  const exportDhr = () => {
    if (!activeSession) return;
    const rows = scanResults
      .slice()
      .sort((a, b) => sectionSort(a.section_id, b.section_id) || a.part_number.localeCompare(b.part_number))
      .map((result) => ({
        Section: result.section_id,
        "Part Number": result.part_number,
        Description: result.description || "",
        "Expected / BOM Qty": result.expected_qty,
        "Scanned / Consumed Qty": result.scanned_qty,
        Status: result.status || "pending",
        "Stock Before": result.stock_before ?? "",
        "Stock After": result.stock_after ?? "",
        "User / Initials": result.scanned_by || "",
        Revision: result.revision,
        "Last Revised At": result.scanned_at || "",
      }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "DHR Consumption");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    saveAs(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `DHR_${activeSession.instrument_sn}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-3 h-7 w-7 animate-spin" style={{ color: theme.accentBlue }} />
          <div className="text-sm font-semibold" style={{ color: theme.textSecondary }}>Loading secure DHR workspace…</div>
        </div>
      </div>
    );
  }

  if (loadError && sections.length === 0) {
    return (
      <WebCard className="p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5" style={{ color: "#f59e0b" }} />
          <div className="flex-1">
            <h2 className="text-base font-bold" style={{ color: theme.textPrimary }}>DHR Scanner unavailable</h2>
            <p className="mt-1 text-sm" style={{ color: theme.textSecondary }}>{loadError}</p>
            <button
              onClick={() => void loadBootstrap().then(() => setLoadError(null)).catch((error) => setLoadError(safeError(error)))}
              className="mt-4 rounded-lg px-3 py-2 text-xs font-bold"
              style={{ backgroundColor: theme.inputBg, color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}
            >
              Retry secure load
            </button>
          </div>
        </div>
      </WebCard>
    );
  }

  if (view === "sessions") {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>DHR Scanner</h2>
            <p className="mt-0.5 text-sm" style={{ color: theme.textSecondary }}>
              Controlled checklist consumption with atomic inventory, immutable movement history, and server-side OCR
            </p>
          </div>
          <button
            onClick={() => setShowNewSession(true)}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white"
            style={{ backgroundColor: theme.accentBlue }}
          >
            <Plus className="h-4 w-4" /> New DHR
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <WebCard className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>Active DHRs</div>
            <div className="mt-1 text-2xl font-bold" style={{ color: theme.textPrimary }}>{sessions.filter((session) => session.status !== "completed").length}</div>
          </WebCard>
          <WebCard className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>Archived</div>
            <div className="mt-1 text-2xl font-bold" style={{ color: theme.textPrimary }}>{sessions.filter((session) => session.status === "completed").length}</div>
          </WebCard>
          <WebCard className="p-4">
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>Active Operators</div>
            <div className="mt-1 text-2xl font-bold" style={{ color: theme.textPrimary }}>{employees.length}</div>
          </WebCard>
        </div>

        <div className="flex gap-2">
          {(["active", "archived"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setSessionFilter(filter)}
              className="rounded-lg px-3 py-1.5 text-xs font-bold"
              style={{
                backgroundColor: sessionFilter === filter ? `${theme.accentBlue}24` : theme.inputBg,
                color: sessionFilter === filter ? theme.accentBlue : theme.textSecondary,
                border: `1px solid ${sessionFilter === filter ? `${theme.accentBlue}55` : theme.cardBorder}`,
              }}
            >
              {filter === "active" ? "Active" : "Archived"}
            </button>
          ))}
        </div>

        <WebCard className="overflow-hidden">
          {filteredSessions.length === 0 ? (
            <div className="p-8 text-center">
              <ClipboardList className="mx-auto mb-2 h-7 w-7" style={{ color: theme.textMuted }} />
              <div className="text-sm" style={{ color: theme.textSecondary }}>No {sessionFilter} DHR sessions.</div>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
              {filteredSessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => {
                    setActiveSessionId(session.id);
                    setView("checklist");
                  }}
                  className="grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition-colors hover:bg-white/[0.02] sm:grid-cols-[1.2fr_1fr_1fr_1.2fr_auto] sm:items-center"
                >
                  <div>
                    <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>{session.instrument_sn}</div>
                    <div className="text-[10px]" style={{ color: theme.textMuted }}>Serial number</div>
                  </div>
                  <div className="text-xs" style={{ color: theme.textSecondary }}>WO {session.wo_number || "—"}</div>
                  <div className="text-xs" style={{ color: theme.textSecondary }}>{session.analyzer_model}</div>
                  <div className="text-xs" style={{ color: theme.textMuted }}>{session.started_by || "Server-authenticated operator"}</div>
                  <div className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase" style={{ backgroundColor: session.status === "completed" ? "#64748b20" : "#12a57320", color: session.status === "completed" ? "#94a3b8" : "#12a573" }}>
                    {session.status === "completed" ? "Archived" : "In progress"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </WebCard>

        {showNewSession && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !lifecycleBusy && setShowNewSession(false)}>
            <WebCard className="w-full max-w-lg p-5" onClick={(event) => event.stopPropagation()}>
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-bold" style={{ color: theme.textPrimary }}>Create DHR Session</h3>
                  <p className="text-xs" style={{ color: theme.textMuted }}>Operator identity is resolved by the server.</p>
                </div>
                <button onClick={() => !lifecycleBusy && setShowNewSession(false)} aria-label="Close"><X className="h-5 w-5" style={{ color: theme.textMuted }} /></button>
              </div>
              <div className="space-y-3">
                <label className="block text-xs font-semibold" style={{ color: theme.textSecondary }}>
                  Instrument Serial
                  <input value={newSN} onChange={(event) => setNewSN(event.target.value)} maxLength={80} className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ backgroundColor: theme.inputBg, color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }} />
                </label>
                <label className="block text-xs font-semibold" style={{ color: theme.textSecondary }}>
                  Work Order
                  <input value={newWO} onChange={(event) => setNewWO(event.target.value)} maxLength={80} className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ backgroundColor: theme.inputBg, color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }} />
                </label>
                <label className="block text-xs font-semibold" style={{ color: theme.textSecondary }}>
                  Analyzer Model
                  <select value={newModel} onChange={(event) => setNewModel(event.target.value)} className="mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none" style={{ backgroundColor: theme.inputBg, color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>
                    {configuredModels.map((model) => <option key={model} value={model}>{model}</option>)}
                  </select>
                </label>
              </div>
              <div className="mt-5 flex justify-end gap-2">
                <button onClick={() => setShowNewSession(false)} disabled={lifecycleBusy} className="rounded-lg px-3 py-2 text-xs font-bold" style={{ color: theme.textSecondary }}>Cancel</button>
                <button onClick={() => void createSession()} disabled={lifecycleBusy} className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold text-white disabled:opacity-60" style={{ backgroundColor: theme.accentBlue }}>
                  {lifecycleBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Create
                </button>
              </div>
            </WebCard>
          </div>
        )}

        {toast && <Toast message={toast} />}
      </div>
    );
  }

  if (!activeSession) {
    return (
      <WebCard className="p-6 text-center">
        <p className="text-sm" style={{ color: theme.textSecondary }}>The selected DHR session is no longer available.</p>
        <button onClick={() => setView("sessions")} className="mt-3 text-sm font-bold" style={{ color: theme.accentBlue }}>Return to DHR sessions</button>
      </WebCard>
    );
  }

  const completed = activeSession.status === "completed";
  const additionalResults = scanResults.filter((result) => result.section_id === "5.24" && !modelExpectedParts.some(
    (part) => part.section_id === "5.24" && canonicalPart(part.part_number) === canonicalPart(result.part_number),
  ));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button onClick={() => { setView("sessions"); setActiveSessionId(null); setScanResults([]); }} className="mt-0.5 rounded-lg p-2" style={{ backgroundColor: theme.inputBg, color: theme.textSecondary }} aria-label="Back to DHR sessions">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>DHR {activeSession.instrument_sn}</h2>
              <span className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase" style={{ backgroundColor: completed ? "#64748b20" : "#12a57320", color: completed ? "#94a3b8" : "#12a573" }}>{completed ? "Archived" : "Live"}</span>
            </div>
            <p className="mt-0.5 text-sm" style={{ color: theme.textSecondary }}>
              {activeSession.analyzer_model} · WO {activeSession.wo_number || "—"} · {activeSession.started_by || "Authenticated operator"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void refreshSessionResults(activeSession.id).then(() => data.refresh()).catch((error) => showToast(safeError(error)))} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold" style={{ backgroundColor: theme.inputBg, color: theme.textSecondary, border: `1px solid ${theme.cardBorder}` }}>
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
          <button onClick={exportDhr} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold" style={{ backgroundColor: theme.inputBg, color: theme.textSecondary, border: `1px solid ${theme.cardBorder}` }}>
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          {completed ? (
            <button disabled={lifecycleBusy} onClick={() => void setLifecycle("in_progress")} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-60" style={{ backgroundColor: "#f59e0f18", color: "#f59e0b", border: "1px solid #f59e0f35" }}>
              <RotateCcw className="h-3.5 w-3.5" /> Reopen
            </button>
          ) : (
            <button disabled={lifecycleBusy} onClick={() => void setLifecycle("completed")} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold text-white disabled:opacity-60" style={{ backgroundColor: "#12a573" }}>
              <Send className="h-3.5 w-3.5" /> Finalize
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <WebCard className="p-4"><Metric label="Required complete" value={`${progress.requiredComplete}/${progress.required}`} /></WebCard>
        <WebCard className="p-4"><Metric label="Recorded rows" value={`${progress.recorded}/${progress.total}`} /></WebCard>
        <WebCard className="p-4"><Metric label="Atomic events" value={String(scanResults.reduce((sum, result) => sum + Math.max(0, result.revision), 0))} /></WebCard>
        <WebCard className="p-4"><Metric label="Last sync" value={scanResults.length ? formatTimestamp(scanResults.reduce((latest, result) => !latest || (result.scanned_at || "") > latest ? result.scanned_at : latest, null as string | null)) : "—"} small /></WebCard>
      </div>

      {!completed && (
        <WebCard className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>DHR Page OCR</div>
              <div className="mt-0.5 text-xs" style={{ color: theme.textMuted }}>Image stays in memory and is sent to the private server OCR gateway. Every detected row requires human confirmation.</div>
            </div>
            <div className="flex gap-2">
              <button disabled={ocrBusy} onClick={() => cameraInputRef.current?.click()} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-60" style={{ backgroundColor: `${theme.accentBlue}18`, color: theme.accentBlue, border: `1px solid ${theme.accentBlue}35` }}>
                {ocrBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />} Camera
              </button>
              <button disabled={ocrBusy} onClick={() => uploadInputRef.current?.click()} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-60" style={{ backgroundColor: theme.inputBg, color: theme.textSecondary, border: `1px solid ${theme.cardBorder}` }}>
                <Upload className="h-3.5 w-3.5" /> Upload image
              </button>
              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void processDhrImage(file); }} />
              <input ref={uploadInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void processDhrImage(file); }} />
            </div>
          </div>

          {(ocrPreview || ocrRows.length > 0) && (
            <div className="mt-4 grid gap-4 lg:grid-cols-[220px_1fr]">
              {ocrPreview && <img src={ocrPreview} alt="DHR page awaiting OCR review" className="max-h-64 w-full rounded-lg object-contain" style={{ backgroundColor: "#020617", border: `1px solid ${theme.cardBorder}` }} />}
              <div className="min-w-0 space-y-2">
                {ocrRows.length === 0 && !ocrBusy && <div className="rounded-lg p-3 text-xs" style={{ backgroundColor: theme.inputBg, color: theme.textMuted }}>No review rows are pending.</div>}
                {ocrRows.map((row) => (
                  <div key={row.id} className="grid gap-2 rounded-lg p-3 sm:grid-cols-[1fr_70px_110px] sm:items-center" style={{ backgroundColor: theme.inputBg, border: `1px solid ${row.matched ? "#12a57335" : "#f59e0f35"}` }}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold" style={{ color: row.matched ? "#818cf8" : "#f59e0b" }}>{row.partNumber}</span>
                        <span className="text-[10px]" style={{ color: theme.textMuted }}>{row.sectionId ? `§${row.sectionId}` : row.sectionHint ? `OCR §${row.sectionHint}` : "No section match"}</span>
                      </div>
                      <div className="truncate text-[10px]" style={{ color: theme.textSecondary }}>{row.description || row.reason || "—"}</div>
                      {!row.matched && <div className="mt-0.5 text-[10px]" style={{ color: "#f59e0b" }}>{row.reason}</div>}
                    </div>
                    <div className="text-center text-sm font-bold" style={{ color: row.qty >= 0 ? theme.textPrimary : "#ef4444" }}>Qty {row.qty >= 0 ? row.qty : "?"}</div>
                    <button disabled={!row.matched || row.qty < 0 || !!savingKey} onClick={() => void applyOcrRow(row)} className="rounded-lg px-3 py-2 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-40" style={{ backgroundColor: row.matched ? "#12a57320" : theme.cardBg, color: row.matched ? "#12a573" : theme.textMuted }}>
                      Confirm & apply
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </WebCard>
      )}

      <div className="space-y-3">
        {modelSections.filter((section) => section.has_parts !== false).map((section) => {
          const sectionParts = modelExpectedParts
            .filter((part) => part.section_id === section.section_id)
            .slice()
            .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
          const isCollapsed = collapsed.has(section.section_id);
          const recorded = sectionParts.filter((part) => resultsMap.has(resultKey(part.section_id, part.part_number))).length;
          return (
            <WebCard key={section.id} className="overflow-hidden">
              <button
                onClick={() => setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(section.section_id)) next.delete(section.section_id); else next.add(section.section_id);
                  return next;
                })}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                style={{ borderBottom: isCollapsed ? "none" : `1px solid ${theme.cardBorder}` }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>§{section.section_id} {section.section_name}</span>
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-bold" style={{ backgroundColor: theme.inputBg, color: theme.textMuted }}>{recorded}/{sectionParts.length}</span>
                  </div>
                  {section.notes && <div className="mt-0.5 truncate text-[10px]" style={{ color: theme.textMuted }}>{section.notes}</div>}
                </div>
                {isCollapsed ? <ChevronDown className="h-4 w-4" style={{ color: theme.textMuted }} /> : <ChevronUp className="h-4 w-4" style={{ color: theme.textMuted }} />}
              </button>
              {!isCollapsed && (
                <div className="overflow-x-auto">
                  <div className="min-w-[980px]">
                    <div className="grid grid-cols-[1.5fr_80px_80px_80px_95px_150px_75px] gap-2 px-4 py-2 text-[9px] font-bold uppercase tracking-wider" style={{ color: theme.textMuted, backgroundColor: "#02061735" }}>
                      <span>Part</span><span className="text-center">BOM</span><span className="text-center">Qty</span><span className="text-center">QOH</span><span className="text-center">Status</span><span>User / initials</span><span className="text-center">Rev</span>
                    </div>
                    {sectionParts.length === 0 ? (
                      <div className="px-4 py-4 text-xs" style={{ color: theme.textMuted }}>No configured parts in this section.</div>
                    ) : sectionParts.map((part) => {
                      const result = resultsMap.get(resultKey(part.section_id, part.part_number));
                      const stock = data.parts.find((candidate) => canonicalPart(candidate.partNumber) === canonicalPart(part.part_number));
                      return (
                        <PartRow
                          key={part.id}
                          part={part}
                          result={result}
                          qoh={stock?.qoh ?? null}
                          disabled={completed || !!savingKey}
                          saving={savingKey === resultKey(part.section_id, part.part_number)}
                          onQuantity={(quantity) => void applyQuantity(part.section_id, part.part_number, quantity, part.bom_qty, part.category, part.description)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </WebCard>
          );
        })}
      </div>

      <WebCard className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${theme.cardBorder}` }}>
          <div>
            <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>§5.24 Additional Service</div>
            <div className="text-[10px]" style={{ color: theme.textMuted }}>Manual non-BOM parts still use canonical Stock Summary matching and the same atomic DHR transaction.</div>
          </div>
          <Package className="h-4 w-4" style={{ color: "#f59e0b" }} />
        </div>
        {!completed && (
          <div className="grid gap-2 p-4 md:grid-cols-[170px_1fr_90px_auto]">
            <input value={manualPartNumber} onChange={(event) => setManualPartNumber(event.target.value)} placeholder="Part number" maxLength={120} className="rounded-lg px-3 py-2 text-xs outline-none" style={{ backgroundColor: theme.inputBg, color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }} />
            <input value={manualDescription} onChange={(event) => setManualDescription(event.target.value)} placeholder="Description / service note" maxLength={500} className="rounded-lg px-3 py-2 text-xs outline-none" style={{ backgroundColor: theme.inputBg, color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }} />
            <input type="number" min={1} step={1} value={manualQty} onChange={(event) => setManualQty(event.target.value)} className="rounded-lg px-3 py-2 text-xs outline-none" style={{ backgroundColor: theme.inputBg, color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }} />
            <button disabled={!!savingKey} onClick={() => void addManualPart()} className="flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-50" style={{ backgroundColor: "#f59e0f18", color: "#f59e0b", border: "1px solid #f59e0f35" }}><Plus className="h-3.5 w-3.5" /> Add & consume</button>
          </div>
        )}
        {additionalResults.length === 0 ? (
          <div className="px-4 py-5 text-center text-xs" style={{ color: theme.textMuted }}>No Additional Service parts recorded.</div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <div className="grid grid-cols-[1fr_90px_90px_110px_180px_75px_60px] gap-2 px-4 py-2 text-[9px] font-bold uppercase tracking-wider" style={{ color: theme.textMuted, backgroundColor: "#02061735" }}>
                <span>Part</span><span className="text-center">Qty</span><span className="text-center">QOH</span><span className="text-center">Status</span><span>User / initials</span><span className="text-center">Rev</span><span></span>
              </div>
              {additionalResults.map((result) => {
                const stock = data.parts.find((candidate) => canonicalPart(candidate.partNumber) === canonicalPart(result.part_number));
                return (
                  <div key={result.id} className="grid grid-cols-[1fr_90px_90px_110px_180px_75px_60px] items-center gap-2 px-4 py-2.5" style={{ borderTop: `1px solid ${theme.cardBorder}` }}>
                    <div className="min-w-0"><div className="text-xs font-bold" style={{ color: "#f59e0b" }}>{result.part_number}</div><div className="truncate text-[10px]" style={{ color: theme.textMuted }}>{result.description || "Additional Service part"}</div></div>
                    <EditableQuantity value={result.scanned_qty} disabled={completed || !!savingKey} saving={savingKey === resultKey(result.section_id, result.part_number)} onCommit={(quantity) => void applyQuantity(result.section_id, result.part_number, quantity, result.expected_qty, result.category, result.description || "Additional Service part")} />
                    <div className="text-center text-xs" style={{ color: theme.textSecondary }}>{stock?.qoh ?? "—"}</div>
                    <div className="text-center text-[10px] font-bold" style={{ color: result.status === "matched" ? "#12a573" : theme.textSecondary }}>{(result.status || "pending").toUpperCase()}</div>
                    <div className="truncate text-[10px]" style={{ color: theme.textSecondary }}>{result.scanned_by || "—"}</div>
                    <div className="text-center text-xs" style={{ color: theme.textSecondary }}>{result.revision}</div>
                    <button disabled={completed || !!savingKey || result.scanned_qty === 0} onClick={() => void applyQuantity(result.section_id, result.part_number, 0, result.expected_qty, result.category, result.description || "Additional Service part")} className="mx-auto rounded p-1.5 disabled:opacity-30" aria-label={`Return ${result.part_number} and set quantity to zero`} title="Return consumed quantity and keep immutable history"><Trash2 className="h-3.5 w-3.5" style={{ color: "#ef4444" }} /></button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </WebCard>

      {toast && <Toast message={toast} />}
    </div>
  );
}

function Metric({ label, value, small = false }: { label: string; value: string; small?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: theme.textMuted }}>{label}</div>
      <div className={`${small ? "text-sm" : "text-xl"} mt-1 font-bold`} style={{ color: theme.textPrimary }}>{value}</div>
    </div>
  );
}

function EditableQuantity({ value, disabled, saving, onCommit }: { value: number; disabled: boolean; saving: boolean; onCommit: (value: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (Number.isInteger(parsed) && parsed >= 0 && parsed !== value) onCommit(parsed);
    setEditing(false);
  };

  if (saving) return <div className="flex justify-center"><Loader2 className="h-4 w-4 animate-spin" style={{ color: theme.accentBlue }} /></div>;
  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={0}
        step={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          if (event.key === "Escape") { setDraft(String(value)); setEditing(false); }
        }}
        className="mx-auto w-16 rounded px-1.5 py-1 text-center text-xs font-bold outline-none"
        style={{ backgroundColor: theme.inputBg, color: theme.textPrimary, border: `1px solid ${theme.accentBlue}` }}
      />
    );
  }
  return (
    <button disabled={disabled} onClick={() => setEditing(true)} className="mx-auto block min-w-12 rounded px-2 py-1 text-xs font-bold disabled:cursor-default" style={{ backgroundColor: value > 0 ? "#12a57318" : theme.inputBg, color: value > 0 ? "#12a573" : theme.textMuted }}>
      {value}
    </button>
  );
}

function PartRow({ part, result, qoh, disabled, saving, onQuantity }: {
  part: DhrExpectedPart;
  result?: DhrScanResult;
  qoh: number | null;
  disabled: boolean;
  saving: boolean;
  onQuantity: (quantity: number) => void;
}) {
  const style = categoryStyle(part.category);
  const status = result?.status || "pending";
  return (
    <div className="grid grid-cols-[1.5fr_80px_80px_80px_95px_150px_75px] items-center gap-2 px-4 py-2.5" style={{ borderTop: `1px solid ${theme.cardBorder}`, backgroundColor: status === "matched" ? "#12a57306" : status === "short" ? "#ef444406" : "transparent" }}>
      <div className="min-w-0">
        <div className="flex items-center gap-2"><span className="truncate text-xs font-bold" style={{ color: "#818cf8" }}>{part.part_number}</span><span className="rounded px-1.5 py-0.5 text-[8px] font-bold" style={{ backgroundColor: style.bg, color: style.text, border: `1px solid ${style.border}` }}>{style.label}</span></div>
        <div className="truncate text-[10px]" style={{ color: theme.textMuted }}>{part.description}{part.notes ? ` · ${part.notes}` : ""}</div>
      </div>
      <button disabled={disabled || part.bom_qty < 0} onClick={() => onQuantity(part.bom_qty)} className="text-center text-xs font-bold disabled:cursor-default" style={{ color: theme.textPrimary }} title="Use configured BOM quantity">{part.bom_qty}</button>
      <EditableQuantity value={result?.scanned_qty ?? 0} disabled={disabled} saving={saving} onCommit={onQuantity} />
      <div className="text-center text-xs" style={{ color: qoh !== null && qoh <= 0 ? "#ef4444" : theme.textSecondary }}>{qoh ?? "—"}</div>
      <div className="flex items-center justify-center gap-1 text-[9px] font-bold uppercase" style={{ color: status === "matched" ? "#12a573" : status === "short" ? "#ef4444" : status === "over" ? "#22d3ee" : theme.textMuted }}>
        {status === "matched" ? <CheckCircle2 className="h-3 w-3" /> : status === "short" ? <AlertTriangle className="h-3 w-3" /> : null}{status}
      </div>
      <div className="truncate text-[10px]" style={{ color: theme.textSecondary }}>{result?.scanned_by || "—"}</div>
      <div className="text-center text-xs" style={{ color: theme.textSecondary }}>{result?.revision ?? 0}</div>
    </div>
  );
}

function Toast({ message }: { message: string }) {
  return (
    <div className="fixed bottom-5 left-1/2 z-[70] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-2xl" role="status" aria-live="polite" style={{ backgroundColor: theme.cardBg, color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>
      {message}
    </div>
  );
}
