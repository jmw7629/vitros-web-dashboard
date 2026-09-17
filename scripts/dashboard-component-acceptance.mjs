// Actual App routing and REM report components, with synthetic data/transport.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const req = createRequire(process.env.VITROS_TEST_NODE_MODULES ? path.join(process.env.VITROS_TEST_NODE_MODULES, 'entry.cjs') : import.meta.url);
const projectReq = createRequire(path.join(root, 'package.json'));
const React = req('react');
projectReq.cache[projectReq.resolve('react')] = req.cache[req.resolve('react')];
const { create, act } = req('react-test-renderer');
const router = projectReq('react-router-dom');
const ts = req('typescript');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const text = n => typeof n === 'string' ? n : (n?.children ?? []).map(text).join(' ');
function loader(f) {
  const cache = new Map();
  const load = relative => {
    let filename = path.resolve(root, relative);
    if (!fs.existsSync(filename)) filename = ['.tsx', '.ts', '.js', '.mjs'].map(e => filename + e).find(fs.existsSync);
    assert(filename, `Missing module ${relative}`);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} }; cache.set(filename, module);
    const scoped = name => {
      if (name === 'react-router-dom') return router;
      if (name.endsWith('/hooks/useRole')) return { useRole: () => ({ role: f.role }) };
      if (name.endsWith('/hooks/useConfig')) return { useConfig: () => ({ publishedValues: f.published ?? new Map() }) };
      if (name.endsWith('/hooks/useRemCoreData')) return { useRemCoreData: () => f.core };
      if (name.endsWith('/hooks/useRemPlanningData')) return { useRemPlanningData: () => f.planning };
      if (name.endsWith('/components/VitrosLayout')) return { VitrosLayout: router.Outlet };
      if (name.endsWith('/components/ui/sonner')) return { Toaster: () => null };
      if (name.endsWith('/components/vitros/RemOperationalRecords')) return { RemOperationalRecords: () => React.createElement('aside', null, 'Source records') };
      if (name.endsWith('/components/vitros/SharedComponents')) return {
        WebCard: p => React.createElement('section', null, p.children),
        DashCard: p => React.createElement('div', null, `${p.label}: ${p.value}`),
        ProgressBar: () => null, theme: {},
      };
      if (name === 'file-saver') return { saveAs: () => { throw new Error('Unexpected download'); } };
      if (name === 'xlsx') return {};
      if (name === 'lucide-react') return new Proxy({}, { get: () => () => null });
      if (filename.endsWith('/src/App.tsx') && name.startsWith('./pages/')) {
        const component = name.split('/').at(-1);
        return { [component]: () => { f.mounted.push(component); return React.createElement('div', null, component); } };
      }
      if (name.startsWith('@/')) return load(path.join(root, 'src', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name));
      return name === 'react' || name.startsWith('react/') ? req(name) : projectReq(name);
    };
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, require: scoped, console, Date, Map, Set, Intl, URL, Blob, TextEncoder, Math }, { filename });
    return module.exports;
  };
  return load;
}
let count = 0;
for (const [role, route, expected, forbidden] of [
  ['engineer', '/', 'EngineerDashboard', 'ExecutiveDashboard'],
  ['engineer', '/enterprise-dashboard', 'EngineerDashboard', 'EnterpriseDashboard'],
  ['engineer', '/sap-staging', 'EngineerDashboard', 'SapStaging'],
  ['engineer', '/sap-analytics', 'EngineerDashboard', 'SapAnalytics'],
  ['superuser', '/sap-staging', 'SapStaging', 'EngineerDashboard'],
  ['superuser', '/rem/reports', 'RemReports', 'Reports'],
  ['superuser', '/rem/reports-v2', 'RemReports', 'Reports'],
]) {
  const f = { role, mounted: [] };
  const App = loader(f)('src/App.tsx').default;
  let view;
  await act(async () => { view = create(React.createElement(router.MemoryRouter, { initialEntries: [route] }, React.createElement(App))); });
  assert.ok(f.mounted.includes(expected), `${role} ${route} must render ${expected}`);
  assert.ok(!f.mounted.includes(forbidden), `${forbidden} must never mount`);
  await act(async () => view.unmount()); count++;
}
for (const state of ['loading', 'error', 'ready']) {
  const f = {
    core: { analyzers: [], lvccItems: [], isLoading: false, error: null, refresh: async () => {} },
    planning: { trackerWeekly: [], buildPlan: [], targets: [], isLoading: state === 'loading', error: state === 'error' ? 'Synthetic planning unavailable' : null, refresh: async () => {} },
  };
  const Reports = loader(f)('src/pages/rem/RemReports.tsx').RemReports;
  let view;
  await act(async () => { view = create(React.createElement(Reports)); });
  const exports = view.root.findAllByType('button').filter(b => /Export/.test(text(b.toJSON ? b.toJSON() : { children: b.children })));
  assert.equal(exports.length, 2);
  assert.ok(exports.every(b => Boolean(b.props.disabled) === (state !== 'ready')));
  const rendered = JSON.stringify(view.toJSON());
  if (state === 'error') assert.ok(rendered.includes('Synthetic planning unavailable'));
  if (state !== 'ready') assert.ok(!rendered.includes('PLAN TOTAL'));
  assert.ok(rendered.includes('independent of report period'));
  await act(async () => view.unmount()); count++;
}
console.log(`Actual dashboard component acceptance: ${count} checks PASS (synthetic transport)`);
