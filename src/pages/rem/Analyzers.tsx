import { useMemo, useState } from "react";
import { useRemCoreData } from "../../hooks/useRemCoreData";
import { WebCard, StatusBadge, ProgressBar, theme } from "../../components/vitros/SharedComponents";
import { Search, X } from "lucide-react";

export function Analyzers() {
  const data = useRemCoreData();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const types = useMemo(() => Array.from(new Set(data.analyzers.map(a => a.analyzerType))).sort(), [data.analyzers]);

  const filtered = useMemo(() => {
    let result = [...data.analyzers];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(a => a.serialNumber.toLowerCase().includes(q) || a.analyzerType.toLowerCase().includes(q));
    }
    if (typeFilter) result = result.filter(a => a.analyzerType === typeFilter);
    return result.sort((a, b) => a.serialNumber.localeCompare(b.serialNumber));
  }, [data.analyzers, search, typeFilter]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>🔬 Analyzers</h2>
        {!data.isLoading && !data.error && (
          <span className="text-[10px] font-bold" style={{ color: theme.statusOk }}>LIVE · {data.analyzers.length}</span>
        )}
      </div>

      {data.error && (
        <WebCard className="p-4">
          <div className="text-sm font-bold" style={{ color: theme.statusDanger }}>REM data unavailable</div>
          <div className="text-xs mt-1" style={{ color: theme.textSecondary }}>The authoritative REM service could not be read. No empty-data fallback was substituted.</div>
          <button type="button" onClick={() => void data.refresh()} className="mt-3 px-3 py-1.5 rounded-lg text-xs font-bold" style={{ color: theme.textPrimary, border: `1px solid ${theme.cardBorder}` }}>Retry</button>
        </WebCard>
      )}

      <div className="flex items-center gap-2 px-3 py-2 rounded-xl border" style={{ borderColor: theme.cardBorder, backgroundColor: theme.cardBg }}>
        <Search className="w-4 h-4 text-slate-500" />
        <input className="flex-1 bg-transparent text-sm outline-none" style={{ color: theme.textPrimary }}
          placeholder="Search serial or type..." value={search} onChange={e => setSearch(e.target.value)} />
        {search && <button onClick={() => setSearch("")} aria-label="Clear analyzer search"><X className="w-4 h-4 text-slate-500" /></button>}
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        <button onClick={() => setTypeFilter(null)} className="px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0"
          style={{ backgroundColor: !typeFilter ? "#6366f122" : theme.cardBg, color: theme.textSecondary, border: `1px solid ${!typeFilter ? "#6366f1" : theme.cardBorder}` }}>All</button>
        {types.map(t => (
          <button key={t} onClick={() => setTypeFilter(typeFilter === t ? null : t)}
            className="px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0"
            style={{ backgroundColor: typeFilter === t ? "#6366f122" : theme.cardBg, color: theme.textSecondary, border: `1px solid ${typeFilter === t ? "#6366f1" : theme.cardBorder}` }}>{t}</button>
        ))}
      </div>

      <WebCard className="overflow-hidden">
        <div className="divide-y max-h-[55vh] overflow-y-auto" style={{ borderColor: theme.cardBorder }}>
          {data.isLoading && <div className="px-4 py-8 text-center text-sm" style={{ color: theme.textSecondary }}>Loading authoritative REM analyzers…</div>}
          {!data.isLoading && !data.error && filtered.length === 0 && <div className="px-4 py-8 text-center text-sm" style={{ color: theme.textSecondary }}>No analyzers match the current filters.</div>}
          {filtered.map(a => (
            <div key={a._id || a.serialNumber} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-bold" style={{ color: theme.textPrimary }}>{a.serialNumber}</span>
                <StatusBadge text={a.analyzerType} color="#6366f1" />
                {a.isComplete && <StatusBadge text="Complete" color={theme.statusOk} />}
              </div>
              <div className="flex items-center gap-2 mb-1">
                <StatusBadge text={a.currentStage || "Unassigned"} color="#8b5cf6" />
                {a.assignedTo && <span className="text-[10px]" style={{ color: theme.textMuted }}>→ {a.assignedTo}</span>}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1"><ProgressBar value={a.overallPct} maxValue={100} color="#6366f1" height={4} /></div>
                <span className="text-[10px] font-bold" style={{ color: theme.textPrimary }}>{Math.round(a.overallPct)}%</span>
              </div>
            </div>
          ))}
        </div>
      </WebCard>
    </div>
  );
}
