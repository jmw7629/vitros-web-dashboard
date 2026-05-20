import { cn } from "../../lib/utils";
import type { ReactNode } from "react";

// ─── Theme Colors (uses CSS custom properties set by ThemeProvider) ───

export const theme = {
  // Backgrounds
  pageBg: "var(--v-pageBg, #0c111b)",
  cardBg: "var(--v-cardBg, #1a2035)",
  cardBorder: "var(--v-cardBorder, #1e293b)",
  // Text
  textPrimary: "var(--v-textPrimary, #f1f5f9)",
  textSecondary: "var(--v-textSecondary, #94a3b8)",
  textMuted: "var(--v-textMuted, #64748b)",
  // Status
  statusOk: "var(--v-statusOk, #12a573)",
  statusLow: "var(--v-statusLow, #EB9C26)",
  statusOut: "var(--v-statusOut, #ef4545)",
  statusOver: "var(--v-statusOver, #14b8d4)",
  // Accent
  accentBlue: "var(--v-accentBlue, #6366f1)",
  iconPurple: "var(--v-iconPurple, #8b5cf6)",
  warning: "var(--v-warning, #EB9C26)",
  // Chart colors
  chart1: "var(--v-chart1, #21bda6)",
  chart2: "var(--v-chart2, #f59e14)",
  chart3: "var(--v-chart3, #14b8d4)",
  chart4: "var(--v-chart4, #f54f66)",
  chart5: "var(--v-chart5, #84cc16)",
  // Border
  borderColor: "var(--v-borderColor, #1e293b)",
  // Legacy aliases
  sidebarBg: "var(--v-sidebarBg, #0f172a)",
  sidebarActiveBg: "var(--v-sidebarActiveBg, #1e293b)",
  sidebarBorder: "var(--v-sidebarBorder, #334155)",
  sidebarText: "var(--v-sidebarText, #cbd5e1)",
  // New
  inputBg: "var(--v-inputBg, #111827)",
  navBg: "var(--v-navBg, #0f172a)",
  navBorder: "var(--v-navBorder, #1e293b)",
} as const;

export function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "ok": case "in stock": case "adequate": return theme.statusOk;
    case "low": case "reorder": return theme.statusLow;
    case "out": case "out of stock": case "critical": return theme.statusOut;
    case "over": case "overstock": case "excess": return theme.statusOver;
    default: return theme.textSecondary;
  }
}

// ─── DashCard — Dark card with colored left accent ───

interface DashCardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  color: string; // Main accent color
  bgTint?: string; // Optional card bg tint
  onClick?: () => void;
}

export function DashCard({ label, value, subtitle, icon, color, bgTint, onClick }: DashCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-2xl p-4 flex flex-col gap-1.5 relative overflow-hidden",
        onClick && "cursor-pointer active:scale-[0.98] transition-transform"
      )}
      style={{ backgroundColor: bgTint || theme.cardBg, border: `1px solid ${theme.cardBorder}` }}
    >
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.textSecondary }}>
          {label}
        </span>
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: `${color}22` }}>
          <span className="text-lg" style={{ color }}>{icon}</span>
        </div>
      </div>
      <span className="text-[32px] font-black leading-none tracking-tight" style={{ color: theme.textPrimary }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      {subtitle && (
        <span className="text-[11px] font-medium" style={{ color: theme.textSecondary }}>{subtitle}</span>
      )}
    </div>
  );
}

// ─── StatCard (legacy, updated for dark theme) ───

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  color?: string;
  trend?: string;
  onClick?: () => void;
}

