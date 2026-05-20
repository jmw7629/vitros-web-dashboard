import { useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { TopNavBar } from "./TopNavBar";
import { AppSidebar } from "./AppSidebar";
import { useConvexData } from "../hooks/useConvexData";
import { useTheme } from "../contexts/ThemeContext";
import { Menu } from "lucide-react";

// Route label map
const routeLabels: Record<string, string> = {
  "/dashboard": "Executive Dashboard",
  "/scan-kiosk": "Scan Kiosk",
  "/user-dashboard": "User Dashboard",
  "/stock-summary": "Stock Summary",
  "/incoming-stock": "Incoming Stock Intake",
  "/reorder-stockout": "Reorder / Stock-Out",
  "/transaction-search": "Transaction Search",
  "/aged-inventory": "Aged Inventory",
  "/wip-cycle-time": "WIP & Cycle Time",
  "/inventory-turnover": "Inventory Turnover",
  "/inventory-accuracy": "Inventory Accuracy",
  "/analyzer-analysis": "Analyzer Analysis",
  "/abc-analysis": "ABC Analysis",
  "/kit-analysis": "Kit Analysis",
  "/sap-staging": "SAP Staging",
  "/sap-analytics": "SAP Analytics",
  "/cycle-count": "Cycle Count",
  "/health-heatmap": "Health Heatmap",
  "/executive-report": "Executive Report",
  "/mobile-quick-view": "Mobile Quick View",
  "/report-preview": "Report Preview",
  "/upload-refresh": "Upload / Refresh",
  "/rem/dashboard": "REM Dashboard",
  "/rem/morning-snapshot": "Morning Snapshot",
  "/rem/kanban": "REM Kanban",
  "/rem/gantt": "REM Gantt",
  "/rem/kiosk": "REM Kiosk",
  "/rem/analyzers": "Analyzers",
  "/rem/lvcc": "LVCC Tracker",
  "/rem/production-plan": "Production Plan",
  "/rem/field-status": "Field Status",
  "/rem/staff": "Staff & Training",
  "/rem/notes": "Weekly Notes",
  "/rem/reports": "REM Reports",
  "/rem/import": "REM Bulk Import",
  "/settings": "Settings",
};

export function VitrosLayout() {
  const { isLoading, error } = useConvexData();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { palette } = useTheme();
  const isRem = location.pathname.startsWith("/rem");
  const sectionLabel = isRem ? "REM Tracker" : "Inventory";

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
