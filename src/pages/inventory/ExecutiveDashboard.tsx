import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConvexData } from "../../hooks/useConvexData";
import { useConfig } from "../../hooks/useConfig";
import { ScopeToggle } from "../../components/vitros/ScopeToggle";
import { DashCard, theme } from "../../components/vitros/SharedComponents";
import {
  Layers, HeartPulse, XCircle, AlertTriangle as TriangleAlert,
  TrendingDown, ShieldCheck, Activity, Wrench,
  ScanLine, PackagePlus, FileText, Upload,
  ArrowRight, CalendarDays, Truck, Package
} from "lucide-react";

interface DashboardModuleConfig {
  id: string;
  type: "kpi" | "list";
  title: string;
  visible: boolean;
  order: number;
  size: "small" | "full";
  config: { metric?: string; dataSource?: string };
}

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
  sapReady: <Truck className="h-5 w-5" />,
  sapPosted: <Package className="h-5 w-5" />,
  sapErrors: <TriangleAlert className="h-5 w-5" />,
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
  sapReady: "#06b6d4",
  sapPosted: "#22c55e",
  sapErrors: "#ef4444",
};

const metricSubtitleMap: Record<string, (data: ReturnType<typeof useConvexData>, scope: "ALL" | "SP_ONLY") => string> = {
  skus: (data, scope) => {
    const parts = scope === "SP_ONLY" ? data.parts.filter(p => p.onPlan) : data.parts;
    return `${parts.reduce((s, p) => s + p.qoh, 0).toLocaleString()} in stock`;
  },
  health: (data, scope) => {
    const parts = scope === "SP_ONLY" ? data.parts.filter(p => p.onPlan) : data.parts;
    const total = parts.length || 1;
    const ok = parts.filter(p => p.status === "OK").length;
    return `${ok} healthy`;
  },
  stockOuts: (data, scope) => {
    const parts = scope === "SP_ONLY" ? data.parts.filter(p => p.onPlan) : data.parts;
    const requiredOut = parts.filter(p => p.qoh === 0 && p.type === "Required").length;
    return `${requiredOut} Required`;
  },
  reorder: (data, scope) => {
    const parts = scope === "SP_ONLY" ? data.parts.filter(p => p.onPlan) : data.parts;
    const needReorder = parts.filter(p => p.qoh < p.minQty);
    const totalUnits = needReorder.reduce((s, p) => s + Math.max(0, p.maxQty - p.qoh), 0);
    return `${totalUnits.toLocaleString()} units`;
  },
  lowStock: () => "Below min qty",
  onPlan: (data, scope) => {
    const parts = data.parts;
    const spTotal = parts.filter(p => p.onPlan).length;
    const spOk = parts.filter(p => p.onPlan && p.status === "OK").length;
    const spOut = parts.filter(p => p.onPlan && p.status === "OUT").length;
    const spHealthPct = spTotal ? Math.round((spOk / spTotal) * 100) : 0;
    return `${spHealthPct}% OK · ${spOut} out`;
  },
  activity: (data) => {
    const outTx = data.transactions.filter(t => t.mode === "OUT").length;
    const inTx = data.transactions.filter(t => t.mode === "IN" || t.mode === "RECEIVE").length;
    return `${outTx} OUT · ${inTx} IN`;
  },
  kits: (data) => {
    const totalComponents = data.kits.reduce((s, k) => s + (k.components?.length || 0), 0);
    return `${totalComponents} components`;
  },
  today: (data) => {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    const txToday = data.transactions.filter(t => t.timestamp >= d.getTime());
    return `${txToday.length} scanned today`;
  },
  sapReady: () => "0 posting",
  sapPosted: () => "0 today",
  sapErrors: () => "None today",
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
  sapReady: "/sap-staging",
  sapPosted: "/sap-staging",
  sapErrors: "/sap-staging",
};

function formatValue(metric: string, value: number): string | number {
  if (metric === "health") return `${value}%`;
  return value.toLocaleString();
}

