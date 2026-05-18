import { createContext, useContext, useState, type ReactNode } from "react";

type Role = "superuser" | "engineer" | null;

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
  const [role, setRole] = useState<Role>(() => {
    const saved = localStorage.getItem("vitros-role");
    return (saved as Role) || null;
  });
  const [activeTab, setActiveTab] = useState<"inventory" | "rem">(() => {
    const saved = localStorage.getItem("vitros-tab");
    return (saved as "inventory" | "rem") || "inventory";
  });

  const handleSetRole = (r: Role) => {
    setRole(r);
    if (r) localStorage.setItem("vitros-role", r);
    else localStorage.removeItem("vitros-role");
  };

  const handleSetTab = (t: "inventory" | "rem") => {
    setActiveTab(t);
    localStorage.setItem("vitros-tab", t);
  };

  return (
    <RoleContext.Provider value={{ role, setRole: handleSetRole, activeTab, setActiveTab: handleSetTab }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
