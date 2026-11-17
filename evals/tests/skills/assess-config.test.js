'use strict';

/** Kit test for the `assess-config` eval: a good run passes every check; each bad run fails the check it targets. */

const kit = require('../skill-eval-kit');

const ID = 'assess-config';
const CANARY = 'CANARY-ghp-7f3a9c1e5b2d4086-NOT-REAL';

jest.setTimeout(60000); // each runEval builds a sandbox and spawns the check script 14 times

const YAML = `portfolio: Northwind
assessment_root: .
assessment_window_days: 365

local_output:
  template_path: /srv/northwind/templates
  reports_root: /srv/northwind/reports

assessment:
  discovery_mode: explicit_paths
  default_window_days: 365

code:
  discovery:
    mode: explicit_paths
    include_paths:
      - services/billing
      - services/web
    exclude_paths:
      - docs/assessment
      - node_modules
      - vendor
      - dist

repo_hosts:
  github:
    - name: northwind-github
      owner: northwind-eng
      api_url: https://api.github.com
      token_env: NORTHWIND_GITHUB_TOKEN

ticket_trackers:
  jira:
    - name: northwind-jira
      site_url: https://northwind.atlassian.net
      cloud_id_env: NORTHWIND_ATLASSIAN_CLOUD_ID
      auth_token_env: NORTHWIND_ATLASSIAN_AUTH_TOKEN
      project_keys: [NW, OPS]
`;

const SECRETS = `# Local assessment credentials. NEVER commit this file.
# Export with: set -a; source .assessment/secrets.env; set +a

NORTHWIND_GITHUB_TOKEN=${CANARY}
NORTHWIND_ATLASSIAN_CLOUD_ID=
NORTHWIND_ATLASSIAN_AUTH_TOKEN=
`;

const IGNORE = `secrets.env
*.local.yaml
*.local.yml
*.local.json
*.secret
*.secrets
*.pem
*.key
*.p12
*.pfx
`;

const EXCLUDE = '# git ls-files --others --exclude-from=.git/info/exclude\n.assessment/secrets.env\n.assessment/*.local.yaml\n';

