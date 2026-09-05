import { useMemo } from "react";
import { DashCard, WebCard, theme } from "../../components/vitros/SharedComponents";
import { useRemPlanningData } from "../../hooks/useRemPlanningData";

const PRODUCT_LABELS: Record<string, string> = {
  VITROS: "VITROS",
  VISION: "VISION",
  LVCC_ELECTROMETER: "LVCC Electrometer",
  LVCC_IR_WASH: "LVCC IR Wash",
};

const fmt = (value: number | undefined) => value === undefined ? "—" : value.toLocaleString();

export function ProductionPlan() {
  const { trackerWeekly, buildPlan, targets, isLoading, error } = useRemPlanningData();

  const year = useMemo(() => {
    const years = [...targets.map((row) => row.year), ...trackerWeekly.map((row) => row.year), ...buildPlan.map((row) => row.year)]
      .filter((value) => Number.isFinite(value) && value > 0);
    return years.length > 0 ? Math.max(...years) : new Date().getFullYear();
  }, [buildPlan, targets, trackerWeekly]);

  const annualTargets = useMemo(() => targets.filter((row) => row.year === year), [targets, year]);
  const trackerForYear = useMemo(() => trackerWeekly.filter((row) => row.year === year), [trackerWeekly, year]);
  const buildForYear = useMemo(() => buildPlan.filter((row) => row.year === year), [buildPlan, year]);

  const latestReportedWeek = useMemo(() => {
    const actualWeeks = trackerForYear.filter((row) => row.actual !== undefined).map((row) => row.weekNumber);
    if (actualWeeks.length > 0) return Math.max(...actualWeeks);
    const weeks = buildForYear.map((row) => row.weekNumber);
    return weeks.length > 0 ? Math.min(Math.max(...weeks), 53) : 0;
  }, [buildForYear, trackerForYear]);

  const currentBuild = useMemo(() => {
    if (buildForYear.length === 0) return undefined;
    const exact = buildForYear.find((row) => row.weekNumber === latestReportedWeek);
    if (exact) return exact;
    const prior = buildForYear.filter((row) => row.weekNumber <= latestReportedWeek).at(-1);
    return prior ?? buildForYear[0];
  }, [buildForYear, latestReportedWeek]);

  const productSummaries = useMemo(() => {
    const products = ["VITROS", "VISION", "LVCC_ELECTROMETER", "LVCC_IR_WASH"];
    return products.map((product) => {
      const target = annualTargets.find((row) => row.product === product || row.targetType === `${product}_ANNUAL_PLAN`);
      const rows = trackerForYear.filter((row) => row.product === product);
      const plan = target?.targetValue ?? rows.reduce((sum, row) => sum + row.plan, 0);
      const actual = target?.actualValue ?? rows.reduce((sum, row) => sum + (row.actual ?? 0), 0);
      return {
        product,
        label: PRODUCT_LABELS[product] ?? product,
        plan,
        actual,
        attainment: plan > 0 ? Math.round((actual / plan) * 1000) / 10 : 0,
      };
    }).filter((row) => row.plan > 0 || row.actual > 0);
  }, [annualTargets, trackerForYear]);

  const vitros = productSummaries.find((row) => row.product === "VITROS");
  const recentVitros = trackerForYear
    .filter((row) => row.product === "VITROS")
    .sort((a, b) => b.weekNumber - a.weekNumber)
    .slice(0, 8)
    .reverse();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>📈 Production Plan</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>
          Authoritative {year} plan, actuals, forecast, and capacity from the REM workbook
        </p>
      </div>

      {error && (
        <WebCard className="p-4" role="alert">
          <div className="text-sm font-bold" style={{ color: theme.statusCritical }}>Planning data unavailable</div>
          <div className="text-xs mt-1" style={{ color: theme.textSecondary }}>{error}</div>
        </WebCard>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <DashCard label="VITROS PLAN" value={isLoading ? "…" : fmt(vitros?.plan)} icon="🎯" color="#6366f1" />
        <DashCard label="VITROS ACTUAL" value={isLoading ? "…" : fmt(vitros?.actual)} icon="✅" color={theme.statusOk} />
        <DashCard label="ATTAINMENT" value={isLoading ? "…" : vitros ? `${vitros.attainment}%` : "—"} icon="📊" color="#f59e0b" />
        <DashCard label="REPORTING WEEK" value={isLoading ? "…" : latestReportedWeek || "—"} icon="🗓️" color="#22d3ee" />
      </div>

      {productSummaries.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {productSummaries.map((row) => (
            <WebCard key={row.product} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>{row.label}</div>
                  <div className="text-[10px] mt-0.5" style={{ color: theme.textMuted }}>Annual plan vs. actual</div>
                </div>
                <div className="text-lg font-black" style={{ color: row.attainment >= 100 ? theme.statusOk : "#f59e0b" }}>
                  {row.attainment}%
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="rounded-xl p-3" style={{ backgroundColor: `${theme.accentBlue}12` }}>
                  <div className="text-[10px] uppercase font-bold" style={{ color: theme.textMuted }}>Plan</div>
                  <div className="text-lg font-black" style={{ color: theme.textPrimary }}>{fmt(row.plan)}</div>
                </div>
                <div className="rounded-xl p-3" style={{ backgroundColor: `${theme.statusOk}12` }}>
                  <div className="text-[10px] uppercase font-bold" style={{ color: theme.textMuted }}>Actual</div>
                  <div className="text-lg font-black" style={{ color: theme.textPrimary }}>{fmt(row.actual)}</div>
                </div>
              </div>
            </WebCard>
          ))}
        </div>
      )}

      {currentBuild && (
        <WebCard className="p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Week {currentBuild.weekNumber} Capacity</h3>
              <p className="text-[10px] mt-0.5" style={{ color: theme.textMuted }}>{currentBuild.weekStart || currentBuild.quarter}</p>
            </div>
            <span className="text-xs font-bold" style={{ color: theme.accentBlue }}>
              {fmt(currentBuild.delivery.total)} planned deliveries
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded-xl p-3" style={{ backgroundColor: theme.cardBg }}>
              <div className="text-[10px]" style={{ color: theme.textMuted }}>Head Count</div>
              <div className="text-lg font-black" style={{ color: theme.textPrimary }}>{fmt(currentBuild.capacity.headCount)}</div>
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: theme.cardBg }}>
              <div className="text-[10px]" style={{ color: theme.textMuted }}>In Training</div>
              <div className="text-lg font-black" style={{ color: theme.textPrimary }}>{fmt(currentBuild.capacity.inTraining)}</div>
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: theme.cardBg }}>
              <div className="text-[10px]" style={{ color: theme.textMuted }}>Capacity</div>
              <div className="text-lg font-black" style={{ color: theme.textPrimary }}>{fmt(currentBuild.capacity.capacity)}</div>
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: theme.cardBg }}>
              <div className="text-[10px]" style={{ color: theme.textMuted }}>Capacity Delta</div>
              <div className="text-lg font-black" style={{ color: (currentBuild.capacity.delta ?? 0) >= 0 ? theme.statusOk : theme.statusCritical }}>
                {fmt(currentBuild.capacity.delta)}
              </div>
            </div>
          </div>
        </WebCard>
      )}

      <WebCard className="overflow-hidden">
        <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Recent VITROS Weekly Plan</h3>
        </div>
        {recentVitros.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm" style={{ color: theme.textMuted }}>
            {isLoading ? "Loading authoritative planning data…" : "No authoritative Tracker rows have been imported yet."}
          </div>
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Recent VITROS weekly production plan" tabIndex={0}>
            <div className="min-w-[680px]">
              <div className="grid grid-cols-[70px_100px_1fr_1fr_1fr_1fr] px-4 py-2 text-[10px] font-bold uppercase border-b" style={{ color: theme.textMuted, borderColor: theme.cardBorder }}>
                <span>Week</span><span>Date</span><span className="text-right">Plan</span><span className="text-right">Actual</span><span className="text-right">Forecast</span><span className="text-right">Variance</span>
              </div>
              {recentVitros.map((row) => {
                const variance = row.actual === undefined ? undefined : row.actual - row.plan;
                return (
                  <div key={row._id} className="grid grid-cols-[70px_100px_1fr_1fr_1fr_1fr] px-4 py-2.5 border-b last:border-b-0 text-sm" style={{ borderColor: theme.cardBorder, color: theme.textPrimary }}>
                    <span className="font-bold">W{row.weekNumber}</span>
                    <span className="text-xs" style={{ color: theme.textSecondary }}>{row.weekStart || "—"}</span>
                    <span className="text-right">{fmt(row.plan)}</span>
                    <span className="text-right">{fmt(row.actual)}</span>
                    <span className="text-right">{fmt(row.weeklyForecast)}</span>
                    <span className="text-right font-bold" style={{ color: variance === undefined ? theme.textMuted : variance >= 0 ? theme.statusOk : theme.statusCritical }}>
                      {variance === undefined ? "—" : `${variance >= 0 ? "+" : ""}${variance}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </WebCard>
    </div>
  );
}
