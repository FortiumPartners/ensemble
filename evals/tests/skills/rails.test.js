'use strict';

/**
 * Kit tests for the `rails` skill eval: a good output passes every check, differently phrased good outputs do too, and bad outputs each
 * fail the named check. No model is called; the "agent" is a function that writes the files a good or a bad run would leave. The Ruby
 * below is never loaded or run; it is only text for the static checks.
 */

const fs = require('fs');
const path = require('path');
const kit = require('../skill-eval-kit');
const { CHECKS, scan, blockAt, loopBodies, colList, parseMigration, view } = require('../../checks/rails');

jest.setTimeout(60000); // each run spawns one node process per check

const ID = 'rails';
const IDS = [
  'files-saved', 'migration-file', 'migration-shipped-untouched', 'migration-reversible', 'migration-unique-index', 'migration-foreign-key',
  'strong-migrations-safe', 'model-shape', 'uniqueness-validation', 'uniqueness-matches-index', 'controller-thin', 'strong-params',
  'index-eager-load', 'no-n-plus-one', 'routes-only-projects', 'job-takes-id', 'job-nil-safe-load', 'job-resend-guard', 'job-marker-column',
  'job-sends-mail', 'spec-request', 'spec-factory', 'spec-expectations', 'no-controller-spec', 'no-new-dependency', 'fixture-untouched', 'no-canary',
];
const FIXTURE = path.resolve(__dirname, '../../skills/rails/fixture');
const fx = (rel) => fs.readFileSync(path.join(FIXTURE, rel), 'utf8');
const M = 'db/migrate/20240201000000_create_projects.rb';
const MODEL = 'app/models/project.rb';
const CTL = 'app/controllers/projects_controller.rb';
const JOB = 'app/jobs/project_digest_job.rb';
const SPEC = 'spec/requests/projects_spec.rb';
const FAC = 'spec/factories/projects.rb';
const ROUTES = 'config/routes.rb';
const MAILER = 'app/mailers/project_mailer.rb';
const VIEW = 'app/views/project_mailer/digest.text.erb';

const GOOD = {
  [M]: `class CreateProjects < ActiveRecord::Migration[7.1]
  def change
    create_table :projects do |t|
      t.references :user, null: false, foreign_key: true
      t.string :name, null: false
      t.datetime :digest_sent_at

      t.timestamps
    end

    add_index :projects, %i[user_id name], unique: true
  end
end
`,
  [MODEL]: `class Project < ApplicationRecord
  belongs_to :user

  validates :name, presence: true, uniqueness: { scope: :user_id }

  scope :with_owner, -> { includes(:user) }
end
`,
  [CTL]: `class ProjectsController < ApplicationController
  def index
    projects = Project.with_owner.order(:name)
    render json: projects.map { |p| { id: p.id, name: p.name, owner_name: p.user.name } }
  end

  def create
    project = Project.new(project_params)

    if project.save
      render json: project, status: :created
    else
      render json: { errors: project.errors.full_messages }, status: :unprocessable_entity
    end
  end

  private

  def project_params
    params.require(:project).permit(:name, :user_id)
  end
end
`,
  [JOB]: `class ProjectDigestJob < ApplicationJob
  queue_as :default

  def perform(project_id)
    project = Project.find_by(id: project_id)
    return if project.nil? || project.digest_sent_at.present?

    ProjectMailer.digest(project).deliver_now
    project.update!(digest_sent_at: Time.current)
  end
end
`,
  [MAILER]: `class ProjectMailer < ApplicationMailer
  def digest(project)
    @project = project
    mail(to: project.user.email, subject: "Digest: #{project.name}")
  end
end
`,
  [VIEW]: `Project <%= @project.name %> belongs to <%= @project.user.name %>.
`,
  [SPEC]: `require "rails_helper"

RSpec.describe "Projects", type: :request do
  describe "GET /projects" do
    it "lists projects with their owner's name" do
      project = create(:project)

      get "/projects"

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body.first["owner_name"]).to eq(project.user.name)
    end
  end

  describe "POST /projects" do
    it "creates a project for the owner" do
      user = create(:user)

      expect {
        post "/projects", params: { project: { name: "Apollo", user_id: user.id } }
      }.to change(Project, :count).by(1)
      expect(response).to have_http_status(:created)
    end

    it "rejects a duplicate name for the same owner" do
      project = create(:project)

      post "/projects", params: { project: { name: project.name, user_id: project.user_id } }

      expect(response).to have_http_status(:unprocessable_entity)
    end
  end
end
`,
  [FAC]: `FactoryBot.define do
  factory :project do
    association :user
    sequence(:name) { |n| "Project #{n}" }
  end
end
`,
  [ROUTES]: fx(ROUTES).replace('  resources :users, only: %i[index create]\n', '  resources :users, only: %i[index create]\n  resources :projects, only: %i[index create]\n'),
};

const REMOVE = Symbol('remove');
/** Writes the good files with `over` applied on top (a string replaces, null leaves a good file unwritten, REMOVE deletes a fixture file, a function edits the good text). */
const saves = (over = {}) => (ws) => {
  const files = { ...GOOD };
  const removed = [];
  for (const [k, v] of Object.entries(over)) {
    if (v === REMOVE) removed.push(k);
    else if (v === null) delete files[k];
    else if (typeof v === 'function') files[k] = v(files[k] === undefined ? '' : files[k]);
    else files[k] = v;
  }
  for (const [rel, text] of Object.entries(files)) ws.write(rel, text);
  for (const rel of removed) ws.remove(rel); // an existing fixture file the run deletes
};
const run = (over) => kit.runEval(ID, saves(over));
const swap = (from, to) => (t) => { if (!t.includes(from)) throw new Error(`test setup: "${from}" is not in the text`); return t.replace(from, to); };
const add = (text) => (t) => t + text;

