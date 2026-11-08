'use strict';

/**
 * TRD-027: `MODE=gate` in the pr-review-cycle skill, and pr-merge's binding to it.
 *
 * The behaviour is prose -- the skill's Step 10 and the pr-merge command YAML --
 * so its Implementation AC is checked by parsing those files. Every contract the
 * prose asserts about the classifier, the second assessment, the security lane
 * and the gate result is ALSO checked against the real modules
 * (`pr-review-tier.js`, `pr-review-approvals.js`, `pr-review-gate.js`), so the
 * prompt a maintainer edits and the code that grades its answer can never drift
 * into disagreeing about what a kind, a raise or a blocker means.
 *
 * The PRD scenarios for REQ-012/013/014/017/008 belong to TRD-027-TEST; this
 * file covers only what TRD-027 owns:
 *
 *   - MODE=gate classifies change kinds, runs the second assessment, runs the
 *     security lane, reads approvals and reviews from `gh`, and returns the
 *     `evaluateGate` output -- and callers reference the skill, never the CLI;
 *   - pr-merge requires `mergeable:true` from the gate on top of its existing
 *     checks and reviewDecision conditions, re-reads GitHub state fresh, and
 *     never counts a self-report;
 *   - a repository without branch protection for the required approvals is told
 *     that server-side enforcement is absent, with the recommendation;
 *   - a failed `gh` read is retried once in the same run and then reported as
 *     `review-data-unavailable` with the recovery action;
 *   - the classifier and the second assessment are fresh-context subagents whose
 *     editable prompts return exactly the contract `assignTier` expects.
 */

const fs = require('fs');
const path = require('path');

const { assignTier, KINDS, TIERS } = require('../lib/pr-review-tier');
const { evaluateGate, BLOCKER_CODES, SECURITY_STATUSES, SECURITY_REQUIRED_TIERS } = require('../lib/pr-review-gate');
const { HANDLERS } = require('../lib/pr-review-cli');
const { readSkillBundle, readSkillReference } = require('./helpers/pr-review-cycle-skill');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SKILL_PATH = path.join(__dirname, '..', 'skills', 'pr-review-cycle', 'SKILL.md');
const SKILL_MAIN = fs.readFileSync(SKILL_PATH, 'utf8');
// SKILL.md plus the merge-gate companion it names; Safety rules stay in SKILL.md alone.
const SKILL = readSkillBundle();
const FLAT = SKILL.replace(/\s+/g, ' ');

const PR_MERGE_YAML = fs.readFileSync(path.join(REPO_ROOT, 'packages/git/commands/pr-merge.yaml'), 'utf8');
const PR_MERGE_FLAT = PR_MERGE_YAML.replace(/\s+/g, ' ');

/** Every shipped rendering of the pr-merge command: a stale one ships the old gate-less merge. */
const PR_MERGE_SURFACES = {
  'command (yaml)': 'packages/git/commands/pr-merge.yaml',
  'claude (md)': 'packages/git/commands/ensemble/pr-merge.md',
  'pi (prompt)': 'packages/pi/prompts/ensemble-pr-merge.md',
  'pi (skill)': 'packages/pi/skills/ensemble-pr-merge/SKILL.md',
  'codex (skill)': 'packages/codex/.codex/skills/commands/ensemble-pr-merge/SKILL.md',
};

const sectionIndex = (label) => {
  const at = SKILL.indexOf(label);
  expect([label, at > -1]).toEqual([label, true]);
  return at;
};

/** Step 10's own text, so a promise made elsewhere cannot satisfy a Step 10 check. */
const STEP_10 =
  SKILL_MAIN.slice(SKILL_MAIN.indexOf('### Step 10 -- Merge gate'), SKILL_MAIN.indexOf('## Safety rules')) +
  '\n' +
  readSkillReference('merge-gate.md');
const STEP_10_FLAT = STEP_10.replace(/\s+/g, ' ');
/** The same text with the blockquote markers of the editable prompts removed. */
const STEP_10_PROMPTS = STEP_10.split('\n').map((line) => line.replace(/^>\s?/, '')).join(' ').replace(/\s+/g, ' ');

