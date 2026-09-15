/**
 * Behavioral tests for periodHelper.ts — pure function tests with no external dependencies.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
const compiled = ts.transpileModule(fs.readFileSync("src/lib/periodHelper.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfQuarter,
  endOfQuarter,
  startOfYear,
  endOfYear,
  getISOWeek,
  getQuarter,
  createPeriodRange,
  getPreviousPeriod,
  getNextPeriod,
  createPeriodNavigator,
  formatPeriodRange,
  isInPeriod,
  filterByPeriod,
  getAvailablePeriods,
} = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`PASS ${name}`); }
  catch (e) { failed++; console.error(`FAIL ${name}: ${e.message}\n${e.stack}`); }
}

function eq(actual, expected, msg) {
  assert.deepStrictEqual(actual, expected, msg);
}

function assertDateEqual(actual, expected, msg) {
  assert.equal(actual.getTime(), expected.getTime(), msg);
}

// ── Basic boundary functions ──
test("startOfWeek returns Monday 00:00:00", () => {
  const wed = new Date(2026, 8, 16); // Wed Sep 16 2026
  const monday = startOfWeek(wed);
  assertDateEqual(monday, new Date(2026, 8, 14));
  assert.equal(monday.getHours(), 0);
  assert.equal(monday.getMinutes(), 0);
});

test("endOfWeek returns Sunday 23:59:59.999", () => {
  const wed = new Date(2026, 8, 16);
  const sunday = endOfWeek(wed);
  assertDateEqual(sunday, new Date(2026, 8, 20, 23, 59, 59, 999));
});

test("startOfMonth returns 1st day 00:00:00", () => {
  const d = new Date(2026, 8, 15);
  const som = startOfMonth(d);
  assertDateEqual(som, new Date(2026, 8, 1));
});

test("endOfMonth returns last day 23:59:59.999", () => {
  const d = new Date(2026, 8, 15);
  const eom = endOfMonth(d);
  assertDateEqual(eom, new Date(2026, 8, 30, 23, 59, 59, 999));
});

test("startOfQuarter returns quarter start 00:00:00", () => {
  const d = new Date(2026, 8, 15); // Q3
  const soq = startOfQuarter(d);
  assertDateEqual(soq, new Date(2026, 6, 1)); // July 1
});

test("endOfQuarter returns quarter end 23:59:59.999", () => {
  const d = new Date(2026, 8, 15); // Q3
  const eoq = endOfQuarter(d);
  assertDateEqual(eoq, new Date(2026, 8, 30, 23, 59, 59, 999)); // Sep 30
});

test("startOfYear returns Jan 1 00:00:00", () => {
  const d = new Date(2026, 8, 15);
  const soy = startOfYear(d);
  assertDateEqual(soy, new Date(2026, 0, 1));
});

test("endOfYear returns Dec 31 23:59:59.999", () => {
  const d = new Date(2026, 8, 15);
  const eoy = endOfYear(d);
  assertDateEqual(eoy, new Date(2026, 11, 31, 23, 59, 59, 999));
});

// ── ISO week and quarter ──
test("getISOWeek returns correct week numbers", () => {
  eq(getISOWeek(new Date(2026, 0, 1)), 1); // Jan 1 2026 = Thu, week 1
  eq(getISOWeek(new Date(2026, 0, 4)), 1); // Jan 4 2026 = Sun, week 1
  eq(getISOWeek(new Date(2026, 0, 5)), 2); // Jan 5 2026 = Mon, week 2
  eq(getISOWeek(new Date(2026, 11, 31)), 53); // Dec 31 2026 = Thu, week 53 (2026 has 53 weeks)
});

test("getQuarter returns 1-4", () => {
  eq(getQuarter(new Date(2026, 0, 15)), 1);
  eq(getQuarter(new Date(2026, 3, 15)), 2);
  eq(getQuarter(new Date(2026, 6, 15)), 3);
  eq(getQuarter(new Date(2026, 9, 15)), 4);
});

// ── createPeriodRange ──
test("createPeriodRange weekly returns correct range", () => {
  const ref = new Date(2026, 8, 16); // Wed Sep 16 2026
  const range = createPeriodRange("weekly", ref);
  eq(range.type, "weekly");
  assertDateEqual(range.start, new Date(2026, 8, 14)); // Mon Sep 14
  assertDateEqual(range.end, new Date(2026, 8, 20, 23, 59, 59, 999)); // Sun Sep 20
  eq(range.periodIndex, getISOWeek(ref));
  eq(range.year, 2026);
});

test("createPeriodRange monthly returns correct range", () => {
  const ref = new Date(2026, 8, 15);
  const range = createPeriodRange("monthly", ref);
  eq(range.type, "monthly");
  assertDateEqual(range.start, new Date(2026, 8, 1));
  assertDateEqual(range.end, new Date(2026, 8, 30, 23, 59, 59, 999));
  eq(range.periodIndex, 9);
  eq(range.year, 2026);
  eq(range.label, "September 2026");
});

test("createPeriodRange quarterly returns correct range", () => {
  const ref = new Date(2026, 8, 15); // Q3
  const range = createPeriodRange("quarterly", ref);
  eq(range.type, "quarterly");
  assertDateEqual(range.start, new Date(2026, 6, 1));
  assertDateEqual(range.end, new Date(2026, 8, 30, 23, 59, 59, 999));
  eq(range.periodIndex, 3);
  eq(range.year, 2026);
  eq(range.label, "Q3 2026");
});

test("createPeriodRange annual returns correct range", () => {
  const ref = new Date(2026, 8, 15);
  const range = createPeriodRange("annual", ref);
  eq(range.type, "annual");
  assertDateEqual(range.start, new Date(2026, 0, 1));
  assertDateEqual(range.end, new Date(2026, 11, 31, 23, 59, 59, 999));
  eq(range.periodIndex, 1);
  eq(range.year, 2026);
  eq(range.label, "2026");
});

// ── Navigation ──
test("getPreviousPeriod weekly goes back 7 days", () => {
  const current = createPeriodRange("weekly", new Date(2026, 8, 16));
  const prev = getPreviousPeriod(current);
  assertDateEqual(prev.start, new Date(2026, 8, 7));
  assertDateEqual(prev.end, new Date(2026, 8, 13, 23, 59, 59, 999));
});

test("getPreviousPeriod monthly goes back 1 month", () => {
  const current = createPeriodRange("monthly", new Date(2026, 8, 15));
  const prev = getPreviousPeriod(current);
  assertDateEqual(prev.start, new Date(2026, 7, 1));
  assertDateEqual(prev.end, new Date(2026, 7, 31, 23, 59, 59, 999));
});

test("getPreviousPeriod quarterly goes back 3 months", () => {
  const current = createPeriodRange("quarterly", new Date(2026, 8, 15));
  const prev = getPreviousPeriod(current);
  assertDateEqual(prev.start, new Date(2026, 3, 1));
  assertDateEqual(prev.end, new Date(2026, 5, 30, 23, 59, 59, 999));
});

test("getPreviousPeriod annual goes back 1 year", () => {
  const current = createPeriodRange("annual", new Date(2026, 8, 15));
  const prev = getPreviousPeriod(current);
  assertDateEqual(prev.start, new Date(2025, 0, 1));
  assertDateEqual(prev.end, new Date(2025, 11, 31, 23, 59, 59, 999));
});

test("getNextPeriod weekly goes forward 7 days", () => {
  const current = createPeriodRange("weekly", new Date(2026, 8, 16));
  const next = getNextPeriod(current);
  assertDateEqual(next.start, new Date(2026, 8, 21));
  assertDateEqual(next.end, new Date(2026, 8, 27, 23, 59, 59, 999));
});

test("getNextPeriod monthly goes forward 1 month", () => {
  const current = createPeriodRange("monthly", new Date(2026, 8, 15));
  const next = getNextPeriod(current);
  assertDateEqual(next.start, new Date(2026, 9, 1));
  assertDateEqual(next.end, new Date(2026, 9, 31, 23, 59, 59, 999));
});

test("createPeriodNavigator provides current, previous, next, goTo", () => {
  const nav = createPeriodNavigator("monthly", new Date(2026, 8, 15));
  eq(nav.current.periodIndex, 9);
  eq(nav.previous.periodIndex, 8);
  eq(nav.next.periodIndex, 10);
  const jumped = nav.goTo(2025, 12);
  eq(jumped.year, 2025);
  eq(jumped.periodIndex, 12);
});

// ── Filtering ──
test("isInPeriod returns true for timestamps within range", () => {
  const range = createPeriodRange("monthly", new Date(2026, 8, 15));
  const mid = new Date(2026, 8, 15).getTime();
  assert(isInPeriod(mid, range));
  assert(isInPeriod(range.start.getTime(), range));
  assert(isInPeriod(range.end.getTime(), range));
});

test("isInPeriod returns false for timestamps outside range", () => {
  const range = createPeriodRange("monthly", new Date(2026, 8, 15));
  const before = new Date(2026, 7, 31).getTime();
  const after = new Date(2026, 9, 1).getTime();
  assert(!isInPeriod(before, range));
  assert(!isInPeriod(after, range));
});

test("filterByPeriod filters items by timestamp", () => {
  const range = createPeriodRange("monthly", new Date(2026, 8, 15));
  const items = [
    { id: 1, timestamp: new Date(2026, 7, 15).getTime() }, // Aug
    { id: 2, timestamp: new Date(2026, 8, 15).getTime() }, // Sep
    { id: 3, timestamp: new Date(2026, 9, 15).getTime() }, // Oct
  ];
  const filtered = filterByPeriod(items, range);
  eq(filtered.length, 1);
  eq(filtered[0].id, 2);
});

// ── Available periods ──
test("getAvailablePeriods returns all periods in year range", () => {
  const periods = getAvailablePeriods("monthly", 2025, 2026);
  eq(periods.length, 24);
  eq(periods[0].year, 2025);
  eq(periods[0].periodIndex, 1);
  eq(periods[23].year, 2026);
  eq(periods[23].periodIndex, 12);
});

test("getAvailablePeriods weekly handles 52/53 weeks", () => {
  const periods2026 = getAvailablePeriods("weekly", 2026, 2026);
  // 2026 has 53 ISO weeks
  eq(periods2026.length, 53);
  eq(periods2026[0].periodIndex, 1);
  eq(periods2026[52].periodIndex, 53);
});

test("getAvailablePeriods quarterly returns 4 per year", () => {
  const periods = getAvailablePeriods("quarterly", 2025, 2026);
  eq(periods.length, 8);
  eq(periods[0].periodIndex, 1);
  eq(periods[3].periodIndex, 4);
  eq(periods[4].periodIndex, 1);
  eq(periods[4].year, 2026);
});

test("month-end navigation does not skip February or the previous quarter", () => {
  eq(getNextPeriod(createPeriodRange("monthly", new Date(2026, 0, 31))).periodIndex, 2);
  eq(getPreviousPeriod(createPeriodRange("quarterly", new Date(2026, 4, 31))).periodIndex, 1);
});
test("ISO week-year navigation round-trips weeks 1 and 53", () => {
  const january = createPeriodRange("weekly", new Date(2021, 0, 1));
  eq(january.year, 2020); eq(january.periodIndex, 53);
  const nav = createPeriodNavigator("weekly");
  assertDateEqual(nav.goTo(2020, 53).start, new Date(2020, 11, 28));
  assertDateEqual(nav.goTo(2026, 1).start, new Date(2025, 11, 29));
  assert.throws(() => nav.goTo(2021, 53));
});
test("available weeks are unique and remain in their requested ISO year", () => {
  const periods=getAvailablePeriods("weekly", 2020, 2021);
  eq(periods.length, 105);
  eq(new Set(periods.map(p=>p.start.getTime())).size, 105);
  assert(periods.every(p=>createPeriodRange("weekly",p.start).year===p.year));
});
test("UTC event timestamps match the viewer's calendar boundaries", () => {
  if (Intl.DateTimeFormat().resolvedOptions().timeZone === "America/New_York") {
    const lateAugust=Date.parse("2026-09-01T01:00:00Z");
    eq(isInPeriod(lateAugust,createPeriodRange("monthly",new Date(2026,7,15))),true);
    eq(isInPeriod(lateAugust,createPeriodRange("monthly",new Date(2026,8,15))),false);
    const dstWeek=createPeriodRange("weekly",new Date(2026,2,8));
    eq(dstWeek.end.getTime()-dstWeek.start.getTime()+1,167*60*60*1000);
  }
});
console.log(`\nPeriod helper tests: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
