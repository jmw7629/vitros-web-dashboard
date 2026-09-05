import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { api } from "../../../convex/_generated/api";
import { WebCard, theme } from "../../components/vitros/SharedComponents";
import { useConvexData } from "../../hooks/useConvexData";
import { browserSafeRead } from "../../lib/browserSafeRead";
import {
  parseAuthoritativeRemWorkbook,
  type AuthoritativeRemImportPreview,
} from "../../lib/remWorkbookAuthoritative";
import { CheckCircle2, FileSpreadsheet, RefreshCw, Upload, XCircle } from "lucide-react";

type RemSummary = {
  total: number;
  lvcc_total: number;
};

type SectionResult = {
  rows?: number;
  inserted?: number;
  updated?: number;
};

type ImportResult = {
  already_applied?: boolean;
  analyzers?: SectionResult;
  tracker?: SectionResult;
  build_plan?: SectionResult;
  staff?: SectionResult;
  weekly_notes?: SectionResult;
  targets?: SectionResult;
};

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sectionSummary(result: ImportResult) {
  const sections: Array<[string, SectionResult | undefined]> = [
    ["analyzers", result.analyzers],
    ["tracker", result.tracker],
    ["build plan", result.build_plan],
    ["staff", result.staff],
    ["notes", result.weekly_notes],
    ["targets", result.targets],
  ];
  return sections
    .map(([label, section]) => `${section?.rows ?? 0} ${label}`)
    .join(" · ");
}

export function BulkImport() {
  const data = useConvexData();
  const inputRef = useRef<HTMLInputElement>(null);
  const applyWorkbookImport = useAction(api.remWorkbookActions.applyAuthoritativeWorkbookImport);
  const [preview, setPreview] = useState<AuthoritativeRemImportPreview | null>(null);
  const [summary, setSummary] = useState<RemSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const refreshSummary = async () => {
    try {
      const rows = await browserSafeRead<RemSummary>("rem_summary");
      setSummary(rows[0] ?? null);
    } catch {
      setSummary(null);
    }
  };

  useEffect(() => {
    void refreshSummary();
  }, []);

  const handleFile = async (file: File) => {
    setBusy(true);
    setMessage(null);
    setPreview(null);
    try {
      const lower = file.name.toLowerCase();
      if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
        throw new Error("REM import requires an Excel workbook (.xlsx or .xls)");
      }
      if (file.size > 25 * 1024 * 1024) throw new Error("Workbook is larger than the 25 MB safety limit");

      const buffer = await file.arrayBuffer();
      const fileHash = await sha256Hex(buffer);
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const parsed = parseAuthoritativeRemWorkbook(file.name, fileHash, workbook);
      setPreview(parsed);
      setMessage({
        type: "ok",
        text: `Recognized ${parsed.planYear} REM workbook from its internal schema. Review all authoritative sections before applying.`,
      });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Could not parse REM workbook" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const applyPreview = async () => {
    if (!preview) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await applyWorkbookImport({
        fileName: preview.fileName,
        fileHash: preview.fileHash,
        planYear: preview.planYear,
        sourceSheet: preview.sourceSheet,
        sourceWeek: preview.sourceWeek,
        analyzers: preview.analyzers,
        trackerWeekly: preview.trackerWeekly,
        buildPlan: preview.buildPlan,
        staff: preview.staff,
        weeklyNotes: preview.weeklyNotes,
        targets: preview.targets,
      }) as ImportResult;
      await refreshSummary();
      setMessage({
        type: "ok",
        text: result.already_applied
          ? "This exact authoritative workbook revision was already applied. No REM rows were changed twice."
          : `Authoritative REM workbook applied atomically: ${sectionSummary(result)}.`,
      });
      setPreview(null);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "REM update failed safely" });
    } finally {
      setBusy(false);
    }
  };

  const previewRows: Array<[string, string | number]> = preview ? [
    ["File", preview.fileName],
    ["Plan year", preview.planYear],
    ["Latest VITROS WIP", preview.sourceSheet],
    ["Analyzer rows", preview.analyzers.length],
    ["Tracker rows", preview.trackerWeekly.length],
    ["Build-plan rows", preview.buildPlan.length],
    ["Staff rows", preview.staff.length],
    ["Weekly notes", preview.weeklyNotes.length],
    ["Annual targets", preview.targets.length],
    ["Skipped non-production WIP rows", preview.skippedRows],
    ["REM signature sheets", preview.recognizedSheets.length],
  ] : [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📥 REM Bulk Import</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>
          Import the recurring production workbook. Internal workbook structure is authoritative; the filename may change.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      <WebCard className="p-6 text-center">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: "#6366f122" }}>
          {busy ? <RefreshCw className="w-8 h-8 animate-spin" style={{ color: "#6366f1" }} /> : <Upload className="w-8 h-8" style={{ color: "#6366f1" }} />}
        </div>
        <h3 className="text-base font-bold mb-1" style={{ color: theme.textPrimary }}>Upload REM Data</h3>
        <p className="text-sm mb-4" style={{ color: theme.textSecondary }}>
          Analyzer WIP, Tracker, Build Plan, Staff, Notes and annual plan totals are parsed together and applied as one server transaction.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="px-6 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
          style={{ backgroundColor: "#6366f1" }}
        >
          {busy ? "Working…" : "Choose File"}
        </button>
      </WebCard>

      {message && (
        <WebCard className="p-4">
          <div className="flex items-start gap-3">
            {message.type === "ok" ? <CheckCircle2 className="w-5 h-5 shrink-0" style={{ color: theme.statusOk }} /> : <XCircle className="w-5 h-5 shrink-0" style={{ color: "#ef4444" }} />}
            <p className="text-sm" style={{ color: message.type === "ok" ? theme.textPrimary : "#fca5a5" }}>{message.text}</p>
          </div>
        </WebCard>
      )}

      {preview && (
        <WebCard className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <FileSpreadsheet className="w-4 h-4" style={{ color: "#6366f1" }} />
            <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Authoritative Import Preview</h3>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-4">
            {previewRows.map(([label, value]) => (
              <div key={label} className="contents">
                <span style={{ color: theme.textMuted }}>{label}</span>
                <span className="truncate" style={{ color: theme.textPrimary }}>{value}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] mb-3" style={{ color: theme.textSecondary }}>
            Apply is authenticated, idempotent and atomic. Canonical keys update workbook-owned values or add missing rows; unrelated REM data is preserved and workbook omissions never delete existing records.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPreview(null)} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold border disabled:opacity-50" style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>
              Cancel
            </button>
            <button type="button" onClick={() => void applyPreview()} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: "#6366f1" }}>
              Apply Authoritative REM Update
            </button>
          </div>
        </WebCard>
      )}

      <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Current Data</h3>
        {[
          ["Analyzers", summary?.total ?? data.analyzers.length],
          ["LVCC Items", summary?.lvcc_total ?? data.lvccItems.length],
          ["Employees", data.employees.length],
        ].map(([key, value]) => (
          <div key={String(key)} className="flex justify-between py-1.5 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
            <span className="text-xs" style={{ color: theme.textSecondary }}>{key}</span>
            <span className="text-xs font-bold" style={{ color: theme.textPrimary }}>{value}</span>
          </div>
        ))}
      </WebCard>
    </div>
  );
}