describe('TRD-027: MODE=gate is a declared mode of this skill', () => {
  test('the inputs table offers gate beside local and remote, and says what it does', () => {
    expect(FLAT).toContain("`'local'` \\| `'remote'` \\| `'gate'`");
    expect(FLAT).toContain('`gate`: answer "may this PR merge?" for a caller about to merge (Step 10)');
    expect(FLAT).toContain('it runs no reviewer dispatch and fixes nothing');
  });

  test('the algorithm says which steps each mode runs, so gate cannot quietly skip guidance', () => {
    expect(FLAT).toContain('`MODE=gate` runs Steps 1, 1b and 10 -- and only those');
  });

  test('the gate-only inputs the step needs are declared', () => {
    for (const input of ['`PR_NUMBER`', '`DIRECTED_BY`', '`PROPOSED_TIER`', '`CODE_OWNER_DECISION`']) {
      expect([input, FLAT.includes(input)]).toEqual([input, true]);
    }
    expect(FLAT).toContain('counts as one of the required reviewers (AC-014-3)');
    expect(FLAT).toContain('it can only ever raise (AC-013-2)');
    expect(FLAT).toContain('only a code owner\'s decision can lower a tier');
  });
});

describe('TRD-027: the classifier is a fresh-context subagent returning the contract assignTier expects', () => {
  test('the prompt is in the skill, is editable there, and dispatches a fresh-context subagent', () => {
    expect(STEP_10_FLAT).toContain('Dispatch one **fresh-context** subagent');
    expect(STEP_10_FLAT).toContain('editable policy -- tune the wording here, never in the CLI');
    expect(STEP_10_FLAT).toContain('You are classifying a pull request\'s changes for risk, not reviewing them.');
    expect(STEP_10_FLAT).toContain('who wrote it, why, and what it was meant to do are not inputs');
  });

  test('the closed kind enum in the prompt is exactly the module\'s closed set', () => {
    const quoted = [...STEP_10.matchAll(/`(docs|copy|additive-behind-flag|product|other)`/g)].map((m) => m[1]);
    expect([...new Set(quoted)].sort()).toEqual([...KINDS].sort());
    expect(STEP_10_FLAT).toContain('"kinds": [{ "kind": "<one of the five>", "paths": ["<path>", ...] }]');
    expect(STEP_10_FLAT).toContain('Cite the paths that put each kind in your answer');
  });

  test('the skill defers the unknown-kind rule to the module, and the module really applies it', () => {
    expect(STEP_10_FLAT).toContain('A missing, unknown or uncited kind is read as `other`');
    expect(STEP_10_FLAT).toContain('the tier module -- not this prose -- makes that substitution');

    const invented = assignTier({ kinds: [{ kind: 'totally-made-up', paths: ['src/a.js'] }], paths: { sensitive: [], high: [] } });
    expect(invented.kinds.map((entry) => entry.kind)).toEqual(['other']);
    expect(invented.tier).toBe('medium');

    // A changed path no kind cited is not a free Low either.
    const uncited = assignTier({
      kinds: [{ kind: 'docs', paths: ['README.md'] }],
      paths: { paths: [{ path: 'README.md' }, { path: 'src/pay.js' }], sensitive: [], high: [] },
    });
    expect(uncited.uncitedPaths).toEqual(['src/pay.js']);
    expect(uncited.tier).toBe('medium');

    // And a classifier that cited nothing at all is Medium, never Low.
    expect(assignTier({ kinds: [], paths: { sensitive: [], high: [] } }).tier).toBe('medium');
  });

  test('a classifier that answers nothing usable is carried as unavailable, never invented', () => {
    expect(STEP_10_FLAT).toContain('carry it as `classifier` in `unavailable`');
    expect(STEP_10_FLAT).toContain('rather than inventing a kind');
  });
});

