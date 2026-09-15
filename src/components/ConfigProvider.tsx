import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { type AllConfigKey, getConfigDefault, isPublicConfigKey, resolveConfigValue, validateConfigValue } from "../lib/configRegistry";

interface ConfigContextValue {
  publishedValues: Map<AllConfigKey, unknown>;
  isLoading: boolean;
  get: <T = unknown>(key: AllConfigKey) => T;
  previewActive: boolean;
  isPreviewing: (key: AllConfigKey) => boolean;
  preview: (key: AllConfigKey, value: unknown) => void;
  clearPreview: () => void;
}
const ConfigContext = createContext<ConfigContextValue>({
  publishedValues: new Map(), isLoading: true,
  get: (key) => getConfigDefault(key) as never,
  previewActive: false,
  isPreviewing: () => false,
  preview: () => { throw new Error("Configuration preview is unavailable"); },
  clearPreview: () => {},
});
export function useConfigContext(): ConfigContextValue { return useContext(ConfigContext); }

export function ConfigProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  const user = useQuery(api.auth.currentUser, isAuthenticated ? {} : "skip");
  const rows = useQuery(api.configActions.listPublished);
  const [overlay, setOverlay] = useState<{ owner: string; values: Map<AllConfigKey, unknown> } | null>(null);
  const owner = user?.role === "superuser" ? String(user._id) : null;
  // Preview remains in memory in this tab. Check ownership during render as
  // well as cleanup, so a logout never exposes the previous user's overlay.
  const previewValues = owner && overlay?.owner === owner ? overlay.values : undefined;
  useEffect(() => { setOverlay(null); }, [owner]);
  const publishedValues = useMemo(() => new Map<AllConfigKey, unknown>(
    (rows ?? []).map(row => [row.key as AllConfigKey, row.value]),
  ), [rows]);
  const context = useMemo<ConfigContextValue>(() => ({
    publishedValues,
    isLoading: rows === undefined,
    get: <T,>(key: AllConfigKey): T => resolveConfigValue(key, publishedValues, previewValues) as T,
    previewActive: Boolean(previewValues?.size),
    isPreviewing: (key) => previewValues?.has(key) ?? false,
    preview: (key, value) => {
      if (!owner) throw new Error("Administrator access is required for preview");
      if (!isPublicConfigKey(key)) throw new Error("Access policies take effect after publication; they cannot be previewed as permissions");
      const validation = validateConfigValue(key, value);
      if (!validation.valid) throw new Error(validation.error ?? "Invalid configuration");
      setOverlay(previous => ({ owner, values: new Map([
        ...(previous?.owner === owner ? previous.values : []), [key, structuredClone(value)],
      ]) }));
    },
    clearPreview: () => setOverlay(null),
  }), [owner, publishedValues, previewValues, rows]);
  return <ConfigContext.Provider value={context}>
    {children}
    {context.previewActive && <aside role="status" aria-label="Configuration preview" style={{ position: "fixed", bottom: 16, left: 16, right: 16, zIndex: 10000, padding: 12, borderRadius: 12, background: "#312e81", color: "#fff", border: "2px solid #a5b4fc", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12 }}>
      <span style={{ flex: 1 }}>Preview active in this tab. Published settings are unchanged.</span>
      <button type="button" onClick={context.clearPreview} style={{ padding: "8px 12px", borderRadius: 6, background: "#fff", color: "#312e81", fontWeight: 700 }}>Stop preview</button>
    </aside>}
  </ConfigContext.Provider>;
}
