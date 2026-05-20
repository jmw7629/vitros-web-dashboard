import { useMemo } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, StatusBadge, theme, modeColor, formatDate } from "../../components/vitros/SharedComponents";

export function WipCycleTime() {
  const data = useConvexData();

  // WIP & Cycle Time — derived ONLY from transactions, not REM tracker
  // WIP = net parts pulled OUT (OUT - IN) grouped by analyzer serial
  // Cycle time = time span from first to last transaction per analyzer serial

  const analyzerWip = useMemo(() => {
    // Group transactions by analyzer serial
    const bySerial: Record<string, typeof data.transactions> = {};
    for (const t of data.transactions) {
      if (!t.analyzerSerial) continue;
      if (!bySerial[t.analyzerSerial]) bySerial[t.analyzerSerial] = [];
      bySerial[t.analyzerSerial].push(t);
    }

    return Object.entries(bySerial).map(([serial, txns]) => {
      const sorted = [...txns].sort((a, b) => a.timestamp - b.timestamp);
      const firstTs = sorted[0]?.timestamp || Date.now();
      const lastTs = sorted[sorted.length - 1]?.timestamp || Date.now();
      const cycleDays = Math.max(1, Math.ceil((lastTs - firstTs) / 86400000));

      // Net parts: OUT adds, IN returns
      const outCount = txns.filter(t => t.mode === "OUT").reduce((s, t) => s + t.qty, 0);
      const inCount = txns.filter(t => t.mode === "IN").reduce((s, t) => s + t.qty, 0);
      const netWip = outCount - inCount;

      // Unique parts pulled
      const uniqueParts = new Set(txns.filter(t => t.mode === "OUT").map(t => t.partNumber));

      return {
        serial,
        txnCount: txns.length,
        cycleDays,
        outCount,
        inCount,
        netWip,
        uniqueParts: uniqueParts.size,
        firstActivity: firstTs,
        lastActivity: lastTs,
        isActive: netWip > 0, // Still has parts checked out
      };
    }).sort((a, b) => b.cycleDays - a.cycleDays);
  }, [data.transactions]);

  const activeWip = analyzerWip.filter(a => a.isActive);
  const totalWipParts = activeWip.reduce((s, a) => s + a.netWip, 0);
  const avgCycleTime = analyzerWip.length
    ? Math.round(analyzerWip.reduce((s, c) => s + c.cycleDays, 0) / analyzerWip.length)
    : 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>⏱️ WIP & Cycle Time</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>
          Work-in-progress and cycle times derived from transaction history
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <DashCard label="ACTIVE WIP" value={activeWip.length} icon="🔧" color="#6366f1" />
        <DashCard label="WIP PARTS" value={totalWipParts} icon="📦" color="#f59e0b" />
        <DashCard label="AVG CYCLE" value={avgCycleTime ? avgCycleTime + "d" : "—"} icon="⏱️" color={theme.statusOk} />
      </div>

      <WebCard className="overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>
            Analyzer Activity (from transactions)
          </h3>
        </div>
        {analyzerWip.length === 0 ? (
          <div className="py-8 text-center">
            <div className="text-2xl mb-2">📊</div>
            <div className="text-sm font-medium" style={{ color: theme.textSecondary }}>No transaction data yet</div>
            <div className="text-xs mt-1" style={{ color: theme.textMuted }}>
              WIP and cycle times will appear here once parts are scanned out to analyzers
            </div>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
            {analyzerWip.map(a => (
              <div key={a.serial} className="px-4 py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>{a.serial}</span>
                  <StatusBadge
                    text={a.isActive ? `${a.netWip} WIP` : "Complete"}
                    color={a.isActive ? "#f59e0b" : theme.statusOk}
                  />
                </div>
                <div className="flex items-center gap-4 text-[10px]" style={{ color: theme.textMuted }}>
                  <span>{a.uniqueParts} unique parts</span>
                  <span>{a.outCount} out / {a.inCount} in</span>
                  <span>{a.txnCount} txns</span>
                  <span style={{ color: a.cycleDays > 30 ? theme.statusOut : theme.textMuted }}>
                    {a.cycleDays} days
                  </span>
                </div>
                <div className="flex gap-2 mt-1 text-[9px]" style={{ color: theme.textMuted }}>
                  <span>First: {formatDate(a.firstActivity)}</span>
                  <span>Last: {formatDate(a.lastActivity)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </WebCard>

      {/* Transaction summary */}
      <WebCard>
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Transaction Summary</h3>
        <div className="space-y-2">
          {[
            { label: "Total Transactions", value: data.transactions.length },
            { label: "OUT Transactions", value: data.transactions.filter(t => t.mode === "OUT").length },
            { label: "IN Transactions", value: data.transactions.filter(t => t.mode === "IN").length },
            { label: "ADJUST Transactions", value: data.transactions.filter(t => t.mode === "ADJUST").length },
            { label: "Unique Analyzers", value: new Set(data.transactions.filter(t => t.analyzerSerial).map(t => t.analyzerSerial)).size },
          ].map(row => (
            <div key={row.label} className="flex justify-between items-center">
              <span className="text-xs" style={{ color: theme.textSecondary }}>{row.label}</span>
              <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>{row.value}</span>
            </div>
          ))}
        </div>
      </WebCard>
    </div>
  );
}
