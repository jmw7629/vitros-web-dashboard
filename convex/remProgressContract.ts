export type RemKind = 'analyzer' | 'lvcc';
export const REM_STAGES = [
  { key: 'procurementPct', column: 'procurement_pct', label: 'Procurement' },
  { key: 'cleaningPct', column: 'cleaning_pct', label: 'Cleaning' },
  { key: 'servicePct', column: 'service_pct', label: 'Service' },
  { key: 'finalLinePct', column: 'final_line_pct', label: 'Final Line' },
  { key: 'packagingPct', column: 'packaging_pct', label: 'Packaging' },
  { key: 'releaseTestingPct', column: 'release_testing_pct', label: 'Release Testing' },
  { key: 'qaReleasePct', column: 'qa_release_pct', label: 'QA Release' },
  { key: 'sapReleasePct', column: 'sap_release_pct', label: 'SAP Release' },
];
export const LVCC_STAGES = [
  { key: 'buildPct', column: 'build_pct', label: 'Build' },
  { key: 'testPct', column: 'test_pct', label: 'Test' },
  { key: 'packagingPct', column: 'packaging_pct', label: 'Packaging' },
  { key: 'qaReleasePct', column: 'qa_release_pct', label: 'QA Release' },
  { key: 'sapReleasePct', column: 'sap_release_pct', label: 'SAP Release' },
];
export const LVCC_TYPES = ['Electrometer', 'IR Wash — Pump', 'IR Wash — Module', 'IR Wash'] as const;
export const progressStages = (kind: RemKind) => kind === 'analyzer' ? REM_STAGES : LVCC_STAGES;
export function validateProgress(kind: RemKind, progress: Record<string, number | null>, stage: string) {
  const stages = progressStages(kind);
  if (Object.keys(progress).length !== stages.length || Object.keys(progress).some(k => !stages.some(s => s.key === k))) throw new Error('Every stage percentage must be included');
  for (const {key} of stages) {
    const n = progress[key];
    if (n !== null && (!Number.isInteger(n) || n < 0 || n > 100)) throw new Error('Percentages must be whole numbers from 0 to 100');
  }
  if (stage === 'Complete' && stages.some(s => progress[s.key] !== 100)) throw new Error('Complete requires every stage at 100%');
}
export function recordSnapshot(kind: RemKind, row: Record<string, unknown>) {
  return { id: String(row.id), serialNumber: String(row.serial_number ?? ''), itemType: String(row.analyzer_type ?? row.item_type ?? ''), currentStage: String(row.current_stage ?? ''), revision: Number(row.progress_revision), notes: String(row.operator_notes ?? ''), updatedAt: row.progress_updated_at == null ? null : String(row.progress_updated_at), engineerName: row.progress_engineer_name == null ? null : String(row.progress_engineer_name), progress: Object.fromEntries(progressStages(kind).map(s => [s.key, row[s.column] == null ? null : Number(row[s.column])])) };
}
/** Preserve legacy aliases and unknown stages visibly instead of dropping their cards. */
export function boardStage(stage: string | undefined, complete: boolean, kind: RemKind) {
  if (complete || stage === 'Complete') return 'Complete';
  if (kind === 'lvcc') return ({Pack:'Packaging',QA:'QA Release',SAP:'SAP Release',Tested:'Test',Built:'Build'} as Record<string,string>)[stage ?? ''] ?? stage ?? 'Unassigned';
  return stage || 'Unassigned';
}
