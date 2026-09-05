import { useMemo } from "react";
import { DashCard, StatusBadge, WebCard, theme } from "../../components/vitros/SharedComponents";
import { useRemPlanningData } from "../../hooks/useRemPlanningData";

const initials = (name: string) => name
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toUpperCase() ?? "")
  .join("");

export function StaffTraining() {
  const { staff, isLoading, error } = useRemPlanningData();

  const summary = useMemo(() => {
    const totalFte = staff.reduce((sum, row) => sum + (row.fte ?? 0), 0);
    const inTraining = staff.filter((row) => Boolean(row.trainingUntil || row.completeAfter)).length;
    const qualified = staff.filter((row) => row.skills.length > 0 || row.certifications.length > 0).length;
    return { totalFte, inTraining, qualified };
  }, [staff]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>👥 Staff & Training</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>
          Authoritative REM staffing, capacity, skills, and training plan
        </p>
      </div>

      {error && (
        <WebCard className="p-4" role="alert">
          <div className="text-sm font-bold" style={{ color: theme.statusCritical }}>Staffing data unavailable</div>
          <div className="text-xs mt-1" style={{ color: theme.textSecondary }}>{error}</div>
        </WebCard>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <DashCard label="PLANNED STAFF" value={isLoading ? "…" : staff.length} icon="👥" color="#6366f1" />
        <DashCard label="TOTAL FTE" value={isLoading ? "…" : Math.round(summary.totalFte * 100) / 100} icon="⚙️" color="#22d3ee" />
        <DashCard label="IN TRAINING" value={isLoading ? "…" : summary.inTraining} icon="🎓" color="#f59e0b" />
        <DashCard label="SKILL DATA" value={isLoading ? "…" : summary.qualified} icon="✅" color={theme.statusOk} />
      </div>

      <WebCard className="overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderColor: theme.cardBorder }}>
          <div>
            <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Team Members</h3>
            <p className="text-[10px] mt-0.5" style={{ color: theme.textMuted }}>Sourced from the recurring REM production workbook</p>
          </div>
          <span className="text-[10px]" style={{ color: theme.textMuted }}>{staff.length} records</span>
        </div>

        {staff.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm" style={{ color: theme.textMuted }}>
            {isLoading ? "Loading authoritative staffing data…" : "No authoritative Staff rows have been imported yet."}
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
            {staff.map((member) => {
              const training = Boolean(member.trainingUntil || member.completeAfter);
              const visibleSkills = member.skills.slice(0, 5);
              return (
                <div key={member._id} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full flex shrink-0 items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: "#6366f1" }} aria-hidden="true">
                      {initials(member.name) || "REM"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>{member.name}</div>
                        <StatusBadge text={training ? "Training" : "Active"} color={training ? "#f59e0b" : theme.statusOk} />
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-[10px]" style={{ color: theme.textMuted }}>
                        {member.role && <span>{member.role}</span>}
                        {member.fte !== undefined && <span>{member.fte} FTE</span>}
                        {member.started && <span>Started {member.started}</span>}
                        {member.trainingUntil && <span>Training until {member.trainingUntil}</span>}
                        {!member.trainingUntil && member.completeAfter && <span>Complete after {member.completeAfter}</span>}
                      </div>

                      {visibleSkills.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2" aria-label={`${member.name} skills`}>
                          {visibleSkills.map((skill) => (
                            <span key={`${member._id}-${skill.name}`} className="px-2 py-1 rounded-lg text-[9px] font-bold" title={`${skill.name}: ${skill.value}`} style={{ backgroundColor: `${theme.accentBlue}14`, color: theme.accentBlue }}>
                              {skill.name}: {skill.value}
                            </span>
                          ))}
                          {member.skills.length > visibleSkills.length && (
                            <span className="px-2 py-1 rounded-lg text-[9px]" style={{ color: theme.textMuted }}>
                              +{member.skills.length - visibleSkills.length} more
                            </span>
                          )}
                        </div>
                      )}

                      {member.comment && (
                        <p className="text-[10px] mt-2 leading-relaxed" style={{ color: theme.textSecondary }}>{member.comment}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </WebCard>
    </div>
  );
}
