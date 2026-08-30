import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import { RoleProvider } from "./hooks/useRole";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ConvexDataProvider } from "./hooks/useConvexData";
import "./index.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark">
      {convex ? (
        <ConvexProvider client={convex}>
          <ConvexDataProvider>
            <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <RoleProvider>
                <App />
              </RoleProvider>
            </BrowserRouter>
          </ConvexDataProvider>
        </ConvexProvider>
      ) : (
        <ConvexDataProvider>
          <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <RoleProvider>
              <App />
            </RoleProvider>
          </BrowserRouter>
        </ConvexDataProvider>
      )}
    </ThemeProvider>
  </StrictMode>,
);
