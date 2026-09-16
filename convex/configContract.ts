/**
 * VITROS configuration contract — the single shared source of truth for
 * admin-editable configuration, used by BOTH the Convex backend
 * (convex/configActions.ts, convex/authGuard.ts) and the browser
 * (src/lib/configRegistry.ts re-exports this module).
 *
 * This module MUST stay pure: no Convex imports, no browser APIs, no
 * environment access. It is loaded in the V8 function runtime and in Vite.
 *
 * Security invariants:
 * - Secrets, credentials and PIN hashes are never in this registry.
 * - Inventory quantities, ledger/audit records and canonical formulas are
 *   not configurable here.
 * - Employee identity barriers and role ceilings are immutable; the role
 *   policy may only REMOVE optional capabilities inside a ceiling, never
 *   add capabilities or remove mandatory recovery access.
 * - Structured values are validated against fixed known routes, data
 *   sources, column ids, icon names and bounded sizes. Unknown properties,
 *   duplicates, non-finite numbers and arbitrary URLs/HTML/CSS/JS are
 *   rejected before persistence.
 */

import {
  ENGINEER_VIEW_DEFAULT,
  BRAND_DEFAULTS,
  NAV_DEFAULTS,
  DASHBOARD_DEFAULTS,
  THEME_DEFAULTS,
  TABLE_DEFAULTS,
  CHART_DEFAULTS,
  REPORT_DEFAULTS,
  THRESHOLD_DEFAULTS,
  FORM_DEFAULTS,
  FEATURE_DEFAULTS,
  SYSTEM_DEFAULTS,
  REM_DEFAULTS,
  ROLE_POLICY_DEFAULT,
  ROLE_ROUTE_DEFAULTS,
} from "./configDefaults";

/** Pure Engineer presentation contract. No role permissions are changed here. */
export const ENGINEER_METRICS = ["skus", "health", "stockOuts", "reorder", "lowStock", "onPlan", "activity", "kits", "today"] as const;
export const ENGINEER_EXCLUDED_ROUTES = ["/sap-staging", "/sap-analytics", "/enterprise-dashboard", "/settings", "/ai-administration"] as const;

// ─── Capability model (immutable ceilings) ───────────────────────────────

export const CAPABILITIES = [
  "inventory.read",
  "inventory.write",
  "inventory.admin",
  "ai.ocr",
  "rem.read",
  "rem.write",
  "admin.system_settings.manage",
  "admin.users.manage",
  "admin.audit.read",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type RoleName = "superuser" | "engineer" | "viewer";

/** Immutable maximum capability sets. Configuration can never exceed these. */
export const ROLE_CAPABILITY_CEILINGS: Record<RoleName, readonly Capability[]> = {
  superuser: CAPABILITIES,
  engineer: ["inventory.read", "inventory.write", "ai.ocr", "rem.read", "rem.write"],
  viewer: ["inventory.read", "rem.read"],
};

/**
 * Capabilities that can never be removed by configuration. Superuser keeps
 * administration/recovery access; every role keeps basic read access.
 */
export const ROLE_MANDATORY_CAPABILITIES: Record<RoleName, readonly Capability[]> = {
  superuser: [
    "inventory.read",
    "admin.system_settings.manage",
    "admin.users.manage",
    "admin.audit.read",
  ],
  engineer: ["inventory.read", "rem.read"],
  viewer: ["inventory.read"],
};

/** Default effective policy — identical to the historical hard-coded map. */
export const DEFAULT_ROLE_CAPABILITIES: Record<RoleName, Capability[]> = {
  superuser: [...CAPABILITIES],
  engineer: ["inventory.read", "inventory.write", "ai.ocr", "rem.read", "rem.write"],
  viewer: ["inventory.read", "rem.read"],
};

export interface RolePolicy {
  superuser: Capability[];
  engineer: Capability[];
  viewer: Capability[];
}

/**
 * Resolve the effective capability list for a role under a policy value.
 * Fail-closed: an unknown/null policy falls back to the immutable defaults,
 * and the result is always intersected with the ceiling and the mandatory
 * set, so a corrupt stored policy can never widen access.
 */
export function effectiveRoleCapabilities(
  role: string,
  policy: unknown,
): Capability[] {
  // Use hasOwnProperty to avoid prototype pollution (toString, constructor, __proto__)
  if (!Object.prototype.hasOwnProperty.call(ROLE_CAPABILITY_CEILINGS, role)) return [];
  const ceiling = ROLE_CAPABILITY_CEILINGS[role as RoleName];
  const defaults = DEFAULT_ROLE_CAPABILITIES[role as RoleName];
  if (!defaults) return [];
  const mandatory = ROLE_MANDATORY_CAPABILITIES[role as RoleName];
  let configured: Capability[] | null = null;
  if (policy && typeof policy === "object" && !Array.isArray(policy)) {
    const policyObj = policy as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(policyObj, role)) {
      const raw = policyObj[role];
      if (Array.isArray(raw)) {
        configured = raw.filter(
          (c): c is Capability =>
            typeof c === "string" && (CAPABILITIES as readonly string[]).includes(c),
        );
      }
    }
  }
  const base = configured ?? defaults;
  const inCeiling = base.filter((c) => (ceiling as readonly string[]).includes(c));
  return Array.from(new Set([...mandatory, ...inCeiling]));
}

// ─── Known-value allowlists (fixed; no arbitrary strings) ────────────────

export const KNOWN_ROUTES = [
  "/dashboard",
  "/engineer-dashboard",
  "/scan-kiosk",
  "/user-dashboard",
  "/stock-summary",
  "/incoming-stock",
  "/reorder-stockout",
  "/transaction-search",
  "/aged-inventory",
  "/wip-cycle-time",
  "/inventory-turnover",
  "/inventory-accuracy",
  "/analyzer-analysis",
  "/abc-analysis",
  "/kit-analysis",
  "/sap-staging",
  "/sap-analytics",
  "/cycle-count",
  "/dhr-scanner",
  "/health-heatmap",
  "/e-connectivity",
  "/executive-report",
  "/mobile-quick-view",
  "/report-preview",
  "/upload-refresh",
  "/settings",
  "/ai-administration",
  "/rem/dashboard",
  "/rem/morning-snapshot",
  "/rem/kanban",
  "/rem/gantt",
  "/rem/kiosk",
  "/rem/analyzers",
  "/rem/lvcc",
  "/rem/production-plan",
  "/rem/field-status",
  "/rem/staff",
  "/rem/notes",
  "/rem/reports",
  "/rem/reports-v2",
  "/rem/import",
  "/inventory-reports",
] as const;

export type KnownRoute = (typeof KNOWN_ROUTES)[number];

const REM_ROUTES = KNOWN_ROUTES.filter((r) => r.startsWith("/rem/"));

export const NAV_SECTIONS = ["inventory", "reports", "settings", "theme"] as const;
export type NavSection = (typeof NAV_SECTIONS)[number];

/** Fixed icon names (emoji) used by navigation items. */
export const NAV_ICONS = [
  "📷", "👥", "📊", "📦", "📥", "🔔", "🔍", "⏳", "🔧", "🔄", "🎯", "🔬",
  "📈", "🛡️", "📋", "🧮", "✅", "🗺️", "🌐", "📑", "📱", "⬆️", "📝", "🏭",
  "🌅", "💻", "📅", "🌍", "👷", "📄", "⚙️", "🎨", "🚪",
] as const;

