import { useMemo, useState, useRef, useEffect } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, StatusBadge, theme, downloadCSV } from "../../components/vitros/SharedComponents";

// ═══════════════════════════════════════════════════════════════
// ABC Analysis — mirrors reference app exactly
// Class cards, Pareto chart, donut chart, filter pills, table
// ═══════════════════════════════════════════════════════════════

interface ClassifiedPart {
  _id: string;
  partNumber: string;
  description: string;
  type: string;
  qoh: number;
  minQty: number;
  maxQty: number;
  status: string;
  onPlan: boolean;
  usage: number;
  score: number;
  class: string;
  pctOfTotal: number;
  cumulativePct: number;
}

const CLASS_COLORS = { A: "#ef4444", B: "#f59e0b", C: "#22c55e" } as const;

export function AbcAnalysis() {
  const data = useConvexData();
  const [selectedClass, setSelectedClass] = useState<"All" | "A" | "B" | "C">("All");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All Types");

  const classified = useMemo<ClassifiedPart[]>(() => {
    // Score each part based on usage volume, criticality, and stock health
    const scored = data.parts.map(p => {
      const txns = data.transactions.filter(t => t.partNumber === p.partNumber && t.mode === "OUT");
      const usage = txns.reduce((s, t) => s + Math.abs(t.qty), 0);
      // Score = usage * type weight * status factor
      const typeWeight = p.type === "Required" ? 3 : p.type === "Optional" ? 2 : 1;
      const statusFactor = p.status === "OUT" ? 2 : p.status === "LOW" ? 1.5 : 1;
      const score = Math.max(usage * typeWeight * statusFactor, p.qoh > 0 ? p.qoh : 0);
      return { ...p, usage, score };
    }).sort((a, b) => b.score - a.score);

    const totalScore = scored.reduce((s, p) => s + p.score, 0) || 1;
    let cumulative = 0;
    return scored.map(p => {
      cumulative += p.score;
      const pct = (cumulative / totalScore) * 100;
      const cls = pct <= 80 ? "A" : pct <= 95 ? "B" : "C";
      return { ...p, class: cls, pctOfTotal: (p.score / totalScore) * 100, cumulativePct: pct };
    });
  }, [data.parts, data.transactions]);

  const aItems = classified.filter(p => p.class === "A");
  const bItems = classified.filter(p => p.class === "B");
  const cItems = classified.filter(p => p.class === "C");
  const total = classified.length || 1;

  const types = useMemo(() => {
    const t = new Set(data.parts.map(p => (!p.type || p.type === "0") ? "Not on BOM" : p.type));
    return ["All Types", ...Array.from(t).sort()];
  }, [data.parts]);

  const filtered = useMemo(() => {
    let items = selectedClass === "All" ? classified : classified.filter(p => p.class === selectedClass);
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(p => p.partNumber.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
    }
    if (typeFilter !== "All Types") {
      items = items.filter(p => {
        const t = (!p.type || p.type === "0") ? "Not on BOM" : p.type;
        return t === typeFilter;
      });
    }
    return items;
  }, [classified, selectedClass, search, typeFilter]);

  const exportXLSX = () => {
    downloadCSV(filtered.map(p => ({
      "Part #": p.partNumber,
      "Description": p.description,
      "Type": p.type,
      "Class": p.class,
      "QOH": p.qoh,
      "Min": p.minQty,
      "Max": p.maxQty,
      "Status": p.status,
      "Score": Math.round(p.score),
      "% of Total": p.pctOfTotal.toFixed(2) + "%",
      "Cumulative %": p.cumulativePct.toFixed(2) + "%",
    })), "abc-analysis.csv");
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black" style={{ color: theme.textPrimary }}>ABC Analysis</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>
          Pareto classification — critical vs standard inventory
        </p>
      </div>

      {/* Class Cards — 3 across */}
      <div className="grid grid-cols-3 gap-3">
        <ClassCard label="CLASS A" count={aItems.length} pct={Math.round((aItems.length / total) * 100)}
          sub="Critical" icon="📊" borderColor="#ef4444" iconBg="#ef444420" />
        <ClassCard label="CLASS B" count={bItems.length} pct={Math.round((bItems.length / total) * 100)}
          sub="Moderate" icon="📊" borderColor="#f59e0b" iconBg="#f59e0b20" />
        <ClassCard label="CLASS C" count={cItems.length} pct={Math.round((cItems.length / total) * 100)}
          sub="Low" icon="✅" borderColor="#22c55e" iconBg="#22c55e20" />
      </div>

      {/* Pareto Chart */}
      <ParetoChart parts={classified.slice(0, 40)} />

      {/* Donut Chart */}
      <DonutChart a={aItems.length} b={bItems.length} c={cItems.length} />

      {/* Filter Pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {(["All", "A", "B", "C"] as const).map(cls => {
          const count = cls === "All" ? classified.length : classified.filter(p => p.class === cls).length;
          const active = selectedClass === cls;
          const color = cls === "All" ? theme.accentBlue : CLASS_COLORS[cls];
          return (
            <button key={cls} onClick={() => setSelectedClass(cls)}
              className="text-xs font-bold px-4 py-2 rounded-xl transition-all"
              style={{
                backgroundColor: active ? `${color}22` : theme.cardBg,
                color: active ? color : theme.textSecondary,
                border: `1px solid ${active ? color : theme.cardBorder}`,
              }}>
              {cls === "All" ? "All" : `${cls} (${count})`}
            </button>
          );
        })}
      </div>

      {/* Search + Type Filter + Export */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border" style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg }}>
          <span style={{ color: theme.textMuted }}>🔍</span>
          <input className="flex-1 bg-transparent text-sm outline-none" style={{ color: theme.textPrimary }}
            placeholder="Search part # or description..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="px-3 py-2 rounded-xl text-sm border bg-transparent outline-none cursor-pointer"
          style={{ borderColor: theme.cardBorder, color: theme.textPrimary, backgroundColor: theme.cardBg }}
          value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button onClick={exportXLSX}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all hover:brightness-110"
          style={{ borderColor: theme.cardBorder, color: theme.textSecondary, backgroundColor: theme.cardBg }}>
          📥 Export XLSX
        </button>
      </div>

      {/* Parts Table */}
      <WebCard className="overflow-hidden">
        <div className="grid items-center px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider border-b"
          style={{
            gridTemplateColumns: "38px 85px minmax(110px, 2fr) 68px 55px 50px 50px 50px 48px",
            backgroundColor: "#0f172a",
            borderColor: theme.cardBorder,
            color: theme.textMuted,
          }}>
          <span>Class</span>
          <span>Part #</span>
          <span>Description</span>
          <span>Type</span>
          <span className="text-right">Score</span>
          <span className="text-right">QOH</span>
          <span className="text-right">Min</span>
          <span className="text-right">Max</span>
          <span className="text-right">Status</span>
        </div>

        <div className="divide-y max-h-[50vh] overflow-y-auto" style={{ borderColor: theme.cardBorder }}>
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm" style={{ color: theme.textSecondary }}>No parts found</div>
          ) : (
            filtered.map(p => {
              const nType = (!p.type || p.type === "0") ? "Not on BOM" : p.type;
              const tBg = nType === "Required" ? "#ea580c" : nType === "Optional" ? "#ca8a04" : "#475569";
              return (
                <div key={p._id} className="grid items-center px-4 py-2 transition-colors hover:brightness-110"
                  style={{ gridTemplateColumns: "38px 85px minmax(110px, 2fr) 68px 55px 50px 50px 50px 48px" }}>
                  <span>
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-md text-[11px] font-black text-white"
                      style={{ backgroundColor: CLASS_COLORS[p.class as keyof typeof CLASS_COLORS] || "#64748b" }}>
                      {p.class}
                    </span>
                  </span>
                  <span className="text-sm font-medium" style={{ color: theme.accentBlue }}>{p.partNumber}</span>
                  <span className="text-xs truncate pr-2" style={{ color: theme.textPrimary }}>{p.description}</span>
                  <span>
                    <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold whitespace-nowrap"
                      style={{ backgroundColor: tBg, color: "#fff" }}>{nType}</span>
                  </span>
                  <span className="text-xs font-bold text-right" style={{ color: theme.textPrimary }}>{Math.round(p.score)}</span>
                  <span className="text-xs font-bold text-right" style={{
                    color: p.status === "OUT" ? theme.statusOut : p.status === "LOW" ? "#f59e0b" : theme.textPrimary
                  }}>{p.qoh}</span>
                  <span className="text-xs text-right" style={{ color: theme.textMuted }}>{p.minQty}</span>
                  <span className="text-xs text-right" style={{ color: theme.textMuted }}>{p.maxQty}</span>
                  <span className="text-right">
                    <StatusBadge text={p.status} color={
                      p.status === "OK" ? theme.statusOk : p.status === "LOW" ? "#f59e0b" : p.status === "OUT" ? theme.statusOut : theme.accentBlue
                    } />
                  </span>
                </div>
              );
            })
          )}
        </div>
      </WebCard>
    </div>
  );
}

