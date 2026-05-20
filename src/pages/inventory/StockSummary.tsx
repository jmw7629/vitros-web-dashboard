import { useState, useMemo, useCallback } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { useRole } from "../../hooks/useRole";
import { WebCard, StatusBadge, theme, statusColor, formatDate, modeColor } from "../../components/vitros/SharedComponents";
import { Search, X, ChevronUp, ChevronDown, ArrowLeft, Plus, Pencil, Trash2, Download, Check, Globe, Bookmark, AlertTriangle, Loader2 } from "lucide-react";

type SortCol = "partNumber" | "description" | "type" | "qoh" | "minQty" | "maxQty" | "status";
type ViewMode = "all" | "plan";

/* ── Status logic matching reference ────────────────────────── */
function computeStatus(p: any): "OK" | "LOW" | "STOCKOUT" {
  if (p.qoh === 0) return "STOCKOUT";
  if (p.minQty > 0 && p.qoh < p.minQty) return "LOW";
  return "OK";
}
function refStatusColor(s: string) {
  if (s === "OK") return "#22c55e";
  if (s === "LOW") return "#f59e0b";
  if (s === "STOCKOUT") return "#ef4444";
  return theme.textMuted;
}

/* ── Normalize type — no "Unclassified", every part has a type ── */
function normalizeType(raw: string | undefined | null): string {
  if (!raw || raw === "0" || raw.trim() === "") return "Not on BOM";
  return raw;
}

/* ── Type badge colors — ALL types get a colored box ────────── */
function typeBadgeStyle(type: string): { bg: string; text: string } {
  switch (type) {
    case "Required":   return { bg: "#ea580c", text: "#fff" };
    case "Optional":   return { bg: "#ca8a04", text: "#fff" };
    case "Not on BOM": return { bg: "#475569", text: "#e2e8f0" };
    case "Consumable": return { bg: "#7c3aed", text: "#fff" };
    default:           return { bg: "#475569", text: "#e2e8f0" };
  }
}

