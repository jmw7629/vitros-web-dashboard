import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "../lib/utils";
import { X } from "lucide-react";
import { useRole } from "../hooks/useRole";
import { useTheme, THEME_PALETTES, type ThemeMode } from "../contexts/ThemeContext";
import { theme } from "./vitros/SharedComponents";

interface NavItem { label: string; icon: string; path: string; iconBg: string; }

const inventoryItems: NavItem[] = [
  { label: "Scan Kiosk", icon: "📷", path: "/scan-kiosk", iconBg: "from-indigo-500 to-indigo-700" },
  { label: "User Dashboard", icon: "👥", path: "/user-dashboard", iconBg: "from-violet-500 to-violet-700" },
  { label: "Executive Dashboard", icon: "📊", path: "/dashboard", iconBg: "from-sky-500 to-indigo-600" },
  { label: "Stock Summary", icon: "📦", path: "/stock-summary", iconBg: "from-amber-500 to-amber-700" },
  { label: "Incoming Stock Intake", icon: "📥", path: "/incoming-stock", iconBg: "from-emerald-500 to-emerald-700" },
  { label: "Reorder / Stock-Out", icon: "🔔", path: "/reorder-stockout", iconBg: "from-red-500 to-red-700" },
  { label: "Transaction Search", icon: "🔍", path: "/transaction-search", iconBg: "from-indigo-400 to-indigo-600" },
  { label: "Aged Inventory", icon: "⏳", path: "/aged-inventory", iconBg: "from-orange-500 to-orange-700" },
  { label: "WIP & Cycle Time", icon: "🔧", path: "/wip-cycle-time", iconBg: "from-slate-500 to-slate-700" },
  { label: "Inventory Turnover", icon: "🔄", path: "/inventory-turnover", iconBg: "from-teal-500 to-teal-700" },
  { label: "Inventory Accuracy", icon: "🎯", path: "/inventory-accuracy", iconBg: "from-pink-500 to-pink-700" },
  { label: "Analyzer Analysis", icon: "🔬", path: "/analyzer-analysis", iconBg: "from-violet-500 to-violet-700" },
  { label: "ABC Analysis", icon: "📈", path: "/abc-analysis", iconBg: "from-sky-400 to-sky-600" },
  { label: "Kit Analysis", icon: "🛡️", path: "/kit-analysis", iconBg: "from-indigo-500 to-indigo-700" },
  { label: "SAP Staging", icon: "📋", path: "/sap-staging", iconBg: "from-amber-500 to-amber-700" },
  { label: "SAP Analytics", icon: "🧮", path: "/sap-analytics", iconBg: "from-emerald-500 to-emerald-700" },
  { label: "Cycle Count", icon: "✅", path: "/cycle-count", iconBg: "from-emerald-600 to-emerald-800" },
  { label: "DHR Scanner", icon: "📋", path: "/dhr-scanner", iconBg: "from-purple-500 to-purple-700" },
  { label: "Health Heatmap", icon: "🗺️", path: "/health-heatmap", iconBg: "from-red-400 to-red-600" },
  { label: "e-Connectivity", icon: "🌐", path: "/e-connectivity", iconBg: "from-cyan-500 to-blue-700" },
];

const inventoryReports: NavItem[] = [
  { label: "Executive Report", icon: "📑", path: "/executive-report", iconBg: "from-sky-500 to-sky-700" },
  { label: "Mobile Quick View", icon: "📱", path: "/mobile-quick-view", iconBg: "from-violet-500 to-violet-700" },
  { label: "Upload / Refresh", icon: "⬆️", path: "/upload-refresh", iconBg: "from-teal-500 to-teal-700" },
  { label: "Report Preview", icon: "📝", path: "/report-preview", iconBg: "from-slate-500 to-slate-700" },
];