describe('TRD-027: the second assessment is its own fresh-context subagent with the needsAnotherPerson contract', () => {
  test('it is dispatched separately from the classifier and from the reviewers', () => {
    expect(STEP_10_FLAT).toContain('Dispatch a second **fresh-context** subagent -- not the classifier, and not a reviewer from an earlier step');
  });

  test('the prompt returns exactly { needsAnotherPerson, reason, evidencePaths }', () => {
    expect(STEP_10_PROMPTS).toContain('{ "needsAnotherPerson": true|false, "reason": "<one sentence>", "evidencePaths": ["<path>", ...] }');
    expect(STEP_10_FLAT).toContain('It returns exactly `{ needsAnotherPerson, reason, evidencePaths[] }`');
    expect(STEP_10_PROMPTS).toContain('Cite the paths your reason rests on');
  });

  test('the raise rule in the prose is the rule the module enforces, including the unreadable case', () => {
    expect(STEP_10_FLAT).toContain('Exactly `false` leaves the tier alone');
    expect(STEP_10_FLAT).toContain('exactly `true` raises it one level (AC-012-3)');
    expect(STEP_10_FLAT).toContain('any other value is read as `true`');

    const base = { kinds: [{ kind: 'product', paths: ['src/a.js'] }], paths: { sensitive: [], high: [] } };
    expect(assignTier({ ...base, secondAssessment: { needsAnotherPerson: false } }).tier).toBe('medium');
    expect(assignTier({ ...base, secondAssessment: { needsAnotherPerson: true, reason: 'subtle', evidencePaths: ['src/a.js'] } }).tier).toBe('high');
    // Not a boolean: the module fails toward more review, exactly as the prose says.
    expect(assignTier({ ...base, secondAssessment: { needsAnotherPerson: 'yes' } }).tier).toBe('high');
  });

  test('an assessment nobody gave is never typed in as "no": the prose says so and the module agrees', () => {
    expect(STEP_10_FLAT).toContain('**An assessment nobody gave is not a `false`.**');
    expect(STEP_10_FLAT).toContain('leave `secondAssessment` out of the `tier` payload');
    expect(STEP_10_FLAT).toContain('never write `{ "needsAnotherPerson": false }` yourself');
    expect(STEP_10_FLAT).toContain(
      'it raises nothing, so a Medium PR stays Medium, but the solo-maintainer discount is withheld and a High PR keeps two humans'
    );

    const base = { kinds: [{ kind: 'product', paths: ['src/a.js'] }], paths: { sensitive: [], high: [] } };
    for (const secondAssessment of [undefined, null]) {
      const result = assignTier({ ...base, secondAssessment });
      expect(result.tier).toBe('medium');
      expect(result.raised).toEqual([]);
      expect(result.peerDemanded).toBe(true);
    }
    expect(assignTier({ ...base, secondAssessment: { needsAnotherPerson: false } }).peerDemanded).toBe(false);
  });
});

