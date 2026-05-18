import { useMemo, useState } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, StatusBadge, DashCard, theme, statusColor, downloadCSV } from "../../components/vitros/SharedComponents";
import { Search, Download, AlertTriangle } from "lucide-react";

export function ReorderStockout() {
  const data = useConvexData();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "out" | "low">("all");

  const reorderParts = useMemo(() => {
    return data.parts
      .filter(p => p.qoh <= p.minQty)
      .map(p => ({ ...p, gapToMin: p.minQty - p.qoh, orderQty: p.maxQty - p.qoh }))
      .sort((a, b) => a.qoh - b.qoh);
  }, [data.parts]);

  const filtered = useMemo(() => {
    let result = reorderParts;
    if (filter === "out") result = result.filter(p => p.qoh === 0);
    if (filter === "low") result = result.filter(p => p.qoh > 0);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(p => p.partNumber.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }
    return result;
  }, [reorderParts, filter, search]);

  const outCount = reorderParts.filter(p => p.qoh === 0).length;
  const lowCount = reorderParts.filter(p => p.qoh > 0).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>🔔 Reorder & Stock-Out</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Parts that need attention — at zero or approaching it</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <DashCard label="TOTAL REORDER" value={reorderParts.length} icon="📋" color="#f59e0b" />
        <DashCard label="STOCK-OUTS" value={outCount} icon="🚨" color={theme.statusOut} />
        <DashCard label="LOW STOCK" value={lowCount} icon="⬇️" color={theme.statusLow} />
      </div>

      <div className="flex gap-2">
        {(["all", "out", "low"] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-full text-xs font-semibold"
            style={{ backgroundColor: filter === f ? "#3b82f6" : theme.cardBg, color: filter === f ? "white" : theme.textSecondary }}>
            {f === "all" ? "All" : f === "out" ? "Stock-Outs" : "Low Stock"}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border" style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg }}>
        <Search className="w-4 h-4 text-slate-500" />
        <input className="flex-1 bg-transparent text-sm outline-none" style={{ color: theme.textPrimary }}
          placeholder="Search parts..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <WebCard className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>{filtered.length} parts need reorder</span>
          <button onClick={() => downloadCSV(filtered.map(p => ({
            "Part Number": p.partNumber,
            Description: p.description,
            QOH: p.qoh,
            Min: p.minQty,
            Max: p.maxQty,
            "Gap to Min": p.gapToMin,
            "Order Qty": p.orderQty,
            Status: p.qoh === 0 ? "OUT" : "LOW",
          })), "reorder-stockout-export.csv")} className="flex items-center gap-1 text-xs font-medium" style={{ color: "#6366f1" }}>
            <Download className="w-3 h-3" /> Export
          </button>
        </div>
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm" style={{ color: theme.textSecondary }}>No parts need reorder 🎉</div>
        ) : (
          <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
            {filtered.map(p => (
              <div key={p._id} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <StatusBadge text={p.qoh === 0 ? "OUT" : "LOW"} color={p.qoh === 0 ? theme.statusOut : theme.statusLow} />
                    <span className="text-sm font-medium" style={{ color: theme.textPrimary }}>{p.partNumber}</span>
                  </div>
                  <span className="text-xs font-bold" style={{ color: theme.statusOut }}>QOH: {p.qoh}</span>
                </div>
                <div className="text-xs mb-1.5" style={{ color: theme.textSecondary }}>{p.description}</div>
                <div className="flex items-center gap-4 text-[10px]" style={{ color: theme.textMuted }}>
                  <span>Min: {p.minQty}</span>
                  <span>Max: {p.maxQty}</span>
                  <span style={{ color: theme.statusOut }}>Gap: {p.gapToMin}</span>
                  <span style={{ color: "#6366f1" }}>Order: {p.orderQty}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </WebCard>
    </div>
  );
}
