import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// ─── Theme Palettes ───
export interface ThemePalette {
  label: string;
  emoji: string;
  pageBg: string;
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  statusOk: string;
  statusLow: string;
  statusOut: string;
  statusOver: string;
  accentBlue: string;
  iconPurple: string;
  warning: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  borderColor: string;
  sidebarBg: string;
  sidebarActiveBg: string;
  sidebarBorder: string;
  sidebarText: string;
  inputBg: string;
  navBg: string;
  navBorder: string;
}

export const THEME_PALETTES: Record<string, ThemePalette> = {
  dark: {
    label: "Dark",
    emoji: "🌙",
    pageBg: "#0c111b",
    cardBg: "#1a2035",
    cardBorder: "#1e293b",
    textPrimary: "#f1f5f9",
    textSecondary: "#94a3b8",
    textMuted: "#64748b",
    statusOk: "#12a573",
    statusLow: "#EB9C26",
    statusOut: "#ef4545",
    statusOver: "#14b8d4",
    accentBlue: "#6366f1",
    iconPurple: "#8b5cf6",
    warning: "#EB9C26",
    chart1: "#21bda6",
    chart2: "#f59e14",
    chart3: "#14b8d4",
    chart4: "#f54f66",
    chart5: "#84cc16",
    borderColor: "#1e293b",
    sidebarBg: "#0f172a",
    sidebarActiveBg: "#1e293b",
    sidebarBorder: "#334155",
    sidebarText: "#cbd5e1",
    inputBg: "#111827",
    navBg: "#0f172a",
    navBorder: "#1e293b",
  },
  light: {
    label: "Light",
    emoji: "☀️",
    pageBg: "#f8fafc",
    cardBg: "#ffffff",
    cardBorder: "#e2e8f0",
    textPrimary: "#1e293b",
    textSecondary: "#475569",
    textMuted: "#94a3b8",
    statusOk: "#16a34a",
    statusLow: "#d97706",
    statusOut: "#dc2626",
    statusOver: "#0891b2",
    accentBlue: "#4f46e5",
    iconPurple: "#7c3aed",
    warning: "#d97706",
    chart1: "#14b8a6",
    chart2: "#f59e0b",
    chart3: "#06b6d4",
    chart4: "#ef4444",
    chart5: "#84cc16",
    borderColor: "#e2e8f0",
    sidebarBg: "#ffffff",
    sidebarActiveBg: "#f1f5f9",
    sidebarBorder: "#e2e8f0",
    sidebarText: "#334155",
    inputBg: "#f1f5f9",
    navBg: "#ffffff",
    navBorder: "#e2e8f0",
  },
  midnight: {
    label: "Midnight",
    emoji: "🔮",
    pageBg: "#0f0a1e",
    cardBg: "#1a1333",
    cardBorder: "#2d2250",
    textPrimary: "#e8e0f7",
    textSecondary: "#a78bdb",
    textMuted: "#6d5b95",
    statusOk: "#10b981",
    statusLow: "#f59e0b",
    statusOut: "#ef4444",
    statusOver: "#06b6d4",
    accentBlue: "#818cf8",
    iconPurple: "#a78bfa",
    warning: "#f59e0b",
    chart1: "#34d399",
    chart2: "#fbbf24",
    chart3: "#22d3ee",
    chart4: "#f87171",
    chart5: "#a3e635",
    borderColor: "#2d2250",
    sidebarBg: "#120d24",
    sidebarActiveBg: "#2d2250",
    sidebarBorder: "#3d3265",
    sidebarText: "#c4b5e0",
    inputBg: "#150f2a",
    navBg: "#120d24",
    navBorder: "#2d2250",
  },
  ocean: {
    label: "Ocean",
    emoji: "🌊",
    pageBg: "#0a1628",
    cardBg: "#0f2440",
    cardBorder: "#1a3a5c",
    textPrimary: "#e0f2fe",
    textSecondary: "#7dd3fc",
    textMuted: "#4a8ab5",
    statusOk: "#10b981",
    statusLow: "#f59e0b",
    statusOut: "#ef4444",
    statusOver: "#22d3ee",
    accentBlue: "#38bdf8",
    iconPurple: "#818cf8",
    warning: "#f59e0b",
    chart1: "#2dd4bf",
    chart2: "#fbbf24",
    chart3: "#38bdf8",
    chart4: "#fb7185",
    chart5: "#a3e635",
    borderColor: "#1a3a5c",
    sidebarBg: "#0c1a30",
    sidebarActiveBg: "#1a3a5c",
    sidebarBorder: "#2a4a70",
    sidebarText: "#bae6fd",
    inputBg: "#0d1e38",
    navBg: "#0c1a30",
    navBorder: "#1a3a5c",
  },
  vitros: {
    label: "VITROS Blue",
    emoji: "💎",
    pageBg: "#091524",
    cardBg: "#0f2038",
    cardBorder: "#1a3558",
    textPrimary: "#e2ecf7",
    textSecondary: "#8db4dc",
    textMuted: "#5a89b5",
    statusOk: "#12a573",
    statusLow: "#EB9C26",
    statusOut: "#ef4545",
    statusOver: "#14b8d4",
    accentBlue: "#3b82f6",
    iconPurple: "#6366f1",
    warning: "#EB9C26",
    chart1: "#21bda6",
    chart2: "#f59e14",
    chart3: "#14b8d4",
    chart4: "#f54f66",
    chart5: "#84cc16",
    borderColor: "#1a3558",
    sidebarBg: "#0b1a30",
    sidebarActiveBg: "#1a3558",
    sidebarBorder: "#2a4568",
    sidebarText: "#b8d4ee",
    inputBg: "#0d1e35",
    navBg: "#0b1a30",
    navBorder: "#1a3558",
  },
};

