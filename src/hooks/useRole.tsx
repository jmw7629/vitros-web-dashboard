import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

type Role = "superuser" | "engineer" | "viewer" | null;

interface RoleContextType {
  role: Role;
  setRole: (role: Role) => void;
  activeTab: "inventory" | "rem";
  setActiveTab: (tab: "inventory" | "rem") => void;
}

const RoleContext = createContext<RoleContextType>({
  role: null,
  setRole: () => {},
  activeTab: "inventory",
  setActiveTab: () => {},
});

export function RoleProvider({ children }: { children: ReactNode }) {
  // Server-authoritative role from Convex Auth user record.
  // `undefined` means the query is still resolving. Fail closed rather than
  // trusting a localStorage role for an authenticated session.
  const user = useQuery(api.auth.currentUser);
  const [localRole, setLocalRole] = useState<Role>(() => {
    const saved = localStorage.getItem("vitros-role");
    return (saved as Role) || null;
  });
  const [activeTab, setActiveTab] = useState<"inventory" | "rem">(() => {
    const saved = localStorage.getItem("vitros-tab");
    return (saved as "inventory" | "rem") || "inventory";
  });

  const serverRole: Role = user?.role as Role;
  const effectiveRole: Role = user === undefined ? null : (serverRole ?? "viewer");

  const handleSetRole = (r: Role) => {
    // Presentation-only compatibility mirror. This value never authorizes
    // authenticated users and is intentionally excluded from effectiveRole.
    setLocalRole(r);
    if (r) localStorage.setItem("vitros-role", r);
    else localStorage.removeItem("vitros-role");
  };

  const handleSetTab = (t: "inventory" | "rem") => {
    setActiveTab(t);
    localStorage.setItem("vitros-tab", t);
  };

  // Keep localRole alive only for legacy presentation compatibility and to
  // avoid silently changing existing localStorage behavior.
  void localRole;

  return (
    <RoleContext.Provider value={{ role: effectiveRole, setRole: handleSetRole, activeTab, setActiveTab: handleSetTab }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
