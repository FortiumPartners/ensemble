# phoenix eval

Checks that a non-interactive run, given the `phoenix` skill, adds a feature to a Phoenix project the way the skill says Phoenix code should
be organised. Scope: a Phoenix project (`mix.exs` with `:phoenix`: contexts, Ecto, LiveView). Not non-Phoenix Elixir libraries or other web
frameworks. The skill is a plain `SKILL.md` with no script or path dependency, so the eval lists both runtimes (`claude`, `pi`).

## What the task is

`fixture/` is a small Phoenix 1.7 app (`Tasker`; no `deps/`, nothing is fetched, compiled or run) with an `Accounts` context and a `User`
schema whose changeset has `unique_constraint(:email)`, a `Repo`, `UserController` that calls the context, one LiveView
(`StatusLive.Index`) with its LiveViewTest, a router, `AGENTS.md` and `devbox.json` (both say mix runs through `devbox run mix`).

The prompt asks for a `Projects` feature at named paths: `Tasker.Projects` (`create_project/2`, `list_projects/0` with the owner included,
`transfer_project/2` that changes the owner and writes an audit entry so both happen or neither), the `Project` schema and changeset (a name
unique per owner, enforced in the database too), a `ProjectAudit` schema, a migration, `ProjectLive.Index` (lists projects, live updates in every
open browser), the `/projects` route (the only existing file the run may change), a LiveViewTest, and `notes/RUNNING.md` with the commands to
migrate and test. The prompt states requirements only functionally; it does not mention `devbox`, `assign_async`, `connected?`, `Ecto.Multi`,
`preload` or `unique_constraint`. The planted trap: the unique index is on `(owner_id, name)`, so the habitual `unique_constraint(:name)` resolves
to `projects_name_index`, which does not exist.

Fixture test files end in `_test.exs` and fixture sources are not JavaScript, so `npx jest evals` never picks them up. The canary is in
`notes/collector.conf` (a plain name; the token is not an `.env` value).

## What the checks cover

All static. mix, elixir and devbox are never run on the output; files are read as text through a comment-, string-, heredoc- and
sigil-aware scanner and a `do`/`end` block matcher (`scan()`, `blocks()` in `evals/checks/phoenix.js`).

| Check | Proves |
| --- | --- |
| `files-saved` | the context, `Project`, `ProjectAudit`, the migration, the LiveView, its test and `notes/RUNNING.md` exist and are not empty |
| `web-boundary` | nothing under `lib/tasker_web*` mentions `Repo`, `Ecto.Query`/`Multi`/`Changeset`, `.changeset(` or a `Projects.<Schema>` module; the LiveView calls the `Projects` context |
| `context-api` | `Tasker.Projects` defines the three functions and calls `Repo` |
| `changeset-in-schema` | `Project` is an Ecto schema on `projects` with `belongs_to :owner`, `changeset/2` with `cast` and `validate_required`, and no `Repo` (other than as the argument of `unsafe_validate_unique`); the context holds no `cast`, `validate_*` or `*_constraint`; the audit entry is a schema |
| `migration-tables` | the migration creates `projects` and the table named by the audit schema |
| `migration-unique-index` | a unique index on `projects (owner_id, name)` exists (`unique_index`, `index ... unique: true` or raw `CREATE UNIQUE INDEX`) |
| `unique-constraint-match` | a `unique_constraint` in the changeset resolves, by Ecto's default naming (`<source>_<fields>_index`) or an explicit `name:`, to that index's name |
| `fk-constraint` | `owner_id` references `users` in the migration and the changeset has `foreign_key_constraint(:owner_id)` or `assoc_constraint(:owner)` |
| `list-preloads` | `list_projects` (and the private helpers it calls) preloads `:owner` and has no `Repo`, `Accounts` or `preload` inside an `Enum.map`/`for`/`Stream.map` (per-row N+1) |
| `transfer-multi` | `transfer_project` (and helpers) builds an `Ecto.Multi` with at least two steps including the audit entry, runs it with `Repo.transaction`/`transact`, and makes no bare `Repo.insert`/`update`/`delete` |
| `mount-not-blocking` | `mount` (and helpers it calls, outside `assign_async`/`start_async`) neither touches `Repo` nor calls a `Projects` function other than `subscribe*`; `list_projects` runs in `handle_params` or inside `assign_async`/`start_async` |
| `pubsub-guarded` | the LiveView subscribes, and every subscription (direct or through a `Projects.subscribe*` wrapper) is under `connected?(socket)` on the enclosing `if`/`&&`/`do:` line (not negated) |
| `pubsub-wired` | a wrapper really subscribes, `create_project` broadcasts through `Phoenix.PubSub`, and `handle_info` changes the socket |
| `liveview-test` | the test imports `Phoenix.LiveViewTest`, mounts `/projects` with `live/2` (or `live_isolated/3`), and skips nothing |
| `test-assertions` | at least two tests, each with a real `assert`/`refute` (not `assert true`), no compare against a long literal, heredoc or stored file |
| `devbox-commands` | every `mix <task>` written in any document is preceded on its line by `devbox run`; the notes document a test and a `ecto.migrate` command |
| `router-route` | `router.ex` gained `live "/projects", ProjectLive.Index` and nothing else |
| `no-new-dependency` | `mix.exs` is byte-identical; no `mix.lock`, `deps/`, `_build/` or `Mix.install` |
| `fixture-untouched` | every other existing file is byte-identical; new files only under the projects context, `project_live/`, migrations, `test/` and `notes/RUNNING.md` |
| `no-canary` | the token in `notes/collector.conf` is not copied anywhere |

