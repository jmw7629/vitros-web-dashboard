import { useMemo, useState } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, StatusBadge, theme, modeColor, formatDate } from "../../components/vitros/SharedComponents";
import { ArrowLeft } from "lucide-react";

export function AnalyzerAnalysis() {
  const data = useConvexData();
  const [selectedSerial, setSelectedSerial] = useState<string | null>(null);

  const analyzerStats = useMemo(() => {
    const map: Record<string, { txns: number; parts: number; uniqueParts: Set<string>; days: Set<string> }> = {};
    for (const tx of data.transactions) {
      if (!tx.analyzerSerial) continue;
      const s = tx.analyzerSerial;
      if (!map[s]) map[s] = { txns: 0, parts: 0, uniqueParts: new Set(), days: new Set() };
      map[s].txns++;
      map[s].parts += Math.abs(tx.qty);
      map[s].uniqueParts.add(tx.partNumber);
      map[s].days.add(new Date(tx.timestamp).toDateString());
    }
    return Object.entries(map).map(([serial, stats]) => ({
      serial,
      txns: stats.txns,
      parts: stats.parts,
      uniqueParts: stats.uniqueParts.size,
      buildDays: stats.days.size,
    })).sort((a, b) => b.txns - a.txns);
  }, [data.transactions]);

  if (selectedSerial) {
    const txns = data.transactions.filter(t => t.analyzerSerial === selectedSerial).sort((a, b) => b.timestamp - a.timestamp);
    const stats = analyzerStats.find(a => a.serial === selectedSerial);
    return (
      <div className="space-y-4">
        <button onClick={() => setSelectedSerial(null)} className="flex items-center gap-1 text-sm font-medium" style={{ color: "#6366f1" }}>
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>Analyzer {selectedSerial}</h2>
        <div className="grid grid-cols-2 gap-3">
          <DashCard label="TRANSACTIONS" value={stats?.txns || 0} icon="🔄" color="#6366f1" />
          <DashCard label="PARTS CONSUMED" value={stats?.parts || 0} icon="📦" color="#f59e0b" />
          <DashCard label="UNIQUE PARTS" value={stats?.uniqueParts || 0} icon="🔢" color={theme.statusOk} />
          <DashCard label="BUILD DAYS" value={stats?.buildDays || 0} icon="📅" color="#8b5cf6" />
        </div>
        <WebCard className="overflow-hidden">
          <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
            <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Transaction History</h3>
          </div>
          <div className="divide-y max-h-[50vh] overflow-y-auto" style={{ borderColor: theme.cardBorder }}>
            {txns.map((tx, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-2">
                <StatusBadge text={tx.mode} color={modeColor(tx.mode)} />
                <div className="flex-1"><span className="text-sm" style={{ color: theme.textPrimary }}>{tx.partNumber}</span></div>
                <div className="text-right">
                  <span className="text-sm font-bold" style={{ color: tx.qty > 0 ? theme.statusOk : theme.statusOut }}>
                    {tx.qty > 0 ? "+" + tx.qty : tx.qty}
                  </span>
                  <div className="text-[9px]" style={{ color: theme.textMuted }}>{formatDate(tx.timestamp)}</div>
                </div>
              </div>
            ))}
          </div>
        </WebCard>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>🔬 Analyzer Analysis</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Per-instrument part consumption and build cost</p>
      </div>

      <DashCard label="ANALYZERS TRACKED" value={analyzerStats.length} icon="🔬" color="#6366f1" />

      <WebCard className="overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>By Analyzer</h3>
        </div>
        <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
          {analyzerStats.map(a => (
            <button key={a.serial} onClick={() => setSelectedSerial(a.serial)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors text-left">
              <div className="flex-1">
                <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>{a.serial}</div>
                <div className="text-[10px]" style={{ color: theme.textMuted }}>
                  {a.txns} txns · {a.parts} parts · {a.uniqueParts} unique · {a.buildDays} days
                </div>
              </div>
              <span className="text-slate-500">→</span>
            </button>
          ))}
        </div>
      </WebCard>
    </div>
  );
}
