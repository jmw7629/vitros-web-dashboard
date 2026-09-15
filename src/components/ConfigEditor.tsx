import { useRef, useState, type ButtonHTMLAttributes } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { EngineerDashboard } from "../pages/inventory/EngineerDashboard";
import { useRole } from "../hooks/useRole";
import { useConfigContext } from "./ConfigProvider";
import { WebCard, theme } from "./vitros/SharedComponents";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import {
  getAllConfigEntries, getConfigEntry, validateConfigValue, validateImportEnvelope, valueDigest,
  CATEGORY_LABELS, THEME_MODES, PART_TYPES, DATE_FORMATS, REM_VIEWS,
  NAV_ICONS, NAV_GRADIENTS, DASHBOARD_METRICS, DASHBOARD_LIST_SOURCES, ENGINEER_METRICS, KNOWN_ROUTES, ENGINEER_EXCLUDED_ROUTES,
  type ConfigEntryDef, type AllConfigKey, type EngineerViewConfig,
} from "../lib/configRegistry";

const buttonClass = "rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed";
const fieldClass = "min-w-0 max-w-full w-full rounded-lg border px-3 py-2 text-sm";
const fieldStyle = { backgroundColor: theme.inputBg, color: theme.textPrimary, borderColor: theme.cardBorder };
const correlation = () => `config:${crypto.randomUUID()}`;
const display = (value: unknown) => JSON.stringify(value, null, 2) ?? "null";
const failure = (error: unknown) => error instanceof Error ? error.message : "The request did not complete. Please retry.";
type Draft = { draftId: Id<"configDrafts">; key: string; value: unknown; revision: number; baseVersion: number; owner: string; createdAt: number; updatedAt: number };
type Published = { key: string; value: unknown; version: number; publishedAt: number; publishedBy: string };
const optionSets: Record<string, readonly string[]> = {
  "roles.engineerDefaultRoute": KNOWN_ROUTES.filter(path => !(ENGINEER_EXCLUDED_ROUTES as readonly string[]).includes(path)),
  "theme.defaultMode": THEME_MODES, "defaults.partType": PART_TYPES,
  "defaults.dateFormat": DATE_FORMATS, "rem.defaultView": REM_VIEWS,
  icon: NAV_ICONS, iconBg: NAV_GRADIENTS, metric: DASHBOARD_METRICS,
  dataSource: DASHBOARD_LIST_SOURCES, size: ["small", "full"],
};

