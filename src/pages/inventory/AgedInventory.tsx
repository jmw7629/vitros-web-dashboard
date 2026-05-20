import { useMemo, useState } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, StatusBadge, theme } from "../../components/vitros/SharedComponents";

const BUCKETS = [
  { label: "0-30d", min: 0, max: 30, color: "#22c55e" },
  { label: "30-60d", min: 30, max: 60, color: "#3b82f6" },
  { label: "60-90d", min: 60, max: 90, color: "#f59e0b" },
  { label: "90-180d", min: 90, max: 180, color: "#ef4444" },
  { label: "180-365d", min: 180, max: 365, color: "#dc2626" },
  { label: "365+d", min: 365, max: 99999, color: "#7f1d1d" },
];

export function AgedInventory() {
  const data = useConvexData();
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null);

  const aged = useMemo(() => {
    const now = Date.now();
    return data.parts.map(p => {
      const lastTx = data.transactions.filter(t => t.partNumber === p.partNumber).sort((a, b) => b.timestamp - a.timestamp)[0];
      const daysSince = lastTx ? Math.floor((now - lastTx.timestamp) / 86400000) : 999;
      const bucket = BUCKETS.findIndex(b => daysSince >= b.min && daysSince < b.max);
      return { ...p, daysSince, bucket: bucket >= 0 ? bucket : BUCKETS.length - 1 };
    });
  }, [data.parts, data.transactions]);

  const bucketCounts = BUCKETS.map((b, i) => ({
    ...b,
    count: aged.filter(p => p.bucket === i).length,
  }));

  const filtered = selectedBucket !== null ? aged.filter(p => p.bucket === selectedBucket) : aged;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📅 Aged Inventory</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>How long parts have been sitting without activity</p>
      </div>

      {/* Bucket cards */}
      <div className="grid grid-cols-3 gap-2">
        {bucketCounts.map((b, i) => (
          <button key={b.label} onClick={() => setSelectedBucket(selectedBucket === i ? null : i)}
            className="rounded-2xl p-3 text-center transition-all"
            style={{
              backgroundColor: selectedBucket === i ? b.color + "22" : theme.cardBg,
              border: `1px solid ${selectedBucket === i ? b.color : theme.cardBorder}`,
            }}>
            <div className="text-lg font-black" style={{ color: b.color }}>{b.count}</div>
            <div className="text-[10px] font-medium" style={{ color: theme.textSecondary }}>{b.label}</div>
          </button>
        ))}
      </div>

      <WebCard className="overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>
            {selectedBucket !== null ? BUCKETS[selectedBucket].label + " Parts" : "All Parts"}
          </h3>
          <span className="text-[10px]" style={{ color: theme.textMuted }}>{filtered.length} items</span>
        </div>
        <div className="divide-y max-h-[50vh] overflow-y-auto" style={{ borderColor: theme.cardBorder }}>
          {filtered.sort((a, b) => b.daysSince - a.daysSince).map(p => (
            <div key={p._id} className="flex items-center gap-3 px-4 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>{p.partNumber}</div>
                <div className="text-xs" style={{ color: theme.textSecondary }}>{p.description}</div>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold" style={{ color: BUCKETS[p.bucket].color }}>{p.daysSince}d</div>
                <div className="text-[9px]" style={{ color: theme.textMuted }}>QOH: {p.qoh}</div>
              </div>
            </div>
          ))}
        </div>
      </WebCard>
    </div>
  );
}
