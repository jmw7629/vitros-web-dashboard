-- Preserve legacy receipts while permitting the nullable/source-accuracy importer.
alter table public.rem_authoritative_import_runs
  drop constraint rem_authoritative_import_runs_schema_version_check;
alter table public.rem_authoritative_import_runs
  add constraint rem_authoritative_import_runs_schema_version_check
  check (schema_version in (2, 3));
