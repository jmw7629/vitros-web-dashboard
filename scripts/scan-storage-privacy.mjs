import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const PROJECT_URL = 'https://oykqiiydpwngasvzdthh.supabase.co';
const bucket = 'dhr-scans';
const fail = message => { throw new Error(message); };

/** One-bucket maintenance operation; no object writes/deletes or public rollback. */
export async function privatizeScans({ key, manifest, apply = false, fetchFn = fetch }) {
  if (typeof key !== 'string' || !key.trim()) fail('SUPABASE_SERVICE_ROLE_KEY is required in the server environment.');
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > 100) fail('A bounded source manifest is required.');
  const names = new Set();
  for (const row of manifest) {
    if (!row || !/^(?:(?:scan|incoming)_\d+\.jpg|test\.txt)$/.test(row.file) || names.has(row.file) ||
      !/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > 14_000_000) fail('Invalid source manifest.');
    names.add(row.file);
  }
  async function request(path, { method = 'GET', body, anonymous = false } = {}) {
    // Fixed origin and disabled redirects keep the credential at the owned project.
    let response;
    try {
      response = await fetchFn(PROJECT_URL + '/storage/v1/' + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(30000), cache: 'no-store',
        headers: anonymous ? {} : { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch { fail('Storage request did not complete. Recheck bucket state before retrying.'); }
    if (!anonymous && !response.ok) fail(`Storage request rejected (HTTP ${response.status}).`);
    return response;
  }
  async function json(path, options) {
    try { return await (await request(path, options)).json(); }
    catch (error) { if (error instanceof Error && error.message.startsWith('Storage request')) throw error; fail('Storage returned an invalid response.'); }
  }
  const metadata = () => json('bucket/' + bucket);
  async function verifyObjects() {
    const objects = await json('object/list/' + bucket, { method: 'POST', body: { prefix: '', limit: 101, offset: 0, sortBy: { column: 'name', order: 'asc' } } });
    if (!Array.isArray(objects) || objects.length !== manifest.length || objects.some(o => !o.id || !names.has(o.name))) fail('Object inventory differs from the reviewed manifest.');
    for (const row of manifest) {
      const response = await request('object/authenticated/' + bucket + '/' + row.file);
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > row.bytes) fail('Object contents differ from the reviewed manifest.');
        chunks.push(chunk);
      }
      const hash = createHash('sha256').update(Buffer.concat(chunks)).digest('hex');
      if (size !== row.bytes || hash !== row.sha256) fail('Object contents differ from the reviewed manifest.');
    }
  }
  const before = await metadata();
  if (before?.id !== bucket || typeof before.public !== 'boolean') fail('Unexpected bucket metadata.');
  await verifyObjects();
  let changed = false;
  if (apply && before.public) {
    await request('bucket/' + bucket, { method: 'PUT', body: { id: bucket, name: bucket, public: false } });
    changed = true;
  }
  const after = await metadata();
  if (after?.id !== bucket || typeof after.public !== 'boolean') fail('Unexpected bucket metadata after operation.');
  for (const field of ['file_size_limit', 'allowed_mime_types']) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) fail('Unrelated bucket configuration changed; investigate without making the bucket public.');
  }
  if (apply && after.public) fail('Bucket remains public after operation.');
  await verifyObjects();
  let publicReadable = 0;
  for (const row of manifest) {
    const response = await request('object/public/' + bucket + '/' + row.file + '?privacy_check=' + Date.now(), { anonymous: true });
    if (response.ok) publicReadable++;
    else if (![400, 401, 403, 404].includes(response.status)) fail('Public access probe was inconclusive.');
    await response.body?.cancel();
  }
  if (!after.public && publicReadable) fail('Public reads remain available; investigate cache/access controls. Bucket was not reopened.');
  return { bucket, mode: apply ? 'apply' : 'audit', changed, publicBefore: before.public, publicAfter: after.public, verifiedObjects: manifest.length, authenticatedHashesMatch: true, publicReadable, objectWrites: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [mode, manifestPath] = process.argv.slice(2);
    if (!['--audit', '--apply'].includes(mode) || !manifestPath || process.argv.length !== 4) fail('Usage: node scripts/scan-storage-privacy.mjs --audit|--apply manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    console.log(JSON.stringify(await privatizeScans({ key: process.env.SUPABASE_SERVICE_ROLE_KEY, manifest, apply: mode === '--apply' })));
  } catch { console.error('SCAN_STORAGE_PRIVACY=FAILED; verify credentials, reviewed manifest and current bucket state. No automatic public rollback.'); process.exitCode = 1; }
}
