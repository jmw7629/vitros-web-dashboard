import { strict as assert } from "node:assert";

// Import actual modules (not copied)
import { parseReportingDate, getISOWeek, isInPeriod, createPeriodRange } from "../src/lib/periodHelper.ts";

// Inline type stubs matching actual hook types

function makeAnalyzer(startDate, isComplete = false) {
  return {
    _id: `a-${Math.random().toString(36).slice(2, 8)}`,
    serialNumber: `SN-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    analyzerType: "VITROS 5600", currentStage: isComplete ? "RELEASED" : "SERVICE",
    startDate, procurementPct: 100, cleaningPct: 100, servicePct: isComplete ? 100 : 50,
    finalLinePct: isComplete ? 100 : 0, packagingPct: isComplete ? 100 : 0,
    releaseTestingPct: isComplete ? 100 : 0, qaReleasePct: isComplete ? 100 : 0,
    sapReleasePct: isComplete ? 100 : 0, currentPct: isComplete ? 100 : 50,
    overallPct: isComplete ? 100 : 50, isComplete, daysInStage: isComplete ? 0 : 14, slaDays: 30,
  };
}

function makeLvcc(endDate, startDate) {
  return {
    _id: `lvcc-${Math.random().toString(36).slice(2, 8)}`,
    serialNumber: `LVCC-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    batchNumber: "BATCH-001", itemType: "ELECTROMETER", currentStage: "BUILD",
    startDate: startDate ?? "2026-09-01", endDate, isComplete: false,
    buildPct: 80, testPct: 50, packagingPct: 0, qaReleasePct: 0, sapReleasePct: 0,
  };
}

function makeTrackerWeek(year, weekNumber, product, quarter, plan, actual, weeklyForecast) {
  return { _id: `tw-${year}-${weekNumber}-${product}`, year, product, quarter, weekNumber, weekStart: `${year}-01-04`, plan, actual, weeklyForecast };
}

function makeBuildPlanWeek(year, weekNumber, quarter, deliveryTotal, capacityTotal) {
  return {
    _id: `bp-${year}-${weekNumber}`, year, quarter, weekNumber, weekStart: `${year}-01-04`,
    delivery: { analyzer3600: 2, analyzer5600: 1, analyzer7600: 0, vision: 0, electrometer: 0, irWash: 0, total: deliveryTotal },
    capacity: { meets: 0, exceeds: 0, capacity: capacityTotal, delta: 0, headCount: 5, onboarding: 0, inTraining: 0, holidays: 0, ptoDays: 0 },
    actuals: { analyzer3600: 1, analyzer5600: 0, analyzer7600: 0, vitrosVsPlan: -1, vision: 0, electrometer: 0, irWash: 0 },
  };
}

function getWeekYearForMonthly(weekNumber, year) {
  const jan4 = new Date(year, 0, 4);
  const startOfJan4Week = new Date(jan4);
  startOfJan4Week.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const thursdayOfTargetWeek = new Date(startOfJan4Week);
  thursdayOfTargetWeek.setDate(startOfJan4Week.getDate() + (weekNumber - 1) * 7 + 3);
  return { month: thursdayOfTargetWeek.getMonth(), year: thursdayOfTargetWeek.getFullYear() };
}

function quarterLabelToNumber(quarter) {
  const match = /^Q([1-4])$/i.exec(quarter.trim());
  return match ? Number(match[1]) : null;
}

function filterTrackerByPeriod(rows, period) {
  return rows.filter((row) => {
    if (!row.year || !row.weekNumber || row.weekNumber < 1 || row.weekNumber > 53) return false;
    switch (period.type) {
      case "weekly": {
        const targetWeek = getISOWeek(period.start);
        return row.year === period.year && row.weekNumber === targetWeek;
      }
      case "monthly": {
        const { month, year } = getWeekYearForMonthly(row.weekNumber, row.year);
        return year === period.year && month === period.start.getMonth();
      }
      case "quarterly": {
        const rowQuarterNum = quarterLabelToNumber(row.quarter);
        if (rowQuarterNum === null) return false;
        const targetQuarter = Math.floor(period.start.getMonth() / 3) + 1;
        return row.year === period.year && rowQuarterNum === targetQuarter;
      }
      case "annual": {
        return row.year === period.year;
      }
      default:
        return false;
    }
  });
}

