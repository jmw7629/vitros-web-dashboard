/** Calendar reporting in the viewer's local time zone. Weeks start Monday. */
export type PeriodType = "weekly" | "monthly" | "quarterly" | "annual";
export interface PeriodRange { type: PeriodType; label: string; start: Date; end: Date; periodIndex: number; year: number }
export interface PeriodNavigator { current: PeriodRange; previous: PeriodRange; next: PeriodRange; goTo: (year: number, periodIndex: number) => PeriodRange }
export function getConfiguredTimezone(): string { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
export function createDateInTZ(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date { return new Date(year, month, day, hour, minute, second); }
function valid(date: Date): void { if (!Number.isFinite(date.getTime())) throw new Error("Invalid reporting date"); }
export function startOfWeek(date: Date): Date { valid(date); const d = new Date(date); d.setDate(d.getDate() - (d.getDay() + 6) % 7); d.setHours(0, 0, 0, 0); return d; }
export function endOfWeek(date: Date): Date { const d = startOfWeek(date); d.setDate(d.getDate() + 7); d.setMilliseconds(-1); return d; }
export function startOfMonth(date: Date): Date { valid(date); return new Date(date.getFullYear(), date.getMonth(), 1); }
export function endOfMonth(date: Date): Date { valid(date); return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999); }
export function startOfQuarter(date: Date): Date { valid(date); return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3, 1); }
export function endOfQuarter(date: Date): Date { valid(date); return new Date(date.getFullYear(), Math.floor(date.getMonth() / 3) * 3 + 3, 0, 23, 59, 59, 999); }
export function startOfYear(date: Date): Date { valid(date); return new Date(date.getFullYear(), 0, 1); }
export function endOfYear(date: Date): Date { valid(date); return new Date(date.getFullYear(), 11, 31, 23, 59, 59, 999); }
function isoWeekYear(date: Date): number { const d = startOfWeek(date); d.setDate(d.getDate() + 3); return d.getFullYear(); }
export function getISOWeek(date: Date): number {
  valid(date);
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  return Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
}
export function getQuarter(date: Date): number { valid(date); return Math.floor(date.getMonth() / 3) + 1; }
export function createPeriodRange(type: PeriodType, referenceDate = new Date()): PeriodRange {
  valid(referenceDate);
  const year = type === "weekly" ? isoWeekYear(referenceDate) : referenceDate.getFullYear();
  switch (type) {
    case "weekly": return {type, year, periodIndex: getISOWeek(referenceDate), start: startOfWeek(referenceDate), end: endOfWeek(referenceDate), label: `Week ${getISOWeek(referenceDate)}, ${year}`};
    case "monthly": return {type, year, periodIndex: referenceDate.getMonth() + 1, start: startOfMonth(referenceDate), end: endOfMonth(referenceDate), label: referenceDate.toLocaleString("en-US", {month:"long", year:"numeric"})};
    case "quarterly": return {type, year, periodIndex: getQuarter(referenceDate), start: startOfQuarter(referenceDate), end: endOfQuarter(referenceDate), label: `Q${getQuarter(referenceDate)} ${year}`};
    case "annual": return {type, year, periodIndex: 1, start: startOfYear(referenceDate), end: endOfYear(referenceDate), label: String(year)};
    default: throw new Error("Invalid reporting period");
  }
}
function move(current: PeriodRange, direction: number): PeriodRange {
  const d = new Date(current.start);
  if (current.type === "weekly") d.setDate(d.getDate() + direction * 7);
  else if (current.type === "annual") d.setFullYear(d.getFullYear() + direction);
  else d.setMonth(d.getMonth() + direction * (current.type === "quarterly" ? 3 : 1));
  return createPeriodRange(current.type, d);
}
export function getPreviousPeriod(current: PeriodRange): PeriodRange { return move(current, -1); }
export function getNextPeriod(current: PeriodRange): PeriodRange { return move(current, 1); }
export function createPeriodNavigator(type: PeriodType, referenceDate = new Date()): PeriodNavigator {
  const current = createPeriodRange(type, referenceDate);
  return {current, previous: getPreviousPeriod(current), next: getNextPeriod(current), goTo(year, index) {
    if (!Number.isInteger(year) || year < 1900 || year > 9999 || !Number.isInteger(index) || index < 1) throw new Error("Invalid reporting period");
    const max = type === "weekly" ? getISOWeek(new Date(year, 11, 28)) : type === "monthly" ? 12 : type === "quarterly" ? 4 : 1;
    if (index > max) throw new Error("Reporting period does not exist");
    let d: Date;
    if (type === "weekly") { d = startOfWeek(new Date(year, 0, 4)); d.setDate(d.getDate() + (index - 1) * 7); }
    else d = new Date(year, type === "monthly" ? index - 1 : type === "quarterly" ? (index - 1) * 3 : 0, 1);
    return createPeriodRange(type, d);
  }};
}
export function formatPeriodRange(range: PeriodRange): string { return `${range.start.toLocaleDateString()} – ${range.end.toLocaleDateString()}`; }
export function isInPeriod(timestamp: number, range: PeriodRange): boolean { return Number.isFinite(timestamp) && timestamp >= range.start.getTime() && timestamp <= range.end.getTime(); }
export function filterByPeriod<T extends {timestamp: number}>(items: T[], range: PeriodRange): T[] { return items.filter(item => isInPeriod(item.timestamp, range)); }
export function getAvailablePeriods(type: PeriodType, startYear: number, endYear: number): PeriodRange[] {
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear < 1900 || endYear > 9999 || endYear < startYear || endYear - startYear > 100) throw new Error("Invalid reporting year range");
  const periods: PeriodRange[] = []; const navigator = createPeriodNavigator(type);
  for (let year = startYear; year <= endYear; year++) {
    const max = type === "weekly" ? getISOWeek(new Date(year, 11, 28)) : type === "monthly" ? 12 : type === "quarterly" ? 4 : 1;
    for (let i = 1; i <= max; i++) periods.push(navigator.goTo(year, i));
  }
  return periods;
}
export const PERIOD_TYPES: PeriodType[] = ["weekly", "monthly", "quarterly", "annual"];
export function getDefaultPeriodType(): PeriodType { return "monthly"; }
/** Source calendar dates stay on their recorded day instead of becoming UTC midnight. */
export function parseReportingDate(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match) {
    const [year, month, day] = match.slice(1).map(Number); const d = new Date(year, month - 1, day);
    return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day ? d.getTime() : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const time = Date.parse(value); return Number.isFinite(time) ? time : null;
}