export function ExecutiveDashboard() {
  const data = useConvexData();
  const { getDashboardModules } = useConfig();
  const navigate = useNavigate();
  const [scope, setScope] = useState<"ALL" | "SP_ONLY">("ALL");

  const modules = useMemo(() => getDashboardModules(), [getDashboardModules]);
  const kpiModules = modules.filter(m => m.type === "kpi" && m.visible !== false);

  const kpiData = useMemo(() => {
    const parts = scope === "SP_ONLY" ? data.parts.filter(p => p.onPlan) : data.parts;
    const total = parts.length || 1;
    const totalUnits = parts.reduce((s, p) => s + p.qoh, 0);
    const okCount = parts.filter(p => p.status === "OK").length;
    const lowCount = parts.filter(p => p.status === "LOW").length;
    const outCount = parts.filter(p => p.status === "OUT").length;
    const healthPct = Math.round((okCount / total) * 100);

    const requiredStockouts = parts.filter(p => p.qoh === 0 && p.type === "Required");
    const needReorder = parts.filter(p => p.qoh < p.minQty);
    const totalReorderUnits = needReorder.reduce((s, p) => s + Math.max(0, p.maxQty - p.qoh), 0);

    const txns = data.transactions;
    const outTx = txns.filter(t => t.mode === "OUT").length;
    const inTx = txns.filter(t => t.mode === "IN" || t.mode === "RECEIVE").length;

    const d = new Date(); d.setHours(0, 0, 0, 0);
    const txToday = txns.filter(t => t.timestamp >= d.getTime()).length;

    const kitCount = data.kits.length;

    return {
      skus: total,
      health: healthPct,
      stockOuts: outCount,
      reorder: needReorder.length,
      lowStock: lowCount,
      onPlan: data.parts.filter(p => p.onPlan).length,
      activity: txns.length,
      kits: kitCount,
      today: txToday,
      sapReady: 0,
      sapPosted: 0,
      sapErrors: 0,
    };
  }, [data.parts, data.transactions, data.kits, scope]);

  const now = new Date();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Executive Dashboard</h2>
          <p className="text-sm text-slate-500">VITROS Analyzer Spare Parts Inventory Overview</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · {now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
        <ScopeToggle scope={scope} onChange={setScope} allCount={data.parts.length} spCount={data.parts.filter(p => p.onPlan).length} />
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        <button onClick={() => navigate("/scan-kiosk")} className="btn-3d flex items-center justify-center gap-1.5 px-4 py-2.5 bg-blue-600 text-white text-xs font-bold rounded-xl hover:bg-blue-700 whitespace-nowrap">
          <ScanLine className="h-4 w-4" /> Scan Part
        </button>
        <button onClick={() => navigate("/incoming-stock")} className="btn-3d flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 whitespace-nowrap">
          <PackagePlus className="h-4 w-4" /> Receive Stock
        </button>
        <button onClick={() => navigate("/report-preview")} className="btn-3d flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-700 text-white text-xs font-bold rounded-xl hover:bg-slate-800 whitespace-nowrap">
          <FileText className="h-4 w-4" /> Daily Briefing
        </button>
        <button onClick={() => navigate("/sap-staging")} className="btn-3d flex items-center justify-center gap-1.5 px-4 py-2.5 bg-purple-600 text-white text-xs font-bold rounded-xl hover:bg-purple-700 whitespace-nowrap">
          <Upload className="h-4 w-4" /> SAP Push
        </button>
      </div>

      {/* Alert Banner */}
      {(() => {
        const parts = scope === "SP_ONLY" ? data.parts.filter(p => p.onPlan) : data.parts;
        const requiredStockouts = parts.filter(p => p.qoh === 0 && p.type === "Required");
        return requiredStockouts.length > 0 ? (
          <button
            onClick={() => navigate("/reorder-stockout")}
            className="w-full flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-red-600 to-red-500 text-white rounded-xl shadow-lg hover:from-red-700 hover:to-red-600 transition-all"
          >
            <div className="p-1.5 bg-white/20 rounded-lg">
              <XCircle className="h-5 w-5" />
            </div>
            <div className="flex-1 text-left">
              <p className="font-black text-sm">{requiredStockouts.length} Required Parts at Zero Stock</p>
              <p className="text-xs text-red-100">Tap to review reorder priorities</p>
            </div>
            <ArrowRight className="h-5 w-5 text-red-200" />
          </button>
        ) : null;
      })()}

      {/* KPI Grid from config */}
      {kpiModules.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpiModules.map((module) => {
            const metric = module.config.metric;
            const value = metric ? kpiData[metric as keyof typeof kpiData] ?? 0 : 0;
            const route = metric ? routeMap[metric] : null;
            return (
              <DashCard
                key={module.id}
                label={module.title}
                value={formatValue(metric ?? "", value)}
                subtitle={metric ? metricSubtitleMap[metric]?.(data, scope) : undefined}
                icon={metric ? metricIconMap[metric] : <Layers className="h-5 w-5" />}
                color={metric ? metricColorMap[metric] : theme.accentBlue}
                onClick={route ? () => navigate(route) : undefined}
              />
            );
          })}
        </div>
      )}

      {/* Health mini breakdown */}
      <div className="card-embossed p-4 bg-white dark:bg-slate-900/50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Inventory Status</h3>
          <span className="text-[10px] text-slate-400">
            {scope === "SP_ONLY" ? data.parts.filter(p => p.onPlan).length : data.parts.length} total
          </span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {(() => {
            const parts = scope === "SP_ONLY" ? data.parts.filter(p => p.onPlan) : data.parts;
            const okCount = parts.filter(p => p.status === "OK").length;
            const lowCount = parts.filter(p => p.status === "LOW").length;
            const outCount = parts.filter(p => p.status === "OUT").length;
            const overCount = parts.filter(p => p.status === "OVER").length;
            const total = parts.length || 1;
            return [
              <div key="ok" className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-[11px] text-slate-500 dark:text-slate-400">OK</span>
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 ml-auto">{okCount}</span>
              </div>,
              <div key="low" className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-[11px] text-slate-500 dark:text-slate-400">Low</span>
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 ml-auto">{lowCount}</span>
              </div>,
              <div key="out" className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-[11px] text-slate-500 dark:text-slate-400">Out</span>
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 ml-auto">{outCount}</span>
              </div>,
              <div key="over" className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-[11px] text-slate-500 dark:text-slate-400">Over</span>
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 ml-auto">{overCount}</span>
              </div>,
            ];
          })()}
        </div>
      </div>
    </div>
  );
}