const remItems: NavItem[] = [
  { label: "REM Dashboard", icon: "🏭", path: "/rem/dashboard", iconBg: "from-teal-500 to-teal-700" },
  { label: "Morning Snapshot", icon: "🌅", path: "/rem/morning-snapshot", iconBg: "from-orange-500 to-orange-700" },
  { label: "REM Kanban", icon: "📋", path: "/rem/kanban", iconBg: "from-teal-400 to-teal-600" },
  { label: "REM Gantt", icon: "📊", path: "/rem/gantt", iconBg: "from-teal-500 to-teal-700" },
  { label: "REM Kiosk", icon: "📷", path: "/rem/kiosk", iconBg: "from-indigo-500 to-indigo-700" },
  { label: "REM Analyzers", icon: "🔬", path: "/rem/analyzers", iconBg: "from-indigo-400 to-indigo-600" },
  { label: "LVCC Tracker", icon: "💻", path: "/rem/lvcc", iconBg: "from-cyan-500 to-cyan-700" },
  { label: "Production Plan", icon: "📅", path: "/rem/production-plan", iconBg: "from-amber-500 to-amber-700" },
  { label: "Field Status", icon: "🌍", path: "/rem/field-status", iconBg: "from-emerald-500 to-emerald-700" },
  { label: "Staff & Training", icon: "👷", path: "/rem/staff", iconBg: "from-violet-500 to-violet-700" },
  { label: "Weekly Notes", icon: "📝", path: "/rem/notes", iconBg: "from-sky-500 to-sky-700" },
  { label: "REM Reports", icon: "📄", path: "/rem/reports", iconBg: "from-sky-400 to-sky-600" },
  { label: "REM Bulk Import", icon: "📥", path: "/rem/import", iconBg: "from-orange-400 to-orange-600" },
];

const settingsItem: NavItem = { label: "Settings", icon: "⚙️", path: "/settings", iconBg: "from-slate-400 to-slate-600" };

