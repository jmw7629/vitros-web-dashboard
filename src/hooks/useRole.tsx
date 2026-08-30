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
  // For authenticated sessions, never elevate from localStorage while the
  // server role is unresolved or missing. Missing role fails closed to viewer.
  const user = useQuery(api.auth.currentUser);
  const [localRole, setLocalRole] = useState<Role>(() => {
    const saved = localStorage.getItem("vitros-role");
    return (saved as Role) || null;
  });
  const [activeTab, setActiveTab] = useState<"inventory" | "rem">(() => {
    const saved = localStorage.getItem("vitros-tab");
    return (saved as "inventory" | "rem") || "inventory";
  });

  const serverRole = user?.role as Role | undefined;
  const effectiveRole: Role = user === undefined
    ? "viewer"
    : user === null
      ? localRole
      : serverRole ?? "viewer";

  const handleSetRole = (r: Role) => {
    // Legacy role selection remains presentation-only. Authorization is enforced
    // on the server by Convex capabilities.
    setLocalRole(r);
    if (r) localStorage.setItem("vitros-role", r);
    else localStorage.removeItem("vitros-role");
  };

  const handleSetTab = (t: "inventory" | "rem") => {
    setActiveTab(t);
    localStorage.setItem("vitros-tab", t);
  };

  return (
    <RoleContext.Provider value={{ role: effectiveRole, setRole: handleSetRole, activeTab, setActiveTab: handleSetTab }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
