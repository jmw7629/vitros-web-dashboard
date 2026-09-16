// Real React components and shared validators; Convex transport/auth and dialog
// portals are synthetic boundaries. This is not native browser acceptance.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const require = createRequire(process.env.VITROS_TEST_NODE_MODULES ? path.join(path.resolve(process.env.VITROS_TEST_NODE_MODULES), "test-entry.cjs") : import.meta.url);
const React = require('react');
const { create, act } = require('react-test-renderer');
const ts = require('typescript');
const root = fileURLToPath(new URL('../', import.meta.url));
const projectRequire = createRequire(path.join(root, 'package.json'));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const refs = new Proxy({}, { get: (_t, mod) => new Proxy({}, { get: (_t, fn) => `${String(mod)}:${String(fn)}` }) });
const text = node => typeof node === 'string' ? node : (node?.children ?? []).map(text).join('');
let passed = 0, failed = 0;
const test = async (name, run) => { try { await run(); passed++; console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack}`); } };
function fixture() {
  return { role: 'superuser', userId: 'users:admin', authenticated: true, calls: [], reads: [], previewCalls: [],
    published: [{ key: 'brand.appTitle', value: 'Current title', version: 1, publishedAt: 1, publishedBy: 'users:admin' }],
    drafts: [{ draftId: 'configDrafts:one', key: 'brand.appTitle', value: 'Reviewed title', revision: 2, baseVersion: 1, owner: 'users:admin', createdAt: 1, updatedAt: 2 }],
    versions: [], mutation: async () => { throw new Error('Unexpected mutation'); },
    query: async () => { throw new Error('Unexpected asynchronous query'); } };
}
function loader(f, realProvider = false) {
  const cache = new Map();
  const card = props => React.createElement('div', props, props.children);
  const convex = {
    useConvexAuth: () => ({ isAuthenticated: f.authenticated }),
    useQuery: (ref, args) => {
      f.reads.push({ ref, args }); if (args === 'skip') return undefined;
      if (ref === 'auth:currentUser') return { _id: f.userId, role: f.role };
      if (ref === 'configActions:listPublishedAdmin' || ref === 'configActions:listPublished') return f.published;
      if (ref === 'configActions:listDrafts') return f.drafts;
      if (ref === 'configActions:listVersions') return f.versions;
      if (ref === 'configActions:getAuditLog') return [];
      throw new Error(`Unexpected query ${ref}`);
    },
    useAction: ref => async args => { f.calls.push({ ref, args }); return f.mutation(ref, args); },
    useMutation: ref => async args => { f.calls.push({ ref, args }); return f.mutation(ref, args); },
    useConvex: () => ({ query: async (ref, args) => { f.calls.push({ ref, args }); return f.query(ref, args); } }),
  };
  const load = relative => {
    let filename = path.resolve(root, relative);
    if (!fs.existsSync(filename)) filename = ['.tsx', '.ts'].map(ext => filename + ext).find(fs.existsSync);
    assert(filename, `Module exists: ${relative}`);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
    const scopedRequire = name => {
      if (f.modules && name in f.modules) return f.modules[name];
      if (name === 'convex/react') return convex;
      if (name === 'react-router-dom') return { useNavigate: () => path => (f.navigations ??= []).push(path), useLocation: () => ({ pathname: f.pathname ?? '/engineer-dashboard' }) };
      if (name.endsWith('/hooks/useConvexData')) return { useConvexData: () => f.data ?? { parts: [], transactions: [], kits: [] } };
      if (name.endsWith('/contexts/ThemeContext')) return { useTheme: () => ({ availableModes: [], palette: {}, themeMode: 'dark', setThemeMode() {} }), THEME_PALETTES: {} };

      if (name.endsWith('/_generated/api')) return { api: refs, internal: refs };
      if (name.endsWith('/hooks/useRole')) return { useRole: () => ({ role: f.role }) };
      if (name.endsWith('/vitros/SharedComponents')) return { WebCard: card, DashCard: props => React.createElement('button', { 'data-card': props.label, onClick: props.onClick }, props.label, ':', props.value), theme: {} };
      if (name.endsWith('/ui/dialog')) return { Dialog: ({ open, children }) => open ? children : null, DialogContent: props => React.createElement('section', { ...props, role: 'dialog' }), DialogTitle: props => React.createElement('h2', props), DialogDescription: props => React.createElement('p', props) };
      if (!realProvider && name.endsWith('/ConfigProvider')) return { useConfigContext: () => ({ preview: (key, value) => f.previewCalls.push({ key, value }), clearPreview: () => {} }) };
      if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(filename), name)));
      try { return require(name); } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; return projectRequire(name); }
    };
    vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require: scopedRequire, console, structuredClone, crypto: { randomUUID }, Error, TypeError, Date, JSON, Math, Map, Set, setTimeout, clearTimeout, ...(f.globals ?? {}) }, { filename, timeout: 10000 });
    return module.exports;
  };
  return load;
}
async function editor(f = fixture()) {
  const load = loader(f); const { ConfigEditor } = load('src/components/ConfigEditor.tsx'); let renderer;
  await act(async () => { renderer = create(React.createElement(ConfigEditor)); });
  const buttons = () => renderer.root.findAllByType('button');
  const button = label => { const matches = buttons().filter(node => text(node) === label); assert.equal(matches.length, 1, label); return matches[0]; };
  const click = async label => { const b = button(label); assert(!b.props.disabled, `${label} enabled`); await act(async () => b.props.onClick()); };
  return { f, renderer, button, click,
    refresh: async () => { await act(async () => renderer.update(React.createElement(ConfigEditor))); },
    edit: async value => { await act(async () => renderer.root.findAllByType('textarea').find(node => node.props['aria-invalid'] !== undefined).props.onChange({ target: { value } })); },
    importText: async value => { await act(async () => renderer.root.findAllByType('textarea').find(node => node.props['aria-invalid'] === undefined).props.onChange({ target: { value } })); },
    close: async () => { await act(async () => renderer.unmount()); },
  };
}
await test('Engineer never mounts admin queries or controls', async () => {
  const f = fixture(); f.role = 'engineer'; const h = await editor(f);
  assert.equal(f.reads.length, 0); assert.equal(h.renderer.root.findAllByType('button').length, 0); await h.close();
});
await test('Invalid advanced JSON cannot save or preview an older valid value', async () => {
  const h = await editor(); await h.edit('{');
  assert(h.button('Save draft').props.disabled); assert(h.button('Preview in this tab').props.disabled);
  assert.equal(h.f.calls.length, 0); await h.close();
});
await test('Save updates the selected draft using its loaded revision', async () => {
  const f = fixture(); f.mutation = async (ref, args) => { assert.equal(ref, 'configActions:updateDraft'); f.drafts = [{ ...f.drafts[0], value: args.value, revision: 3 }]; return f.drafts[0]; };
  const h = await editor(f); await h.edit('"Edited title"'); await h.click('Save draft');
  assert.equal(f.calls[0].args.expectedRevision, 2); assert.equal(f.calls[0].args.draftId, 'configDrafts:one');
  assert.equal(f.calls[0].args.value, 'Edited title'); assert.match(text(h.renderer.root), /Draft saved/); await h.close();
});
await test('Publication freezes reviewed draft/content/version across reactive updates', async () => {
  const f = fixture(); f.mutation = async () => { throw new Error('Draft conflict: changed after review'); };
  const h = await editor(f); await h.click('Review publication');
  f.drafts = [{ ...f.drafts[0], revision: 3, value: 'Unseen replacement' }]; f.published = [{ ...f.published[0], version: 2, value: 'Concurrent publication' }];
  await h.refresh(); await h.click('Confirm change');
  const call = f.calls[0]; assert.equal(call.args.expectedDraftRevision, 2); assert.equal(call.args.expectedPublishedVersion, 1); assert.equal(call.args.expectedValueDigest, '"Reviewed title"');
  const dialog = h.renderer.root.findByProps({ role: 'dialog' }); assert.match(text(dialog), /changed after review/); assert(!text(dialog).includes('Unseen replacement')); await h.close();
});
await test('Import uses server preview versions/digest and preserves identity on retry', async () => {
  const f = fixture(); f.query = async (ref) => { assert.equal(ref, 'configActions:previewImportConfig'); return { payloadDigest: 'exact-reviewed-payload', entries: [{ key: 'brand.appTitle', action: 'update', currentVersion: 7, newVersion: 8 }] }; };
  f.mutation = async (ref) => { assert.equal(ref, 'configActions:applyImportConfig'); throw new Error('Temporary connection failure'); };
  const h = await editor(f); await h.importText(JSON.stringify({ schemaVersion: 1, entries: [{ key: 'brand.appTitle', value: 'Imported title' }] }));
  await h.click('Review import'); await h.click('Apply reviewed import'); await h.click('Apply reviewed import');
  const calls = f.calls.filter(call => call.ref === 'configActions:applyImportConfig');
  assert.equal(calls.length, 2); assert.equal(calls[0].args.expectedVersions[0].version, 7); assert.equal(calls[0].args.expectedPayloadDigest, 'exact-reviewed-payload'); assert.equal(calls[0].args.correlationId, calls[1].args.correlationId);
  await h.importText('{}'); assert.equal(h.renderer.root.findAllByType('button').filter(node => text(node) === 'Apply reviewed import').length, 0); await h.close();
});
await test('Shared useConfig consumers see preview; identity changes and logout clear it', async () => {
  const f = fixture(); const load = loader(f, true); const { ConfigProvider, useConfigContext } = load('src/components/ConfigProvider.tsx'); const { useConfig } = load('src/hooks/useConfig.tsx');
  let context; let observed; function Consumer() { context = useConfigContext(); observed = useConfig().get('brand.appTitle'); return React.createElement('p', null, observed); }
  let renderer; const tree = () => React.createElement(ConfigProvider, null, React.createElement(Consumer));
  await act(async () => { renderer = create(tree()); }); assert.equal(observed, 'Current title');
  await act(async () => context.preview('brand.appTitle', 'Preview title')); assert.equal(observed, 'Preview title'); assert.equal(f.calls.length, 0);
  f.userId = 'users:second-admin'; await act(async () => renderer.update(tree())); assert.equal(observed, 'Current title'); assert.equal(context.previewActive, false);
  await act(async () => context.preview('brand.appTitle', 'Second preview')); f.authenticated = false;
  await act(async () => renderer.update(tree())); assert.equal(observed, 'Current title'); assert.equal(context.previewActive, false);
  assert.throws(() => context.preview('brand.appTitle', 'Denied'), /Administrator access/); await act(async () => renderer.unmount());
});
await test('All registered default values validate and render through actual editor controls', async () => {
  const f = fixture(); f.drafts = [];
  const load = loader(f); const contract = load('convex/configContract.ts');
  const h = await editor(f); let previous = 'brand.appTitle';
  const entries = contract.getAllConfigEntries(); assert.equal(entries.length, 36);
  for (const entry of entries) {
    const outcome = contract.validateConfigValue(entry.key, entry.defaultValue);
    assert.equal(outcome.valid, true, `${entry.key}: ${outcome.error}`);
    const selector = h.renderer.root.findAllByType('select').find(node => node.props.value === previous);
    assert(selector, `Setting selector for ${previous}`);
    await act(async () => selector.props.onChange({ target: { value: entry.key } })); previous = entry.key;
    assert(h.renderer.root.findAllByType('h3').some(node => text(node) === entry.label));
    assert.equal(h.renderer.root.findAllByProps({ role: 'alert' }).length, 0, entry.key);
  }
  assert.equal(f.calls.length, 0); await h.close();
});
await test('A default can become the first saved draft without changing its value', async () => {
  const f = fixture(); f.published = []; f.drafts = [];
  f.mutation = async (ref, args) => { assert.equal(ref, 'configActions:createDraft'); return { draftId: 'configDrafts:new', key: args.key, value: args.value, revision: 1, baseVersion: 0, owner: f.userId, createdAt: 1, updatedAt: 1 }; };
  const h = await editor(f); await h.click('Save draft'); assert.equal(f.calls.length, 1); await h.close();
});
await test('Rollback confirms the exact selected version with the reviewed current revision', async () => {
  const f = fixture(); f.drafts = []; f.published = [{ ...f.published[0], version: 2, value: 'Second value' }];
  f.versions = [{ key: 'brand.appTitle', value: 'First value', version: 1, publishedAt: 1, publishedBy: f.userId }];
  f.mutation = async (ref, args) => { assert.equal(ref, 'configActions:rollbackToVersion'); assert.equal(args.targetVersion, 1); assert.equal(args.expectedCurrentVersion, 2); return { ...f.published[0], version: 3, value: 'First value' }; };
  const h = await editor(f); await h.click('Review rollback to v1'); await h.click('Confirm change');
  assert.match(text(h.renderer.root), /Published version 3/); await h.close();
});

function themeFixture() {
  const f = fixture(); const stored = new Map(); const css = new Map(); const classes = new Set();
  f.globals = {
    localStorage: { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
    document: { documentElement: { style: { setProperty: (key, value) => css.set(key, value) }, classList: { add: key => classes.add(key), remove: key => classes.delete(key), toggle: (key, value) => value ? classes.add(key) : classes.delete(key) } } },
    window: { matchMedia: () => ({ matches: false }) },
  };
  f.published.push({ key: 'theme.defaultMode', value: 'light', version: 1 }, { key: 'theme.availableModes', value: ['light', 'dark'], version: 1 });
  return { f, stored, css, classes };
}
await test('Actual ThemeProvider applies configured default and tab preview to CSS', async () => {
  const { f, css } = themeFixture(); const load = loader(f, true);
  const { ConfigProvider, useConfigContext } = load('src/components/ConfigProvider.tsx');
  const { ThemeProvider, useTheme, THEME_PALETTES } = load('src/contexts/ThemeContext.tsx');
  let theme, config, renderer;
  function Consumer() { theme = useTheme(); config = useConfigContext(); return null; }
  const tree = () => React.createElement(ConfigProvider, null, React.createElement(ThemeProvider, null, React.createElement(Consumer)));
  await act(async () => { renderer = create(tree()); });
  assert.equal(theme.themeMode, 'light'); assert.equal(css.get('--v-pageBg'), THEME_PALETTES.light.pageBg);
  await act(async () => config.preview('theme.defaultMode', 'dark'));
  assert.equal(theme.themeMode, 'dark'); assert.equal(css.get('--v-pageBg'), THEME_PALETTES.dark.pageBg);
  await act(async () => config.clearPreview()); assert.equal(theme.themeMode, 'light');
  await act(async () => renderer.unmount());
});
await test('Actual ThemeProvider preserves an allowed personal choice and rejects unavailable modes', async () => {
  const { f, stored } = themeFixture(); stored.set('vitros-theme', 'dark'); const load = loader(f, true);
  const { ConfigProvider } = load('src/components/ConfigProvider.tsx');
  const { ThemeProvider, useTheme } = load('src/contexts/ThemeContext.tsx');
  let theme, renderer; function Consumer() { theme = useTheme(); return null; }
  const tree = () => React.createElement(ConfigProvider, null, React.createElement(ThemeProvider, null, React.createElement(Consumer)));
  await act(async () => { renderer = create(tree()); }); assert.equal(theme.themeMode, 'dark');
  await act(async () => { try { theme.setThemeMode('midnight'); } catch {} }); assert.equal(theme.themeMode, 'dark');
  await act(async () => theme.setThemeMode('light')); assert.equal(stored.get('vitros-theme'), 'light');
  await act(async () => renderer.unmount());
});
await test('Actual top navigation uses configured REM default view and branded preview', async () => {
  const f = fixture(); f.published.push({ key: 'rem.defaultView', value: 'kanban', version: 1 }); const navigated = [];
  f.modules = {
    'react-router-dom': { useLocation: () => ({ pathname: '/dashboard' }), useNavigate: () => destination => navigated.push(destination) },
    '../contexts/ThemeContext': { useTheme: () => ({ palette: {} }) },
  };
  const load = loader(f, true); const { ConfigProvider, useConfigContext } = load('src/components/ConfigProvider.tsx'); const { TopNavBar } = load('src/components/TopNavBar.tsx');
  let context, renderer; function Capture() { context = useConfigContext(); return React.createElement(TopNavBar, { onMenuToggle: () => {} }); }
  await act(async () => { renderer = create(React.createElement(ConfigProvider, null, React.createElement(Capture))); });
  await act(async () => renderer.root.findAllByType('button').find(node => text(node) === 'REM Tracker').props.onClick());
  assert.deepEqual(navigated, ['/rem/kanban']);
  await act(async () => context.preview('brand.appTitle', 'Visible preview')); assert.match(text(renderer.root), /Visible preview/);
  await act(async () => renderer.unmount());
});


function screenFixture() {
  const f = fixture();
  const data = { parts: [{ _id: 'parts:test', partNumber: 'TEST-482', description: 'Synthetic test component', type: 'Required', qoh: 7, minQty: 2, maxQty: 10, onPlan: true, status: 'OK' }], transactions: [], kits: [], sap: [], loading: false, error: null };
  f.modules = {
    '../../hooks/useConvexData': { useConvexData: () => data },
    '../../components/vitros/ScopeToggle': { ScopeToggle: () => null },
    '../../components/vitros/SharedComponents': { WebCard: props => React.createElement('section', props, props.children), StatusBadge: props => React.createElement('span', null, props.status), theme: {}, statusColor: () => '#000000', formatDate: () => 'Test date', modeColor: () => '#000000' },
    'lucide-react': new Proxy({}, { get: () => props => React.createElement('svg', props) }),
  };
  return f;
}
await test('Actual StockSummary honors reviewed columns and keeps header/body tracks aligned', async () => {
  const f = screenFixture(); f.published.push({ key: 'tables.stockSummary.columns', value: [{ key: 'qoh', label: 'Units', order: 0, visible: true }, { key: 'partNumber', label: 'Material', order: 1, visible: true }], version: 1 });
  const load = loader(f, true); const { ConfigProvider } = load('src/components/ConfigProvider.tsx'); const { StockSummary } = load('src/pages/inventory/StockSummary.tsx');
  let renderer; await act(async () => { renderer = create(React.createElement(ConfigProvider, null, React.createElement(StockSummary))); });
  const header = renderer.root.findAll(node => node.type === 'div' && node.props.style?.gridTemplateColumns && node.props.style?.position === 'sticky')[0];
  const row = renderer.root.findAll(node => node.type === 'div' && node.props.style?.gridTemplateColumns && node.props.onClick)[0];
  assert(header && row); assert(text(header).indexOf('Units') < text(header).indexOf('Material')); assert(!text(header).includes('Description'));
  assert.equal(header.props.style.gridTemplateColumns, row.props.style.gridTemplateColumns);
  assert.match(text(row), /TEST-482/); await act(async () => renderer.unmount());
});
await test('Actual ReportPreview uses configured section names, order and visibility', async () => {
  const f = screenFixture(); const load = loader(f, true); const contract = load('convex/configContract.ts');
  const definitions = structuredClone(contract.getConfigDefault('reports.definitions'));
  definitions.find(d => d.id === 'kits').name = 'Fixture kit summary';
  definitions.find(d => d.id === 'kits').order = 0;
  definitions.find(d => d.id === 'actions').order = 1;
  definitions.find(d => d.id === 'inventory').order = 2;
  definitions.find(d => d.id === 'inventory').visible = false;
  f.published.push({ key: 'reports.definitions', value: definitions, version: 1 });
  const { ConfigProvider } = load('src/components/ConfigProvider.tsx'); const { ReportPreview } = load('src/pages/reports/ReportPreview.tsx');
  let renderer; await act(async () => { renderer = create(React.createElement(ConfigProvider, null, React.createElement(ReportPreview))); });
  const headings = renderer.root.findAllByType('button').map(text).filter(value => value.toLowerCase().includes('fixture kit summary') || value.toLowerCase().includes('action items') || value.toLowerCase().includes('inventory overview'));
  assert.equal(headings.length, 2); assert.match(headings[0], /Fixture kit summary/i); assert.match(headings[1], /Action Items/i);
  await act(async () => renderer.unmount());
});


await test('Engineer shortcut exposes structured controls and an allowed starting-page selector', async () => {
  const h = await editor(); await h.click('Customize Engineer view');
  assert(h.renderer.root.findByProps({ 'aria-label': 'Engineer view controls' }));
  const options = h.renderer.root.findAllByType('option').map(node => node.props.value);
  assert(!options.includes('sapReady')); assert(!options.includes('sapPosted'));
  await h.click('Engineer starting page');
  const route = h.renderer.root.findAllByType('select').find(node => node.props.value === '/engineer-dashboard');
  assert(route); assert(!route.findAllByType('option').some(node => node.props.value === '/sap-staging'));
  await act(async () => route.props.onChange({ target: { value: '/scan-kiosk' } }));
  await h.click('Preview in this tab');
  assert.equal(h.f.previewCalls[0].value, '/scan-kiosk'); await h.close();
});
await test('Actual Engineer page applies titles, card order, visibility, action targets and activity limit', async () => {
  const f = fixture(); const load = loader(f, true); const contract = load('convex/configContract.ts');
  const view = structuredClone(contract.getConfigDefault('engineer.view'));
  view.title = 'Bench operations'; view.subtitle = 'Daily bench work';
  view.cards.forEach((row, i) => { row.visible = i < 2; row.order = i === 0 ? 1 : i === 1 ? 0 : i; });
  view.cards[0].title = 'Available parts';
  view.quickActions.forEach(row => { row.visible = row.path === '/dhr-scanner'; if (row.visible) row.label = 'Open DHR'; });
  view.inventoryStatus.visible = false; view.recentTransactions.title = 'Latest scans'; view.recentTransactions.limit = 1;
  f.published.push({ key: 'engineer.view', value: view, version: 1 });
  f.data = { parts: [], kits: [], transactions: [
    { partNumber: 'FIRST', timestamp: Date.now(), user: 'Fixture', mode: 'OUT', qty: -1 },
    { partNumber: 'SECOND', timestamp: Date.now(), user: 'Fixture', mode: 'IN', qty: 2 },
  ] };
  const { ConfigProvider } = load('src/components/ConfigProvider.tsx'); const { EngineerDashboard } = load('src/pages/inventory/EngineerDashboard.tsx');
  let renderer; await act(async () => { renderer = create(React.createElement(ConfigProvider, null, React.createElement(EngineerDashboard))); });
  assert.match(text(renderer.root), /Bench operations/); assert.match(text(renderer.root), /Latest scans/);
  assert(!text(renderer.root).includes('Inventory Status')); assert(!text(renderer.root).includes('SECOND'));
  const cards = renderer.root.findAllByType('button').filter(node => node.props['data-card']);
  assert.deepEqual(cards.map(node => node.props['data-card']), ['Health %', 'Available parts']);
  assert.match(text(cards[1]), /:0$/);
  const action = renderer.root.findAllByType('button').find(node => text(node).includes('Open DHR'));
  await act(async () => action.props.onClick()); assert.equal(f.navigations.at(-1), '/dhr-scanner');
  await act(async () => renderer.unmount());
});
await test('Engineer preview uses the actual dashboard and clears without a production mutation', async () => {
  const f = fixture(); f.drafts = [];
  const load = loader(f, true); const { ConfigProvider } = load('src/components/ConfigProvider.tsx'); const { ConfigEditor } = load('src/components/ConfigEditor.tsx');
  let renderer; await act(async () => { renderer = create(React.createElement(ConfigProvider, null, React.createElement(ConfigEditor))); });
  const click = async label => { const b = renderer.root.findAllByType('button').find(node => text(node) === label); assert(b); await act(async () => b.props.onClick()); };
  await click('Customize Engineer view');
  const title = renderer.root.findAllByType('input').find(node => node.props.value === 'Engineer Dashboard');
  await act(async () => title.props.onChange({ target: { value: 'Preview bench view' } }));
  await click('Preview in this tab');
  const preview = renderer.root.findByProps({ 'aria-label': 'Engineer dashboard preview' });
  assert.match(text(preview), /Preview bench view/); assert.equal(f.calls.length, 0);
  await click('Close Engineer preview'); assert.equal(renderer.root.findAllByProps({ 'aria-label': 'Engineer dashboard preview' }).length, 0);
  assert.equal(f.calls.length, 0); await act(async () => renderer.unmount());
});
await test('Engineer custom menus respect visibility and order without changing Superuser menus', async () => {
  const f = fixture(); f.role = 'engineer';
  const load = loader(f, true); const contract = load('convex/configContract.ts'); const view = structuredClone(contract.getConfigDefault('engineer.view'));
  view.useCustomNavigation = true;
  view.inventoryMenu.forEach(row => { row.visible = row.path === '/dhr-scanner'; if (row.visible) row.label = 'Bench DHR'; });
  view.remMenu.forEach(row => { row.visible = row.path === '/rem/kiosk'; if (row.visible) row.label = 'Bench REM'; });
  view.reportsMenu.forEach(row => row.visible = false);
  f.published.push({ key: 'engineer.view', value: view, version: 1 });
  const { ConfigProvider } = load('src/components/ConfigProvider.tsx'); const { AppSidebar } = load('src/components/AppSidebar.tsx');
  let renderer; const tree = () => React.createElement(ConfigProvider, null, React.createElement(AppSidebar));
  await act(async () => { renderer = create(tree()); });
  assert.match(text(renderer.root), /Bench DHR/); assert(!text(renderer.root).includes('SAP Staging')); assert(!text(renderer.root).includes('Executive Report'));
  f.pathname = '/rem/dashboard'; await act(async () => renderer.update(tree()));
  assert.match(text(renderer.root), /Bench REM/); assert(!text(renderer.root).includes('Production Plan'));
  f.role = 'superuser'; f.pathname = '/stock-summary'; await act(async () => renderer.update(tree()));
  assert.match(text(renderer.root), /SAP Staging/); assert(!text(renderer.root).includes('Bench DHR'));
  await act(async () => renderer.unmount());
});
await test('Part metadata saves through audited action without a stock adjustment; mixed edits are blocked', async () => {
 const f=screenFixture();const data=f.modules['../../hooks/useConvexData'].useConvexData();const p=data.parts[0];Object.assign(p,{module:'Computer',supportedModels:['5600'],subassemblyCodes:[],systemSide:'Not mapped',version:4});
 let adjustments=0;data.updatePart=async()=>{adjustments++};data.refresh=async()=>{};f.mutation=async()=>({version:5});
 const load=loader(f,true);const {ConfigProvider}=load('src/components/ConfigProvider.tsx');const {StockSummary}=load('src/pages/inventory/StockSummary.tsx');
 let renderer;await act(async()=>{renderer=create(React.createElement(ConfigProvider,null,React.createElement(StockSummary)))});
 const click=async label=>{const b=renderer.root.findAllByType('button').find(n=>text(n)===label);assert(b,label);await act(async()=>b.props.onClick())};
 const openEdit=async()=>{const b=renderer.root.findAllByType('button').find(n=>n.props.title==='Edit');assert(b);await act(async()=>b.props.onClick())};
 await openEdit();
 const change=async(label,value)=>{const input=renderer.root.findAllByType('input').find(n=>n.props['aria-label']===label);assert(input,label);await act(async()=>input.props.onChange({target:{value}}))};
 await change('Subassembly','Cabinetry');await click('Save Changes');
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].ref,'partMasterActions:updatePartMaster');assert.equal(f.calls[0].args.expectedVersion,4);assert.equal(f.calls[0].args.updates.module,'Cabinetry');assert.equal(adjustments,0);
 await openEdit();await change('Subassembly','Computer revised');const q=renderer.root.findAllByType('input').find(n=>n.props.value==='7');assert(q);await act(async()=>q.props.onChange({target:{value:'8'}}));await click('Save Changes');
 assert.match(text(renderer.root),/Save quantity changes separately/);assert.equal(f.calls.length,1);assert.equal(adjustments,0);assert(!text(renderer.root).includes('Bin Location'));
 await act(async()=>renderer.unmount());
});
await test('Rev J Tool classification filters and saves through audited metadata action', async () => {
 const f=screenFixture();const data=f.modules['../../hooks/useConvexData'].useConvexData();Object.assign(data.parts[0],{type:'Tool',version:4});
 let adjustments=0;data.updatePart=async()=>{adjustments++};data.refresh=async()=>{};f.mutation=async()=>({version:5});
 const load=loader(f,true);const {ConfigProvider}=load('src/components/ConfigProvider.tsx');const {StockSummary}=load('src/pages/inventory/StockSummary.tsx');
 assert(load('convex/configContract.ts').PART_TYPES.includes('Tool'));
 let renderer;await act(async()=>{renderer=create(React.createElement(ConfigProvider,null,React.createElement(StockSummary)))});
 const filter=renderer.root.findAllByType('select').find(n=>n.children.some(c=>text(c)==='All Types'));assert(filter);assert(filter.children.some(c=>text(c)==='Tool'));
 await act(async()=>filter.props.onChange({target:{value:'Tool'}}));
 const edit=renderer.root.findAllByType('button').find(n=>n.props.title==='Edit');assert(edit);await act(async()=>edit.props.onClick());
 const select=renderer.root.findAllByType('select').find(n=>n.props.value==='Tool' && n!==filter);assert(select);
 await act(async()=>select.props.onChange({target:{value:'Optional'}}));
 const save=renderer.root.findAllByType('button').find(n=>text(n)==='Save Changes');await act(async()=>save.props.onClick());
 assert.equal(f.calls[0].ref,'partMasterActions:updatePartMaster');assert.equal(f.calls[0].args.updates.type,'Optional');assert.equal(adjustments,0);await act(async()=>renderer.unmount());
});
console.log(`Config editor actual component checks: ${passed} passed, ${failed} failed (synthetic transport/portal boundaries).`);
if (failed) process.exitCode = 1;
