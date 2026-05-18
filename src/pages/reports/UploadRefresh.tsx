import { useState } from "react";
import { WebCard, theme } from "../../components/vitros/SharedComponents";
import { Upload, RefreshCw, FileSpreadsheet } from "lucide-react";

export function UploadRefresh() {
  const [uploading, setUploading] = useState(false);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📤 Upload / Refresh</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Bulk data import and refresh</p>
      </div>

      <WebCard className="p-6 text-center">
        <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ backgroundColor: "#6366f122" }}>
          <Upload className="w-8 h-8" style={{ color: "#6366f1" }} />
        </div>
        <h3 className="text-base font-bold mb-1" style={{ color: theme.textPrimary }}>Upload Spreadsheet</h3>
        <p className="text-sm mb-4" style={{ color: theme.textSecondary }}>Drag and drop a CSV or Excel file to refresh inventory data</p>
        <button className="px-6 py-2.5 rounded-xl text-sm font-bold text-white" style={{ backgroundColor: "#6366f1" }}>
          Choose File
        </button>
      </WebCard>

      <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Supported Formats</h3>
        {[
          { icon: "📊", label: "Excel (.xlsx)", desc: "Full inventory spreadsheet" },
          { icon: "📄", label: "CSV (.csv)", desc: "Comma-separated values" },
          { icon: "📋", label: "Delivery Manifest", desc: "Warehouse delivery format" },
        ].map(f => (
          <div key={f.label} className="flex items-center gap-3 py-2 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
            <span className="text-lg">{f.icon}</span>
            <div>
              <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>{f.label}</div>
              <div className="text-[10px]" style={{ color: theme.textMuted }}>{f.desc}</div>
            </div>
          </div>
        ))}
      </WebCard>
    </div>
  );
}
