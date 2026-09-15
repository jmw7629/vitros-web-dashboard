/**
 * VITROS configuration default values.
 *
 * Every default mirrors the CURRENT shipped UI exactly — these are not
 * aspirational values. When a default changes, the underlying page's
 * hard-coded rendering must change with it in the same change set.
 *
 * Pure module: no imports, no environment access.
 */

import type {
  NavItemConfig,
  DashboardModuleConfig,
  StockSummaryColumnConfig,
  TransactionSearchFieldConfig,
  PartMasterFieldConfig,
  AbcChartConfig,
  TurnoverChartConfig,
  RemProgressChartConfig,
  ReportDefinitionConfig,
  RolePolicy,
} from "./configContract";

export const BRAND_DEFAULTS = {
  appTitle: "VITROS",
  sidebarTitle: "VITROS",
  sidebarSubtitle: "Dashboard & Scan Kiosk",
} as const;

export const NAV_DEFAULTS = {
  inventoryItems: [
    { label: "Scan Kiosk", icon: "📷", path: "/scan-kiosk", iconBg: "from-indigo-500 to-indigo-700", visible: true, order: 0 },
    { label: "User Dashboard", icon: "👥", path: "/user-dashboard", iconBg: "from-violet-500 to-violet-700", visible: true, order: 1 },
    { label: "Executive Dashboard", icon: "📊", path: "/dashboard", iconBg: "from-sky-500 to-indigo-600", visible: true, order: 2 },
    { label: "Stock Summary", icon: "📦", path: "/stock-summary", iconBg: "from-amber-500 to-amber-700", visible: true, order: 3 },
    { label: "Incoming Stock Intake", icon: "📥", path: "/incoming-stock", iconBg: "from-emerald-500 to-emerald-700", visible: true, order: 4 },
    { label: "Reorder / Stock-Out", icon: "🔔", path: "/reorder-stockout", iconBg: "from-red-500 to-red-700", visible: true, order: 5 },
    { label: "Transaction Search", icon: "🔍", path: "/transaction-search", iconBg: "from-indigo-400 to-indigo-600", visible: true, order: 6 },
    { label: "Aged Inventory", icon: "⏳", path: "/aged-inventory", iconBg: "from-orange-500 to-orange-700", visible: true, order: 7 },
    { label: "WIP & Cycle Time", icon: "🔧", path: "/wip-cycle-time", iconBg: "from-slate-500 to-slate-700", visible: true, order: 8 },
    { label: "Inventory Turnover", icon: "🔄", path: "/inventory-turnover", iconBg: "from-teal-500 to-teal-700", visible: true, order: 9 },
    { label: "Inventory Accuracy", icon: "🎯", path: "/inventory-accuracy", iconBg: "from-pink-500 to-pink-700", visible: true, order: 10 },
    { label: "Analyzer Analysis", icon: "🔬", path: "/analyzer-analysis", iconBg: "from-violet-500 to-violet-700", visible: true, order: 11 },
    { label: "ABC Analysis", icon: "📈", path: "/abc-analysis", iconBg: "from-sky-400 to-sky-600", visible: true, order: 12 },
    { label: "Kit Analysis", icon: "🛡️", path: "/kit-analysis", iconBg: "from-indigo-500 to-indigo-700", visible: true, order: 13 },
    { label: "SAP Staging", icon: "📋", path: "/sap-staging", iconBg: "from-amber-500 to-amber-700", visible: true, order: 14 },
    { label: "SAP Analytics", icon: "🧮", path: "/sap-analytics", iconBg: "from-emerald-500 to-emerald-700", visible: true, order: 15 },
    { label: "Cycle Count", icon: "✅", path: "/cycle-count", iconBg: "from-emerald-600 to-emerald-800", visible: true, order: 16 },
    { label: "DHR Scanner", icon: "📋", path: "/dhr-scanner", iconBg: "from-purple-500 to-purple-700", visible: true, order: 17 },
    { label: "Health Heatmap", icon: "🗺️", path: "/health-heatmap", iconBg: "from-red-400 to-red-600", visible: true, order: 18 },
    { label: "e-Connectivity", icon: "🌐", path: "/e-connectivity", iconBg: "from-cyan-500 to-blue-700", visible: true, order: 19 },
  ] as NavItemConfig[],
  remItems: [
    { label: "REM Dashboard", icon: "🏭", path: "/rem/dashboard", iconBg: "from-teal-500 to-teal-700", visible: true, order: 0 },
    { label: "Morning Snapshot", icon: "🌅", path: "/rem/morning-snapshot", iconBg: "from-orange-500 to-orange-700", visible: true, order: 1 },
    { label: "REM Kanban", icon: "📋", path: "/rem/kanban", iconBg: "from-teal-400 to-teal-600", visible: true, order: 2 },
    { label: "REM Gantt", icon: "📊", path: "/rem/gantt", iconBg: "from-teal-500 to-teal-700", visible: true, order: 3 },
    { label: "REM Kiosk", icon: "📷", path: "/rem/kiosk", iconBg: "from-indigo-500 to-indigo-700", visible: true, order: 4 },
    { label: "REM Analyzers", icon: "🔬", path: "/rem/analyzers", iconBg: "from-indigo-400 to-indigo-600", visible: true, order: 5 },
    { label: "LVCC Tracker", icon: "💻", path: "/rem/lvcc", iconBg: "from-cyan-500 to-cyan-700", visible: true, order: 6 },
    { label: "Production Plan", icon: "📅", path: "/rem/production-plan", iconBg: "from-amber-500 to-amber-700", visible: true, order: 7 },
    { label: "Field Status", icon: "🌍", path: "/rem/field-status", iconBg: "from-emerald-500 to-emerald-700", visible: true, order: 8 },
    { label: "Staff & Training", icon: "👷", path: "/rem/staff", iconBg: "from-violet-500 to-violet-700", visible: true, order: 9 },
    { label: "Weekly Notes", icon: "📝", path: "/rem/notes", iconBg: "from-sky-500 to-sky-700", visible: true, order: 10 },
    { label: "REM Reports", icon: "📄", path: "/rem/reports", iconBg: "from-sky-400 to-sky-600", visible: true, order: 11 },
    { label: "REM Bulk Import", icon: "📥", path: "/rem/import", iconBg: "from-orange-400 to-orange-600", visible: true, order: 13 },
  ] as NavItemConfig[],
  inventoryReports: [
    { label: "Executive Report", icon: "📑", path: "/executive-report", iconBg: "from-sky-500 to-sky-700", visible: true, order: 0 },
    { label: "Mobile Quick View", icon: "📱", path: "/mobile-quick-view", iconBg: "from-violet-500 to-violet-700", visible: true, order: 1 },
    { label: "Upload / Refresh", icon: "⬆️", path: "/upload-refresh", iconBg: "from-teal-500 to-teal-700", visible: true, order: 2 },
    { label: "Report Preview", icon: "📝", path: "/report-preview", iconBg: "from-slate-500 to-slate-700", visible: true, order: 3 },
    { label: "Inventory Reports", icon: "📊", path: "/inventory-reports", iconBg: "from-blue-500 to-blue-700", visible: true, order: 4 },
  ] as NavItemConfig[],
  itemOrder: ["inventory", "reports", "settings", "theme"] as string[],
  routeLabels: {
    "/dashboard": "Executive Dashboard",
    "/engineer-dashboard": "Engineer Dashboard",
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
    "/dhr-scanner": "DHR Scanner",
    "/health-heatmap": "Health Heatmap",
    "/e-connectivity": "e-Connectivity",
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
    "/executive-report": "Executive Report",
    "/mobile-quick-view": "Mobile Quick View",
    "/report-preview": "Report Preview",
    "/upload-refresh": "Upload / Refresh",
    "/inventory-reports": "Inventory Reports",
  } as Record<string, string>,
};

