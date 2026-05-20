import { useMemo } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, ProgressBar, StatusBadge, theme, statusColor } from "../../components/vitros/SharedComponents";

export function InventoryAccuracy() {
  const data = useConvexData();

  const categories = useMemo(() => {
    const inRange = data.parts.filter(p => p.qoh >= p.minQty && p.qoh <= p.maxQty);
    const belowMin = data.parts.filter(p => p.qoh < p.minQty && p.qoh > 0);
    const aboveMax = data.parts.filter(p => p.qoh > p.maxQty);
    const stockOut = data.parts.filter(p => p.qoh === 0);
    return { inRange, belowMin, aboveMax, stockOut };
  }, [data.parts]);

  const total = data.parts.length || 1;
  const accuracyPct = Math.round((categories.inRange.length / total) * 100);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>🎯 Inventory Accuracy</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>How well are we maintaining target levels?</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DashCard label="IN RANGE" value={categories.inRange.length} subtitle={accuracyPct + "% healthy"} icon="✅" color={theme.statusOk} />
        <DashCard label="BELOW MIN" value={categories.belowMin.length} icon="⬇️" color="#f59e0b" />
        <DashCard label="ABOVE MAX" value={categories.aboveMax.length} icon="⬆️" color={theme.statusOver} />
        <DashCard label="STOCK-OUT" value={categories.stockOut.length} icon="🚨" color={theme.statusOut} />
      </div>

      <WebCard className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold" style={{ color: theme.textSecondary }}>Overall Accuracy</span>
          <span className="text-sm font-bold" style={{ color: accuracyPct >= 90 ? theme.statusOk : theme.statusLow }}>{accuracyPct}%</span>
        </div>
        <ProgressBar value={accuracyPct} maxValue={100} color={accuracyPct >= 90 ? theme.statusOk : theme.statusLow} height={10} />
      </WebCard>

      {categories.stockOut.length > 0 && (
        <WebCard className="overflow-hidden">
          <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
            <h3 className="text-sm font-bold" style={{ color: theme.statusOut }}>Stock-Outs ({categories.stockOut.length})</h3>
          </div>
          <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
            {categories.stockOut.map(p => (
              <div key={p._id} className="flex items-center gap-3 px-4 py-2">
                <StatusBadge text="OUT" color={theme.statusOut} />
                <div className="flex-1"><span className="text-sm" style={{ color: theme.textPrimary }}>{p.partNumber}</span></div>
                <span className="text-xs" style={{ color: theme.textMuted }}>Min: {p.minQty}</span>
              </div>
            ))}
          </div>
        </WebCard>
      )}

      {categories.belowMin.length > 0 && (
        <WebCard className="overflow-hidden">
          <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
            <h3 className="text-sm font-bold" style={{ color: "#f59e0b" }}>Below Min ({categories.belowMin.length})</h3>
          </div>
          <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
            {categories.belowMin.map(p => (
              <div key={p._id} className="flex items-center gap-3 px-4 py-2">
                <StatusBadge text="LOW" color="#f59e0b" />
                <div className="flex-1">
                  <span className="text-sm" style={{ color: theme.textPrimary }}>{p.partNumber}</span>
                </div>
                <span className="text-xs" style={{ color: theme.textMuted }}>{p.qoh} / {p.minQty} min</span>
              </div>
            ))}
          </div>
        </WebCard>
      )}
    </div>
  );
}