/** Fixed gradient class names used by navigation item icons. */
export const NAV_GRADIENTS = [
  "from-indigo-500 to-indigo-700",
  "from-violet-500 to-violet-700",
  "from-sky-500 to-indigo-600",
  "from-amber-500 to-amber-700",
  "from-emerald-500 to-emerald-700",
  "from-red-500 to-red-700",
  "from-indigo-400 to-indigo-600",
  "from-orange-500 to-orange-700",
  "from-slate-500 to-slate-700",
  "from-teal-500 to-teal-700",
  "from-pink-500 to-pink-700",
  "from-emerald-600 to-emerald-800",
  "from-purple-500 to-purple-700",
  "from-red-400 to-red-600",
  "from-cyan-500 to-blue-700",
  "from-teal-400 to-teal-600",
  "from-cyan-500 to-cyan-700",
  "from-sky-400 to-sky-600",
  "from-orange-400 to-orange-600",
  "from-sky-500 to-sky-700",
  "from-slate-400 to-slate-600",
  "from-blue-500 to-blue-700",
] as const;

export const THEME_MODES = ["dark", "light", "midnight", "ocean", "vitros"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export const REM_VIEWS = ["dashboard", "kanban", "gantt", "morning"] as const;

export const STOCK_SUMMARY_COLUMN_KEYS = [
  "partNumber", "description", "type", "qoh", "minQty", "maxQty",
  "status", "onPlan", "binLocation", "module", "supportedModels", "subassemblyCodes", "systemSide",
] as const;

export const TRANSACTION_SEARCH_FIELD_KEYS = [
  "mode", "partNumber", "user", "analyzerSerial", "qty", "qtyChange", "timestamp",
] as const;

export const PART_MASTER_FIELD_KEYS = [
  "partNumber", "description", "type", "qoh", "minQty", "maxQty",
  "onPlan", "binLocation", "module", "supportedModels", "subassemblyCodes", "systemSide",
] as const;

export const DASHBOARD_METRICS = [
  "skus", "health", "stockOuts", "reorder", "lowStock", "onPlan",
  "activity", "kits", "today", "sapReady", "sapPosted", "sapErrors",
] as const;

export const DASHBOARD_LIST_SOURCES = ["inventoryStatus"] as const;

export const REPORT_SECTION_IDS = ["actions", "inventory", "kits"] as const;

export const PART_TYPES = ["Required", "Optional", "Tool", "Not on BOM", "Consumable"] as const;

export const DATE_FORMATS = [
  "MMM d h:mm A",
  "MM/dd/yyyy h:mm A",
  "dd/MM/yyyy h:mm A",
  "yyyy-MM-dd HH:mm",
] as const;

// ─── Structured value shapes ─────────────────────────────────────────────

export interface NavItemConfig {
  label: string;
  icon: string;
  path: string;
  iconBg: string;
  visible: boolean;
  order: number;
}

export interface DashboardModuleConfig {
  id: string;
  type: "kpi" | "list";
  title: string;
  visible: boolean;
  order: number;
  size: "small" | "full";
  config: { metric?: string; dataSource?: string };
}

export interface StockSummaryColumnConfig {
  key: string;
  label: string;
  visible: boolean;
  order: number;
}

export interface TransactionSearchFieldConfig {
  key: string;
  visible: boolean;
  order: number;
}

export interface PartMasterFieldConfig {
  key: string;
  label: string;
  order: number;
}

export interface AbcChartConfig {
  colors: string[];
  showDonut: boolean;
  showPareto: boolean;
}

export interface TurnoverChartConfig {
  showClassCards: boolean;
  colors: string[];
}

export interface RemProgressChartConfig {
  color: string;
  visible: boolean;
}

export interface ReportDefinitionConfig {
  id: string;
  name: string;
  description: string;
  visible: boolean;
  defaultOpen: boolean;
  order: number;
}

// ─── Validation helpers ──────────────────────────────────────────────────

const PRINTABLE_TEXT = /^[\p{L}\p{N}\p{P}\p{Z}\p{S}]+$/u;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export interface ValidationOutcome {
  valid: boolean;
  error?: string;
}

function ok(): ValidationOutcome {
  return { valid: true };
}

function fail(error: string): ValidationOutcome {
  return { valid: false, error };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Printable display text: no control characters, no markup delimiters. */
function checkDisplayText(value: unknown, label: string, min: number, max: number): ValidationOutcome {
  if (typeof value !== "string") return fail(`${label} must be a string`);
  if (CONTROL_CHARS.test(value)) return fail(`${label} must not contain control characters`);
  if (value.length < min || value.length > max) {
    return fail(`${label} must be ${min}-${max} characters`);
  }
  if (!PRINTABLE_TEXT.test(value)) {
    return fail(`${label} may only contain printable text (no HTML, code or URLs)`);
  }
  return ok();
}

/** Reject any property not in the allowlist. */
function checkExactProperties(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): ValidationOutcome {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      return fail(`${label} contains unknown property "${key}"`);
    }
  }
  return ok();
}

function checkUnique(values: number[], label: string): ValidationOutcome {
  if (new Set(values).size !== values.length) {
    return fail(`${label} contains duplicate order values`);
  }
  return ok();
}

// ─── Per-key structured validators ───────────────────────────────────────

function validateNavItems(value: unknown, label: string, requireVisible: boolean): ValidationOutcome {
  if (!Array.isArray(value)) return fail(`${label} must be an array of navigation items`);
  if (value.length < 1 || value.length > 40) return fail(`${label} must contain 1-40 items`);
  const orders: number[] = [];
  const paths = new Set<string>();
  let visibleCount = 0;
  for (const item of value) {
    if (!isPlainObject(item)) return fail(`${label} entries must be objects`);
    const propCheck = checkExactProperties(item, ["label", "icon", "path", "iconBg", "visible", "order"], `${label} entry`);
    if (!propCheck.valid) return propCheck;
    const textCheck = checkDisplayText(item.label, `${label} label`, 1, 40);
    if (!textCheck.valid) return textCheck;
    if (typeof item.icon !== "string" || !(NAV_ICONS as readonly string[]).includes(item.icon)) {
      return fail(`${label} icon "${String(item.icon)}" is not a known icon name`);
    }
    if (typeof item.path !== "string" || !(KNOWN_ROUTES as readonly string[]).includes(item.path)) {
      return fail(`${label} path "${String(item.path)}" is not a known route`);
    }
    if (paths.has(item.path)) return fail(`${label} contains duplicate path "${item.path}"`);
    paths.add(item.path);
    if (typeof item.iconBg !== "string" || !(NAV_GRADIENTS as readonly string[]).includes(item.iconBg)) {
      return fail(`${label} icon background "${String(item.iconBg)}" is not a known gradient`);
    }
    if (typeof item.visible !== "boolean") return fail(`${label} visible must be a boolean`);
    if (item.visible) visibleCount++;
    if (typeof item.order !== "number" || !Number.isInteger(item.order) || item.order < 0 || item.order > 999) {
      return fail(`${label} order must be an integer between 0 and 999`);
    }
    orders.push(item.order);
  }
  const uniqueCheck = checkUnique(orders, label);
  if (!uniqueCheck.valid) return uniqueCheck;
  if (requireVisible && visibleCount < 1) return fail(`${label} must keep at least one visible item`);
  return ok();
}

