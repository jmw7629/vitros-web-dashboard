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

export function SapStaging() {
  const data = useConvexData();
  const [tab, setTab] = useState<SapTab>("pending");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [postedIds, setPostedIds] = useState<Set<string>>(new Set());
  const [readyIds, setReadyIds] = useState<Set<string>>(new Set());
  const [exportedIds, setExportedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");

  const sapRecords = useMemo(() =>
    (data.sapRecords || []).sort((a: any, b: any) => b.timestamp - a.timestamp),
    [data.sapRecords]
  );

  // Classify records
  const pending = sapRecords.filter((r: any) => !r.exported && !postedIds.has(r._id) && !readyIds.has(r._id) && !exportedIds.has(r._id));
  const ready = sapRecords.filter((r: any) => readyIds.has(r._id) && !exportedIds.has(r._id) && !postedIds.has(r._id));
  const exported = sapRecords.filter((r: any) => r.exported || postedIds.has(r._id) || exportedIds.has(r._id));

  const tabRecords = tab === "pending" ? pending : tab === "ready" ? ready : exported;

  const filtered = useMemo(() => {
    if (!search) return tabRecords;
    const q = search.toLowerCase();
    return tabRecords.filter((r: any) =>
      r.partNumber.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q)
    );
  }, [tabRecords, search]);

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((r: any) => r._id)));
    }
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
    const records = filtered.filter((r: any) => selectedIds.has(r._id));
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black" style={{ color: theme.textPrimary }}>SAP Staging</h2>
          <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Review and post transactions to SAP</p>
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
        <DashCard label="EXPORTED" value={exported.length} subtitle="Posted to SAP" icon="✅" color={theme.statusOk} />
      </div>

      {/* Pipeline Progress */}
      <WebCard className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold tracking-wider" style={{ color: theme.textMuted }}>PIPELINE PROGRESS</span>
          <span className="text-sm font-bold" style={{ color: theme.statusOk }}>
            {sapRecords.length > 0 ? Math.round((exported.length / sapRecords.length) * 100) : 0}% posted
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
      <div className="flex gap-1 p-1 rounded-xl" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
        {([
          { key: "pending" as SapTab, label: "Pending", count: pending.length, icon: <Clock className="w-3.5 h-3.5" /> },
          { key: "ready" as SapTab, label: "Ready", count: ready.length, icon: <FileText className="w-3.5 h-3.5" /> },
          { key: "exported" as SapTab, label: "Exported", count: exported.length, icon: <CheckCheck className="w-3.5 h-3.5" /> },
        ]).map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSelectedIds(new Set()); }}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all"
            style={{
              backgroundColor: tab === t.key ? theme.accentBlue : "transparent",
              color: tab === t.key ? "#fff" : theme.textSecondary,
            }}>
            {t.icon} {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* Action Bar */}
      {tab !== "exported" && filtered.length > 0 && (
        <div className="flex items-center gap-3">
          <button onClick={selectAll}
            className="text-xs font-bold px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: theme.cardBg, color: theme.textSecondary, border: `1px solid ${theme.cardBorder}` }}>
            {selectedIds.size === filtered.length ? "Deselect All" : "Select All"}
          </button>
          {selectedIds.size > 0 && (
            <>
              <span className="text-xs" style={{ color: theme.textMuted }}>{selectedIds.size} selected</span>
              {tab === "pending" && (
                <button onClick={markReady}
                  className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg text-white"
                  style={{ backgroundColor: "#6366f1" }}>
                  <Check className="w-3 h-3" /> Mark Ready
                </button>
              )}
              {tab === "ready" && (
                <button onClick={exportToSap}
                  className="flex items-center gap-1 text-xs font-bold px-3 py-1.5 rounded-lg text-white"
                  style={{ backgroundColor: theme.statusOk }}>
                  <Upload className="w-3 h-3" /> Export
                </button>
              )}
            </>
          )}
          <div className="flex-1" />
          <input className="px-3 py-1.5 rounded-lg text-sm border bg-transparent outline-none"
            style={{ borderColor: theme.cardBorder, color: theme.textPrimary, maxWidth: 200 }}
            placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      )}

      {/* Records Table */}
      <WebCard className="overflow-hidden">
        <div className="grid items-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider border-b"
          style={{
            gridTemplateColumns: tab !== "exported" ? "28px 80px minmax(120px, 2fr) 80px 60px 50px 80px" : "80px minmax(120px, 2fr) 80px 60px 50px 80px",
            backgroundColor: "#0f172a",
            borderColor: theme.cardBorder,
            color: theme.textMuted,
          }}>
          {tab !== "exported" && <span />}
          <span>Part #</span>
          <span>Description</span>
          <span>Movement</span>
          <span className="text-right">Qty</span>
          <span>User</span>
          <span className="text-right">Date</span>
        </div>

        <div className="divide-y max-h-[55vh] overflow-y-auto" style={{ borderColor: theme.cardBorder }}>
          {filtered.length === 0 ? (
            <div className="py-8 text-center">
              <div className="text-2xl mb-2">{tab === "pending" ? "🎉" : "📋"}</div>
              <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>
                {tab === "pending" ? "All caught up!" : tab === "ready" ? "No records ready" : "No exports yet"}
              </div>
              <div className="text-xs mt-1" style={{ color: theme.textSecondary }}>
                {tab === "pending" ? "No transactions pending SAP review" : tab === "ready" ? "Mark pending records as ready first" : "Export ready records to SAP"}
              </div>
            </div>
          ) : (
            filtered.map((r: any) => {
              const isSelected = selectedIds.has(r._id);
              return (
                <div key={r._id}
                  className="grid items-center px-4 py-2.5 transition-colors cursor-pointer"
                  style={{
                    gridTemplateColumns: tab !== "exported" ? "28px 80px minmax(120px, 2fr) 80px 60px 50px 80px" : "80px minmax(120px, 2fr) 80px 60px 50px 80px",
                    backgroundColor: isSelected ? `${theme.accentBlue}10` : undefined,
                  }}
                  onClick={() => tab !== "exported" && toggleSelect(r._id)}>
                  {tab !== "exported" && (
                    <span>
                      <div className="w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all"
                        style={{
                          borderColor: isSelected ? theme.accentBlue : theme.cardBorder,
                          backgroundColor: isSelected ? theme.accentBlue : "transparent",
                        }}>
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                    </span>
                  )}
                  <span className="text-sm font-medium" style={{ color: theme.accentBlue }}>{r.partNumber}</span>
                  <span className="text-sm truncate pr-2" style={{ color: theme.textPrimary }}>{r.description || "—"}</span>
                  <span>
                    <StatusBadge text={r.mode} color={modeColor(r.mode)} />
                  </span>
                  <span className="text-sm font-bold text-right" style={{ color: theme.textPrimary }}>×{Math.abs(r.qty)}</span>
                  <span className="text-xs truncate" style={{ color: theme.textSecondary }}>{r.user || "—"}</span>
                  <span className="text-xs text-right" style={{ color: theme.textMuted }}>{formatDate(r.timestamp)}</span>
                </div>
              );
            })
          )}
        </div>
      </WebCard>
    </div>
  );
}
