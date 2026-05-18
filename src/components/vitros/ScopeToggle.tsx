import { Globe, ClipboardList } from "lucide-react";

interface ScopeToggleProps {
  scope: "ALL" | "SP_ONLY";
  onChange: (scope: "ALL" | "SP_ONLY") => void;
  allCount?: number;
  spCount?: number;
}

export function ScopeToggle({ scope, onChange, allCount, spCount }: ScopeToggleProps) {
  return (
    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-0.5">
      <button
        onClick={() => onChange("ALL")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition ${
          scope === "ALL"
            ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
            : "text-slate-500 hover:text-slate-700"
        }`}
      >
        <Globe className="w-3.5 h-3.5" />
        All Parts{allCount !== undefined ? ` (${allCount})` : ""}
      </button>
      <button
        onClick={() => onChange("SP_ONLY")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition ${
          scope === "SP_ONLY"
            ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
            : "text-slate-500 hover:text-slate-700"
        }`}
      >
        <ClipboardList className="w-3.5 h-3.5" />
        Stocking Plan{spCount !== undefined ? ` (${spCount})` : ""}
      </button>
    </div>
  );
}