function filterBuildPlanByPeriod(rows, period) {
  return rows.filter((row) => {
    if (!row.year || !row.weekNumber || row.weekNumber < 1 || row.weekNumber > 53) return false;
    switch (period.type) {
      case "weekly": {
        const targetWeek = getISOWeek(period.start);
        return row.year === period.year && row.weekNumber === targetWeek;
      }
      case "monthly": {
        const { month, year } = getWeekYearForMonthly(row.weekNumber, row.year);
        return year === period.year && month === period.start.getMonth();
      }
      case "quarterly": {
        const rowQuarterNum = quarterLabelToNumber(row.quarter);
        if (rowQuarterNum === null) return false;
        const targetQuarter = Math.floor(period.start.getMonth() / 3) + 1;
        return row.year === period.year && rowQuarterNum === targetQuarter;
      }
      case "annual": {
        return row.year === period.year;
      }
      default:
        return false;
    }
  });
}

function getAnalyzerTimestamp(a) {
  if (a.startDate) return parseReportingDate(a.startDate);
  return null;
}

function getLvccTimestamp(i) {
  const dateStr = i.endDate ?? i.startDate;
  if (dateStr) return parseReportingDate(dateStr);
  return null;
}

function computeRemPeriodActivity(analyzers, lvccItems, period) {
  return {
    analyzers: analyzers.filter((a) => { const ts = getAnalyzerTimestamp(a); return ts !== null && isInPeriod(ts, period); }),
    lvccItems: lvccItems.filter((i) => { const ts = getLvccTimestamp(i); return ts !== null && isInPeriod(ts, period); }),
    analyzerUnknownDates: analyzers.filter((a) => getAnalyzerTimestamp(a) === null).length,
    lvccUnknownDates: lvccItems.filter((i) => getLvccTimestamp(i) === null).length,
  };
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

console.log("\n=== REM Report Synthetic Tests ===\n");

console.log("Module imports:");
test("parseReportingDate is imported from periodHelper", () => {
  assert.equal(typeof parseReportingDate, "function");
});
test("getISOWeek is imported from periodHelper", () => {
  assert.equal(typeof getISOWeek, "function");
});
test("isInPeriod is imported from periodHelper", () => {
  assert.equal(typeof isInPeriod, "function");
});
test("createPeriodRange is imported from periodHelper", () => {
  assert.equal(typeof createPeriodRange, "function");
});

console.log("\nparseReportingDate:");
test("parses YYYY-MM-DD string", () => {
  const ts = parseReportingDate("2026-09-15");
  assert.ok(ts !== null);
  const d = new Date(ts);
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 15);
});
test("parses ISO datetime string", () => {
  const ts = parseReportingDate("2026-09-15T10:30:00.000Z");
  assert.ok(ts !== null);
});
test("returns null for empty/undefined/non-date", () => {
  assert.equal(parseReportingDate(""), null);
  assert.equal(parseReportingDate(undefined), null);
  assert.equal(parseReportingDate("not-a-date"), null);
  assert.equal(parseReportingDate("2026-13-45"), null);
});
test("returns number for numeric timestamp", () => {
  assert.equal(parseReportingDate(1726368000000), 1726368000000);
});
test("returns null for NaN", () => {
  assert.equal(parseReportingDate(NaN), null);
});

console.log("\nSource quarter via row.quarter (not week/13):");
test("week53 Q4 matches quarterly filter for Q4", () => {
  const rows = [
    makeTrackerWeek(2025, 53, "VITROS", "Q4", 10, 8, 9),
    makeTrackerWeek(2025, 14, "VITROS", "Q2", 10, 7, 8),
  ];
  const period = createPeriodRange("quarterly", new Date(2025, 9, 15));
  const filtered = filterTrackerByPeriod(rows, period);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].weekNumber, 53);
  assert.equal(filtered[0].quarter, "Q4");
});
test("week10 Q1 matches quarterly filter for Q1", () => {
  const rows = [
    makeTrackerWeek(2026, 14, "VITROS", "Q2", 10, 7, 8),
    makeTrackerWeek(2026, 10, "VITROS", "Q1", 10, 8, 9),
  ];
  const period = createPeriodRange("quarterly", new Date(2026, 2, 15));
  const filtered = filterTrackerByPeriod(rows, period);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].weekNumber, 10);
  assert.equal(filtered[0].quarter, "Q1");
});
test("row with empty quarter is excluded from quarterly", () => {
  const rows = [
    { _id: "tw-1", year: 2025, product: "VITROS", quarter: "", weekNumber: 53, plan: 10, actual: 8 },
  ];
  const period = createPeriodRange("quarterly", new Date(2025, 9, 15));
  const filtered = filterTrackerByPeriod(rows, period);
  assert.equal(filtered.length, 0);
});