function validateRouteLabels(value: unknown): ValidationOutcome {
  if (!isPlainObject(value)) return fail("Route labels must be an object mapping routes to labels");
  const keys = Object.keys(value);
  if (keys.length < 1 || keys.length > 48) return fail("Route labels must contain 1-48 entries");
  for (const key of keys) {
    if (!(KNOWN_ROUTES as readonly string[]).includes(key)) {
      return fail(`Route labels contains unknown route "${key}"`);
    }
    const textCheck = checkDisplayText(value[key], `Route label for ${key}`, 1, 64);
    if (!textCheck.valid) return textCheck;
  }
  return ok();
}

function validateItemOrder(value: unknown): ValidationOutcome {
  if (!Array.isArray(value)) return fail("Sidebar section order must be an array");
  if (value.length !== NAV_SECTIONS.length) {
    return fail(`Sidebar section order must contain exactly ${NAV_SECTIONS.length} sections`);
  }
  const seen = new Set<string>();
  for (const section of value) {
    if (typeof section !== "string" || !(NAV_SECTIONS as readonly string[]).includes(section)) {
      return fail(`Sidebar section order contains unknown section "${String(section)}"`);
    }
    if (seen.has(section)) return fail(`Sidebar section order contains duplicate "${section}"`);
    seen.add(section);
  }
  return ok();
}

function validateDashboardModules(value: unknown): ValidationOutcome {
  if (!Array.isArray(value)) return fail("Dashboard modules must be an array");
  if (value.length < 1 || value.length > 24) return fail("Dashboard modules must contain 1-24 modules");
  const orders: number[] = [];
  const ids = new Set<string>();
  for (const module of value) {
    if (!isPlainObject(module)) return fail("Dashboard module entries must be objects");
    const propCheck = checkExactProperties(module, ["id", "type", "title", "visible", "order", "size", "config"], "Dashboard module");
    if (!propCheck.valid) return propCheck;
    if (typeof module.id !== "string" || !/^[a-z0-9-]{1,40}$/.test(module.id)) {
      return fail(`Dashboard module id "${String(module.id)}" is invalid`);
    }
    if (ids.has(module.id)) return fail(`Dashboard module id "${module.id}" is duplicated`);
    ids.add(module.id);
    if (module.type !== "kpi" && module.type !== "list") {
      return fail(`Dashboard module type must be "kpi" or "list"`);
    }
    const titleCheck = checkDisplayText(module.title, "Dashboard module title", 1, 60);
    if (!titleCheck.valid) return titleCheck;
    if (typeof module.visible !== "boolean") return fail("Dashboard module visible must be a boolean");
    if (module.size !== "small" && module.size !== "full") {
      return fail(`Dashboard module size must be "small" or "full"`);
    }
    if (typeof module.order !== "number" || !Number.isInteger(module.order) || module.order < 0 || module.order > 23) {
      return fail("Dashboard module order must be an integer between 0 and 23");
    }
    orders.push(module.order);
    if (!isPlainObject(module.config)) return fail("Dashboard module config must be an object");
    if (module.type === "kpi") {
      const configCheck = checkExactProperties(module.config, ["metric"], "Dashboard kpi config");
      if (!configCheck.valid) return configCheck;
      if (typeof module.config.metric !== "string" || !(DASHBOARD_METRICS as readonly string[]).includes(module.config.metric)) {
        return fail(`Dashboard kpi metric "${String(module.config.metric)}" is not a known metric`);
      }
    } else {
      const configCheck = checkExactProperties(module.config, ["dataSource"], "Dashboard list config");
      if (!configCheck.valid) return configCheck;
      if (typeof module.config.dataSource !== "string" || !(DASHBOARD_LIST_SOURCES as readonly string[]).includes(module.config.dataSource)) {
        return fail(`Dashboard list data source "${String(module.config.dataSource)}" is not a known data source`);
      }
    }
  }
  return checkUnique(orders, "Dashboard modules");
}

function validateThemeAvailableModes(value: unknown): ValidationOutcome {
  if (!Array.isArray(value)) return fail("Available themes must be an array");
  if (value.length < 1 || value.length > THEME_MODES.length) {
    return fail(`Available themes must contain 1-${THEME_MODES.length} entries`);
  }
  const seen = new Set<string>();
  for (const mode of value) {
    if (typeof mode !== "string" || !(THEME_MODES as readonly string[]).includes(mode)) {
      return fail(`Available theme "${String(mode)}" is not a known theme`);
    }
    if (seen.has(mode)) return fail(`Available theme "${mode}" is duplicated`);
    seen.add(mode);
  }
  return ok();
}

function validateStockSummaryColumns(value: unknown): ValidationOutcome {
  if (!Array.isArray(value)) return fail("Stock Summary columns must be an array");
  if (value.length < 1 || value.length > 16) return fail("Stock Summary columns must contain 1-16 columns");
  const orders: number[] = [];
  const keys = new Set<string>();
  for (const column of value) {
    if (!isPlainObject(column)) return fail("Stock Summary column entries must be objects");
    const propCheck = checkExactProperties(column, ["key", "label", "visible", "order"], "Stock Summary column");
    if (!propCheck.valid) return propCheck;
    if (typeof column.key !== "string" || !(STOCK_SUMMARY_COLUMN_KEYS as readonly string[]).includes(column.key)) {
      return fail(`Stock Summary column "${String(column.key)}" is not a known column`);
    }
    if (keys.has(column.key)) return fail(`Stock Summary column "${column.key}" is duplicated`);
    keys.add(column.key);
    const labelCheck = checkDisplayText(column.label, `Stock Summary column label for ${column.key}`, 1, 30);
    if (!labelCheck.valid) return labelCheck;
    if (typeof column.visible !== "boolean") return fail("Stock Summary column visible must be a boolean");
    if (typeof column.order !== "number" || !Number.isInteger(column.order) || column.order < 0 || column.order > 15) {
      return fail("Stock Summary column order must be an integer between 0 and 15");
    }
    orders.push(column.order);
  }
  const uniqueCheck = checkUnique(orders, "Stock Summary columns");
  if (!uniqueCheck.valid) return uniqueCheck;
  // Part identity and quantity must never be removed from the table.
  for (const required of ["partNumber", "qoh"] as const) {
    const entry = value.find((c) => isPlainObject(c) && c.key === required);
    if (!entry || entry.visible !== true) {
      return fail(`Stock Summary column "${required}" is required and must stay visible`);
    }
  }
  return ok();
}

function validateTransactionSearchFields(value: unknown): ValidationOutcome {
  if (!Array.isArray(value)) return fail("Transaction Search fields must be an array");
  if (value.length < 1 || value.length > 12) return fail("Transaction Search fields must contain 1-12 fields");
  const orders: number[] = [];
  const keys = new Set<string>();
  for (const field of value) {
    if (!isPlainObject(field)) return fail("Transaction Search field entries must be objects");
    const propCheck = checkExactProperties(field, ["key", "visible", "order"], "Transaction Search field");
    if (!propCheck.valid) return propCheck;
    if (typeof field.key !== "string" || !(TRANSACTION_SEARCH_FIELD_KEYS as readonly string[]).includes(field.key)) {
      return fail(`Transaction Search field "${String(field.key)}" is not a known field`);
    }
    if (keys.has(field.key)) return fail(`Transaction Search field "${field.key}" is duplicated`);
    keys.add(field.key);
    if (typeof field.visible !== "boolean") return fail("Transaction Search field visible must be a boolean");
    if (typeof field.order !== "number" || !Number.isInteger(field.order) || field.order < 0 || field.order > 11) {
      return fail("Transaction Search field order must be an integer between 0 and 11");
    }
    orders.push(field.order);
  }
  const uniqueCheck = checkUnique(orders, "Transaction Search fields");
  if (!uniqueCheck.valid) return uniqueCheck;
  for (const required of ["partNumber", "qty"] as const) {
    const entry = value.find((f) => isPlainObject(f) && f.key === required);
    if (!entry || entry.visible !== true) {
      return fail(`Transaction Search field "${required}" is required and must stay visible`);
    }
  }
  return ok();
}

