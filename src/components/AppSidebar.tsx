import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "../lib/utils";
import { X } from "lucide-react";
import { useRole } from "../hooks/useRole";
import { useTheme, THEME_PALETTES } from "../contexts/ThemeContext";
import { useConfig } from "../hooks/useConfig";
import type { NavItemConfig } from "../lib/configRegistry";
import type { ThemeMode } from "../../convex/configContract";
import { theme } from "./vitros/SharedComponents";
import { filterNavItemsForRole, type RoleName } from "../lib/dashboardRoutes";

const settingsItem: NavItemConfig = { label: "Settings", icon: "⚙️", path: "/settings", iconBg: "from-slate-400 to-slate-600", visible: true, order: 0 };

interface AppSidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function AppSidebar({ isOpen = true, onClose = () => {} }: AppSidebarProps = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { role, setRole } = useRole();
  const { themeMode, setThemeMode, palette, availableModes } = useTheme();
  const { getNavItems, get, isFeatureEnabled } = useConfig();
  const [showThemePicker, setShowThemePicker] = useState(false);
  const isRem = location.pathname.startsWith("/rem");

  const sidebarTitle = get<string>("brand.sidebarTitle");
  const sidebarSubtitle = get<string>("brand.sidebarSubtitle");
  let items = isRem ? getNavItems("rem") : getNavItems("inventory");
  const reports = isRem ? [] : getNavItems("reports");

  // Filter navigation items based on role capabilities
  if (role) {
    items = filterNavItemsForRole(items, role as RoleName);
  }

  // Filter REM items based on feature flags
  if (isRem) {
    const showKanban = isFeatureEnabled("rem.showKanban");
    const showGantt = isFeatureEnabled("rem.showGantt");
    const showFieldStatus = isFeatureEnabled("rem.showFieldStatus");
    items = items.filter(item => {
      if (item.path === "/rem/kanban" && !showKanban) return false;
      if (item.path === "/rem/gantt" && !showGantt) return false;
      if (item.path === "/rem/field-status" && !showFieldStatus) return false;
      return true;
    });
  }

  const handleNav = (path: string) => { navigate(path); onClose(); };

  const handleLogout = () => {
    setRole(null);
    localStorage.removeItem("vitros-role");
    localStorage.removeItem("vitros-tab");
    onClose();
    navigate("/");
  };

  const renderRow = (item: NavItemConfig) => {
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
            <h2 className="text-base font-bold text-white">{sidebarTitle}</h2>
            <p className="text-[11px] text-slate-400">{sidebarSubtitle}</p>
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
              {availableModes.map((key) => {
                const p = THEME_PALETTES[key];
                const active = key === themeMode;
                return (
                  <button
                    key={key}
                    onClick={() => { setThemeMode(key); }}
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