/* ── Export to XLSX (real download) ─────────────────────────── */
function exportToXLSX(parts: any[]) {
  // Build CSV (Excel-compatible) with all columns
  const headers = ["Part #", "Description", "Type", "QOH", "Min", "Max", "Status", "On Plan", "Bin Location", "Module"];
  const rows = parts.map(p => [
    p.partNumber,
    `"${(p.description || "").replace(/"/g, '""')}"`,
    normalizeType(p.type),
    p.qoh,
    p.minQty,
    p.maxQty,
    computeStatus(p),
    p.onPlan ? "Yes" : "No",
    p.binLocation || "",
    p.module || "",
  ]);
  const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `VITROS_Stock_Summary_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function StockSummary() {
  const data = useConvexData();
  const { role } = useRole();
  const isAdmin = role === "superuser";
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortCol, setSortCol] = useState<SortCol>("partNumber");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedPart, setSelectedPart] = useState<any>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("all");

  /* ── Edit / Delete / Add states ──────────────────────────── */
  const [editPart, setEditPart] = useState<any>(null);
  const [editForm, setEditForm] = useState({ partNumber: "", description: "", type: "", qoh: "", minQty: "", maxQty: "", onPlan: false, binLocation: "", module: "" });
  const [confirmDeletePart, setConfirmDeletePart] = useState<any>(null);
  const [addPartOpen, setAddPartOpen] = useState(false);
  const [addForm, setAddForm] = useState({ partNumber: "", description: "", type: "Required", qoh: "", minQty: "", maxQty: "", onPlan: false });
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const openEdit = (p: any) => {
    setEditForm({
      partNumber: p.partNumber,
      description: p.description,
      type: p.type || "",
      qoh: String(p.qoh ?? ""),
      minQty: String(p.minQty ?? ""),
      maxQty: String(p.maxQty ?? ""),
      onPlan: !!p.onPlan,
      binLocation: p.binLocation || "",
      module: p.module || "",
    });
    setEditPart(p);
    setActionError(null);
  };

  const saveEdit = async () => {
    if (!editPart) return;
    setSaving(true);
    setActionError(null);
    try {
      await data.updatePart(editPart._id, {
        description: editForm.description,
        type: editForm.type,
        qoh: parseInt(editForm.qoh) || 0,
        minQty: parseInt(editForm.minQty) || 0,
        maxQty: parseInt(editForm.maxQty) || 0,
        onPlan: editForm.onPlan,
      });
      setEditPart(null);
      setSelectedPart(null);
    } catch (e: any) {
      setActionError(e?.message || "Failed to save changes");
    }
    setSaving(false);
  };

  const confirmDelete = async () => {
    if (!confirmDeletePart) return;
    setSaving(true);
    setActionError(null);
    try {
      await data.deletePart(confirmDeletePart._id);
      setConfirmDeletePart(null);
      setSelectedPart(null);
    } catch (e: any) {
      setActionError(e?.message || "Failed to delete part");
    }
    setSaving(false);
  };

  const saveNewPart = async () => {
    if (!addForm.partNumber || !addForm.description) return;
    setSaving(true);
    setActionError(null);
    try {
      await data.createPart({
        partNumber: addForm.partNumber,
        description: addForm.description,
        type: addForm.type,
        qoh: parseInt(addForm.qoh) || 0,
        min: parseInt(addForm.minQty) || 0,
        max: parseInt(addForm.maxQty) || 0,
        onPlan: addForm.onPlan,
      });
      setAddPartOpen(false);
      setAddForm({ partNumber: "", description: "", type: "Required", qoh: "", minQty: "", maxQty: "", onPlan: false });
    } catch (e: any) {
      setActionError(e?.message || "Failed to add part");
    }
    setSaving(false);
  };

  /* ── Compute derived data ────────────────────────────────── */
  const partsWithStatus = useMemo(() =>
    data.parts.map(p => ({ ...p, computedStatus: computeStatus(p), normalizedType: normalizeType(p.type) })),
    [data.parts]
  );

  const viewParts = useMemo(() =>
    viewMode === "plan" ? partsWithStatus.filter(p => p.onPlan) : partsWithStatus,
    [partsWithStatus, viewMode]
  );

  const planCount = useMemo(() => partsWithStatus.filter(p => p.onPlan).length, [partsWithStatus]);

  /* ── Stats for summary cards ─────────────────────────────── */
  const stats = useMemo(() => {
    const total = viewParts.length;
    const ok = viewParts.filter(p => p.computedStatus === "OK").length;
    const low = viewParts.filter(p => p.computedStatus === "LOW").length;
    const out = viewParts.filter(p => p.computedStatus === "STOCKOUT").length;
    const healthPct = total > 0 ? Math.round((ok / total) * 100) : 0;
    return { total, ok, low, out, healthPct };
  }, [viewParts]);

  /* ── Filter & sort ───────────────────────────────────────── */
  const filtered = useMemo(() => {
    let result = [...viewParts];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p =>
        p.partNumber.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    }
    if (typeFilter !== "all") {
      result = result.filter(p => p.normalizedType === typeFilter);
    }
    if (statusFilter !== "all") {
      result = result.filter(p => p.computedStatus === statusFilter);
    }
    result.sort((a, b) => {
      let cmp = 0;
      if (sortCol === "qoh" || sortCol === "minQty" || sortCol === "maxQty")
        cmp = (a as any)[sortCol] - (b as any)[sortCol];
      else if (sortCol === "status")
        cmp = a.computedStatus.localeCompare(b.computedStatus);
      else if (sortCol === "type")
        cmp = a.normalizedType.localeCompare(b.normalizedType);
      else
        cmp = String((a as any)[sortCol] || "").localeCompare(String((b as any)[sortCol] || ""));
      return sortAsc ? cmp : -cmp;
    });
    return result;
  }, [viewParts, search, typeFilter, statusFilter, sortCol, sortAsc]);

  const handleSort = (col: SortCol) => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  };

  /* ── PART DETAIL VIEW ────────────────────────────────────── */
  if (selectedPart) {
    const part = selectedPart;
    const cs = computeStatus(part);
    const nType = normalizeType(part.type);
    const partTxns = data.transactions.filter((t: any) => t.partNumber === part.partNumber).sort((a: any, b: any) => b.timestamp - a.timestamp);
    const partKits = data.kits.filter((k: any) => k.components?.some((c: any) => c.partNumber === part.partNumber));
    return (
      <div className="space-y-4 max-w-5xl mx-auto">
        <button onClick={() => setSelectedPart(null)} className="flex items-center gap-1 text-sm font-medium" style={{ color: "#6366f1" }}>
          <ArrowLeft className="w-4 h-4" /> Back to Stock Summary
        </button>
        <WebCard className="p-4">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <StatusBadge text={cs} color={refStatusColor(cs)} />
            <span className="px-2 py-0.5 rounded text-[11px] font-medium" style={{ backgroundColor: typeBadgeStyle(nType).bg, color: typeBadgeStyle(nType).text }}>{nType}</span>
            {part.onPlan && <StatusBadge text="On Plan" color={theme.statusOk} />}
          </div>
          <h2 className="text-lg font-bold" style={{ color: theme.textPrimary }}>{part.partNumber}</h2>
          <p className="text-sm" style={{ color: theme.textSecondary }}>{part.description}</p>
        </WebCard>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: "QOH", val: part.qoh, color: refStatusColor(cs) },
            { label: "Min", val: part.minQty, color: "#f59e0b" },
            { label: "Max", val: part.maxQty, color: "#6366f1" },
            { label: "Txns", val: partTxns.length, color: "#8b5cf6" },
          ].map(s => (
            <WebCard key={s.label} className="p-3 text-center">
              <div className="text-xl font-black" style={{ color: s.color }}>{s.val}</div>
              <div className="text-[10px] font-medium" style={{ color: theme.textMuted }}>{s.label}</div>
            </WebCard>
          ))}
        </div>
        <WebCard className="p-4">
          <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Details</h3>
          {[
            ["Part Number", part.partNumber],
            ["Description", part.description],
            ["Type", nType],
            ["Bin Location", part.binLocation],
            ["Module", part.module],
            ["On Plan", part.onPlan ? "Yes" : "No"],
          ].map(([label, val]) => (
            <div key={label} className="flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
              <span className="text-xs" style={{ color: theme.textSecondary }}>{label}</span>
              <span className="text-xs font-medium" style={{ color: theme.textPrimary }}>{val}</span>
            </div>
          ))}
        </WebCard>
        {partKits.length > 0 && (
          <WebCard className="p-4">
            <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Kit Membership</h3>
            {partKits.map((kit: any) => (
              <div key={kit._id} className="flex items-center gap-3 py-2 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
                <span className="text-lg">📦</span>
                <div className="flex-1">
                  <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>{kit.name}</div>
                  <div className="text-[10px]" style={{ color: theme.textMuted }}>{kit.kitId}</div>
                </div>
                <span className="text-xs font-bold" style={{ color: "#8b5cf6" }}>
                  Qty: {kit.components.find((c: any) => c.partNumber === part.partNumber)?.qtyRequired || 0}
                </span>
              </div>
            ))}
          </WebCard>
        )}
        <WebCard className="overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
            <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Transaction History</h3>
            <span className="text-[10px]" style={{ color: theme.textMuted }}>{partTxns.length} records</span>
          </div>
          {partTxns.length === 0 ? (
            <div className="py-6 text-center text-sm" style={{ color: theme.textSecondary }}>No transactions yet</div>
          ) : (
            <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
              {partTxns.slice(0, 20).map((tx: any, i: number) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2">
                  <StatusBadge text={tx.mode} color={modeColor(tx.mode)} />
                  <div className="flex-1">
                    <span className="text-xs" style={{ color: theme.textSecondary }}>{tx.user}</span>
                    <div className="text-[10px]" style={{ color: theme.textMuted }}>{tx.qtyBefore} → {tx.qtyAfter}</div>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold" style={{ color: tx.qty > 0 ? theme.statusOk : theme.statusOut }}>
                      {tx.qty > 0 ? "+" + tx.qty : tx.qty}
                    </span>
                    <div className="text-[9px]" style={{ color: theme.textMuted }}>{formatDate(tx.timestamp)}</div>
                  </div>
                </div>
              ))}
              {partTxns.length > 20 && (
                <div className="py-2 text-center text-xs" style={{ color: theme.textMuted }}>+ {partTxns.length - 20} more</div>
              )}
            </div>
          )}
        </WebCard>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════
     MAIN STOCK SUMMARY VIEW — responsive layout
     ══════════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-4 max-w-[1200px] mx-auto">

      {/* ── HEADER ROW ─────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold" style={{ color: theme.textPrimary }}>Stock Summary</h1>
          <p className="text-xs sm:text-sm mt-0.5" style={{ color: theme.textSecondary }}>
            Complete inventory overview — {viewParts.length} parts
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <button onClick={() => { setAddPartOpen(true); setActionError(null); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-semibold text-white"
              style={{ backgroundColor: "#3b82f6" }}>
              <Plus className="w-4 h-4" /> Add Part
            </button>
          )}
          {/* Toggle: All Parts / Stocking Plan */}
          <div className="flex rounded-full overflow-hidden border" style={{ borderColor: theme.cardBorder }}>
            <button
              onClick={() => setViewMode("all")}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] sm:text-xs font-semibold transition-colors"
              style={{
                backgroundColor: viewMode === "all" ? "#1e293b" : "transparent",
                color: viewMode === "all" ? "#fff" : theme.textSecondary,
              }}
            >
              <Globe className="w-3 h-3" />
              All Parts ({partsWithStatus.length})
            </button>
            <button
              onClick={() => setViewMode("plan")}
              className="flex items-center gap-1 px-3 py-1.5 text-[11px] sm:text-xs font-semibold transition-colors"
              style={{
                backgroundColor: viewMode === "plan" ? "#1e293b" : "transparent",
                color: viewMode === "plan" ? "#fff" : theme.textSecondary,
              }}
            >
              <Bookmark className="w-3 h-3" />
              Stocking Plan ({planCount})
            </button>
          </div>
        </div>
      </div>

      {/* ── SUMMARY CARDS (2x2 on mobile, 4 on desktop) ────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* TOTAL PARTS */}
        <div className="rounded-xl p-4 sm:p-5"
          style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", border: "1px solid rgba(59,130,246,0.3)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] sm:text-xs font-bold tracking-wider" style={{ color: theme.textSecondary }}>TOTAL PARTS</span>
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center" style={{ background: "linear-gradient(135deg, #3b82f6, #6366f1)" }}>
              <span className="text-sm sm:text-lg">📦</span>
            </div>
          </div>
          <div className="text-3xl sm:text-4xl font-black" style={{ color: theme.textPrimary }}>{stats.total}</div>
        </div>
        {/* OK */}
        <div className="rounded-xl p-4 sm:p-5"
          style={{ background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)", border: "1px solid rgba(34,197,94,0.3)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] sm:text-xs font-bold tracking-wider" style={{ color: theme.textSecondary }}>OK</span>
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: "#22c55e" }}>
              <Check className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
          </div>
          <div className="text-3xl sm:text-4xl font-black" style={{ color: theme.textPrimary }}>{stats.ok}</div>
          <div className="text-[10px] sm:text-xs mt-0.5" style={{ color: theme.textMuted }}>{stats.healthPct}% healthy</div>
        </div>
        {/* LOW STOCK */}
        <div className="rounded-xl p-4 sm:p-5"
          style={{ background: "linear-gradient(135deg, #1a1708 0%, #1e293b 100%)", border: "1px solid rgba(245,158,11,0.3)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] sm:text-xs font-bold tracking-wider" style={{ color: theme.textSecondary }}>LOW STOCK</span>
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: "#f59e0b" }}>
              <span className="text-white text-sm sm:text-lg font-bold">⚠</span>
            </div>
          </div>
          <div className="text-3xl sm:text-4xl font-black" style={{ color: theme.textPrimary }}>{stats.low}</div>
        </div>
        {/* STOCK-OUTS */}
        <div className="rounded-xl p-4 sm:p-5"
          style={{ background: "linear-gradient(135deg, #1a0808 0%, #1e293b 100%)", border: "1px solid rgba(239,68,68,0.3)" }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] sm:text-xs font-bold tracking-wider" style={{ color: theme.textSecondary }}>STOCK-OUTS</span>
            <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: "#ef4444" }}>
              <X className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
            </div>
          </div>
          <div className="text-3xl sm:text-4xl font-black" style={{ color: theme.textPrimary }}>{stats.out}</div>
        </div>
      </div>

      {/* ── SEARCH ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl border" style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg }}>
        <Search className="w-4 h-4 flex-shrink-0" style={{ color: theme.textMuted }} />
        <input
          className="flex-1 bg-transparent text-sm outline-none min-w-0"
          style={{ color: theme.textPrimary }}
          placeholder="Search part # or description..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && <button onClick={() => setSearch("")}><X className="w-4 h-4" style={{ color: theme.textMuted }} /></button>}
      </div>

      {/* ── FILTERS ────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none appearance-none cursor-pointer"
          style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg, color: theme.textPrimary }}
        >
          <option value="all">All Types</option>
          <option value="Required">Required</option>
          <option value="Optional">Optional</option>
          <option value="Not on BOM">Not on BOM</option>
          <option value="Consumable">Consumable</option>
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none appearance-none cursor-pointer"
          style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg, color: theme.textPrimary }}
        >
          <option value="all">All Status</option>
          <option value="OK">OK</option>
          <option value="LOW">Low Stock</option>
          <option value="STOCKOUT">Stock-Out</option>
        </select>
      </div>

      {/* ── EXPORT BUTTON ──────────────────────────────────── */}
      <div>
        <button
          onClick={() => exportToXLSX(filtered)}
          className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg border text-sm font-medium"
          style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg, color: theme.textSecondary }}
        >
          <Download className="w-4 h-4" /> Export XLSX
        </button>
      </div>

      {/* ── TABLE ──────────────────────────────────────────── */}
      {filtered.length === 0 ? (
        <WebCard className="py-12 text-center">
          <div className="text-3xl mb-2">🔍</div>
          <div className="text-sm font-semibold" style={{ color: theme.textPrimary }}>No parts found</div>
          <div className="text-xs" style={{ color: theme.textSecondary }}>Try adjusting your search or filters</div>
        </WebCard>
      ) : (
        <WebCard className="overflow-hidden">
          {/* Horizontal scroll wrapper for mobile */}
          <div className="overflow-x-auto max-h-[65vh] overflow-y-auto" style={{ position: "relative" }}>
            <div style={{ minWidth: "720px" }}>
              {/* Table Header — sticky at top */}
              <div className="grid items-center px-4 py-3 text-xs font-semibold border-b"
                style={{
                  gridTemplateColumns: "80px 1fr 100px 55px 45px 45px 80px 45px 65px",
                  backgroundColor: "#0f172a",
                  borderColor: theme.cardBorder,
                  color: theme.textSecondary,
                  position: "sticky",
                  top: 0,
                  zIndex: 10,
                }}>
                <TableHeader label="Part #" col="partNumber" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                <TableHeader label="Description" col="description" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                <TableHeader label="Type" col="type" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} />
                <TableHeader label="QOH" col="qoh" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} align="right" />
                <TableHeader label="Min" col="minQty" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} align="right" />
                <TableHeader label="Max" col="maxQty" sortCol={sortCol} sortAsc={sortAsc} onSort={handleSort} align="right" />
                <span className="text-center">Status</span>
                <span className="text-center">Plan</span>
                <span className="text-center">Actions</span>
              </div>

              {/* Table Body */}
              <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
                {filtered.map(p => {
                  const cs = p.computedStatus;
                  const nType = p.normalizedType;
                  const tStyle = typeBadgeStyle(nType);
                  return (
                    <div
                      key={p._id}
                      className="grid items-center px-4 py-2.5 hover:bg-white/[0.03] transition-colors cursor-pointer"
                      style={{
                        gridTemplateColumns: "80px 1fr 100px 55px 45px 45px 80px 45px 65px",
                      }}
                      onClick={() => setSelectedPart(p)}
                    >
                      {/* Part # */}
                      <span className="text-sm font-medium" style={{ color: "#3b82f6" }}>{p.partNumber}</span>
                      {/* Description */}
                      <span className="text-sm truncate pr-2" style={{ color: theme.textPrimary }}>{p.description}</span>
                      {/* Type — always with colored box */}
                      <span>
                        <span
                          className="inline-block px-2 py-0.5 rounded text-[11px] font-medium whitespace-nowrap"
                          style={{ backgroundColor: tStyle.bg, color: tStyle.text }}
                        >
                          {nType}
                        </span>
                      </span>
                      {/* QOH */}
                      <span className="text-sm font-medium text-right" style={{ color: theme.textPrimary }}>{p.qoh}</span>
                      {/* Min */}
                      <span className="text-sm text-right" style={{ color: theme.textSecondary }}>{p.minQty}</span>
                      {/* Max */}
                      <span className="text-sm text-right" style={{ color: theme.textSecondary }}>{p.maxQty}</span>
                      {/* Status */}
                      <span className="text-center">
                        <span
                          className="px-2 py-0.5 rounded text-[11px] font-bold inline-block"
                          style={{
                            backgroundColor: refStatusColor(cs) + "22",
                            color: refStatusColor(cs),
                          }}
                        >
                          {cs}
                        </span>
                      </span>
                      {/* Plan */}
                      <span className="text-center">
                        {p.onPlan ? (
                          <Check className="w-4 h-4 inline-block" style={{ color: "#22c55e" }} />
                        ) : (
                          <span style={{ color: theme.textMuted }}>—</span>
                        )}
                      </span>
                      {/* Actions */}
                      <span className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
                        {isAdmin ? (
                          <>
                            <button onClick={() => openEdit(p)} className="p-1 rounded hover:bg-white/10 transition-colors" title="Edit">
                              <Pencil className="w-3.5 h-3.5" style={{ color: "#3b82f6" }} />
                            </button>
                            <button onClick={() => { setConfirmDeletePart(p); setActionError(null); }} className="p-1 rounded hover:bg-white/10 transition-colors" title="Delete">
                              <Trash2 className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />
                            </button>
                          </>
                        ) : (
                          <span className="text-[10px]" style={{ color: theme.textMuted }}>—</span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </WebCard>
      )}

      {/* ═══════════════════════════════════════════════════════
          EDIT PART MODAL
          ═══════════════════════════════════════════════════════ */}
      {editPart && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setEditPart(null)}>
          <div className="w-full max-w-md mx-4 rounded-2xl border shadow-2xl" style={{ backgroundColor: "#111827", borderColor: theme.cardBorder }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: theme.cardBorder }}>
              <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>✏️ Edit Part</h3>
              <button onClick={() => setEditPart(null)}><X className="w-4 h-4" style={{ color: theme.textMuted }} /></button>
            </div>
            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              {actionError && (
                <div className="px-3 py-2 rounded-lg text-xs flex items-center gap-2" style={{ backgroundColor: "#ef444420", color: "#ef4444" }}>
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" /> {actionError}
                </div>
              )}
              <EditField label="Part Number" value={editForm.partNumber} disabled />
              <EditField label="Description" value={editForm.description} onChange={v => setEditForm(f => ({ ...f, description: v }))} />
              <div>
                <label className="text-[10px] font-semibold uppercase" style={{ color: theme.textMuted }}>Type</label>
                <select value={editForm.type} onChange={e => setEditForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none border appearance-none"
                  style={{ borderColor: theme.cardBorder, backgroundColor: "#0f172a", color: theme.textPrimary }}>
                  <option value="Required">Required</option>
                  <option value="Optional">Optional</option>
                  <option value="Not on BOM">Not on BOM</option>
                  <option value="Consumable">Consumable</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <EditField label="QOH" value={editForm.qoh} type="number" onChange={v => setEditForm(f => ({ ...f, qoh: v }))} />
                <EditField label="Min" value={editForm.minQty} type="number" onChange={v => setEditForm(f => ({ ...f, minQty: v }))} />
                <EditField label="Max" value={editForm.maxQty} type="number" onChange={v => setEditForm(f => ({ ...f, maxQty: v }))} />
              </div>
              <EditField label="Bin Location" value={editForm.binLocation} onChange={v => setEditForm(f => ({ ...f, binLocation: v }))} />
              <EditField label="Module" value={editForm.module} onChange={v => setEditForm(f => ({ ...f, module: v }))} />
              <div className="flex items-center gap-2">
                <button onClick={() => setEditForm(f => ({ ...f, onPlan: !f.onPlan }))}
                  className="w-5 h-5 rounded border flex items-center justify-center"
                  style={{ borderColor: editForm.onPlan ? "#6366f1" : theme.cardBorder, backgroundColor: editForm.onPlan ? "#6366f1" : "transparent" }}>
                  {editForm.onPlan && <Check className="w-3 h-3 text-white" />}
                </button>
                <span className="text-xs" style={{ color: theme.textSecondary }}>On Stocking Plan</span>
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t" style={{ borderColor: theme.cardBorder }}>
              <button onClick={() => setEditPart(null)} className="flex-1 py-2.5 rounded-xl text-sm font-bold border"
                style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>Cancel</button>
              <button onClick={saveEdit} disabled={saving}
                className="flex-[2] py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ backgroundColor: "#3b82f6" }}>
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          DELETE CONFIRMATION MODAL
          ═══════════════════════════════════════════════════════ */}
      {confirmDeletePart && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setConfirmDeletePart(null)}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border shadow-2xl" style={{ backgroundColor: "#111827", borderColor: theme.cardBorder }}
            onClick={e => e.stopPropagation()}>
            <div className="p-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto" style={{ backgroundColor: "#ef444420" }}>
                <AlertTriangle className="w-6 h-6" style={{ color: "#ef4444" }} />
              </div>
              <h3 className="text-lg font-bold" style={{ color: theme.textPrimary }}>Are you sure?</h3>
              <p className="text-sm" style={{ color: theme.textSecondary }}>
                This will permanently delete <strong style={{ color: theme.textPrimary }}>{confirmDeletePart.partNumber}</strong> — {confirmDeletePart.description}
              </p>
              {actionError && (
                <div className="px-3 py-2 rounded-lg text-xs" style={{ backgroundColor: "#ef444420", color: "#ef4444" }}>{actionError}</div>
              )}
            </div>
            <div className="flex gap-2 p-4 border-t" style={{ borderColor: theme.cardBorder }}>
              <button onClick={() => setConfirmDeletePart(null)} className="flex-1 py-2.5 rounded-xl text-sm font-bold border"
                style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>Cancel</button>
              <button onClick={confirmDelete} disabled={saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ backgroundColor: "#ef4444" }}>
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting...</> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          ADD PART MODAL
          ═══════════════════════════════════════════════════════ */}
      {addPartOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setAddPartOpen(false)}>
          <div className="w-full max-w-md mx-4 rounded-2xl border shadow-2xl" style={{ backgroundColor: "#111827", borderColor: theme.cardBorder }}
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: theme.cardBorder }}>
              <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>➕ Add New Part</h3>
              <button onClick={() => setAddPartOpen(false)}><X className="w-4 h-4" style={{ color: theme.textMuted }} /></button>
            </div>
            <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
              {actionError && (
                <div className="px-3 py-2 rounded-lg text-xs flex items-center gap-2" style={{ backgroundColor: "#ef444420", color: "#ef4444" }}>
                  <AlertTriangle className="w-3 h-3 flex-shrink-0" /> {actionError}
                </div>
              )}
              <EditField label="Part Number *" value={addForm.partNumber} onChange={v => setAddForm(f => ({ ...f, partNumber: v }))} />
              <EditField label="Description *" value={addForm.description} onChange={v => setAddForm(f => ({ ...f, description: v }))} />
              <div>
                <label className="text-[10px] font-semibold uppercase" style={{ color: theme.textMuted }}>Type</label>
                <select value={addForm.type} onChange={e => setAddForm(f => ({ ...f, type: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none border appearance-none"
                  style={{ borderColor: theme.cardBorder, backgroundColor: "#0f172a", color: theme.textPrimary }}>
                  <option value="Required">Required</option>
                  <option value="Optional">Optional</option>
                  <option value="Not on BOM">Not on BOM</option>
                  <option value="Consumable">Consumable</option>
                </select>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <EditField label="QOH" value={addForm.qoh} type="number" onChange={v => setAddForm(f => ({ ...f, qoh: v }))} />
                <EditField label="Min" value={addForm.minQty} type="number" onChange={v => setAddForm(f => ({ ...f, minQty: v }))} />
                <EditField label="Max" value={addForm.maxQty} type="number" onChange={v => setAddForm(f => ({ ...f, maxQty: v }))} />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setAddForm(f => ({ ...f, onPlan: !f.onPlan }))}
                  className="w-5 h-5 rounded border flex items-center justify-center"
                  style={{ borderColor: addForm.onPlan ? "#6366f1" : theme.cardBorder, backgroundColor: addForm.onPlan ? "#6366f1" : "transparent" }}>
                  {addForm.onPlan && <Check className="w-3 h-3 text-white" />}
                </button>
                <span className="text-xs" style={{ color: theme.textSecondary }}>On Stocking Plan</span>
              </div>
            </div>
            <div className="flex gap-2 p-4 border-t" style={{ borderColor: theme.cardBorder }}>
              <button onClick={() => setAddPartOpen(false)} className="flex-1 py-2.5 rounded-xl text-sm font-bold border"
                style={{ borderColor: theme.cardBorder, color: theme.textSecondary }}>Cancel</button>
              <button onClick={saveNewPart} disabled={saving || !addForm.partNumber || !addForm.description}
                className="flex-[2] py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-40 flex items-center justify-center gap-2"
                style={{ backgroundColor: "#22c55e" }}>
                {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Adding...</> : "Add Part"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Reusable edit field ────────────────────────────────────── */
function EditField({ label, value, onChange, type = "text", disabled = false }: {
  label: string; value: string | number; onChange?: (v: string) => void; type?: string; disabled?: boolean;
}) {
  return (
    <div>
      <label className="text-[10px] font-semibold uppercase" style={{ color: theme.textMuted }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={onChange ? e => onChange(e.target.value) : undefined}
        disabled={disabled}
        className="w-full mt-1 px-3 py-2 rounded-xl text-sm outline-none border disabled:opacity-50"
        style={{ borderColor: theme.cardBorder, backgroundColor: disabled ? "#1e293b" : "#0f172a", color: theme.textPrimary }}
      />
    </div>
  );
}

/* ── Table header cell with sort ────────────────────────────── */
function TableHeader({
  label, col, sortCol, sortAsc, onSort, align = "left"
}: {
  label: string; col: SortCol; sortCol: SortCol; sortAsc: boolean;
  onSort: (c: SortCol) => void; align?: "left" | "right";
}) {
  const active = sortCol === col;
  return (
    <button
      onClick={() => onSort(col)}
      className={`flex items-center gap-1 ${align === "right" ? "justify-end" : ""}`}
    >
      <span style={{ color: active ? "#6366f1" : undefined }}>{label}</span>
      {active && (sortAsc
        ? <ChevronUp className="w-3 h-3" style={{ color: "#6366f1" }} />
        : <ChevronDown className="w-3 h-3" style={{ color: "#6366f1" }} />
      )}
    </button>
  );
}