function validatePartMasterFields(value: unknown): ValidationOutcome {
  if (!Array.isArray(value)) return fail("Part master form fields must be an array");
  if (value.length < 8 || value.length > PART_MASTER_FIELD_KEYS.length) {
    return fail("Part master form fields must contain all eight core fields and only supported metadata fields");
  }
  const orders: number[] = [];
  const keys = new Set<string>();
  for (const field of value) {
    if (!isPlainObject(field)) return fail("Part master form field entries must be objects");
    const propCheck = checkExactProperties(field, ["key", "label", "order"], "Part master form field");
    if (!propCheck.valid) return propCheck;
    if (typeof field.key !== "string" || !(PART_MASTER_FIELD_KEYS as readonly string[]).includes(field.key)) {
      return fail(`Part master form field "${String(field.key)}" is not a known field`);
    }
    if (keys.has(field.key)) return fail(`Part master form field "${field.key}" is duplicated`);
    keys.add(field.key);
    const labelCheck = checkDisplayText(field.label, `Part master form label for ${field.key}`, 1, 30);
    if (!labelCheck.valid) return labelCheck;
    if (typeof field.order !== "number" || !Number.isInteger(field.order) || field.order < 0 || field.order > 15) {
      return fail("Part master form field order must be an integer between 0 and 15");
    }
    orders.push(field.order);
  }
  for (const key of ["partNumber","description","type","qoh","minQty","maxQty","onPlan","module"]) if (!keys.has(key)) return fail(`Missing core part master field ${key}`);
  return checkUnique(orders, "Part master form fields");
}

function validateHexColors(value: unknown, label: string, count: number): ValidationOutcome {
  if (!Array.isArray(value) || value.length !== count) {
    return fail(`${label} must be an array of exactly ${count} hex colors`);
  }
  for (const color of value) {
    if (typeof color !== "string" || !HEX_COLOR.test(color)) {
      return fail(`${label} entries must be 6-digit hex colors like #22c55e`);
    }
  }
  return ok();
}

function validateAbcChart(value: unknown): ValidationOutcome {
  if (!isPlainObject(value)) return fail("ABC chart configuration must be an object");
  const propCheck = checkExactProperties(value, ["colors", "showDonut", "showPareto"], "ABC chart configuration");
  if (!propCheck.valid) return propCheck;
  const colorsCheck = validateHexColors(value.colors, "ABC chart colors", 3);
  if (!colorsCheck.valid) return colorsCheck;
  if (typeof value.showDonut !== "boolean") return fail("ABC chart showDonut must be a boolean");
  if (typeof value.showPareto !== "boolean") return fail("ABC chart showPareto must be a boolean");
  return ok();
}

function validateTurnoverChart(value: unknown): ValidationOutcome {
  if (!isPlainObject(value)) return fail("Inventory turnover chart configuration must be an object");
  const propCheck = checkExactProperties(value, ["showClassCards", "colors"], "Inventory turnover chart configuration");
  if (!propCheck.valid) return propCheck;
  const colorsCheck = validateHexColors(value.colors, "Inventory turnover chart colors", 4);
  if (!colorsCheck.valid) return colorsCheck;
  if (typeof value.showClassCards !== "boolean") return fail("Inventory turnover chart showClassCards must be a boolean");
  return ok();
}

function validateRemProgressChart(value: unknown): ValidationOutcome {
  if (!isPlainObject(value)) return fail("REM progress chart configuration must be an object");
  const propCheck = checkExactProperties(value, ["color", "visible"], "REM progress chart configuration");
  if (!propCheck.valid) return propCheck;
  if (typeof value.color !== "string" || !HEX_COLOR.test(value.color)) {
    return fail("REM progress chart color must be a 6-digit hex color");
  }
  if (typeof value.visible !== "boolean") return fail("REM progress chart visible must be a boolean");
  return ok();
}

function validateReportDefinitions(value: unknown): ValidationOutcome {
  if (!Array.isArray(value)) return fail("Report definitions must be an array");
  if (value.length !== REPORT_SECTION_IDS.length) {
    return fail(`Report definitions must contain exactly the ${REPORT_SECTION_IDS.length} supported report sections`);
  }
  const orders: number[] = [];
  const ids = new Set<string>();
  for (const report of value) {
    if (!isPlainObject(report)) return fail("Report definition entries must be objects");
    const propCheck = checkExactProperties(report, ["id", "name", "description", "visible", "defaultOpen", "order"], "Report definition");
    if (!propCheck.valid) return propCheck;
    if (typeof report.id !== "string" || !(REPORT_SECTION_IDS as readonly string[]).includes(report.id)) {
      return fail(`Report definition id "${String(report.id)}" is not a known report section`);
    }
    if (ids.has(report.id)) return fail(`Report definition id "${report.id}" is duplicated`);
    ids.add(report.id);
    const nameCheck = checkDisplayText(report.name, "Report definition name", 1, 60);
    if (!nameCheck.valid) return nameCheck;
    if (typeof report.description !== "string" || report.description.length > 200 || CONTROL_CHARS.test(report.description)) {
      return fail("Report definition description must be 0-200 characters without control characters");
    }
    if (typeof report.visible !== "boolean") return fail("Report definition visible must be a boolean");
    if (typeof report.defaultOpen !== "boolean") return fail("Report definition defaultOpen must be a boolean");
    if (typeof report.order !== "number" || !Number.isInteger(report.order) || report.order < 0 || report.order > 15) {
      return fail("Report definition order must be an integer between 0 and 15");
    }
    orders.push(report.order);
  }
  return checkUnique(orders, "Report definitions");
}

export function validateRolePolicyValue(value: unknown): ValidationOutcome {
  if (!isPlainObject(value)) return fail("Role policy must be an object");
  const propCheck = checkExactProperties(value, ["superuser", "engineer", "viewer"], "Role policy");
  if (!propCheck.valid) return propCheck;
  for (const role of ["superuser", "engineer", "viewer"] as const) {
    if (!Object.prototype.hasOwnProperty.call(value, role)) {
      return fail(`Role policy missing required role "${role}"`);
    }
    const raw = value[role];
    if (!Array.isArray(raw) || raw.length < 1) {
      return fail(`Role policy for ${role} must be a non-empty array of capabilities`);
    }
    const seen = new Set<string>();
    for (const capability of raw) {
      if (typeof capability !== "string" || !(CAPABILITIES as readonly string[]).includes(capability)) {
        return fail(`Role policy for ${role} contains unknown capability "${String(capability)}"`);
      }
      if (seen.has(capability)) return fail(`Role policy for ${role} contains duplicate capability "${capability}"`);
      seen.add(capability);
      if (!(ROLE_CAPABILITY_CEILINGS[role] as readonly string[]).includes(capability)) {
        return fail(`Role policy cannot grant ${role} the capability "${capability}"`);
      }
    }
    for (const mandatory of ROLE_MANDATORY_CAPABILITIES[role]) {
      if (!seen.has(mandatory)) {
        return fail(`Role policy cannot remove ${role} mandatory capability "${mandatory}"`);
      }
    }
  }
  return ok();
}