export const DASHBOARD_DEFAULTS = {
  modules: [
    { id: "kpi-skus", type: "kpi", title: "SKUs", visible: true, order: 0, size: "small", config: { metric: "skus" } },
    { id: "kpi-health", type: "kpi", title: "Health", visible: true, order: 1, size: "small", config: { metric: "health" } },
    { id: "kpi-stock-outs", type: "kpi", title: "Stock-Outs", visible: true, order: 2, size: "small", config: { metric: "stockOuts" } },
    { id: "kpi-reorder", type: "kpi", title: "Reorder", visible: true, order: 3, size: "small", config: { metric: "reorder" } },
    { id: "kpi-low-stock", type: "kpi", title: "Low Stock", visible: true, order: 4, size: "small", config: { metric: "lowStock" } },
    { id: "kpi-on-plan", type: "kpi", title: "On Plan", visible: true, order: 5, size: "small", config: { metric: "onPlan" } },
    { id: "kpi-activity", type: "kpi", title: "Activity", visible: true, order: 6, size: "small", config: { metric: "activity" } },
    { id: "kpi-kits", type: "kpi", title: "Kits", visible: true, order: 7, size: "small", config: { metric: "kits" } },
    { id: "kpi-today", type: "kpi", title: "Today", visible: true, order: 8, size: "small", config: { metric: "today" } },
    { id: "kpi-sap-ready", type: "kpi", title: "SAP Ready", visible: true, order: 9, size: "small", config: { metric: "sapReady" } },
    { id: "kpi-sap-posted", type: "kpi", title: "SAP Posted", visible: true, order: 10, size: "small", config: { metric: "sapPosted" } },
    { id: "kpi-sap-errors", type: "kpi", title: "SAP Errors", visible: true, order: 11, size: "small", config: { metric: "sapErrors" } },
    { id: "list-inventory-status", type: "list", title: "Inventory Status", visible: true, order: 12, size: "full", config: { dataSource: "inventoryStatus" } },
  ] as DashboardModuleConfig[],
};

