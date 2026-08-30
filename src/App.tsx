import { Route, Routes, Navigate } from "react-router-dom";
import { useConvexAuth } from "convex/react";
import { VitrosLayout } from "./components/VitrosLayout";
import { RoleLogin } from "./pages/RoleLogin";
import { SignIn } from "./components/SignIn";
import { SignUp } from "./components/SignUp";
import { ExecutiveDashboard } from "./pages/inventory/ExecutiveDashboard";
import { StockSummary } from "./pages/inventory/StockSummary";
import { ScanKiosk } from "./pages/inventory/ScanKiosk";
import { UserDashboard } from "./pages/inventory/UserDashboard";
import { IncomingStock } from "./pages/inventory/IncomingStock";
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
import { Reports } from "./pages/rem/Reports";
import { BulkImport } from "./pages/rem/BulkImport";
import { ExecutiveReport } from "./pages/reports/ExecutiveReport";
import { MobileQuickView } from "./pages/reports/MobileQuickView";
import { ReportPreview } from "./pages/reports/ReportPreview";
import { UploadRefresh } from "./pages/reports/UploadRefresh";
import { Settings } from "./pages/Settings";
import { EConnectivity } from "./pages/EConnectivity";
import { useRole } from "./hooks/useRole";
import { Toaster } from "./components/ui/sonner";

function AuthenticatedApp() {
  return (
    <>
      <Toaster />
      <Routes>
        <Route element={<VitrosLayout />}>
          {/* Inventory Routes */}
          <Route path="/dashboard" element={<ExecutiveDashboard />} />
          <Route path="/scan-kiosk" element={<ScanKiosk />} />
          <Route path="/user-dashboard" element={<UserDashboard />} />
          <Route path="/stock-summary" element={<StockSummary />} />
          <Route path="/incoming-stock" element={<IncomingStock />} />
          <Route path="/reorder-stockout" element={<ReorderStockout />} />
          <Route path="/transaction-search" element={<TransactionSearch />} />
          <Route path="/aged-inventory" element={<AgedInventory />} />
          <Route path="/wip-cycle-time" element={<WipCycleTime />} />
          <Route path="/inventory-turnover" element={<InventoryTurnover />} />
          <Route path="/inventory-accuracy" element={<InventoryAccuracy />} />
          <Route path="/analyzer-analysis" element={<AnalyzerAnalysis />} />
          <Route path="/abc-analysis" element={<AbcAnalysis />} />
          <Route path="/kit-analysis" element={<KitAnalysis />} />
          <Route path="/sap-staging" element={<SapStaging />} />
          <Route path="/sap-analytics" element={<SapAnalytics />} />
          <Route path="/cycle-count" element={<CycleCount />} />
          <Route path="/dhr-scanner" element={<DhrScanner />} />
          <Route path="/health-heatmap" element={<HealthHeatmap />} />
          <Route path="/e-connectivity" element={<EConnectivity />} />
          {/* REM Routes */}
          <Route path="/rem/morning-snapshot" element={<MorningSnapshot />} />
          <Route path="/rem/dashboard" element={<RemDashboard />} />
          <Route path="/rem/kanban" element={<KanbanBoard />} />
          <Route path="/rem/gantt" element={<GanttTimeline />} />
          <Route path="/rem/kiosk" element={<EngineerKiosk />} />
          <Route path="/rem/analyzers" element={<Analyzers />} />
          <Route path="/rem/lvcc" element={<LvccTracker />} />
          <Route path="/rem/production-plan" element={<ProductionPlan />} />
          <Route path="/rem/field-status" element={<FieldStatus />} />
          <Route path="/rem/staff" element={<StaffTraining />} />
          <Route path="/rem/notes" element={<WeeklyNotes />} />
          <Route path="/rem/reports" element={<Reports />} />
          <Route path="/rem/import" element={<BulkImport />} />
          {/* Report Routes */}
          <Route path="/executive-report" element={<ExecutiveReport />} />
          <Route path="/mobile-quick-view" element={<MobileQuickView />} />
          <Route path="/report-preview" element={<ReportPreview />} />
          <Route path="/upload-refresh" element={<UploadRefresh />} />
          {/* Settings */}
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}

function UnauthenticatedApp() {
  return (
    <>
      <Toaster />
      <Routes>
        <Route path="/login" element={<div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-6">
            <div className="text-center mb-6">
              <h1 className="text-3xl font-bold text-white">VITROS Inventory</h1>
              <p className="text-blue-300 mt-1">Management System</p>
            </div>
            <SignIn />
          </div>
        </div>} />
        <Route path="/signup" element={<div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
          <div className="w-full max-w-md space-y-6">
            <div className="text-center mb-6">
              <h1 className="text-3xl font-bold text-white">VITROS Inventory</h1>
              <p className="text-blue-300 mt-1">Create Account</p>
            </div>
            <SignUp />
          </div>
        </div>} />
        <Route path="/role-select" element={<RoleLogin />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </>
  );
}

function App() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { role } = useRole();

  // Show loading while Convex auth state is resolving
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center">
        <div className="text-white text-lg">Loading...</div>
      </div>
    );
  }

  // Server-authoritative: Convex Auth determines access
  if (!isAuthenticated) {
    return <UnauthenticatedApp />;
  }

  // Authenticated users may also need the legacy role for UI compatibility
  if (!role) {
    return (
      <>
        <Toaster />
        <RoleLogin />
      </>
    );
  }

  return <AuthenticatedApp />;
}

export default App;
