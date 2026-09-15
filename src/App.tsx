import { Route, Routes, Navigate } from "react-router-dom";
import { VitrosLayout } from "./components/VitrosLayout";
import { RoleLogin } from "./pages/RoleLogin";
import { ExecutiveDashboard } from "./pages/inventory/ExecutiveDashboard";
import { EngineerDashboard } from "./pages/inventory/EngineerDashboard";
import { StockSummary } from "./pages/inventory/StockSummary";
import { ScanKiosk } from "./pages/inventory/ScanKiosk";
import { UserDashboard } from "./pages/inventory/UserDashboard";
import { IncomingStockDocument } from "./pages/inventory/IncomingStockDocument";
import { ReorderStockout } from "./pages/inventory/ReorderStockout";
import { TransactionSearch } from "./pages/inventory/TransactionSearch";
import { AgedInventory } from "./pages/inventory/AgedInventory";
import { WipCycleTime } from "./pages/inventory/WipCycleTime";
import { InventoryTurnover } from "./pages/inventory/InventoryTurnover";
import { InventoryAccuracy } from "./pages/inventory/InventoryAccuracy";
import { AnalyzerAnalysis } from "./pages/inventory/AnalyzerAnalysis";
import { AbcAnalysis } from "./pages/inventory/AbcAnalysis";
import { KitAnalysis } from "./pages/inventory/KitAnalysis";
import { SapStaging } from "./pages/inventory/SapStaging";
import { SapAnalytics } from "./pages/inventory/SapAnalytics";
import { CycleCount } from "./pages/inventory/CycleCount";
import { DhrScanner } from "./pages/inventory/DhrScanner";
import { HealthHeatmap } from "./pages/inventory/HealthHeatmap";
import { RemDashboard } from "./pages/rem/RemDashboard";
import { MorningSnapshot } from "./pages/rem/MorningSnapshot";
import { KanbanBoard } from "./pages/rem/KanbanBoard";
import { GanttTimeline } from "./pages/rem/GanttTimeline";
import { EngineerKiosk } from "./pages/rem/EngineerKiosk";
import { Analyzers } from "./pages/rem/Analyzers";
import { LvccTracker } from "./pages/rem/LvccTracker";
import { ProductionPlan } from "./pages/rem/ProductionPlan";
import { FieldStatus } from "./pages/rem/FieldStatus";
import { StaffTraining } from "./pages/rem/StaffTraining";
import { WeeklyNotes } from "./pages/rem/WeeklyNotes";
import { BulkImport } from "./pages/rem/BulkImport";
import { ExecutiveReport } from "./pages/reports/ExecutiveReport";
import { MobileQuickView } from "./pages/reports/MobileQuickView";
import { ReportPreview } from "./pages/reports/ReportPreview";
import { UploadRefresh } from "./pages/reports/UploadRefresh";
import { InventoryReports } from "./pages/reports/InventoryReports";
import { RemReports } from "./pages/rem/RemReports";
import { AiAdministration } from "./pages/AiAdministration";
import { Settings } from "./pages/Settings";
import { EConnectivity } from "./pages/EConnectivity";
import { useRole } from "./hooks/useRole";
import { useConfig } from "./hooks/useConfig";
import { getRoleDefaultRoute, isRouteAccessibleByRole, type RoleName } from "./lib/dashboardRoutes";
import { Toaster } from "./components/ui/sonner";

/**
 * Guarded route: renders children only if the role has access.
 * Falls back to the role's default dashboard.
 */
function RoleGuard({ route, role, fallback, children }: {
  route: string;
  role: RoleName;
  fallback: string;
  children: React.ReactNode;
}) {
  if (!isRouteAccessibleByRole(route, role)) {
    return <Navigate to={fallback} replace />;
  }
  return <>{children}</>;
}

