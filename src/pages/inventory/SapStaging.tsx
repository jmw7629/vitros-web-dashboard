import { useMemo, useState } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, StatusBadge, ProgressBar, theme, modeColor, formatDate, downloadCSV } from "../../components/vitros/SharedComponents";
import { Download, Check, CheckCheck, Upload, Clock, FileText } from "lucide-react";

// ═══════════════════════════════════════════════════════════════
// SAP Staging — mirrors SwiftUI SapStagingView exactly
// Tabs: Pending / Ready / Exported+Posted
// Bulk select, mark ready, export to SAP format, post
// ═══════════════════════════════════════════════════════════════

type SapTab = "pending" | "ready" | "exported";
type SortKey = "part" | "description" | "movement" | "qty" | "user" | "date";
type SortDirection = "asc" | "desc";

export function SapStaging() {
  const data = useConvexData();
  const [tab, setTab] = useState<SapTab>("pending");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [postedIds] = useState<Set<string>>(new Set());
  const [readyIds, setReadyIds] = useState<Set<string>>(new Set());
  const [exportedIds, setExportedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const sapRecords = useMemo(() =>
    [...(data.sapRecords || [])].sort((a: any, b: any) => Number(b.timestamp || 0) - Number(a.timestamp || 0)),
    [data.sapRecords]
  );

  // Classify records
  const pending = sapRecords.filter((r: any) => !r.exported && !postedIds.has(r._id) && !readyIds.has(r._id) && !exportedIds.has(r._id));
  const ready = sapRecords.filter((r: any) => readyIds.has(r._id) && !exportedIds.has(r._id) && !postedIds.has(r._id));
  const exported = sapRecords.filter((r: any) => r.exported || postedIds.has(r._id) || exportedIds.has(r._id));

  const tabRecords = tab === "pending" ? pending : tab === "ready" ? ready : exported;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tabRecords;
    return tabRecords.filter((r: any) =>
      String(r.partNumber || "").toLowerCase().includes(q) ||
      String(r.description || "").toLowerCase().includes(q) ||
      String(r.mode || "").toLowerCase().includes(q) ||
      String(r.user || "").toLowerCase().includes(q)
    );
  }, [tabRecords, search]);

  const visibleRows = useMemo(() => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const valueFor = (row: any) => {
      switch (sortKey) {
        case "part": return String(row.partNumber || "");
        case "description": return String(row.description || "");
        case "movement": return String(row.mode || "");
        case "qty": return Math.abs(Number(row.qty || 0));
        case "user": return String(row.user || "");
        case "date": return Number(row.timestamp || 0);
      }
    };

    return [...filtered].sort((a: any, b: any) => {
      const left = valueFor(a);
      const right = valueFor(b);
      if (typeof left === "number" && typeof right === "number") {
        return (left - right) * direction;
      }
      return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" }) * direction;
    });
  }, [filtered, sortDirection, sortKey]);

  const gridTemplateColumns = tab !== "exported"
    ? "28px 100px minmax(180px, 2fr) 120px 70px 90px 110px"
    : "100px minmax(180px, 2fr) 120px 70px 90px 110px";

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const visibleIds = visibleRows.map((r: any) => r._id);
    const everyVisibleSelected = visibleIds.length > 0 && visibleIds.every((id: string) => selectedIds.has(id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (everyVisibleSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const markReady = () => {
    setReadyIds(prev => new Set([...prev, ...selectedIds]));
    setSelectedIds(new Set());
  };

  const markExported = () => {
    setExportedIds(prev => new Set([...prev, ...selectedIds]));
    setSelectedIds(new Set());
  };

  const exportToSap = () => {
    const records = visibleRows.filter((r: any) => selectedIds.has(r._id));
    const rows = records.map((r: any) => ({
      "Movement Type": r.mode === "OUT" ? "261" : r.mode === "IN" || r.mode === "RECEIVE" ? "101" : "309",
      "Material": r.partNumber,
      "Description": r.description || "",
      "Quantity": Math.abs(r.qty),
      "Unit": "EA",
      "Plant": "VITROS",
      "Storage Location": "REM",
      "Date": new Date(r.timestamp).toLocaleDateString(),
      "User": r.user || "",
      "Reference": r._id,
    }));
    downloadCSV(rows, `sap-export-${new Date().toISOString().slice(0, 10)}.csv`);
    markExported();
  };

  const movementType = (mode: string) => {
    switch (mode) {
      case "OUT": return "261 — Goods Issue";
      case "IN": return "101 — Goods Receipt";
      case "RECEIVE": return "101 — Goods Receipt";
      case "ADJUST": return "309 — Transfer";
      default: return mode;
    }
  };

  const toggleSort = (nextKey: SortKey) => {
    if (sortKey === nextKey) {
      setSortDirection(prev => prev === "asc" ? "desc" : "asc");
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

  const visibleIds = visibleRows.map((r: any) => r._id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id: string) => selectedIds.has(id));

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-black" style={{ color: theme.textPrimary }}>SAP Staging</h2>
          <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Review and export staged transactions safely</p>
        </div>
        {tab === "ready" && selectedIds.size > 0 && (
          <button onClick={exportToSap}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white"
            style={{ backgroundColor: "#6366f1" }}>
            <Download className="w-3.5 h-3.5" /> Export to SAP ({selectedIds.size})
          </button>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-3 gap-3">
        <DashCard label="PENDING" value={pending.length} subtitle="Awaiting review" icon="⏳" color="#f59e0b" />
        <DashCard label="READY" value={ready.length} subtitle="Ready to export" icon="📋" color="#6366f1" />
        <DashCard label="EXPORTED" value={exported.length} subtitle="Exported / posted" icon="✅" color={theme.statusOk} />
      </div>

      {/* Pipeline Progress */}
      <WebCard className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold tracking-wider" style={{ color: theme.textMuted }}>PIPELINE PROGRESS</span>
          <span className="text-sm font-bold" style={{ color: theme.statusOk }}>
            {sapRecords.length > 0 ? Math.round((exported.length / sapRecords.length) * 100) : 0}% exported / posted
          </span>
        </div>
        <ProgressBar
          value={sapRecords.length > 0 ? Math.round((exported.length / sapRecords.length) * 100) : 0}
          maxValue={100}
          color={theme.statusOk}
          height={8}
        />
        <div className="flex justify-between mt-1">
          <span className="text-[9px]" style={{ color: "#f59e0b" }}>Pending: {pending.length}</span>
          <span className="text-[9px]" style={{ color: "#6366f1" }}>Ready: {ready.length}</span>
          <span className="text-[9px]" style={{ color: theme.statusOk }}>Exported: {exported.length}</span>
        </div>
      </WebCard>

      {/* Tab Bar */}
      <div className="flex gap-1 p-1 rounded-xl" role="tablist" aria-label="SAP staging status" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
        {([
          { key: "pending" as SapTab, label: "Pending", count: pending.length, icon: <Clock className="w-3.5 h-3.5" /> },
          { key: "ready" as SapTab, label: "Ready", count: ready.length, icon: <FileText className="w-3.5 h-3.5" /> },
          { key: "exported" as SapTab, label: "Exported", count: exported.length, icon: <CheckCheck className="w-3.5 h-3.5" /> },
        ]).map(t => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => { setTab(t.key); setSelectedIds(new Set()); }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2"
            style={{
              backgroundColor: tab === t.key ? theme.accentBlue : "transparent",
              color: tab === t.key ? "#fff" : theme.textSecondary,
              outlineColor: theme.accentBlue,
            }}>
            {t.icon} {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center gap-3">
        {tab !== "exported" && visibleRows.length > 0 && (
          <button onClick={selectAll}
            className="text-xs font-bold px-3 py-1.5 rounded-lg focus-visible:outline-none focus-visible:ring-2"
            style={{ backgroundColor: theme.cardBg, color: theme.textSecondary, border: `1px solid ${theme.cardBorder}`, outlineColor: theme.accentBlue }}>
            {allVisibleSelected ? "Deselect Visible" : "Select Visible"}
          </button>
        )}
        {tab !== "exported" && selectedIds.size > 0 && (
          <>
            <span className="text-xs" style={{ color: theme.textMuted }} aria-live="polite">{selectedIds.size} selected</span>
            {tab === "pending" && (
              <button onClick={markReady}
                className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg text-white focus-visible:outline-none focus-visible:ring-2"
                style={{ backgroundColor: "#6366f1", outlineColor: theme.accentBlue }}>
                <Check className="w-3 h-3" /> Mark Ready
              </button>
            )}
            {tab === "ready" && (
              <button onClick={exportToSap}
                className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg text-white focus-visible:outline-none focus-visible:ring-2"
                style={{ backgroundColor: theme.statusOk, outlineColor: theme.accentBlue }}>
                <Upload className="w-3 h-3" /> Export
              </button>
            )}
          </>
        )}
        <div className="flex-1" />
        <span className="text-[10px] whitespace-nowrap" style={{ color: theme.textMuted }}>
          Showing {visibleRows.length} of {tabRecords.length}
        </span>
        <input className="px-3 py-1.5 rounded-lg text-sm border bg-transparent outline-none focus-visible:ring-2"
          style={{ borderColor: theme.cardBorder, color: theme.textPrimary, maxWidth: 220, outlineColor: theme.accentBlue }}
          aria-label="Search SAP staging records"
          placeholder="Search part, user, mode..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className="text-[10px] md:hidden" style={{ color: theme.textMuted }}>
        Swipe horizontally inside the table to view all columns.
      </div>

      {/* Records Table — exactly one scroll context keeps sticky header and rows synchronized. */}
      <WebCard className="overflow-hidden">
        <div
          className="max-h-[55vh] overflow-auto overscroll-contain"
          style={{ scrollbarGutter: "stable both-edges" }}
          role="table"
          aria-label={`SAP staging ${tab} records`}
          aria-rowcount={visibleRows.length + 1}
        >
          <div className="min-w-[760px]">
            <div className="sticky top-0 z-10 grid items-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider border-b"
              role="row"
              style={{
                gridTemplateColumns,
                backgroundColor: "#0f172a",
                borderColor: theme.cardBorder,
                color: theme.textMuted,
              }}>
              {tab !== "exported" && <span role="columnheader" aria-label="Selection" />}
              <span role="columnheader">{sortHeader("Part #", "part")}</span>
              <span role="columnheader">{sortHeader("Description", "description")}</span>
              <span role="columnheader">{sortHeader("Movement", "movement")}</span>
              <span role="columnheader">{sortHeader("Qty", "qty", "right")}</span>
              <span role="columnheader">{sortHeader("User", "user")}</span>
              <span role="columnheader">{sortHeader("Date", "date", "right")}</span>
            </div>

            <div className="divide-y" style={{ borderColor: theme.cardBorder }} role="rowgroup">
              {visibleRows.length === 0 ? (
                <div className="py-8 text-center" role="row">
                  <div className="text-2xl mb-2">{tab === "pending" ? "🎉" : "📋"}</div>
                  <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>
                    {search ? "No matching records" : tab === "pending" ? "All caught up!" : tab === "ready" ? "No records ready" : "No exports yet"}
                  </div>
                  <div className="text-xs mt-1" style={{ color: theme.textSecondary }}>
                    {search ? "Try a different part number, user, or movement." : tab === "pending" ? "No transactions pending SAP review" : tab === "ready" ? "Mark pending records as ready first" : "Export ready records to SAP"}
                  </div>
                </div>
              ) : (
                visibleRows.map((r: any) => {
                  const isSelected = selectedIds.has(r._id);
                  const selectable = tab !== "exported";
                  return (
                    <div key={r._id}
                      role="row"
                      aria-selected={selectable ? isSelected : undefined}
                      tabIndex={selectable ? 0 : -1}
                      className={`grid items-center px-4 py-2.5 transition-colors ${selectable ? "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset" : ""}`}
                      style={{
                        gridTemplateColumns,
                        backgroundColor: isSelected ? `${theme.accentBlue}10` : undefined,
                        outlineColor: theme.accentBlue,
                      }}
                      onClick={() => selectable && toggleSelect(r._id)}
                      onKeyDown={(event) => {
                        if (!selectable || (event.key !== "Enter" && event.key !== " ")) return;
                        event.preventDefault();
                        toggleSelect(r._id);
                      }}>
                      {selectable && (
                        <span role="cell">
                          <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all" aria-hidden="true"
                            style={{
                              borderColor: isSelected ? theme.accentBlue : theme.cardBorder,
                              backgroundColor: isSelected ? theme.accentBlue : "transparent",
                            }}>
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                        </span>
                      )}
                      <span role="cell" className="text-sm font-medium" style={{ color: theme.accentBlue }}>{r.partNumber}</span>
                      <span role="cell" title={r.description || ""} className="text-sm truncate pr-2" style={{ color: theme.textPrimary }}>{r.description || "—"}</span>
                      <span role="cell" title={movementType(r.mode)}>
                        <StatusBadge text={r.mode} color={modeColor(r.mode)} />
                      </span>
                      <span role="cell" className="text-sm font-bold text-right" style={{ color: theme.textPrimary }}>×{Math.abs(r.qty)}</span>
                      <span role="cell" title={r.user || ""} className="text-xs truncate" style={{ color: theme.textSecondary }}>{r.user || "—"}</span>
                      <span role="cell" className="text-xs text-right" style={{ color: theme.textMuted }}>{formatDate(r.timestamp)}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </WebCard>
    </div>
  );
}