describe('TRD-027: the security lane runs in gate mode and blocks what it should', () => {
  test('the lane is a fresh-context, read-only reviewer with an editable prompt', () => {
    expect(STEP_10_FLAT).toContain('Dispatch a **fresh-context, read-only** security reviewer');
    expect(STEP_10_FLAT).toContain('Review this diff for security defects only');
    expect(STEP_10_FLAT).toContain('Change nothing.');
  });

  test('the lane statuses named in the prose are exactly the statuses the gate reads', () => {
    for (const status of SECURITY_STATUSES) {
      expect([status, STEP_10_FLAT.includes(`\`${status}\``)]).toEqual([status, true]);
    }
    // The lane's findings are FULL ledger entries: a partial one is unreadable,
    // and the prose says so rather than letting the gate answer on half a record.
    expect(STEP_10_FLAT).toContain('Every entry in `findings` is a **full ledger entry**');
    expect(STEP_10_FLAT).toContain('(`id`, `source`, `locationOrLink`, `severity`, `failureMode`, `disposition`, `evidence`, `originalTextOrLink`)');
    expect(STEP_10_FLAT).toContain('the gate answers `review-data-unavailable` naming it rather than passing');

    const partial = evaluateGate({
      ledger: [],
      approvals: { ok: true, satisfied: true, tier: 'medium', humansRequired: 1, humansCounted: 1 },
      tier: { ok: true, effectiveTier: 'medium' },
      description: { ok: true, missing: [] },
      security: { status: 'findings', findings: [{ id: 'S0', locationOrLink: 'src/auth.js:1', severity: 'important' }] },
      headSha: 'a'.repeat(40),
    });
    expect(partial.mergeable).toBe(false);
    expect(partial.reasons).toContain(BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE);
  });

  test('the blocking promise is the module\'s behaviour, not a hope', () => {
    expect(STEP_10_FLAT).toContain('**An open security finding blocks the merge** until it is fixed');
    expect(STEP_10_FLAT).toContain('until it is fixed or the operator\'s own recorded decision closes it (`ledger` `resolve`, below)');
    expect(STEP_10_FLAT).toContain('a lane that did not run blocks Medium and High on its own');
    expect([...SECURITY_REQUIRED_TIERS].sort()).toEqual(['high', 'medium']);

    const openSecurity = evaluateGate({
      ledger: [],
      approvals: { ok: true, satisfied: true, tier: 'medium', humansRequired: 1, humansCounted: 1 },
      tier: { ok: true, effectiveTier: 'medium' },
      description: { ok: true, missing: [] },
      security: {
        status: 'findings',
        findings: [{
          id: 'S1',
          source: 'security-lane',
          locationOrLink: 'src/auth.js:12',
          severity: 'important',
          failureMode: 'authz gap',
          disposition: 'fix',
          evidence: 'the handler reads the record before checking the caller owns it',
          originalTextOrLink: 'security-lane-note-1',
        }],
      },
      headSha: 'a'.repeat(40),
    });
    expect(openSecurity.mergeable).toBe(false);
    expect(openSecurity.reasons).toContain(BLOCKER_CODES.SECURITY_FINDING_OPEN);

    const notRun = evaluateGate({
      ledger: [],
      approvals: { ok: true, satisfied: true, tier: 'medium', humansRequired: 1, humansCounted: 1 },
      tier: { ok: true, effectiveTier: 'medium' },
      description: { ok: true, missing: [] },
      security: { status: 'not-run', findings: [] },
      headSha: 'a'.repeat(40),
    });
    expect(notRun.mergeable).toBe(false);
    expect(notRun.reasons).toContain(BLOCKER_CODES.SECURITY_REVIEW_MISSING);
  });

  test('a lane that did not run is never reported clean, and a finding is never downgraded', () => {
    expect(STEP_10_FLAT).toContain('Never downgrade a security finding to make the gate pass');
    expect(STEP_10_FLAT).toContain('never report `clean` for a lane that did not run');
  });

  test('the lane is told to report and never close: the closure the instructions used to ask for is one the gate ignores', () => {
    // The brief used to ask the lane for `resolution: { reason }` on a finding "closed with a stated reason", and the prose
    // said a stated `resolution.reason` closed an open finding. The gate takes neither: a lane entry carrying that closure
    // is still open, so following those instructions produced blockers that do not count.
    const asked = {
      id: 'S1',
      source: 'security-lane',
      locationOrLink: 'src/auth.js:12',
      severity: 'important',
      failureMode: 'authz gap',
      disposition: 'resolved',
      evidence: 'the handler reads the record before checking the caller owns it',
      originalTextOrLink: 'security-lane-note-1',
      resolution: { reason: 'false positive' },
    };
    const verdict = evaluateGate({
      ledger: [],
      approvals: { ok: true, satisfied: true, tier: 'medium', humansRequired: 1, humansCounted: 1 },
      tier: { ok: true, effectiveTier: 'medium' },
      description: { ok: true, missing: [] },
      security: { status: 'findings', findings: [asked] },
      headSha: 'a'.repeat(40),
    });
    expect(verdict.mergeable).toBe(false);
    expect(verdict.securityLane.open).toEqual(['S1']);

    const lane = STEP_10_FLAT.slice(STEP_10_FLAT.indexOf('10c -- The security lane'), STEP_10_FLAT.indexOf('10d -- Read approvals'));
    expect(lane.length).toBeGreaterThan(500);
    expect(lane).not.toContain('resolution: { reason }');
    expect(lane).not.toContain('stated reason');
    expect(lane).not.toContain('stated `resolution.reason`');
    expect(lane).toContain('**The lane reports and never closes.**');
  });

  test('SKILL.md says the same in its Step 10c line and its Safety rules: only the operator\'s own answer closes a security finding', () => {
    const step10c = SKILL_MAIN.slice(SKILL_MAIN.indexOf('* 10c'), SKILL_MAIN.indexOf('* 10d')).replace(/\s+/g, ' ');
    expect(step10c).toContain('it reports, never closes');
    expect(step10c).toContain('the operator\'s own `ledger` `resolve` answer');

    const safety = SKILL_MAIN.slice(SKILL_MAIN.indexOf('## Safety rules')).replace(/\s+/g, ' ');
    expect(safety).toContain('An open security-lane finding blocks the merge until fixed or the operator records a decision (`ledger` `resolve`)');
    expect(safety).not.toContain('closed with a stated reason');
  });

  test('the prose names what the gate reads and answers: policy in, deferralRejected out', () => {
    expect(STEP_10_FLAT).toContain('`{ ledger, approvals, tier, description, security, coverage, headSha, policy, unavailable }`');
    expect(STEP_10_FLAT).toContain('its blocker carrying `deferralRejected`');
    expect(STEP_10_FLAT).toContain('given `policy`, `by` is not one of its `botLogins`');

    const base = {
      ledger: [],
      approvals: { ok: true, headSha: 'a'.repeat(40), satisfied: true, tier: 'medium', humansRequired: 1, humansCounted: 1 },
      tier: { ok: true, effectiveTier: 'medium' },
      description: { ok: true, missing: [] },
      security: { status: 'clean', findings: [] },
      coverage: { status: 'complete', gaps: [] },
      headSha: 'a'.repeat(40),
    };
    const finding = {
      id: 'F1',
      source: 'code-reviewer',
      locationOrLink: 'src/a.js:1',
      severity: 'important',
      failureMode: 'bug',
      disposition: 'deferred',
      evidence: 'e',
      originalTextOrLink: 'n',
      blocking: false,
      reason: 'opt-in component',
    };
    const deferred = evaluateGate({ ...base, ledger: [finding] });
    expect(deferred.mergeable).toBe(false);
    expect(deferred.blockers.find((entry) => entry.code === BLOCKER_CODES.OPEN_IMPORTANT_FINDING).deferralRejected).toEqual(expect.any(String));

    const byBot = { ...finding, disposition: 'resolved', resolution: { reason: 'ok', by: '@coderabbitai', at: '2026-11-06T10:00:00Z', headSha: base.headSha } };
    expect(evaluateGate({ ...base, ledger: [byBot] }).mergeable).toBe(true);
    expect(evaluateGate({ ...base, policy: { botLogins: ['@coderabbitai'] }, ledger: [byBot] }).mergeable).toBe(false);
  });
});

