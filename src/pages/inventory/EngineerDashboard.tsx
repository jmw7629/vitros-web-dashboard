import { useMemo } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { useConfig } from "../../hooks/useConfig";
import { useNavigate } from "react-router-dom";
import { DashCard, theme } from "../../components/vitros/SharedComponents";
import type { EngineerViewConfig } from "../../lib/configRegistry";
import {
  Layers, HeartPulse, XCircle, AlertTriangle as TriangleAlert,
  TrendingDown, ShieldCheck, Activity, Wrench, CalendarDays, Gauge
} from "lucide-react";

const metricIconMap: Record<string, React.ReactNode> = {
  skus: <Layers className="h-5 w-5" />,
  health: <HeartPulse className="h-5 w-5" />,
  stockOuts: <XCircle className="h-5 w-5" />,
  reorder: <TriangleAlert className="h-5 w-5" />,
  lowStock: <TrendingDown className="h-5 w-5" />,
  onPlan: <ShieldCheck className="h-5 w-5" />,
  activity: <Activity className="h-5 w-5" />,
  kits: <Wrench className="h-5 w-5" />,
  today: <CalendarDays className="h-5 w-5" />,
};

const metricColorMap: Record<string, string> = {
  skus: "#3b82f6",
  health: "#22c55e",
  stockOuts: "#ef4444",
  reorder: "#f59e0b",
  lowStock: "#f59e0b",
  onPlan: "#3b82f6",
  activity: "#8b5cf6",
  kits: "#ec4899",
  today: "#6366f1",
};

const metricSubtitleMap: Record<string, (data: ReturnType<typeof useConvexData>) => string> = {
  skus: (data) => `${data.parts.reduce((s: number, p: { qoh: number }) => s + p.qoh, 0).toLocaleString()} in stock`,
  health: (data) => {
    const ok = data.parts.filter((p: { status: string }) => p.status === "OK").length;
    return `${ok} healthy`;
  },
  stockOuts: (data) => {
    const requiredOut = data.parts.filter((p: { qoh: number; type: string }) => p.qoh === 0 && p.type === "Required").length;
    return `${requiredOut} Required`;
  },
  reorder: (data) => {
    const needReorder = data.parts.filter((p: { qoh: number; minQty: number; maxQty: number }) => p.qoh < p.minQty);
    const totalUnits = needReorder.reduce((s: number, p: { maxQty: number; qoh: number }) => s + Math.max(0, p.maxQty - p.qoh), 0);
    return `${totalUnits.toLocaleString()} units`;
  },
  lowStock: () => "Below min qty",
  onPlan: (data) => {
    const spTotal = data.parts.filter((p: { onPlan: boolean }) => p.onPlan).length;
    const spOk = data.parts.filter((p: { onPlan: boolean; status: string }) => p.onPlan && p.status === "OK").length;
    const spOut = data.parts.filter((p: { onPlan: boolean; status: string }) => p.onPlan && p.status === "OUT").length;
    const spHealthPct = spTotal ? Math.round((spOk / spTotal) * 100) : 0;
    return `${spHealthPct}% OK · ${spOut} out`;
  },
  activity: (data) => {
    const outTx = data.transactions.filter((t: { mode: string }) => t.mode === "OUT").length;
    const inTx = data.transactions.filter((t: { mode: string }) => t.mode === "IN" || t.mode === "RECEIVE").length;
    return `${outTx} OUT · ${inTx} IN`;
  },
  kits: (data) => {
    const totalComponents = data.kits.reduce((s: number, k: { components?: unknown[] }) => s + (k.components?.length || 0), 0);
    return `${totalComponents} components`;
  },
  today: (data) => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const txToday = data.transactions.filter((t: { timestamp: number }) => t.timestamp >= d.getTime());
    return `${txToday.length} scanned today`;
  },
};

const routeMap: Record<string, string> = {
  skus: "/stock-summary",
  health: "/stock-summary",
  stockOuts: "/reorder-stockout",
  reorder: "/reorder-stockout",
  lowStock: "/reorder-stockout",
  onPlan: "/stock-summary",
  activity: "/transaction-search",
  kits: "/kit-analysis",
  today: "/transaction-search",
};

function formatValue(metric: string, value: number): string | number {
  if (metric === "health") return `${value}%`;
  return value.toLocaleString();
}

/**
 * Engineer Dashboard — simplified operational view focused on daily tasks.
 * Only shows metrics and actions relevant to the Engineer role capabilities.
 * No admin/configuration metrics (SAP, system settings).
 */