function Button({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={buttonClass} style={{ borderColor: theme.cardBorder, color: theme.textPrimary }} {...props}>{children}</button>;
}

/** Structured controls share the same value and validator as the advanced editor. */
function ValueFields({ name, value, change, disabled, engineer = false }: { engineer?: boolean; name: string; value: unknown; change: (value: unknown) => void; disabled: boolean }) {
  if (Array.isArray(value)) return <div className="space-y-2">{value.map((item, index) => {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
    const label = String(record?.label ?? record?.title ?? record?.name ?? record?.key ?? record?.id ?? `Item ${index + 1}`);
    const move = (offset: number) => {
      const next = [...value]; const target = index + offset;
      [next[index], next[target]] = [next[target], next[index]];
      change(next.map((row, order) => row && typeof row === "object" && "order" in row ? { ...row, order } : row));
    };
    return <details key={index} className="rounded-lg border p-3" style={{ borderColor: theme.cardBorder }}>
      <summary className="cursor-pointer break-words font-semibold text-sm">{label}</summary>
      <div className="mt-3 space-y-3"><div className="flex gap-2">
        <Button disabled={disabled || index === 0} onClick={() => move(-1)} aria-label={`Move ${label} up`}>Move up</Button>
        <Button disabled={disabled || index === value.length - 1} onClick={() => move(1)} aria-label={`Move ${label} down`}>Move down</Button>
      </div><ValueFields engineer={engineer} name={`${name} ${index + 1}`} value={item} disabled={disabled} change={next => change(value.map((row, i) => i === index ? next : row))} /></div>
    </details>;
  })}</div>;
  if (value && typeof value === "object") return <div className="grid gap-3 sm:grid-cols-2">{Object.entries(value).map(([key, current]) => <div key={key} className={current && typeof current === "object" ? "sm:col-span-2" : ""}>
    <ValueFields engineer={engineer} name={key} value={current} disabled={disabled || ["id", "key", "path", "order", ...(engineer ? ["type"] : [])].includes(key)} change={next => change({ ...value, [key]: next })} />
  </div>)}</div>;
  const options = engineer && name === "metric" ? ENGINEER_METRICS : optionSets[name];
  return <label className="block min-w-0 text-sm"><span className="mb-1 block font-medium">{getConfigEntry(name)?.label ?? name.replace(/([a-z])([A-Z])/g, "$1 $2")}</span>
    {typeof value === "boolean" ? <input type="checkbox" checked={value} disabled={disabled} onChange={event => change(event.target.checked)} className="h-5 w-5" />
      : options ? <select className={fieldClass} style={fieldStyle} value={String(value)} disabled={disabled} onChange={event => change(event.target.value)}>{options.map(option => <option key={option} value={option}>{option}</option>)}</select>
      : <input className={fieldClass} style={fieldStyle} type={typeof value === "number" ? "number" : typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? "color" : "text"} value={String(value ?? "")} disabled={disabled} onChange={event => change(typeof value === "number" ? Number(event.target.value) : event.target.value)} />}
  </label>;
}

function EngineerFields({ value, disabled, change }: { value: EngineerViewConfig; disabled: boolean; change: (value: EngineerViewConfig) => void }) {
  const sections = [
    ["cards", "Dashboard cards"], ["quickActions", "Quick actions"],
    ["inventoryStatus", "Inventory status panel"], ["recentTransactions", "Recent transactions panel"],
    ["inventoryMenu", "Inventory menu"], ["remMenu", "REM Tracker menu"], ["reportsMenu", "Inventory reports menu"],
  ] as const;
  return <section aria-label="Engineer view controls" className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">{(["title", "subtitle"] as const).map(key =>
      <ValueFields key={key} name={key} value={value[key]} disabled={disabled} change={next => change({ ...value, [key]: next })} />
    )}</div>
    <p className="text-sm">Expand a section to rename, show, hide, or reorder items. Full-size cards span the dashboard width.</p>
    <label className="flex gap-2 items-center text-sm font-semibold"><input type="checkbox" checked={value.useCustomNavigation} disabled={disabled} onChange={event => change({ ...value, useCustomNavigation: event.target.checked })} />Use separate Engineer menus</label>
    <p className="text-xs">When unchecked, Engineer uses the shared menus. Menu visibility simplifies the screen; server permissions still apply.</p>
    {sections.map(([key, label]) => <details key={key} className="rounded-lg border p-3" style={{ borderColor: theme.cardBorder }}>
      <summary className="cursor-pointer font-semibold">{label}</summary>
      <div className="mt-3"><ValueFields engineer name={label} value={value[key]} disabled={disabled || (key.endsWith("Menu") && !value.useCustomNavigation)} change={next => change({ ...value, [key]: next })} /></div>
    </details>)}
  </section>;
}

