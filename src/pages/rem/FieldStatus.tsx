import { useState } from "react";
import { RemOperationalRecords } from "../../components/vitros/RemOperationalRecords";
import { theme } from "../../components/vitros/SharedComponents";

const VIEWS = [
  { dataset: "field_status", label: "Field status", title: "Field Status VITROS and VISION" },
  { dataset: "install_parts", label: "Install parts", title: "Installation Parts History" },
  { dataset: "certified_parts", label: "Certified parts", title: "Certified Parts History" },
] as const;

export function FieldStatus() {
  const [selected, setSelected] = useState<(typeof VIEWS)[number]["dataset"]>("field_status");
  const view = VIEWS.find((item) => item.dataset === selected) ?? VIEWS[0];
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold" style={{ color: theme.textPrimary }}>🌍 Field Status</h2>
        <p className="mt-0.5 text-sm" style={{ color: theme.textSecondary }}>Field records and service-part history from the production workbook</p>
      </div>
      <div role="group" aria-label="Field status view" className="flex flex-wrap gap-2">
        {VIEWS.map((item) => <button key={item.dataset} type="button" aria-pressed={selected === item.dataset}
          onClick={() => setSelected(item.dataset)} className="rounded-lg border px-4 py-2 text-sm font-bold"
          style={{ borderColor: theme.cardBorder, backgroundColor: selected === item.dataset ? theme.accentBlue : theme.cardBg, color: selected === item.dataset ? "white" : theme.textPrimary }}>
          {item.label}
        </button>)}
      </div>
      <RemOperationalRecords key={selected} dataset={selected} title={view.title} />
    </div>
  );
}
