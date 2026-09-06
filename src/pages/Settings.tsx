import { useEffect, useState } from "react";
import { useConvexData } from "../hooks/useConvexData";
import { useServerActions, type EditableSettingKey, type EnterpriseSettingRow } from "../hooks/useServerActions";
import { WebCard, StatusBadge, theme } from "../components/vitros/SharedComponents";
import { useRole } from "../hooks/useRole";
import { Plus, Pencil, Power, X, Check, Shield, Lock } from "lucide-react";

const SETTING_DEFINITIONS: Array<{
  key: EditableSettingKey;
  label: string;
  description: string;
  placeholder: string;
}> = [
  { key: "sapPlantCode", label: "SAP Plant", description: "Plant code used for staged SAP movements", placeholder: "US08" },
  { key: "sapStorageLocation", label: "Storage Location", description: "SAP storage location for staged inventory movements", placeholder: "MAIN" },
  { key: "sapMovementIN", label: "IN Movement Type", description: "Three-digit SAP movement type for inventory receipts", placeholder: "101" },
  { key: "sapMovementOUT", label: "OUT Movement Type", description: "Three-digit SAP movement type for inventory consumption", placeholder: "261" },
  { key: "sapMovementADJUST", label: "ADJUST Movement Type", description: "Three-digit SAP movement type for approved adjustments", placeholder: "711" },
  { key: "sapHeaderText", label: "SAP Header Text", description: "Header text written to staged SAP movement records", placeholder: "VITROS Analyzer Consumption" },
];

function settingErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Enterprise settings request failed. Please retry.";
  const allowed = [
    "The setting changed. Refresh and review before saving again.",
    "Plant code must be 2-8 letters or digits",
    "Storage location must be 1-12 letters, digits, underscore, or hyphen",
    "SAP movement type must be three digits",
    "SAP header text must be 1-120 printable characters",
    "Enterprise settings service is not configured",
  ];
  return allowed.includes(error.message) ? error.message : "Enterprise settings request failed. Please retry.";
}