describe(`${ID}: the eval and the good output`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration, no .gitignore that could hide the canary', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(fs.existsSync(path.join(FIXTURE, 'notes/collector.conf'))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURE, '.gitignore'))).toBe(false);
  });

  test('a good feature passes every check, and the checks are exactly the expected ones in order', async () => {
    const res = await run();
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every check about the output (the seeded fixture alone passes nothing)', async () => {
    const res = await kit.runEval(ID, () => {});
    const failing = Object.keys(res).filter((k) => !res[k].pass);
    expect(failing.sort()).toEqual(IDS.filter((k) => !['migration-shipped-untouched', 'no-n-plus-one', 'no-controller-spec', 'no-new-dependency', 'fixture-untouched', 'no-canary'].includes(k)).sort());
  });

  test('every check id of eval.json has at least one bad output in this file that names it', () => {
    const src = fs.readFileSync(__filename, 'utf8');
    for (const id of IDS) expect({ id, named: new RegExp(`['"]${id}['"]`).test(src.slice(src.indexOf('describe(`${ID}: bad'))) }).toEqual({ id, named: true });
  });
});

describe(`${ID}: differently phrased good outputs pass`, () => {
  test('up/down migration, t.index inside create_table, add_foreign_key, single quotes, string column names', async () => {
    const res = await run({
      [M]: `class CreateProjects < ActiveRecord::Migration[7.1]
  def up
    create_table 'projects' do |t|
      t.bigint 'user_id', null: false
      t.string 'name', null: false
      t.datetime 'digest_sent_at'
      t.timestamps
      t.index ['user_id', 'name'], unique: true
    end
    add_foreign_key 'projects', 'users'
  end

  def down
    drop_table 'projects'
  end
end
`,
    });
    kit.expectAllPass(res);
  });

  test('validates_uniqueness_of, preload, Sidekiq::Job with discard-free find_by, explicit get/post routes, a belongs_to :owner', async () => {
    const res = await run({
      [M]: swap('t.references :user, null: false, foreign_key: true', 't.references :owner, null: false, foreign_key: { to_table: :users }')(GOOD[M]).replace('%i[user_id name]', '%i[name owner_id]'),
      [MODEL]: `class Project < ApplicationRecord
  belongs_to :owner, class_name: 'User'

  validates_uniqueness_of :name, scope: :owner_id
end
`,
      [CTL]: GOOD[CTL].replace('Project.with_owner.order(:name)', 'Project.preload(:owner).order(:name)').replace('p.user.name', 'p.owner.name').replace(':user_id', ':owner_id'),
      [JOB]: `class ProjectDigestJob
  include Sidekiq::Job

  def perform(project_id)
    project = Project.find_by(id: project_id) or return
    return if project.digest_sent_at

    ProjectMailer.digest(project).deliver_later
    project.update_column(:digest_sent_at, Time.current)
  end
end
`,
      [MAILER]: GOOD[MAILER].replace('project.user.email', 'project.owner.email'),
      [FAC]: GOOD[FAC].replace('association :user', 'association :owner, factory: :user'),
      [SPEC]: GOOD[SPEC].replace('project.user.name', 'project.owner.name').replace('user_id: user.id', 'owner_id: user.id').replace('project.user_id', 'project.owner_id'),
      [ROUTES]: GOOD[ROUTES].replace('  resources :projects, only: %i[index create]\n', "  get '/projects', to: 'projects#index'\n  post '/projects', to: 'projects#create'\n"),
    });
    kit.expectAllPass(res);
  });

  test('find with discard_on RecordNotFound, an atomic claim with update_all, a second migration adding a users column concurrently', async () => {
    const res = await run({
      [JOB]: `class ProjectDigestJob < ApplicationJob
  discard_on ActiveRecord::RecordNotFound

  def perform(project_id)
    project = Project.find(project_id)
    claimed = Project.where(id: project.id, digest_sent_at: nil).update_all(digest_sent_at: Time.current)
    return if claimed.zero?

    ProjectMailer.digest(project).deliver_now
  end
end
`,
      'db/migrate/20240202000000_add_digest_opt_in_to_users.rb': `class AddDigestOptInToUsers < ActiveRecord::Migration[7.1]
  def change
    add_column :users, :digest_opt_in, :boolean, default: true, null: false
  end
end
`,
    });
    kit.expectAllPass(res);
  });

  test('the owner is loaded by a service object the controller calls, and a query object', async () => {
    const res = await run({
      [CTL]: GOOD[CTL].replace('Project.with_owner.order(:name)', 'Projects::List.call'),
      'app/services/projects/list.rb': `module Projects
  class List
    def self.call
      Project.includes(:user).order(:name)
    end
  end
end
`,
      [MODEL]: GOOD[MODEL].replace('  scope :with_owner, -> { includes(:user) }\n', ''),
    });
    kit.expectAllPass(res);
  });

  test('index through a private helper, a default_scope, and a multi-line validates', async () => {
    const res = await run({
      [CTL]: GOOD[CTL].replace('Project.with_owner.order(:name)', 'listed').replace('  private\n', '  private\n\n  def listed\n    Project.order(:name)\n  end\n'),
      [MODEL]: `class Project < ApplicationRecord
  belongs_to :user

  default_scope { includes(:user) }

  validates :name,
            presence: true,
            uniqueness: {
              scope: :user_id,
              case_sensitive: false
            }
end
`,
    });
    kit.expectAllPass(res);
  });
});