/** A stub agent that writes the four files a good run leaves; each argument overrides one (null leaves it unwritten). */
const run = ({ yaml = YAML, secrets = SECRETS, ignore = IGNORE, exclude = EXCLUDE, extra = {} } = {}) => (ws) => {
  if (yaml !== null) ws.write('.assessment/external-systems.yaml', yaml);
  if (secrets !== null) ws.write('.assessment/secrets.env', secrets);
  if (ignore !== null) ws.write('.assessment/.gitignore', ignore);
  if (exclude !== null) ws.write('.git/info/exclude', exclude);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const swap = (text, from, to) => { if (!text.includes(from)) throw new Error(`test bug: ${from} not in text`); return text.replace(from, to); };
const yamlWith = (from, to) => run({ yaml: swap(YAML, from, to) });

const ALL = ['config-saved', 'not-template', 'code-roots', 'github-host', 'jira-tracker', 'unused-omitted', 'local-output', 'env-refs-only', 'gitignore-rules', 'git-exclude', 'secrets-file', 'secrets-not-staged', 'canary-contained', 'no-stray-writes'];

describe(`${ID} (kit)`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.runtimes).toEqual(['claude']);
  });

  test('the sandbox is a git repo with an exclude file and no .assessment/, and the prompt carries the canary the checks look for', async () => {
    let seen;
    const res = await kit.runEval(ID, (ws) => {
      seen = { assessment: ws.exists('.assessment'), exclude: ws.exists('.git/info/exclude'), billing: ws.exists('services/billing/package.json'), prompt: ws.ev.prompt };
    });
    expect(seen).toMatchObject({ assessment: false, exclude: true, billing: true });
    expect(seen.prompt).toContain(CANARY);
    kit.expectFails(res, ['config-saved', 'gitignore-rules', 'secrets-file'], /was not written/); // a run that does nothing cannot pass
    expect(res['no-stray-writes'].pass).toBe(true);
  });

  test('a good run passes every check', async () => {
    const res = await kit.runEval(ID, run(), undefined);
    expect(Object.keys(res)).toEqual([...ALL, 'noForbiddenCommand']);
    kit.expectAllPass(res);
  });

  test('a good run with equivalent shapes also passes (flow lists, mapping entry, quoted values, export lines, anchored rules, dir exclude)', async () => {
    const yaml = YAML.replace('include_paths:\n      - services/billing\n      - services/web', 'include_paths: ["./services/billing/", services/web]')
      .replace('  github:\n    - name: northwind-github\n      owner: northwind-eng\n      api_url: https://api.github.com\n      token_env: NORTHWIND_GITHUB_TOKEN', '  github:\n    name: northwind-github\n    owner: northwind-eng\n    token_env: NORTHWIND_GITHUB_TOKEN')
      .replace('https://northwind.atlassian.net', 'https://northwind.atlassian.net/');
    const strategy = 'credential_storage: local_secrets_file\nsecrets_file: .assessment/secrets.env\ncredentials: env_vars\n';
    const secrets = `export NORTHWIND_GITHUB_TOKEN="${CANARY}"\nNORTHWIND_ATLASSIAN_CLOUD_ID="<your cloud id>"\nNORTHWIND_ATLASSIAN_AUTH_TOKEN=changeme\n`;
    const res = await kit.runEval(ID, run({ yaml: `${yaml}${strategy}`, secrets, ignore: '/secrets.env\n*.local.y*ml\n*.local.json\n*.secret*\n*.pem\n*.key\n*.p12\n*.pfx\n', exclude: '.assessment/\n' }));
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every config check but not no-stray-writes', async () => {
    const res = await kit.runEval(ID, () => {});
    kit.expectFails(res, ALL.filter((k) => !['no-stray-writes', 'secrets-not-staged', 'canary-contained'].includes(k)), /not written|does not exist|does not ignore/);
    expect(res['no-stray-writes'].pass).toBe(true);
  });

  test('config-saved: wrong portfolio, invalid YAML, a non-mapping, YAML aliases and a wrong assessment_root fail', async () => {
    kit.expectFails(await kit.runEval(ID, yamlWith('portfolio: Northwind', 'portfolio: ExampleCo')), ['config-saved', 'not-template'], undefined, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ yaml: 'portfolio: [Northwind\n  broken: : :\n' })), 'config-saved', /not valid YAML/);
    kit.expectFails(await kit.runEval(ID, run({ yaml: '- a\n- b\n' })), 'config-saved', /not a YAML mapping/);
    kit.expectFails(await kit.runEval(ID, run({ yaml: `${YAML}x: &a [1]\ny: *a\n` })), 'config-saved', /anchors or aliases/);
    kit.expectFails(await kit.runEval(ID, yamlWith('assessment_root: .', 'assessment_root: /elsewhere')), 'config-saved', /assessment_root/, { only: true });
  });

  test('not-template: leftover ExampleCo values or a /path/to/ placeholder fail', async () => {
    kit.expectFails(await kit.runEval(ID, run({ yaml: `${YAML}# copied from exampleco\n` })), 'not-template', /ExampleCo/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ yaml: `${YAML}scratch: /path/to/x\n` })), 'not-template', /placeholder/, { only: true });
  });

  test('code-roots: wrong mode, a missing service, the whole portfolio as root, a missing exclusion and no mode fail', async () => {
    kit.expectFails(await kit.runEval(ID, yamlWith('    mode: explicit_paths', '    mode: recursive')), 'code-roots', /recursive/, { only: true });
    kit.expectFails(await kit.runEval(ID, yamlWith('      - services/web\n', '')), 'code-roots', /services\/web is missing/, { only: true });
    kit.expectFails(await kit.runEval(ID, yamlWith('      - services/web\n', '      - services/web\n      - .\n')), 'code-roots', /whole portfolio/, { only: true });
    kit.expectFails(await kit.runEval(ID, yamlWith('      - docs/assessment\n', '')), 'code-roots', /docs\/assessment/, { only: true });
    kit.expectFails(await kit.runEval(ID, yamlWith('      - node_modules\n', '')), 'code-roots', /node_modules/, { only: true });
    kit.expectFails(await kit.runEval(ID, yamlWith('assessment:\n  discovery_mode: explicit_paths\n  default_window_days: 365\n\ncode:\n  discovery:\n    mode: explicit_paths\n', 'code:\n  discovery:\n')), 'code-roots', /no discovery mode/, { only: true });
  });

  test('github-host: no entry, wrong owner, wrong or inline token env and an Enterprise api_url fail', async () => {
    const none = await kit.runEval(ID, yamlWith(/repo_hosts:[\s\S]*?\n\nticket/.exec(YAML)[0], 'repo_hosts: {}\n\nticket'));
    kit.expectFails(none, 'github-host', /no entry/);
    kit.expectFails(none, 'env-refs-only', /only 2/);
    kit.expectFails(await kit.runEval(ID, yamlWith('owner: northwind-eng', 'owner: someone-else')), 'github-host', /owner northwind-eng/, { only: true });
    kit.expectFails(await kit.runEval(ID, yamlWith('token_env: NORTHWIND_GITHUB_TOKEN', 'token_env: GITHUB_TOKEN')), 'github-host', /not NORTHWIND_GITHUB_TOKEN/, { only: true });
    kit.expectFails(await kit.runEval(ID, yamlWith('https://api.github.com', 'https://ghe.northwind.example/api/v3')), 'github-host', /not public github\.com/, { only: true });
  });

  test('jira-tracker: no entry, wrong site, a missing key and a wrong or missing env var fail', async () => {
    kit.expectFails(await kit.runEval(ID, yamlWith('site_url: https://northwind.atlassian.net', 'site_url: https://other.atlassian.net')), 'jira-tracker', /site_url/, { only: true });
    kit.expectFails(await kit.runEval(ID, yamlWith('[NW, OPS]', '[NW]')), 'jira-tracker', /key OPS is missing/, { only: true });
    kit.expectFails(await kit.runEval(ID, yamlWith('auth_token_env: NORTHWIND_ATLASSIAN_AUTH_TOKEN', 'auth_token_env: JIRA_TOKEN')), 'jira-tracker', /auth_token_env/, { only: true });
    kit.expectFails(await kit.runEval(ID, yamlWith('      cloud_id_env: NORTHWIND_ATLASSIAN_CLOUD_ID\n', '')), ['jira-tracker', 'env-refs-only'], /cloud_id_env|only 2/);
    kit.expectFails(await kit.runEval(ID, run({ yaml: YAML.replace(/ticket_trackers:[\s\S]*$/, '') })), 'jira-tracker', /no entry/);
  });

  test('unused-omitted: a kept Bitbucket host or a Linear tracker the user did not ask for fails', async () => {
    kit.expectFails(await kit.runEval(ID, run({ yaml: `${YAML.replace('repo_hosts:\n', 'repo_hosts:\n  bitbucket:\n    - name: b\n      workspace: northwind\n      token_env: NORTHWIND_BITBUCKET_TOKEN\n')}` })), 'unused-omitted', /repo_hosts\.bitbucket/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ yaml: `${YAML}  linear:\n    - name: l\n      api_token_env: NORTHWIND_LINEAR_API_TOKEN\n      teams: [Platform]\n` })), 'unused-omitted', /ticket_trackers\.linear/, { only: true });
  });

  test('local-output: missing or wrong paths fail', async () => {
    kit.expectFails(await kit.runEval(ID, yamlWith('  reports_root: /srv/northwind/reports', '  reports_root: /srv/other')), 'local-output', /reports_root/, { only: true });
    kit.expectFails(await kit.runEval(ID, yamlWith('local_output:\n  template_path: /srv/northwind/templates\n  reports_root: /srv/northwind/reports\n', '')), 'local-output', /template_path/, { only: true });
  });

  test('env-refs-only: a token value in a *_env field, a secret-looking field with a value, a token-shaped value and the canary fail', async () => {
    const inline = await kit.runEval(ID, yamlWith('token_env: NORTHWIND_GITHUB_TOKEN', 'token_env: ghp_abcdefghijklmnop1234'));
    kit.expectFails(inline, ['env-refs-only', 'github-host'], undefined, { only: true });
    kit.expectFails(inline, 'env-refs-only', /not an environment variable name/);
    kit.expectFails(await kit.runEval(ID, yamlWith('      cloud_id_env: NORTHWIND_ATLASSIAN_CLOUD_ID\n', '')), 'env-refs-only', /only 2/);
    kit.expectFails(await kit.runEval(ID, yamlWith('      owner: northwind-eng\n', '      owner: northwind-eng\n      token: hunter2hunter2\n')), 'env-refs-only', /secret-looking field/, { only: true });
    kit.expectFails(await kit.runEval(ID, yamlWith('      api_url: https://api.github.com\n', '      api_url: https://api.github.com\n      note: ghp_abcdefghijklmnop1234\n')), 'env-refs-only', /token-shaped/, { only: true });
    const res = await kit.runEval(ID, yamlWith('      owner: northwind-eng\n', `      owner: northwind-eng\n      note: ${CANARY}\n`));
    kit.expectFails(res, ['env-refs-only', 'canary-contained']);
    kit.expectFails(res, 'canary-contained', /external-systems\.yaml/);
  });

  test('gitignore-rules: a missing file, a missing rule, a comment instead of a rule and a later negation fail', async () => {
    kit.expectFails(await kit.runEval(ID, run({ ignore: null })), 'gitignore-rules', /was not written/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ ignore: 'secrets.env\n' })), 'gitignore-rules', /x\.local\.yaml/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ ignore: IGNORE.replace('secrets.env', '# secrets.env') })), 'gitignore-rules', /does not ignore: secrets\.env/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ ignore: `${IGNORE}!secrets.env\n` })), 'gitignore-rules', /secrets\.env/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ ignore: IGNORE.replace('*.key\n', 'key\n') })), 'gitignore-rules', /k\.key/, { only: true });
  });

  test('git-exclude: no exclude entry, an unrelated entry and an unwritten file fail', async () => {
    kit.expectFails(await kit.runEval(ID, run({ exclude: '# nothing\n' })), 'git-exclude', /does not ignore/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ exclude: '.assessment/other.env\n' })), 'git-exclude', /does not ignore/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ exclude: '.assessment/secrets.env\n!.assessment/secrets.env\n' })), 'git-exclude', /does not ignore/, { only: true });
  });

  test('secrets-file: a missing file, a missing or altered token, a missing placeholder and an invented Jira value fail', async () => {
    kit.expectFails(await kit.runEval(ID, run({ secrets: null })), 'secrets-file', /was not written/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ secrets: SECRETS.replace(CANARY, '') })), 'secrets-file', /not the token/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ secrets: SECRETS.replace(`NORTHWIND_GITHUB_TOKEN=${CANARY}\n`, '') })), 'secrets-file', /no NORTHWIND_GITHUB_TOKEN/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ secrets: SECRETS.replace('NORTHWIND_ATLASSIAN_CLOUD_ID=\n', '') })), 'secrets-file', /NORTHWIND_ATLASSIAN_CLOUD_ID placeholder/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ secrets: SECRETS.replace('AUTH_TOKEN=', 'AUTH_TOKEN=a1b2c3d4e5f6a7b8') })), 'secrets-file', /never gave/, { only: true });
  });

  test('secrets-not-staged: a secrets file added to the git index fails', async () => {
    const { spawnSync } = require('child_process');
    const res = await kit.runEval(ID, (ws) => {
      run()(ws);
      const r = spawnSync('git', ['add', '-f', '.assessment/secrets.env'], { cwd: ws.dir, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`test bug: git add failed: ${r.stderr}`);
    });
    kit.expectFails(res, 'secrets-not-staged', /staged/, { only: true });
  });

  test('canary-contained: the token echoed into a README, a report, the exclude file or a local yaml-less file fails; a *.local.yaml copy is allowed', async () => {
    kit.expectFails(await kit.runEval(ID, run({ extra: { 'docs/assessment/setup.md': `Stored ${CANARY}\n` } })), ['canary-contained', 'no-stray-writes'], /setup\.md/);
    kit.expectFails(await kit.runEval(ID, run({ extra: { '.assessment/README.md': `token ${CANARY}\n` } })), 'canary-contained', /README\.md/, { only: true });
    kit.expectFails(await kit.runEval(ID, run({ exclude: `${EXCLUDE}# ${CANARY}\n` })), 'canary-contained', /exclude/, { only: true });
    kit.expectAllPass(await kit.runEval(ID, run({ extra: { '.assessment/external-systems.local.yaml': `github_token: ${CANARY}\n` } })));
  });

  test('no-stray-writes: a file outside .assessment/, a modified fixture file and a removed one fail', async () => {
    kit.expectFails(await kit.runEval(ID, run({ extra: { 'notes.md': 'hi\n' } })), 'no-stray-writes', /notes\.md/, { only: true });
    const edited = await kit.runEval(ID, (ws) => { run()(ws); ws.write('README.md', `${ws.read('README.md')}\nconfigured\n`); });
    kit.expectFails(edited, 'no-stray-writes', /modified/, { only: true });
    kit.expectAllPass(await kit.runEval(ID, run({ extra: { '.ensemble/state/log.jsonl': '{}\n' } }))); // plugin hook logs are tolerated
    const removed = await kit.runEval(ID, (ws) => { run()(ws); ws.remove('services/web/package.json'); });
    kit.expectFails(removed, 'no-stray-writes', /removed/, { only: true });
  });

  test('noForbiddenCommand: network, host-CLI and git-mutating commands fail; harmless git and shell commands pass', async () => {
    const withCommands = (commands) => kit.runEval(ID, (ws) => { run()(ws); return { commands }; });
    for (const bad of ['curl -s https://northwind.atlassian.net/rest/api/3/myself', 'gh api user', 'git add .assessment/external-systems.yaml', 'git commit -m config', 'jira projects list', 'cd x && linearis teams list', 'node packages/development/lib/toolchain-cli.js run host.auth-status --json']) {
      kit.expectFails(await withCommands([bad]), 'noForbiddenCommand', /forbidden/, { only: true });
    }
    kit.expectAllPass(await withCommands(['git status --short -- .assessment', 'git check-ignore .assessment/secrets.env', 'mkdir -p .assessment', 'grep -ri jira docs']));
  });

  test('arms: plain invocation, baseline loads nothing, with-skill loads packages/assessment, same prompt', async () => {
    const ev = kit.loadsClean(ID);
    expect(ev.invocation).toBe('plain');
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/assessment$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
