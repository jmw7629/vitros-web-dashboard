import { useMemo, useState } from "react";
import { useConvexData } from "../../hooks/useConvexData";
import { WebCard, StatusBadge, DashCard, theme, modeColor, formatDate } from "../../components/vitros/SharedComponents";
import { Search, X, ChevronDown } from "lucide-react";

export function UserDashboard() {
  const data = useConvexData();
  const [selectedEmployee, setSelectedEmployee] = useState<string>("");
  const [empSearch, setEmpSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);

  const activeEmployees = data.employees.filter(e => e.active);

  // Filter employees by search
  const filteredEmployees = useMemo(() => {
    if (!empSearch) return activeEmployees;
    const q = empSearch.toLowerCase();
    return activeEmployees.filter(e =>
      e.name.toLowerCase().includes(q) ||
      e.initials.toLowerCase().includes(q) ||
      (e.email || "").toLowerCase().includes(q)
    );
  }, [activeEmployees, empSearch]);

  // Data for selected employee
  const empData = useMemo(() => {
    if (!selectedEmployee) return null;
    const emp = data.employees.find(e => e.name === selectedEmployee);
    if (!emp) return null;

    const nameLC = emp.name.toLowerCase();
    const initLC = emp.initials.toLowerCase();

    const empTxns = data.transactions.filter(t => {
      const u = (t.user || "").toLowerCase();
      return u === nameLC || u === initLC || u === emp.name || u === emp.initials;
    }).sort((a, b) => b.timestamp - a.timestamp);

    const empLogs = data.stockLog.filter(l => {
      const batch = data.batches.find((b: any) => b.intakeBatchId === l.intakeBatchId);
      const createdBy = ((batch as any)?.createdBy || "").toLowerCase();
      return createdBy === nameLC || createdBy === initLC;
    });

    const totalOut = empTxns.filter(t => t.mode === "OUT").reduce((s, t) => s + t.qty, 0);
    const totalIn = empTxns.filter(t => t.mode === "IN" || t.mode === "RECEIVE").reduce((s, t) => s + t.qty, 0);
    const totalReceived = empLogs.reduce((s, l) => s + l.qtyAdded, 0);

    return { emp, transactions: empTxns, stockLogs: empLogs, totalOut, totalIn, totalReceived };
  }, [selectedEmployee, data.employees, data.transactions, data.stockLog, data.batches]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>👤 User Dashboard</h2>
        <p className="text-sm mt-0.5" style={{ color: theme.textSecondary }}>Select an employee to view their activity</p>
      </div>

      {/* Employee Selector Dropdown */}
      <WebCard className="p-4">
        <label className="text-[10px] font-bold uppercase block mb-2" style={{ color: theme.textMuted }}>
          Select Employee
        </label>
        <div className="relative">
          <div
            className="flex items-center gap-2 px-3 py-2.5 rounded-xl border cursor-pointer"
            style={{ borderColor: showDropdown ? "#6366f1" : theme.cardBorder, backgroundColor: "#111827" }}
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <Search className="w-4 h-4 flex-shrink-0" style={{ color: theme.textMuted }} />
            <input
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: theme.textPrimary }}
              placeholder="Type initials or name to search..."
              value={showDropdown ? empSearch : selectedEmployee}
              onChange={e => { setEmpSearch(e.target.value); setShowDropdown(true); }}
              onFocus={() => setShowDropdown(true)}
            />
            {selectedEmployee && !showDropdown ? (
              <button onClick={(e) => { e.stopPropagation(); setSelectedEmployee(""); setEmpSearch(""); }}>
                <X className="w-4 h-4" style={{ color: theme.textMuted }} />
              </button>
            ) : (
              <ChevronDown className="w-4 h-4 flex-shrink-0" style={{ color: theme.textMuted }} />
            )}
          </div>

          {/* Dropdown results */}
          {showDropdown && (
            <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-xl border shadow-lg"
              style={{ borderColor: theme.cardBorder, backgroundColor: "#111827" }}>
              {filteredEmployees.length === 0 ? (
                <div className="px-4 py-3 text-sm text-center" style={{ color: theme.textMuted }}>
                  No employees found
                </div>
              ) : (
                filteredEmployees.map(emp => (
                  <button
                    key={emp._id}
                    onClick={() => {
                      setSelectedEmployee(emp.name);
                      setEmpSearch("");
                      setShowDropdown(false);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.05] transition-colors text-left border-b last:border-0"
                    style={{ borderColor: theme.cardBorder }}
                  >
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                      style={{ backgroundColor: "#6366f1" }}>
                      {emp.initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>{emp.name}</div>
                      {emp.email && (
                        <div className="text-[10px] truncate" style={{ color: theme.textMuted }}>{emp.email}</div>
                      )}
                    </div>
                    {selectedEmployee === emp.name && (
                      <span className="text-xs font-bold" style={{ color: "#6366f1" }}>✓</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </WebCard>

      {/* Employee Data */}
      {empData ? (
        <>
          {/* Employee info card */}
          <WebCard className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
                style={{ backgroundColor: "#6366f1" }}>
                {empData.emp.initials}
              </div>
              <div>
                <div className="text-sm font-bold" style={{ color: theme.textPrimary }}>{empData.emp.name}</div>
                {empData.emp.email ? (
                  <div className="text-xs" style={{ color: "#6366f1" }}>{empData.emp.email}</div>
                ) : (
                  <div className="text-xs" style={{ color: theme.textMuted }}>No email on file</div>
                )}
              </div>
            </div>
          </WebCard>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <DashCard label="TRANSACTIONS" value={empData.transactions.length} icon="🔄" color="#6366f1" />
            <DashCard label="PARTS OUT" value={empData.totalOut} icon="📤" color={theme.statusOut} />
            <DashCard label="PARTS IN" value={empData.totalIn} icon="📥" color={theme.statusOk} />
            <DashCard label="RECEIVED" value={empData.totalReceived} icon="📦" color="#f59e0b" />
          </div>

          {/* Transaction history */}
          {empData.transactions.length > 0 && (
            <WebCard className="overflow-hidden">
              <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
                <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Recent Transactions</h3>
              </div>
              <div className="divide-y max-h-[50vh] overflow-y-auto" style={{ borderColor: theme.cardBorder }}>
                {empData.transactions.slice(0, 50).map((tx: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <StatusBadge text={tx.mode} color={modeColor(tx.mode)} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>{tx.partNumber}</div>
                      <div className="text-[10px]" style={{ color: theme.textMuted }}>{tx.description}</div>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-bold" style={{ color: tx.mode === "OUT" ? theme.statusOut : theme.statusOk }}>
                        {tx.mode === "OUT" ? "" : "+"}{tx.qty}
                      </span>
                      <div className="text-[9px]" style={{ color: theme.textMuted }}>{formatDate(tx.timestamp)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </WebCard>
          )}

          {/* Stock received logs */}
          {empData.stockLogs.length > 0 && (
            <WebCard className="overflow-hidden">
              <div className="px-4 py-3 border-b" style={{ borderColor: theme.cardBorder }}>
                <h3 className="text-sm font-bold" style={{ color: theme.textPrimary }}>Stock Received</h3>
              </div>
              <div className="divide-y" style={{ borderColor: theme.cardBorder }}>
                {empData.stockLogs.slice(0, 30).map((l: any, i: number) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium" style={{ color: theme.textPrimary }}>{l.partNumber}</div>
                      <div className="text-[10px]" style={{ color: theme.textMuted }}>Batch: {l.intakeBatchId}</div>
                    </div>
                    <span className="text-sm font-bold" style={{ color: theme.statusOk }}>+{l.qtyAdded}</span>
                  </div>
                ))}
              </div>
            </WebCard>
          )}

          {/* No activity */}
          {empData.transactions.length === 0 && empData.stockLogs.length === 0 && (
            <WebCard className="p-8 text-center">
              <div className="text-2xl opacity-30 mb-2">📋</div>
              <div className="text-sm" style={{ color: theme.textSecondary }}>
                No activity recorded for {selectedEmployee} yet.
              </div>
            </WebCard>
          )}
        </>
      ) : (
        /* Empty state */
        <WebCard className="p-8 text-center">
          <div className="text-3xl opacity-30 mb-3">👤</div>
          <div className="text-sm font-medium" style={{ color: theme.textSecondary }}>Select an employee above to view their dashboard</div>
          <div className="text-xs mt-1" style={{ color: theme.textMuted }}>
            {activeEmployees.length} active employees
          </div>
        </WebCard>
      )}
    </div>
  );
}