function App() {
  const { role } = useRole();
  const { publishedValues } = useConfig();

  if (!role) {
    return (
      <>
        <Toaster />
        <Routes>
          <Route path="*" element={<RoleLogin />} />
        </Routes>
      </>
    );
  }

  const typedRole = role as RoleName;
  const roleDefaultRoute = getRoleDefaultRoute(typedRole, publishedValues);

  return (
    <>
      <Toaster />
      <Routes>
        <Route element={<VitrosLayout />}>
          {/* Inventory Routes */}
          <Route path="/dashboard" element={
            <RoleGuard route="/dashboard" role={typedRole} fallback={roleDefaultRoute}>
              <ExecutiveDashboard />
            </RoleGuard>
          } />
          <Route path="/engineer-dashboard" element={<EngineerDashboard />} />
          <Route path="/enterprise-dashboard" element={
            <RoleGuard route="/enterprise-dashboard" role={typedRole} fallback={roleDefaultRoute}>
              <Navigate to="/dashboard" replace />
            </RoleGuard>
          } />
          <Route path="/scan-kiosk" element={
            <RoleGuard route="/scan-kiosk" role={typedRole} fallback={roleDefaultRoute}>
              <ScanKiosk />
            </RoleGuard>
          } />
          <Route path="/user-dashboard" element={<UserDashboard />} />
          <Route path="/stock-summary" element={<StockSummary />} />
          <Route path="/incoming-stock" element={
            <RoleGuard route="/incoming-stock" role={typedRole} fallback={roleDefaultRoute}>
              <IncomingStockDocument />
            </RoleGuard>
          } />
          <Route path="/reorder-stockout" element={
            <RoleGuard route="/reorder-stockout" role={typedRole} fallback={roleDefaultRoute}>
              <ReorderStockout />
            </RoleGuard>
          } />
          <Route path="/transaction-search" element={<TransactionSearch />} />
          <Route path="/aged-inventory" element={<AgedInventory />} />
          <Route path="/wip-cycle-time" element={<WipCycleTime />} />
          <Route path="/inventory-turnover" element={<InventoryTurnover />} />
          <Route path="/inventory-accuracy" element={<InventoryAccuracy />} />
          <Route path="/analyzer-analysis" element={<AnalyzerAnalysis />} />
          <Route path="/abc-analysis" element={<AbcAnalysis />} />
          <Route path="/kit-analysis" element={<KitAnalysis />} />
          <Route path="/sap-staging" element={
            <RoleGuard route="/sap-staging" role={typedRole} fallback={roleDefaultRoute}>
              <SapStaging />
            </RoleGuard>
          } />
          <Route path="/sap-analytics" element={
            <RoleGuard route="/sap-analytics" role={typedRole} fallback={roleDefaultRoute}>
              <SapAnalytics />
            </RoleGuard>
          } />
          <Route path="/cycle-count" element={
            <RoleGuard route="/cycle-count" role={typedRole} fallback={roleDefaultRoute}>
              <CycleCount />
            </RoleGuard>
          } />
          <Route path="/dhr-scanner" element={
            <RoleGuard route="/dhr-scanner" role={typedRole} fallback={roleDefaultRoute}>
              <DhrScanner />
            </RoleGuard>
          } />
          <Route path="/health-heatmap" element={<HealthHeatmap />} />
          <Route path="/e-connectivity" element={<EConnectivity />} />
          {/* REM Routes */}
          <Route path="/rem/morning-snapshot" element={<MorningSnapshot />} />
          <Route path="/rem/dashboard" element={<RemDashboard />} />
          <Route path="/rem/kanban" element={
            <RoleGuard route="/rem/kanban" role={typedRole} fallback={roleDefaultRoute}>
              <KanbanBoard />
            </RoleGuard>
          } />
          <Route path="/rem/gantt" element={
            <RoleGuard route="/rem/gantt" role={typedRole} fallback={roleDefaultRoute}>
              <GanttTimeline />
            </RoleGuard>
          } />
          <Route path="/rem/kiosk" element={
            <RoleGuard route="/rem/kiosk" role={typedRole} fallback={roleDefaultRoute}>
              <EngineerKiosk />
            </RoleGuard>
          } />
          <Route path="/rem/analyzers" element={<Analyzers />} />
          <Route path="/rem/lvcc" element={<LvccTracker />} />
          <Route path="/rem/production-plan" element={<ProductionPlan />} />
          <Route path="/rem/field-status" element={<FieldStatus />} />
          <Route path="/rem/staff" element={
            <RoleGuard route="/rem/staff" role={typedRole} fallback={roleDefaultRoute}>
              <StaffTraining />
            </RoleGuard>
          } />
          <Route path="/rem/notes" element={
            <RoleGuard route="/rem/notes" role={typedRole} fallback={roleDefaultRoute}>
              <WeeklyNotes />
            </RoleGuard>
          } />
          <Route path="/rem/reports" element={<RemReports />} />
          <Route path="/rem/reports-v2" element={<Navigate to="/rem/reports" replace />} />
          <Route path="/rem/import" element={
            <RoleGuard route="/rem/import" role={typedRole} fallback={roleDefaultRoute}>
              <BulkImport />
            </RoleGuard>
          } />
          {/* Report Routes */}
          <Route path="/executive-report" element={<ExecutiveReport />} />
          <Route path="/mobile-quick-view" element={<MobileQuickView />} />
          <Route path="/report-preview" element={<ReportPreview />} />
          <Route path="/upload-refresh" element={<UploadRefresh />} />
          <Route path="/inventory-reports" element={<InventoryReports />} />
          <Route path="/ai-administration" element={<RoleGuard route="/ai-administration" role={typedRole} fallback={roleDefaultRoute}><AiAdministration /></RoleGuard>} />
          {/* Settings */}
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="/" element={<Navigate to={roleDefaultRoute} replace />} />
        <Route path="*" element={<Navigate to={roleDefaultRoute} replace />} />
      </Routes>
    </>
  );
}

export default App;
