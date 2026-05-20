import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { RoleProvider } from "./hooks/useRole";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ConvexDataProvider } from "./hooks/useConvexData";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider defaultTheme="dark">
      <ConvexDataProvider>
        <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <RoleProvider>
            <App />
          </RoleProvider>
        </BrowserRouter>
      </ConvexDataProvider>
    </ThemeProvider>
  </StrictMode>,
);