interface AppSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function AppSidebar({ isOpen = true, onClose = () => {} }: AppSidebarProps = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { role, setRole } = useRole();
  const { themeMode, setThemeMode, palette } = useTheme();
  const [showThemePicker, setShowThemePicker] = useState(false);
  const isRem = location.pathname.startsWith("/rem");

  const items = isRem ? remItems : inventoryItems;
  const reports = isRem ? [] : inventoryReports;

  const handleNav = (path: string) => { navigate(path); onClose(); };

  const handleLogout = () => {
    setRole(null);
    localStorage.removeItem("vitros-role");
    localStorage.removeItem("vitros-tab");
    onClose();
    navigate("/");
  };

  const renderRow = (item: NavItem) => {
    const isActive = location.pathname === item.path;
    return (
      <button
        key={item.path}
        onClick={() => handleNav(item.path)}
        className={cn(
          "flex items-center gap-3 w-full px-3 py-2 rounded-xl text-left transition-all",
          isActive
            ? "bg-white/10 ring-1 ring-white/10"
            : "hover:bg-white/5"
        )}
      >
        {/* Drag handle dots */}
        <div className="flex flex-col gap-0.5 opacity-30">
          <div className="flex gap-0.5"><span className="w-1 h-1 rounded-full bg-slate-400"/><span className="w-1 h-1 rounded-full bg-slate-400"/></div>
          <div className="flex gap-0.5"><span className="w-1 h-1 rounded-full bg-slate-400"/><span className="w-1 h-1 rounded-full bg-slate-400"/></div>
          <div className="flex gap-0.5"><span className="w-1 h-1 rounded-full bg-slate-400"/><span className="w-1 h-1 rounded-full bg-slate-400"/></div>
        </div>
        {/* 3D gradient icon */}
        <div className={cn(
          "w-8 h-8 rounded-xl flex items-center justify-center text-[15px] shrink-0 bg-gradient-to-br shadow-lg",
          item.iconBg
        )}>
          {item.icon}
        </div>
        <span className={cn(
          "text-[13px] truncate",
          isActive ? "text-white font-semibold" : "text-slate-300"
        )}>
          {item.label}
        </span>
      </button>
    );
  };

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-50 transition-opacity"
          onClick={onClose}
        />
      )}
      {/* Sidebar panel */}
      <div
        className={cn(
          "fixed top-0 left-0 bottom-0 w-[300px] z-50 flex flex-col transition-transform duration-300 ease-in-out",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ backgroundColor: theme.sidebarBg }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: theme.sidebarBorder }}>
          <div>
            <h2 className="text-base font-bold text-white">VITROS</h2>
            <p className="text-[11px] text-slate-400">Dashboard & Scan Kiosk</p>
            {role && (
              <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                ● {role === "superuser" ? "Superuser" : "Engineer"}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Nav items — all scrollable together */}
        <div className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5">
          {items.map(renderRow)}
          {reports.length > 0 && (
            <>
              <div className="pt-3 pb-1 px-3">
                <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Reports</span>
              </div>
              {reports.map(renderRow)}
            </>
          )}

          {/* Divider */}
          <div className="my-2 mx-3 border-t" style={{ borderColor: theme.sidebarBorder }} />

          {/* Settings */}
          {renderRow(settingsItem)}

          {/* Theme picker */}
          <button
            onClick={() => setShowThemePicker(!showThemePicker)}
            className={cn(
              "flex items-center gap-3 w-full px-3 py-2 rounded-xl text-left transition-all",
              showThemePicker ? "bg-white/10 ring-1 ring-white/10" : "hover:bg-white/5"
            )}
          >
            <div className="flex flex-col gap-0.5 opacity-30">
              <div className="flex gap-0.5"><span className="w-1 h-1 rounded-full bg-slate-400"/><span className="w-1 h-1 rounded-full bg-slate-400"/></div>
              <div className="flex gap-0.5"><span className="w-1 h-1 rounded-full bg-slate-400"/><span className="w-1 h-1 rounded-full bg-slate-400"/></div>
              <div className="flex gap-0.5"><span className="w-1 h-1 rounded-full bg-slate-400"/><span className="w-1 h-1 rounded-full bg-slate-400"/></div>
            </div>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[15px] shrink-0 bg-gradient-to-br from-purple-500 to-pink-600 shadow-lg">
              🎨
            </div>
            <span className="text-[13px] text-slate-300">Theme</span>
          </button>

          {/* Theme options (collapsible) */}
          {showThemePicker && (
            <div className="ml-6 pl-3 space-y-1 py-1">
              {Object.entries(THEME_PALETTES).map(([key, p]) => {
                const active = key === themeMode;
                return (
                  <button
                    key={key}
                    onClick={() => { setThemeMode(key as ThemeMode); }}
                    className="flex items-center gap-2.5 w-full px-3 py-1.5 rounded-lg transition-all text-left"
                    style={{
                      backgroundColor: active ? `${palette.accentBlue}22` : "transparent",
                      border: active ? `1px solid ${palette.accentBlue}44` : "1px solid transparent",
                    }}
                  >
                    <div className="flex gap-1 shrink-0">
                      <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: p.pageBg, border: `1px solid ${p.cardBorder}` }} />
                      <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: p.accentBlue }} />
                      <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: p.statusOk }} />
                    </div>
                    <span className="text-[12px]" style={{ color: active ? palette.textPrimary : palette.textSecondary }}>
                      {p.emoji} {p.label}
                    </span>
                    {active && <span className="text-[11px] ml-auto" style={{ color: palette.accentBlue }}>✓</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-left transition-all hover:bg-red-500/10"
          >
            <div className="flex flex-col gap-0.5 opacity-30">
              <div className="flex gap-0.5"><span className="w-1 h-1 rounded-full bg-slate-400"/><span className="w-1 h-1 rounded-full bg-slate-400"/></div>
              <div className="flex gap-0.5"><span className="w-1 h-1 rounded-full bg-slate-400"/><span className="w-1 h-1 rounded-full bg-slate-400"/></div>
              <div className="flex gap-0.5"><span className="w-1 h-1 rounded-full bg-slate-400"/><span className="w-1 h-1 rounded-full bg-slate-400"/></div>
            </div>
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[15px] shrink-0 bg-gradient-to-br from-red-500 to-red-700 shadow-lg">
              🚪
            </div>
            <span className="text-[13px] text-red-400">Logout</span>
          </button>

          {/* Bottom padding for scroll comfort */}
          <div className="h-2" />
        </div>
      </div>
    </>
  );
}
