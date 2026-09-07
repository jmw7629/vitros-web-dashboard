import { saveAs } from "file-saver";
import * as XLSX from "xlsx";
import { WebCard, DashCard, ProgressBar, theme } from "../../components/vitros/SharedComponents";
import { useRemCoreData } from "../../hooks/useRemCoreData";

export function Reports() {
  const data = useRemCoreData();
  const total = data.analyzers.length;
  const completed = data.analyzers.filter((analyzer) => analyzer.isComplete).length;
  const active = total - completed;

  const exportReport = () => {
    if (data.error || data.isLoading) return;
    const workbook = XLSX.utils.book_new();
    const analyzerRows = data.analyzers.map((analyzer) => ({
      "Serial Number": analyzer.serialNumber,
      "Analyzer Type": analyzer.analyzerType,
      "Production Order": analyzer.productionOrder ?? "",
      "Current Stage": analyzer.currentStage,
      "Overall %": analyzer.overallPct,
      "Procurement %": analyzer.procurementPct,
      "Cleaning %": analyzer.cleaningPct,
      "Service %": analyzer.servicePct,
      "Final Line %": analyzer.finalLinePct,
      "Packaging %": analyzer.packagingPct,
      "Release Testing %": analyzer.releaseTestingPct,
      "QA Release %": analyzer.qaReleasePct,
      "SAP Release %": analyzer.sapReleasePct,
      "Days In Stage": analyzer.daysInStage,
      "SLA Days": analyzer.slaDays,
      Complete: analyzer.isComplete ? "Yes" : "No",
    }));
    const lvccRows = data.lvccItems.map((item) => ({
      "Serial Number": item.serialNumber,
      "Batch Number": item.batchNumber ?? "",
      "Item Type": item.itemType ?? "",
      "Current Stage": item.currentStage ?? "",
      "Build %": item.buildPct,
      "Test %": item.testPct,
      "Packaging %": item.packagingPct,
      "QA Release %": item.qaReleasePct,
      "SAP Release %": item.sapReleasePct,
      Complete: item.isComplete ? "Yes" : "No",
    }));

    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(analyzerRows), "REM Analyzers");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(lvccRows), "LVCC");
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    saveAs(
      new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `REM_Report_${new Date().toISOString().slice(0, 10)}.xlsx`,
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📊 REM Reports</h2>
          <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>
            Generated {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
          </p>
        </div>
        {!data.isLoading && !data.error && <span className="text-[10px] font-bold" style={{ color: theme.statusOk }}>LIVE · SUPABASE</span>}
      </div>

      {data.error && (
        <WebCard className="p-4">
          <div className="text-sm font-bold" style={{ color: theme.statusOut }}>REM report data unavailable</div>
          <div className="mt-1 text-xs" style={{ color: theme.textSecondary }}>The authoritative REM service could not be read. Export is disabled rather than substituting legacy data.</div>
          <button type="button" onClick={() => void data.refresh()} className="mt-3 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>Retry</button>
        </WebCard>
      )}

      <div className="grid grid-cols-2 gap-3">
        <DashCard label="TOTAL" value={total} icon="🔬" color="#6366f1" />
        <DashCard label="ACTIVE" value={active} icon="🔧" color="#f59e0b" />
        <DashCard label="COMPLETED" value={completed} icon="✅" color={theme.statusOk} />
        <DashCard label="LVCC" value={data.lvccItems.length} icon="📋" color="#8b5cf6" />
      </div>

      <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-2" style={{ color: theme.textPrimary }}>Completion Rate</h3>
        <ProgressBar value={completed} maxValue={total || 1} color={theme.statusOk} height={10} />
        <div className="text-xs mt-1 text-right" style={{ color: theme.textMuted }}>{total ? Math.round((completed / total) * 100) : 0}%</div>
      </WebCard>

      <button
        type="button"
        onClick={exportReport}
        disabled={data.isLoading || !!data.error}
        className="w-full py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40"
        style={{ backgroundColor: "#6366f1" }}
      >
        {data.isLoading ? "Loading authoritative REM data…" : "Export REM Report"}
      </button>
    </div>
  );
}