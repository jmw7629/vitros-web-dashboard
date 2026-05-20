import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, DashCard, StatusBadge, theme } from "../../components/vitros/SharedComponents";

export function StaffTraining() {
  const data = useConvexData();
  const activeEmps = data.employees.filter(e => e.active);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>👥 Staff & Training</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Certification and resource planning</p>
      </div>

      <DashCard label="ACTIVE STAFF" value={activeEmps.length} icon="👥" color="#6366f1" />

      <WebCard className="overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Team Members</h3>
        </div>
        <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
          {activeEmps.map(emp => (
            <div key={emp._id} className="flex items-center gap-3 px-4 py-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white"
                style={{ backgroundColor: "#6366f1" }}>
                {emp.initials}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>{emp.name}</div>
                <div className="text-[10px]" style={{ color: theme.textMuted }}>{emp.initials}</div>
              </div>
              <StatusBadge text="Active" color={theme.statusOk} />
            </div>
          ))}
        </div>
      </WebCard>
    </div>
  );
}