export function Settings() {
  const data = useConvexData();
  const { role, setRole } = useRole();
  const { listEditableSettings, updateEditableSetting } = useServerActions();
  const isAdmin = role === "superuser";

  // ── Enterprise operational settings ──
  const [enterpriseSettings, setEnterpriseSettings] = useState<EnterpriseSettingRow[]>([]);
  const [settingDrafts, setSettingDrafts] = useState<Partial<Record<EditableSettingKey, string>>>({});
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [savingSetting, setSavingSetting] = useState<EditableSettingKey | null>(null);
  const [savedSetting, setSavedSetting] = useState<EditableSettingKey | null>(null);
  const [settingsReloadToken, setSettingsReloadToken] = useState(0);

  // ── Add Employee state ──
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addInitials, setAddInitials] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  // ── Edit Employee state ──
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editInitials, setEditInitials] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // ── Confirm toggle active ──
  const [confirmToggleId, setConfirmToggleId] = useState<string | null>(null);
  const [toggleSaving, setToggleSaving] = useState(false);

  useEffect(() => {
    if (!isAdmin) {
      setEnterpriseSettings([]);
      setSettingDrafts({});
      setSettingsError(null);
      return;
    }

    let cancelled = false;
    setSettingsLoading(true);
    setSettingsError(null);
    setSavedSetting(null);

    listEditableSettings()
      .then((rows) => {
        if (cancelled) return;
        setEnterpriseSettings(rows);
        const drafts: Partial<Record<EditableSettingKey, string>> = {};
        for (const row of rows) drafts[row.key] = row.value;
        setSettingDrafts(drafts);
      })
      .catch((error) => {
        if (!cancelled) setSettingsError(settingErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, listEditableSettings, settingsReloadToken]);

  const handleSaveSetting = async (key: EditableSettingKey) => {
    const current = enterpriseSettings.find((row) => row.key === key);
    if (!current || savingSetting) return;
    const value = settingDrafts[key] ?? current.value;
    if (value === current.value) return;

    setSavingSetting(key);
    setSavedSetting(null);
    setSettingsError(null);
    try {
      const receipt = await updateEditableSetting({
        key,
        value,
        expectedVersion: current.version,
        correlationId: `settings:${key}:v${current.version}:${crypto.randomUUID()}`,
        reason: "Updated from VITROS Settings",
      });
      setEnterpriseSettings((rows) => rows.map((row) => row.key === key ? receipt : row));
      setSettingDrafts((drafts) => ({ ...drafts, [key]: receipt.value }));
      setSavedSetting(key);
    } catch (error) {
      setSettingsError(settingErrorMessage(error));
    } finally {
      setSavingSetting(null);
    }
  };

  const handleAddEmployee = async () => {
    if (!addName.trim()) return;
    setAddSaving(true);
    try {
      await data.addEmployee(addName.trim(), addInitials.trim() || addName.trim().split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2));
      setAddName("");
      setAddInitials("");
      setShowAddForm(false);
    } catch (e) {
      console.error("Failed to add employee:", e);
    }
    setAddSaving(false);
  };

  const handleEditEmployee = async () => {
    if (!editingId || !editName.trim()) return;
    setEditSaving(true);
    try {
      await data.updateEmployee(editingId, { name: editName.trim() });
      setEditingId(null);
    } catch (e) {
      console.error("Failed to update employee:", e);
    }
    setEditSaving(false);
  };

  const handleToggleActive = async (id: string, currentlyActive: boolean) => {
    setToggleSaving(true);
    try {
      await data.toggleEmployeeActive(id, currentlyActive);
      setConfirmToggleId(null);
    } catch (e) {
      console.error("Failed to toggle employee:", e);
    }
    setToggleSaving(false);
  };

  const startEdit = (emp: any) => {
    setEditingId(emp._id);
    setEditName(emp.name);
    setEditInitials(emp.initials);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>⚙️ Settings</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>System configuration and administration</p>
      </div>

      {/* Role */}
      <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>Current Role</h3>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" style={{ color: isAdmin ? "#a855f7" : "#22c55e" }} />
            <StatusBadge text={role || "Unknown"} color={isAdmin ? "#a855f7" : "#22c55e"} />
          </div>
          <button onClick={() => { setRole(null); window.location.href = "/"; }}
            className="text-xs font-medium ml-auto" style={{ color: theme.statusOut }}>
            Sign Out
          </button>
        </div>
      </WebCard>

      {/* ═══ ENTERPRISE OPERATIONAL SETTINGS ═══ */}
      <WebCard className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <div>
            <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>SAP Operational Settings</h3>
            <p className="text-[10px] mt-0.5" style={{ color: theme.textMuted }}>
              Versioned, audited configuration. Authorization is enforced by the server.
            </p>
          </div>
          {isAdmin && (
            <button
              onClick={() => setSettingsReloadToken((value) => value + 1)}
              disabled={settingsLoading || savingSetting !== null}
              className="px-2.5 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
              style={{ backgroundColor: theme.cardBg, color: theme.textSecondary }}
            >
              Refresh
            </button>
          )}
        </div>

        {!isAdmin ? (
          <div className="px-4 py-3 flex items-center gap-2">
            <Lock className="w-3 h-3" style={{ color: theme.textMuted }} />
            <span className="text-[10px]" style={{ color: theme.textMuted }}>
              Enterprise operational settings require superuser access
            </span>
          </div>
        ) : settingsLoading ? (
          <div className="px-4 py-6 text-center text-xs" style={{ color: theme.textSecondary }}>
            Loading authoritative settings...
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
            {SETTING_DEFINITIONS.map((definition) => {
              const current = enterpriseSettings.find((row) => row.key === definition.key);
              if (!current) return null;
              const draft = settingDrafts[definition.key] ?? current.value;
              const dirty = draft !== current.value;
              const isSaving = savingSetting === definition.key;
              return (
                <div key={definition.key} className="px-4 py-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold" style={{ color: theme.textPrimary }}>{definition.label}</div>
                      <div className="text-[10px] mt-0.5" style={{ color: theme.textMuted }}>{definition.description}</div>
                      <div className="text-[9px] mt-1" style={{ color: theme.textMuted }}>
                        Version {current.version}{current.updatedAt ? ` · Last updated ${new Date(current.updatedAt).toLocaleString()}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 w-full max-w-sm">
                      <input
                        value={draft}
                        placeholder={definition.placeholder}
                        onChange={(event) => {
                          setSavedSetting(null);
                          setSettingDrafts((drafts) => ({ ...drafts, [definition.key]: event.target.value }));
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && dirty && !isSaving) void handleSaveSetting(definition.key);
                        }}
                        disabled={savingSetting !== null}
                        className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-60"
                        style={{ borderColor: dirty ? "#6366f1" : theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
                        aria-label={definition.label}
                      />
                      <button
                        onClick={() => void handleSaveSetting(definition.key)}
                        disabled={!dirty || savingSetting !== null}
                        className="px-3 py-2 rounded-lg text-xs font-bold text-white disabled:opacity-35 transition-all"
                        style={{ backgroundColor: "#6366f1" }}
                        aria-label={`Save ${definition.label}`}
                      >
                        {isSaving ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </div>
                  {savedSetting === definition.key && (
                    <div className="text-[10px] mt-2 flex items-center gap-1" style={{ color: "#22c55e" }}>
                      <Check className="w-3 h-3" /> Saved and audited at version {current.version}
                    </div>
                  )}
                </div>
              );
            })}
            {enterpriseSettings.length === 0 && !settingsError && (
              <div className="px-4 py-6 text-center text-xs" style={{ color: theme.textSecondary }}>
                No editable operational settings are available.
              </div>
            )}
          </div>
        )}

        {isAdmin && settingsError && (
          <div className="px-4 py-3 border-t flex items-center gap-3" style={{ borderColor: theme.cardBorder, backgroundColor: "rgba(239,68,68,0.06)" }}>
            <span className="text-xs flex-1" role="alert" style={{ color: theme.statusOut }}>{settingsError}</span>
            <button
              onClick={() => setSettingsReloadToken((value) => value + 1)}
              className="px-3 py-1 rounded-lg text-xs font-bold"
              style={{ backgroundColor: theme.cardBg, color: theme.textSecondary }}
            >
              Refresh
            </button>
          </div>
        )}
      </WebCard>

      {/* ═══ EMPLOYEE MANAGEMENT ═══ */}
      <WebCard className="overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Employee Management</h3>
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: theme.cardBg, color: theme.textMuted }}>
              {data.employees.length}
            </span>
          </div>
          {isAdmin && (
            <button
              onClick={() => { setShowAddForm(true); setAddName(""); setAddInitials(""); }}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white transition-all hover:opacity-90"
              style={{ backgroundColor: "#6366f1" }}
            >
              <Plus className="w-3 h-3" /> Add Employee
            </button>
          )}
        </div>

        {isAdmin && showAddForm && (
          <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder, backgroundColor: "rgba(99,102,241,0.06)" }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold" style={{ color: "#6366f1" }}>New Employee</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 px-3 py-2 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ borderColor: theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
                placeholder="Full name..."
                value={addName}
                onChange={e => {
                  setAddName(e.target.value);
                  const auto = e.target.value.trim().split(" ").map(w => w[0] || "").join("").toUpperCase().slice(0, 2);
                  setAddInitials(auto);
                }}
                onKeyDown={e => e.key === "Enter" && handleAddEmployee()}
                autoFocus
              />
              <input
                className="w-16 px-2 py-2 rounded-lg text-sm border text-center outline-none focus:ring-2 focus:ring-indigo-500"
                style={{ borderColor: theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
                placeholder="IN"
                value={addInitials}
                onChange={e => setAddInitials(e.target.value.toUpperCase().slice(0, 3))}
                maxLength={3}
              />
              <button
                onClick={handleAddEmployee}
                disabled={!addName.trim() || addSaving}
                className="p-2 rounded-lg text-white disabled:opacity-40 transition-all"
                style={{ backgroundColor: "#22c55e" }}
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowAddForm(false)}
                className="p-2 rounded-lg transition-all"
                style={{ backgroundColor: theme.cardBg }}
              >
                <X className="w-4 h-4" style={{ color: theme.textMuted }} />
              </button>
            </div>
            {addSaving && (
              <div className="text-[10px] mt-1" style={{ color: "#6366f1" }}>Adding employee...</div>
            )}
          </div>
        )}

        <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
          {data.employees.map(emp => (
            <div key={emp._id}>
              {isAdmin && editingId === emp._id ? (
                <div className="flex items-center gap-3 px-4 py-2.5" style={{ backgroundColor: "rgba(99,102,241,0.06)" }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: "#6366f1" }}>
                    {editInitials || emp.initials}
                  </div>
                  <input
                    className="flex-1 px-2 py-1.5 rounded-lg text-sm border outline-none focus:ring-2 focus:ring-indigo-500"
                    style={{ borderColor: theme.cardBorder, backgroundColor: "#111827", color: theme.textPrimary }}
                    value={editName}
                    onChange={e => {
                      setEditName(e.target.value);
                      const auto = e.target.value.trim().split(" ").map(w => w[0] || "").join("").toUpperCase().slice(0, 2);
                      setEditInitials(auto);
                    }}
                    onKeyDown={e => e.key === "Enter" && handleEditEmployee()}
                    autoFocus
                  />
                  <button
                    onClick={handleEditEmployee}
                    disabled={!editName.trim() || editSaving}
                    className="p-1.5 rounded-lg text-white disabled:opacity-40"
                    style={{ backgroundColor: "#22c55e" }}
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => setEditingId(null)} className="p-1.5 rounded-lg" style={{ backgroundColor: theme.cardBg }}>
                    <X className="w-3.5 h-3.5" style={{ color: theme.textMuted }} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3 px-4 py-2.5 group">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ backgroundColor: emp.active ? "#6366f1" : "#64748b" }}>
                    {emp.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium" style={{ color: emp.active ? theme.textPrimary : theme.textMuted }}>
                      {emp.name}
                    </div>
                    <div className="text-[10px]" style={{ color: theme.textMuted }}>
                      {emp.initials}{emp.email ? ` · ${emp.email}` : ""}
                    </div>
                  </div>
                  <StatusBadge text={emp.active ? "Active" : "Inactive"} color={emp.active ? theme.statusOk : theme.textMuted} />

                  {isAdmin && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEdit(emp)}
                        className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" style={{ color: "#6366f1" }} />
                      </button>
                      <button
                        onClick={() => setConfirmToggleId(emp._id)}
                        className="p-1.5 rounded-lg hover:bg-white/[0.06] transition-colors"
                        title={emp.active ? "Deactivate" : "Activate"}
                      >
                        <Power className="w-3.5 h-3.5" style={{ color: emp.active ? theme.statusOut : "#22c55e" }} />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {isAdmin && confirmToggleId === emp._id && (
                <div className="px-4 py-2 border-t flex items-center gap-2"
                  style={{ borderColor: theme.cardBorder, backgroundColor: emp.active ? "rgba(239,68,68,0.06)" : "rgba(34,197,94,0.06)" }}>
                  <span className="text-xs flex-1" style={{ color: emp.active ? theme.statusOut : "#22c55e" }}>
                    {emp.active
                      ? `Deactivate ${emp.name}? They'll be removed from scan dropdowns.`
                      : `Reactivate ${emp.name}? They'll appear in scan dropdowns again.`}
                  </span>
                  <button
                    onClick={() => handleToggleActive(emp._id, emp.active)}
                    disabled={toggleSaving}
                    className="px-3 py-1 rounded-lg text-xs font-bold text-white disabled:opacity-40"
                    style={{ backgroundColor: emp.active ? theme.statusOut : "#22c55e" }}
                  >
                    {toggleSaving ? "..." : emp.active ? "Deactivate" : "Activate"}
                  </button>
                  <button
                    onClick={() => setConfirmToggleId(null)}
                    className="px-3 py-1 rounded-lg text-xs font-bold"
                    style={{ backgroundColor: theme.cardBg, color: theme.textMuted }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
          {data.employees.length === 0 && (
            <div className="py-6 text-center">
              <div className="text-2xl opacity-30 mb-1">👤</div>
              <div className="text-xs" style={{ color: theme.textSecondary }}>No employees yet</div>
            </div>
          )}
        </div>

        {!isAdmin && (
          <div className="px-4 py-2.5 border-t flex items-center gap-2" style={{ borderColor: theme.cardBorder, backgroundColor: "rgba(255,255,255,0.02)" }}>
            <Lock className="w-3 h-3" style={{ color: theme.textMuted }} />
            <span className="text-[10px]" style={{ color: theme.textMuted }}>
              Employee management requires superuser access
            </span>
          </div>
        )}
      </WebCard>

      {/* System Info */}
      <WebCard className="p-4">
        <h3 className="text-sm font-bold mb-3" style={{ color: theme.textPrimary }}>System Info</h3>
        {[
          ["Total Parts", String(data.parts.length)],
          ["Total Transactions", String(data.transactions.length)],
          ["Kits Defined", String(data.kits.length)],
          ["Active Employees", String(data.employees.filter(e => e.active).length)],
          ["REM Analyzers", String(data.analyzers.length)],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between py-1.5 border-b last:border-0" style={{ borderColor: theme.cardBorder }}>
            <span className="text-xs" style={{ color: theme.textSecondary }}>{k}</span>
            <span className="text-xs font-bold" style={{ color: theme.textPrimary }}>{v}</span>
          </div>
        ))}
      </WebCard>

      {/* Danger Zone — superuser only; destructive reset intentionally fails closed. */}
      {isAdmin && (
        <WebCard className="p-4">
          <h3 className="text-sm font-bold mb-3" style={{ color: theme.statusOut }}>⚠️ Danger Zone</h3>
          <p id="reset-data-disabled-reason" className="text-xs mb-3" style={{ color: theme.textSecondary }}>
            Reset All Data is unavailable until a reviewed backup/restore workflow, server-authoritative approval, authorization, and immutable audit safeguards are in place.
          </p>
          <button
            disabled
            aria-disabled="true"
            aria-describedby="reset-data-disabled-reason"
            className="px-4 py-2 rounded-xl text-sm font-bold text-white cursor-not-allowed opacity-40"
            style={{ backgroundColor: theme.statusOut }}
          >
            Reset All Data — Unavailable
          </button>
        </WebCard>
      )}
    </div>
  );
}
