import { WebCard, DashCard, theme } from "../../components/vitros/SharedComponents";
import { useConvexData } from "../../hooks/useConvexData";
import { Upload } from "lucide-react";

export function BulkImport() {
  const data = useConvexData();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📥 REM Bulk Import</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Import analyzer data from spreadsheets</p>
      </div>

      <WebCard className="p-6 text-center">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: "#6366f122" }}>
          <Upload className="w-8 h-8" style={{ color: "#6366f1" }} />
        </div>
        <h3 className="text-base font-bold mb-1" style={{ color: theme.textPrimary }}>Upload REM Data</h3>
        <p className="text-sm mb-4" style={{ color: theme.textSecondary }}>
          Upload WIP spreadsheets, production orders, or field status data
        </p>
        <button className="px-6 py-2.5 rounded-xl text-sm font-bold text-white" style={{ backgroundColor: "#6366f1" }}>
          Choose File
        </button>
      </WebCard>

      <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Current Data</h3>
        {[
          ["Analyzers", data.analyzers.length],
          ["LVCC Items", data.lvccItems.length],
          ["Employees", data.employees.length],
        ].map(([k, v]) => (
          <div key={String(k)} className="flex justify-between py-1.5 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
            <span className="text-xs" style={{ color: theme.textSecondary }}>{k}</span>
            <span className="text-xs font-bold" style={{ color: theme.textPrimary }}>{v}</span>
          </div>
        ))}
      </WebCard>
    </div>
  );
}