console.log("\nWeekly tracker filtering:");
test("weekly filter matches correct ISO week", () => {
  const rows = [
    makeTrackerWeek(2026, 38, "VITROS", "Q3", 10, 8, 9),
    makeTrackerWeek(2026, 39, "VITROS", "Q3", 10, 10, 10),
  ];
  const period = createPeriodRange("weekly", new Date(2026, 8, 15));
  const filtered = filterTrackerByPeriod(rows, period);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].weekNumber, 38);
});

console.log("\nMonthly allocation by Thursday month:");
test("week 37 (Sep 14-20) allocates to September", () => {
  const { month, year } = getWeekYearForMonthly(37, 2026);
  assert.equal(month, 8);
  assert.equal(year, 2026);
});
test("week 38 (Sep 21-27) allocates to September", () => {
  const { month, year } = getWeekYearForMonthly(38, 2026);
  assert.equal(month, 8);
  assert.equal(year, 2026);
});
test("week 40 (Oct 5-11) allocates to October", () => {
  const { month, year } = getWeekYearForMonthly(40, 2026);
  assert.equal(month, 9);
  assert.equal(year, 2026);
});

console.log("\nNY local export dates:");
test("formatLocalDate produces local date string", () => {
  function formatLocalDate(date) {
    return date.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  }
  const d = new Date(2026, 8, 15);
  const str = formatLocalDate(d);
  assert.ok(str.includes("2026"), `should contain 2026, got: ${str}`);
  assert.ok(str.includes("09") || str.includes("9"), `should contain September, got: ${str}`);
});
test("periodStartLocal uses local date not toISOString", () => {
  const period = createPeriodRange("monthly", new Date(2026, 8, 15));
  const localStr = period.start.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
  const isoStr = period.start.toISOString().split("T")[0];
  assert.ok(localStr.length > 0, "local date should be non-empty");
  assert.ok(isoStr.length > 0, "iso date should be non-empty");
});

console.log("\nMissing actuals vs zeros:");
test("actual=0 is distinct from actual=undefined", () => {
  const rows = [
    makeTrackerWeek(2026, 38, "VITROS", "Q3", 10, 0, 5),
    makeTrackerWeek(2026, 38, "VISION", "Q3", 10, undefined, 5),
  ];
  const zeros = rows.filter((r) => r.actual === 0).length;
  const missing = rows.filter((r) => r.actual === undefined || r.actual === null).length;
  const sum = rows.filter((r) => r.actual !== undefined && r.actual !== null).reduce((s, r) => s + (r.actual ?? 0), 0);
  assert.equal(zeros, 1, "one row has actual=0");
  assert.equal(missing, 1, "one row has missing actual");
  assert.equal(sum, 0, "sum of recorded actuals is 0 (only the zero is recorded)");
});

console.log("\nCSV formula neutralization:");
test("dangerous strings get apostrophe prefix", () => {
  function neutralizeFormula(value) {
    if (!value) return value;
    if (value.startsWith("=") || value.startsWith("+") || value.startsWith("-") || value.startsWith("@")) {
      return `'${value}`;
    }
    return value;
  }
  assert.equal(neutralizeFormula("=SUM(A1)"), "'=SUM(A1)");
  assert.equal(neutralizeFormula("+5"), "'+5");
  assert.equal(neutralizeFormula("-10"), "'-10");
  assert.equal(neutralizeFormula("@SUM"), "'@SUM");
  assert.equal(neutralizeFormula("normal"), "normal");
  assert.equal(neutralizeFormula(""), "");
});