// ─── Registry ────────────────────────────────────────────────────────────

export type ConfigValueType = "string" | "number" | "boolean" | "json";

export type ConfigCategory =
  | "branding"
  | "navigation"
  | "dashboard"
  | "theme"
  | "tables"
  | "charts"
  | "reports"
  | "thresholds"
  | "forms"
  | "feature_flags"
  | "system_defaults"
  | "rem_config"
  | "roles";

export type ConfigSensitivity = "normal" | "sensitive";

export interface ConfigEntryDef {
  key: string;
  label: string;
  description: string;
  category: ConfigCategory;
  valueType: ConfigValueType;
  defaultValue: unknown;
  /** Minimum capability required to edit this key (always the settings admin capability). */
  requiredCapability: Capability;
  sensitivity: ConfigSensitivity;
  requiresReload: boolean;
  editable: boolean;
  /** Whether the published value may be read by unauthenticated rendering. */
  public: boolean;
  /** Where this value takes effect (kept honest: entries without a real consumer are not registered). */
  consumer: string;
}

export interface EngineerViewConfig {
  title: string;
  subtitle: string;
  cards: DashboardModuleConfig[];
  quickActions: NavItemConfig[];
  inventoryStatus: { title: string; visible: boolean };
  recentTransactions: { title: string; visible: boolean; limit: number };
  useCustomNavigation: boolean;
  inventoryMenu: NavItemConfig[];
  remMenu: NavItemConfig[];
  reportsMenu: NavItemConfig[];
}

function validateEngineerView(value: unknown): ValidationOutcome {
  if (!isPlainObject(value)) return fail("Engineer view must be an object");
  if (/[<>]/.test(JSON.stringify(value))) return fail("Engineer view labels must use plain text");
  const properties = checkExactProperties(value, ["title", "subtitle", "cards", "quickActions", "inventoryStatus", "recentTransactions", "useCustomNavigation", "inventoryMenu", "remMenu", "reportsMenu"], "Engineer view");
  if (!properties.valid) return properties;
  for (const key of ["title", "subtitle"]) {
    const result = checkDisplayText(value[key], key, 1, key === "title" ? 60 : 160);
    if (!result.valid) return result;
  }
  const cards = validateDashboardModules(value.cards);
  if (!cards.valid) return cards;
  for (const card of value.cards as DashboardModuleConfig[]) {
    if (card.type !== "kpi" || !ENGINEER_METRICS.includes(card.config.metric as typeof ENGINEER_METRICS[number])) return fail("Choose an operational Engineer metric");
  }
  if (typeof value.useCustomNavigation !== "boolean") return fail("Use custom navigation must be a boolean");
  for (const key of ["quickActions", "inventoryMenu", "remMenu", "reportsMenu"]) {
    const result = validateNavItems(value[key], key, key === "inventoryMenu" || key === "remMenu");
    if (!result.valid) return result;
    for (const item of value[key] as NavItemConfig[]) {
      if ((ENGINEER_EXCLUDED_ROUTES as readonly string[]).includes(item.path)) return fail("Engineer view cannot link to administration or SAP");
      if (key === "remMenu" && !item.path.startsWith("/rem/")) return fail("REM menu must use REM routes");
      if ((key === "inventoryMenu" || key === "reportsMenu") && item.path.startsWith("/rem/")) return fail("Inventory menus must use inventory routes");
    }
  }
  for (const key of ["inventoryStatus", "recentTransactions"]) {
    const panel = value[key];
    if (!isPlainObject(panel)) return fail(key + " must be an object");
    const properties = checkExactProperties(panel, key === "recentTransactions" ? ["title", "visible", "limit"] : ["title", "visible"], key);
    if (!properties.valid) return properties;
    const title = checkDisplayText(panel.title, key + " title", 1, 60);
    if (!title.valid) return title;
    if (typeof panel.visible !== "boolean") return fail(key + " visible must be a boolean");
    if (key === "recentTransactions" && (typeof panel.limit !== "number" || !Number.isInteger(panel.limit) || panel.limit < 1 || panel.limit > 50)) return fail("Recent transactions limit must be 1–50");
  }
  return ok();
}

