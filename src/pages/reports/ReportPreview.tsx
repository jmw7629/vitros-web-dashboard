import { useRef, useMemo, useState } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { ScopeToggle } from "../../components/vitros/ScopeToggle";
import {
  FileText, Printer, XCircle, Layers, ChevronUp, ChevronDown, ArrowRight, AlertTriangle
} from "lucide-react";

/* ─── helpers ─── */
const fmt = (n: number) => n.toLocaleString();
const dayStr = () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const timeStr = () => new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });

interface AccordionProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function Accordion({ title, icon, count, open, onToggle, children }: AccordionProps) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 py-2.5 text-left"
      >
        {icon}
        <span className="font-bold text-sm text-slate-800 dark:text-slate-200 uppercase tracking-wider">{title}</span>
        {count !== undefined && (
          <span className="ml-1 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold px-2 py-0.5 rounded-full">
            {count}
          </span>
        )}
        <span className="ml-auto">
          {open ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        </span>
      </button>
      {open && children}
    </div>
  );
}

export function ReportPreview() {
  const data = useConvexData();
  const printRef = useRef<HTMLDivElement>(null);
  const [scope, setScope] = useState<"ALL" | "SP_ONLY">("ALL");
  const [sections, setSections] = useState<Record<string, boolean>>({ actions: true, inventory: false, kits: false });

  const parts = scope === "SP_ONLY" ? data.parts.filter(p => p.onPlan) : data.parts;
  const total = parts.length || 1;
  const totalUnits = parts.reduce((s, p) => s + p.qoh, 0);
  const healthy = parts.filter(p => p.status === "OK");
  const lowStock = parts.filter(p => p.status === "LOW");
  const stockouts = parts.filter(p => p.status === "OUT");
  const overstocked = parts.filter(p => p.status === "OVER");
  const requiredStockouts = stockouts.filter(p => p.type === "Required");
  const healthPct = Math.round((healthy.length / total) * 100);

  const spTotal = data.parts.filter(p => p.onPlan).length;

  const txns = data.transactions;
  const todayCutoff = useMemo(() => { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }, []);
  const txToday = txns.filter(t => t.timestamp >= todayCutoff);
  const outToday = txToday.filter(t => t.mode === "OUT").length;
  const inToday = txToday.filter(t => t.mode === "IN" || t.mode === "RECEIVE").length;

  const needReorder = parts.filter(p => p.qoh < p.minQty);
  const totalReorderUnits = needReorder.reduce((s, p) => s + Math.max(0, p.maxQty - p.qoh), 0);

  /* Build action items */
  const actionItems = useMemo(() => {
    const items: { severity: "critical" | "warning" | "info"; title: string; metric?: string; detail: string; link?: string }[] = [];
    if (requiredStockouts.length > 0) {
      items.push({
        severity: "critical",
        title: `${requiredStockouts.length} Required Parts at Zero Stock`,
        metric: `${requiredStockouts.length} parts`,
        detail: `Critical parts: ${requiredStockouts.slice(0, 5).map(p => p.partNumber).join(", ")}${requiredStockouts.length > 5 ? "..." : ""}`,
        link: "reorder-stockout"
      });
    }
    if (needReorder.length > 0) {
      items.push({
        severity: "warning",
        title: `${needReorder.length} Parts Below Reorder Point`,
        metric: `${needReorder.length} parts`,
        detail: `${stockouts.length} at zero stock. Total reorder quantity: ${fmt(totalReorderUnits)} units`,
        link: "reorder-stockout"
      });
    }
    if (overstocked.length > 10) {
      items.push({
        severity: "info",
        title: `${overstocked.length} Overstocked Items`,
        metric: `${overstocked.length} parts`,
        detail: `Consider reducing order quantities or adjusting max levels`,
      });
    }
    return items;
  }, [requiredStockouts, needReorder, stockouts, overstocked, totalReorderUnits]);

  const severityStyles: Record<string, { bg: string; border: string; dot: string; iconColor: string }> = {
    critical: { bg: "bg-red-50 dark:bg-red-950/30", border: "border-red-200 dark:border-red-900", dot: "bg-red-500", iconColor: "text-red-500" },
    warning:  { bg: "bg-amber-50 dark:bg-amber-950/30", border: "border-amber-200 dark:border-amber-900", dot: "bg-amber-500", iconColor: "text-amber-500" },
    info:     { bg: "bg-blue-50 dark:bg-blue-950/30", border: "border-blue-200 dark:border-blue-900", dot: "bg-blue-500", iconColor: "text-blue-500" },
  };

  const toggle = (id: string) => setSections(s => ({ ...s, [id]: !s[id] }));

  const handlePrint = () => { setTimeout(() => window.print(), 200); };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <FileText className="h-6 w-6 text-blue-600" />
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Executive Briefing</h2>
          </div>
          <p className="text-sm text-slate-500">VITROS Analyzer Inventory — Daily Report</p>
        </div>
        <div className="flex items-center gap-2">
          <ScopeToggle scope={scope} onChange={setScope} allCount={data.parts.length} spCount={spTotal} />
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors dark:bg-slate-600"
          >
            <Printer className="h-3.5 w-3.5" /> Print
          </button>
        </div>
      </div>

      {/* Main Briefing Card */}
      <div ref={printRef} className="bg-white dark:bg-slate-900 rounded-xl border-2 border-slate-200 dark:border-slate-700 shadow-lg overflow-hidden print:shadow-none print:border-0">
        {/* Dark header bar */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900 px-6 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-black text-white tracking-tight">VITROS INVENTORY — DAILY BRIEFING</h1>
              <p className="text-blue-300 text-xs font-medium mt-0.5">QuidelOrtho · VITROS 5600 / 7600 Analyzers</p>
            </div>
            <div className="text-right">
              <p className="text-white font-bold text-sm">{dayStr()}</p>
              <p className="text-blue-300 text-xs">Generated at {timeStr()}</p>
            </div>
          </div>
        </div>

        {/* Stats strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 border-b-2 border-slate-100 dark:border-slate-800">
          {[
            { label: "Total SKUs", value: fmt(parts.length), sub: `${fmt(totalUnits)} units`, color: "text-blue-600" },
            { label: "Health Score", value: `${healthPct}%`, sub: `${healthy.length} healthy`, color: healthPct >= 60 ? "text-green-600" : "text-amber-600" },
            { label: "Stock-Outs", value: fmt(stockouts.length), sub: `${requiredStockouts.length} required`, color: "text-red-600" },
            { label: "Today's Activity", value: fmt(txToday.length), sub: `${outToday} out / ${inToday} in`, color: "text-slate-800 dark:text-white" },
          ].map((s, i) => (
            <div key={i} className={`px-5 py-4 ${i < 3 ? "border-r border-slate-100 dark:border-slate-800" : ""}`}>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{s.label}</p>
              <p className={`text-2xl font-black mt-0.5 ${s.color}`}>{s.value}</p>
              <p className="text-xs text-slate-500 mt-0.5">{s.sub}</p>
            </div>
          ))}
        </div>

        {/* Accordion sections */}
        <div className="p-5 space-y-4">
          {/* ACTION ITEMS */}
          <div>
            <Accordion
              id="actions"
              title="ACTION ITEMS"
              icon={<XCircle className="h-4 w-4 text-red-500" />}
              count={actionItems.filter(a => a.severity === "critical" || a.severity === "warning").length}
              open={sections.actions}
              onToggle={() => toggle("actions")}
            >
              <div className="mt-2 space-y-2">
                {actionItems.length === 0 && (
                  <div className="text-center py-8 text-slate-400 text-sm">
                    ✅ No action items — all systems healthy
                  </div>
                )}
                {actionItems.map((item, i) => {
                  const style = severityStyles[item.severity];
                  return (
                    <div key={i} className={`flex items-start gap-3 p-3 rounded-lg border ${style.bg} ${style.border}`}>
                      <div className={`mt-0.5 ${style.iconColor}`}>
                        {item.severity === "critical" ? <XCircle className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${style.dot}`} />
                          <span className="font-bold text-sm text-slate-800 dark:text-slate-200">{item.title}</span>
                          {item.metric && (
                            <span className="text-[10px] font-mono font-bold bg-white/70 dark:bg-slate-800/70 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-700">
                              {item.metric}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">{item.detail}</p>
                      </div>
                      {item.link && (
                        <ArrowRight className="h-4 w-4 text-blue-600 shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            </Accordion>
          </div>

          {/* INVENTORY OVERVIEW */}
          <div>
            <Accordion
              id="inventory"
              title="INVENTORY OVERVIEW"
              icon={<Layers className="h-4 w-4 text-blue-500" />}
              open={sections.inventory}
              onToggle={() => toggle("inventory")}
            >
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Healthy", value: healthy.length, total, color: "bg-green-500", textColor: "text-green-700 dark:text-green-400" },
                    { label: "Low Stock", value: lowStock.length, total, color: "bg-amber-500", textColor: "text-amber-700 dark:text-amber-400" },
                    { label: "Stock-Out", value: stockouts.length, total, color: "bg-red-500", textColor: "text-red-700 dark:text-red-400" },
                    { label: "Overstocked", value: overstocked.length, total, color: "bg-blue-500", textColor: "text-blue-700 dark:text-blue-400" },
                  ].map((s, i) => (
                    <div key={i} className="bg-slate-50 dark:bg-slate-800/50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase text-slate-500">{s.label}</span>
                        <span className={`text-lg font-black ${s.textColor}`}>{s.value}</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${s.color}`} style={{ width: `${(s.value / s.total) * 100}%` }} />
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1">{Math.round((s.value / s.total) * 100)}% of {s.total}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Accordion>
          </div>

          {/* KITS */}
          <div>
            <Accordion
              id="kits"
              title="KIT STATUS"
              icon={<Layers className="h-4 w-4 text-purple-500" />}
              count={data.kits.length}
              open={sections.kits}
              onToggle={() => toggle("kits")}
            >
              <div className="mt-2 space-y-2">
                {data.kits.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-4">No kits configured</p>
                ) : (
                  data.kits.map((kit: any) => (
                    <div key={kit._id} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-lg">
                      <div>
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{kit.name}</p>
                        <p className="text-xs text-slate-500">{kit.components?.length || 0} components</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Accordion>
          </div>
        </div>
      </div>
    </div>
  );
}