function ReviewDialog({ title, before, after, busy, close, confirm, error }: { error: string | null; title: string; before: unknown; after: unknown; busy: boolean; close: () => void; confirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return <Dialog open onOpenChange={open => { if (!open && !busy) close(); }}>
    <DialogContent showCloseButton={!busy} className="max-h-[85vh] overflow-auto sm:max-w-3xl" style={fieldStyle} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>Review this exact change. Concurrent changes will require a new review.</DialogDescription>
      {error && <p role="alert" className="rounded border border-red-500 p-3 text-sm">{error}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{[["Current", before], ["Proposed", after]].map(([label, value]) => <div key={String(label)}><h4 className="font-semibold">{String(label)}</h4><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-3 text-xs" style={{ borderColor: theme.cardBorder }}>{display(value)}</pre></div>)}</div>
      <label className="text-sm">Reason for change<input className={`${fieldClass} mt-1`} style={fieldStyle} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label>
      <div className="flex justify-end gap-2"><Button disabled={busy} onClick={close}>Cancel</Button><Button disabled={busy} onClick={() => confirm(reason)}>{busy ? "Applying…" : "Confirm change"}</Button></div>
    </DialogContent>
  </Dialog>;
}

type Review = { kind: "publish"; draft: Draft; version: number; before: unknown; after: unknown; id: string }
  | { kind: "rollback"; targetVersion: number; version: number; before: unknown; after: unknown; id: string };

function EntryPanel({ entry, published, drafts }: { entry: ConfigEntryDef; published?: Published; drafts: Draft[] }) {
  const createDraft = useMutation(api.configActions.createDraft);
  const updateDraft = useMutation(api.configActions.updateDraft);
  const deleteDraft = useMutation(api.configActions.deleteDraft);
  const publishDraft = useMutation(api.configActions.publishDraft);
  const rollback = useMutation(api.configActions.rollbackToVersion);
  const versions = useQuery(api.configActions.listVersions, { key: entry.key, limit: 50 });
  const audit = useQuery(api.configActions.getAuditLog, { key: entry.key, limit: 20 });
  const config = useConfigContext();
  const [draft, setDraft] = useState<Draft | null>(() => drafts[0] ? structuredClone(drafts[0]) : null);
  const [base, setBase] = useState(() => ({ version: published?.version ?? 0, value: published?.value ?? entry.defaultValue }));
  const [text, setText] = useState(() => display(drafts[0]?.value ?? published?.value ?? entry.defaultValue));
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  let value: unknown; let invalid: string | null = null;
  try { value = JSON.parse(text); const check = validateConfigValue(entry.key, value); if (!check.valid) invalid = check.error ?? "Invalid setting"; }
  catch { invalid = "Enter a complete, valid value before saving or previewing."; }
  const dirty = invalid !== null || valueDigest(value) !== valueDigest(draft?.value ?? base.value);
  const changed = (published?.version ?? 0) !== base.version || Boolean(draft && drafts.find(row => row.draftId === draft.draftId)?.revision !== draft.revision);
  const run = async (work: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null); setMessage(null);
    try { await work(); } catch (err) { setError(failure(err)); }
    finally { pending.current = false; setBusy(false); }
  };
  const load = (next: Draft | null) => {
    setDraft(next ? structuredClone(next) : null);
    setBase({ version: published?.version ?? 0, value: published?.value ?? entry.defaultValue });
    setText(display(next?.value ?? published?.value ?? entry.defaultValue)); setError(null); setMessage(null); setReview(null);
  };
  const save = () => run(async () => {
    if (invalid) throw new Error(invalid);
    const saved = draft
      ? await updateDraft({ draftId: draft.draftId, expectedRevision: draft.revision, value, correlationId: correlation() })
      : await createDraft({ key: entry.key, value, correlationId: correlation() });
    setDraft(saved); setText(display(saved.value)); setMessage("Draft saved. Published settings are unchanged.");
  });
  const confirm = (reason: string) => run(async () => {
    if (!review) return;
    const result = review.kind === "publish"
      ? await publishDraft({ draftId: review.draft.draftId, expectedDraftRevision: review.draft.revision, expectedValueDigest: valueDigest(review.after), expectedPublishedVersion: review.version, correlationId: review.id, reason: reason || undefined })
      : await rollback({ key: entry.key, targetVersion: review.targetVersion, expectedCurrentVersion: review.version, correlationId: review.id, reason: reason || undefined });
    setBase({ version: result.version, value: result.value }); setDraft(null); setText(display(result.value));
    setReview(null); config.clearPreview(); setMessage(`Published version ${result.version}.`);
  });
  return <WebCard className="p-4 sm:p-6 space-y-4">
    <div><h3 className="text-lg font-bold">{entry.label}</h3><p className="mt-1 text-sm" style={{ color: theme.textSecondary }}>{entry.description}</p><p className="mt-2 text-xs">Published version {base.version}{draft ? ` · Draft revision ${draft.revision}` : " · No draft selected"}</p></div>
    {error && <p role="alert" className="rounded-lg border border-red-500 p-3 text-sm">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-emerald-500 p-3 text-sm">{message}</p>}
    {changed && <p role="status" className="rounded-lg border border-amber-500 p-3 text-sm">A saved version changed. Your current edit is preserved. Reload the current settings before reviewing again.</p>}
    <div className="flex flex-wrap gap-2"><Button disabled={busy} onClick={() => load(drafts[0] ?? null)}>Reload current settings</Button><Button disabled={busy} onClick={() => setText(display(entry.defaultValue))}>Use default value</Button></div>
    {drafts.length > 0 && <label className="block min-w-0 text-sm">Saved drafts<select className={`${fieldClass} mt-1`} style={fieldStyle} disabled={busy} value={draft?.draftId ?? ""} onChange={event => load(drafts.find(row => row.draftId === event.target.value) ?? null)}>
      <option value="">Start a new draft</option>{drafts.map(row => <option key={row.draftId} value={row.draftId}>Revision {row.revision} · {new Date(row.updatedAt).toLocaleString()}</option>)}
    </select></label>}
    {!invalid && (entry.key === "engineer.view" ? <EngineerFields value={value as EngineerViewConfig} disabled={busy || !entry.editable} change={next => setText(display(next))} /> : <ValueFields name={entry.valueType === "json" ? entry.label : entry.key} value={value} disabled={busy || !entry.editable} change={next => setText(display(next))} />)}
    <details open={Boolean(invalid)}><summary className="cursor-pointer text-sm font-semibold">Advanced value editor</summary><label className="mt-2 block text-sm">{entry.label} value<textarea className={`${fieldClass} mt-1 font-mono`} style={fieldStyle} rows={8} value={text} onChange={event => setText(event.target.value)} disabled={busy || !entry.editable} aria-invalid={Boolean(invalid)} aria-describedby={invalid ? "config-value-error" : undefined} /></label></details>
    {invalid && <p id="config-value-error" role="alert" className="text-sm text-red-400">{invalid}</p>}
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || Boolean(invalid) || (!dirty && (draft !== null || base.version > 0)) || !entry.editable} onClick={() => void save()}>Save draft</Button>
      <Button disabled={busy || Boolean(invalid) || !entry.public} onClick={() => { try { config.preview(entry.key as AllConfigKey, value); setError(null); } catch (err) { setError(failure(err)); } }}>Preview in this tab</Button>
      <Button disabled={busy || !draft || dirty || changed} onClick={() => draft && setReview({ kind: "publish", draft: structuredClone(draft), version: base.version, before: structuredClone(base.value), after: structuredClone(draft.value), id: correlation() })}>Review publication</Button>
      {draft && <Button disabled={busy} onClick={() => void run(async () => { await deleteDraft({ draftId: draft.draftId, expectedRevision: draft.revision, correlationId: correlation() }); setDraft(null); setText(display(base.value)); config.clearPreview(); setMessage("Draft deleted."); })}>Delete draft</Button>}
    </div>
    {entry.key === "engineer.view" && config.isPreviewing?.(entry.key) && <section aria-label="Engineer dashboard preview" className="space-y-4 rounded-xl border p-3" style={{ borderColor: theme.cardBorder }}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold">Engineer dashboard preview</h4><Button onClick={() => config.clearPreview()}>Close Engineer preview</Button></div>
      <EngineerDashboard />
      {config.get<EngineerViewConfig>("engineer.view").useCustomNavigation && <div className="grid gap-3 sm:grid-cols-3">{(["inventoryMenu", "remMenu", "reportsMenu"] as const).map(key => <div key={key}><h5 className="font-semibold text-sm">{({ inventoryMenu: "Inventory menu", remMenu: "REM Tracker menu", reportsMenu: "Reports menu" })[key]}</h5><ol className="text-sm mt-2 space-y-1">{config.get<EngineerViewConfig>("engineer.view")[key].filter(row => row.visible).sort((a, b) => a.order - b.order).map(row => <li key={row.path}>{row.icon} {row.label}</li>)}</ol></div>)}</div>}
    </section>}
    {!entry.public && <p className="text-xs" style={{ color: theme.textSecondary }}>Access policies are enforced by the server after publication. Preview never grants permissions.</p>}
    <details><summary className="cursor-pointer font-semibold">Published history and rollback</summary><div className="mt-3 space-y-2">
      {versions === undefined ? <p>Loading history…</p> : versions.length === 0 ? <p>No published versions yet.</p> : versions.map(row => <div key={row.version} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3" style={{ borderColor: theme.cardBorder }}>
        <span className="text-sm">Version {row.version} · {new Date(row.publishedAt).toLocaleString()}</span><Button disabled={busy || changed || row.version === base.version} onClick={() => setReview({ kind: "rollback", targetVersion: row.version, version: base.version, before: structuredClone(base.value), after: structuredClone(row.value), id: correlation() })}>Review rollback to v{row.version}</Button>
      </div>)}
    </div></details>
    <details><summary className="cursor-pointer font-semibold">Audit history</summary><div className="mt-3 space-y-2">{audit === undefined ? <p>Loading audit history…</p> : audit.length === 0 ? <p>No changes recorded.</p> : audit.map((row, i) => <details key={`${row.correlationId}:${i}`} className="rounded-lg border p-3 text-sm" style={{ borderColor: theme.cardBorder }}>
      <summary>{row.action} · {new Date(row.timestamp).toLocaleString()}</summary><p className="mt-2 break-all">Actor: {row.actor}</p>{row.reason && <p>{row.reason}</p>}<pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs">{display({ before: row.previousValue, after: row.newValue })}</pre>
    </details>)}</div></details>
    {review && <ReviewDialog error={error} title={review.kind === "publish" ? `Publish ${entry.label}` : `Restore ${entry.label} from version ${review.targetVersion}`} before={review.before} after={review.after} busy={busy} close={() => setReview(null)} confirm={reason => void confirm(reason)} />}
  </WebCard>;
}

type ImportReview = { payload: unknown; correlationId: string; payloadDigest: string; expectedVersions: Array<{ key: string; version: number }>; entries: Array<{ key: string; action: string; currentVersion?: number; newVersion?: number }> };
function ImportExport() {
  const client = useConvex(); const apply = useMutation(api.configActions.applyImportConfig); const config = useConfigContext();
  const [raw, setRaw] = useState(""); const [review, setReview] = useState<ImportReview | null>(null);
  const [busy, setBusy] = useState(false); const pending = useRef(false); const generation = useRef(0);
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const run = async (work: () => Promise<void>) => { if (pending.current) return; pending.current = true; setBusy(true); setError(null); setMessage(null); try { await work(); } catch (err) { setError(failure(err)); } finally { pending.current = false; setBusy(false); } };
  const change = (text: string) => { generation.current++; setRaw(text); setReview(null); setError(null); setMessage(null); };
  const preview = () => run(async () => {
    const payload: unknown = JSON.parse(raw); const check = validateImportEnvelope(payload);
    if (!check.valid) throw new Error(check.error ?? "Invalid import");
    const currentGeneration = generation.current; const correlationId = correlation();
    const result = await client.query(api.configActions.previewImportConfig, { payload, correlationId });
    if (generation.current !== currentGeneration) return;
    setReview({ payload: structuredClone(payload), correlationId, payloadDigest: result.payloadDigest, expectedVersions: result.entries.filter(row => row.action === "add" || row.action === "update").map(row => ({ key: row.key, version: row.currentVersion ?? 0 })), entries: result.entries });
  });
  return <WebCard className="p-4 sm:p-6 space-y-4"><h3 className="font-bold text-lg">Import and export settings</h3>
    <p className="text-sm" style={{ color: theme.textSecondary }}>Export a backup or review a configuration file before applying it. Imports update all reviewed settings together.</p>
    {error && <p role="alert" className="rounded border border-red-500 p-3 text-sm">{error}</p>}{message && <p role="status" className="rounded border border-emerald-500 p-3 text-sm">{message}</p>}
    <Button disabled={busy} onClick={() => void run(async () => {
      const data = await client.query(api.configActions.exportConfig, {});
      const url = URL.createObjectURL(new Blob([display(data)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `vitros-settings-${new Date().toISOString().slice(0, 10)}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    })}>Export settings</Button>
    <label className="block min-w-0 text-sm">Configuration file<input className="mt-2 block w-full" type="file" accept="application/json,.json" disabled={busy} onChange={event => {
      const file = event.target.files?.[0]; if (!file) return;
      change(""); const currentGeneration = generation.current;
      if (file.size > 1048576) { setError("Choose a configuration file smaller than 1 MB."); return; }
      void file.text().then(text => { if (generation.current === currentGeneration) change(text); }).catch(() => setError("Could not read this file."));
    }} /></label>
    <label className="block min-w-0 text-sm">Import contents<textarea className={`${fieldClass} mt-1 font-mono`} style={fieldStyle} rows={6} value={raw} disabled={busy} onChange={event => change(event.target.value)} /></label>
    <Button disabled={busy || !raw.trim()} onClick={() => void preview()}>{busy ? "Working…" : "Review import"}</Button>
    {review && <section aria-label="Import review" className="space-y-3"><h4 className="font-semibold">Reviewed changes</h4>
      {review.entries.length === 0 && <p>No settings in this file. Applying it makes no configuration changes.</p>}
      <ul className="space-y-1 text-sm">{review.entries.map(row => <li key={row.key}>{row.key}: {row.action}{row.newVersion !== undefined ? ` → version ${row.newVersion}` : ""}</li>)}</ul>
      <Button disabled={busy} onClick={() => void run(async () => {
        const result = await apply({ payload: review.payload, expectedPayloadDigest: review.payloadDigest, expectedVersions: review.expectedVersions, correlationId: review.correlationId, reason: "Reviewed configuration import" });
        config.clearPreview(); setMessage(`${result.duplicate ? "Already applied" : "Import applied"}: ${result.adds} added, ${result.updates} updated, ${result.unchanged} unchanged.`);
        // Keep the exact review and correlation id for a safe retry if the response
        // is lost. Changing the file or pressing Review creates a new operation.
      })}>{busy ? "Applying…" : "Apply reviewed import"}</Button>
    </section>}
  </WebCard>;
}

function AdminEditor({ initialKey = "brand.appTitle" }: { initialKey?: AllConfigKey }) {
  const published = useQuery(api.configActions.listPublishedAdmin);
  const drafts = useQuery(api.configActions.listDrafts);
  const entries = getAllConfigEntries();
  const [selected, setSelected] = useState<string>(initialKey);
  const [search, setSearch] = useState("");
  const entry = entries.find(row => row.key === selected)!;
  if (published === undefined || drafts === undefined) return <p role="status">Loading configuration…</p>;
  const matches = entries.filter(row => `${row.label} ${CATEGORY_LABELS[row.category]}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="min-w-0 space-y-5" style={{ color: theme.textPrimary }}><header><h2 className="text-xl font-bold">Customize REM Command Center</h2><p className="mt-1 text-sm" style={{ color: theme.textSecondary }}>Edit a draft, preview the screen, and review it before publication.</p></header>
    <div className="flex flex-wrap gap-2" aria-label="Customization shortcuts">
      <Button onClick={() => { setSearch(""); setSelected("engineer.view"); }}>Customize Engineer view</Button>
      <Button onClick={() => { setSearch(""); setSelected("roles.engineerDefaultRoute"); }}>Engineer starting page</Button>
    </div>
    <WebCard className="p-4 grid gap-3 sm:grid-cols-2"><label className="min-w-0 text-sm">Find a setting<input className={`${fieldClass} mt-1`} style={fieldStyle} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <label className="min-w-0 text-sm">Setting<select className={`${fieldClass} mt-1`} aria-label="Setting" style={fieldStyle} value={selected} onChange={event => setSelected(event.target.value)}>{!matches.some(row => row.key === selected) && <option value={selected}>{entry.label}</option>}{matches.map(row => <option key={row.key} value={row.key}>{CATEGORY_LABELS[row.category]} — {row.label}</option>)}</select>{matches.length === 0 && <span className="text-xs">No matching settings.</span>}</label>
    </WebCard>
    <EntryPanel key={selected} entry={entry} published={published.find(row => row.key === selected)} drafts={drafts.filter(row => row.key === selected).sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)} />
    <details className="rounded-xl border p-4" style={{ borderColor: theme.cardBorder }}><summary className="cursor-pointer text-sm font-semibold">Advanced: import or export settings</summary><div className="mt-4"><ImportExport /></div></details>
  </div>;
}

export function ConfigEditor({ initialKey }: { initialKey?: AllConfigKey }) {
  const { role } = useRole();
  return role === "superuser" ? <AdminEditor initialKey={initialKey} /> : <p>Superuser access is required to manage configuration.</p>;
}
