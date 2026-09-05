import { useMemo, useState } from "react";
import { useSapStagingWorkflow, type AuthoritativeSapRecord } from "../../hooks/useSapStagingWorkflow";
import { WebCard, DashCard, StatusBadge, ProgressBar, theme, modeColor, formatDate, downloadCSV } from "../../components/vitros/SharedComponents";
import { Download, Check, CheckCheck, Upload, Clock, FileText, RefreshCw } from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// SAP Staging — authoritative VITROS review/export workflow.
// Header/body remain in one synchronized scroll context.
// Browser export only: this page never posts directly to SAP.
// ═══════════════════════════════════════════════════════════════

type SapTab = "pending" | "ready" | "exported";
type SortKey = "part" | "description" | "movement" | "qty" | "user" | "date";
type SortDirection = "asc" | "desc";

function exportedStatus(record: AuthoritativeSapRecord) {
  return record.exportStatus === "exported" || record.exportStatus === "posted";
}

export function SapStaging() {
  const workflow = useSapStagingWorkflow();
  const [tab, setTab] = useState<SapTab>("pending");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const sapRecords = useMemo(
    () => [...workflow.records].sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)),
    [workflow.records],
  );

  const pending = sapRecords.filter((record) => record.exportStatus === "pending" || record.exportStatus === "error");
  const ready = sapRecords.filter((record) => record.exportStatus === "ready");
  const exported = sapRecords.filter(exportedStatus);
  const tabRecords = tab === "pending" ? pending : tab === "ready" ? ready : exported;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tabRecords;
    return tabRecords.filter((record) =>
      record.partNumber.toLowerCase().includes(q)
      || record.description.toLowerCase().includes(q)
      || record.mode.toLowerCase().includes(q)
      || record.user.toLowerCase().includes(q),
    );
  }, [tabRecords, search]);

  const visibleRows = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const valueFor = (row: AuthoritativeSapRecord) => {
      switch (sortKey) {
        case "part": return row.partNumber;
        case "description": return row.description;
        case "movement": return row.mode;
        case "qty": return Math.abs(row.qty);
        case "user": return row.user;
        case "date": return row.timestamp;
      }
    };

    return [...filtered].sort((a, b) => {
      const left = valueFor(a);
      const right = valueFor(b);
      if (typeof left === "number" && typeof right === "number") return (left - right) * direction;
      return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" }) * direction;
    });
  }, [filtered, sortDirection, sortKey]);

  const gridTemplateColumns = tab !== "exported"
    ? "28px 100px minmax(180px, 2fr) 120px 70px 110px 110px"
    : "100px minmax(180px, 2fr) 120px 70px 110px 110px";

  const toggleSelect = (id: string) => {
    if (workflow.isMutating) return;
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (workflow.isMutating) return;
    const visibleIds = visibleRows.map((row) => row._id);
    const everyVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((previous) => {
      const next = new Set(previous);
      for (const id of visibleIds) {
        if (everyVisibleSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const markReady = async () => {
    const ids = visibleRows.filter((row) => selectedIds.has(row._id)).map((row) => row._id);
    if (!ids.length) return;
    setActionMessage(null);
    try {
      await workflow.markReady(ids);
      setSelectedIds(new Set());
      setActionMessage(`${ids.length} record${ids.length === 1 ? "" : "s"} marked ready.`);
    } catch {
      // The authoritative hook reconciles after a failure; keep selection for a safe retry.
    }
  };

  const movementType = (record: AuthoritativeSapRecord) => {
    if (/^\d{3}$/.test(record.movementType)) return record.movementType;
    switch (record.mode) {
      case "OUT": return "261";
      case "IN":
      case "RECEIVE": return "101";
      case "ADJUST": return "309";
      default: return record.movementType || record.mode;
    }
  };

  const movementLabel = (record: AuthoritativeSapRecord) => {
    const type = movementType(record);
    switch (type) {
      case "261": return "261 — Goods Issue";
      case "101": return "101 — Goods Receipt";
      case "309": return "309 — Transfer";
      default: return record.mode || type;
    }
  };

  const exportToSap = async () => {
    const records = visibleRows.filter((row) => selectedIds.has(row._id));
    if (!records.length) return;
    setActionMessage(null);

    const rows = records.map((record) => ({
      "Movement Type": movementType(record),
      "Material": record.partNumber,
      "Description": record.description,
      "Quantity": Math.abs(record.qty),
      "Unit": "EA",
      "Plant": record.plantCode || "VITROS",
      "Storage Location": record.storageLocation || "REM",
      "Date": new Date(record.timestamp).toLocaleDateString(),
      "Reference": record._id,
    }));

    // File generation occurs first. This is not an SAP posting operation.
    downloadCSV(rows, `sap-export-${new Date().toISOString().slice(0, 10)}.csv`);

    try {
      await workflow.markExported(records.map((record) => record._id));
      setSelectedIds(new Set());
      setActionMessage(`${records.length} record${records.length === 1 ? "" : "s"} exported and recorded.`);
    } catch {
      // Leave rows selected/ready when the authoritative state transition did not confirm.
    }
  };

  const toggleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection((previous) => previous === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "date" ? "desc" : "asc");
  };

  const sortHeader = (label: string, key: SortKey, align: "left" | "right" = "left") => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className={`min-w-0 font-bold uppercase tracking-wider hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${align === "right" ? "text-right" : "text-left"}`}
      style={{ color: sortKey === key ? theme.textPrimary : theme.textMuted, outlineColor: theme.accentBlue }}
      aria-label={`Sort by ${label}${sortKey === key ? `, currently ${sortDirection === "asc" ? "ascending" : "descending"}` : ""}`}
    >
      {label}{sortKey === key ? (sortDirection === "asc" ? " ▲" : " ▼") : ""}
    </button>
  );

  const visibleIds = visibleRows.map((row) => row._id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black" style={{ color: theme.textPrimary }}>SAP Staging</h2>
          <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Review and export staged transactions safely</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void workflow.refresh()}
            disabled={workflow.isLoading || workflow.isMutating}
            aria-label="Refresh SAP staging"
            className="p-2 rounded-lg border disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2"
            style={{ borderColor: theme.cardBorder, color: theme.textSecondary, outlineColor: theme.accentBlue }}
          >
            <RefreshCw className={`w-4 h-4 ${workflow.isLoading ? "animate-spin" : ""}`} />
          </button>
          {tab === "ready" && selectedIds.size > 0 && (
            <button
              type="button"
              onClick={() => void exportToSap()}
              disabled={workflow.isMutating}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white disabled:opacity-50"
              style={{ backgroundColor: "#6366f1" }}
            >
              <Download className="w-3.5 h-3.5" /> Export to SAP ({selectedIds.size})
            </button>
          )}
        </div>
      </div>

      {(workflow.error || actionMessage) && (
        <div
          className="rounded-xl px-3 py-2 text-xs"
          role="status"
          aria-live="polite"
          style={{
            backgroundColor: workflow.error ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
            border: `1px solid ${workflow.error ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
            color: workflow.error ? "#fca5a5" : theme.statusOk,
          }}
        >
          {workflow.error || actionMessage}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <DashCard label="PENDING" value={pending.length} subtitle="Awaiting review" icon="⏳" color="#f59e0b" />
        <DashCard label="READY" value={ready.length} subtitle="Ready to export" icon="📋" color="#6366f1" />
        <DashCard label="EXPORTED" value={exported.length} subtitle="Export recorded" icon="✅" color={theme.statusOk} />
      </div>

      <WebCard className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold tracking-wider" style={{ color: theme.textMuted }}>PIPELINE PROGRESS</span>
          <span className="text-sm font-bold" style={{ color: theme.statusOk }}>
            {sapRecords.length > 0 ? Math.round((exported.length / sapRecords.length) * 100) : 0}% exported
          </span>
        </div>
        <ProgressBar value={sapRecords.length > 0 ? Math.round((exported.length / sapRecords.length) * 100) : 0} maxValue={100} color={theme.statusOk} height={8} />
        <div className="flex justify-between mt-1">
          <span className="text-[9px]" style={{ color: "#f59e0b" }}>Pending: {pending.length}</span>
          <span className="text-[9px]" style={{ color: "#6366f1" }}>Ready: {ready.length}</span>
          <span className="text-[9px]" style={{ color: theme.statusOk }}>Exported: {exported.length}</span>
        </div>
      </WebCard>

      <div className="flex gap-1 p-1 rounded-xl" role="tablist" aria-label="SAP staging status" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
        {([
          { key: "pending" as SapTab, label: "Pending", count: pending.length, icon: <Clock className="w-3.5 h-3.5" /> },
          { key: "ready" as SapTab, label: "Ready", count: ready.length, icon: <FileText className="w-3.5 h-3.5" /> },
          { key: "exported" as SapTab, label: "Exported", count: exported.length, icon: <CheckCheck className="w-3.5 h-3.5" /> },
        ]).map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => { setTab(item.key); setSelectedIds(new Set()); setActionMessage(null); }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2"
            style={{ backgroundColor: tab === item.key ? theme.accentBlue : "transparent", color: tab === item.key ? "#fff" : theme.textSecondary, outlineColor: theme.accentBlue }}
          >
            {item.icon} {item.label} ({item.count})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {tab !== "exported" && visibleRows.length > 0 && (
          <button
            type="button"
            onClick={selectAll}
            disabled={workflow.isMutating}
            className="text-xs font-bold px-3 py-1.5 rounded-lg disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2"
            style={{ backgroundColor: theme.cardBg, color: theme.textSecondary, border: `1px solid ${theme.cardBorder}`, outlineColor: theme.accentBlue }}
          >
            {allVisibleSelected ? "Deselect Visible" : "Select Visible"}
          </button>
        )}
        {tab !== "exported" && selectedIds.size > 0 && (
          <>
            <span className="text-xs" style={{ color: theme.textMuted }} aria-live="polite">{selectedIds.size} selected</span>
            {tab === "pending" && (
              <button
                type="button"
                onClick={() => void markReady()}
                disabled={workflow.isMutating}
                className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2"
                style={{ backgroundColor: "#6366f1", outlineColor: theme.accentBlue }}
              >
                <Check className="w-3 h-3" /> {workflow.isMutating ? "Saving…" : "Mark Ready"}
              </button>
            )}
            {tab === "ready" && (
              <button
                type="button"
                onClick={() => void exportToSap()}
                disabled={workflow.isMutating}
                className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2"
                style={{ backgroundColor: theme.statusOk, outlineColor: theme.accentBlue }}
              >
                <Upload className="w-3 h-3" /> {workflow.isMutating ? "Recording…" : "Export"}
              </button>
            )}
          </>
        )}
        <div className="flex-1" />
        <span className="text-[10px] whitespace-nowrap" style={{ color: theme.textMuted }}>Showing {visibleRows.length} of {tabRecords.length}</span>
        <input
          className="px-3 py-1.5 rounded-lg text-sm border bg-transparent outline-none focus-visible:ring-2"
          style={{ borderColor: theme.cardBorder, color: theme.textPrimary, maxWidth: 220, outlineColor: theme.accentBlue }}
          aria-label="Search SAP staging records"
          placeholder="Search part, user, mode..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="text-[10px] md:hidden" style={{ color: theme.textMuted }}>Swipe horizontally inside the table to view all columns.</div>

      <WebCard className="overflow-hidden">
        <div
          className="max-h-[55vh] overflow-auto overscroll-contain"
          style={{ scrollbarGutter: "stable both-edges" }}
          role="table"
          aria-label={`SAP staging ${tab} records`}
          aria-rowcount={visibleRows.length + 1}
          aria-busy={workflow.isLoading || workflow.isMutating}
        >
          <div className="min-w-[800px]">
            <div
              className="sticky top-0 z-10 grid items-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider border-b"
              role="row"
              style={{ gridTemplateColumns, backgroundColor: "#0f172a", borderColor: theme.cardBorder, color: theme.textMuted }}
            >
              {tab !== "exported" && <span role="columnheader" aria-label="Selection" />}
              <span role="columnheader">{sortHeader("Part #", "part")}</span>
              <span role="columnheader">{sortHeader("Description", "description")}</span>
              <span role="columnheader">{sortHeader("Movement", "movement")}</span>
              <span role="columnheader">{sortHeader("Qty", "qty", "right")}</span>
              <span role="columnheader">{sortHeader("Actor", "user")}</span>
              <span role="columnheader">{sortHeader("Date", "date", "right")}</span>
            </div>

            <div className="divide-y" style={{ borderColor: theme.cardBorder }} role="rowgroup">
              {visibleRows.length === 0 ? (
                <div className="py-8 text-center" role="row">
                  <div className="text-2xl mb-2">{tab === "pending" ? "🎉" : "📋"}</div>
                  <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>
                    {workflow.isLoading ? "Loading SAP staging…" : search ? "No matching records" : tab === "pending" ? "All caught up!" : tab === "ready" ? "No records ready" : "No exports yet"}
                  </div>
                  <div className="text-xs mt-1" style={{ color: theme.textSecondary }}>
                    {search ? "Try a different part number, actor, or movement." : tab === "pending" ? "No transactions pending SAP review" : tab === "ready" ? "Mark pending records as ready first" : "Exported records will appear here"}
                  </div>
                </div>
              ) : visibleRows.map((record) => {
                const isSelected = selectedIds.has(record._id);
                const selectable = tab !== "exported";
                const displayedActor = record.exportedBy || record.user || "—";
                return (
                  <div
                    key={record._id}
                    role="row"
                    aria-selected={selectable ? isSelected : undefined}
                    tabIndex={selectable ? 0 : -1}
                    className={`grid items-center px-4 py-2.5 transition-colors ${selectable ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset" : ""}`}
                    style={{ gridTemplateColumns, backgroundColor: isSelected ? `${theme.accentBlue}10` : undefined, outlineColor: theme.accentBlue }}
                    onClick={() => selectable && toggleSelect(record._id)}
                    onKeyDown={(event) => {
                      if (!selectable || (event.key !== "Enter" && event.key !== " ")) return;
                      event.preventDefault();
                      toggleSelect(record._id);
                    }}
                  >
                    {selectable && (
                      <span role="cell">
                        <div
                          className="w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all"
                          aria-hidden="true"
                          style={{ borderColor: isSelected ? theme.accentBlue : theme.cardBorder, backgroundColor: isSelected ? theme.accentBlue : "transparent" }}
                        >
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </div>
                      </span>
                    )}
                    <span role="cell" className="text-sm font-medium" style={{ color: theme.accentBlue }}>{record.partNumber}</span>
                    <span role="cell" title={record.description} className="text-sm truncate pr-2" style={{ color: theme.textPrimary }}>{record.description || "—"}</span>
                    <span role="cell" title={movementLabel(record)}><StatusBadge text={record.mode || movementType(record)} color={modeColor(record.mode)} /></span>
                    <span role="cell" className="text-sm font-bold text-right" style={{ color: theme.textPrimary }}>×{Math.abs(record.qty)}</span>
                    <span role="cell" title={displayedActor} className="text-xs truncate" style={{ color: theme.textSecondary }}>{displayedActor}</span>
                    <span role="cell" className="text-xs text-right" style={{ color: theme.textMuted }}>{formatDate(record.exportedAt || record.timestamp)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </WebCard>
    </div>
  );
}
