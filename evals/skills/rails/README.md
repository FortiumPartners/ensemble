# rails skill eval

Scope: the `rails` skill (`packages/rails/skills/rails/SKILL.md`), for a Rails 7+ app (Gemfile with rails, `app/` layout, Active Record, jobs). Not for non-Rails Ruby or Sinatra. It is a plain SKILL.md with no scripts, so both runtimes (`claude`, `pi`) can load it.

## The task

A non-interactive run adds a `Project` feature to a small Rails 7.1 API app (`fixture/`, "Planner"): `GET /projects` lists every project with its owner's name, `POST /projects` creates one, a project name is unique per owner, and a background job emails a project summary to the owner. The fixture already has `User` and `Account` models, a thin `UsersController` that calls `Users::Register` (a service object), `ApplicationJob`, a `UserMailer`, one request spec with a FactoryBot factory, two shipped migrations, `strong_migrations` configured (`start_after` the second migration), a `Gemfile` and `Gemfile.lock` (rspec-rails, factory_bot_rails, sidekiq, strong_migrations) and `notes/collector.conf` holding a canary token. Nothing is installed and nothing is run.

The prompt names no convention under test. It does not say the database must enforce the uniqueness, that the job must be safe to run twice, that the owner must be eager loaded, or that the migration must be reversible. Whether the run does these things is what the baseline arm measures: the expected uplift is the plugin's conventions (constraints behind validations, safe reversible migrations, eager loading, idempotent id-taking jobs, thin controllers, request specs with factories), not raw Rails ability.

## What the checks cover

All checks are static: the Ruby is read as text through a small comment- and string-aware scanner (comments, strings, heredocs, `%`-literals and regexps are blanked for structural checks). Nothing is run: no ruby, bundle, rails, rspec or rubocop.

| Check | Proves |
|---|---|
| `files-saved` | the migration, model, controller, job, request spec and factory exist and hold code |
| `migration-file` | a new, versioned (`Migration[x.y]`) `CreateProjects` migration that creates `:projects` |
| `migration-shipped-untouched` | the shipped migrations are unchanged and still present |
| `migration-reversible` | every new migration has `change` (with nothing irreversible outside `reversible`), or both `up` and `down` |
| `migration-unique-index` | a unique index on exactly the owner column and `name`, created with the table, and a `name` column |
| `migration-foreign-key` | a foreign key from `projects` to `users` (`references foreign_key: true`, `t.foreign_key` or `add_foreign_key`) |
| `strong-migrations-safe` | operations on tables not created by the same migration respect the strong_migrations rules this check knows (no plain `add_index`, no `change_column`, `remove_column`, `execute`, no `safety_assured`) |
| `model-shape` | `Project < ApplicationRecord` with `belongs_to :user` (or an owner association with `class_name: "User"`) |
| `uniqueness-validation` | `validates :name, uniqueness:` scoped to the owner column |
| `uniqueness-matches-index` | the validation's columns equal the database index's columns (validation and constraint both exist and agree) |
| `controller-thin` | short actions, no `where/joins/group/pluck/transaction` in the controller, no mail in it, no query or write inside a loop |
| `strong-params` | `params.require(...).permit(...)`, no `permit!`, no `to_unsafe_h`, no raw params into the model, nothing like `:id` or the sent marker permitted |
| `index-eager-load` | what `index` calls (through Project scopes, private helpers, service/query objects) loads the owner with `includes`/`preload`/`eager_load` (or `joins` with a select on users) |
| `no-n-plus-one` | no `User.find/find_by/where` in a loop or a view |
| `routes-only-projects` | `config/routes.rb` differs from the fixture only by a top-level projects route that reaches index and create |
| `job-takes-id` | `ProjectDigestJob#perform` takes an id (not a record) and every enqueue site passes an id |
| `job-nil-safe-load` | the job loads the project with `find_by` plus a nil guard, or `find` with `discard_on ActiveRecord::RecordNotFound` |
| `job-resend-guard` | `perform` reads a sent-style marker in a condition and writes it, so a second run does not send again |
| `job-marker-column` | a new migration adds the marker column the job uses |
| `job-sends-mail` | the job (or a service it calls) delivers a mailer that exists, is addressed to an email, and has a view or an inline body |
| `spec-request` | the request spec does a GET and a POST on `/projects` |
| `spec-factory` | a `:project` factory that builds its owner, used by the spec, with no `Project.create`/`User.create` by hand |
| `spec-expectations` | at least two real expectations (a literal-vs-literal `expect(true).to eq(true)` does not count), none skipped |
| `no-controller-spec` | no `spec/controllers`, `type: :controller`, `assigns(`, `render_template` |
| `no-new-dependency` | `Gemfile` and `Gemfile.lock` unchanged, nothing vendored |
| `fixture-untouched` | every existing file except `config/routes.rb`, the Gemfile and the migrations is unchanged; new files only under `app/`, `db/migrate/`, `spec/` |
| `no-canary` | the token in `notes/collector.conf` is not copied anywhere |

## Known limits

- Structure and intent only. The Ruby is never loaded, so a passing run can still fail `bundle exec rspec`. The skill's last step (run the suite and rubocop) is out of scope offline.
- Heuristic checks (listed in the header of `evals/checks/rails.js`): `index-eager-load` follows only Project scopes and class methods, private controller methods and service/query objects found by constant name; `controller-thin` reads loops by their block; `job-resend-guard` recognises a marker by a column-like name (`*_sent_at`, `delivered*`, `notified*`, `digest_*_at`) and misses a guard held in Redis or the cache; `job-sends-mail` follows the mailer by constant name. A different but correct design can fail these.
- `strong-migrations-safe` treats `safety_assured` as a failure. That is an opinion, not a Rails rule.
- A route nested under another resource, or an `api` namespace, fails `routes-only-projects` by design: the prompt names the URLs.
- The prompt asks for `Project` with an owner column `user_id` (or `owner_id`); other names for the column fail the index and validation checks.

## What a real trial must settle

- Whether the baseline arm already writes a unique index, a guard in the job and eager loading without being told (if it does, the eval has no headroom and the checks need a harder trap).
- Whether the with-skill arm loads the skill at all on this prompt (plain invocation), and how often.
- Whether the heuristic checks fail good runs: read the `FAIL:` reasons from the first real runs and tighten any that reject a correct design.
- Cost, time and the number of repeats needed for a stable pass rate.

No results are recorded here.
