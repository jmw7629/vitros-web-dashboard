import { useMemo } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { useConfig } from "../../hooks/useConfig";
import { WebCard, StatusBadge, DashCard, theme } from "../../components/vitros/SharedComponents";
import type { TurnoverChartConfig } from "../../lib/configRegistry";

export function InventoryTurnover() {
  const data = useConvexData();
  const { get } = useConfig();
  const turnoverConfig = get<TurnoverChartConfig>("charts.inventoryTurnover");

  const turnoverData = useMemo(() => {
    return data.parts.map(p => {
      const outTxns = data.transactions.filter(t => t.partNumber === p.partNumber && t.mode === "OUT");
      const totalOut = outTxns.reduce((s, t) => s + Math.abs(t.qty), 0);
      const avgQoh = Math.max(p.qoh, 1);
      const ratio = parseFloat((totalOut / avgQoh).toFixed(1));
      const cls = ratio >= 5 ? "High" : ratio >= 2 ? "Medium" : ratio > 0 ? "Low" : "None";
      return { ...p, totalOut, ratio, cls };
    }).sort((a, b) => b.ratio - a.ratio);
  }, [data.parts, data.transactions]);

  const high = turnoverData.filter(p => p.cls === "High").length;
  const med = turnoverData.filter(p => p.cls === "Medium").length;
  const low = turnoverData.filter(p => p.cls === "Low").length;
  const none = turnoverData.filter(p => p.cls === "None").length;

  const clsColor = (c: string) => {
    const colors = turnoverConfig.colors;
    switch (c) {
      case "High": return colors[0] || theme.statusOk;
      case "Medium": return colors[1] || "#3b82f6";
      case "Low": return colors[2] || "#f59e0b";
      default: return colors[3] || theme.statusOut;
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>🔄 Inventory Turnover</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>How fast each part moves through the system</p>
      </div>

      {turnoverConfig.showClassCards && (
        <div className="grid grid-cols-4 gap-2">
          <DashCard label="HIGH" value={high} icon="🟢" color={clsColor("High")} />
          <DashCard label="MEDIUM" value={med} icon="🔵" color={clsColor("Medium")} />
          <DashCard label="LOW" value={low} icon="🟡" color={clsColor("Low")} />
          <DashCard label="NONE" value={none} icon="🔴" color={clsColor("None")} />
        </div>
      )}

      <WebCard className="overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Turnover Ratios</h3>
        </div>
        <div className="divide-y max-h-[55vh] overflow-y-auto" style={{ borderColor: theme.cardBorder }}>
          {turnoverData.map(p => (
            <div key={p._id} className="flex items-center gap-3 px-4 py-2">
              <StatusBadge text={p.cls} color={clsColor(p.cls)} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>{p.partNumber}</div>
                <div className="text-xs" style={{ color: theme.textSecondary }}>{p.description}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold" style={{ color: clsColor(p.cls) }}>{p.ratio}x</div>
                <div className="text-[9px]" style={{ color: theme.textMuted }}>{p.totalOut} out / {p.qoh} QOH</div>
              </div>
            </div>
          ))}
        </div>
      </WebCard>
    </div>
  );
}