describe('TRD-027: gh reads happen in this run, are retried once, and never become a guess', () => {
  test('the reads that feed the gate are named', () => {
    expect(STEP_10_FLAT).toContain('the PR\'s reviews, latest reviews and `reviewDecision`, `author`, `headRefOid`, `mergeable` and `mergeStateStatus`');
    expect(STEP_10_FLAT).toContain('`GET /repos/{owner}/{repo}/branches/<base>/protection` on the host');
  });

  test('one retry, in the same run, with no waiting loop and no scheduling', () => {
    expect(STEP_10_FLAT).toContain('run **that one read again, once, immediately, in the same run**');
    expect(STEP_10_FLAT).toContain('No waiting loop, no backoff schedule, no background poll, no retry of a read that succeeded');
  });

  test('a read that fails twice becomes review-data-unavailable with the CLI\'s own recovery action', () => {
    expect(STEP_10_FLAT).toContain('name that read in `unavailable`');
    expect(STEP_10_FLAT).toContain('`review-data-unavailable`');

    const unavailable = evaluateGate({
      ledger: [],
      approvals: { ok: true, satisfied: true, tier: 'medium', humansRequired: 1, humansCounted: 1 },
      tier: { ok: true, effectiveTier: 'medium' },
      description: { ok: true, missing: [] },
      security: { status: 'clean', findings: [] },
      headSha: 'a'.repeat(40),
      unavailable: ['gh pr view reviews'],
    });
    expect(unavailable.mergeable).toBe(false);
    expect(unavailable.reasons).toContain(BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE);

    // The words the skill tells the author to report are the words the module returns.
    const recovery = unavailable.blockers.find((entry) => entry.code === BLOCKER_CODES.REVIEW_DATA_UNAVAILABLE).nextAction;
    expect(STEP_10_FLAT).toContain(recovery);
  });

  test('a self-report is never evidence in gate mode', () => {
    expect(STEP_10_FLAT).toContain('**Never a self-report.**');
    expect(STEP_10_FLAT).toContain('No claim by this session, a subagent, a commit message or the PR body');
    expect(STEP_10_FLAT).toContain('read fresh from the host in this run, or computed by `pr-review-cli.js` from such a read');

    const safety = SKILL_MAIN.slice(SKILL_MAIN.indexOf('## Safety rules')).replace(/\s+/g, ' ');
    expect(safety).toContain('A merge gate is never answered from a self-report');
    expect(safety).toContain('`mergeable:false` is never re-graded into a pass');
  });
});

