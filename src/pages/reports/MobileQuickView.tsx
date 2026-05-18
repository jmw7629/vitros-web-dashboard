import { useConvexData } from "../../hooks/useConvexData";
import { useNavigate } from "react-router-dom";
import { DashCard, theme } from "../../components/vitros/SharedComponents";

export function MobileQuickView() {
  const data = useConvexData();
  const navigate = useNavigate();
  const ok = data.parts.filter(p => p.status === "OK").length;
  const low = data.parts.filter(p => p.status === "LOW").length;
  const out = data.parts.filter(p => p.status === "OUT").length;
  const over = data.parts.filter(p => p.status === "OVER").length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📱 Quick View</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>10-second health check</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <DashCard label="STOCK-OUTS" value={out} icon="🚨" color={theme.statusOut} onClick={() => navigate("/reorder-stockout")} />
        <DashCard label="WARNINGS" value={low} icon="⚡" color="#f59e0b" onClick={() => navigate("/reorder-stockout")} />
        <DashCard label="HEALTHY" value={ok} icon="💚" color={theme.statusOk} onClick={() => navigate("/stock-summary")} />
        <DashCard label="OVERSTOCKED" value={over} icon="📈" color={theme.statusOver} onClick={() => navigate("/stock-summary")} />
      </div>
    </div>
  );
}
