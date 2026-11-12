# PR review: preparing a head once

Every reviewer and verifier of a PR head used to rebuild the same things on its
own: a frozen copy of the head, the diffs, the changed-path list, the policy
facts and a baseline test run. `pr-review-prepare` builds them once per head
and hands every agent the same files and hashes.

It lives outside `pr-review-cli.js` on purpose: that CLI's modules are pure (no
shell, no file reads), and preparing a head runs `git` and writes files.

```bash
node packages/development/lib/pr-review-prepare-cli.js < payload.json
```

## Input

One JSON object on stdin.

| Key | Meaning |
|---|---|
| `runId` | Names the persistent run directory (required). |
| `baseSha`, `headSha` | Full object ids (required). `mergeBaseSha`, `prBaseSha` and `parentPhaseTipSha` are accepted and resolved by the same `review-range` rules, so prepare and review cannot disagree on the base. |
| `repoRoot` | The git repository holding both commits. Default: the current directory. |
| `headRef` | A ref that must still resolve to `headSha` when the step starts and right before anything is published. A head that moved is `head-moved`. |
| `lastReviewedSha`, `remediationShas` | Decide, through `chooseReviewRange`, whether `delta.diff` is produced. |
| `reviewedHeadSha` | The `reviewedHeadSha` the review-state report recorded for the last **completed** round: a head that round reviewed. The delta plan treats `lastReviewedSha` as seen only when it is this head; without it the plan is `full` (`head-never-seen`). Read it from the state, never from git: a commit the repository holds is not a head anyone reviewed. |
| `reviewedBaseSha` | The `baseSha` the same report recorded: the resolved base that round reviewed against. The delta plan is `full` (`base-moved`) when the base resolved now is another one (a retargeted PR, a moved stacked-phase parent) and `full` (`reviewed-base-unknown`) without it. `review-range` takes no reviewed base, so `mode` and `delta.diff` still follow it; only the plan compares the two. Pass the base you resolved for that round, not a moving branch tip: a tip that advanced is a base that moved. |
| `testFiles`, `testCommand` | Baseline test files (default: tests the PR changed, plus tests named after a changed source file) and the argv prefix to run them with (default: the repository's `jest`). An argument inside the real `node_modules` runs from the private copy. |
| `baselineTimeoutMs` | How long the baseline may run (default 10 minutes). A run that exceeds it is recorded with `timedOut: true`. |
| `nodeModules` | The `node_modules` the baseline resolves third-party requires from (default: `<repoRoot>/node_modules` when it exists). The baseline runs against a private copy of it; `probe.js` resolves requires from this one. |
| `stateRoot` | Default `<repoRoot>/.ensemble/pr-review/prepare`, which is git-ignored. Never a temp directory. |

## Output

`<stateRoot>/<runId>/<headSha>/<fingerprint>/` holds the files below.
`<fingerprint>` is the first 16 hex characters of the sha256 of every input that
decides what the directory holds: the schema version, the run and repository,
the base and head, the resolved range decision (mode, reason, reviewed head, the
commits nobody vouched for), `reviewedHeadSha` and `reviewedBaseSha` (they decide the delta plan),
`testFiles`, `testCommand`, `baselineTimeoutMs` and
the resolved `nodeModules`. The manifest records them under `inputs`.

| Path | Content |
|---|---|
| `snapshot/` | The head's tree from `git archive`, checked against `git ls-tree` object for object (every file, symlink and executable bit, and no other file or symlink), made read-only before any head code runs and checked again after it. The step writes nothing inside it. |
| `range.diff` | `BASE...HEAD`. |
| `delta.diff` | `lastReviewedSha..HEAD`, only when `review-range` says `delta`. Otherwise absent, with the reason under `absent` in the manifest (`first-round`, `unvouched-history`, ...). |
| `facts.json` | Policy and CODEOWNERS as the **base** commit states them, the `paths` classification (inputs and result), tier inputs, and `changedPaths`: the union of `git diff --numstat -z --no-renames BASE HEAD` (the two-argument form the skill pins) and `... BASE...HEAD` (what `range.diff` shows), in git's byte order, so a path the PR changes is never dropped when the base already holds an identical change. `numstat` has one entry per changed path (the two-argument counts where that listing names the path). `diffForm` records both commands and the `range.diff` form. `delta` and `deltaPlan` say what a re-review reads (see "The delta plan" below). |
| `probe.js` | A runner agents `require()`: `load(rel)` a module of the head, `read`, `readAtBase`, `run(argv)` (no shell, read-only snapshot as cwd) and `chain(steps)`. `load` and `read` refuse a path that leaves the snapshot, by its spelling or through a symlink the head committed. |
| `baseline.json`, `baseline.log` | The baseline test run: files and why each was picked, command (with the real `node_modules` path), exit code, the `skippedLinks` left out of the `node_modules` copy, output. Credential-shaped values and the values of inherited credential-named variables are replaced by `[REDACTED]`. |
| `manifest.json` | The inputs, their fingerprint and the sha256 of every artifact. |

The result printed on stdout carries the same paths, the `fingerprint` and
`hashes`, plus `reused` and `wallMs`. `hashes.snapshot` is a digest of the tree
listing; the other hashes are sha256 of the file bytes. `baseline.log` includes
the test runner's own timings, so key carry-over on the other hashes.

## The delta plan

A re-review after a fix push does not have to re-read the whole PR, but it must
not read less than it can justify. `facts.json` carries `deltaPlan`, the answer of
`planDeltaReview` (`lib/pr-review-delta.js`, pure), and `delta`, the facts it was
given when the range is a delta: `{ lastReviewedSha, reviewedHeadSha, reviewedBaseSha, changedPaths }`
(`changedPaths` are the paths changed in `lastReviewedSha..HEAD`, not the whole PR;
`reviewedHeadSha` and `reviewedBaseSha` are the records the payload carried, `null`
without one;
`delta` is `null` for a full range).

```json
{ "mode": "delta", "reasons": ["delta-since-last-review"],
  "readSet": [ { "path": "src/app.js", "reasons": ["caller-of:src/thing.js"] },
               { "path": "src/thing.js", "reasons": ["changed"] },
               { "path": "tests/thing.test.js", "reasons": ["test-of:src/thing.js"] } ] }
```

`mode: "delta"`: read the delta plus `readSet`, not the full range. The read set is
every path the delta changed, and

- `caller-of`: the files that reference one of them (see "How each reference form
  is handled" below);
- `test-of`: the tests that reference one, or carry its name (`thing.js` is tested by
  `thing.test.js`; a jest snapshot, `__snapshots__/thing.test.js.snap`, by the test
  that owns it);
- `names`: a file whose references the graph could not read and whose text names a
  changed file.

A path the delta deleted is listed as changed (read it in `delta.diff`); its
importers are still named. `mode: "full"` (with `readSet: []`): read the full range.
`reasons` lists every rule that applied, none is dropped:

| Reason | Meaning |
|---|---|
| `range-is-full` plus the range reason | `review-range` did not vouch for a delta (`first-round`, `unvouched-history`, ...). A full range is never turned into a delta. |
| `head-never-seen` | The review state does not record the last reviewed head as reviewed by a completed round: no `reviewedHeadSha`, or one that is not `lastReviewedSha`. A commit that is readable and in history is not enough. |
| `reviewed-base-unknown`, `base-moved` | The review state does not record the base the last round reviewed against, or the base resolved now is another one. The delta is only what changed since the last reviewed head: against a base no round reviewed, the PR changes paths nobody read (a retarget adds the new base's own history), so the whole range is read. |
| `high-path-touched`, `sensitive-path-touched` | The delta changes a High or sensitive path, or a review declaration file (`REVIEW.md`, `CODEOWNERS`), as the **base** commit's declaration classifies it. |
| `empty-delta` | The delta changes no path: nothing justifies reading nothing. |
| `unanalyzed-source-changed` | The delta changes a file the planner can read neither as code the graph analyzes (`.js .cjs .mjs .jsx .ts .tsx`) nor as documentation, data or an asset (`.md`, `.json`, `.yaml`, `.snap`, images, `.gitignore`, ...): another language (`.py`, `.sh`, `.ex`, ...), markup or style (`.html`, `.css`), `.mts`, `.vue`, a file with no extension or with one nobody listed. An allowlist: a type nobody listed fails closed instead of counting as harmless. |
| `import-graph-unavailable`, `import-graph-unreadable`, `name-scan-unavailable`, `name-scan-unreadable`, `classification-unreadable`, `classification-incomplete`, `changed-paths-unreadable`, `delta-unreadable` | An input the plan needs could not be read, so no blast radius can be justified. |

The blast radius is computed here, in the preparation step, because it needs repo
scans: one `git grep` over the head tree for the lines that can reference a file,
turned into a reverse import graph by `lib/pr-review-import-graph.js` (pure) and,
only when the graph lists files it could not read, a second one over those files.
Both anchor their pathspecs at the repository top (`git grep` has no `--full-tree`),
so the answer does not depend on the directory the step runs in. A failed scan makes
the plan `full`, not a failed preparation.

### How each reference form is handled

**Limits, stated rather than hidden.** The graph is file level: it treats "importers
of a changed file" as "callers of a changed symbol", which can only ask a reviewer to
read more.

- *Read exactly (`caller-of`, `test-of`).* Every quoted relative path on a scanned
  line (`'./x'`, `"../y"`, a template without `${}`) is an edge, whatever calls it:
  `require`, `require.resolve`, `jest.requireActual`, `jest.mock`, `import()`,
  `import ... from`, `export ... from`, a worker path, the argument line of a call
  that spans lines. Scanned files are `.js .cjs .mjs .jsx .ts .tsx .html .htm`; in HTML
  a `src` or `href` that is not a URL is a path (`./x.js`, `x.js` and `/src/x.js`, the
  last from the repository root).
- *Placed by name (`names`).* A `require`, `require.resolve`, `import()` or jest module
  call whose specifier is not a plain literal on its line names nothing the graph can
  resolve: an identifier or expression (`require(file)`), an interpolated template
  (``require(`${scripts}/x.js`)``), an argument on the next line. Its file is listed
  as computed and is read when its own text names a changed file: by a path that ends
  in the file's name (`/x`, `/x.js`) or by a quoted file name (`'x.js'`; a TypeScript
  file is named by its compiled `.js`). Directory-blind on purpose, so it reads more,
  never less. Only the computed files are searched, which keeps the read set small.
- *Not seen.* A computed specifier whose file's text names no changed file; a
  reference by string path from a file that otherwise reads exactly (a test that
  spawns a script by path is found only by its name); importers of importers; bare
  package specifiers; a test that only mentions a changed file in a comment or a
  label; a loader that enumerates a directory. These are the doubts the plan cannot
  attribute to the delta; a reviewer who suspects one asks for the full range.

## Guarantees

- **Fail closed.** An unreadable base or head, a head that moved, a snapshot that
  is not exactly the head tree (an `export-ignore` or eol attribute, a
  case-folding checkout, or a change made while the baseline ran), a `REVIEW.md`
  or `CODEOWNERS` that exists at the base but is a symlink, directory or
  submodule, a baseline that could not be started, and a baseline that wrote into
  the staging directory (`baseline-tampered`) return `{ ok: false, status:
  "PREPARE_FAILED", reason, stage, detail }`. Nothing is published: artifacts are
  built in a staging directory and renamed into place after every check passed.
  A file that is absent at the base is not an error: the policy then comes from
  the defaults and `facts.guidance` says so.
- **Idempotent, and nothing on disk is taken on its own word.** The same inputs
  return the published directory without running anything (`reused: true`), but
  only after the step derived what git can tell again (the diffs, `facts.json`,
  `probe.js`, the names declared absent, the range decision, the snapshot
  against the head's tree) and found the directory holding exactly that. A
  manifest whose hashes agree with its own files is not enough: a baseline test
  can create the directory the step is about to publish. Only the baseline's own
  output (`baseline.json`, `baseline.log`), which nobody can derive, is taken as
  recorded, and only when it agrees with the manifest. That output is an
  observation made once: the same inputs reuse it even if the Node version, the
  environment or the contents of `node_modules` changed since, so use a new
  `runId` for a fresh one. A directory that fails the check is rebuilt; a
  directory that appears while the step runs is used only if it passes the same
  check, otherwise the step fails with `publish-failed`.
- **Other inputs never replace a directory.** A preparation with any other input
  has another directory, so one a reader holds is never replaced or removed.
  When this module changes what it derives, bump `SCHEMA_VERSION`: it is part of
  the fingerprint, so a directory of the old version is rebuilt.
- **Read-only snapshot.** To remove a run, or one head of it, call
  `removePrepared(dir)` from `pr-review-prepare.js`; a plain `rm -rf` stops at
  the read-only directories. The step removes its own scratch and staging
  directories the same way. A removal that fails is reported with the result
  (`leftovers` after a success, a note in `detail` after a failure), never thrown.
- A failing baseline is data, not an error: it is recorded with its exit code. A
  baseline that timed out is recorded with `timedOut: true` and a `null` exit code.

## The baseline executes the head's test code

The baseline runs the PR's own tests, so the PR's author decides what runs. It is
contained the way a `local-ci` gate step is, and no further.

What it does:

- runs in a scratch directory in the OS temp directory (`TMPDIR`), outside the
  repository, the state root and the staging directory. A path relative to its
  working directory therefore reaches none of them: not the staging directory
  that is about to be attested, not the repository's `node_modules` or `.git`.
  The scratch directory is removed before anything is published. Where the temp
  directory is memory (`tmpfs`, the Linux default for `/tmp`), the `node_modules`
  copy below lives in memory while the baseline runs;
- gets only the variables the `local-ci-runner.js` allowlist passes a step
  (currently `USER`, `LOGNAME`, `SHELL`, `LANG`, `LC_ALL`, `TERM`, `TMPDIR`,
  `NODE_OPTIONS`; a test pins the two lists together), plus `CI=true`, `PATH`,
  `NODE_PATH` and a throwaway `HOME` that is removed afterwards. The rest of the
  maintainer's environment, credentials included, is not passed on;
- gets `GIT_CEILING_DIRECTORIES` set to its scratch directory, so a `git` command
  a test runs in its working directory fails as outside any repository wherever
  `TMPDIR` points, even into a checkout, instead of finding the maintainer's
  repository and acting on it (a `git checkout` or `git clean` used to reset a
  fixture);
- runs against a private copy of `node_modules` (a copy-on-write clone where the
  filesystem has one, a plain copy elsewhere; `.cache` directories are skipped).
  It is a copy because a link would let the run write into the real dependency
  tree. Relative symlinks inside it stay inside the copy; an absolute symlink (an
  `npm link`) would lead back into the live tree, so it is left out and named in
  `baseline.json` under `skippedLinks`. The cost grows with the number of files:
  7 s for this repository's 541 MB, 25,000-file tree on APFS at load average 10,
  most of the step's wall time there;
- while it runs, staging holds only the read-only snapshot. `facts.json`,
  `probe.js` and the diffs are held in memory and written after it, so there is
  nothing for it to rewrite before it is attested. Afterwards the snapshot is
  verified again and any other entry in staging fails the step;
- has its whole process group killed when it ends, however it ended, so a process
  it left behind cannot keep writing after the artifacts are hashed.

What it does not do. It is not a sandbox: it is the invoking user's process, with
that user's file permissions and network.

- It can read and write anything that user can, by absolute path: the
  repository, `~/.ssh`, `~/.aws`, shell profiles. A scratch `HOME`, a filtered
  environment and a working directory outside the repository stop tools and
  careless tests that consult `$HOME`, the environment or a relative path; they
  do not stop code that looks up the real home directory in the password
  database (`os.userInfo()`), reads a parent process's environment (on Linux,
  `/proc/<pid>/environ`), names the staging directory or the repository by its
  absolute path or sends data over the network. A write to the staging directory
  is detected and fails the step; one to the repository, including `.git`, is
  not.
- `TMPDIR` and `NODE_OPTIONS` are inherited, so files in the real temp directory
  are reachable.
- A process that leaves the process group (for example with `setsid`) outlives
  it. A directory that was published can then be changed afterwards; the next
  call for the same inputs derives and compares again and rebuilds it, but a
  reader who never calls prepare again does not notice.
- A background process that keeps the baseline's output pipes open holds the step
  until it exits or `baselineTimeoutMs` passes; the run is then recorded with
  `timedOut: true`.
- The read-only seal on the snapshot is permission bits. It stops a stray write
  by a test, not the owner, and the baseline runs as the owner.
- `exitCode`, `timedOut` and `baseline.log` are what the head's own tests report:
  a test can exit 0 or print what it likes. They are evidence about the run, not
  a verification of it.
- `probe.js` is not part of this containment: `load` and `run` execute head code
  in the caller's own process and environment, which is their purpose.
- Credential values are scrubbed from `baseline.log` only for variables whose
  name looks like a credential (`TOKEN`, `SECRET`, `KEY`, `PASSWORD`,
  `CREDENTIAL`, `AUTH`) and whose value is at least 6 characters, plus the known
  token shapes.

Prepare only heads whose tests you are willing to run on the machine that runs
this step. For a head you do not trust, run the step where nothing else of value
is reachable.