export const THEME_DEFAULTS = {
  defaultMode: "dark",
  availableModes: ["dark", "light", "midnight", "ocean", "vitros"] as string[],
};

export const TABLE_DEFAULTS = {
  stockSummaryColumns: [
    { key: "partNumber", label: "Part #", visible: true, order: 0 },
    { key: "description", label: "Description", visible: true, order: 1 },
    { key: "type", label: "Type", visible: true, order: 2 },
    { key: "qoh", label: "QOH", visible: true, order: 3 },
    { key: "minQty", label: "Min", visible: true, order: 4 },
    { key: "maxQty", label: "Max", visible: true, order: 5 },
    { key: "status", label: "Status", visible: true, order: 6 },
    { key: "onPlan", label: "On Plan", visible: true, order: 7 },
    { key: "binLocation", label: "Bin Location", visible: true, order: 8 },
    { key: "module", label: "Module", visible: true, order: 9 },
  ] as StockSummaryColumnConfig[],
  transactionSearchFields: [
    { key: "mode", visible: true, order: 0 },
    { key: "partNumber", visible: true, order: 1 },
    { key: "user", visible: true, order: 2 },
    { key: "analyzerSerial", visible: true, order: 3 },
    { key: "qty", visible: true, order: 4 },
    { key: "qtyChange", visible: true, order: 5 },
    { key: "timestamp", visible: true, order: 6 },
  ] as TransactionSearchFieldConfig[],
};

export const CHART_DEFAULTS = {
  abcAnalysis: {
    colors: ["#ef4444", "#f59e0b", "#22c55e"],
    showDonut: true,
    showPareto: true,
  } as AbcChartConfig,
  inventoryTurnover: {
    showClassCards: true,
    colors: ["#12a573", "#3b82f6", "#f59e0b", "#ef4545"],
  } as TurnoverChartConfig,
  remProgress: {
    color: "#6366f1",
    visible: true,
  } as RemProgressChartConfig,
};

export const REPORT_DEFAULTS = {
  definitions: [
    { id: "actions", name: "Action Items", description: "Immediate operational actions requiring attention", visible: true, defaultOpen: true, order: 0 },
    { id: "inventory", name: "Inventory Overview", description: "Stock health, shortages and overstock summary", visible: true, defaultOpen: false, order: 1 },
    { id: "kits", name: "Kit Status", description: "Kit completeness and component status", visible: true, defaultOpen: false, order: 2 },
  ] as ReportDefinitionConfig[],
};

export const THRESHOLD_DEFAULTS = {
  agedInventoryDays: 365,
};

export const FORM_DEFAULTS = {
  partMasterFields: [
    { key: "partNumber", label: "Part Number", order: 0 },
    { key: "description", label: "Description", order: 1 },
    { key: "type", label: "Type", order: 2 },
    { key: "qoh", label: "QOH", order: 3 },
    { key: "minQty", label: "Min", order: 4 },
    { key: "maxQty", label: "Max", order: 5 },
    { key: "onPlan", label: "On Stocking Plan", order: 6 },
    { key: "binLocation", label: "Bin Location", order: 7 },
    { key: "module", label: "Module", order: 8 },
  ] as PartMasterFieldConfig[],
};

export const FEATURE_DEFAULTS = {
  remImportEnabled: true,
  cycleCountEnabled: true,
  kitAnalysisEnabled: true,
  sapExportEnabled: true,
};

export const SYSTEM_DEFAULTS = {
  partType: "Required",
  currency: "$",
  // Matches SharedComponents formatDate's current output exactly.
  dateFormat: "MMM d h:mm A",
  // "local" keeps the browser timezone, matching current behavior.
  timezone: "local",
};

export const REM_DEFAULTS = {
  defaultView: "dashboard",
  showKanban: true,
  showGantt: true,
  showFieldStatus: true,
};

/** Default dashboard routes per role. Engineer gets its own simplified dashboard. */
export const ROLE_ROUTE_DEFAULTS = {
  superuserDefaultRoute: "/dashboard",
  engineerDefaultRoute: "/engineer-dashboard",
  viewerDefaultRoute: "/dashboard",
} as const;

/** Identical to the historical hard-coded authGuard ROLE_CAPABILITIES map. */
export const ROLE_POLICY_DEFAULT: RolePolicy = {
  superuser: [
    "inventory.read",
    "inventory.write",
    "inventory.admin",
    "ai.ocr",
    "rem.read",
    "rem.write",
    "admin.system_settings.manage",
    "admin.users.manage",
    "admin.audit.read",
  ],
  engineer: ["inventory.read", "inventory.write", "ai.ocr", "rem.read", "rem.write"],
  viewer: ["inventory.read", "rem.read"],
};
