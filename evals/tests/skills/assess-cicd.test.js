'use strict';

/** Kit test for the `assess-cicd` eval: a good report passes every check; each bad report fails the check it targets. */

const kit = require('../skill-eval-kit');

const ID = 'assess-cicd';
const REPORT = 'docs/assessment/cicd.md';

jest.setTimeout(60000); // each runEval builds a sandbox and spawns the check script 13 times

const GOOD = `# CI/CD Analysis

## Pipeline Discovery

| Platform | Config | Status |
|----------|--------|--------|
| GitHub Actions | .github/workflows/ci.yml | ✓ |
| GitLab CI | .gitlab-ci.yml | ✗ |
| Jenkins | Jenkinsfile | ✗ |
| Azure DevOps | azure-pipelines.yml | ✗ |

One workflow, triggered on every push to main and on pull requests (.github/workflows/ci.yml:3-6).

## Pipeline Stages

| Stage | Duration | Quality |
|-------|----------|---------|
| Build | not measured | Good: npm ci and npm run build (.github/workflows/ci.yml:12-19) |
| Test | not measured | Needs Improvement: runs npm test only, no lint (.github/workflows/ci.yml:21-27) |
| Deploy | not measured | Needs Improvement: staging then production, unattended (.github/workflows/ci.yml:29-49) |

## Deployment Strategy

Every push to main builds, tests and deploys to staging and then production with no manual step; the automation level is high but ungated. Servers are provisioned as code with Terraform in infra/main.tf:6.

| Stage | Strategy | Approval | Rollback |
|-------|----------|----------|----------|
| Dev | none | ✗ | ✗ |
| Staging | scripts/deploy.sh over ssh, docker restart | ✗ | ✗ |
| Prod | the same script right after staging | ✗ | ✗ |

## Strengths

1. Jobs are chained with needs, so nothing deploys unless build and test pass (.github/workflows/ci.yml:23).
2. Deploy keys come from GitHub secrets, not the repository (.github/workflows/ci.yml:36).
3. Staging and production hosts are declared in Terraform (infra/main.tf:6-12).

## Weaknesses

1. REGISTRY_PASSWORD is a hard-coded plaintext credential in the workflow env block (.github/workflows/ci.yml:10).
2. The deploy-prod job deploys to production automatically after staging, with no environment protection or manual approval (.github/workflows/ci.yml:41-49).
3. There is no rollback: the deploy script restarts the container with the new image and keeps no previous version (scripts/deploy.sh:7).

## Score: 2.8 / C- (a working build-test-deploy chain, undermined by a leaked credential, an ungated production deploy and no rollback)

## Recommendations

1. Remove the plaintext REGISTRY_PASSWORD (.github/workflows/ci.yml:10) and rotate it; use a repository secret.
2. Put production behind a protected environment with required reviewers and add a rollback step to scripts/deploy.sh.
`;

/** A stub agent that saves \`text\` as the report (and optionally other files). */
const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(REPORT, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};
const swap = (from, to) => { if (!GOOD.includes(from)) throw new Error(`test bug: ${from} not in GOOD`); return GOOD.replace(from, to); };

