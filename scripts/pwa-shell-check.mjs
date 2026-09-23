import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] || '.';
const publicRoot = root === '.' ? 'public' : root;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(publicRoot, 'manifest.webmanifest'), 'utf8'));
assert.match(html, /<title>REM Command Center<\/title>/);
assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
const viewport = html.match(/name="viewport" content="([^"]+)"/)?.[1];
assert.ok(viewport?.includes('width=device-width'));
assert.ok(!/maximum-scale|minimum-scale|user-scalable\s*=\s*(?:no|0)/i.test(viewport));
assert.equal(manifest.id, '/');
assert.equal(manifest.start_url, '/');
assert.equal(manifest.scope, '/');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.name, 'REM Command Center');
assert.ok(manifest.short_name.length <= 12);
function checkPng(src, width, height) {
  assert.match(src, /^\/icon-\d+\.png$/);
  const bytes = fs.readFileSync(path.join(publicRoot, src.slice(1)));
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${src}: must be actual PNG`);
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  assert.equal(bytes.readUInt32BE(16), width, `${src}: actual width`);
  assert.equal(bytes.readUInt32BE(20), height, `${src}: actual height`);
}
for (const size of [192, 512]) {
  const icon = manifest.icons.find(icon => icon.sizes === `${size}x${size}`);
  assert.ok(icon, `Missing ${size}px install icon`);
  assert.equal(icon.type, 'image/png');
  assert.equal(icon.purpose, 'any');
  checkPng(icon.src, size, size);
}
const touch = html.match(/rel="apple-touch-icon" href="([^"]+)"/)?.[1];
checkPng(touch, 180, 180);
const favicon = html.match(/rel="icon" type="image\/png" href="([^"]+)"/)?.[1];
checkPng(favicon, 192, 192);
// This baseline deliberately has no service worker. A future worker requires a
// separately reviewed cache policy, rather than silently enabling private caches.
const main = fs.readFileSync('src/main.tsx', 'utf8');
assert.ok(!/serviceWorker\s*\.\s*register/.test(main));
assert.ok(!fs.existsSync(path.join(publicRoot, 'sw.js')));
assert.ok(!fs.existsSync(path.join(publicRoot, 'service-worker.js')));
console.log(`PWA shell metadata and actual PNG dimensions PASS (${root}); offline support deferred`);