export const CONFIG_ENTRIES: Record<string, ConfigEntryDef> = {
  "engineer.view": {
    key: "engineer.view", label: "Engineer view",
    description: "Customize the Engineer dashboard title, cards, quick actions, panels, and optional Inventory and REM menus. These display settings do not grant permissions.",
    category: "dashboard", valueType: "json", defaultValue: ENGINEER_VIEW_DEFAULT,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "EngineerDashboard; Engineer AppSidebar",
  },
  "brand.appTitle": {
    key: "brand.appTitle", label: "Application Title",
    description: "Title shown in the top navigation bar and browser tab",
    category: "branding", valueType: "string", defaultValue: BRAND_DEFAULTS.appTitle,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "TopNavBar logo text; document.title",
  },
  "brand.sidebarTitle": {
    key: "brand.sidebarTitle", label: "Sidebar Title",
    description: "Title shown at the top of the sidebar navigation",
    category: "branding", valueType: "string", defaultValue: BRAND_DEFAULTS.sidebarTitle,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "AppSidebar header title",
  },
  "brand.sidebarSubtitle": {
    key: "brand.sidebarSubtitle", label: "Sidebar Subtitle",
    description: "Subtitle shown below the sidebar title",
    category: "branding", valueType: "string", defaultValue: BRAND_DEFAULTS.sidebarSubtitle,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "AppSidebar header subtitle",
  },
  "nav.inventoryItems": {
    key: "nav.inventoryItems", label: "Inventory Navigation Items",
    description: "Items shown in the Inventory section of the sidebar (label, icon, gradient, visibility, order)",
    category: "navigation", valueType: "json", defaultValue: NAV_DEFAULTS.inventoryItems,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "AppSidebar inventory section",
  },
  "nav.remItems": {
    key: "nav.remItems", label: "REM Navigation Items",
    description: "Items shown in the REM section of the sidebar",
    category: "navigation", valueType: "json", defaultValue: NAV_DEFAULTS.remItems,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "AppSidebar REM section",
  },
  "nav.inventoryReports": {
    key: "nav.inventoryReports", label: "Report Navigation Items",
    description: "Report items shown below the inventory navigation section",
    category: "navigation", valueType: "json", defaultValue: NAV_DEFAULTS.inventoryReports,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "AppSidebar reports section",
  },
  "nav.itemOrder": {
    key: "nav.itemOrder", label: "Sidebar Section Order",
    description: "Order of the sidebar sections (inventory, reports, settings, theme)",
    category: "navigation", valueType: "json", defaultValue: NAV_DEFAULTS.itemOrder,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "AppSidebar section ordering",
  },
  "nav.routeLabels": {
    key: "nav.routeLabels", label: "Route Labels",
    description: "Display label for the current route shown in the page sub-header",
    category: "navigation", valueType: "json", defaultValue: NAV_DEFAULTS.routeLabels,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "VitrosLayout sub-header current-page label",
  },
  "dashboard.modules": {
    key: "dashboard.modules", label: "Dashboard Modules",
    description: "KPI cards and status modules shown on the Executive Dashboard (metric, title, visibility, order, size)",
    category: "dashboard", valueType: "json", defaultValue: DASHBOARD_DEFAULTS.modules,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "ExecutiveDashboard KPI grid and inventory status module",
  },
  "theme.defaultMode": {
    key: "theme.defaultMode", label: "Default Theme",
    description: "Theme applied to sessions without a stored theme preference",
    category: "theme", valueType: "string", defaultValue: THEME_DEFAULTS.defaultMode,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "ThemeProvider initial mode",
  },
  "theme.availableModes": {
    key: "theme.availableModes", label: "Available Themes",
    description: "Themes offered in the sidebar theme picker",
    category: "theme", valueType: "json", defaultValue: THEME_DEFAULTS.availableModes,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "AppSidebar theme picker options",
  },
  "tables.stockSummary.columns": {
    key: "tables.stockSummary.columns", label: "Stock Summary Columns",
    description: "Columns of the Stock Summary table (label, visibility, order). Part # and QOH must stay visible.",
    category: "tables", valueType: "json", defaultValue: TABLE_DEFAULTS.stockSummaryColumns,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "StockSummary table headers and cells",
  },
  "tables.transactionSearch.columns": {
    key: "tables.transactionSearch.columns", label: "Transaction Search Fields",
    description: "Fields shown per transaction row (visibility, order). Part # and Qty must stay visible.",
    category: "tables", valueType: "json", defaultValue: TABLE_DEFAULTS.transactionSearchFields,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "TransactionSearch row layout",
  },
  "charts.abcAnalysis": {
    key: "charts.abcAnalysis", label: "ABC Analysis Chart",
    description: "A/B/C class colors and chart visibility for the ABC Analysis page",
    category: "charts", valueType: "json", defaultValue: CHART_DEFAULTS.abcAnalysis,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "AbcAnalysis Pareto chart, donut chart and class colors",
  },
  "charts.inventoryTurnover": {
    key: "charts.inventoryTurnover", label: "Inventory Turnover Chart",
    description: "Class summary card visibility and High/Medium/Low/None colors for the turnover page",
    category: "charts", valueType: "json", defaultValue: CHART_DEFAULTS.inventoryTurnover,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "InventoryTurnover class cards and ratio colors",
  },
  "charts.remProgress": {
    key: "charts.remProgress", label: "REM Progress Chart",
    description: "Color and visibility of the REM Dashboard build progress bar",
    category: "charts", valueType: "json", defaultValue: CHART_DEFAULTS.remProgress,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "RemDashboard build progress bar",
  },
  "reports.definitions": {
    key: "reports.definitions", label: "Report Definitions",
    description: "Daily briefing report sections (name, description, visibility, default expansion, order)",
    category: "reports", valueType: "json", defaultValue: REPORT_DEFAULTS.definitions,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "ReportPreview daily briefing sections",
  },
  "thresholds.agedInventoryDays": {
    key: "thresholds.agedInventoryDays", label: "Aged Inventory Threshold",
    description: "Age in days after which inventory counts as aged (final bucket boundary)",
    category: "thresholds", valueType: "number", defaultValue: THRESHOLD_DEFAULTS.agedInventoryDays,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "AgedInventory final bucket boundary and label",
  },
  "forms.partMasterFields": {
    key: "forms.partMasterFields", label: "Part Master Form Fields",
    description: "Labels and order of the part master add/edit form fields. All supported fields must remain present.",
    category: "forms", valueType: "json", defaultValue: FORM_DEFAULTS.partMasterFields,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "StockSummary part add/edit form field labels and ordering",
  },
  "features.remImportEnabled": {
    key: "features.remImportEnabled", label: "REM Import",
    description: "Enables the REM operational workbook import. Server-enforced on the import write path.",
    category: "feature_flags", valueType: "boolean", defaultValue: FEATURE_DEFAULTS.remImportEnabled,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "Server gate on beginOperationalImport/stageOperationalImport; REM Bulk Import navigation visibility",
  },
  "features.cycleCountEnabled": {
    key: "features.cycleCountEnabled", label: "Cycle Count",
    description: "Enables the cycle count workflow. Server-enforced on cycle count mutations.",
    category: "feature_flags", valueType: "boolean", defaultValue: FEATURE_DEFAULTS.cycleCountEnabled,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "Server gate on cycleSchedules/cycleResults mutations; Cycle Count navigation visibility",
  },
  "features.kitAnalysisEnabled": {
    key: "features.kitAnalysisEnabled", label: "Kit Analysis (visibility)",
    description: "Shows the read-only Kit Analysis page. This is a visibility setting; kit analysis has no server write path.",
    category: "feature_flags", valueType: "boolean", defaultValue: FEATURE_DEFAULTS.kitAnalysisEnabled,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "Kit Analysis navigation visibility",
  },
  "features.sapExportEnabled": {
    key: "features.sapExportEnabled", label: "SAP Export",
    description: "Enables marking staged SAP rows as exported. Server-enforced on the export transition.",
    category: "feature_flags", valueType: "boolean", defaultValue: FEATURE_DEFAULTS.sapExportEnabled,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "Server gate on sapStagingWorkflow export transition; SAP Staging navigation visibility",
  },
  "defaults.partType": {
    key: "defaults.partType", label: "Default Part Type",
    description: "Part type pre-selected in the part master add form",
    category: "system_defaults", valueType: "string", defaultValue: SYSTEM_DEFAULTS.partType,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "StockSummary add-part form default type",
  },
  "defaults.currency": {
    key: "defaults.currency", label: "Currency Symbol",
    description: "Currency symbol shown with part unit costs",
    category: "system_defaults", valueType: "string", defaultValue: SYSTEM_DEFAULTS.currency,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "Settings part master unit cost display",
  },
  "defaults.dateFormat": {
    key: "defaults.dateFormat", label: "Date Format",
    description: "Format used for transaction and timestamp displays",
    category: "system_defaults", valueType: "string", defaultValue: SYSTEM_DEFAULTS.dateFormat,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "SharedComponents formatDate util",
  },
  "defaults.timezone": {
    key: "defaults.timezone", label: "Timezone",
    description: "Timezone used for timestamp displays; \"local\" keeps the browser timezone",
    category: "system_defaults", valueType: "string", defaultValue: SYSTEM_DEFAULTS.timezone,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "SharedComponents formatDate util timezone option",
  },
  "rem.defaultView": {
    key: "rem.defaultView", label: "REM Default View",
    description: "REM view opened by the REM Tracker tab",
    category: "rem_config", valueType: "string", defaultValue: REM_DEFAULTS.defaultView,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "TopNavBar REM tab navigation target",
  },
  "rem.showKanban": {
    key: "rem.showKanban", label: "Show REM Kanban",
    description: "Shows the REM Kanban navigation item",
    category: "rem_config", valueType: "boolean", defaultValue: REM_DEFAULTS.showKanban,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "AppSidebar REM Kanban navigation visibility",
  },
  "rem.showGantt": {
    key: "rem.showGantt", label: "Show REM Gantt",
    description: "Shows the REM Gantt navigation item",
    category: "rem_config", valueType: "boolean", defaultValue: REM_DEFAULTS.showGantt,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "AppSidebar REM Gantt navigation visibility",
  },
  "rem.showFieldStatus": {
    key: "rem.showFieldStatus", label: "Show Field Status",
    description: "Shows the REM Field Status navigation item",
    category: "rem_config", valueType: "boolean", defaultValue: REM_DEFAULTS.showFieldStatus,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "AppSidebar REM Field Status navigation visibility",
  },
  "roles.policy": {
    key: "roles.policy", label: "Role Capability Policy",
    description: "Effective capabilities per role. May only remove optional capabilities inside immutable ceilings; mandatory recovery access cannot be removed.",
    category: "roles", valueType: "json", defaultValue: ROLE_POLICY_DEFAULT,
    requiredCapability: "admin.system_settings.manage", sensitivity: "sensitive",
    requiresReload: false, editable: true, public: false,
    consumer: "authGuard.requireCapability server-side enforcement",
  },
  "roles.superuserDefaultRoute": {
    key: "roles.superuserDefaultRoute", label: "Superuser Default Route",
    description: "Dashboard route opened when a Superuser logs in",
    category: "roles", valueType: "string", defaultValue: ROLE_ROUTE_DEFAULTS.superuserDefaultRoute,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "RoleLogin navigation after superuser sign-in; App root redirect",
  },
  "roles.engineerDefaultRoute": {
    key: "roles.engineerDefaultRoute", label: "Engineer Default Route",
    description: "Dashboard route opened when an Engineer logs in",
    category: "roles", valueType: "string", defaultValue: ROLE_ROUTE_DEFAULTS.engineerDefaultRoute,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "RoleLogin navigation after engineer sign-in; App root redirect",
  },
  "roles.viewerDefaultRoute": {
    key: "roles.viewerDefaultRoute", label: "Viewer Default Route",
    description: "Dashboard route opened when a Viewer logs in",
    category: "roles", valueType: "string", defaultValue: ROLE_ROUTE_DEFAULTS.viewerDefaultRoute,
    requiredCapability: "admin.system_settings.manage", sensitivity: "normal",
    requiresReload: false, editable: true, public: true,
    consumer: "RoleLogin navigation after viewer sign-in; App root redirect",
  },
};