describe(`${ID} (kit)`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.fixtureDir).toBeTruthy();
    expect(ev.runtimes).toEqual(['claude']);
  });

  test('the fixture really holds the planted facts the checks read', async () => {
    let seen;
    await kit.runEval(ID, (ws) => {
      const ci = ws.read('.github/workflows/ci.yml').split('\n');
      seen = { secret: ci[9], prod: ci[40], envBlock: /environment:/.test(ws.read('.github/workflows/ci.yml')), rollback: /roll-?back/i.test(ws.read('scripts/deploy.sh')), tf: ws.exists('infra/main.tf') };
    });
    expect(seen.secret).toMatch(/REGISTRY_PASSWORD/);
    expect(seen.prod).toMatch(/deploy-prod:/);
    expect(seen).toMatchObject({ envBlock: false, rollback: false, tf: true });
  });

  test('a good report passes every check', async () => {
    const res = await kit.runEval(ID, saves(GOOD));
    expect(Object.keys(res)).toEqual(['report-saved', 'sections-complete', 'score-format', 'discovery-correct', 'stages-identified', 'deploy-table', 'plaintext-secret', 'prod-gate', 'rollback-gap', 'iac-identified', 'citations-real', 'weaknesses-recommendations', 'no-stray-writes']);
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails every report check, but not no-stray-writes', async () => {
    const res = await kit.runEval(ID, saves(null));
    const reportChecks = Object.keys(res).filter((k) => k !== 'no-stray-writes');
    kit.expectFails(res, reportChecks, /was not written/, { only: false });
    expect(res['no-stray-writes'].pass).toBe(true);
  });

  test('a stub of a report (too short) fails report-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves('# CI/CD Analysis\n\n## Score: 2.8 / C-\n')), 'report-saved', /only \d+ characters/);
  });

  test('a report with the wrong title fails report-saved only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD.replace('# CI/CD Analysis', '# Notes'))), 'report-saved', /title/, { only: true });
  });

  test('a missing section fails sections-complete; an out-of-order one too', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('## Strengths', '## Good things'))), ['sections-complete', 'weaknesses-recommendations'], /Strengths/);
    const reordered = GOOD.replace(/## Recommendations[\s\S]*$/, '').replace('## Strengths', '## Recommendations\n\n1. a\n2. b\n\n## Strengths');
    kit.expectFails(await kit.runEval(ID, saves(reordered)), 'sections-complete', /order|missing/);
  });

  test('a bare-letter score, a wrong letter and an out-of-range score fail score-format', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('## Score: 2.8 / C- (', '## Score: C- ('))), 'score-format', /not "<1\.0-5\.0> \/ <Letter>"/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('2.8 / C-', '2.8 / B'))), 'score-format', /scale gives C/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('2.8 / C-', '7 / A'))), 'score-format', /outside 1\.0-5\.0/, { only: true });
  });

  test('a discovery table that finds a CI system the repository does not have, or misses GitHub Actions, fails discovery-correct', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| Jenkins | Jenkinsfile | ✗ |', '| Jenkins | Jenkinsfile | ✓ |'))), 'discovery-correct', /Jenkins is marked found/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| GitHub Actions | .github/workflows/ci.yml | ✓ |', '| GitHub Actions | .github/workflows/ci.yml | ✗ |'))), 'discovery-correct', /GitHub Actions is marked not found/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| Azure DevOps | azure-pipelines.yml | ✗ |\n', ''))), 'discovery-correct', /Azure DevOps has no row/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| GitLab CI | .gitlab-ci.yml | ✗ |', '| GitLab CI | .gitlab-ci.yml | ✓/✗ |'))), 'discovery-correct', /neither/, { only: true });
  });

  test('a Stages table without a Test row, no test command, or no triggers fails stages-identified', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| Test | not measured | Needs Improvement: runs npm test only, no lint (.github/workflows/ci.yml:21-27) |\n', ''))), 'stages-identified', /Test/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('runs npm test only', 'runs the suite only'))), 'stages-identified', /test command/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('triggered on every push to main and on pull requests', 'run by an unnamed event'))), 'stages-identified', /triggers/, { only: true });
  });

  test('a Deployment table that gives production an approval or a rollback fails deploy-table', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('| Prod | the same script right after staging | ✗ | ✗ |', '| Prod | the same script right after staging | ✓ | ✗ |'))), 'deploy-table', /Prod Approval/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| Prod | the same script right after staging | ✗ | ✗ |', '| Prod | the same script right after staging | ✗ | ✓ |'))), 'deploy-table', /Prod Rollback/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| Prod | the same script right after staging | ✗ | ✗ |\n', ''))), 'deploy-table', /no row for: Prod/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('| Stage | Strategy | Approval | Rollback |', '| Stage | Strategy | Gate |'))), 'deploy-table', /Approval and Rollback columns/, { only: true });
  });

  test('a report that misses the plaintext credential, or cites it without saying what is wrong, fails plaintext-secret', async () => {
    const gone = swap('1. REGISTRY_PASSWORD is a hard-coded plaintext credential in the workflow env block (.github/workflows/ci.yml:10).', '1. The workflow has a registry setting (.github/workflows/ci.yml:8).').replace('Remove the plaintext REGISTRY_PASSWORD (.github/workflows/ci.yml:10) and rotate it; use a repository secret.', 'Rotate things.');
    kit.expectFails(await kit.runEval(ID, saves(gone)), 'plaintext-secret', /no citation of/, { only: true });
    const vague = swap('REGISTRY_PASSWORD is a hard-coded plaintext credential in the workflow env block (.github/workflows/ci.yml:10).', 'REGISTRY_PASSWORD is set in the workflow env block (.github/workflows/ci.yml:10).').replace('Remove the plaintext REGISTRY_PASSWORD (.github/workflows/ci.yml:10) and rotate it; use a repository secret.', 'Review REGISTRY_PASSWORD (.github/workflows/ci.yml:10).');
    kit.expectFails(await kit.runEval(ID, saves(vague)), 'plaintext-secret', /does not say/, { only: true });
  });

  test('a report that does not cite the production job as ungated fails prod-gate', async () => {
    const uncited = swap('2. The deploy-prod job deploys to production automatically after staging, with no environment protection or manual approval (.github/workflows/ci.yml:41-49).', '2. Production is deployed from the same pipeline.').replace('(.github/workflows/ci.yml:29-49)', '(.github/workflows/ci.yml:29)');
    kit.expectFails(await kit.runEval(ID, saves(uncited)), 'prod-gate', /no citation of the deploy-prod/, { only: true });
    const vague = swap('2. The deploy-prod job deploys to production automatically after staging, with no environment protection or manual approval (.github/workflows/ci.yml:41-49).', '2. The deploy-prod job is long (.github/workflows/ci.yml:41-49).').replace('(.github/workflows/ci.yml:29-49)', '(.github/workflows/ci.yml:29)').replace('with no manual step; the automation level is high but ungated', 'quickly').replace('the same script right after staging', 'the same script').replace('put production behind a protected environment with required reviewers and ', '').replace('Put production behind a protected environment with required reviewers and add', 'Add');
    kit.expectFails(await kit.runEval(ID, saves(vague)), 'prod-gate', /not described/, { only: true });
  });

  test('a report that never mentions rollback fails rollback-gap', async () => {
    const res = await kit.runEval(ID, saves(swap('3. There is no rollback: the deploy script restarts the container with the new image and keeps no previous version (scripts/deploy.sh:7).', '3. The deploy script restarts the container (scripts/deploy.sh:7).').replace(' and add a rollback step to scripts/deploy.sh', '')));
    kit.expectFails(res, 'rollback-gap', /mentions rollback/, { only: true });
  });

  test('a report that omits the Terraform fails iac-identified', async () => {
    const none = await kit.runEval(ID, saves(swap(' Servers are provisioned as code with Terraform in infra/main.tf:6.', '')));
    kit.expectFails(none, 'iac-identified', /does not mention Terraform/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('with Terraform in infra/main.tf:6.', 'with Terraform.'))), 'iac-identified', /infra\/main\.tf/, { only: true });
  });

  test('a rollback mentioned only as something that exists fails rollback-gap', async () => {
    const res = await kit.runEval(ID, saves(swap('3. There is no rollback: the deploy script restarts the container with the new image and keeps no previous version (scripts/deploy.sh:7).', '3. Rollback happens by image tag (scripts/deploy.sh:7).').replace(' and add a rollback step to scripts/deploy.sh', ' and tidy scripts/deploy.sh. Rollback is by image tag')));
    kit.expectFails(res, 'rollback-gap', /not as a gap/, { only: true });
  });

  test('citations that all point at one file fail citations-real', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/infra\/main\.tf:6(?:-12)?/g, 'infra/main.tf').replace('scripts/deploy.sh:7', '.github/workflows/ci.yml:7')));
    kit.expectFails(res, 'citations-real', /only 1 distinct file/, { only: true });
  });

  test('a citation of an invented file, or of a line past the end, fails citations-real', async () => {
    kit.expectFails(await kit.runEval(ID, saves(swap('(scripts/deploy.sh:7)', '(scripts/release.sh:7)'))), 'citations-real', /not in the repository/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('(scripts/deploy.sh:7)', '(scripts/deploy.sh:700)'))), 'citations-real', /has \d+ lines/, { only: true });
  });

  test('a report with no file:line citations fails citations-real, weaknesses-recommendations and the cited-finding checks', async () => {
    const res = await kit.runEval(ID, saves(GOOD.replace(/(\.(?:yml|sh|tf)):\d+(?:-\d+)?/g, '$1')));
    kit.expectFails(res, ['citations-real', 'weaknesses-recommendations', 'plaintext-secret', 'prod-gate'], undefined, { only: true });
    kit.expectFails(res, 'citations-real', /only 0 file:line/);
  });

  test('too few Weaknesses or Recommendations, or no Strengths, fails weaknesses-recommendations', async () => {
    const few = swap('2. The deploy-prod job deploys to production automatically after staging, with no environment protection or manual approval (.github/workflows/ci.yml:41-49).\n3. There is no rollback: the deploy script restarts the container with the new image and keeps no previous version (scripts/deploy.sh:7).\n', '');
    kit.expectFails(await kit.runEval(ID, saves(few)), 'weaknesses-recommendations', /1 numbered/);
    kit.expectFails(await kit.runEval(ID, saves(swap('2. Put production behind a protected environment with required reviewers and add a rollback step to scripts/deploy.sh.\n', ''))), 'weaknesses-recommendations', /Recommendations has 1/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(swap('1. Jobs are chained with needs, so nothing deploys unless build and test pass (.github/workflows/ci.yml:23).\n2. Deploy keys come from GitHub secrets, not the repository (.github/workflows/ci.yml:36).\n3. Staging and production hosts are declared in Terraform (infra/main.tf:6-12).\n', ''))), 'weaknesses-recommendations', /Strengths has no/, { only: true });
  });

  test('an unfilled template placeholder is not counted as an item', async () => {
    const tpl = GOOD.replace(/## Recommendations[\s\S]*$/, '## Recommendations\n\n1. [Priority recommendation]\n2. [Secondary recommendation]\n');
    kit.expectFails(await kit.runEval(ID, saves(tpl)), 'weaknesses-recommendations', /Recommendations has 0/);
  });

  test('a stray source file, a modified fixture file and a removed one fail no-stray-writes', async () => {
    kit.expectFails(await kit.runEval(ID, saves(GOOD, { 'src/fix.js': 'x\n' })), 'no-stray-writes', /src\/fix\.js/, { only: true });
    const edited = await kit.runEval(ID, (ws) => { ws.write(REPORT, GOOD); ws.write('scripts/deploy.sh', `${ws.read('scripts/deploy.sh')}# rollback\n`); });
    kit.expectFails(edited, 'no-stray-writes', /modified/, { only: true });
    const removed = await kit.runEval(ID, (ws) => { ws.write(REPORT, GOOD); ws.remove('infra/main.tf'); });
    kit.expectFails(removed, 'no-stray-writes', /removed/);
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