export function EngineerDashboard() {
  const data = useConvexData();
  const { get } = useConfig();
  const view = get<EngineerViewConfig>("engineer.view");
  const navigate = useNavigate();

  const engineerModules = view.cards.filter(card => card.visible).sort((a, b) => a.order - b.order);

  const kpiData = useMemo(() => {
    const total = data.parts.length || 1;
    const okCount = data.parts.filter((p: { status: string }) => p.status === "OK").length;
    const lowCount = data.parts.filter((p: { status: string }) => p.status === "LOW").length;
    const outCount = data.parts.filter((p: { status: string }) => p.status === "OUT").length;
    const healthPct = Math.round((okCount / total) * 100);

    const needReorder = data.parts.filter((p: { qoh: number; minQty: number }) => p.qoh < p.minQty);

    const txns = data.transactions;

    const d = new Date(); d.setHours(0, 0, 0, 0);
    const txToday = txns.filter((t: { timestamp: number }) => t.timestamp >= d.getTime()).length;

    const kitCount = data.kits.length;

    return {
      skus: data.parts.length,
      health: healthPct,
      stockOuts: outCount,
      reorder: needReorder.length,
      lowStock: lowCount,
      onPlan: data.parts.filter((p: { onPlan: boolean }) => p.onPlan).length,
      activity: txns.length,
      kits: kitCount,
      today: txToday,
    };
  }, [data.parts, data.transactions, data.kits]);

  const quickActions = view.quickActions.filter(action => action.visible).sort((a, b) => a.order - b.order);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold" style={{ color: theme.textPrimary }}>{view.title}</h1>
          <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>{view.subtitle}</p>
        </div>
        <div className="text-xs px-2 py-1 rounded bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 font-medium">
          ENGINEER
        </div>
      </div>

      {/* KPI Grid — simplified operational metrics only */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {engineerModules.map((module) => {
          const value = kpiData[module.config.metric as keyof typeof kpiData] ?? 0;
          const route = module.config.metric ? routeMap[module.config.metric] : null;
          return (
            <div key={module.id} className={module.size === "full" ? "col-span-2 md:col-span-4" : ""}><DashCard
              key={module.id}
              label={module.title}
              value={formatValue(module.config.metric ?? "", value)}
              subtitle={module.config.metric ? metricSubtitleMap[module.config.metric]?.(data) : undefined}
              icon={module.config.metric ? metricIconMap[module.config.metric] : <Gauge className="h-5 w-5" />}
              color={module.config.metric ? metricColorMap[module.config.metric] : theme.accentBlue}
              onClick={route ? () => navigate(route) : undefined}
            /></div>
          );
        })}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {quickActions.map((action) => (
          <button type="button"
            key={action.path}
            onClick={() => navigate(action.path)}
            className="group rounded-xl p-4 text-left cursor-pointer transition-all hover:shadow-lg"
            style={{
              backgroundColor: theme.cardBg,
              border: `1px solid ${theme.cardBorder}`,
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={`p-2 rounded-lg bg-gradient-to-br ${action.iconBg}`}>
                <span>{action.icon}</span>
              </div>
            </div>
            <p className="text-sm font-bold" style={{ color: theme.textPrimary }}>{action.label}</p>
            <p className="text-[10px] mt-1" style={{ color: theme.textMuted }}>Tap to open</p>
          </button>
        ))}
      </div>

      {/* Inventory Status Summary */}
      {view.inventoryStatus.visible && <div className="rounded-xl p-4" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>{view.inventoryStatus.title}</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Healthy", count: data.parts.filter((p: { status: string }) => p.status === "OK").length, color: theme.statusOk },
            { label: "Low Stock", count: data.parts.filter((p: { status: string }) => p.status === "LOW").length, color: theme.statusLow },
            { label: "Stock-Out", count: data.parts.filter((p: { status: string }) => p.status === "OUT").length, color: theme.statusOut },
            { label: "Overstocked", count: data.parts.filter((p: { status: string }) => p.status === "OVER").length, color: theme.statusOver },
          ].map((s, i) => (
            <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span className="text-sm font-medium" style={{ color: theme.textPrimary }}>{s.label}</span>
              </div>
              <span className="text-lg font-bold" style={{ color: s.color }}>{s.count}</span>
            </div>
          ))}
        </div>
      </div>}

      {/* Recent Activity */}
      {view.recentTransactions.visible && <div className="rounded-xl p-4" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>{view.recentTransactions.title}</h3>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {data.transactions.slice(0, view.recentTransactions.limit).map((tx: any, i: number) => (
            <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-lg" style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}>
              <span
                className="px-2 py-0.5 rounded text-[10px] font-bold text-white"
                style={{ backgroundColor: tx.mode === "OUT" ? theme.statusOut : tx.mode === "IN" ? theme.statusOk : tx.mode === "RECEIVE" ? theme.accentBlue : theme.statusLow }}
              >
                {tx.mode}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: theme.textPrimary }}>{tx.partNumber}</p>
                <p className="text-[10px]" style={{ color: theme.textMuted }}>
                  {tx.user} · {new Date(tx.timestamp).toLocaleTimeString()}
                </p>
              </div>
              <span className="text-sm font-bold" style={{ color: tx.qty > 0 ? theme.statusOk : theme.statusOut }}>
                {tx.qty > 0 ? "+" : ""}{tx.qty}
              </span>
            </div>
          ))}
          {data.transactions.length === 0 && (
            <p className="text-sm text-center py-4" style={{ color: theme.textMuted }}>No recent transactions</p>
          )}
        </div>
      </div>}
    </div>
  );
}