export const ALL_CONFIG_KEYS = Object.keys(CONFIG_ENTRIES) as AllConfigKey[];

/** Exact literal union of every config key. */
export type AllConfigKey = keyof typeof CONFIG_ENTRIES;

/** Keys whose published values are safe for unauthenticated rendering. */
export const PUBLIC_CONFIG_KEYS = ALL_CONFIG_KEYS.filter((key) => CONFIG_ENTRIES[key].public);

// ─── Scalar validation table ─────────────────────────────────────────────

interface StringRule {
  min: number;
  max: number;
  pattern?: RegExp;
  enum?: readonly string[];
}

const STRING_RULES: Record<string, StringRule> = {
  "brand.appTitle": { min: 1, max: 64 },
  "brand.sidebarTitle": { min: 1, max: 64 },
  "brand.sidebarSubtitle": { min: 1, max: 128 },
  "theme.defaultMode": { min: 1, max: 16, enum: THEME_MODES },
  "defaults.partType": { min: 1, max: 16, enum: PART_TYPES },
  "defaults.currency": { min: 1, max: 8, pattern: /^[\p{L}\p{Sc}]+$/u },
  "defaults.dateFormat": { min: 1, max: 32, enum: DATE_FORMATS },
  "defaults.timezone": { min: 3, max: 64, pattern: /^(local|[A-Za-z0-9_+\-/]{3,64})$/ },
  "rem.defaultView": { min: 1, max: 16, enum: REM_VIEWS },
  "roles.superuserDefaultRoute": { min: 1, max: 64, pattern: /^\// },
  "roles.engineerDefaultRoute": { min: 1, max: 64, pattern: /^\// },
  "roles.viewerDefaultRoute": { min: 1, max: 64, pattern: /^\// },
};

interface NumberRule {
  min: number;
  max: number;
}

const NUMBER_RULES: Record<string, NumberRule> = {
  "thresholds.agedInventoryDays": { min: 30, max: 1825 },
};

const BOOLEAN_KEYS = new Set<string>([
  "features.remImportEnabled",
  "features.cycleCountEnabled",
  "features.kitAnalysisEnabled",
  "features.sapExportEnabled",
  "rem.showKanban",
  "rem.showGantt",
  "rem.showFieldStatus",
]);

// ─── Central validation entry point ──────────────────────────────────────

const STRUCTURED_VALIDATORS: Record<string, (value: unknown) => ValidationOutcome> = {
  "engineer.view": validateEngineerView,
  "nav.inventoryItems": (v) => validateNavItems(v, "Inventory navigation items", true),
  "nav.remItems": (v) => validateNavItems(v, "REM navigation items", true),
  "nav.inventoryReports": (v) => validateNavItems(v, "Report navigation items", false),
  "nav.itemOrder": validateItemOrder,
  "nav.routeLabels": validateRouteLabels,
  "dashboard.modules": validateDashboardModules,
  "theme.availableModes": validateThemeAvailableModes,
  "tables.stockSummary.columns": validateStockSummaryColumns,
  "tables.transactionSearch.columns": validateTransactionSearchFields,
  "charts.abcAnalysis": validateAbcChart,
  "charts.inventoryTurnover": validateTurnoverChart,
  "charts.remProgress": validateRemProgressChart,
  "reports.definitions": validateReportDefinitions,
  "forms.partMasterFields": validatePartMasterFields,
  "roles.policy": validateRolePolicyValue,
};

/**
 * Validate a config value against the shared contract. Used by the server
 * on every draft/import/publish/rollback write and by the browser editor
 * before submission, so the two sides can never diverge.
 */
export function validateConfigValue(key: string, value: unknown): ValidationOutcome {
  const entry = CONFIG_ENTRIES[key];
  if (!entry) return fail(`Unknown config key: ${key}`);
  if (!entry.editable) return fail(`Config key ${key} is not editable`);

  const stringRule = STRING_RULES[key];
  if (stringRule) {
    if (typeof value !== "string") return fail(`${entry.label} must be a string`);
    if (CONTROL_CHARS.test(value)) return fail(`${entry.label} must not contain control characters`);
    if (value.length < stringRule.min || value.length > stringRule.max) {
      return fail(`${entry.label} must be ${stringRule.min}-${stringRule.max} characters`);
    }
    if (stringRule.enum && !(stringRule.enum as readonly string[]).includes(value)) {
      return fail(`${entry.label} must be one of: ${stringRule.enum.join(", ")}`);
    }
    if (stringRule.pattern && !stringRule.pattern.test(value)) {
      return fail(`${entry.label} format is invalid`);
    }
    return ok();
  }

  const numberRule = NUMBER_RULES[key];
  if (numberRule) {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
      return fail(`${entry.label} must be a finite integer`);
    }
    if (value < numberRule.min || value > numberRule.max) {
      return fail(`${entry.label} must be between ${numberRule.min} and ${numberRule.max}`);
    }
    return ok();
  }

  if (BOOLEAN_KEYS.has(key)) {
    if (typeof value !== "boolean") return fail(`${entry.label} must be a boolean`);
    return ok();
  }

  const structuredValidator = STRUCTURED_VALIDATORS[key];
  if (structuredValidator) return structuredValidator(value);

  return fail(`Config key ${key} has no validator`);
}

/** Validate a batch of values; returns all errors (never throws). */
export function validateConfigValues(
  entries: Array<{ key: string; value: unknown }>,
): { valid: boolean; errors: Array<{ key: string; message: string }> } {
  const errors: Array<{ key: string; message: string }> = [];
  for (const { key, value } of entries) {
    const result = validateConfigValue(key, value);
    if (!result.valid) errors.push({ key, message: result.error ?? "Invalid value" });
  }
  return { valid: errors.length === 0, errors };
}

// ─── Registry access API ─────────────────────────────────────────────────

export function getConfigEntry(key: string): ConfigEntryDef | undefined {
  return Object.prototype.hasOwnProperty.call(CONFIG_ENTRIES, key) ? CONFIG_ENTRIES[key] : undefined;
}

export function getAllConfigEntries(): ConfigEntryDef[] {
  return ALL_CONFIG_KEYS.map((key) => CONFIG_ENTRIES[key]);
}

export function getConfigEntriesByCategory(): Record<ConfigCategory, ConfigEntryDef[]> {
  const grouped: Partial<Record<ConfigCategory, ConfigEntryDef[]>> = {};
  for (const entry of getAllConfigEntries()) {
    (grouped[entry.category] ??= []).push(entry);
  }
  return grouped as Record<ConfigCategory, ConfigEntryDef[]>;
}

export function getAllConfigKeys(): string[] {
  return [...ALL_CONFIG_KEYS];
}

export function getConfigDefault(key: string): unknown {
  return CONFIG_ENTRIES[key]?.defaultValue;
}

export function getConfigRequiredCapability(key: string): Capability {
  return CONFIG_ENTRIES[key]?.requiredCapability ?? "admin.system_settings.manage";
}

export function isPublicConfigKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONFIG_ENTRIES, key) ? CONFIG_ENTRIES[key].public : false;
}

