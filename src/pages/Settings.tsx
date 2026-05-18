import { useState } from "react";
import { useConvexData } from "../hooks/useConvexData";
import { WebCard, DashCard, StatusBadge, theme } from "../components/vitros/SharedComponents";
import { useRole } from "../hooks/useRole";
import { Plus, Pencil, Power, Trash2, X, Check, Shield, Lock } from "lucide-react";

export function Settings() {
  const data = useConvexData();
  const { role, setRole } = useRole();
  const isAdmin = role === "superuser";

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

        {/* Add Employee Form (inline, above list) */}
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
                  // Auto-generate initials
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

        {/* Employee List */}
        <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
          {data.employees.map(emp => (
            <div key={emp._id}>
              {/* Editing row */}
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
                /* Normal row */
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

                  {/* Admin action buttons */}
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

              {/* Confirm deactivate/activate overlay */}
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

        {/* Engineer notice */}
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

      {/* Danger Zone — superuser only */}
      {isAdmin && (
        <WebCard className="p-4">
          <h3 className="text-sm font-bold mb-3" style={{ color: theme.statusOut }}>⚠️ Danger Zone</h3>
          <p className="text-xs mb-3" style={{ color: theme.textSecondary }}>Data reset is irreversible. This will clear all transactions, parts, and settings.</p>
          <button className="px-4 py-2 rounded-xl text-sm font-bold text-white" style={{ backgroundColor: theme.statusOut }}>
            Reset All Data
          </button>
        </WebCard>
      )}
    </div>
  );
}
