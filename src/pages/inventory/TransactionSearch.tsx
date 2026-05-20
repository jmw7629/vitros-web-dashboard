import { useMemo, useState } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, StatusBadge, theme, modeColor, formatDate, downloadCSV } from "../../components/vitros/SharedComponents";
import { Search, Download, Filter, X } from "lucide-react";

export function TransactionSearch() {
  const data = useConvexData();
  const [search, setSearch] = useState("");
  const [modeFilter, setModeFilter] = useState<string | null>(null);
  const [userFilter, setUserFilter] = useState<string | null>(null);

  const modes = ["OUT", "IN", "ADJUST", "RECEIVE"];

  const users = useMemo(() => {
    const set = new Set(data.transactions.map(t => t.user));
    return Array.from(set).sort();
  }, [data.transactions]);

  const filtered = useMemo(() => {
    let result = [...data.transactions].sort((a, b) => b.timestamp - a.timestamp);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(t => t.partNumber.toLowerCase().includes(q) || t.user.toLowerCase().includes(q) || (t.analyzerSerial || "").toLowerCase().includes(q));
    }
    if (modeFilter) result = result.filter(t => t.mode === modeFilter);
    if (userFilter) result = result.filter(t => t.user === userFilter);
    return result;
  }, [data.transactions, search, modeFilter, userFilter]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>🔍 Transaction Search</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Every scan, receiving, and adjustment — recorded permanently</p>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border" style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg }}>
        <Search className="w-4 h-4 text-slate-500" />
        <input className="flex-1 bg-transparent text-sm outline-none" style={{ color: theme.textPrimary }}
          placeholder="Search by part, user, or serial..." value={search} onChange={e => setSearch(e.target.value)} />
        {search && <button onClick={() => setSearch("")}><X className="w-4 h-4 text-slate-500" /></button>}
      </div>

      {/* Mode filters */}
      <div className="flex gap-2 flex-wrap">
        {modes.map(m => (
          <button key={m} onClick={() => setModeFilter(modeFilter === m ? null : m)}
            className="px-3 py-1 rounded-full text-[11px] font-bold"
            style={{ backgroundColor: modeFilter === m ? modeColor(m) + "33" : theme.cardBg, color: modeColor(m), border: `1px solid ${modeFilter === m ? modeColor(m) : theme.cardBorder}` }}>
            {m}
          </button>
        ))}
        <span className="ml-auto text-[10px] self-center" style={{ color: theme.textMuted }}>{filtered.length} records</span>
      </div>

      <WebCard className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Transactions</h3>
          <button onClick={() => downloadCSV(filtered.map(tx => ({
            Date: new Date(tx.timestamp).toLocaleString(),
            Mode: tx.mode,
            "Part Number": tx.partNumber,
            Description: tx.description || "",
            Qty: tx.qty,
            User: tx.user,
            "Analyzer S/N": tx.analyzerSerial || "",
            "Qty Before": tx.qtyBefore,
            "Qty After": tx.qtyAfter,
          })), "transactions-export.csv")} className="flex items-center gap-1 text-xs font-medium" style={{ color: "#6366f1" }}>
            <Download className="w-3 h-3" /> Export
          </button>
        </div>
        <div className="divide-y max-h-[60vh] overflow-y-auto" style={{ borderColor: theme.cardBorder }}>
          {filtered.slice(0, 100).map((tx, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5">
              <StatusBadge text={tx.mode} color={modeColor(tx.mode)} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>{tx.partNumber}</div>
                <div className="text-[10px]" style={{ color: theme.textMuted }}>
                  {tx.user} {tx.analyzerSerial ? "· S/N: " + tx.analyzerSerial : ""} · {tx.qtyBefore}→{tx.qtyAfter}
                </div>
              </div>
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