/** Resolve a value: overlay (preview) first, then published, then default. */
export function resolveConfigValue(
  key: string,
  publishedValues: Map<string, unknown>,
  overlayValues?: Map<string, unknown>,
): unknown {
  if (overlayValues?.has(key)) return overlayValues.get(key);
  if (publishedValues.has(key)) return publishedValues.get(key);
  return getConfigDefault(key);
}

// ─── Canonical serialization / digests ───────────────────────────────────

/**
 * Deterministic JSON serialization used for content digests (publish
 * exact-review checks and import idempotency). Object keys are sorted.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/**
 * Content digest for a single config value. Always returns the full canonical
 * JSON representation for exact equality — the contract size-limits all
 * values (IMPORT_MAX_SERIALIZED_CHARS = 262 KB, < 48 keys), so the full
 * serialization is bounded and safe for idempotency receipts and exact-review
 * checks. No hash, no truncation, no prefix: two values with a changed suffix
 * after any byte offset cannot produce the same digest.
 */
export function valueDigest(value: unknown): string {
  return canonicalJson(value);
}

// ─── Import/export envelope ──────────────────────────────────────────────

export const IMPORT_SCHEMA_VERSION = 1;
export const IMPORT_MAX_ENTRIES = 48;
export const IMPORT_MAX_SERIALIZED_CHARS = 262_144;

export interface ImportEnvelope {
  schemaVersion: number;
  exportedAt?: number;
  entries: Array<{ key: string; value: unknown; version?: number }>;
}

export interface NormalizedImportEntry {
  key: string;
  value: unknown;
}

export interface ImportEnvelopeResult {
  valid: boolean;
  error?: string;
  entries?: NormalizedImportEntry[];
}

/**
 * Strict import envelope validation: fixed schema version, bounded size,
 * no duplicate keys, only known editable keys, every value validated by the
 * shared contract. This is the ONLY path by which imported values may reach
 * persistence, and export payloads must round-trip through it.
 *
 * Accepts optional informational metadata produced by export (exportedAt at
 * root, version on entries) but normalizes to key/value only for validation.
 * Rejects unknown properties. Empty entries array is valid for empty roundtrip.
 */
export function validateImportEnvelope(raw: unknown): ImportEnvelopeResult {
  if (!isPlainObject(raw)) return { valid: false, error: "Import payload must be an object" };
  const propCheck = checkExactProperties(raw, ["schemaVersion", "exportedAt", "entries"], "Import payload");
  if (!propCheck.valid) return { valid: false, error: propCheck.error };
  if (raw.schemaVersion !== IMPORT_SCHEMA_VERSION) {
    return { valid: false, error: `Unsupported import schema version ${String(raw.schemaVersion)}` };
  }
  // exportedAt is optional but if present must be a positive integer timestamp
  if (raw.exportedAt !== undefined) {
    if (typeof raw.exportedAt !== "number" || !Number.isInteger(raw.exportedAt) || raw.exportedAt <= 0) {
      return { valid: false, error: "exportedAt must be a positive integer timestamp" };
    }
  }
  if (!Array.isArray(raw.entries)) return { valid: false, error: "Import entries must be an array" };
  if (raw.entries.length > IMPORT_MAX_ENTRIES) {
    return { valid: false, error: `Import payload exceeds ${IMPORT_MAX_ENTRIES} entries` };
  }
  const serializedLength = canonicalJson(raw).length;
  if (serializedLength > IMPORT_MAX_SERIALIZED_CHARS) {
    return { valid: false, error: "Import payload exceeds the size limit" };
  }
  const seen = new Set<string>();
  const entries: NormalizedImportEntry[] = [];
  for (const rawEntry of raw.entries) {
    if (!isPlainObject(rawEntry)) return { valid: false, error: "Import entries must be objects" };
    const entryCheck = checkExactProperties(rawEntry, ["key", "value", "version"], "Import entry");
    if (!entryCheck.valid) return { valid: false, error: entryCheck.error };
    const key = rawEntry.key;
    if (typeof key !== "string") return { valid: false, error: "Import entry key must be a string" };
    if (!CONFIG_ENTRIES[key]) return { valid: false, error: `Import entry key "${key}" is not a known config key` };
    if (seen.has(key)) return { valid: false, error: `Import entry key "${key}" is duplicated` };
    seen.add(key);
    // version is optional but if present must be a non-negative integer
    if (rawEntry.version !== undefined) {
      if (typeof rawEntry.version !== "number" || !Number.isInteger(rawEntry.version) || rawEntry.version < 0) {
        return { valid: false, error: `Import entry version for "${key}" must be a non-negative integer` };
      }
    }
    const valueCheck = validateConfigValue(key, rawEntry.value);
    if (!valueCheck.valid) return { valid: false, error: `${key}: ${valueCheck.error}` };
    entries.push({ key, value: rawEntry.value });
  }
  return { valid: true, entries };
}

/** Digest of a normalized import payload (for idempotency receipts). */
export function importPayloadDigest(entries: NormalizedImportEntry[]): string {
  return canonicalJson({
    schemaVersion: IMPORT_SCHEMA_VERSION,
    entries: entries.map((e) => ({ key: e.key, value: e.value })),
  });
}

// ─── Category display metadata (admin UI) ────────────────────────────────

export const CATEGORY_LABELS: Record<ConfigCategory, string> = {
  branding: "Branding & Titles",
  navigation: "Navigation & Sidebar",
  dashboard: "Dashboard Modules",
  theme: "Theme & Appearance",
  tables: "Table Columns & Layout",
  charts: "Chart Configuration",
  reports: "Report Definitions",
  thresholds: "Alerts & Thresholds",
  forms: "Form Configuration",
  feature_flags: "Feature Flags",
  system_defaults: "System Defaults",
  rem_config: "REM Configuration",
  roles: "Role Capability Policy",
};

export const CATEGORY_ICONS: Record<ConfigCategory, string> = {
  branding: "🏷️",
  navigation: "🧭",
  dashboard: "📊",
  theme: "🎨",
  tables: "📋",
  charts: "📈",
  reports: "📑",
  thresholds: "🔔",
  forms: "📝",
  feature_flags: "🚩",
  system_defaults: "⚙️",
  rem_config: "🏭",
  roles: "🔐",
};
