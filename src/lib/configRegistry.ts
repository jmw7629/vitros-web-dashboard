/**
 * VITROS Configuration Registry — browser re-export of the single shared
 * contract defined in convex/configContract.ts. The backend and browser
 * must never diverge; this file is the browser's sole entry point.
 *
 * Security invariants are enforced by the shared contract:
 * - Secrets, credentials, PIN hashes are NEVER in this registry.
 * - Inventory quantities, ledger records, audit history are NOT configurable.
 * - Canonical formulas and employee identity barriers are NOT configurable.
 */

export {
  // Types
  type AllConfigKey,
  type ConfigEntryDef,
  type ConfigCategory,
  type ConfigValueType,
  type ConfigSensitivity,
  type Capability,
  type RoleName,
  type RolePolicy,
  type NavItemConfig,
  type DashboardModuleConfig,
  type StockSummaryColumnConfig,
  type TransactionSearchFieldConfig,
  type PartMasterFieldConfig,
  type AbcChartConfig,
  type TurnoverChartConfig,
  type RemProgressChartConfig,
  type ReportDefinitionConfig,
  type ValidationOutcome,

  // Constants
  CONFIG_ENTRIES,
  ALL_CONFIG_KEYS,
  PUBLIC_CONFIG_KEYS,
  CAPABILITIES,
  ROLE_CAPABILITY_CEILINGS,
  ROLE_MANDATORY_CAPABILITIES,
  DEFAULT_ROLE_CAPABILITIES,
  KNOWN_ROUTES,
  NAV_SECTIONS,
  NAV_ICONS,
  NAV_GRADIENTS,
  THEME_MODES,
  REM_VIEWS,
  STOCK_SUMMARY_COLUMN_KEYS,
  TRANSACTION_SEARCH_FIELD_KEYS,
  PART_MASTER_FIELD_KEYS,
  DASHBOARD_METRICS,
  DASHBOARD_LIST_SOURCES,
  REPORT_SECTION_IDS,
  PART_TYPES,
  DATE_FORMATS,
  CATEGORY_LABELS,
  CATEGORY_ICONS,
  IMPORT_SCHEMA_VERSION,
  IMPORT_MAX_ENTRIES,
  IMPORT_MAX_SERIALIZED_CHARS,

  // Validation
  validateConfigValue,
  validateConfigValues,
  validateRolePolicyValue,

  // Registry access
  getConfigEntry,
  getAllConfigEntries,
  getConfigEntriesByCategory,
  getAllConfigKeys,
  getConfigDefault,
  getConfigRequiredCapability,
  isPublicConfigKey,
  resolveConfigValue,

  // Canonical serialization
  canonicalJson,
  valueDigest,

  // Import/export
  validateImportEnvelope,
  importPayloadDigest,

  // Role policy
  effectiveRoleCapabilities,
} from "../../convex/configContract";