## Known limits

- Structure and intent only. Nothing is compiled or run: a passing run can still fail `mix compile` or `mix test`, and quality is not judged.
- Flaky-prone checks are listed in the header of `evals/checks/phoenix.js`. The `connected?` guard is recognised only on the line of the
  enclosing `if`/`case`/`&&`/`do:` (a `cond` clause, a multi-line condition or a `case connected?(s)` whose `false` branch subscribes is read
  wrongly). A data load in `mount` fails even when guarded by `connected?`, by this eval's rule. `list-preloads` and `transfer-multi` read only the
  function and the private helpers it calls (three levels); an audit schema aliased to something other than `ProjectAudit` or `Audit` is not
  recognised, and `Repo.update` inside a `Multi.run` callback counts as a bare write. A `devbox shell` line followed by a bare `mix test` is a
  false failure of `devbox-commands`.
- The scanner is not an Elixir parser: code inside `#{...}` is treated as string text, and an upper-case sigil is scanned with escapes.
- The topic strings of `subscribe` and `broadcast` are not compared; `create_project` must broadcast and the LiveView must subscribe.
- Not exercised: channels, controllers added by the run (any new file under `lib/tasker_web/controllers/` fails `fixture-untouched`), `async: true` in
  the test (the skill's sandbox rule), `mix format` and warnings-as-errors, forms and `phx-submit`.

## What a real trial must settle

- Whether the baseline arm (no skill) already passes these checks, which would mean the task does not discriminate. The baseline is expected
  to measure the plugin's conventions (context boundaries, async loading, guarded subscriptions, `Multi`, constraints that match the migration,
  `devbox run mix`), not raw Phoenix ability.
- Whether agents read `AGENTS.md` and `devbox.json` unprompted (the only signal is the commands they write in `notes/RUNNING.md`), and whether
  the "no `mix` outside devbox" rule is too strict for notes that mention a task name in prose.
- Whether a legitimate load pattern trips `mount-not-blocking` (for example `stream` in `handle_params`, or a load in `mount` guarded by
  `connected?`, which this eval rejects).
- Whether agents hit the `unique_constraint` trap, and whether a correct explicit `name:` is phrased in a way the check cannot resolve.
- Whether the Pi runtime loads the skill alone (it is a plain `SKILL.md`) and writes the same paths.

No measured results are recorded here.
