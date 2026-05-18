import { useMemo } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, ProgressBar, StatusBadge, theme, modeColor, formatDate } from "../../components/vitros/SharedComponents";

// ═══════════════════════════════════════════════════════════════
// SAP Analytics — mirrors SwiftUI SapAnalyticsView exactly
// Status breakdown, movement type analysis, timeline, rates
// ═══════════════════════════════════════════════════════════════

export function SapAnalytics() {
  const data = useConvexData();
  const sapRecords = data.sapRecords || [];

  const pending = sapRecords.filter((r: any) => !r.exported).length;
  const posted = sapRecords.filter((r: any) => r.exported).length;
  const total = sapRecords.length || 1;
  const postRate = Math.round((posted / total) * 100);

  // Movement type breakdown
  const modeBreakdown = useMemo(() => {
    const m: Record<string, { count: number; totalQty: number }> = {};
    for (const r of sapRecords) {
      if (!m[r.mode]) m[r.mode] = { count: 0, totalQty: 0 };
      m[r.mode].count++;
      m[r.mode].totalQty += Math.abs(r.qty);
    }
    return Object.entries(m).sort((a, b) => b[1].count - a[1].count);
  }, [sapRecords]);

  // Daily volume (last 7 days)
  const dailyVolume = useMemo(() => {
    const days: { label: string; count: number; date: Date }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
      const end = start + 86400000;
      const count = sapRecords.filter((r: any) => r.timestamp >= start && r.timestamp < end).length;
      const fmt = new Intl.DateTimeFormat("en", { weekday: "short" });
      days.push({ label: fmt.format(d), count, date: d });
    }
    return days;
  }, [sapRecords]);

  const maxDaily = Math.max(...dailyVolume.map(d => d.count), 1);

  // Top parts by SAP volume
  const topParts = useMemo(() => {
    const partMap: Record<string, { partNumber: string; count: number; totalQty: number }> = {};
    for (const r of sapRecords) {
      if (!partMap[r.partNumber]) partMap[r.partNumber] = { partNumber: r.partNumber, count: 0, totalQty: 0 };
      partMap[r.partNumber].count++;
      partMap[r.partNumber].totalQty += Math.abs(r.qty);
    }
    return Object.values(partMap).sort((a, b) => b.count - a.count).slice(0, 10);
  }, [sapRecords]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h2 className="text-xl font-black" style={{ color: theme.textPrimary }}>SAP Analytics</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Health of the SAP posting pipeline</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <DashCard label="TOTAL RECORDS" value={sapRecords.length} icon="📋" color="#6366f1" />
        <DashCard label="PENDING" value={pending} subtitle="Awaiting post" icon="⏳" color="#f59e0b" />
        <DashCard label="POSTED" value={posted} subtitle="Completed" icon="✅" color={theme.statusOk} />
        <DashCard label="POST RATE" value={`${postRate}%`} subtitle={postRate >= 80 ? "Healthy" : "Needs attention"} icon="📊" color={postRate >= 80 ? theme.statusOk : "#f59e0b"} />
      </div>

      {/* Post Rate Bar */}
      <WebCard className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold tracking-wider" style={{ color: theme.textMuted }}>POST COMPLETION RATE</span>
          <span className="text-sm font-bold" style={{ color: postRate >= 80 ? theme.statusOk : "#f59e0b" }}>{postRate}%</span>
        </div>
        <ProgressBar value={postRate} maxValue={100} color={postRate >= 80 ? theme.statusOk : "#f59e0b"} height={10} />
      </WebCard>

      <div className="grid grid-cols-2 gap-4">
        {/* Movement Type Breakdown */}
        <WebCard className="p-4">
          <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>By Movement Type</h3>
          {modeBreakdown.length === 0 ? (
            <div className="py-4 text-center text-sm" style={{ color: theme.textSecondary }}>No records yet</div>
          ) : (
            <div className="space-y-3">
              {modeBreakdown.map(([mode, info]) => {
                const pct = Math.round((info.count / total) * 100);
                return (
                  <div key={mode}>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <StatusBadge text={mode} color={modeColor(mode)} />
                        <span className="text-xs" style={{ color: theme.textMuted }}>
                          {mode === "OUT" ? "261 — Goods Issue" : mode === "IN" || mode === "RECEIVE" ? "101 — Goods Receipt" : "309 — Transfer"}
                        </span>
                      </div>
                      <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>{info.count}</span>
                    </div>
                    <ProgressBar value={pct} maxValue={100} color={modeColor(mode)} height={6} />
                    <div className="text-[9px] mt-0.5" style={{ color: theme.textMuted }}>
                      {info.totalQty} units · {pct}% of total
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </WebCard>

        {/* Daily Volume Chart */}
        <WebCard className="p-4">
          <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Daily SAP Volume (7 days)</h3>
          <div className="space-y-2">
            {dailyVolume.map(d => (
              <div key={d.label} className="flex items-center gap-2">
                <span className="text-xs w-8 text-right" style={{ color: theme.textMuted }}>{d.label}</span>
                <div className="flex-1 h-5 rounded-md overflow-hidden" style={{ backgroundColor: `${theme.cardBorder}44` }}>
                  <div className="h-full rounded-md transition-all"
                    style={{
                      width: `${Math.max((d.count / maxDaily) * 100, 2)}%`,
                      backgroundColor: theme.accentBlue,
                    }} />
                </div>
                <span className="text-xs font-bold w-6 text-right" style={{ color: theme.textPrimary }}>{d.count}</span>
              </div>
            ))}
          </div>
        </WebCard>
      </div>

      {/* Top Parts */}
      {topParts.length > 0 && (
        <WebCard className="overflow-hidden">
          <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
            <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Top Parts by SAP Volume</h3>
          </div>
          <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
            {topParts.map((p, i) => (
              <div key={p.partNumber} className="flex items-center gap-3 px-4 py-2.5">
                <span className="text-xs font-bold w-5 text-center" style={{ color: theme.textMuted }}>#{i + 1}</span>
                <span className="text-sm font-medium flex-1" style={{ color: theme.accentBlue }}>{p.partNumber}</span>
                <span className="text-xs" style={{ color: theme.textSecondary }}>{p.count} records</span>
                <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>{p.totalQty} units</span>
              </div>
            ))}
          </div>
        </WebCard>
      )}
    </div>
  );
}
