import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useConvexData } from "../../hooks/useConvexData";
import { ScopeToggle } from "../../components/vitros/ScopeToggle";
import {
  Layers, HeartPulse, XCircle, AlertTriangle as TriangleAlert,
  TrendingDown, ShieldCheck, Activity, Wrench,
  ScanLine, PackagePlus, FileText, Upload,
  ArrowRight, CalendarDays, Truck, Package
} from "lucide-react";

/* ─── helpers ─── */
const fmt = (n: number) => n.toLocaleString();

const colorMap: Record<string, { bg: string; iconBg: string; iconColor: string }> = {
  info:    { bg: "bg-blue-50 dark:bg-blue-950/30",   iconBg: "bg-blue-100 dark:bg-blue-900/50",   iconColor: "text-blue-600 dark:text-blue-400" },
  success: { bg: "bg-green-50 dark:bg-green-950/30",  iconBg: "bg-green-100 dark:bg-green-900/50",  iconColor: "text-green-600 dark:text-green-400" },
  warning: { bg: "bg-amber-50 dark:bg-amber-950/30",  iconBg: "bg-amber-100 dark:bg-amber-900/50",  iconColor: "text-amber-600 dark:text-amber-400" },
  danger:  { bg: "bg-red-50 dark:bg-red-950/30",      iconBg: "bg-red-100 dark:bg-red-900/50",      iconColor: "text-red-600 dark:text-red-400" },
  default: { bg: "bg-slate-50 dark:bg-slate-800/30",   iconBg: "bg-slate-100 dark:bg-slate-800/50",  iconColor: "text-slate-600 dark:text-slate-400" },
};

interface CardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color?: string;
  onClick?: () => void;
}

function DashStatCard({ title, value, subtitle, icon, color = "default", onClick }: CardProps) {
  const c = colorMap[color] || colorMap.default;
  return (
    <div
      onClick={onClick}
      className={`card-embossed p-4 flex flex-col gap-1 ${c.bg} ${onClick ? "cursor-pointer" : ""}`}
    >
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</span>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${c.iconBg}`}>
          <span className={c.iconColor}>{icon}</span>
        </div>
      </div>
      <span className="text-[28px] font-black tracking-tight text-slate-900 dark:text-white">
        {typeof value === "number" ? fmt(value) : value}
      </span>
      {subtitle && <span className="text-[11px] text-slate-500 dark:text-slate-400">{subtitle}</span>}
    </div>
  );
}

/* ─── Health breakdown sparkline rows ─── */
function HealthRow({ label, count, total, dotColor }: { label: string; count: number; total: number; dotColor: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full ${dotColor}`} />
      <span className="text-[11px] text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 ml-auto">{count}</span>
    </div>
  );
}

