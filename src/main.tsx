import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import App from "./App";
import { RoleProvider } from "./hooks/useRole";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ConvexDataProvider } from "./hooks/useConvexData";
import { RealtimeRefreshBridge } from "./components/RealtimeRefreshBridge";
import { ConfigProvider } from "./components/ConfigProvider";
import "./index.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

function UnavailableState() {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      backgroundColor: "#0f172a",
      color: "#e2e8f0",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      <div style={{ textAlign: "center", maxWidth: 480, padding: 32 }}>
        <div style={{
          width: 64,
          height: 64,
          borderRadius: 16,
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 28,
          fontWeight: 900,
          color: "#fff",
          margin: "0 auto 24px",
        }}>
          V
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>VITROS</h1>
        <p style={{ fontSize: 14, color: "#94a3b8", marginBottom: 24 }}>
          The dashboard is temporarily unavailable. Please try again shortly.
        </p>

      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {convex ? (
      <ConvexAuthProvider client={convex}>
        <ConvexDataProvider>
          <ConfigProvider>
            <ThemeProvider>
              <RealtimeRefreshBridge />
              <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <RoleProvider>
                  <App />
                </RoleProvider>
              </BrowserRouter>
            </ThemeProvider>
          </ConfigProvider>
        </ConvexDataProvider>
      </ConvexAuthProvider>
    ) : (
      <UnavailableState />
    )}
  </StrictMode>,
);
