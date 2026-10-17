# Repos that track `.beads/issues.jsonl`

`br` stores beads in `.beads/beads.db` and exports them to `.beads/issues.jsonl`. This guide
applies only if your repo **tracks** `issues.jsonl` in git, as the `br` docs recommend. (This
repo ignores it, so none of it applies here.)

## What goes wrong

`.beads/beads.db` is not in git and is **shared by every branch and worktree of the clone**.
Each `br` write updates the tracked export, so on a feature branch the working
`issues.jsonl` can contain beads from other TRDs, lines in a different order, and status changes
to beads this branch never touched. Committing it as it stands puts all of that into the TRD's PR,
and nothing reports an error.

It also makes the working tree look dirty right after Scaffold, because the export changed.

## What the commands do

- Every bead `implement-trd-beads` creates carries a **label** equal to its TRD slug.
  `beads-build` passes it to `bv --robot-plan --label`, so a plan never includes another TRD's beads.
- `git status --porcelain` checks in `implement-trd-beads`, `beads-build` and `beads-build-wave`
  ignore `.beads/`, which is `br`'s own state, so the command no longer halts on the export it just wrote.
- Checkpoint commits, the checkbox-sync commit and the closing reminder stage the export with
  `trd-cli beads-stage`, never `git add .beads/` or `git commit -a`.

## `beads-stage`

```
node "$TRD_CLI" beads-stage --match "[trd:<slug>"          # stage only this TRD's beads
node "$TRD_CLI" beads-stage --match "[trd:<slug>" --check  # fail if the staged export touches another TRD
```

It builds the export as HEAD has it, with this TRD's beads replaced or appended, and writes that
into the git **index**. Other TRDs' additions, reorderings and status changes are left out. The working
`issues.jsonl` is not modified, so `br` is not fighting you; after you commit, it still differs from
HEAD, which is expected. `--match` takes a bead-title substring (comma-separated for several); a
`[trd:<slug>` entry (no closing bracket) matches only that exact slug, i.e. when followed by `]` or `:`,
so `[trd:foo` does not capture `[trd:foo-bar...]`. `--label <l>` matches by label. If the export is not
tracked it does nothing.

If you commit by hand, run `beads-stage` first, then `git commit`. If you already ran
`git add .beads/`, run `beads-stage --check`; it names any bead that is not part of this TRD, and
running `beads-stage` again repairs the index.

## Caveats

- Beads are matched by the `[trd:<slug>` title prefix, or by label. A bead of this TRD whose title
  was edited to drop the prefix is not staged; add the label with `beads-label` or pass `--label`.
- `trd-cli beads-label --label <slug> --match "[trd:<slug>"` adds the label to TRDs scaffolded before
  labels existed; the commands run it for you.
