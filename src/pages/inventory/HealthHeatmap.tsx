import { useMemo, useState } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import type { Part } from "../../hooks/useConvexData";
import { WebCard, DashCard, ProgressBar, theme } from "../../components/vitros/SharedComponents";

// ═══════════════════════════════════════════════════════════════
// Health Heatmap — mirrors SwiftUI HealthHeatmapView exactly
// Visual grid + health score + type breakdown + detail popup
// ═══════════════════════════════════════════════════════════════

const heatColor = (status: string) => {
  switch (status) {
    case "OK": return "#22c55e";
    case "LOW": return "#f59e0b";
    case "OUT": return "#ef4444";
    case "OVER": return "#14b8d4";
    default: return "#64748b";
  }
};

export function HealthHeatmap() {
  const data = useConvexData();
  const [selectedPart, setSelectedPart] = useState<Part | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("All");

  const groups = useMemo(() => {
    const g: Record<string, Part[]> = { OK: [], LOW: [], OUT: [], OVER: [] };
    for (const p of data.parts) {
      if (g[p.status]) g[p.status].push(p);
      else g.OK.push(p);
    }
    return g;
  }, [data.parts]);

  const healthScore = useMemo(() => {
    const total = Math.max(data.parts.length, 1);
    const ok = groups.OK.length;
    return Math.round((ok / total) * 100);
  }, [data.parts, groups]);

  const filtered = filterStatus === "All" ? data.parts : data.parts.filter(p => p.status === filterStatus);

  // Group by type for heatmap sections
  const byType = useMemo(() => {
    const m: Record<string, Part[]> = {};
    for (const p of filtered) {
      const t = (!p.type || p.type === "0") ? "Not on BOM" : p.type;
      if (!m[t]) m[t] = [];
      m[t].push(p);
    }
    return Object.entries(m).sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black" style={{ color: theme.textPrimary }}>Health Heatmap</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>
          Visual grid of every part, color-coded by stock health
        </p>
      </div>

      {/* Health Score + Status Cards */}
      <div className="grid grid-cols-5 gap-3">
        {/* Health Score Card */}
        <WebCard className="p-4 col-span-1 flex flex-col items-center justify-center">
          <div className="relative w-20 h-20">
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="42" fill="none" stroke={`${theme.cardBorder}44`} strokeWidth="8" />
              <circle cx="50" cy="50" r="42" fill="none"
                stroke={healthScore >= 80 ? "#22c55e" : healthScore >= 60 ? "#f59e0b" : "#ef4444"}
                strokeWidth="8" strokeDasharray={`${healthScore * 2.64} 264`} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-xl font-black" style={{ color: healthScore >= 80 ? "#22c55e" : healthScore >= 60 ? "#f59e0b" : "#ef4444" }}>
                {healthScore}
              </span>
            </div>
          </div>
          <span className="text-[10px] font-bold mt-1" style={{ color: theme.textMuted }}>HEALTH SCORE</span>
        </WebCard>

        <DashCard label="OK" value={groups.OK.length} subtitle={`${Math.round((groups.OK.length / Math.max(data.parts.length, 1)) * 100)}%`} icon="🟢" color="#22c55e" />
        <DashCard label="LOW" value={groups.LOW.length} subtitle={`${Math.round((groups.LOW.length / Math.max(data.parts.length, 1)) * 100)}%`} icon="🟡" color="#f59e0b" />
        <DashCard label="OUT" value={groups.OUT.length} subtitle={`${Math.round((groups.OUT.length / Math.max(data.parts.length, 1)) * 100)}%`} icon="🔴" color="#ef4444" />
        <DashCard label="OVER" value={groups.OVER.length} subtitle={`${Math.round((groups.OVER.length / Math.max(data.parts.length, 1)) * 100)}%`} icon="🔵" color="#14b8d4" />
      </div>

      {/* Status Distribution Bar */}
      <WebCard className="p-4">
        <div className="text-xs font-bold tracking-wider mb-2" style={{ color: theme.textMuted }}>STATUS DISTRIBUTION</div>
        <div className="flex rounded-lg overflow-hidden h-6">
          {(["OK", "LOW", "OUT", "OVER"] as const).map(s => {
            const pct = (groups[s].length / Math.max(data.parts.length, 1)) * 100;
            if (pct < 1) return null;
            return (
              <div key={s} className="flex items-center justify-center text-[9px] font-bold text-white transition-all cursor-pointer hover:brightness-110"
                style={{ width: `${pct}%`, backgroundColor: heatColor(s), minWidth: pct > 3 ? "25px" : "0" }}
                onClick={() => setFilterStatus(filterStatus === s ? "All" : s)}>
                {pct > 5 ? `${s} ${Math.round(pct)}%` : ""}
              </div>
            );
          })}
        </div>
      </WebCard>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2">
        {["All", "OK", "LOW", "OUT", "OVER"].map(s => {
          const count = s === "All" ? data.parts.length : groups[s]?.length ?? 0;
          const active = filterStatus === s;
          const color = s === "All" ? theme.accentBlue : heatColor(s);
          return (
            <button key={s} onClick={() => setFilterStatus(s)}
              className="text-xs font-bold px-3 py-1.5 rounded-lg transition-all"
              style={{
                backgroundColor: active ? color : "transparent",
                color: active ? "#fff" : theme.textSecondary,
                border: `1px solid ${active ? color : theme.cardBorder}`,
              }}>
              {s} ({count})
            </button>
          );
        })}
        <span className="text-xs ml-auto" style={{ color: theme.textMuted }}>{filtered.length} parts shown</span>
      </div>

      {/* Heatmap Grid — grouped by type */}
      {byType.map(([type, parts]) => (
        <WebCard key={type} className="p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>{type}</h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${theme.cardBorder}44`, color: theme.textMuted }}>
              {parts.length} parts
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {parts.map(p => (
              <div key={p._id} className="group relative cursor-pointer"
                onClick={() => setSelectedPart(selectedPart?._id === p._id ? null : p)}>
                <div className="w-5 h-5 rounded-sm transition-all hover:scale-[2] hover:z-10 hover:ring-2 hover:ring-white/30"
                  style={{ backgroundColor: heatColor(p.status) }}
                  title={`${p.partNumber} — ${p.status} (QOH: ${p.qoh})`} />
              </div>
            ))}
          </div>
        </WebCard>
      ))}

      {/* Legend */}
      <div className="flex justify-center gap-6">
        {[
          { label: "OK — Within range", color: "#22c55e" },
          { label: "LOW — Below minimum", color: "#f59e0b" },
          { label: "OUT — Zero stock", color: "#ef4444" },
          { label: "OVER — Above maximum", color: "#14b8d4" },
        ].map(l => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: l.color }} />
            <span className="text-[10px]" style={{ color: theme.textSecondary }}>{l.label}</span>
          </div>
        ))}
      </div>

      {/* Part Detail Popup */}
      {selectedPart && (
        <WebCard className="p-4 border-2" style={{ borderColor: heatColor(selectedPart.status) }}>
          <div className="flex items-start justify-between">
            <div>
              <div className="text-lg font-bold" style={{ color: theme.accentBlue }}>{selectedPart.partNumber}</div>
              <div className="text-sm" style={{ color: theme.textSecondary }}>{selectedPart.description}</div>
            </div>
            <button onClick={() => setSelectedPart(null)}
              className="text-xs px-2 py-1 rounded-lg" style={{ backgroundColor: theme.cardBg, color: theme.textMuted }}>✕</button>
          </div>
          <div className="grid grid-cols-4 gap-3 mt-3">
            <div className="text-center">
              <div className="text-lg font-bold" style={{ color: theme.textPrimary }}>{selectedPart.qoh}</div>
              <div className="text-[10px]" style={{ color: theme.textMuted }}>QOH</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold" style={{ color: theme.textPrimary }}>{selectedPart.minQty}</div>
              <div className="text-[10px]" style={{ color: theme.textMuted }}>Min</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold" style={{ color: theme.textPrimary }}>{selectedPart.maxQty}</div>
              <div className="text-[10px]" style={{ color: theme.textMuted }}>Max</div>
            </div>
            <div className="text-center">
              <div className="text-sm font-bold px-2 py-1 rounded-md text-white"
                style={{ backgroundColor: heatColor(selectedPart.status) }}>{selectedPart.status}</div>
              <div className="text-[10px] mt-1" style={{ color: theme.textMuted }}>Status</div>
            </div>
          </div>
          {/* Health bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px]" style={{ color: theme.textMuted }}>Stock Level</span>
              <span className="text-[10px] font-bold" style={{ color: theme.textPrimary }}>
                {selectedPart.qoh} / {selectedPart.maxQty || "—"}
              </span>
            </div>
            {selectedPart.maxQty > 0 && (
              <ProgressBar
                value={Math.min(selectedPart.qoh, selectedPart.maxQty)}
                maxValue={selectedPart.maxQty}
                color={heatColor(selectedPart.status)}
                height={6}
              />
            )}
          </div>
        </WebCard>
      )}
    </div>
  );
}
