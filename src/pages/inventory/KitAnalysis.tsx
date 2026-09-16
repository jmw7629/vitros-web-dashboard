import { getKitDemand } from "../../lib/kitDemand";
import { useMemo } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, StatusBadge, ProgressBar, theme } from "../../components/vitros/SharedComponents";

export function KitAnalysis() {
  const data = useConvexData();

  const kitData = useMemo(() => {
    return data.kits.map(kit => {
      const demand = getKitDemand(kit.components);
      const components = demand.lines.map(c => {
        const part = data.parts.find(p => p.partNumber === c.partNumber);
        const available = part?.qoh ?? 0;
        const needed = demand.totals.get(c.partNumber) ?? 0;
        return { ...c, available, enough: c.resolvedQuantity !== null && available >= needed, partDesc: c.description || part?.description || "" };
      });
      const ready = components.length > 0 && demand.unresolved.length === 0 && components.every(c => c.enough);
      const readyPct = components.length ? Math.round(components.filter(c => c.enough).length / components.length * 100) : 0;
      const buildable = demand.unresolved.length ? null : demand.parts.length ? Math.min(...demand.parts.map(c => Math.floor((data.parts.find(p => p.partNumber === c.partNumber)?.qoh ?? 0) / c.qtyRequired))) : 0;
      return { ...kit, components, ready, readyPct, buildable, needsQuantity: demand.unresolved.length > 0 };
    });
  }, [data.kits, data.parts]);

  const readyCount = kitData.filter(k => k.ready).length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>🧰 Kit Analysis</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Kit readiness — all components must be in stock</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <DashCard label="TOTAL KITS" value={kitData.length} icon="📦" color="#6366f1" />
        <DashCard label="READY" value={readyCount} icon="✅" color={theme.statusOk} />
        <DashCard label="INCOMPLETE" value={kitData.length - readyCount} icon="⚠️" color={theme.statusOut} />
      </div>

      {kitData.map(kit => (
        <WebCard key={kit._id} className="overflow-hidden">
          <div className="flex items-center gap-3 px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
            <StatusBadge text={kit.ready ? "READY" : kit.needsQuantity ? "CHECK QUANTITY" : "INCOMPLETE"} color={kit.ready ? theme.statusOk : theme.statusOut} />
            <div className="flex-1">
              <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>{kit.name}</div>
              <div className="text-[10px]" style={{ color: theme.textMuted }}>{kit.kitId} · {kit.components.length} BOM lines · Buildable: {kit.buildable ?? "Check measured consumables"}</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold" style={{ color: kit.ready ? theme.statusOk : theme.statusOut }}>{kit.readyPct}%</div>
            </div>
          </div>
          <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
            {kit.components.map((c: any, index: number) => (
              <div key={c.sourceLine || (c.partNumber + ":" + index)} className="flex items-center gap-3 px-4 py-2">
                <span className={c.enough ? "" : ""}>
                  {c.enough ? "✅" : "❌"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium" style={{ color: theme.textPrimary }}>{c.partNumber}</div>
                  <div className="text-[10px]" style={{ color: theme.textMuted }}>{c.partDesc}</div>
                  {c.module && <div className="text-[10px]" style={{ color: theme.textMuted }}>{c.module}</div>}
                </div>
                <div className="text-xs text-right" style={{ color: c.enough ? theme.statusOk : theme.statusOut }}>
                  {c.available} / {c.quantityLabel || c.qtyRequired}
                </div>
              </div>
            ))}
          </div>
        </WebCard>
      ))}

      {kitData.length === 0 && (
        <WebCard className="py-10 text-center">
          <div className="text-3xl mb-2">📦</div>
          <div className="text-sm" style={{ color: theme.textSecondary }}>No kits defined</div>
        </WebCard>
      )}
    </div>
  );
}
