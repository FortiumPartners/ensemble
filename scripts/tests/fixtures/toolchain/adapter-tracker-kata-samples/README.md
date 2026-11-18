# adapter-tracker-kata-samples

Recorded kata v0.23.0 envelopes for the non-entity capabilities declared in TRD-033.

- `kata-label-add.sample.json`: `kata label add <ref> <label> --json` (raw capture, re-indented; `~/.omp/trd-6995dc96/capture/label-add2.json`). Answers a singular `label`, no `labels` array.
- `kata-find-by-key.sample.json`: `kata list --status all --limit 0 --json` (copy of `packages/development/tests/fixtures/kata/list.json`; a collection envelope).

Used by `packages/development/tests/kata-nonentity-schemas.test.js`.