describe('TRD-027: absent branch protection is reported and recommended, never enforced by ensemble', () => {
  test('the notice names what is missing and what to configure', () => {
    expect(STEP_10).toContain('SERVER-SIDE ENFORCEMENT ABSENT:');
    expect(STEP_10_FLAT).toContain('does not require the approvals this tier needs, so nothing outside this run prevents a merge without them');
    expect(STEP_10_FLAT).toContain('Recommended: require <n> approving review(s) on <base> in branch protection');
  });

  test('ensemble says plainly that it cannot enforce it, and never assumes protection it could not read', () => {
    expect(STEP_10_FLAT).toContain('Ensemble cannot enforce it');
    expect(STEP_10_FLAT).toContain('only the host\'s branch protection can stop someone else from merging anyway');
    expect(STEP_10_FLAT).toContain('A protection read that could not be made is reported as unknown -- never as present');
  });
});

describe('TRD-027: the step grades through the CLI and returns evaluateGate output', () => {
  test('it calls tier, then approvals, then gate -- each a registered subcommand', () => {
    const order = ['tier', 'approvals', 'gate'].map((name) => STEP_10.indexOf(`"$PR_REVIEW_CLI" ${name}`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));

    for (const subcommand of ['tier', 'approvals', 'gate']) {
      expect([subcommand, Object.prototype.hasOwnProperty.call(HANDLERS, subcommand)]).toEqual([subcommand, true]);
    }
  });

  test('the payload keys the prose documents are the keys those modules read', () => {
    expect(STEP_10_FLAT).toContain('{ kinds, paths, secondAssessment, proposedTier, proposedBy, policy, evidence, assignedBy, at }');
    expect(STEP_10_FLAT).toContain('{ reviews, headSha, headTreeSha, tier, policy, author, directedBy, agentAuthored }');
    expect(STEP_10_FLAT).toContain('{ ledger, approvals, tier, description, security, coverage, headSha, policy, unavailable }');
  });

  test('trees that vouch for an older commit are computed by the run, never taken from review text', () => {
    expect(STEP_10_FLAT).toContain('`git rev-parse <review commitSha>^{tree}`');
    expect(STEP_10_FLAT).toContain('never copied from the PR body, a review or a comment');
    expect(STEP_10_FLAT).toContain('A review without a `treeSha` is counted only when its `commitSha` is the head itself');
  });

  test('what it returns is the gate result verbatim, blockers and all', () => {
    expect(STEP_10_FLAT).toContain('The `gate` result verbatim: `mergeable`, `blockers[]`');
    expect(STEP_10_FLAT).toContain('`mergeable` is true only when there is no blocker at all');
    expect(STEP_10_FLAT).toContain('an open Important finding is named (AC-008-1)');
    expect(STEP_10_FLAT).toContain('Never summarise a blocker away, never re-grade a `mergeable:false` into a pass');

    // The module really refuses on an open Important finding, with its id named.
    const openImportant = evaluateGate({
      ledger: [{
        id: 'F7',
        source: 'reviewer-a',
        locationOrLink: 'src/pay.js:30',
        severity: 'important',
        failureMode: 'double charge',
        disposition: 'fix',
        evidence: 'retry path charges twice',
        originalTextOrLink: 'link',
      }],
      approvals: { ok: true, satisfied: true, tier: 'medium', humansRequired: 1, humansCounted: 1 },
      tier: { ok: true, effectiveTier: 'medium' },
      description: { ok: true, missing: [] },
      security: { status: 'clean', findings: [] },
      headSha: 'a'.repeat(40),
    });
    expect(openImportant.mergeable).toBe(false);
    expect(openImportant.blockers.some((entry) => entry.message.includes('F7'))).toBe(true);
    expect(TIERS).toContain(openImportant.tier);
  });

  test('callers reach the gate through the skill, never through the CLI', () => {
    expect(STEP_10_FLAT).toContain('`pr-merge` and every other command invoke `MODE=gate`; none of them runs `pr-review-cli.js` itself');

    // Naming the CLI in a prohibition is fine; INVOKING it from a command is not.
    const INVOCATION = /(node\s[^\n]*pr-review-cli|\$PR_REVIEW_CLI|pr-review-cli\.js\s+(scope|ledger|votes|depth|slices|tier|approvals|gate|status|policy))/;
    for (const [surface, relative] of Object.entries(PR_MERGE_SURFACES)) {
      const text = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
      expect([surface, INVOCATION.test(text)]).toEqual([surface, false]);
      // The skill, by name, is how the command reaches it.
      expect([surface, /pr-review-cycle/.test(text)]).toEqual([surface, true]);
    }

    // Negative control: the regex really does catch an invocation.
    expect(INVOCATION.test('node "$PR_REVIEW_CLI" gate')).toBe(true);
    expect(INVOCATION.test('Invoke the skill, never pr-review-cli.js directly.')).toBe(false);
  });
});

