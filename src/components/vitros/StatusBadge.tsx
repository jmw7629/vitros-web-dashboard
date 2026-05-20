interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

const statusColors: Record<string, string> = {
  OK: "bg-green-100 text-green-700",
  LOW: "bg-yellow-100 text-yellow-700",
  STOCKOUT: "bg-red-100 text-red-700",
  OVER: "bg-blue-100 text-blue-700",
  "In Progress": "bg-blue-100 text-blue-700",
  Done: "bg-green-100 text-green-700",
  "At Risk": "bg-red-100 text-red-700",
  Complete: "bg-green-100 text-green-700",
  Pending: "bg-gray-100 text-gray-700",
  Cleaning: "bg-cyan-100 text-cyan-700",
  Service: "bg-purple-100 text-purple-700",
  "Final Line": "bg-orange-100 text-orange-700",
  "Release Testing": "bg-red-100 text-red-700",
  Packaging: "bg-green-100 text-green-700",
  "SAP Release": "bg-amber-100 text-amber-700",
  "QA Release": "bg-indigo-100 text-indigo-700",
  INSTALLD: "bg-gray-100 text-gray-600",
  READY: "bg-blue-100 text-blue-700",
  POSTING: "bg-orange-100 text-orange-700",
  POSTED: "bg-green-100 text-green-700",
  ERROR: "bg-red-100 text-red-700",
  NOT_PUSHED: "bg-gray-100 text-gray-600",
  YES: "bg-green-100 text-green-700",
};

export function StatusBadge({ status, size = "sm" }: StatusBadgeProps) {
  const colors = statusColors[status] || "bg-gray-100 text-gray-600";
  const sizeClass = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";
  return (
    <span className={`inline-flex items-center font-semibold rounded-full ${sizeClass} ${colors}`}>
      {status}
    </span>
  );
}
