# kata fixture envelopes

Real JSON envelopes recorded from `kata` v0.23.0 on 2026-11-15 by
`packages/development/tests/helpers/kata-scratch.js`, against a throwaway workspace bound to
the synthetic project `trd-kata-scratch` under an isolated `KATA_HOME`.

These are **recordings, not hand-written samples**. The mapping tasks that come after
TRD-001 need the keys kata actually returns — a hand-authored envelope can only claim to
have that shape, and a mapping written against a claimed shape is exactly the kind of
assertion the tracker contract is meant to prevent. Each file is byte-for-byte what the
corresponding command printed, re-indented for review.

| File | Command that produced it | Top-level keys |
| --- | --- | --- |
| `list.json` | `kata list --status all --limit 0 --json` | `kata_api_version`, `complete`, `truncated`, `issues` |
| `show.json` | `kata show <short_id> --json` | `kata_api_version`, `web_url`, `issue`, `comments`, `comments_truncated`, `links`, `labels` |
| `ready.json` | `kata ready --json` | `kata_api_version`, `issues` |
| `status.json` | `kata status <short_id> --json` | `kata_api_version`, `issue`, `project`, `issue_status`, `revision`, `actor`, `actor_source`, `auth`, `instance`, `owner`, `hold` |

## The seeded workspace

The recorder seeds three items before reading, so the envelopes describe a workspace with
structure rather than an empty one:

- `alpha` — open, priority 2, labels `probe` and `seed`, owned by `bot:probe`. Owned items
  are kata's representation of in-progress work, so this is what makes `status.json` carry a
  non-empty `owner` and `hold: assigned`.
- `beta` — open, priority 3, label `probe`, unowned, and **blocks** `alpha`. `beta` is
  therefore the only item in `ready.json`, and `show.json`'s `links` array carries the
  `blocks` edge.
- `gamma` — closed, priority 1, label `probe`, metadata
  `ensemble_external_key: TRD-SEED-0001`. Closed so the `list` envelope carries a closed row
  and a dedupe key to read.

## What varies between recordings

`short_id`, `uid`, `id`, `project_id`, `project_uid`, `instance`, `revision`, `created_at`,
`updated_at`, `actor`, and the `web_url` port are all values of the recording run, not
constants of the contract. A test that asserts on them is asserting on the fixture, not on
kata. Regenerate with:

```js
const { withKataScratch } = require('./helpers/kata-scratch');
withKataScratch((ws) => {
  const ids = ws.seed();
  ws.recordFixtures('packages/development/tests/fixtures/kata', { showId: ids[0] });
});
```

The harness never records from a real project: `KATA_HOME` points inside the scratch
directory, the git origin is on the RFC 2606 reserved `example.invalid` host, and the
scratch directory is removed with its daemon state when the run ends.