export function ExecutiveDashboard() {
  const data = useConvexData();
  const navigate = useNavigate();
  const [scope, setScope] = useState<"ALL" | "SP_ONLY">("ALL");

  const parts = scope === "SP_ONLY" ? data.parts.filter(p => p.onPlan) : data.parts;
  const total = parts.length || 1;
  const totalUnits = parts.reduce((s, p) => s + p.qoh, 0);
  const okCount = parts.filter(p => p.status === "OK").length;
  const lowCount = parts.filter(p => p.status === "LOW").length;
  const outCount = parts.filter(p => p.status === "OUT").length;
  const overCount = parts.filter(p => p.status === "OVER").length;
  const healthPct = Math.round((okCount / total) * 100);

  const spTotal = data.parts.filter(p => p.onPlan).length;
  const spOk = data.parts.filter(p => p.onPlan && p.status === "OK").length;
  const spOut = data.parts.filter(p => p.onPlan && (p.status === "OUT")).length;
  const spHealthPct = spTotal ? Math.round((spOk / spTotal) * 100) : 0;

  const requiredStockouts = useMemo(
    () => parts.filter(p => p.qoh === 0 && p.type === "Required"),
    [parts]
  );
  const needReorder = parts.filter(p => p.qoh < p.minQty);
  const totalReorderUnits = needReorder.reduce((s, p) => s + Math.max(0, p.maxQty - p.qoh), 0);

  const txns = data.transactions;
  const txToday = useMemo(() => {
    const d = new Date(); d.setHours(0,0,0,0);
    return txns.filter(t => t.timestamp >= d.getTime());
  }, [txns]);
  const outTx = txns.filter(t => t.mode === "OUT").length;
  const inTx = txns.filter(t => t.mode === "IN" || t.mode === "RECEIVE").length;

  const kitCount = data.kits.length;
  const totalComponents = data.kits.reduce((s: number, k: any) => s + (k.components?.length || 0), 0);

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
        <ScopeToggle scope={scope} onChange={setScope} allCount={data.parts.length} spCount={spTotal} />
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
      {requiredStockouts.length > 0 && (
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
      )}

      {/* Row 1: SKUs, Health, Stock-Outs, Reorder */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <DashStatCard title="SKUs" value={parts.length} subtitle={`${fmt(totalUnits)} in stock`} icon={<Layers className="h-5 w-5" />} color="info" onClick={() => navigate("/stock-summary")} />
        <DashStatCard title="Health" value={`${healthPct}%`} subtitle={`${okCount} healthy`} icon={<HeartPulse className="h-5 w-5" />} color={healthPct > 60 ? "success" : "warning"} onClick={() => navigate("/stock-summary")} />
        <DashStatCard title="Stock-Outs" value={outCount} subtitle={`${requiredStockouts.length} Required`} icon={<XCircle className="h-5 w-5" />} color="danger" onClick={() => navigate("/reorder-stockout")} />
        <DashStatCard title="Reorder" value={needReorder.length} subtitle={`${fmt(totalReorderUnits)} units`} icon={<TriangleAlert className="h-5 w-5" />} color="warning" onClick={() => navigate("/reorder-stockout")} />
      </div>

      {/* Row 2: Low Stock, On Plan, Activity, Kits */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <DashStatCard title="Low Stock" value={lowCount} subtitle="Below min qty" icon={<TrendingDown className="h-5 w-5" />} color={lowCount > 0 ? "warning" : "default"} onClick={() => navigate("/reorder-stockout")} />
        <DashStatCard title="On Plan" value={spTotal} subtitle={`${spHealthPct}% OK · ${spOut} out`} icon={<ShieldCheck className="h-5 w-5" />} color={spHealthPct > 60 ? "info" : "warning"} onClick={() => navigate("/stock-summary")} />
        <DashStatCard title="Activity" value={txns.length} subtitle={`${outTx} OUT · ${inTx} IN`} icon={<Activity className="h-5 w-5" />} onClick={() => navigate("/transaction-search")} />
        <DashStatCard title="Kits" value={kitCount} subtitle={`${totalComponents} components`} icon={<Wrench className="h-5 w-5" />} color="info" onClick={() => navigate("/kit-analysis")} />
      </div>

      {/* Row 3: Today, SAP Ready, SAP Posted, SAP Errors */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <DashStatCard title="Today" value={txToday.length} subtitle="Scanned today" icon={<CalendarDays className="h-5 w-5" />} onClick={() => navigate("/transaction-search")} />
        <DashStatCard title="SAP Ready" value={0} subtitle="0 posting" icon={<Truck className="h-5 w-5" />} color="info" onClick={() => navigate("/sap-staging")} />
        <DashStatCard title="SAP Posted" value={0} subtitle="0 today" icon={<Package className="h-5 w-5" />} color="success" onClick={() => navigate("/sap-staging")} />
        <DashStatCard title="SAP Errors" value={0} subtitle="None today" icon={<TriangleAlert className="h-5 w-5" />} color="success" onClick={() => navigate("/sap-staging")} />
      </div>

      {/* Health mini breakdown */}
      <div className="card-embossed p-4 bg-white dark:bg-slate-900/50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">Inventory Status</h3>
          <span className="text-[10px] text-slate-400">{parts.length} total</span>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <HealthRow label="OK" count={okCount} total={total} dotColor="bg-green-500" />
          <HealthRow label="Low" count={lowCount} total={total} dotColor="bg-amber-500" />
          <HealthRow label="Out" count={outCount} total={total} dotColor="bg-red-500" />
          <HealthRow label="Over" count={overCount} total={total} dotColor="bg-blue-500" />
        </div>
      </div>
    </div>
  );
}
