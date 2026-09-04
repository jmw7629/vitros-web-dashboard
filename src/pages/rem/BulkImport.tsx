import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { api } from "../../../convex/_generated/api";
import { WebCard, theme } from "../../components/vitros/SharedComponents";
import { useConvexData } from "../../hooks/useConvexData";
import { browserSafeRead } from "../../lib/browserSafeRead";
import { CheckCircle2, FileSpreadsheet, RefreshCw, Upload, XCircle } from "lucide-react";

type AnalyzerImportRow = {
  serialNumber: string;
  analyzerType: string;
  productionOrder?: number;
  cleaningPct: number;
  servicePct: number;
  finalLinePct: number;
  releaseTestingPct: number;
  packagingPct: number;
};

type ImportPreview = {
  fileName: string;
  fileHash: string;
  sourceSheet: string;
  sourceWeek?: number;
  analyzers: AnalyzerImportRow[];
  skippedRows: number;
  recognizedSheets: string[];
};

type RemSummary = {
  total: number;
  lvcc_total: number;
};

const normalize = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();

function percent(value: unknown): number {
  if (value === null || value === undefined || String(value).trim() === "") return 0;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid progress value: ${String(value)}`);
  const scaled = n <= 1.000001 ? n * 100 : n;
  if (scaled > 100.0001) throw new Error(`Progress exceeds 100%: ${String(value)}`);
  return Math.round(Math.min(100, scaled) * 1000) / 1000;
}

async function sha256Hex(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function analyzerTypeFromSerial(serial: string) {
  if (serial.startsWith("3600")) return "3600";
  if (serial.startsWith("5600")) return "5600";
  if (serial.startsWith("7600")) return "7600";
  throw new Error(`Unsupported VITROS analyzer serial ${serial}`);
}

function parseRemWorkbook(fileName: string, fileHash: string, workbook: XLSX.WorkBook): ImportPreview {
  const normalizedNames = workbook.SheetNames.map(name => ({ name, normalized: normalize(name) }));
  const knownSignatures = ["tracker", "build plan", "field status vitros", "staff", "notes - issues"];
  const recognizedSheets = normalizedNames
    .filter(sheet => knownSignatures.some(signature => sheet.normalized === signature))
    .map(sheet => sheet.name);

  const wipCandidates = normalizedNames
    .map(sheet => {
      const match = sheet.normalized.match(/^wip productivity vitros wk\s*(\d{1,2})$/);
      return match ? { name: sheet.name, week: Number(match[1]) } : null;
    })
    .filter((value): value is { name: string; week: number } => Boolean(value))
    .sort((a, b) => b.week - a.week);

  let sourceSheet = wipCandidates[0]?.name;
  let sourceWeek = wipCandidates[0]?.week;
  if (!sourceSheet) {
    const fallback = normalizedNames.find(sheet => sheet.normalized.startsWith("wip productivity vitros"));
    sourceSheet = fallback?.name;
    sourceWeek = undefined;
  }

  if (!sourceSheet || recognizedSheets.length < 2) {
    throw new Error("This file is not recognized as the REM production workbook. Detection uses sheet structure, not the file name.");
  }

  const sheet = workbook.Sheets[sourceSheet];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const headerIndex = matrix.findIndex(row => {
    const cells = row.map(normalize);
    return cells.includes("production order")
      && cells.includes("wip")
      && cells.includes("clean")
      && cells.includes("service")
      && cells.includes("fl")
      && cells.includes("release/clean")
      && cells.includes("pack");
  });
  if (headerIndex < 0) throw new Error(`REM WIP headers were not found on ${sourceSheet}`);

  const header = matrix[headerIndex].map(normalize);
  const productionOrderCol = header.indexOf("production order");
  const serialCol = header.indexOf("wip");
  const cleanCol = header.indexOf("clean");
  const serviceCol = header.indexOf("service");
  const finalLineCol = header.indexOf("fl");
  const releaseCol = header.indexOf("release/clean");
  const packCol = header.indexOf("pack");

  const analyzers: AnalyzerImportRow[] = [];
  const serials = new Set<string>();
  let skippedRows = 0;

  // The row immediately below the group header contains This Wk / Last Wk / Progress.
  for (const row of matrix.slice(headerIndex + 2)) {
    const serial = String(row[serialCol] ?? "").trim().toUpperCase();
    if (!serial) continue;
    if (!/^\d{8}$/.test(serial)) {
      skippedRows += 1;
      continue;
    }

    const productionOrder = Number(row[productionOrderCol]);
    if (!Number.isFinite(productionOrder) || productionOrder < 0) {
      skippedRows += 1;
      continue;
    }
    if (serials.has(serial)) throw new Error(`Duplicate WIP serial found in workbook: ${serial}`);
    serials.add(serial);

    analyzers.push({
      serialNumber: serial,
      analyzerType: analyzerTypeFromSerial(serial),
      productionOrder,
      cleaningPct: percent(row[cleanCol]),
      servicePct: percent(row[serviceCol]),
      finalLinePct: percent(row[finalLineCol]),
      releaseTestingPct: percent(row[releaseCol]),
      packagingPct: percent(row[packCol]),
    });
  }

  if (analyzers.length < 5) {
    throw new Error(`Only ${analyzers.length} valid analyzer rows were found; import stopped safely.`);
  }
  if (analyzers.length > 250) throw new Error("REM workbook exceeds the 250-analyzer import safety limit");

  return { fileName, fileHash, sourceSheet, sourceWeek, analyzers, skippedRows, recognizedSheets };
}

export function BulkImport() {
  const data = useConvexData();
  const inputRef = useRef<HTMLInputElement>(null);
  const applyWorkbookImport = useAction(api.rem.applyWorkbookImport);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
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
      const parsed = parseRemWorkbook(file.name, fileHash, workbook);
      setPreview(parsed);
      setMessage({
        type: "ok",
        text: `Recognized REM workbook from ${parsed.sourceSheet}. Review ${parsed.analyzers.length} analyzer rows before applying.`,
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
        sourceSheet: preview.sourceSheet,
        sourceWeek: preview.sourceWeek,
        analyzers: preview.analyzers,
      }) as { inserted?: number; updated?: number; rows?: number; already_applied?: boolean };
      await refreshSummary();
      setMessage({
        type: "ok",
        text: result.already_applied
          ? "This exact workbook was already applied. No REM rows were changed twice."
          : `REM updated successfully: ${result.updated ?? 0} updated, ${result.inserted ?? 0} added from ${result.rows ?? preview.analyzers.length} rows.`,
      });
      setPreview(null);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "REM update failed safely" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📥 REM Bulk Import</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>
          Import the recurring production workbook. The workbook is identified by its REM sheet structure, so the file name may change.
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
          Excel workbook detection is content-based; weekly/monthly filename changes are supported.
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
            <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Import Preview</h3>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs mb-4">
            <span style={{ color: theme.textMuted }}>File</span><span className="truncate" style={{ color: theme.textPrimary }}>{preview.fileName}</span>
            <span style={{ color: theme.textMuted }}>Detected source</span><span style={{ color: theme.textPrimary }}>{preview.sourceSheet}</span>
            <span style={{ color: theme.textMuted }}>Analyzer rows</span><span style={{ color: theme.textPrimary }}>{preview.analyzers.length}</span>
            <span style={{ color: theme.textMuted }}>Skipped non-production rows</span><span style={{ color: theme.textPrimary }}>{preview.skippedRows}</span>
            <span style={{ color: theme.textMuted }}>REM signature sheets</span><span style={{ color: theme.textPrimary }}>{preview.recognizedSheets.length}</span>
          </div>
          <p className="text-[11px] mb-3" style={{ color: theme.textSecondary }}>
            Apply performs an authenticated, idempotent transaction. Existing analyzer rows are matched by canonical serial number; missing workbook rows are never deleted.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setPreview(null)} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold border disabled:opacity-50" style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>
              Cancel
            </button>
            <button type="button" onClick={() => void applyPreview()} disabled={busy} className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: "#6366f1" }}>
              Apply REM Update
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
        ].map(([k, v]) => (
          <div key={String(k)} className="flex justify-between py-1.5 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
            <span className="text-xs" style={{ color: theme.textSecondary }}>{k}</span>
            <span className="text-xs font-bold" style={{ color: theme.textPrimary }}>{v}</span>
          </div>
        ))}
      </WebCard>
    </div>
  );
}
