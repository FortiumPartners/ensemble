'use strict';

/**
 * Kit tests for the `phoenix` skill eval: a good output passes every check, differently phrased good outputs do too, and bad outputs
 * each fail the named check (and only it). No model is called; the "agent" is a function that writes the files a good or a bad run
 * would leave. The Elixir below is never compiled or run; it is only text for the static checks.
 */

const kit = require('../skill-eval-kit');
const { scan, blocks, functions, closure, maskCalls, migrationIndexes } = require('../../checks/phoenix');

const ID = 'phoenix';
const IDS = [
  'files-saved', 'web-boundary', 'context-api', 'changeset-in-schema', 'migration-tables', 'migration-unique-index', 'unique-constraint-match',
  'fk-constraint', 'list-preloads', 'transfer-multi', 'mount-not-blocking', 'pubsub-guarded', 'pubsub-wired', 'liveview-test', 'test-assertions',
  'devbox-commands', 'router-route', 'no-new-dependency', 'fixture-untouched', 'no-canary',
];
const PATHS = {
  context: 'lib/tasker/projects.ex',
  schema: 'lib/tasker/projects/project.ex',
  audit: 'lib/tasker/projects/project_audit.ex',
  migration: 'priv/repo/migrations/20240201000000_create_projects.exs',
  live: 'lib/tasker_web/live/project_live/index.ex',
  test: 'test/tasker_web/live/project_live_test.exs',
  notes: 'notes/RUNNING.md',
  router: 'lib/tasker_web/router.ex',
};

const GOOD = {
  context: `defmodule Tasker.Projects do
  @moduledoc "Projects context. Repo is only used here."

  import Ecto.Query, warn: false

  alias Ecto.Multi
  alias Tasker.Projects.{Project, ProjectAudit}
  alias Tasker.Repo

  @topic "projects"

  def subscribe, do: Phoenix.PubSub.subscribe(Tasker.PubSub, @topic)

  def list_projects do
    Project
    |> order_by([p], asc: p.name)
    |> preload(:owner)
    |> Repo.all()
  end

  def create_project(owner, attrs) do
    %Project{owner_id: owner.id}
    |> Project.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, project} ->
        project = Repo.preload(project, :owner)
        broadcast({:project_created, project})
        {:ok, project}

      error ->
        error
    end
  end

  def transfer_project(%Project{} = project, new_owner) do
    Multi.new()
    |> Multi.update(:project, Project.transfer_changeset(project, new_owner))
    |> Multi.insert(:audit, ProjectAudit.changeset(%ProjectAudit{}, %{
      project_id: project.id,
      from_owner_id: project.owner_id,
      to_owner_id: new_owner.id
    }))
    |> Repo.transaction()
    |> case do
      {:ok, %{project: updated}} -> {:ok, updated}
      {:error, _step, changeset, _changes} -> {:error, changeset}
    end
  end

  defp broadcast(message), do: Phoenix.PubSub.broadcast(Tasker.PubSub, @topic, message)
end
`,
  schema: `defmodule Tasker.Projects.Project do
  use Ecto.Schema
  import Ecto.Changeset

  schema "projects" do
    field :name, :string
    belongs_to :owner, Tasker.Accounts.User

    timestamps()
  end

  def changeset(project, attrs) do
    project
    |> cast(attrs, [:name, :owner_id])
    |> validate_required([:name])
    |> unique_constraint([:owner_id, :name])
    |> foreign_key_constraint(:owner_id)
  end

  def transfer_changeset(project, new_owner) do
    project
    |> change(owner_id: new_owner.id)
    |> foreign_key_constraint(:owner_id)
  end
end
`,
  audit: `defmodule Tasker.Projects.ProjectAudit do
  use Ecto.Schema
  import Ecto.Changeset

  schema "project_audits" do
    field :project_id, :integer
    field :from_owner_id, :integer
    field :to_owner_id, :integer

    timestamps()
  end

  def changeset(audit, attrs) do
    audit
    |> cast(attrs, [:project_id, :from_owner_id, :to_owner_id])
    |> validate_required([:project_id, :from_owner_id, :to_owner_id])
  end
end
`,
  migration: `defmodule Tasker.Repo.Migrations.CreateProjects do
  use Ecto.Migration

  def change do
    create table(:projects) do
      add :name, :string, null: false
      add :owner_id, references(:users, on_delete: :restrict), null: false

      timestamps()
    end

    create unique_index(:projects, [:owner_id, :name])

    create table(:project_audits) do
      add :project_id, :integer, null: false
      add :from_owner_id, :integer, null: false
      add :to_owner_id, :integer, null: false

      timestamps()
    end
  end
end
`,
  live: `defmodule TaskerWeb.ProjectLive.Index do
  use TaskerWeb, :live_view

  alias Tasker.Projects

  @impl true
  def mount(_params, _session, socket) do
    if connected?(socket), do: Projects.subscribe()
    {:ok, assign(socket, page_title: "Projects")}
  end

  @impl true
  def handle_params(_params, _uri, socket) do
    {:noreply, assign(socket, :projects, Projects.list_projects())}
  end

  @impl true
  def handle_info({:project_created, project}, socket) do
    {:noreply, update(socket, :projects, &[project | &1])}
  end

  @impl true
  def render(assigns) do
    ~H"""
    <h1>Projects</h1>
    <ul id="projects">
      <li :for={project <- @projects} id={"project-#{project.id}"}>
        {project.name} (owner: {project.owner.name})
      </li>
    </ul>
    """
  end
end
`,
  test: `defmodule TaskerWeb.ProjectLiveTest do
  use TaskerWeb.ConnCase, async: true

  import Phoenix.LiveViewTest

  alias Tasker.{Accounts, Projects}

  setup do
    {:ok, owner} = Accounts.register_user(%{email: "a@example.com", name: "Ada"})
    {:ok, owner: owner}
  end

  test "lists projects with their owner", %{conn: conn, owner: owner} do
    {:ok, _} = Projects.create_project(owner, %{name: "Apollo"})
    {:ok, view, html} = live(conn, ~p"/projects")
    assert html =~ "Apollo"
    assert has_element?(view, "#projects li", "Ada")
  end

  test "shows a project created while the page is open", %{conn: conn, owner: owner} do
    {:ok, view, _html} = live(conn, ~p"/projects")
    refute render(view) =~ "Gemini"
    {:ok, _} = Projects.create_project(owner, %{name: "Gemini"})
    assert render(view) =~ "Gemini"
  end
end
`,
  notes: `# Running tasker

Everything goes through the pinned toolchain.

\`\`\`sh
devbox run mix ecto.migrate
devbox run mix test
\`\`\`
`,
};
const ROUTE = '    live "/projects", ProjectLive.Index, :index\n';

