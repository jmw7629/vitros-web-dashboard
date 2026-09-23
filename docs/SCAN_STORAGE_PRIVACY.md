# Historical scan storage privacy

The owned `dhr-scans` bucket was found public during source recovery on 2026-09-23. Its reviewed inventory contains seven historical JPEGs plus one tiny legacy text test object. The JPEGs include one Incoming Stock packing-list page and six DHR page photographs/crops. The DHR photos are Rev K material; they are not the controlled Rev J master. Do not publish the photographs or source manifest in GitHub.

The current frontend sends OCR image data directly to authenticated actions and contains no `dhr-scans`/Storage URL retrieval path. Existing server upload/delete actions use capability checks and server credentials. Making this bucket private intentionally stops historical public links. It does not delete or rewrite objects. This inspection does not establish that no external consumer has saved an old public link.

Supabase requires Storage metadata changes through its API: https://supabase.com/docs/guides/storage/schema/design . Bucket update semantics: https://supabase.com/docs/reference/javascript/file-buckets-updatebucket . The operation follows the official SDK request shape and updates only `public: false` on this fixed bucket and project.

## Reviewed operation

Use an authorized server environment with `SUPABASE_SERVICE_ROLE_KEY` injected through secret management; never paste the key into a command, ticket, browser or chat. The local recovered-source index contains a JSON array of `{file, bytes, sha256}`. It is stored under `.worktrees/ocr-review-422/.verification/recovered-sources/source-index-complete.json` in the standalone workspace, not tracked in Git.

Run from the repository containing the reviewed script:

```sh
node scripts/scan-storage-privacy.mjs --audit /absolute/path/to/source-index.json
node scripts/scan-storage-privacy.mjs --apply /absolute/path/to/source-index.json
```

Audit performs no configuration writes. Apply first checks the exact complete object inventory and authenticated byte hashes, changes the fixed bucket through the Storage API, rechecks bucket restrictions and all authenticated object hashes, then probes every public URL without credentials. A changed inventory or hash aborts before update. Existing private buckets are verified without another update. No object delete/upload, signed-link creation or public rollback is implemented.

A transport failure may occur after the visibility update. Inspect current bucket state before retrying; never restore public access automatically. Cached public content may persist temporarily. Public-read probe failure is a failed verification, not permission to reopen the bucket. Previously downloaded copies cannot be revoked.

After successful apply, independently verify bucket visibility, all object counts/hashes, public denial and authenticated reads. Retest the production Incoming Stock/DHR upload flows with an authorized test identity. Only then mark privacy remediation complete.

## Current evidence and blocker

The local runner tests execute the real operation with a fake Storage transport: audit-only behavior, exact-manifest checks, preserved content, private-only updates, already-private replay, provider failures, and public-read failures pass. They do not prove production remediation.

Fresh read-only Production verification found the bucket still public with eight objects: the seven previously recovered JPEGs plus the pre-existing tiny text test object. Anonymous reads reproduced all seven previously recorded JPEG hashes and the complete eight-object manifest is retained only in the local verification workspace. No Storage API server credential is available in this session. The SQL connector remains read-only for Storage metadata, as required by Supabase. The operation has not been applied; historical public exposure remains open until reviewed code is merged and an authorized server credential is available.
