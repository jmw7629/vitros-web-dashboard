import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
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
  const user = useQuery(api.auth.currentUser);
  const { signOut } = useAuthActions();
  const [activeTab, setActiveTab] = useState<"inventory" | "rem">(() => {
    const saved = localStorage.getItem("vitros-tab");
    return (saved as "inventory" | "rem") || "inventory";
  });

  // The server-authenticated Convex user is the only role authority. A browser
  // localStorage value can no longer elevate the UI or grant a server capability.
  const serverRole = user?.role as Role | undefined;
  const effectiveRole: Role = user === undefined
    ? null
    : user === null
      ? null
      : serverRole ?? "viewer";

  const handleSetRole = (r: Role) => {
    if (r === null) {
      localStorage.removeItem("vitros-role");
      localStorage.removeItem("vitros-tab");
      void signOut().catch(() => undefined);
      return;
    }
    // Presentation hint only; effectiveRole above never reads this value.
    localStorage.setItem("vitros-role", r);
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
