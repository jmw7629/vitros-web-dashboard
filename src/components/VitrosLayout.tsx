import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { TopNavBar } from "./TopNavBar";
import { AppSidebar } from "./AppSidebar";
import { useConvexData } from "../hooks/useConvexData";
import { useTheme } from "../contexts/ThemeContext";
import { useConfig } from "../hooks/useConfig";
import { Menu } from "lucide-react";

export function VitrosLayout() {
  const { isLoading, error } = useConvexData();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { palette } = useTheme();
  const { get } = useConfig();
  const isRem = location.pathname.startsWith("/rem");
  const routeLabels = get<Record<string, string>>("nav.routeLabels");
  const sectionLabel = routeLabels[location.pathname] || (isRem ? "REM Tracker" : "Inventory");

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: palette.pageBg }}>
      <TopNavBar onMenuToggle={() => setSidebarOpen(true)} />
      <AppSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Content below top nav */}
      <main className="flex-1 mt-[48px]">
        {/* Sub-header with hamburger + section label */}
        <div className="flex items-center gap-3 px-4 py-2 border-b" style={{ backgroundColor: palette.cardBg, borderColor: palette.cardBorder }}>
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <Menu className="w-5 h-5" style={{ color: palette.textMuted }} />
          </button>
          <span className="text-sm font-semibold" style={{ color: palette.textSecondary }}>{sectionLabel}</span>
        </div>

        {/* Page content */}
        {isLoading ? (
          <div className="flex items-center justify-center h-[60vh]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 mx-auto mb-3" style={{ borderColor: palette.accentBlue }} />
              <p className="text-sm" style={{ color: palette.textMuted }}>Loading data...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-[60vh]">
            <div className="text-center">
              <p className="text-lg font-semibold mb-1" style={{ color: palette.statusOut }}>Connection Error</p>
              <p className="text-sm" style={{ color: palette.textSecondary }}>{error}</p>
            </div>
          </div>
        ) : (
          <div className="p-4 max-w-[800px] mx-auto">
            <Outlet />
          </div>
        )}
      </main>

    </div>
  );
}