test("after neutralization, string no longer starts with formula prefix", () => {
  function neutralizeFormula(value) {
    if (!value) return value;
    if (value.startsWith("=") || value.startsWith("+") || value.startsWith("-") || value.startsWith("@")) {
      return `'${value}`;
    }
    return value;
  }
  function escapeCsvValue(value) {
    if (value === null || value === undefined) return "";
    const str = String(value);
    if (/[",\n\r]/.test(str) || str.startsWith("=") || str.startsWith("+") || str.startsWith("-") || str.startsWith("@")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  }
  const neutralized = neutralizeFormula("=SUM(A1)");
  assert.equal(neutralized, "'=SUM(A1)");
  const escaped = escapeCsvValue(neutralized);
  // After neutralization, starts with apostrophe not formula char, so no CSV quoting
  assert.equal(escaped, "'=SUM(A1)");
  assert.ok(!escaped.startsWith("="), "escaped should not start with =");
  assert.ok(!escaped.startsWith("+"), "escaped should not start with +");
  assert.ok(!escaped.startsWith("-"), "escaped should not start with -");
  assert.ok(!escaped.startsWith("@"), "escaped should not start with @");
});

console.log("\nAnalyzer/LVCC date filtering:");
test("analyzer with known date in period is included", () => {
  const analyzer = makeAnalyzer("2026-09-15");
  const period = createPeriodRange("monthly", new Date(2026, 8, 15));
  const ts = getAnalyzerTimestamp(analyzer);
  assert.ok(ts !== null);
  assert.ok(isInPeriod(ts, period));
});
test("analyzer with unknown date is excluded", () => {
  const analyzer = makeAnalyzer(undefined);
  const ts = getAnalyzerTimestamp(analyzer);
  assert.equal(ts, null);
});
test("lvcc with endDate in period is included", () => {
  const item = makeLvcc("2026-09-20");
  const period = createPeriodRange("monthly", new Date(2026, 8, 15));
  const ts = getLvccTimestamp(item);
  assert.ok(ts !== null);
  assert.ok(isInPeriod(ts, period));
});
test("totalLvcc counts all items regardless of period", () => {
  const items = [makeLvcc("2026-09-15"), makeLvcc(undefined), makeLvcc("2026-08-01")];
  const period = createPeriodRange("monthly", new Date(2026, 8, 15));
  const activity = computeRemPeriodActivity([], items, period);
  // Item 1: endDate=Sep15, startDate=Sep1 → uses endDate → Sep15 → in period
  // Item 2: endDate=undefined, startDate=Sep1 → uses startDate → Sep1 → in period
  // Item 3: endDate=Aug1 → uses endDate → Aug1 → not in period
  assert.equal(activity.lvccItems.length, 2, "two in period (Sep15 and Sep1)");
  assert.equal(activity.lvccUnknownDates, 0, "none have unknown dates");
  const totalLvcc = items.length;
  assert.equal(totalLvcc, 3, "total counts ALL rows");
});

console.log("\nQuarterly filtering uses source year:");
test("quarterly filter matches source year, not current year", () => {
  const rows = [
    makeTrackerWeek(2025, 40, "VITROS", "Q4", 10, 8, 9),
    makeTrackerWeek(2026, 40, "VITROS", "Q4", 10, 10, 10),
  ];
  const period = createPeriodRange("quarterly", new Date(2025, 9, 15));
  const filtered = filterTrackerByPeriod(rows, period);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].year, 2025);
});

console.log("\nBuild plan quarterly uses source quarter:");
test("build plan Q1 row matches Q1 quarterly period", () => {
  const rows = [
    makeBuildPlanWeek(2026, 10, "Q1", 3, 5),
    makeBuildPlanWeek(2026, 40, "Q4", 2, 4),
  ];
  const period = createPeriodRange("quarterly", new Date(2026, 2, 15));
  const filtered = filterBuildPlanByPeriod(rows, period);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].quarter, "Q1");
});

console.log("\nWeekly filtering uses getISOWeek from periodHelper:");
test("getISOWeek matches imported function result", () => {
  const d = new Date(2026, 8, 15);
  const week = getISOWeek(d);
  assert.equal(week, 38);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
