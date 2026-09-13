# REM workbook source integrity

Verified on 2026-09-13 against two independently recovered copies of the production workbook. Neither original was edited or saved by the parser or the acceptance checks. Source binaries remain outside the repository.

| Recovered copy | SHA-256 |
| --- | --- |
| `2026 Production Plan.xlsx` | `5bdc4d2780da70a3c05201cfc70ae1275576428471cbd82192e5c69de2005284` |
| `2026 Production Plan(1).xlsx` | `e1394a11710e838fa5f1fa0b4125e5ac7d6896ae70c99292ee33175f9c16ae4b` |

## Import status

The combined production import is **blocked by source formula corruption** in both copies. Operational parsing alone succeeding does not establish that the full upload can be applied.

`Tracker!AD24` contains the literal formula:

```text
=SUM('Build Plan'!#REF!)
```

Its saved result is `#REF!`. Both copies contain 38 cached formula errors on Tracker, including this broken reference and dependent quarter/annual accumulations. The inspected Build Plan, Staff, Notes - Issues, and latest VITROS WIP sheets contain no cached Excel error cells. The full production parse rejects the source at `Tracker!AD24` before operational staging or any import action can start.

The broken reference is associated with source week 22 (`Tracker!AA24`). Neighboring references also disagree with the Build Plan week identifiers:

| Tracker source | Referenced Build Plan cell | Week identified by the referenced Build Plan row |
| --- | --- | --- |
| `AD22`, week 20 | `AQ26` | Week 21 |
| `AD23`, week 21 | `AQ28` | Week 23 |
| `AD25`, week 23 | `AQ29` | Week 24 |

These mismatches prevent a safe one-cell repair based on adjacent formulas. Neither recovered copy supplies a verified clean reference, and no earlier valid workbook was verified during recovery. A missing referenced actual must not be replaced with zero or inferred from a neighboring week.

## Required source correction

The workbook owner must provide a corrected source workbook. The correction needs to restore the intended Tracker-to-Build Plan week relationships, resolve the broken reference and dependent errors, and recalculate and save the workbook in its intended spreadsheet application. Recalculation alone cannot repair a formula containing literal `#REF!`.

After receiving that file, rerun the full production parser with `cellDates: true`, review all reported source warnings, and verify the import preview before staging. The current two files must remain unchanged as source evidence.

## Parser handling and verification

The exact `SCRAP` production-order marker is now classified as an explicit WIP exclusion and reported in the preview's skipped count and warnings. Other malformed production-order strings and formula errors still reject. This code correction does not repair or bypass the Tracker source defect.

`scripts/rem-workbook-parser-acceptance.mjs` accepts private workbook paths as command-line arguments. Its real-source regression invokes the same core-then-operational parse order used by BulkImport, with the same `cellDates: true` option. For the two hashes above, it asserts an actionable failure at `Tracker!AD24` and confirms the source formula is unchanged. Independent checks of unaffected sections are diagnostic evidence only. Console evidence records source hashes, aggregate metadata, and the blocked status; no source row contents are committed.

The operational import contract is fixed by this migration and parser release. A future parser change that alters record meaning or identity requires an explicit contract version/migration change; it must not silently reuse an existing completed-import receipt under new semantics.