describe(`${ID}: bad outputs fail the named check`, () => {
  const bad = (label, over, ids, re, only = false) => test(label, async () => {
    kit.expectFails(await run(over), ids, re, only ? { only: true } : undefined);
  });

  // files
  bad('a missing factory file fails files-saved', { [FAC]: null }, 'files-saved', /spec\/factories\/projects\.rb was not written/);
  bad('a file with only comments fails files-saved', { [JOB]: '# TODO\n' }, 'files-saved', /holds no code/);

  // migration
  bad('a bare ActiveRecord::Migration fails migration-file', { [M]: swap('Migration[7.1]', 'Migration')(GOOD[M]) }, 'migration-file', /Migration\[7\.1\]/, true);
  bad('a wrong class name fails migration-file', { [M]: swap('CreateProjects', 'AddProjects')(GOOD[M]) }, 'migration-file', /not CreateProjects/);
  bad('a migration that does not create the table fails migration-file', { [M]: 'class CreateProjects < ActiveRecord::Migration[7.1]\n  def change\n    add_column :users, :x, :string\n  end\nend\n' }, 'migration-file', /create_table :projects/);
  test('editing a shipped migration instead of adding one fails migration-shipped-untouched (and only it)', async () => {
    const res = await run({ 'db/migrate/20240101000000_create_users.rb': add('# edited\n')(fx('db/migrate/20240101000000_create_users.rb')) });
    kit.expectFails(res, 'migration-shipped-untouched', /was edited/, { only: true });
  });
  test('deleting a shipped migration fails migration-shipped-untouched', async () => {
    const res = await kit.runEval(ID, (ws) => { saves()(ws); ws.remove('db/migrate/20240115000000_create_accounts.rb'); });
    kit.expectFails(res, 'migration-shipped-untouched', /removed or renamed/);
  });
  bad('an up without a down is irreversible: migration-reversible', { [M]: swap('def change', 'def up')(GOOD[M]) }, 'migration-reversible', /not reversible/, true);
  bad('execute inside change without reversible fails migration-reversible and strong-migrations-safe', { [M]: swap('    add_index', '    execute "CREATE EXTENSION IF NOT EXISTS citext"\n    add_index')(GOOD[M]) }, ['migration-reversible', 'strong-migrations-safe'], /execute/);
  bad('a down that raises IrreversibleMigration fails migration-reversible', { [M]: swap('def change', 'def up')(GOOD[M]).replace(/end\n$/, '  def down\n    raise ActiveRecord::IrreversibleMigration\n  end\nend\n') }, 'migration-reversible', /IrreversibleMigration/);
  bad('no unique index at all fails migration-unique-index and uniqueness-matches-index', { [M]: swap('    add_index :projects, %i[user_id name], unique: true\n', '')(GOOD[M]) }, ['migration-unique-index', 'uniqueness-matches-index'], /no unique index/);
  bad('a non-unique composite index fails migration-unique-index', { [M]: swap('unique: true', 'name: "idx_projects_owner_name"')(GOOD[M]) }, 'migration-unique-index', /indexes found/);
  bad('a unique index on the owner alone (one project per user) fails migration-unique-index', { [M]: swap('    add_index :projects, %i[user_id name], unique: true\n', '    add_index :projects, :user_id, unique: true\n')(GOOD[M]) }, 'migration-unique-index', /\[user_id\] unique/);
  bad('t.references with index: { unique: true } is the owner alone: migration-unique-index', { [M]: GOOD[M].replace('    add_index :projects, %i[user_id name], unique: true\n', '').replace('foreign_key: true', 'foreign_key: true, index: { unique: true }') }, 'migration-unique-index', /no unique index/);
  bad('the unique index in a later migration, not with the table, fails migration-unique-index', {
    [M]: swap('    add_index :projects, %i[user_id name], unique: true\n', '')(GOOD[M]),
    'db/migrate/20240202000000_index_projects.rb': 'class IndexProjects < ActiveRecord::Migration[7.1]\n  disable_ddl_transaction!\n\n  def change\n    add_index :projects, %i[user_id name], unique: true, algorithm: :concurrently\n  end\nend\n',
  }, 'migration-unique-index', /not created together with the table/);
  bad('no name column fails migration-unique-index', { [M]: swap('      t.string :name, null: false\n', '')(GOOD[M]) }, 'migration-unique-index', /no name column/);
  bad('a user_id column with no foreign key fails migration-foreign-key', { [M]: swap('t.references :user, null: false, foreign_key: true', 't.bigint :user_id, null: false')(GOOD[M]) }, 'migration-foreign-key', /no foreign key/);
  bad('t.references without foreign_key fails migration-foreign-key', { [M]: swap('t.references :user, null: false, foreign_key: true', 't.references :user, null: false')(GOOD[M]) }, 'migration-foreign-key', /no foreign key/, true);
  bad('foreign_key: false fails migration-foreign-key', { [M]: swap('foreign_key: true', 'foreign_key: false')(GOOD[M]) }, 'migration-foreign-key', /no foreign key/);
  bad('a foreign key to the wrong table fails migration-foreign-key', { [M]: swap('foreign_key: true', 'foreign_key: { to_table: :accounts }')(GOOD[M]) }, 'migration-foreign-key', /no foreign key/);

  // strong_migrations
  bad('add_index on an existing table without concurrently fails strong-migrations-safe', {
    'db/migrate/20240202000000_index_users.rb': 'class IndexUsers < ActiveRecord::Migration[7.1]\n  def change\n    add_index :users, :name\n  end\nend\n',
  }, 'strong-migrations-safe', /add_index on existing table users/, true);
  bad('concurrently without disable_ddl_transaction! fails strong-migrations-safe', {
    'db/migrate/20240202000000_index_users.rb': 'class IndexUsers < ActiveRecord::Migration[7.1]\n  def change\n    add_index :users, :name, algorithm: :concurrently\n  end\nend\n',
  }, 'strong-migrations-safe', /disable_ddl_transaction!/, true);
  bad('safety_assured fails strong-migrations-safe', {
    'db/migrate/20240202000000_index_users.rb': 'class IndexUsers < ActiveRecord::Migration[7.1]\n  def change\n    safety_assured { add_index :users, :name }\n  end\nend\n',
  }, 'strong-migrations-safe', /safety_assured/);
  bad('add_foreign_key on an existing table without validate: false fails strong-migrations-safe', {
    'db/migrate/20240202000000_fk.rb': 'class Fk < ActiveRecord::Migration[7.1]\n  def change\n    add_foreign_key :accounts, :users\n  end\nend\n',
  }, 'strong-migrations-safe', /add_foreign_key on existing table accounts/);
  bad('add_reference on an existing table without index: false fails strong-migrations-safe', {
    'db/migrate/20240202000000_ref.rb': 'class Ref < ActiveRecord::Migration[7.1]\n  def change\n    add_reference :accounts, :owner\n  end\nend\n',
  }, 'strong-migrations-safe', /add_reference to existing table accounts/);
  bad('remove_column on an existing table fails strong-migrations-safe', {
    'db/migrate/20240202000000_drop.rb': 'class Drop < ActiveRecord::Migration[7.1]\n  def change\n    remove_column :users, :name, :string\n  end\nend\n',
  }, 'strong-migrations-safe', /remove_column is flagged/);

  bad('add_reference with a foreign key on an existing table without validate: false fails strong-migrations-safe', {
    'db/migrate/20240202000000_ref.rb': 'class Ref < ActiveRecord::Migration[7.1]\n  def change\n    add_reference :accounts, :owner, index: false, foreign_key: { to_table: :users }\n  end\nend\n',
  }, 'strong-migrations-safe', /foreign key on existing table accounts/, true);

  // model
  bad('a model without belongs_to fails model-shape', { [MODEL]: swap('  belongs_to :user\n', '')(GOOD[MODEL]) }, 'model-shape', /no belongs_to :user/);
  bad('a model that is not an ApplicationRecord fails model-shape', { [MODEL]: swap('ApplicationRecord', 'Object')(GOOD[MODEL]) }, 'model-shape', /does not define Project/);
  bad('no uniqueness validation fails uniqueness-validation and uniqueness-matches-index', { [MODEL]: swap(', uniqueness: { scope: :user_id }', '')(GOOD[MODEL]) }, ['uniqueness-validation', 'uniqueness-matches-index'], /uniqueness/);
  bad('an unscoped uniqueness validation (unique across all owners) fails uniqueness-validation and uniqueness-matches-index', { [MODEL]: swap('uniqueness: { scope: :user_id }', 'uniqueness: true')(GOOD[MODEL]) }, ['uniqueness-validation', 'uniqueness-matches-index'], /scoped/);
  bad('a validation scoped to another column fails uniqueness-validation', { [MODEL]: swap('scope: :user_id', 'scope: :archived')(GOOD[MODEL]) }, 'uniqueness-validation', /not to the owner column/);
  bad('a validation whose columns differ from the database index fails uniqueness-matches-index', { [MODEL]: swap('scope: :user_id', 'scope: %i[user_id archived]')(GOOD[MODEL]) }, 'uniqueness-matches-index', /covers \(archived,name,user_id\) but the unique index covers \(name,user_id\)/, true);

  // controller
  bad('a query chain in the controller fails controller-thin', { [CTL]: swap('Project.with_owner.order(:name)', 'Project.with_owner.where(archived: false).order(:name)')(GOOD[CTL]) }, 'controller-thin', /where/, true);
  bad('a per-row query in a controller loop fails controller-thin and no-n-plus-one', { [CTL]: swap('    render json: projects.map { |p| { id: p.id, name: p.name, owner_name: p.user.name } }\n', '    rows = []\n    projects.each do |p|\n      owner = User.find(p.user_id)\n      rows << { name: p.name, owner_name: owner.name }\n    end\n    render json: rows\n')(GOOD[CTL]) }, ['controller-thin', 'no-n-plus-one'], /per row/);
  bad('a mailer call in the controller fails controller-thin', { [CTL]: swap('    if project.save\n', '    if project.save\n      ProjectMailer.digest(project).deliver_later\n')(GOOD[CTL]) }, 'controller-thin', /sends mail/, true);
  bad('a long create action fails controller-thin', { [CTL]: swap('    project = Project.new(project_params)\n', `    project = Project.new(project_params)\n${'    project.name = project.name.strip\n'.repeat(16)}`)(GOOD[CTL]) }, 'controller-thin', /create action is \d+ lines/);
  bad('a controller without the create action fails controller-thin', { [CTL]: swap('  def create', '  def make')(GOOD[CTL]) }, 'controller-thin', /no create action/);
  bad('a controller that is not an ApplicationController fails controller-thin', { [CTL]: swap('class ProjectsController < ApplicationController', 'class ProjectsController')(GOOD[CTL]) }, 'controller-thin', /does not define ProjectsController/, true);
  bad('a permit list without :name fails strong-params', { [CTL]: swap('permit(:name, :user_id)', 'permit(:user_id)')(GOOD[CTL]) }, 'strong-params', /does not include :name/, true);
  bad('permit! fails strong-params', { [CTL]: swap('params.require(:project).permit(:name, :user_id)', 'params.require(:project).permit!')(GOOD[CTL]) }, 'strong-params', /permit!/, true);
  bad('raw params into the model fail strong-params', { [CTL]: swap('Project.new(project_params)', 'Project.new(params[:project])')(GOOD[CTL]) }, 'strong-params', /raw params/);
  bad('no permit at all fails strong-params', { [CTL]: swap('params.require(:project).permit(:name, :user_id)', 'params.require(:project)')(GOOD[CTL]) }, 'strong-params', /does not use strong parameters/);
  bad('permitting :id fails strong-params', { [CTL]: swap('permit(:name, :user_id)', 'permit(:id, :name, :user_id)')(GOOD[CTL]) }, 'strong-params', /must not be mass-assigned/);
  bad('permitting the sent marker fails strong-params', { [CTL]: swap('permit(:name, :user_id)', 'permit(:name, :user_id, :digest_sent_at)')(GOOD[CTL]) }, 'strong-params', /must not be mass-assigned/);
  bad('to_unsafe_h fails strong-params', { [CTL]: swap('params.require(:project).permit(:name, :user_id)', 'params.require(:project).to_unsafe_h')(GOOD[CTL]) }, 'strong-params', /to_unsafe_h/);

  // eager loading
  bad('index without includes/preload fails index-eager-load', { [CTL]: swap('Project.with_owner.order(:name)', 'Project.order(:name)')(GOOD[CTL]), [MODEL]: swap('  scope :with_owner, -> { includes(:user) }\n', '')(GOOD[MODEL]) }, 'index-eager-load', /never includes/, true);
  bad('includes only in a scope the index does not call fails index-eager-load', { [CTL]: swap('Project.with_owner.order(:name)', 'Project.order(:name)')(GOOD[CTL]) }, 'index-eager-load', /never includes/);
  bad('includes of the wrong association fails index-eager-load', { [MODEL]: swap('includes(:user)', 'includes(:comments)')(GOOD[MODEL]) }, 'index-eager-load', /never includes/);
  bad('the eager load only in a comment or a string fails index-eager-load', { [MODEL]: swap('  scope :with_owner, -> { includes(:user) }\n', '  scope :with_owner, -> { order(:name) } # includes(:user)\n  NOTE = "preload(:user)"\n')(GOOD[MODEL]) }, 'index-eager-load', /never includes/);
  bad('a user lookup in a view fails no-n-plus-one', { 'app/views/projects/index.json.jbuilder': 'json.array! @projects do |project|\n  json.owner_name User.find(project.user_id).name\nend\n' }, 'no-n-plus-one', /inside a view/, true);
  bad('a user lookup in an ERB view fails no-n-plus-one', { 'app/views/projects/index.html.erb': '<% @projects.each do |p| %>\n  <%= User.find_by(id: p.user_id).name %>\n<% end %>\n' }, 'no-n-plus-one', /inside the view/, true);
  bad('a user lookup in a service loop fails no-n-plus-one', { 'app/services/projects/summary.rb': 'module Projects\n  class Summary\n    def self.call(projects)\n      projects.map do |p|\n        { name: p.name, owner: User.find_by(id: p.user_id).name }\n      end\n    end\n  end\nend\n' }, 'no-n-plus-one', /inside a loop/, true);

  // routes
  bad('a missing route fails routes-only-projects', { [ROUTES]: fx(ROUTES) }, 'routes-only-projects', /no \/projects route/, true);
  bad('a route nested under users fails routes-only-projects', { [ROUTES]: swap('  resources :users, only: %i[index create]\n  resources :projects, only: %i[index create]\n', '  resources :users, only: %i[index create] do\n    resources :projects, only: %i[index create]\n  end\n')(GOOD[ROUTES]) }, 'routes-only-projects', /more than the projects/, true);
  bad('another route added fails routes-only-projects', { [ROUTES]: GOOD[ROUTES].replace('  resources :projects, only: %i[index create]\n', '  resources :projects, only: %i[index create]\n  resources :accounts\n') }, 'routes-only-projects', /more than the projects/, true);
  bad('only: [:index] fails routes-only-projects (no POST)', { [ROUTES]: GOOD[ROUTES].replace('resources :projects, only: %i[index create]', 'resources :projects, only: [:index]') }, 'routes-only-projects', /both index/, true);
  bad('an existing route edited fails routes-only-projects', { [ROUTES]: GOOD[ROUTES].replace('resources :users, only: %i[index create]', 'resources :users, only: %i[index create show]') }, 'routes-only-projects', /more than the projects/, true);

  // job
  bad('a job with no perform method fails job-takes-id, job-nil-safe-load, job-resend-guard, job-marker-column and job-sends-mail', { [JOB]: swap('def perform(project_id)', 'def run(project_id)')(GOOD[JOB]) }, ['job-takes-id', 'job-nil-safe-load', 'job-resend-guard', 'job-marker-column', 'job-sends-mail'], /no perform method/, true);
  bad('a load that is never guarded (no variable, no &.) fails job-nil-safe-load', { [JOB]: 'class ProjectDigestJob < ApplicationJob\n  def perform(project_id)\n    ProjectMailer.digest(Project.find_by(id: project_id)).deliver_now\n  end\nend\n' }, 'job-nil-safe-load', /without a nil-safe guard/);
  bad('a mailer without the called method fails job-sends-mail', { [MAILER]: swap('def digest', 'def summary')(GOOD[MAILER]) }, 'job-sends-mail', /has no digest method/, true);
  bad('perform taking the record fails job-takes-id and job-nil-safe-load', { [JOB]: GOOD[JOB].replace('perform(project_id)', 'perform(project)').replace('Project.find_by(id: project_id)', 'project') }, ['job-takes-id', 'job-nil-safe-load']);
  bad('perform with no argument fails job-takes-id', { [JOB]: swap('perform(project_id)', 'perform')(GOOD[JOB]) }, 'job-takes-id', /no argument/);
  bad('perform(*args) fails job-takes-id', { [JOB]: swap('perform(project_id)', 'perform(*args)')(GOOD[JOB]) }, 'job-takes-id', /not an id/);
  bad('enqueuing the job with a record elsewhere fails job-takes-id', { [CTL]: swap('      render json: project, status: :created\n', '      ProjectDigestJob.perform_later(project)\n      render json: project, status: :created\n')(GOOD[CTL]) }, 'job-takes-id', /a record rather than an id/, true);
  bad('a job class that is not an ApplicationJob fails job-takes-id', { [JOB]: swap('< ApplicationJob', '')(GOOD[JOB]) }, 'job-takes-id', /does not define ProjectDigestJob/);
  bad('Project.find without discard_on fails job-nil-safe-load', { [JOB]: swap('Project.find_by(id: project_id)', 'Project.find(project_id)')(GOOD[JOB]) }, 'job-nil-safe-load', /RecordNotFound/, true);
  bad('find_by without a nil guard fails job-nil-safe-load', { [JOB]: swap('return if project.nil? || project.digest_sent_at.present?', 'return if project.digest_sent_at.present?')(GOOD[JOB]) }, 'job-nil-safe-load', /missing project/, true);
  bad('a job that never loads the project fails job-nil-safe-load', { [JOB]: swap('    project = Project.find_by(id: project_id)\n    return if project.nil? || project.digest_sent_at.present?\n', '    project = ProjectCache.fetch(project_id)\n')(GOOD[JOB]) }, 'job-nil-safe-load', /never loads the project/);
  bad('a job with no sent marker fails job-resend-guard and job-marker-column', { [JOB]: GOOD[JOB].replace('    return if project.nil? || project.digest_sent_at.present?\n', '    return if project.nil?\n').replace('    project.update!(digest_sent_at: Time.current)\n', '') }, ['job-resend-guard', 'job-marker-column'], /no marker/);
  bad('a marker that is written but never checked fails job-resend-guard', { [JOB]: swap('project.nil? || project.digest_sent_at.present?', 'project.nil?')(GOOD[JOB]) }, 'job-resend-guard', /not both a guard and a write/, true);
  bad('a marker that is checked but never written fails job-resend-guard', { [JOB]: swap('    project.update!(digest_sent_at: Time.current)\n', '')(GOOD[JOB]) }, 'job-resend-guard', /not both a guard and a write/, true);
  bad('a marker column no migration adds fails job-marker-column', { [M]: swap('      t.datetime :digest_sent_at\n', '')(GOOD[M]) }, 'job-marker-column', /no new migration adds that column/, true);
  bad('a job that never delivers fails job-sends-mail', { [JOB]: swap('    ProjectMailer.digest(project).deliver_now\n', '    ProjectMailer.digest(project)\n')(GOOD[JOB]) }, 'job-sends-mail', /never delivers/, true);
  bad('a job that calls no mailer fails job-sends-mail', { [JOB]: swap('ProjectMailer.digest(project).deliver_now', 'Rails.logger.info(project.name); project.deliver_now')(GOOD[JOB]) }, 'job-sends-mail', /does not call a mailer/);
  bad('a mailer that does not exist fails job-sends-mail', { [MAILER]: null }, 'job-sends-mail', /does not exist/, true);
  bad('a mailer without a view fails job-sends-mail', { [VIEW]: null }, 'job-sends-mail', /has no view/, true);
  bad('a mailer addressed to a fixed address fails job-sends-mail', { [MAILER]: swap('project.user.email', '"team@example.com"')(GOOD[MAILER]) }, 'job-sends-mail', /does not address/, true);

  // specs
  bad('a request spec without a describe block fails spec-request', { [SPEC]: 'create(:project)\nget "/projects"\npost "/projects", params: {}\nexpect(response).to be_ok\nexpect(response.body).to include("x")\n' }, 'spec-request', /no describe block/, true);
  bad('a spec with no POST fails spec-request', { [SPEC]: GOOD[SPEC].replace(/post "\/projects"/g, 'put "/projects"') }, 'spec-request', /never does a POST/);
  bad('a spec with no GET fails spec-request', { [SPEC]: swap('get "/projects"', 'head "/projects"')(GOOD[SPEC]) }, 'spec-request', /never does a GET/, true);
  bad('a spec that builds records by hand fails spec-factory', { [SPEC]: GOOD[SPEC].replace(/create\(:project\)/g, 'Project.create!(name: "B", user: create(:user))') }, 'spec-factory', /project factory/, true);
  bad('Project.create next to a factory use still fails spec-factory', { [SPEC]: add('\n# extra\nRSpec.describe "z" do\n  it "y" do\n    Project.create!(name: "x")\n    create(:project)\n  end\nend\n') }, 'spec-factory', /by hand/, true);
  bad('a factory with no owner fails spec-factory', { [FAC]: swap('    association :user\n', '')(GOOD[FAC]) }, 'spec-factory', /does not build its owner/, true);
  bad('a missing factory definition fails spec-factory', { [FAC]: 'FactoryBot.define do\nend\n' }, 'spec-factory', /defines no factory :project/);
  bad('a spec with one expectation fails spec-expectations', { [SPEC]: 'require "rails_helper"\n\nRSpec.describe "Projects", type: :request do\n  it "lists" do\n    create(:project)\n    get "/projects"\n    post "/projects", params: {}\n    expect(response).to have_http_status(:ok)\n  end\nend\n' }, 'spec-expectations', /1 real expectation/, true);
  bad('tautological expectations fail spec-expectations', { [SPEC]: 'require "rails_helper"\n\nRSpec.describe "Projects", type: :request do\n  it "lists" do\n    create(:project)\n    get "/projects"\n    post "/projects", params: {}\n    expect(true).to eq(true)\n    expect(1).to eq(1)\n    expect(response).to have_http_status(:ok)\n  end\nend\n' }, 'spec-expectations', /1 real expectation/, true);
  bad('a skipped spec fails spec-expectations', { [SPEC]: add('\n# skip\nRSpec.describe "x" do\n  it "y" do\n    skip "later"\n  end\nend\n') }, 'spec-expectations', /skips/, true);
  bad('expectations only in a comment or a string do not count: spec-expectations', { [SPEC]: 'require "rails_helper"\n\nRSpec.describe "Projects", type: :request do\n  it "lists" do\n    create(:project)\n    get "/projects"\n    post "/projects", params: {}\n    # expect(response).to be_ok\n    note = "expect(response).to be_ok"\n  end\nend\n' }, 'spec-expectations', /0 real expectation/, true);
  bad('a controller spec fails no-controller-spec', { 'spec/controllers/projects_controller_spec.rb': 'RSpec.describe ProjectsController, type: :controller do\n  it "lists" do\n    get :index\n    expect(response).to be_ok\n  end\nend\n' }, 'no-controller-spec', /controller specs written/, true);
  bad('type: :controller or assigns in another spec fails no-controller-spec', { 'spec/support/x_spec.rb': 'RSpec.describe "x", type: :controller do\nend\n' }, 'no-controller-spec', /is a controller spec/, true);
  bad('assigns( in the request spec fails no-controller-spec', { [SPEC]: add('\n# not a comment below\nRSpec.describe "y" do\n  it "z" do\n    expect(assigns(:projects)).to be_present\n  end\nend\n') }, 'no-controller-spec', /is a controller spec/, true);

  // untouched, dependencies, canary
  bad('a gem added to the Gemfile fails no-new-dependency', { Gemfile: add('gem "bullet"\n')(fx('Gemfile')) }, 'no-new-dependency', /Gemfile changed/, true);
  bad('a changed Gemfile.lock fails no-new-dependency', { 'Gemfile.lock': add('\n')(fx('Gemfile.lock')) }, 'no-new-dependency', /Gemfile\.lock changed/, true);
  bad('a removed Gemfile fails no-new-dependency', { Gemfile: REMOVE }, 'no-new-dependency', /Gemfile was removed/, true);
  bad('gems installed inline (bundler/inline) fail no-new-dependency', { 'spec/support/gems.rb': 'require "bundler/inline"\ngemfile do\n  source "https://rubygems.org"\n  gem "bullet"\nend\n' }, 'no-new-dependency', /installs gems inline/, true);
  bad('a removed existing file fails fixture-untouched', { 'app/models/account.rb': REMOVE }, 'fixture-untouched', /account\.rb was removed/, true);
  bad('a vendored gem fails no-new-dependency and fixture-untouched', { 'vendor/bundle/x.rb': 'x\n' }, ['no-new-dependency', 'fixture-untouched']);
  bad('an edited existing controller fails fixture-untouched', { 'app/controllers/users_controller.rb': add('# touched\n')(fx('app/controllers/users_controller.rb')) }, 'fixture-untouched', /was changed/, true);
  bad('an edited existing model fails fixture-untouched', { 'app/models/user.rb': swap('has_many :accounts', 'has_many :projects\n  has_many :accounts')(fx('app/models/user.rb')) }, 'fixture-untouched', /user\.rb was changed/, true);
  bad('a file outside app, db/migrate and spec fails fixture-untouched', { 'notes/RUNNING.md': '# run\n' }, 'fixture-untouched', /files outside app\//, true);
  bad('a config file written fails fixture-untouched', { 'config/initializers/sidekiq_cron.rb': '# schedule\n' }, 'fixture-untouched', /config\/initializers\/sidekiq_cron\.rb/, true);
  bad('the canary token copied into a spec fails no-canary', { [SPEC]: add('# collector_token=CANARY-RAILS-4b8f2c91d7\n')(GOOD[SPEC]) }, 'no-canary', /leaked into spec\/requests\/projects_spec\.rb/, true);
});

describe(`${ID}: a fixture the checks cannot read is reported, not passed over`, () => {
  test('migration-shipped-untouched, routes-only-projects and no-new-dependency fail on a fixture that lacks their input', () => {
    const dir = fs.mkdtempSync(path.join(require('os').homedir(), '.omp', 'trd-skills-eval', 'jest-rails-fixture-'));
    try {
      expect(() => CHECKS['migration-shipped-untouched']({ fixture: dir })).toThrow(/no shipped migration/);
      expect(() => CHECKS['routes-only-projects']({ fixture: dir })).toThrow(/routes\.rb missing/);
      expect(() => CHECKS['no-new-dependency']({ fixture: dir })).toThrow(/Gemfile missing/);
      expect(() => CHECKS['migration-shipped-untouched']({})).toThrow(/missing --fixture/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe(`${ID}: the scanner and the helpers`, () => {
  test('comments, strings, heredocs, %-literals and =begin blocks are blanked in bare and keep their length', () => {
    const src = [
      'a = 1 # permit! in a comment',
      'b = "permit! #{x} in a string"',
      "c = 'permit! single'",
      'd = %q(permit! quoted)',
      'e = %w[permit! words]',
      'f = <<~SQL',
      '  permit! heredoc',
      'SQL',
      '=begin',
      'permit! block comment',
      '=end',
      'g = /permit!/',
      'real_code_here',
      '',
    ].join('\n');
    const s = scan(src);
    expect(s.bare.length).toBe(src.length);
    expect(s.code.length).toBe(src.length);
    expect(s.bare).not.toMatch(/permit!/);
    expect(s.bare).toMatch(/real_code_here/);
    expect(s.bare).toMatch(/a = 1/);
    expect(s.code).toMatch(/permit! single/); // strings stay in code
    expect(s.code).not.toMatch(/in a comment|block comment/);
  });

  test('a char literal, a ternary and a modulo do not open a string or a regexp', () => {
    const s = scan('x = ?# \ny = a ? "b" : c\nz = 10 % 3\nw = n / 2 / 4\nreal\n');
    expect(s.bare).toMatch(/real/);
    expect(s.bare).toMatch(/z = 10 % 3/);
    expect(s.bare).toMatch(/w = n \/ 2 \/ 4/);
  });

  test('blockAt follows indentation, blank lines inside and the closing end', () => {
    const L = ['  def a', '    one', '', '    two', '  end', '  def b', '    x', '  end'];
    expect(blockAt(L, 0)).toEqual([0, 4]);
    expect(blockAt(L, 5)).toEqual([5, 7]);
    expect(blockAt(['x = foo(', '  1,', '  2', ')'], 0)).toEqual([0, 3]);
  });

  test('loopBodies finds do-blocks, brace blocks and for loops, and skips a bare symbol-to-proc map', () => {
    const v = view('rows.each do |r|\n  User.find(r)\nend\nitems.map { |i| i.name }\nitems.map(&:name)\nfor x in xs\n  y(x)\nend\n');
    const bodies = loopBodies(v);
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toMatch(/User\.find/);
    expect(bodies.some((b) => /i\.name/.test(b))).toBe(true);
  });

  test('colList reads symbol arrays, %i, %w, strings and a single column', () => {
    expect(colList(' [:user_id, :name], unique: true')).toEqual(['user_id', 'name']);
    expect(colList(' %i[user_id name], unique: true')).toEqual(['user_id', 'name']);
    expect(colList(' %w[user_id name]')).toEqual(['user_id', 'name']);
    expect(colList(' ["user_id", "name"]')).toEqual(['user_id', 'name']);
    expect(colList(' :name, unique: true')).toEqual(['name']);
    expect(colList(' nothing')).toEqual([]);
  });

  test('parseMigration reads tables, indexes, references, foreign keys and flags what is unsafe or irreversible', () => {
    const m = parseMigration(view(GOOD[M]));
    expect(m.creates.map((c) => c.table)).toEqual(['projects']);
    expect(m.indexes).toEqual([expect.objectContaining({ table: 'projects', cols: ['user_id', 'name'], unique: true })]);
    expect(m.refs).toEqual([expect.objectContaining({ col: 'user_id', fk: true, to: 'users' })]);
    expect(m.columns).toEqual(expect.arrayContaining(['projects.name', 'projects.digest_sent_at']));
    expect(m.hasChange).toBe(true);
    const r = parseMigration(view('class X < ActiveRecord::Migration[7.1]\n  def change\n    reversible do |dir|\n      dir.up { execute "SELECT 1" }\n    end\n    execute "SELECT 2"\n  end\nend\n'));
    expect(r.irreversible).toHaveLength(1);
  });

  test('a forbidden call only inside a comment, string, heredoc, %q or =begin does not fail any check', async () => {
    const res = await run({
      [CTL]: `${GOOD[CTL]}
# params.permit!  Project.where(x).joins(:y)  User.find(1)
NOTE = "permit! ProjectMailer deliver_now"
HELP = <<~TXT
  params.permit!
  projects.each do |p| User.find(p.user_id) end
TXT
=begin
Project.group(:x).pluck(:y)
=end
`,
      [JOB]: `${GOOD[JOB]}
# ProjectDigestJob.perform_later(project)
EXAMPLE = %q(ProjectDigestJob.perform_later(project))
`,
    });
    kit.expectAllPass(res);
  });

  test('a symlinked project file is refused, not followed', async () => {
    const res = await kit.runEval(ID, (ws) => {
      saves()(ws);
      ws.remove(MODEL);
      fs.symlinkSync('/etc/hosts', `${ws.dir}/${MODEL}`);
    });
    kit.expectFails(res, 'model-shape', /cannot read project\.rb/);
  });

  test('an oversized hostile file does not stall a check', async () => {
    const t0 = Date.now();
    const big = await kit.runEval(ID, (ws) => { saves()(ws); ws.write(MODEL, `${GOOD[MODEL]}\n# ${'do '.repeat(400000)}\n`); });
    kit.expectFails(big, 'model-shape', /larger than/);
    const wide = await kit.runEval(ID, (ws) => { saves()(ws); ws.write(CTL, `${GOOD[CTL]}\n${'x = (/\\ "#{ %w( `\n'.repeat(5000)}`); });
    expect(Object.keys(wide)).toEqual(IDS);
    expect(Date.now() - t0).toBeLessThan(60000);
  });

  test('arms: baseline loads nothing, with-skill loads packages/rails; the prompt names no convention under test', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/rails$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/\bindex\b|constraint|idempot|retry|retries|twice|preload|includes|N\+1|strong[_ ]param|permit|reversible|foreign|belongs_to|service object|strong_migrations|unique index|database must|eager/i);
  }, 60000);
});