// ─── Class Card ───
function ClassCard({ label, count, pct, sub, icon, borderColor, iconBg }: {
  label: string; count: number; pct: number; sub: string; icon: string; borderColor: string; iconBg: string;
}) {
  return (
    <WebCard className="p-4" style={{ borderLeft: `3px solid ${borderColor}` }}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] font-bold tracking-wider" style={{ color: theme.textMuted }}>{label}</div>
          <div className="text-3xl font-black mt-1" style={{ color: theme.textPrimary }}>{count}</div>
          <div className="text-xs mt-0.5" style={{ color: theme.textSecondary }}>~{pct}% of parts</div>
        </div>
        <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg" style={{ backgroundColor: iconBg }}>
          {icon}
        </div>
      </div>
    </WebCard>
  );
}

// ─── Pareto Chart (SVG — bars + cumulative line) ───
function ParetoChart({ parts }: { parts: ClassifiedPart[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const W = 700, H = 300, PAD_L = 45, PAD_R = 40, PAD_T = 20, PAD_B = 60;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const maxScore = Math.max(...parts.map(p => p.score), 1);
  const barW = Math.max((plotW / parts.length) - 2, 4);

  return (
    <WebCard className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">📊</span>
        <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Pareto Chart (Top {parts.length} Parts)</h3>
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 300 }}>
        {/* Grid lines */}
        {[0, 25, 50, 75, 100].map(v => {
          const y = PAD_T + plotH - (v / 100) * plotH;
          return (
            <g key={v}>
              <line x1={PAD_L} y1={y} x2={W - PAD_R} y2={y} stroke={theme.cardBorder} strokeWidth="0.5" strokeDasharray="4 4" />
              <text x={PAD_L - 6} y={y + 4} textAnchor="end" fill={theme.textMuted} fontSize="10">{v}</text>
              <text x={W - PAD_R + 6} y={y + 4} textAnchor="start" fill={theme.textMuted} fontSize="10">{v}</text>
            </g>
          );
        })}
        {/* Y-axis labels */}
        <text x={12} y={H / 2} textAnchor="middle" fill={theme.textMuted} fontSize="9" transform={`rotate(-90,12,${H / 2})`}>Score</text>
        <text x={W - 8} y={H / 2} textAnchor="middle" fill={theme.textMuted} fontSize="9" transform={`rotate(90,${W - 8},${H / 2})`}>Cum %</text>

        {/* 80% threshold line */}
        {(() => {
          const y80 = PAD_T + plotH - (80 / 100) * plotH;
          return (
            <>
              <line x1={PAD_L} y1={y80} x2={W - PAD_R} y2={y80} stroke="#ef4444" strokeWidth="1.5" strokeDasharray="6 4" />
              <text x={W - PAD_R + 4} y={y80 + 4} fill="#ef4444" fontSize="10" fontWeight="bold">80%</text>
            </>
          );
        })()}

        {/* Bars */}
        {parts.map((p, i) => {
          const x = PAD_L + (i / parts.length) * plotW + 1;
          const h = (p.score / maxScore) * plotH;
          const y = PAD_T + plotH - h;
          return (
            <g key={p._id}>
              <rect x={x} y={y} width={barW} height={h} fill="#ef4444" rx={1} opacity={0.9} />
              {/* X-axis label */}
              {i % Math.ceil(parts.length / 10) === 0 && (
                <text x={x + barW / 2} y={H - PAD_B + 14} textAnchor="end" fill={theme.textMuted} fontSize="8"
                  transform={`rotate(-45,${x + barW / 2},${H - PAD_B + 14})`}>
                  {p.partNumber.length > 6 ? p.partNumber.slice(0, 6) : p.partNumber}
                </text>
              )}
            </g>
          );
        })}

        {/* Cumulative % line */}
        <polyline
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
          points={parts.map((p, i) => {
            const x = PAD_L + (i / parts.length) * plotW + barW / 2;
            const y = PAD_T + plotH - (p.cumulativePct / 100) * plotH;
            return `${x},${y}`;
          }).join(" ")}
        />
        {/* Dots on the line */}
        {parts.map((p, i) => {
          const x = PAD_L + (i / parts.length) * plotW + barW / 2;
          const y = PAD_T + plotH - (p.cumulativePct / 100) * plotH;
          return <circle key={`dot-${i}`} cx={x} cy={y} r={2.5} fill="#3b82f6" />;
        })}
      </svg>

      {/* Legend */}
      <div className="flex justify-center gap-6 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#ef4444" }} />
          <span className="text-[11px]" style={{ color: theme.textSecondary }}>Score</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#3b82f6" }} />
          <span className="text-[11px]" style={{ color: theme.textSecondary }}>→ Cumulative %</span>
        </div>
      </div>
    </WebCard>
  );
}