// ─── CSS Variable Names ───
const CSS_VAR_KEYS: (keyof ThemePalette)[] = [
  "pageBg", "cardBg", "cardBorder", "textPrimary", "textSecondary", "textMuted",
  "statusOk", "statusLow", "statusOut", "statusOver", "accentBlue", "iconPurple",
  "warning", "chart1", "chart2", "chart3", "chart4", "chart5", "borderColor",
  "sidebarBg", "sidebarActiveBg", "sidebarBorder", "sidebarText", "inputBg",
  "navBg", "navBorder",
];

function applyThemeCSSVars(palette: ThemePalette) {
  const root = document.documentElement;
  for (const key of CSS_VAR_KEYS) {
    root.style.setProperty(`--v-${key}`, palette[key]);
  }
}

// ─── Context ───
export type ThemeMode = keyof typeof THEME_PALETTES;

interface ThemeContextType {
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  palette: ThemePalette;
}

const ThemeContext = createContext<ThemeContextType>({
  themeMode: "dark",
  setThemeMode: () => {},
  palette: THEME_PALETTES.dark,
});

interface ThemeProviderProps {
  children: ReactNode;
  defaultTheme?: ThemeMode | "system";
  switchable?: boolean;
}

export function ThemeProvider({ children, defaultTheme = "dark" }: ThemeProviderProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const stored = localStorage.getItem("vitros-theme");
    if (stored && stored in THEME_PALETTES) return stored as ThemeMode;
    if (defaultTheme === "system") {
      return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return defaultTheme in THEME_PALETTES ? defaultTheme as ThemeMode : "dark";
  });

  const palette = THEME_PALETTES[themeMode] || THEME_PALETTES.dark;

  useEffect(() => {
    applyThemeCSSVars(palette);
    localStorage.setItem("vitros-theme", themeMode);
    // Also set dark/light class for tailwind
    if (themeMode === "light") {
      document.documentElement.classList.remove("dark");
    } else {
      document.documentElement.classList.add("dark");
    }
  }, [themeMode, palette]);

  // Apply on mount
  useEffect(() => {
    applyThemeCSSVars(palette);
  }, []);

  return (
    <ThemeContext.Provider value={{ themeMode, setThemeMode, palette }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
