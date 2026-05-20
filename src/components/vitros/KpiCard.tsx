import type { ReactNode } from "react";

type KpiColor = "default" | "info" | "success" | "warning" | "danger" | "purple" | "muted"
  | "blue" | "green" | "orange" | "red" | "cyan" | "gray" | "yellow";

const borderColors: Record<KpiColor, string> = {
  default: "border-l-yellow-500",
  info: "border-l-blue-500",
  blue: "border-l-blue-500",
  success: "border-l-green-500",
  green: "border-l-green-500",
  warning: "border-l-amber-500",
  orange: "border-l-orange-500",
  danger: "border-l-red-500",
  red: "border-l-red-500",
  purple: "border-l-purple-500",
  muted: "border-l-slate-400",
  cyan: "border-l-cyan-500",
  gray: "border-l-gray-400",
  yellow: "border-l-yellow-500",
};

const bgColors: Record<KpiColor, string> = {
  default: "bg-gradient-to-br from-white to-yellow-50/60 dark:from-slate-800 dark:to-yellow-900/20",
  info: "bg-gradient-to-br from-white to-blue-50/60 dark:from-slate-800 dark:to-blue-900/20",
  blue: "bg-gradient-to-br from-white to-blue-50/60 dark:from-slate-800 dark:to-blue-900/20",
  success: "bg-gradient-to-br from-white to-green-50/60 dark:from-slate-800 dark:to-green-900/20",
  green: "bg-gradient-to-br from-white to-green-50/60 dark:from-slate-800 dark:to-green-900/20",
  warning: "bg-gradient-to-br from-white to-amber-50/60 dark:from-slate-800 dark:to-amber-900/20",
  orange: "bg-gradient-to-br from-white to-orange-50/60 dark:from-slate-800 dark:to-orange-900/20",
  danger: "bg-gradient-to-br from-white to-red-50/60 dark:from-slate-800 dark:to-red-900/20",
  red: "bg-gradient-to-br from-white to-red-50/60 dark:from-slate-800 dark:to-red-900/20",
  purple: "bg-gradient-to-br from-white to-purple-50/60 dark:from-slate-800 dark:to-purple-900/20",
  muted: "bg-gradient-to-br from-white to-slate-50/60 dark:from-slate-800 dark:to-slate-700/30",
  cyan: "bg-gradient-to-br from-white to-cyan-50/60 dark:from-slate-800 dark:to-cyan-900/20",
  gray: "bg-gradient-to-br from-white to-gray-50/60 dark:from-slate-800 dark:to-gray-700/20",
  yellow: "bg-gradient-to-br from-white to-yellow-50/60 dark:from-slate-800 dark:to-yellow-900/20",
};

const iconBgColors: Record<KpiColor, string> = {
  default: "bg-gradient-to-br from-yellow-400 to-orange-500",
  info: "bg-gradient-to-br from-blue-400 to-blue-600",
  blue: "bg-gradient-to-br from-blue-400 to-blue-600",
  success: "bg-gradient-to-br from-emerald-400 to-green-600",
  green: "bg-gradient-to-br from-emerald-400 to-green-600",
  warning: "bg-gradient-to-br from-amber-400 to-orange-500",
  orange: "bg-gradient-to-br from-orange-400 to-orange-600",
  danger: "bg-gradient-to-br from-red-400 to-red-600",
  red: "bg-gradient-to-br from-red-400 to-red-600",
  purple: "bg-gradient-to-br from-purple-400 to-purple-600",
  muted: "bg-gradient-to-br from-slate-400 to-slate-500",
  cyan: "bg-gradient-to-br from-cyan-400 to-cyan-600",
  gray: "bg-gradient-to-br from-gray-400 to-gray-500",
  yellow: "bg-gradient-to-br from-yellow-400 to-yellow-500",
};

interface KpiCardProps {
  title?: string;
  label?: string;
  value: string | number;
  subtitle?: string;
  icon?: ReactNode;
  color?: KpiColor;
  onClick?: () => void;
}

export function KpiCard({ title, label, value, subtitle, icon, color = "default", onClick }: KpiCardProps) {
  const heading = title || label || "";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      onClick={onClick}
      className={`card-embossed border-l-[5px] p-3 sm:p-4 text-left w-full ${borderColors[color]} ${bgColors[color]} ${
        onClick
          ? "cursor-pointer hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 active:shadow-md transition-all duration-150"
          : ""
      }`}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-[10px] sm:text-[11px] font-extrabold uppercase tracking-wider text-slate-600 dark:text-slate-400 leading-tight">
          {heading}
        </p>
        {icon && (
          <span className={`icon-3d text-white p-1.5 sm:p-2 rounded-xl shrink-0 ${iconBgColors[color]}`}>
            {icon}
          </span>
        )}
      </div>
      <p className="text-2xl sm:text-3xl font-black mt-1 leading-tight text-slate-900 dark:text-white">
        {value}
      </p>
      {subtitle && (
        <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium leading-snug">
          {subtitle}
        </p>
      )}
    </Tag>
  );
}