export function StatCard({ title, value, subtitle, icon, color = theme.accentBlue, trend, onClick }: StatCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-2xl p-4 flex flex-col gap-2",
        onClick && "cursor-pointer hover:brightness-110 transition"
      )}
      style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}` }}
    >
      <div className="flex items-start justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: theme.textSecondary }}>{title}</span>
        {icon && (
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: `${color}22` }}>
            <span style={{ color }}>{icon}</span>
          </div>
        )}
      </div>
      <span className="text-[28px] font-bold tracking-tight" style={{ color: theme.textPrimary }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
      {trend && (
        <span className="text-[11px] font-medium"
          style={{ color: trend.startsWith("+") ? theme.statusOk : trend.startsWith("-") ? theme.statusOut : theme.textSecondary }}>
          {trend}
        </span>
      )}
      {subtitle && <span className="text-[11px]" style={{ color: theme.textMuted }}>{subtitle}</span>}
    </div>
  );
}

// ─── StatusBadge ───

interface StatusBadgeProps { text: string; color: string; }

export function StatusBadge({ text, color }: StatusBadgeProps) {
  return (
    <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-md"
      style={{ color, backgroundColor: `${color}1f` }}>
      {text}
    </span>
  );
}

// ─── ProgressBar ───

interface ProgressBarProps { value: number; maxValue?: number; color?: string; height?: number; }

export function ProgressBar({ value, maxValue = 100, color = theme.accentBlue, height = 6 }: ProgressBarProps) {
  const pct = Math.min(100, (value / maxValue) * 100);
  return (
    <div className="w-full rounded-full overflow-hidden" style={{ height, backgroundColor: "#1e293b" }}>
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

// ─── WebCard wrapper (dark) ───

export function WebCard({ children, className, style }: { children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={cn("rounded-2xl", className)}
      style={{ backgroundColor: theme.cardBg, border: `1px solid ${theme.cardBorder}`, ...style }}>
      {children}
    </div>
  );
}

// ─── SectionHeader ───

export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <h3 className="text-xl font-bold tracking-tight" style={{ color: theme.textPrimary }}>
      {children}
    </h3>
  );
}

// ─── EmptyState ───

export function EmptyState({ icon = "📦", title, message }: { icon?: string; title: string; message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 gap-3">
      <span className="text-4xl">{icon}</span>
      <span className="text-base font-semibold" style={{ color: theme.textPrimary }}>{title}</span>
      {message && <span className="text-sm text-center" style={{ color: theme.textSecondary }}>{message}</span>}
    </div>
  );
}

// ─── ActionButton — Colored button (Scan Part, Receive Stock, etc.) ───

interface ActionButtonProps { label: string; color: string; textColor?: string; onClick?: () => void; }

export function ActionButton({ label, color, textColor = "#ffffff", onClick }: ActionButtonProps) {
  return (
    <button onClick={onClick}
      className="px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap active:scale-95 transition-transform"
      style={{ backgroundColor: color, color: textColor }}>
      {label}
    </button>
  );
}

// ─── AlertBanner ───

interface AlertBannerProps { icon?: ReactNode; text: string; subtitle?: string; color?: string; onClick?: () => void; }

export function AlertBanner({ icon, text, subtitle, color = "#ef4545", onClick }: AlertBannerProps) {
  return (
    <div onClick={onClick}
      className={cn("rounded-2xl p-4 flex items-center gap-3", onClick && "cursor-pointer")}
      style={{ backgroundColor: color }}>
      {icon && <div className="w-10 h-10 rounded-full bg-white/20 flex items-center justify-center shrink-0">{icon}</div>}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-bold text-white">{text}</div>
        {subtitle && <div className="text-xs text-white/70">{subtitle}</div>}
      </div>
      {onClick && <span className="text-white text-xl">→</span>}
    </div>
  );
}

// ─── Pill / Filter Tab ───

interface PillProps { label: string; active?: boolean; icon?: ReactNode; onClick?: () => void; }

export function Pill({ label, active, icon, onClick }: PillProps) {
  return (
    <button onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap",
        active ? "text-white" : "text-slate-400 hover:text-slate-300"
      )}
      style={active ? { backgroundColor: "#3b82f6" } : { backgroundColor: "#1e293b" }}>
      {icon}{label}
    </button>
  );
}

// ─── Formatters ───

export function formatNumber(n: number): string { return n.toLocaleString(); }

export function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function modeColor(mode: string): string {
  switch (mode.toLowerCase()) {
    case "out": return theme.statusOut;
    case "in": return theme.statusOk;
    case "adjust": return theme.statusLow;
    case "receive": return theme.accentBlue;
    default: return theme.textSecondary;
  }
}

// ─── CSV Export Utility ───

export function downloadCSV(data: Record<string, any>[], filename: string) {
  if (data.length === 0) return;
  const headers = Object.keys(data[0]);
  const escapeField = (val: any) => {
    const str = String(val ?? "");
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  };
  const csvRows = [
    headers.join(","),
    ...data.map(row => headers.map(h => escapeField(row[h])).join(","))
  ];
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : filename + ".csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
