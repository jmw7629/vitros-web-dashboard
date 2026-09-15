import { useRole } from "../hooks/useRole";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ExecutiveDashboard } from "./inventory/ExecutiveDashboard";

export function DashboardPage() {
  const { role } = useRole();
  const navigate = useNavigate();

  // Redirect based on role
  useEffect(() => {
    if (!role) return;
    switch (role) {
      case "superuser":
        // Superuser gets the configurable Executive Dashboard
        // Stay on /dashboard
        break;
      case "engineer":
        navigate("/engineer-dashboard", { replace: true });
        break;
      case "viewer":
        // Viewers get read-only executive dashboard
        break;
      default:
        navigate("/dashboard", { replace: true });
    }
  }, [role, navigate]);

  // Render nothing during redirect
  if (role === "engineer") return null;

  // For superuser and viewer, render the configurable dashboard
  return <ExecutiveDashboard />;
}