describe('TRD-027: pr-merge requires mergeable:true from the gate, on freshly read state', () => {
  test('the constraint makes the gate mandatory and additive to the existing checks', () => {
    expect(PR_MERGE_FLAT).toContain('NEVER merge until the pr-review-cycle skill, invoked with MODE=gate, returns mergeable:true for the CURRENT head');
    expect(PR_MERGE_FLAT).toContain('this command adds the local-ci-gate verdict and the human-reviewer condition on top of it and never substitutes them for it');
    // The pre-existing conditions are still there: the gate adds to them.
    expect(PR_MERGE_FLAT).toContain('NEVER merge without a verified passing local CI status bound to the exact head SHA');
  });

  test('the merge step requires the gate, the local CI verdict and the fresh review read', () => {
    expect(PR_MERGE_FLAT).toContain('Merge only when ALL hold on this head: the Review Merge Gate returned mergeable:true for the same HEAD_SHA this step is merging');
    expect(PR_MERGE_FLAT).toContain('and the fresh review read shows mergeable and no human CHANGES_REQUESTED. Any one alone is not enough.');
    expect(PR_MERGE_FLAT).toContain('if the head moved since, re-run the Review Merge Gate step against the new head and require mergeable:true again');
  });

  test('a self-report never stands in for the gate, and the gate is re-run per head', () => {
    expect(PR_MERGE_FLAT).toContain('Never accept a self-report in place of this gate');
    expect(PR_MERGE_FLAT).toContain('Re-run the gate against freshly read state immediately before merging, never reuse an earlier round\'s result');
    expect(PR_MERGE_FLAT).toContain("HEAD_SHA = <headBranch>'s live head from the host adapter, read now -- never a SHA carried over from an earlier round");
  });

  test('the shortcut that skips remediation does not skip the gate', () => {
    expect(PR_MERGE_FLAT).toContain('skipping remediation never skips the Review Merge Gate');
  });

  test('absent server-side enforcement is reported and recommended by the command too', () => {
    expect(PR_MERGE_FLAT).toContain('report that server-side enforcement is absent and recommend the branch-protection rule in the final report');
    expect(PR_MERGE_FLAT).toContain('Ensemble cannot enforce it');
    expect(PR_MERGE_FLAT).toContain('Never treat a missing or unreadable protection setting as if protection were present');
  });

  test('the machine-readable summary carries the gate verdict, so a run is auditable', () => {
    expect(PR_MERGE_FLAT).toContain('gate_mergeable (bool)');
    expect(PR_MERGE_FLAT).toContain('gate_blockers (array of blocker codes, empty when mergeable)');
    expect(PR_MERGE_FLAT).toContain('branch_protection_enforced (bool|null -- null when the protection read failed, never true by assumption)');
  });

  test('every shipped rendering of pr-merge carries the gate, not just the YAML source', () => {
    for (const [surface, relative] of Object.entries(PR_MERGE_SURFACES)) {
      const flat = fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8').replace(/\s+/g, ' ');
      for (const promise of [
        'MODE=gate',
        'mergeable:true',
        'Never accept a self-report in place of this gate',
      ]) {
        expect([surface, promise, flat.includes(promise)]).toEqual([surface, promise, true]);
      }
    }
  });
});
