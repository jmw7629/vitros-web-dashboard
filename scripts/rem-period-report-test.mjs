import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const cache = new Map();
function load(name) {
  if (cache.has(name)) return cache.get(name).exports;
  const filename = new URL(`../src/lib/${name}.ts`, import.meta.url);
  const module = { exports: {} }; cache.set(name, module);
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: dependency => {
    assert.equal(dependency, './periodHelper', 'Only the actual reporting helper dependency is expected');
    return load('periodHelper');
  }, Date, Map, Set, Intl, console }, { filename: filename.pathname });
  return module.exports;
}
const period = load('periodHelper'), report = load('remReportData');
const range = (type, date) => period.createPeriodRange(type, new Date(date));
const row = (weekNumber, quarter = 'Q3', actual = 0, product = 'VITROS', year = 2026) => ({
  _id: `${year}-${weekNumber}-${product}`, year, product, quarter, weekNumber, plan: 10,
  actual, weeklyForecast: 8, accumulatedForecast: weekNumber * 8,
});
const select = (rows, p) => report.computeRemPlanningPeriod(rows, [], [], p);
const plain = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }

test('Weekly selection uses the ISO week and explicit plan year', () => {
  const result = select([row(37), row(38), row(38, 'Q3', 0, 'VISION', 2025)], range('weekly', '2026-09-15T12:00:00'));
  assert.deepEqual(plain(result.trackerRows.map(r => r._id)), ['2026-38-VITROS']);
});
test('January 1 selects the preceding ISO year when applicable', () => {
  const result = select([row(53, 'Q4'), row(1, 'Q1', 0, 'VITROS', 2027)], range('weekly', '2027-01-01T12:00:00'));
  assert.deepEqual(plain(result.trackerRows.map(r => r.weekNumber)), [53]);
});
test('September includes only whole weeks whose Thursday is in September', () => {
  const result = select([35, 36, 37, 38, 39, 40].map(w => row(w)), range('monthly', '2026-09-15T12:00:00'));
  assert.deepEqual(plain(result.trackerRows.map(r => r.weekNumber)), [36, 37, 38, 39]);
});
test('Quarter selection honors a week 14 source Q1 rather than inferring Q2', () => {
  const result = select([row(14, 'Q1'), row(13, 'Q2')], range('quarterly', '2026-02-01T12:00:00'));
  assert.deepEqual(plain(result.trackerRows.map(r => r.weekNumber)), [14]);
});
test('Q4 includes source week 53 and excludes a different plan year', () => {
  const result = select([row(53, 'Q4'), row(53, 'Q4', 0, 'VISION', 2025)], range('quarterly', '2026-12-01T12:00:00'));
  assert.equal(result.trackerRows.length, 1); assert.equal(result.trackerRows[0].year, 2026);
});
test('Annual selection includes all 53 weeks exactly once for each product', () => {
  const rows = Array.from({ length: 53 }, (_, i) => row(i + 1));
  const result = select([...rows, row(1, 'Q1', 0, 'VISION', 2025)], range('annual', '2026-05-01T12:00:00'));
  assert.equal(result.trackerRows.length, 53); assert.equal(result.trackerRows.reduce((s, r) => s + r.plan, 0), 530);
});
test('Build plan uses its source quarter as well', () => {
  const build = { _id: 'build', year: 2026, quarter: 'Q1', weekNumber: 14, delivery: {}, capacity: {}, actuals: {} };
  const result = report.computeRemPlanningPeriod([], [build], [], range('quarterly', '2026-01-01T12:00:00'));
  assert.equal(result.buildPlanRows.length, 1);
});
test('Analyzer import timestamps are not substituted for missing start dates', () => {
  const p = range('monthly', '2026-09-15T12:00:00');
  const activity = report.computeRemPeriodActivity([{ _id: 'unknown', createdAt: p.start.getTime() }, { _id: 'known', startDate: '2026-09-02' }, { _id: 'outside', startDate: '2026-08-31' }], [], p);
  assert.equal(activity.analyzerUnknownDates, 1); assert.deepEqual(plain(activity.analyzers.map(r => r._id)), ['known']);
});
test('LVCC uses recorded end/start dates and counts unavailable dates separately', () => {
  const activity = report.computeRemPeriodActivity([], [{ _id: 'ended', startDate: '2026-08-01', endDate: '2026-09-03' }, { _id: 'started', startDate: '2026-09-01' }, { _id: 'unknown' }], range('monthly', '2026-09-15T12:00:00'));
  assert.equal(activity.lvccUnknownDates, 1); assert.equal(activity.lvccItems.length, 2);
});
test('Current analyzer snapshot does not change with selected reporting dates', () => {
  const result = report.computeRemReport([{ isComplete: true }, { isComplete: false }], [], [], [], [], range('annual', '2024-01-01T12:00:00'));
  assert.deepEqual(plain(result.snapshot), { total: 2, active: 1, completed: 1 });
  assert.equal(result.periodActivity.analyzers.length, 0);
});
test('Recorded zero and missing actual remain distinguishable in exports', () => {
  const missing = row(39); delete missing.actual;
  const exported = report.buildTrackerExportRows([row(38), missing], range('monthly', '2026-09-15T12:00:00'));
  assert.equal(exported[0].recordedActual, '0'); assert.equal(exported[0].missingActuals, 'no');
  assert.equal(exported[1].recordedActual, ''); assert.equal(exported[1].missingActuals, 'yes');
});
test('Cumulative forecasts are retained per row, not summed into a false forecast', () => {
  const exported = report.buildTrackerExportRows([row(38), row(39)], range('monthly', '2026-09-15T12:00:00'));
  assert.deepEqual(plain(exported.map(r => r.accumulatedForecast)), ['304', '312']);
});
test('CSV neutralizes dangerous text and escapes quotes, commas and newlines', () => {
  const exported = report.buildTrackerExportRows([row(38, 'Q3', 0, '=1+1'), row(39, 'Q3', 0, 'A,"B"\nC')], range('annual', '2026-01-01T12:00:00'));
  const csv = report.generateTrackerCsv(exported);
  assert.ok(csv.includes("'=1+1")); assert.ok(csv.includes('"A,""B""\nC"'));
});
test('Metadata uses local calendar bounds, all LVCC rows, unique weeks and missing counts', () => {
  const p = range('monthly', '2026-09-15T12:00:00'); const missing = row(38, 'Q3', 0, 'VISION'); delete missing.actual;
  const planning = select([row(38), missing], p);
  const activity = report.computeRemPeriodActivity([], [{ startDate: '2026-08-01' }], p);
  const metadata = report.buildExportMetadata(p, { total: 0, active: 0, completed: 0 }, activity, planning, 1);
  assert.equal(metadata.periodStartLocal, p.start.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' }));
  assert.equal(metadata.periodEndLocal, p.end.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' }));
  assert.equal(metadata.totalLvcc, 1); assert.equal(metadata.lvccInPeriod, 0); assert.equal(metadata.trackerUniqueWeeksInPeriod, 1);
  assert.equal(metadata.trackerMissingActuals, 1);
});
console.log(`Actual REM report module checks: ${passed} PASS`);
