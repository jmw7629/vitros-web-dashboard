import { useState } from "react";
import { ExternalLink, Cpu, Globe, Shield, Activity, ArrowUpRight } from "lucide-react";
import { SystemDiagram } from "./SystemDiagram";

type Tab = "diagram" | "healthcheck";

export function EConnectivity() {
  const [activeTab, setActiveTab] = useState<Tab>("diagram");
  const externalUrl = "https://external.econnectivity.com/eConn/App/EHealthCheck.aspx?culture=en-US";

  return (
    <div className="flex flex-col h-[calc(100vh-48px)]">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b" style={{ backgroundColor: "#111827", borderColor: "#1e293b" }}>
        <button
          onClick={() => setActiveTab("diagram")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === "diagram"
              ? "bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30"
              : "text-slate-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          System Diagram
        </button>
        <button
          onClick={() => setActiveTab("healthcheck")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            activeTab === "healthcheck"
              ? "bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30"
              : "text-slate-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          Health Check
        </button>
      </div>

      {/* Content */}
      {activeTab === "diagram" ? (
        <SystemDiagram />
      ) : (
        <div className="flex-1 flex items-center justify-center p-6" style={{ backgroundColor: "#0a0f1a" }}>
          <div className="max-w-md w-full text-center space-y-6">
            {/* Icon */}
            <div className="mx-auto w-20 h-20 rounded-2xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #0ea5e9, #2563eb)" }}>
              <Activity className="w-10 h-10 text-white" />
            </div>

            {/* Title */}
            <div>
              <h2 className="text-xl font-bold text-white mb-1">e-Connectivity Health Check</h2>
              <p className="text-sm text-slate-400">QuidelOrtho external monitoring portal</p>
            </div>

            {/* Info cards */}
            <div className="grid grid-cols-2 gap-3 text-left">
              <div className="p-3 rounded-lg" style={{ backgroundColor: "rgba(30,41,59,0.6)" }}>
                <Shield className="w-4 h-4 text-cyan-400 mb-1.5" />
                <p className="text-[11px] font-semibold text-white">Secure Portal</p>
                <p className="text-[10px] text-slate-400 mt-0.5">Requires QuidelOrtho SSO authentication</p>
              </div>
              <div className="p-3 rounded-lg" style={{ backgroundColor: "rgba(30,41,59,0.6)" }}>
                <Activity className="w-4 h-4 text-blue-400 mb-1.5" />
                <p className="text-[11px] font-semibold text-white">System Status</p>
                <p className="text-[10px] text-slate-400 mt-0.5">VITROS analyzer connectivity & health monitoring</p>
              </div>
            </div>

            {/* Launch button */}
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white transition-all hover:scale-105 hover:shadow-lg hover:shadow-blue-500/25"
              style={{ background: "linear-gradient(135deg, #0ea5e9, #2563eb)" }}
            >
              Open Health Check
              <ArrowUpRight className="w-4 h-4" />
            </a>

            <p className="text-[10px] text-slate-600">Opens in a new browser tab</p>
          </div>
        </div>
      )}
    </div>
  );
}
