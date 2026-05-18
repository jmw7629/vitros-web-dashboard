import { useRef, useMemo, useState } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { CalendarDays, Printer, Download, ClipboardCheck } from "lucide-react";

export function ExecutiveReport() {
  const data = useConvexData();
  const printRef = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);

  const total = data.parts.length || 1;
  const healthy = data.parts.filter(p => p.status === "OK").length;
  const low = data.parts.filter(p => p.status === "LOW").length;
  const out = data.parts.filter(p => p.status === "OUT").length;
  const healthPct = Math.round((healthy / total) * 100);

  const requiredStockouts = useMemo(
    () => data.parts.filter(p => p.qoh === 0 && p.type === "Required").slice(0, 6),
    [data.parts]
  );
  const lowStockParts = useMemo(
    () => data.parts.filter(p => p.status === "LOW" && p.qoh > 0).sort((a, b) => (a.minQty - a.qoh) - (b.minQty - b.qoh)).slice(0, 6),
    [data.parts]
  );

  const healthColor = healthPct >= 70 ? "#22c55e" : healthPct >= 40 ? "#f59e0b" : "#ef4444";
  const healthBorderColor = healthPct >= 70 ? "border-green-300 dark:border-green-700" : healthPct >= 40 ? "border-amber-300 dark:border-amber-700" : "border-red-300 dark:border-red-700";
  const healthBgColor = healthPct >= 70 ? "bg-green-50 dark:bg-green-950/20" : healthPct >= 40 ? "bg-amber-50 dark:bg-amber-950/20" : "bg-red-50 dark:bg-red-950/20";
  const healthMsg = healthPct >= 70 ? "Inventory is in good shape." : healthPct >= 40 ? "Some attention needed." : "Critical — immediate action required.";

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  const handlePrint = () => {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 200);
  };

  return (
    <div className="space-y-4">
      {/* Report date card + buttons */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <div className="card-embossed p-4 flex items-center gap-3 flex-1 min-w-[200px] bg-blue-50 dark:bg-blue-950/30">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Report Date</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white mt-0.5">
              {now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">VITROS Inventory Executive Report</p>
          </div>
          <div className="ml-auto">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-100 dark:bg-blue-900/50">
              <CalendarDays className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handlePrint}
            disabled={printing}
            className="flex items-center gap-2 px-4 py-2.5 text-sm bg-slate-800 text-white rounded-lg btn-3d hover:bg-slate-700"
          >
            <Printer className="h-4 w-4" />
            {printing ? "Generating..." : "Print / Save PDF"}
          </button>
          <button
            onClick={handlePrint}
            disabled={printing}
            className="flex items-center gap-2 px-4 py-2.5 text-sm bg-blue-600 text-white rounded-lg btn-3d hover:bg-blue-700"
          >
            <Download className="h-4 w-4" />
            Download PDF
          </button>
        </div>
      </div>

      {/* Main report card */}
      <div ref={printRef} className="card-embossed p-6 space-y-6 print:shadow-none print:border-none bg-white dark:bg-slate-900">
        {/* Header */}
        <div className="border-b-2 border-slate-300 dark:border-slate-700 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-800 rounded-lg">
              <ClipboardCheck className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                VITROS Inventory — Executive Summary
              </h1>
              <p className="text-sm text-slate-500">
                {dateStr} • Ortho Clinical Diagnostics
              </p>
            </div>
          </div>
        </div>

        {/* Health Score Gauge */}
        <div className={`p-4 rounded-xl border-2 ${healthBgColor} ${healthBorderColor}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                Overall Inventory Health Score
              </p>
              <p className="text-4xl font-black mt-1 text-slate-900 dark:text-white">{healthPct}%</p>
              <p className="text-sm text-slate-500 mt-1">{healthMsg}</p>
            </div>
            {/* Circular gauge */}
            <div className="w-24 h-24 relative">
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-slate-200 dark:text-slate-700" />
                <circle
                  cx="18" cy="18" r="15.9" fill="none"
                  stroke={healthColor}
                  strokeWidth="2.5"
                  strokeDasharray={`${healthPct} ${100 - healthPct}`}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-lg font-black text-slate-900 dark:text-white">
                {healthPct}%
              </span>
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="card-embossed p-3 text-center">
            <p className="text-xs text-slate-500 font-bold uppercase">Total SKUs</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white">{data.parts.length}</p>
          </div>
          <div className="card-embossed p-3 text-center">
            <p className="text-xs text-slate-500 font-bold uppercase">Healthy</p>
            <p className="text-2xl font-black text-green-600">{healthy}</p>
          </div>
          <div className="card-embossed p-3 text-center">
            <p className="text-xs text-slate-500 font-bold uppercase">Low Stock</p>
            <p className="text-2xl font-black text-amber-600">{low}</p>
          </div>
          <div className="card-embossed p-3 text-center">
            <p className="text-xs text-slate-500 font-bold uppercase">Stock-Outs</p>
            <p className="text-2xl font-black text-red-600">{out}</p>
          </div>
        </div>

        {/* Required Stock-Outs table */}
        {requiredStockouts.length > 0 && (
          <div>
            <h3 className="font-bold text-sm mb-2 text-slate-900 dark:text-white">
              🚨 Top {requiredStockouts.length} Required Stock-Outs
            </h3>
            <div className="card-embossed overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-red-50 dark:bg-red-950/30 text-left">
                    <th className="px-3 py-2 text-slate-700 dark:text-slate-300">Part #</th>
                    <th className="px-3 py-2 text-slate-700 dark:text-slate-300">Description</th>
                    <th className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">Min</th>
                    <th className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">Max</th>
                  </tr>
                </thead>
                <tbody>
                  {requiredStockouts.map(p => (
                    <tr key={p.partNumber} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 font-mono font-bold text-red-700 dark:text-red-400">{p.partNumber}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{p.description}</td>
                      <td className="px-3 py-2 text-right text-slate-900 dark:text-white">{p.minQty}</td>
                      <td className="px-3 py-2 text-right text-slate-900 dark:text-white">{p.maxQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Low Stock Parts table */}
        {lowStockParts.length > 0 && (
          <div>
            <h3 className="font-bold text-sm mb-2 text-slate-900 dark:text-white">
              ⚠️ Top {lowStockParts.length} Low Stock Parts
            </h3>
            <div className="card-embossed overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-amber-50 dark:bg-amber-950/30 text-left">
                    <th className="px-3 py-2 text-slate-700 dark:text-slate-300">Part #</th>
                    <th className="px-3 py-2 text-slate-700 dark:text-slate-300">Description</th>
                    <th className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">QOH</th>
                    <th className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">Min</th>
                    <th className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">Shortfall</th>
                  </tr>
                </thead>
                <tbody>
                  {lowStockParts.map(p => (
                    <tr key={p.partNumber} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2 font-mono font-bold text-amber-700 dark:text-amber-400">{p.partNumber}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{p.description}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-900 dark:text-white">{p.qoh}</td>
                      <td className="px-3 py-2 text-right text-slate-900 dark:text-white">{p.minQty}</td>
                      <td className="px-3 py-2 text-right font-bold text-red-600">{p.minQty - p.qoh}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-slate-200 dark:border-slate-700 pt-3 flex items-center justify-between text-[10px] text-slate-400">
          <span>VITROS Inventory Management System</span>
          <span>Generated {now.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
