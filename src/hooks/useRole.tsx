import { createContext, useContext, useState, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";

type Role = "superuser" | "engineer" | "viewer" | null;
type AuthenticatedRole = Exclude<Role, null>;

function normalizeServerRole(role: unknown): AuthenticatedRole {
  if (role === "superuser" || role === "engineer" || role === "viewer") {
    return role;
  }
  // Unknown, stale, or corrupt stored roles must never unlock UI affordances.
  // Server capabilities remain the security authority; the browser fails closed
  // to the least-privileged authenticated presentation role.
  return "viewer";
}

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
    return saved === "rem" ? "rem" : "inventory";
  });

  // The server-authenticated Convex user is the only role authority. A browser
  // localStorage value can no longer elevate the UI or grant a server capability.
  const effectiveRole: Role = user === undefined
    ? null
    : user === null
      ? null
      : normalizeServerRole(user.role);

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