// ─── Donut Chart (SVG) ───
function DonutChart({ a, b, c }: { a: number; b: number; c: number }) {
  const total = a + b + c || 1;
  const aPct = Math.round((a / total) * 100);
  const bPct = Math.round((b / total) * 100);
  const cPct = 100 - aPct - bPct;

  // SVG donut math
  const R = 80, CX = 120, CY = 110, SW = 35;
  const circumference = 2 * Math.PI * R;

  const segments = [
    { pct: aPct, color: "#ef4444", label: `A ${aPct}%`, offset: 0 },
    { pct: bPct, color: "#f59e0b", label: `B ${bPct}%`, offset: aPct },
    { pct: cPct, color: "#22c55e", label: `C ${cPct}%`, offset: aPct + bPct },
  ];

  return (
    <WebCard className="p-4">
      <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Classification Breakdown</h3>
      <div className="flex items-center justify-center gap-4">
        <svg width="240" height="220" viewBox="0 0 240 220">
          {segments.map(seg => {
            const dashLen = (seg.pct / 100) * circumference;
            const dashGap = circumference - dashLen;
            const rotation = (seg.offset / 100) * 360 - 90;
            // Label position
            const midAngle = ((seg.offset + seg.pct / 2) / 100) * 360 - 90;
            const labelR = R + SW / 2 + 20;
            const lx = CX + labelR * Math.cos((midAngle * Math.PI) / 180);
            const ly = CY + labelR * Math.sin((midAngle * Math.PI) / 180);
            return (
              <g key={seg.color}>
                <circle cx={CX} cy={CY} r={R} fill="none" stroke={seg.color} strokeWidth={SW}
                  strokeDasharray={`${dashLen} ${dashGap}`}
                  transform={`rotate(${rotation} ${CX} ${CY})`} />
                <text x={lx} y={ly} textAnchor="middle" dominantBaseline="central"
                  fill={seg.color} fontSize="14" fontWeight="bold">{seg.label}</text>
              </g>
            );
          })}
        </svg>
      </div>
      {/* Legend */}
      <div className="flex justify-center gap-6 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#ef4444" }} />
          <span className="text-[11px]" style={{ color: theme.textSecondary }}>A – Critical</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#f59e0b" }} />
          <span className="text-[11px]" style={{ color: theme.textSecondary }}>B – Moderate</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: "#22c55e" }} />
          <span className="text-[11px]" style={{ color: theme.textSecondary }}>C – Low</span>
        </div>
      </div>
    </WebCard>
  );
}
