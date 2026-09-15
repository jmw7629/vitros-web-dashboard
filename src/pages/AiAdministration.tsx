import { useEffect, useRef, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { AI_DEFAULTS, type AiSettings, type FreeModel } from "../../convex/aiContract";
import { useRole } from "../hooks/useRole";
import { WebCard, theme } from "../components/vitros/SharedComponents";

const button = "rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40";
const field = "mt-1 w-full min-w-0 rounded-lg border border-slate-600 bg-slate-950 p-2 text-sm text-white";
const labels: Record<keyof AiSettings, string> = {
  enabled: "Enable dashboard AI", assistantEnabled: "Admin model workspace",
  receivingEnabled: "Receiving image OCR", dhrEnabled: "DHR image OCR", pdfEnabled: "Receiving PDF OCR",
  textModel: "Text model", imageModel: "Image model", pdfModel: "PDF model",
  maxOutputTokens: "Maximum output tokens", timeoutSeconds: "Request timeout (seconds)",
  requestsPerMinute: "Requests per calendar minute", requestsPerDay: "Requests per UTC day",
};
type Review = { value: AiSettings; expectedVersion: number; correlationId: string; reason: string };
type Snapshot = { value: AiSettings; version: number };
function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const allowed = [
    "AI settings changed in another window. Reload before saving.",
    "Refresh the free-model catalog before saving.", "Free-model catalog needs a refresh.",
    "Dashboard AI minute limit reached. Try again next minute.",
    "Dashboard AI daily limit reached. Superuser can adjust the limit.",
  ];
  return allowed.find(text => message.includes(text)) ??
    (message.includes("OPENCODE_ZEN_API_KEY") ? "A dedicated Zen key is missing. Add OPENCODE_ZEN_API_KEY in Vercel production and deploy." :
    message.includes("restricted") || message.includes("OpenCode client") ? "The provider restricted this free model to OpenCode clients. No paid fallback was used." :
    message.includes("paused") || message.includes("disabled") ? "This AI feature is paused in the saved configuration." :
    message.includes("catalog") ? "The free-model catalog could not be verified. Refresh and try again." :
    message.includes("rate") || message.includes("quota") || message.includes("exhausted") ? "The provider's free access or rate limit was reached. No paid fallback was used." :
    message.includes("credential") || message.includes("authentication") ? "Zen did not accept the server credential. Check the dedicated Zen key." :
    "The request could not complete. Check connection status and recent activity. Your edits are preserved.");
}
function ModelPicker({ label, value, input, models, disabled, onChange }: {
  label: string; value: string; input: string; models: FreeModel[]; disabled: boolean; onChange: (value: string) => void;
}) {
  const options = models.filter(model => model.inputs.includes(input) && (input !== "pdf" || model.api === "responses"));
  const selected = options.find(model => model.id === value);
  return <label className="block min-w-0 text-sm">{label}
    <select aria-label={label} className={field} disabled={disabled} value={value} onChange={event => onChange(event.target.value)}>
      {!selected && <option value={value}>{value} — verification required</option>}
      {options.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}
    </select>
    <span className="mt-1 block text-xs text-slate-400">{selected?.privacy ?? "Refresh the catalog to verify free pricing and supported input."}</span>
  </label>;
}
export function AiAdministration() {
  const { role } = useRole();
  return role === "superuser" ? <AiAdministrationPanel /> : <p>Superuser access is required.</p>;
}
export function AiAdministrationPanel() {
  const data = useQuery(api.aiControl.dashboard);
  const saveSettings = useMutation(api.aiControl.saveSettings);
  const getStatus = useAction(api.aiAdminActions.connectionStatus);
  const refreshModels = useAction(api.aiAdminActions.refreshModels);
  const testConnection = useAction(api.aiAdminActions.testConnection);
  const askModel = useAction(api.aiAdminActions.askModel);
  const [base, setBase] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<AiSettings>({ ...AI_DEFAULTS });
  const [review, setReview] = useState<Review | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [workspaceModel, setWorkspaceModel] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (data && !base) {
      setBase({ value: data.settings, version: data.version });
      setDraft({ ...data.settings });
      setWorkspaceModel(data.settings.textModel);
    }
  }, [data, base]);
  useEffect(() => {
    let mounted = true;
    getStatus({}).then(result => { if (mounted) setKeyConfigured(result.keyConfigured); })
      .catch(() => { if (mounted) setError("Connection status could not be loaded."); });
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => { mounted = false; clearInterval(timer); };
  }, [getStatus]);
  async function perform(name: string, work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(name); setError(""); setMessage("");
    try { await work(); } catch (err) { setError(errorText(err)); }
    finally { busyRef.current = false; setBusy(null); }
  }
  if (!data || !base) return <p role="status">Loading AI administration…</p>;
  const models: FreeModel[] = data.catalog?.models ?? [];
  const stale = !data.catalog || now - data.catalog.fetchedAt > 300000;
  const changed = (Object.keys(draft) as (keyof AiSettings)[]).filter(key => draft[key] !== base.value[key]);
  const locked = Boolean(busy || review);
  const numeric: Array<[keyof AiSettings, number, number]> = [
    ["maxOutputTokens", 256, 8192], ["timeoutSeconds", 10, 120], ["requestsPerMinute", 1, 60], ["requestsPerDay", 1, 5000],
  ];
  const validNumbers = numeric.every(([key, min, max]) => Number.isSafeInteger(draft[key]) && Number(draft[key]) >= min && Number(draft[key]) <= max);
  function edit<K extends keyof AiSettings>(key: K, value: AiSettings[K]) { setDraft(current => ({ ...current, [key]: value })); }
  function reload() {
    if (!data) return;
    setDraft({ ...data.settings }); setBase({ value: data.settings, version: data.version });
    setReview(null); setAttempted(false); setReason(""); setError(""); setMessage("Loaded current saved settings.");
  }
  return <div className="min-w-0 space-y-4" style={{ color: theme.textPrimary }}>
    <header>
      <h2 className="text-xl font-bold">AI Administration</h2>
      <p className="mt-1 text-sm text-slate-400">OpenCode Zen Free · Default variant · Paid fallback disabled</p>
      <a className="mt-2 inline-block text-sm text-indigo-300 underline" href="/settings">Users, parts, SAP settings and dashboard customization →</a>
    </header>
    {error && <p role="alert" className="rounded-lg border border-red-500 p-3 text-sm text-red-300">{error}</p>}
    {message && <p role="status" className="rounded-lg border border-emerald-700 p-3 text-sm text-emerald-300">{message}</p>}
    <div className="grid grid-cols-2 gap-3">
      {[["Requests today (UTC)", String(data.daily.requests)], ["Completed / failed", data.daily.succeeded + " / " + data.daily.failed],
        ["Reported input tokens", String(data.daily.inputTokens)], ["Reported output tokens", String(data.daily.outputTokens)]].map(([label, value]) =>
        <WebCard key={label} className="p-3"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></WebCard>)}
    </div>
    <WebCard className="space-y-3 p-4">
      <h3 className="font-bold">Connection and free model catalog</h3>
      <p className="text-sm">Dedicated Zen key: <strong>{keyConfigured === null ? "Not checked" : keyConfigured ? "Configured on server" : "Missing"}</strong></p>
      <p className="text-xs text-slate-400">Manage the secret as OPENCODE_ZEN_API_KEY in Vercel production, then deploy to sync it to the server. Go and OpenAI credentials are never used. Provider credits and free quotas are managed by OpenCode; token totals include only reported usage.</p>
      <div className="flex flex-wrap gap-3 text-sm text-indigo-300 underline">
        <a target="_blank" rel="noreferrer" href="https://opencode.ai/auth">OpenCode console</a>
        <a target="_blank" rel="noreferrer" href="https://vercel.com/joewillisny-1019/vitros-web-dashboard/settings/environment-variables">Vercel environment</a>
        <a target="_blank" rel="noreferrer" href="https://opencode.ai/docs/zen/#privacy">Model data-use policies</a>
      </div>
      <p className="text-xs text-slate-400">{data.catalog ? "Catalog verified " + new Date(data.catalog.fetchedAt).toLocaleString() : "Catalog has not been verified."} {stale ? "Refresh required before enabling or saving model settings." : models.length + " verified free models."}</p>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={!!busy} onClick={() => void perform("status", async () => { const status = await getStatus({}); setKeyConfigured(status.keyConfigured); setMessage(status.keyConfigured ? "Zen key is configured. Run a connection test to verify access." : "A dedicated Zen key has not been configured."); })}>Refresh status</button>
        <button className={button} disabled={!!busy} onClick={() => void perform("catalog", async () => { await refreshModels({}); setNow(Date.now()); setMessage("Free-model catalog refreshed."); })}>Refresh free models</button>
        <button className={button} disabled={!!busy || !keyConfigured} onClick={() => void perform("connection", async () => { const result = await testConnection({}); setMessage("Connection succeeded using " + result.model + ": " + result.text.slice(0, 100)); })}>Test saved text model</button>
      </div>
      <p className="text-xs text-slate-400">Connection tests use the saved text model and count toward limits, including while AI is paused. If a model becomes paid or unavailable, its requests stop; there is no paid fallback.</p>
    </WebCard>
    <WebCard className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">AI settings · version {base.version}</h3><button className={button} disabled={!!busy} onClick={reload}>Reload saved settings</button></div>
      {data.version !== base.version && <p role="status" className="text-sm text-amber-300">Saved settings changed in another session. Your draft is preserved. Reload and review before applying changes.</p>}
      <fieldset disabled={locked} className="space-y-4 disabled:opacity-70">
        <div className="grid gap-3 sm:grid-cols-2">{(["enabled", "assistantEnabled", "receivingEnabled", "dhrEnabled", "pdfEnabled"] as const).map(key =>
          <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft[key]} onChange={event => edit(key, event.target.checked)} />{labels[key]}</label>)}</div>
        <div className="grid gap-4">
          <ModelPicker label="Text model" value={draft.textModel} input="text" models={models} disabled={locked} onChange={value => edit("textModel", value)} />
          <ModelPicker label="Image model" value={draft.imageModel} input="image" models={models} disabled={locked} onChange={value => edit("imageModel", value)} />
          <ModelPicker label="PDF model" value={draft.pdfModel} input="pdf" models={models} disabled={locked} onChange={value => edit("pdfModel", value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">{numeric.map(([key, min, max]) =>
          <label key={key} className="text-sm">{labels[key]}<input aria-label={labels[key]} className={field} type="number" min={min} max={max} step="1" value={Number.isNaN(draft[key]) ? "" : Number(draft[key])} onChange={event => edit(key, event.target.valueAsNumber as never)} /></label>)}</div>
        <label className="block text-sm">Reason for change<input className={field} maxLength={500} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explain this update for the audit history" /></label>
      </fieldset>
      <button className={button} disabled={locked || !changed.length || !validNumbers || data.version !== base.version} onClick={() => { setAttempted(false); setReview({ value: { ...draft }, expectedVersion: base.version, correlationId: crypto.randomUUID(), reason: reason.trim() }); }}>Review changes</button>
      {review && <section aria-label="Review AI settings" className="space-y-3 rounded-lg border border-indigo-400 p-3">
        <h4 className="font-bold">Review changes before applying</h4>
        <ul className="space-y-2 text-sm">{changed.map(key => <li className="break-words" key={key}>{labels[key]}: {String(base.value[key])} → {String(review.value[key])}</li>)}</ul>
        <p className="text-xs text-slate-400">{review.reason || "No reason supplied."} {attempted && "Retry sends this exact operation once; it cannot apply twice."}</p>
        <div className="flex flex-wrap gap-2">
          <button className={button} disabled={!!busy} onClick={() => void perform("save", async () => {
            setAttempted(true); const result = await saveSettings(review);
            setBase({ value: { ...review.value }, version: result.version }); setDraft({ ...review.value }); setReview(null); setAttempted(false); setReason("");
            setMessage("AI settings saved as version " + result.version + ".");
          })}>{attempted ? "Retry same change" : "Apply changes"}</button>
          <button className={button} disabled={!!busy} onClick={() => { setReview(null); setAttempted(false); }}>Back to editing</button>
        </div>
      </section>}
    </WebCard>
    <WebCard className="space-y-3 p-4">
      <h3 className="font-bold">Model workspace</h3>
      <p className="text-xs text-slate-400">Only text you enter is sent. This workspace has no live database access and cannot change inventory, DHR, SAP or settings. Check the selected model's data-use policy before submitting content.</p>
      <ModelPicker label="Workspace model" value={workspaceModel} input="text" models={models} disabled={!!busy} onChange={setWorkspaceModel} />
      <label className="block text-sm">Prompt<textarea className={field} rows={4} maxLength={10000} value={prompt} disabled={!!busy} onChange={event => setPrompt(event.target.value)} /></label>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={!!busy || !keyConfigured || !prompt.trim() || !data.settings.enabled || !data.settings.assistantEnabled} onClick={() => void perform("prompt", async () => { setAnswer(""); const result = await askModel({ prompt, modelId: workspaceModel }); setAnswer(result.text); setMessage("Response received from " + result.model + "."); })}>Run prompt</button>
        <button className={button} disabled={!!busy} onClick={() => { setPrompt(""); setAnswer(""); }}>Clear workspace</button>
      </div>
      {answer && <pre aria-label="Model response" className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-950 p-3 text-sm">{answer}</pre>}
    </WebCard>
    <WebCard className="space-y-3 p-4">
      <h3 className="font-bold">Recent activity · latest 50 requests</h3>
      <p className="text-xs text-slate-400">Prompts, document contents and API keys are not stored in this log. Requests rejected before provider submission are shown as page errors. A dash means usage was not reported.</p>
      {!data.requests.length ? <p className="text-sm text-slate-400">No AI requests recorded yet.</p> : <div className="max-w-full overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr>{["Time", "Feature / model", "Status", "Tokens in / out"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead>
        <tbody>{data.requests.map((row: any) => <tr key={row._id} className="border-t border-slate-700">
          <td className="p-2">{new Date(row.startedAt).toLocaleString()}</td><td className="break-all p-2">{row.purpose}<br />{row.model}</td>
          <td className="p-2">{row.status === "running" && now - row.startedAt > 180000 ? "Completion unconfirmed" : row.status}{row.errorCode && <span className="block">{row.errorCode}</span>}</td>
          <td className="whitespace-nowrap p-2">{row.inputTokens ?? "—"} / {row.outputTokens ?? "—"}</td>
        </tr>)}</tbody></table></div>}
    </WebCard>
    <WebCard className="space-y-3 p-4"><h3 className="font-bold">Settings history · latest 10 changes</h3>
      {!data.audit.length && <p className="text-sm text-slate-400">No settings changes recorded yet.</p>}
      {data.audit.map((row: any) => <div key={row._id} className="space-y-2 border-t border-slate-700 pt-3 text-sm">
        <p>Version {row.version} · {new Date(row.createdAt).toLocaleString()}</p><p className="break-words text-slate-400">{row.reason || "No reason supplied."}</p>
        <button className={button} disabled={locked} onClick={() => { setBase({ value: data.settings, version: data.version }); setDraft({ ...row.previous }); setReason("Restore settings preceding version " + row.version); setMessage("Previous settings loaded into your draft. Review changes to apply."); }}>Load previous settings for review</button>
      </div>)}
    </WebCard>
    {busy && <p role="status" className="text-sm text-indigo-300">Working: {busy}…</p>}
  </div>;
}