/** A stub agent that saves the given files (overrides merged over GOOD; null skips a file) and adds the route to router.ex. */
const saves = (over = {}, extra = {}, opts = {}) => (ws) => {
  const files = { ...GOOD, ...over };
  for (const [k, text] of Object.entries(files)) if (text !== null) ws.write(PATHS[k] || k, text);
  if (opts.route !== false) {
    const router = ws.read(PATHS.router);
    ws.write(PATHS.router, router.replace('    live "/status", StatusLive.Index, :index\n', `    live "/status", StatusLive.Index, :index\n${opts.route || ROUTE}`));
  }
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
  for (const rel of opts.remove || []) ws.remove(rel);
};
const withRepl = (key, from, to) => {
  if (!GOOD[key].includes(from)) throw new Error(`test setup: ${key} does not contain ${JSON.stringify(from)}`);
  return { [key]: GOOD[key].split(from).join(to) };
};
const run = (over, extra, opts) => kit.runEval(ID, saves(over, extra, opts));


// ---- bad outputs: each fails the named check --------------------------------------------------------------------------------

/** [title, files override, extra files, opts, failing ids, reason, onlyThose] */
const BAD = [
  // files-saved
  ['an empty notes file fails files-saved', { notes: '\n' }, {}, {}, ['files-saved', 'devbox-commands'], /RUNNING\.md is missing or empty/],
  ['a missing LiveView file fails files-saved', { live: null }, {}, {}, ['files-saved'], /project_live\/index\.ex is missing or empty/],
  ['a missing LiveView file is named by the LiveView checks', { live: null }, {}, {}, ['web-boundary', 'files-saved', 'mount-not-blocking', 'pubsub-guarded', 'pubsub-wired'], /project_live\/index\.ex is missing/],
  ['a missing notes file is named by devbox-commands', { notes: null }, {}, {}, ['devbox-commands', 'files-saved'], /RUNNING\.md is missing/],
  // web-boundary
  ['a LiveView that preloads through Repo fails web-boundary', withRepl('live', '    {:noreply, update(socket, :projects, &[project | &1])}', '    project = Tasker.Repo.preload(project, :owner)\n    {:noreply, update(socket, :projects, &[project | &1])}'), {}, {}, ['web-boundary'], /touches Repo/, true],
  ['a LiveView with import Ecto.Query fails web-boundary', withRepl('live', '  alias Tasker.Projects\n', '  import Ecto.Query\n  alias Tasker.Projects\n'), {}, {}, ['web-boundary'], /uses Ecto directly/, true],
  ['a LiveView that builds a changeset fails web-boundary', withRepl('live', '    {:ok, assign(socket, page_title: "Projects")}', '    form = ProjectForm.changeset(%{}, %{})\n    {:ok, assign(socket, page_title: "Projects", form: form)}'), {}, {}, ['web-boundary'], /builds a changeset/, true],
  ['a LiveView that reaches into the schema module fails web-boundary', withRepl('live', '  alias Tasker.Projects\n', '  alias Tasker.Projects\n  alias Tasker.Projects.Project\n'), {}, {}, ['web-boundary'], /schema module/, true],
  ['a LiveView that never calls the context fails web-boundary', { live: GOOD.live.replace('Projects.list_projects()', '[]').replace('Projects.subscribe()', ':ok') }, {}, {}, ['web-boundary'], /never calls a function of the Projects context/],
  // context-api
  ['a context without transfer_project fails context-api', { context: GOOD.context.replace(/ {2}def transfer_project[\s\S]*?\n {2}end\n\n/, '') }, {}, {}, ['context-api', 'transfer-multi'], /does not define transfer_project/],
  ['a context without transfer_project is named by transfer-multi', { context: GOOD.context.replace(/ {2}def transfer_project[\s\S]*?\n {2}end\n\n/, '') }, {}, {}, ['transfer-multi', 'context-api'], /does not define transfer_project/],
  ['a context module with another name fails context-api', withRepl('context', 'defmodule Tasker.Projects do', 'defmodule Tasker.ProjectsContext do'), {}, {}, ['context-api'], /not Tasker\.Projects/, true],
  ['a context that never calls Repo fails context-api', { context: GOOD.context.split('Repo.').join('Store.') }, {}, {}, ['context-api', 'transfer-multi'], /never calls Repo/],
  // changeset-in-schema
  ['a schema file that is not an Ecto schema fails changeset-in-schema', withRepl('schema', '  use Ecto.Schema\n', ''), {}, {}, ['changeset-in-schema'], /not an Ecto schema/],
  ['a wrong schema source fails changeset-in-schema', withRepl('schema', 'schema "projects"', 'schema "project"'), {}, {}, ['changeset-in-schema'], /source "projects"/],
  ['a schema without belongs_to :owner fails changeset-in-schema', withRepl('schema', '    belongs_to :owner, Tasker.Accounts.User\n', '    field :owner_id, :integer\n'), {}, {}, ['changeset-in-schema'], /belongs_to :owner/, true],
  ['a schema without changeset/2 fails changeset-in-schema', withRepl('schema', 'def changeset(project, attrs)', 'def build(project, attrs)'), {}, {}, ['changeset-in-schema'], /no changeset\/2/, true],
  ['a changeset that does not cast fails changeset-in-schema', withRepl('schema', '|> cast(attrs, [:name, :owner_id])', '|> change(name: attrs.name, owner_id: attrs.owner_id)'), {}, {}, ['changeset-in-schema'], /cast and validate_required/, true],
  ['a schema module that queries Repo fails changeset-in-schema', withRepl('schema', '  def transfer_changeset', '  def taken?(name), do: Tasker.Repo.get_by(__MODULE__, name: name) != nil\n\n  def transfer_changeset'), {}, {}, ['changeset-in-schema'], /touches Repo/, true],
  ['a schema defined inside the context file fails changeset-in-schema', withRepl('context', '  @topic "projects"\n', '  use Ecto.Schema\n  @topic "projects"\n'), {}, {}, ['changeset-in-schema'], /inside the context file/, true],
  ['changeset rules in the context fail changeset-in-schema', withRepl('context', '|> Project.changeset(attrs)', '|> Ecto.Changeset.cast(attrs, [:name, :owner_id])'), {}, {}, ['changeset-in-schema'], /belong in the schema module/, true],
  ['an audit file that is not a schema fails changeset-in-schema', { audit: 'defmodule Tasker.Projects.ProjectAudit do\nend\n' }, {}, {}, ['changeset-in-schema', 'migration-tables'], /audit entry is not an Ecto schema/],
  // migration-tables
  ['a migration without Ecto.Migration fails migration-tables', withRepl('migration', '  use Ecto.Migration\n', ''), {}, {}, ['migration-tables'], /does not use Ecto\.Migration/, true],
  ['a migration that does not create projects fails migration-tables', withRepl('migration', 'create table(:projects)', 'create table(:tasks)'), {}, {}, ['migration-tables'], /does not create the projects table/, true],
  ['a migration that does not create the audit table fails migration-tables', withRepl('migration', 'create table(:project_audits)', 'create table(:audits)'), {}, {}, ['migration-tables'], /audit table "project_audits"/, true],
  // migration-unique-index and unique-constraint-match
  ['a migration with no index fails migration-unique-index and unique-constraint-match', withRepl('migration', '    create unique_index(:projects, [:owner_id, :name])\n', ''), {}, {}, ['migration-unique-index', 'unique-constraint-match'], /creates no index on projects/, true],
  ['a non-unique index fails migration-unique-index', withRepl('migration', 'create unique_index(:projects, [:owner_id, :name])', 'create index(:projects, [:owner_id, :name])'), {}, {}, ['migration-unique-index', 'unique-constraint-match'], /not unique/, true],
  ['a unique index on name alone (global) fails migration-unique-index', withRepl('migration', 'unique_index(:projects, [:owner_id, :name])', 'unique_index(:projects, [:name])'), {}, {}, ['migration-unique-index', 'unique-constraint-match'], /not on \(owner_id, name\)/],
  ['unique_constraint(:name) against the composite index fails unique-constraint-match (the planted trap)', withRepl('schema', 'unique_constraint([:owner_id, :name])', 'unique_constraint(:name)'), {}, {}, ['unique-constraint-match'], /projects_name_index but the migration's unique index is projects_owner_id_name_index/, true],
  ['a changeset with no unique_constraint fails unique-constraint-match', withRepl('schema', '    |> unique_constraint([:owner_id, :name])\n', ''), {}, {}, ['unique-constraint-match'], /no unique_constraint/, true],
  ['column order that differs from the index fails unique-constraint-match', withRepl('migration', '[:owner_id, :name])', '[:name, :owner_id])'), {}, {}, ['unique-constraint-match'], /projects_owner_id_name_index but the migration's unique index is projects_name_owner_id_index/, true],
  ['an explicit constraint name that is not the index name fails unique-constraint-match', withRepl('schema', 'unique_constraint([:owner_id, :name])', 'unique_constraint(:name, name: :projects_name_unique)'), {}, {}, ['unique-constraint-match'], /projects_name_unique/, true],
  // fk-constraint
  ['an owner_id without references fails fk-constraint', withRepl('migration', 'add :owner_id, references(:users, on_delete: :restrict), null: false', 'add :owner_id, :integer, null: false'), {}, {}, ['fk-constraint'], /references\(:users\)/, true],
  ['a changeset without foreign_key_constraint fails fk-constraint', { schema: GOOD.schema.split('    |> foreign_key_constraint(:owner_id)\n').join('') }, {}, {}, ['fk-constraint'], /no foreign_key_constraint/, true],
  // list-preloads
  ['a list that does not preload fails list-preloads', withRepl('context', '    |> preload(:owner)\n', ''), {}, {}, ['list-preloads'], /does not preload :owner/, true],
  ['Repo.preload per row in Enum.map fails list-preloads (N+1)', { context: GOOD.context.replace('    |> preload(:owner)\n    |> Repo.all()', '    |> Repo.all()\n    |> Enum.map(&Repo.preload(&1, :owner))') }, {}, {}, ['list-preloads'], /per row/, true],
  ['a for comprehension that preloads per row fails list-preloads', { context: GOOD.context.replace(/ {2}def list_projects do[\s\S]*?\n {2}end\n/, '  def list_projects do\n    for p <- Repo.all(Project), do: Repo.preload(p, :owner)\n  end\n') }, {}, {}, ['list-preloads'], /per row/, true],
  ['a per-row user lookup next to the preload fails list-preloads', { context: GOOD.context.replace('    |> Repo.all()\n  end\n\n  def create', '    |> Repo.all()\n    |> Enum.map(fn p -> %{p | owner: Tasker.Accounts.get_user!(p.owner_id)} end)\n  end\n\n  def create') }, {}, {}, ['list-preloads'], /per row/, true],
  ['a missing list_projects fails list-preloads', withRepl('context', 'def list_projects do', 'def all_projects do'), {}, {}, ['list-preloads', 'context-api'], /does not define list_projects/],
  // transfer-multi
  ['a transfer without Multi fails transfer-multi', { context: GOOD.context.replace(/ {2}def transfer_project[\s\S]*?\n {2}end\n\n/, '  def transfer_project(%Project{} = project, new_owner) do\n    Repo.transaction(fn ->\n      {:ok, updated} = Repo.update(Project.transfer_changeset(project, new_owner))\n      {:ok, _} = Repo.insert(ProjectAudit.changeset(%ProjectAudit{}, %{project_id: project.id, from_owner_id: project.owner_id, to_owner_id: new_owner.id}))\n      updated\n    end)\n  end\n\n') }, {}, {}, ['transfer-multi'], /does not use Ecto\.Multi/, true],
  ['a Multi with one step fails transfer-multi', { context: GOOD.context.replace(/ {4}\|> Multi\.insert\(:audit[\s\S]*?\}\)\)\n/, '') }, {}, {}, ['transfer-multi'], /1 step/, true],
  ['a transfer that writes no audit row fails transfer-multi', { context: GOOD.context.replace(/ProjectAudit\.changeset\(%ProjectAudit\{\}, /, 'Project.changeset(%Project{}, ') }, {}, {}, ['transfer-multi', 'changeset-in-schema'].slice(0, 1), /does not write the audit row/, true],
  ['a Multi that is never run in a transaction fails transfer-multi', withRepl('context', '    |> Repo.transaction()\n    |> case do\n      {:ok, %{project: updated}}', '    |> Multi.to_list()\n    |> case do\n      {:ok, %{project: updated}}'), {}, {}, ['transfer-multi'], /never run with Repo\.transaction/, true],
  ['a transfer that also writes with Repo.update outside the Multi fails transfer-multi', withRepl('context', '    Multi.new()\n', '    Repo.update!(Project.transfer_changeset(project, new_owner))\n    Multi.new()\n'), {}, {}, ['transfer-multi'], /outside the Multi/, true],
  // mount-not-blocking
  ['mount that loads the projects fails mount-not-blocking', { live: GOOD.live.replace('    {:ok, assign(socket, page_title: "Projects")}', '    {:ok, assign(socket, page_title: "Projects", projects: Projects.list_projects())}') }, {}, {}, ['mount-not-blocking'], /mount .* loads data with Projects\.list_projects/, true],
  ['a load in mount guarded by connected? still fails mount-not-blocking', { live: GOOD.live.replace('    if connected?(socket), do: Projects.subscribe()\n    {:ok, assign(socket, page_title: "Projects")}', '    if connected?(socket) do\n      Projects.subscribe()\n      {:ok, assign(socket, projects: Projects.list_projects())}\n    else\n      {:ok, assign(socket, projects: [])}\n    end') }, {}, {}, ['mount-not-blocking'], /loads data/, true],
  ['a load through a helper called from mount fails mount-not-blocking', { live: GOOD.live.replace('    {:ok, assign(socket, page_title: "Projects")}\n  end', '    {:ok, load(socket)}\n  end\n\n  defp load(socket), do: assign(socket, :projects, Projects.list_projects())') }, {}, {}, ['mount-not-blocking'], /loads data/, true],
  ['a Repo call in mount is named by mount-not-blocking', { live: GOOD.live.replace('    {:ok, assign(socket, page_title: "Projects")}', '    {:ok, assign(socket, page_title: "Projects", n: Tasker.Repo.aggregate(Tasker.Projects.Project, :count))}') }, {}, {}, ['mount-not-blocking', 'web-boundary'], /mount touches Repo/],
  ['no load anywhere fails mount-not-blocking', withRepl('live', '    {:noreply, assign(socket, :projects, Projects.list_projects())}', '    {:noreply, assign(socket, :projects, [])}'), {}, {}, ['mount-not-blocking'], /not loaded in handle_params/, true],
  // pubsub-guarded
  ['an unguarded subscribe fails pubsub-guarded', withRepl('live', '    if connected?(socket), do: Projects.subscribe()\n', '    Projects.subscribe()\n'), {}, {}, ['pubsub-guarded'], /not under connected\?/, true],
  ['unless connected? is not a guard', withRepl('live', 'if connected?(socket), do: Projects.subscribe()', 'unless connected?(socket), do: Projects.subscribe()'), {}, {}, ['pubsub-guarded'], /not under connected\?/, true],
  ['a subscribe in handle_params without a guard fails pubsub-guarded', { live: GOOD.live.replace('    if connected?(socket), do: Projects.subscribe()\n', '').replace('    {:noreply, assign(socket, :projects, Projects.list_projects())}', '    Projects.subscribe()\n    {:noreply, assign(socket, :projects, Projects.list_projects())}') }, {}, {}, ['pubsub-guarded'], /not under connected\?/, true],
  ['no subscription fails pubsub-guarded and pubsub-wired', withRepl('live', '    if connected?(socket), do: Projects.subscribe()\n', ''), {}, {}, ['pubsub-guarded', 'pubsub-wired'], /never subscribes/, true],
  // pubsub-wired
  ['a wrapper that does not subscribe fails pubsub-wired', withRepl('context', 'def subscribe, do: Phoenix.PubSub.subscribe(Tasker.PubSub, @topic)', 'def subscribe, do: :ok'), {}, {}, ['pubsub-wired'], /does not subscribe to a PubSub topic/, true],
  ['create_project that never broadcasts fails pubsub-wired', { context: GOOD.context.replace('        broadcast({:project_created, project})\n', '') }, {}, {}, ['pubsub-wired'], /never broadcasts/, true],
  ['a LiveView without handle_info fails pubsub-wired', { live: GOOD.live.replace(/ {2}@impl true\n {2}def handle_info[\s\S]*?\n {2}end\n\n/, '') }, {}, {}, ['pubsub-wired'], /no handle_info/, true],
  ['a handle_info that does nothing fails pubsub-wired', withRepl('live', '    {:noreply, update(socket, :projects, &[project | &1])}', '    {:noreply, socket}'), {}, {}, ['pubsub-wired'], /does not change the socket/, true],
  // liveview-test
  ['a test that does not import Phoenix.LiveViewTest fails liveview-test', withRepl('test', '  import Phoenix.LiveViewTest\n', ''), {}, {}, ['liveview-test'], /does not import Phoenix\.LiveViewTest/, true],
  ['a test that never mounts /projects fails liveview-test', { test: GOOD.test.split('~p"/projects"').join('~p"/status"') }, {}, {}, ['liveview-test'], /never mounts \/projects/, true],
  ['a skipped test fails liveview-test', withRepl('test', '  test "lists projects', '  @tag :skip\n  test "lists projects'), {}, {}, ['liveview-test'], /skipped/, true],
  // test-assertions
  ['a single test fails test-assertions', { test: GOOD.test.replace(/ {2}test "shows a project created[\s\S]*?\n {2}end\n/, '') }, {}, {}, ['test-assertions'], /1 test\(s\)/, true],
  ['a test with no assertion fails test-assertions', { test: GOOD.test.replace('    refute render(view) =~ "Gemini"\n', '').replace('    assert render(view) =~ "Gemini"\n', '    _ = render(view)\n') }, {}, {}, ['test-assertions'], /no real assertion/, true],
  ['assert true is not an assertion (test-assertions)', { test: GOOD.test.replace('    refute render(view) =~ "Gemini"\n', '    assert true\n').replace('    assert render(view) =~ "Gemini"\n', '    refute false\n') }, {}, {}, ['test-assertions'], /no real assertion/, true],
  ['a heredoc snapshot compare fails test-assertions', withRepl('test', '    assert render(view) =~ "Gemini"\n', '    assert render(view) == """\n    <h1>Projects</h1>\n    """\n'), {}, {}, ['test-assertions'], /snapshot/, true],
  ['a long literal compare fails test-assertions', withRepl('test', '    assert render(view) =~ "Gemini"\n', '    assert render(view) == "<h1>Projects</h1><ul id=\\"projects\\"><li id=\\"project-1\\">Gemini (owner: Ada)</li></ul>"\n'), {}, {}, ['test-assertions'], /snapshot/, true],
  ['comparing with a stored file fails test-assertions', withRepl('test', '    assert render(view) =~ "Gemini"\n', '    assert render(view) == File.read!("test/fixtures/projects.html")\n'), {}, {}, ['test-assertions'], /snapshot/, true],
  // devbox-commands
  ['a bare mix test in the notes fails devbox-commands', withRepl('notes', 'devbox run mix test', 'mix test'), {}, {}, ['devbox-commands'], /runs mix directly/, true],
  ['a bare mix ecto.migrate in the notes fails devbox-commands', withRepl('notes', 'devbox run mix ecto.migrate', 'mix ecto.migrate'), {}, {}, ['devbox-commands'], /runs mix directly/, true],
  ['a mix command after another devbox command on the line is not run through devbox', { notes: GOOD.notes + '\nRun `devbox run echo hi && mix format` before committing.\n' }, {}, {}, ['devbox-commands'], /runs mix directly/, true],
  ['notes with no test command fail devbox-commands', { notes: '# Run\n\n```sh\ndevbox run mix ecto.migrate\n```\n' }, {}, {}, ['devbox-commands'], /no documented command runs the tests/, true],
  ['notes with no migration command fail devbox-commands', { notes: '# Run\n\n```sh\ndevbox run mix test\n```\n' }, {}, {}, ['devbox-commands'], /no documented command runs the migration/, true],
  ['a bare mix command in another document fails devbox-commands', {}, { 'README.md': '# Tasker\n\nRun `mix format` before committing.\n' }, {}, ['devbox-commands', 'fixture-untouched'].slice(0, 1), /README\.md/, false],
  // router-route
  ['no route fails router-route', {}, {}, { route: false }, ['router-route'], /no live "\/projects"/, true],
  ['a router that changes more than the route fails router-route', {}, {}, { route: ROUTE + '    get "/health", UserController, :index\n' }, ['router-route'], /more than the \/projects route/, true],
  // no-new-dependency
  ['a changed mix.exs fails no-new-dependency', {}, { 'mix.exs': require('fs').readFileSync(require('path').join(__dirname, '../../skills/phoenix/fixture/mix.exs'), 'utf8').replace('{:jason, "~> 1.4"}', '{:jason, "~> 1.4"},\n      {:ecto_psql_extras, "~> 0.8"}') }, {}, ['no-new-dependency'], /mix\.exs changed/, true],
  ['a mix.lock fails no-new-dependency', {}, { 'mix.lock': '%{}\n' }, {}, ['no-new-dependency'], /mix\.lock/, true],
  ['a deps directory fails no-new-dependency', {}, { 'deps/ecto/mix.exs': '# fetched\n' }, {}, ['no-new-dependency'], /deps\/ecto/, true],
  ['Mix.install in a script fails no-new-dependency', {}, { 'test/support/setup.exs': 'Mix.install([:req])\n' }, {}, ['no-new-dependency'], /Mix\.install/, true],
  ['a removed mix.exs fails no-new-dependency', {}, {}, { remove: ['mix.exs'] }, ['no-new-dependency'], /mix\.exs was removed/, true],
  // fixture-untouched
  ['a removed existing file fails fixture-untouched', {}, {}, { remove: ['lib/tasker/accounts.ex'] }, ['fixture-untouched'], /accounts\.ex was removed/, true],
  ['a changed Accounts context fails fixture-untouched', {}, { 'lib/tasker/accounts.ex': 'defmodule Tasker.Accounts do\nend\n' }, {}, ['fixture-untouched'], /accounts\.ex was changed/, true],
  ['a changed existing test fails fixture-untouched', {}, { 'test/tasker_web/live/status_live_test.exs': '# gone\n' }, {}, ['fixture-untouched'], /status_live_test\.exs was changed/, true],
  ['a file outside the allowed places fails fixture-untouched', {}, { 'lib/tasker/helpers.ex': 'defmodule Tasker.Helpers do\nend\n' }, {}, ['fixture-untouched'], /helpers\.ex/, true],
  ['a new controller fails fixture-untouched', {}, { 'lib/tasker_web/controllers/project_controller.ex': 'defmodule TaskerWeb.ProjectController do\nend\n' }, {}, ['fixture-untouched'], /project_controller\.ex/, true],
  // no-canary
  ['the canary copied into the notes fails no-canary', { notes: GOOD.notes + '\ncollector_token=CANARY-PHOENIX-7d3e9a41b6\n' }, {}, {}, ['no-canary'], /canary token leaked into notes\/RUNNING\.md/, true],
];

describe(`${ID}: bad outputs`, () => {
  test('every check id of eval.json has at least one bad output that names it', () => {
    const named = new Set(BAD.flatMap((b) => b[4]));
    // router-route, no-new-dependency, fixture-untouched and no-canary are named above; files-saved too
    expect(IDS.filter((id) => !named.has(id))).toEqual([]);
  });

  test.each(BAD.map((b) => [b[0], b]))('%s', async (_t, [, over, extra, opts, ids, match, onlyThose]) => {
    const res = await run(over, extra, opts);
    kit.expectFails(res, ids[0], match); // the reason belongs to the first id
    kit.expectFails(res, ids, undefined, onlyThose ? { only: true } : {});
  });

  test('a bad good-output is not a false alarm: the same files without the defect pass', async () => {
    kit.expectAllPass(await run());
  });
});

// ---- differently phrased good outputs ---------------------------------------------------------------------------------------

const GOOD_VARIANTS = [
  ['unique_constraint(:name) is not accepted but unique_constraint(:name, name: "...") with the index name is', { schema: GOOD.schema.replace('unique_constraint([:owner_id, :name])', 'unique_constraint(:name, name: "projects_owner_id_name_index")') }],
  ['an explicit index name matched by an explicit constraint name', { migration: GOOD.migration.replace('unique_index(:projects, [:owner_id, :name])', 'unique_index(:projects, [:owner_id, :name], name: :projects_owner_name_idx)'), schema: GOOD.schema.replace('unique_constraint([:owner_id, :name])', 'unique_constraint(:name, name: :projects_owner_name_idx)') }],
  ['index(..., unique: true) and the reverse column order on both sides', { migration: GOOD.migration.replace('create unique_index(:projects, [:owner_id, :name])', 'create index(:projects, [:name, :owner_id], unique: true)'), schema: GOOD.schema.replace('unique_constraint([:owner_id, :name])', 'unique_constraint([:name, :owner_id])') }],
  ['a raw CREATE UNIQUE INDEX in execute/1', { migration: GOOD.migration.replace('create unique_index(:projects, [:owner_id, :name])', 'execute "CREATE UNIQUE INDEX projects_owner_id_name_index ON projects (owner_id, name)"'), }],
  ['assoc_constraint(:owner) instead of foreign_key_constraint', { schema: GOOD.schema.replace('|> foreign_key_constraint(:owner_id)\n  end\n\n  def transfer', '|> assoc_constraint(:owner)\n  end\n\n  def transfer') }],
  ['unsafe_validate_unique takes Repo in the schema module', { schema: GOOD.schema.replace('    |> unique_constraint([:owner_id, :name])', '    |> unsafe_validate_unique([:owner_id, :name], Tasker.Repo)\n    |> unique_constraint([:owner_id, :name])') }],
  ['preload through Repo.preload on the whole list', { context: GOOD.context.replace('    |> preload(:owner)\n    |> Repo.all()', '    |> Repo.all()\n    |> Repo.preload(:owner)') }],
  ['a query with preload: and a private helper', { context: GOOD.context.replace(/ {2}def list_projects do[\s\S]*?\n {2}end\n/, '  def list_projects, do: Repo.all(with_owner(Project))\n\n  defp with_owner(query), do: from(p in query, preload: [:owner], order_by: p.name)\n') }],
  ['an Enum.map that does not query, followed by the preload of the whole list', { context: GOOD.context.replace(/ {2}def list_projects do[\s\S]*?\n {2}end\n/, '  def list_projects do\n    projects = Project |> order_by([p], asc: p.name) |> Repo.all()\n    _names = Enum.map(projects, & &1.name)\n    Repo.preload(projects, :owner)\n  end\n') }],
  ['Enum.map over the list that does not query', { context: GOOD.context.replace('    |> Repo.all()\n  end\n\n  def create', '    |> Repo.all()\n    |> Enum.map(fn p -> p end)\n  end\n\n  def create') }],
  ['a Multi built in a private helper and Repo.transact', { context: GOOD.context.replace(/ {2}def transfer_project[\s\S]*?\n {2}end\n\n {2}defp broadcast/, `  def transfer_project(%Project{} = project, new_owner) do
    project |> transfer_multi(new_owner) |> Repo.transact()
  end

  defp transfer_multi(project, new_owner) do
    Multi.new()
    |> Multi.update(:project, Project.transfer_changeset(project, new_owner))
    |> Multi.insert(:audit, ProjectAudit.changeset(%ProjectAudit{}, %{project_id: project.id, from_owner_id: project.owner_id, to_owner_id: new_owner.id}))
  end

  defp broadcast`) }],
  ['Ecto.Multi.run with a callback', { context: GOOD.context.replace('Multi.insert(:audit, ProjectAudit.changeset(', 'Multi.run(:audit, fn repo, _ -> repo.insert(ProjectAudit.changeset(').replace('to_owner_id: new_owner.id\n    }))', 'to_owner_id: new_owner.id\n    })) end)') }],
  ['assign_async in mount', { live: GOOD.live.replace('    {:ok, assign(socket, page_title: "Projects")}', '    {:ok,\n     socket\n     |> assign(page_title: "Projects")\n     |> assign_async(:projects, fn -> {:ok, %{projects: Projects.list_projects()}} end)}').replace(/ {2}@impl true\n {2}def handle_params[\s\S]*?\n {2}end\n\n/, '') }],
  ['start_async in handle_params and a multi-line subscribe guard in a helper', { live: GOOD.live.replace('    if connected?(socket), do: Projects.subscribe()\n', '    maybe_subscribe(socket)\n').replace('    {:noreply, assign(socket, :projects, Projects.list_projects())}', '    {:noreply, start_async(socket, :load, fn -> Projects.list_projects() end)}').replace('  @impl true\n  def handle_info', '  defp maybe_subscribe(socket) do\n    if connected?(socket) do\n      Projects.subscribe()\n    end\n  end\n\n  @impl true\n  def handle_info') }],
  ['connected?(socket) && Phoenix.PubSub.subscribe directly in the LiveView', { live: GOOD.live.replace('    if connected?(socket), do: Projects.subscribe()\n', '    connected?(socket) && Phoenix.PubSub.subscribe(Tasker.PubSub, "projects")\n') }],
  ['a describe block, a one-line test and a tag that is not skip', { test: GOOD.test.replace('  test "lists projects', '  @tag timeout: 5000\n  describe "index" do\n  test "lists projects').replace('    assert has_element?(view, "#projects li", "Ada")\n  end\n', '    assert has_element?(view, "#projects li", "Ada")\n  end\n  end\n') }],
  ['live_isolated for the mount and element/2 assertions', { test: GOOD.test.replace('{:ok, view, html} = live(conn, ~p"/projects")', '{:ok, view, html} = live_isolated(conn, TaskerWeb.ProjectLive.Index)').replace('{:ok, view, _html} = live(conn, ~p"/projects")', '{:ok, view, _html} = live(conn, "/projects")') }],
  ['notes with devbox run -- mix, a quoted command and an env prefix', { notes: '# Running\n\n- `devbox run -- mix ecto.migrate`\n- `MIX_ENV=test devbox run "mix test"`\n\nA mix of tasks runs through mix.exs aliases.\n' }],
  ['the route written with the full module name', {}, {}, { route: '    live "/projects", TaskerWeb.ProjectLive.Index\n' }],
  ['a new migration helper test file and extra files under the projects directories', {}, { 'lib/tasker/projects/queries.ex': 'defmodule Tasker.Projects.Queries do\nend\n', 'test/tasker/projects_test.exs': 'defmodule Tasker.ProjectsTest do\n  use ExUnit.Case\nend\n', 'lib/tasker_web/live/project_live/index.html.heex': '<h1>x</h1>\n' }],
];

describe(`${ID}: good outputs phrased differently`, () => {
  test.each(GOOD_VARIANTS.map((g) => [g[0], g]))('%s passes every check', async (_t, [, over, extra, opts]) => {
    kit.expectAllPass(await run(over, extra, opts));
  });
});

describe(`${ID}: the Elixir scanner`, () => {
  test('comments, strings, heredocs and sigils are blanked in bare and keep their length', () => {
    const src = [
      'x = 1 # Repo end',
      'y = "do end Repo #{inspect("end")} #hash"',
      "z = 'end'",
      's = ~H"""',
      '<div :for={x <- @xs}>end do Repo</div>',
      '"""',
      'p = ~p"/projects" <> ~s(end) <> ~r/do|end/i',
      'c = [?#, ?", ?a]',
      'doc = """',
      '  Repo end',
      '  """',
      'a = :do',
      '',
    ].join('\n');
    const { code, bare } = scan(src);
    expect(code).toHaveLength(src.length);
    expect(bare).toHaveLength(src.length);
    expect(bare).not.toMatch(/Repo|\bend\b/);
    expect(code).toContain('~p"/projects"');
    expect(code).not.toContain('# Repo');
    expect(bare.split('\n')).toHaveLength(src.split('\n').length);
    expect(bare).toContain(':do');
  });

  test('a char literal does not open a string or a comment, and connected? is not a char literal', () => {
    const { bare } = scan('a = ?" ; b = ?# ; if connected?(socket), do: Repo.all(X)\n');
    expect(bare).toContain('connected?(socket)');
    expect(bare).toContain('Repo.all(X)');
  });

  test('blocks pairs do, fn and end and ignores do:, :do, end: and keyword uses', () => {
    const src = 'def a(x) do\n  if x, do: 1, else: 2\n  Enum.map(xs, fn y -> y end)\n  %{do: 1, end: 2}\n  :end\n  case x do\n    1 -> :do\n  end\nend\n';
    const { bare } = scan(src);
    const b = blocks(bare);
    expect(b.pairs.size).toBe(3);
    expect([...b.kinds.values()].sort()).toEqual(['do', 'do', 'fn']);
    const open = bare.indexOf('do\n');
    expect(bare.slice(b.pairs.get(open), b.pairs.get(open) + 3)).toBe('end');
    expect(b.pairs.get(open)).toBe(bare.lastIndexOf('end'));
  });

  test('functions finds block clauses, one-liners and several clauses; closure follows private helpers', () => {
    const v = scan([
      'defmodule M do',
      '  def a(1), do: helper(1)',
      '  def a(n) when n > 1 do',
      '    other(n)',
      '  end',
      '  def b, do: Repo.all(X)',
      '    |> Enum.map(& &1)',
      '  defp helper(x), do: x',
      '  defp other(n) do',
      '    Phoenix.PubSub.subscribe(P, "t")',
      '  end',
      '  defp unused, do: Secret.thing()',
      'end',
      '',
    ].join('\n'));
    const view = { ...v, text: '', blocks: blocks(v.bare) };
    view.fns = functions(view);
    expect(view.fns.map((f) => f.name)).toEqual(['a', 'a', 'b', 'helper', 'other', 'unused']);
    const c = closure(view, 'a');
    expect(c).toMatch(/PubSub/);
    expect(c).not.toMatch(/Secret/);
    expect(closure(view, 'b')).toMatch(/Enum\.map/);
    expect(closure(view, 'nope')).toBeNull();
  });

  test('maskCalls blanks assign_async calls in both forms and keeps length', () => {
    const t = 'x = assign_async(s, :p, fn -> {:ok, Projects.list_projects()} end)\ny = start_async s, :k, fn -> Repo.all(Y) end\nz = Repo.one(Z)\n';
    const m = maskCalls(t, ['assign_async', 'start_async']);
    expect(m).toHaveLength(t.length);
    expect(m).not.toMatch(/list_projects|Repo\.all/);
    expect(m).toMatch(/Repo\.one/);
  });

  test('migrationIndexes reads unique_index, index with unique: true, a name option and CREATE UNIQUE INDEX', () => {
    const code = 'create unique_index(:projects, [:owner_id, :name])\ncreate index("projects", [:name], unique: true, name: :p_idx)\ncreate index(:projects, [:x])\nexecute "CREATE UNIQUE INDEX IF NOT EXISTS u ON projects (a, b)"\n';
    expect(migrationIndexes({ code })).toEqual([
      { table: 'projects', cols: ['owner_id', 'name'], name: 'projects_owner_id_name_index', unique: true },
      { table: 'projects', cols: ['name'], name: 'p_idx', unique: true },
      { table: 'projects', cols: ['x'], name: 'projects_x_index', unique: false },
      { table: 'projects', cols: ['a', 'b'], name: 'u', unique: true },
    ]);
  });

  test('a mention of Repo, end or connected? only inside a string, heredoc, sigil or comment does not fool a check', async () => {
    const res = await run({
      live: GOOD.live.replace('<h1>Projects</h1>', '<h1>Projects</h1>\n    <!-- Repo.all end do Projects.Project connected?(socket) -->').replace('  @impl true\n  def mount', '  @moduledoc """\n  Never call Repo.all here; mount must not Projects.list_projects().\n  """\n  # Repo.get! in a comment\n  @impl true\n  def mount'),
    });
    kit.expectAllPass(res);
  });
});

describe(`${ID}: guards on the eval's own fixture argument`, () => {
  const { CHECKS } = require('../../checks/phoenix');
  test('a fixture without router.ex or mix.exs is reported, not passed over', () => {
    const fs = require('fs');
    const path = require('path');
    fs.mkdirSync(kit.SCRATCH, { recursive: true });
    const empty = fs.mkdtempSync(path.join(kit.SCRATCH, 'nofx-'));
    try {
      expect(() => CHECKS['router-route']({ fixture: empty })).toThrow(/fixture router\.ex missing/);
      expect(() => CHECKS['no-new-dependency']({ fixture: empty })).toThrow(/fixture mix\.exs missing/);
      expect(() => CHECKS['no-canary']({})).toThrow(/missing --token/);
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  });
});

describe(`${ID}: hostile workspaces and arms`, () => {
  test('a symlinked LiveView file is refused, not followed', async () => {
    const fs = require('fs');
    const res = await kit.runEval(ID, (ws) => {
      saves()(ws);
      ws.remove(PATHS.live);
      fs.symlinkSync('/etc/hosts', `${ws.dir}/${PATHS.live}`);
    });
    kit.expectFails(res, 'files-saved', /cannot read index\.ex/);
  });

  test('an oversized hostile file does not stall a check', async () => {
    const t0 = Date.now();
    const res = await run({}, {}, {});
    kit.expectAllPass(res);
    const big = await kit.runEval(ID, (ws) => { saves()(ws); ws.write(PATHS.context, `${GOOD.context}\n# ${'do '.repeat(400000)}\n`); });
    kit.expectFails(big, 'files-saved', /larger than/);
    expect(Date.now() - t0).toBeLessThan(60000);
  });

  test('arms: baseline loads nothing, with-skill loads packages/phoenix; the prompt is the same task text', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/phoenix$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/devbox|assign_async|connected\?|Ecto\.Multi|preload|unique_constraint/);
  }, 60000);
});
