'use strict';

/**
 * TRD-012-TEST: complete-beads closure gating for
 * packages/development/skills/complete-beads/SKILL.md.
 *
 * These are structural assertions over the prose skill file -- there is no
 * runtime harness for a skill, so the Test AC is verified by reading the
 * markdown the way a maintainer or another skill would. They assert ORDER and
 * TERMINAL conditions (what must be recorded before a closure is granted,
 * which step runs before which, what a blocked gate returns), never verbatim
 * sentences: rewording the prose cannot break them, and a fail-open
 * regression cannot hide behind unchanged wording. Whitespace is flattened so
 * a re-wrap of the prose never matters.
 *
 * The recurring property is fail-closed gating: a closure is granted only by
 * a recorded LOCAL_REVIEW_COMPLETE, never by the absence of a bad value.
 *
 * The R3-P3-F1 block at the end goes one step further for the Freshness rule: it reads the per-PR tip commands out of
 * the skill's Freshness table and runs the documented decision (valid record -> no review, anything else -> a fresh
 * review of THAT PR only) over stacked and single-PR scenarios, so changing which tip a PR is compared with changes
 * what the scenarios decide. Every property there also runs against in-memory mutants of the skill (negative controls),
 * so none of them is a check that cannot fail. The file needs nothing but fs/path: the mutation harness copies it,
 * with the skill, into a throwaway tree.
 */

const fs = require('fs');
const path = require('path');

const SKILL_PATH = path.join(__dirname, '..', 'skills', 'complete-beads', 'SKILL.md');
const CANONICAL_SKILL_PATH =
  '"$(git rev-parse --show-toplevel 2>/dev/null)/packages/development/skills/pr-review-cycle/SKILL.md"';

// The verb that grants a closure: close / closes / closing. Not 'closure', 'closed' or 'fail-closed'.
const CLOSES = /\bclos(?:e|es|ing)\b/i;

describe('complete-beads SKILL.md (TRD-012)', () => {
  const text = fs.readFileSync(SKILL_PATH, 'utf8');
  const flatten = (s) => s.replace(/\s+/g, ' ').trim();

  // The text from one marker up to the next (or to the end of the file), in document order.
  function between(start, end) {
    const from = text.indexOf(start);
    expect(from).toBeGreaterThan(-1);
    const to = end === undefined ? text.length : text.indexOf(end, from + start.length);
    expect(to).toBeGreaterThan(from);
    return text.slice(from, to);
  }
  const checkpointLoop = () => between('### Checkpoint Loop', '### RecoverResume');
  const processResults = () => between('### ProcessResults(results)', '## Result Sentinel');
  const resultSentinel = () => between('## Result Sentinel', '## PR Boundary Behavior');
  const prBoundary = () => between('## PR Boundary Behavior', '## Isolation Invariants');
  const haltConditions = () => between('## HALT Conditions');

  // ProcessResults' numbered steps, each on one line: { '1': '...', ..., '8': '...' }.
  const numberedSteps = (block) => {
    const steps = {};
    block.split('\n').forEach((line) => {
      const m = line.match(/^(\d+)\. (.*)$/);
      if (m) steps[m[1]] = flatten(m[2]);
    });
    return steps;
  };
  const sentencesOf = (s) => flatten(s).split(/(?<=[.;])\s+/);
  // A bullet of the PR Boundary Behavior list, by its bold label.
  const bulletOf = (label) => {
    const line = prBoundary()
      .split('\n')
      .find((l) => l.startsWith(`- **${label}**`));
    expect(line).toBeDefined();
    return flatten(line);
  };
  // A status bullet of the Result Sentinel list (`complete` / `blocked` / `failed`).
  const statusBullet = (name) => {
    const line = resultSentinel()
      .split('\n')
      .map(flatten)
      .find((l) => l.startsWith(`- \`${name}\`:`));
    expect(line).toBeDefined();
    return line;
  };

  test('reuses the shared pr-review-cycle skill by the canonical repo-root path (no duplicated review logic)', () => {
    const block = prBoundary();

    expect(block).toContain(CANONICAL_SKILL_PATH);
    expect(block).toContain("MODE='local'");
    // complete-beads is non-interactive by construction: it never enters the
    // 10-minute interactive wait pr-review-cycle offers to non-Foreman callers.
    expect(block).toContain('FOREMAN=true');
    // Grading is computed by the shared skill, never re-implemented here.
    expect(text).not.toMatch(/pr-review-cli\.js/);
  });

  test('Scenario: result carries ledger and local status -- local_review is derived from localPhase, COMPLETE only on an exact match', () => {
    const block = flatten(prBoundary());

    expect(block).toMatch(/\{status, localPhase, ledger, reportPath\}/);
    // The derivation is a positive match on COMPLETE first; every other outcome is the BLOCKED complement.
    const completeAt = block.indexOf("localPhase == 'LOCAL_REVIEW_COMPLETE'");
    const blockedAt = block.indexOf('local_review = LOCAL_REVIEW_BLOCKED');
    expect(completeAt).toBeGreaterThan(-1);
    expect(blockedAt).toBeGreaterThan(completeAt);
    // The non-COMPLETE outcomes named after that complement (PENDING, a missing result, ...) all map to it.
    expect(block.indexOf('LOCAL_REVIEW_PENDING')).toBeGreaterThan(blockedAt);
    // No branch compares localPhase with a bad literal.
    const compared = [...text.matchAll(/\blocalPhase\s*==\s*'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(compared.length).toBeGreaterThan(0);
    compared.forEach((literal) => expect(literal).toBe('LOCAL_REVIEW_COMPLETE'));
  });

  test('Scenario: COMPLETE_BEADS_RESULT gains per-PR local_review and remote_review fields', () => {
    const block = resultSentinel();

    expect(block).toMatch(/local_review=<pr-id-1>:LOCAL_REVIEW_COMPLETE/);
    expect(block).toMatch(/remote_review=<pr-id-1>:REMOTE_REVIEW_PENDING/);
  });

  test('Scenario: roll-up needs local review complete -- a PR-owning story rolls up only on a recorded COMPLETE, a story with no PR is ungated', () => {
    const step6 = numberedSteps(processResults())['6'];
    const sentences = sentencesOf(step6);

    // A PR-owning story's roll-up requires a recorded COMPLETE ...
    const requirement = sentences.find((s) => /owns a PR/.test(s));
    expect(requirement).toBeDefined();
    expect(requirement).toMatch(/\brequires\b[^.]*`local_review == LOCAL_REVIEW_COMPLETE`/);
    // ... while a story that owns no PR is not subject to the gate at all.
    const carveOut = sentences.find((s) => /owns no PR/.test(s));
    expect(carveOut).toBeDefined();
    expect(sentences.indexOf(carveOut)).toBeGreaterThan(sentences.indexOf(requirement));
    expect(carveOut).not.toMatch(/LOCAL_REVIEW_/);
  });

  test('Scenario: blocking finding keeps the epic open -- a blocking local finding on any owned PR prevents epic closure', () => {
    const step7 = numberedSteps(processResults())['7'];
    const grants = sentencesOf(step7).filter((s) => CLOSES.test(s));

    expect(grants.length).toBeGreaterThan(0);
    grants.forEach((sentence) => {
      // Fail-closed: every sentence that grants the epic's closure is conditioned on a recorded COMPLETE ...
      expect(sentence).toContain('LOCAL_REVIEW_COMPLETE');
      // ... and none is conditioned on the absence of a bad value (`close ... UNLESS ... BLOCKED`, the fail-open shape).
      expect(sentence).not.toMatch(/\bunless\b/i);
    });
  });

  test('Scenario: an epic with no recorded local_review does not close -- the completion review runs first, and the close follows its COMPLETE', () => {
    const step7 = numberedSteps(processResults())['7'];
    const reviewSentence = sentencesOf(step7).find((s) => /Quality Gate Review/.test(s));

    expect(reviewSentence).toBeDefined();
    // Every mention of the review precedes the close verb: the review runs before the close it gates ...
    const reviewAt = reviewSentence.lastIndexOf('Quality Gate Review');
    const closeAt = reviewSentence.search(CLOSES);
    expect(closeAt).toBeGreaterThan(reviewAt);
    expect(reviewSentence).toContain('completion');
    // ... and that close is conditioned on the review's COMPLETE result.
    expect(reviewSentence.indexOf('LOCAL_REVIEW_COMPLETE', closeAt)).toBeGreaterThan(closeAt);

    // The loop agrees: when a scope drains, the rollup (which runs that review) precedes the RETURN of complete.
    const loop = flatten(checkpointLoop());
    expect(loop.indexOf('Quality Gate Review')).toBeGreaterThan(-1);
    expect(loop.indexOf('Quality Gate Review')).toBeLessThan(loop.indexOf('RETURN {status:complete'));
  });

  test('Scenario: remote pending does not block the epic -- complete-beads never produces a remote verdict, so closure cannot depend on one', () => {
    // The only remote value complete-beads ever records is PENDING, unconditionally ...
    expect(text).not.toMatch(/REMOTE_REVIEW_(?:COMPLETE|BLOCKED)/);
    expect(flatten(prBoundary())).toContain('remote_review = REMOTE_REVIEW_PENDING');

    // ... and a closure sentence that mentions remote_review is still conditioned on the LOCAL result.
    const step7 = numberedSteps(processResults())['7'];
    const mentionsRemote = sentencesOf(step7).filter((s) => /remote_review/.test(s));
    expect(mentionsRemote.length).toBeGreaterThan(0);
    mentionsRemote.forEach((sentence) => {
      expect(sentence).toMatch(CLOSES);
      expect(sentence).toContain('LOCAL_REVIEW_COMPLETE');
    });
  });

  test('Scenario: integration is not held for the remote service -- steps 1-5 integrate unconditionally, independent of local or remote review', () => {
    const steps = numberedSteps(processResults());

    // Integration (cherry-pick) precedes the review-gated steps 6 and 7.
    expect(steps['2']).toContain('git cherry-pick');
    // Steps 1-5 never consult a review ...
    ['1', '2', '3', '4', '5'].forEach((n) => {
      expect(steps[n]).not.toMatch(/local_review|remote_review|LOCAL_REVIEW|REMOTE_REVIEW|Quality Gate Review/);
    });
    // ... only the closure steps that follow do.
    ['6', '7'].forEach((n) => expect(steps[n]).toContain('LOCAL_REVIEW_COMPLETE'));
  });

  test('Scenario: Raw mode has no PR to gate -- local_review/remote_review stay empty and no review runs', () => {
    const block = prBoundary();
    const raw = bulletOf('Raw mode');

    // The review only ever runs for an action with createPr=true, and Raw mode has no PR_ACTIONS to supply one.
    expect(block.indexOf('createPr=true')).toBeGreaterThan(-1);
    expect(block.indexOf('createPr=true')).toBeLessThan(block.indexOf('Quality Gate Review'));
    expect(raw).toContain('no `PR_ACTIONS`');
    // Raw mode proposes nothing, appends nothing and records no review.
    expect(raw).not.toMatch(/git town|propose|append|local_review ==/);
    // The result leaves both review fields empty there.
    const sentinelRaw = resultSentinel()
      .split('\n')
      .map(flatten)
      .find((l) => /Raw mode/.test(l));
    expect(sentinelRaw).toBeDefined();
    expect(sentinelRaw).toContain('local_review');
    expect(sentinelRaw).toContain('remote_review');
  });

  test('the Quality Gate Review precedes propose/append in both stacked and single-PR modes', () => {
    const stacked = bulletOf('Stacked mode');
    const single = bulletOf('Single-PR mode');

    [stacked, single].forEach((bullet) => {
      const reviewAt = bullet.indexOf('Quality Gate Review');
      expect(reviewAt).toBeGreaterThan(-1);
      expect(bullet.indexOf('git town propose')).toBeGreaterThan(reviewAt);
    });
    expect(stacked.indexOf('git town append')).toBeGreaterThan(stacked.indexOf('git town propose'));
  });

  test('Scenario: a blocked stacked phase stops dispatch -- any non-COMPLETE phase gate returns blocked at once and no later phase is planned or dispatched', () => {
    const stacked = bulletOf('Stacked mode');
    const blockedFrom = stacked.indexOf('LOCAL_REVIEW_BLOCKED');
    // The COMPLETE branch comes first; the rest of the bullet is the non-COMPLETE branch.
    expect(blockedFrom).toBeGreaterThan(stacked.indexOf('LOCAL_REVIEW_COMPLETE'));
    const proceeds = stacked.slice(0, blockedFrom);
    const blocked = stacked.slice(blockedFrom);

    // Only the COMPLETE branch publishes and stacks the next branch.
    expect(proceeds).toContain('git town propose');
    expect(proceeds).toContain('git town append');
    expect(blocked).not.toMatch(/git town (?:propose|append)/);
    // The non-COMPLETE branch ends the run: it returns blocked, ahead of any mention of planning or dispatch, and never continues.
    expect(blocked).toContain('status=blocked');
    expect(blocked).not.toMatch(/\bcontinue\b/i);
    const dispatchAt = blocked.search(/dispatch|plann/i);
    expect(dispatchAt === -1 || blocked.indexOf('status=blocked') < dispatchAt).toBe(true);
  });

  test('Scenario: the Checkpoint Loop returns blocked at a non-COMPLETE stacked gate, before the next planning cycle', () => {
    const lines = checkpointLoop().split('\n');
    const processAt = lines.findIndex((l) => /ProcessResults\(results\)/.test(l));
    const loopAt = lines.findIndex((l) => /^\s*9\.\s+Loop\b/.test(l));
    const rollupAt = lines.findIndex((l) => /\brollup\b/.test(l));

    expect(processAt).toBeGreaterThan(-1);
    expect(loopAt).toBeGreaterThan(processAt);
    // The gate's blocked RETURN is on the ProcessResults line, i.e. before step 9 loops back to planning.
    expect(lines[processAt]).toContain('status:blocked');
    // The rollup line returns blocked for a non-COMPLETE owned PR and complete only otherwise.
    expect(rollupAt).toBeGreaterThan(-1);
    expect(lines[rollupAt].indexOf('status:blocked')).toBeGreaterThan(-1);
    expect(lines[rollupAt].indexOf('status:complete')).toBeGreaterThan(lines[rollupAt].indexOf('status:blocked'));
  });

  test('a non-COMPLETE gate is distinct from a propose/append failure -- it returns blocked and is never reported as failed', () => {
    // The sentinel maps the review gate to `blocked`; `failed` is an execution failure that never names a review value.
    expect(statusBullet('blocked')).toContain('LOCAL_REVIEW_BLOCKED');
    expect(statusBullet('failed')).not.toMatch(/LOCAL_REVIEW|REMOTE_REVIEW/);

    // The halt list agrees: a propose/append failure returns `failed`, the stacked gate returns `blocked`.
    const halts = haltConditions()
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map(flatten);
    const firstStatusAfterArrow = (line) => (line.split('→')[1].match(/`(complete|blocked|failed)`/) || [])[1];
    const proposeFailure = halts.find((l) => /propose/.test(l));
    const gate = halts.find((l) => /LOCAL_REVIEW_COMPLETE/.test(l));

    expect(proposeFailure).toBeDefined();
    expect(gate).toBeDefined();
    expect(firstStatusAfterArrow(proposeFailure)).toBe('failed');
    expect(firstStatusAfterArrow(gate)).toBe('blocked');
  });

  describe('re-review freshness and base resolution (R2-P3-F1, R2-P3-F2)', () => {
    const freshness = () => flatten(between('**Freshness rule', '**BASE_SHA for the single-PR'));

    test('a recorded BLOCKED, a missing record, or a stale recorded head each trigger a FRESH review before the rollup decision', () => {
      // What makes a record stale is decided per PR by the scenarios below; this pins WHERE the fresh review sits:
      // before every rollup/closure decision, in the loop and in both ProcessResults roll-up steps.
      const step7 = numberedSteps(processResults())['7'];
      expect(step7).toMatch(/Apply the Freshness rule[^.]*BEFORE deciding/);
      expect(step7).toMatch(/recorded `LOCAL_REVIEW_BLOCKED`/);
      expect(step7).not.toMatch(/has not run yet/);
      expect(step7.indexOf('FRESH Quality Gate Review')).toBeLessThan(step7.search(/the epic may close only if/));
      const loop = flatten(checkpointLoop());
      expect(loop.indexOf('Freshness rule')).toBeGreaterThan(-1);
      expect(loop.indexOf('Freshness rule')).toBeLessThan(loop.indexOf('THEN rollup'));
      expect(loop.indexOf('THEN rollup')).toBeLessThan(loop.indexOf('RETURN {status:complete'));
      expect(numberedSteps(processResults())['6']).toMatch(/Freshness rule/);
      // The one rule block names the fresh review that every invalid record triggers.
      expect(freshness()).toMatch(/FRESH Quality Gate Review/);
    });

    test('a BLOCKED result never closes the epic: every closing sentence in step 7 is conditioned on COMPLETE', () => {
      const step7 = numberedSteps(processResults())['7'];
      sentencesOf(step7).filter((s) => CLOSES.test(s)).forEach((sentence) => {
        expect(sentence).toContain('LOCAL_REVIEW_COMPLETE');
        expect(sentence).not.toMatch(/\bunless\b/i);
      });
      expect(step7).toMatch(/anything else \(including `LOCAL_REVIEW_BLOCKED`\) leaves the epic open/);
      expect(flatten(haltConditions())).toMatch(/never close a story or the root epic on a stale or non-COMPLETE record/);
    });

    test('the single-PR completion action resolves BASE_SHA from the default branch, and an empty/unresolvable base is BLOCKED', () => {
      const base = flatten(between('**BASE_SHA for the single-PR', '---'));
      expect(base).toMatch(/carries no `parentBranch`/);
      expect(base).toContain('git merge-base HEAD <default-branch>');
      expect(base).toContain('git symbolic-ref --short refs/remotes/origin/HEAD');
      expect(base).toMatch(/falling back to `main`/);
      expect(base).toMatch(/empty or does not resolve to a commit, the review is `LOCAL_REVIEW_BLOCKED`/);
      expect(base).toMatch(/never a guessed base/);
      expect(flatten(prBoundary())).toMatch(/for the single-PR `completion` action, which has no `parentBranch`, see "BASE_SHA for the single-PR `completion` action"/);
      expect(flatten(haltConditions())).toMatch(/completion` base empty or unresolvable.*LOCAL_REVIEW_BLOCKED/);
    });
  });

  describe('freshness is bound per owned PR, never to the global HEAD (R3-P3-F1)', () => {
    // Every property is a pure function of a skill text. The SAME function judges the shipped file (it must report
    // nothing) and an in-memory mutant of it (it must report the defect), so no property here is a check that cannot fail.
    // The PR/branch scenarios run the decision the Freshness table documents; the table's tip commands are read FROM
    // the skill, so changing which tip a PR is compared with changes what the scenarios decide.
    const GOOD = 'LOCAL_REVIEW_COMPLETE';
    const BAD = 'LOCAL_REVIEW_BLOCKED';
    const FULL_HEX_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
    const sha = (hex) => hex.padEnd(40, '0');
    const FRESHNESS_FROM = '**Freshness rule';
    const FRESHNESS_TO = '**BASE_SHA for the single-PR';

    // The text of ANY skill text from one marker up to the next (or the end); a marker that is gone is itself a defect.
    const slice = (src, from, to) => {
      const start = src.indexOf(from);
      if (start < 0) throw new Error(`marker not found: ${from}`);
      const end = to === undefined ? src.length : src.indexOf(to, start + from.length);
      if (end < 0) throw new Error(`marker not found: ${to}`);
      return src.slice(start, end);
    };
    const guarded = (check) => (src) => {
      try {
        return check(src);
      } catch (error) {
        return [error.message];
      }
    };
    // The one occurrence of `anchor` (any run of whitespace in it matches any run in the text, so re-wrapping the prose
    // never breaks a mutant) replaced; zero or several occurrences is an error: a mutant that silently changed nothing proves nothing.
    const replaceOnce = (src, anchor, replacement) => {
      const pattern = new RegExp(
        anchor
          .split(/\s+/)
          .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
          .join('\\s+'),
        'g'
      );
      const found = [...src.matchAll(pattern)];
      if (found.length !== 1) throw new Error(`a mutation anchor must occur exactly once (found ${found.length}): ${anchor}`);
      return src.slice(0, found[0].index) + replacement + src.slice(found[0].index + found[0][0].length);
    };

    // ---- the Freshness table -> an executable model of the documented decision ----
    // One entry per owned-PR kind the table names: its first cell (which actions it binds) and the tip command of its last.
    const tableRows = (src) => {
      const rows = {};
      slice(src, FRESHNESS_FROM, FRESHNESS_TO)
        .split('\n')
        .filter((line) => line.trim().startsWith('|'))
        .forEach((row) => {
          const cells = row.split('|').slice(1, -1).map((cell) => cell.trim());
          const kind = ['phase-gate', 'completion'].find((k) => (cells[0] || '').includes(`\`${k}\``));
          const command = ((cells[2] || '').match(/`(git rev-parse [^`]+)`/) || [])[1];
          if (kind) rows[kind] = { binds: cells[0], command };
        });
      return rows;
    };
    const tipCommands = (src) => {
      const commands = {};
      Object.entries(tableRows(src)).forEach(([kind, row]) => {
        if (row.command) commands[kind] = row.command;
      });
      return commands;
    };
    // What one documented tip command reads in a repository of `git`. Only the two shapes the skill may use are understood.
    const readTip = (command, action, git) => {
      const refs = command.replace(/^git rev-parse\s+/, '').split(/\s+/).filter((arg) => !arg.startsWith('--'));
      const ref = (refs[0] || '').replace('<action.branch>', action.branch).replace(/\^\{commit\}$/, '').replace(/^refs\/heads\//, '');
      if (refs.length === 1 && ref === 'HEAD') return git.head;
      if (refs.length === 1 && ref === action.branch) return git.branches[action.branch];
      throw new Error(`unsupported tip command: ${command}`);
    };
    // Comments are append-only: the newest one naming the PR's branch is its record.
    const newestRecord = (action, comments) => [...comments].reverse().find((entry) => entry.branch === action.branch);
    // One Freshness pass over every owned PR, the fresh reviews it triggers (each only for its own PR), and whether every
    // owned PR may then close. A review of a branch that cannot be read can only be blocked: never a guessed head.
    const decide = (src, { actions, comments, git, outcome = {} }) => {
      const commands = tipCommands(src);
      const tipOf = (action) => {
        if (!commands[action.kind]) throw new Error(`the Freshness table binds no tip for a ${action.kind} PR`);
        return readTip(commands[action.kind], action, git);
      };
      const valid = (action, log) => {
        const found = newestRecord(action, log);
        const tip = tipOf(action);
        return Boolean(found) && found.value === GOOD && FULL_HEX_ID.test(String(found.head)) && tip !== undefined && found.head === tip;
      };
      const owned = actions.filter((action) => action.createPr === true);
      const log = [...comments];
      const stale = owned.filter((action) => !valid(action, log));
      stale.forEach((action) => {
        const tip = tipOf(action);
        log.push({ branch: action.branch, value: tip === undefined ? BAD : outcome[action.branch], head: tip });
      });
      return { reviewed: stale.map((action) => action.branch), closes: owned.every((action) => valid(action, log)) };
    };

    const stackedActions = (count) =>
      Array.from({ length: count }, (_, i) => ({
        kind: 'phase-gate',
        createPr: true,
        branch: `feature/trd-pr-${i + 1}`,
        parentBranch: i === 0 ? 'main' : `feature/trd-pr-${i}`,
        appendNextBranch: i + 1 < count ? `feature/trd-pr-${i + 2}` : null,
      }));
    const completionAction = (createPr) => ({ kind: 'completion', createPr, branch: createPr ? 'feature/trd' : null });
    const entry = (action, value, head) => ({ branch: action.branch, value, head });

    const [p1, p2, p3] = stackedActions(3);
    const tips = { [p1.branch]: sha('a1'), [p2.branch]: sha('b2'), [p3.branch]: sha('c3') };
    const stackedRun = [p1, p2, p3, completionAction(false)];
    const completeAtOwnTips = [p1, p2, p3].map((action) => entry(action, GOOD, tips[action.branch]));
    const single = completionAction(true);
    const singleTip = sha('e5');
    const alone = [p1];
    const aloneTip = tips[p1.branch];
    const aloneGit = { branches: { [p1.branch]: aloneTip }, head: aloneTip };
    const aloneFixed = { [p1.branch]: GOOD };

    const SCENARIOS = [
      // POSITIVE: phases 1..N-1 are recorded COMPLETE at their own tips and later phases advanced HEAD -- nothing is re-reviewed.
      ['stacked-positive', 'later phases advanced HEAD past every earlier phase tip', { actions: stackedRun, comments: completeAtOwnTips, git: { branches: tips, head: sha('d4') } }, { reviewed: [], closes: true }],
      ['stacked-positive', 'HEAD is the last phase tip, the earlier phases sit behind it', { actions: stackedRun, comments: completeAtOwnTips, git: { branches: tips, head: tips[p3.branch] } }, { reviewed: [], closes: true }],
      // POSITIVE + stale detection: a blocked phase whose branch the user fixed is re-reviewed ALONE and recovers.
      ['stale-recovery', 'a blocked phase the user fixed is re-reviewed alone and recovers', { actions: stackedRun, comments: [entry(p1, GOOD, tips[p1.branch]), entry(p2, BAD, tips[p2.branch]), entry(p3, GOOD, tips[p3.branch])], git: { branches: { ...tips, [p2.branch]: sha('b9') }, head: tips[p3.branch] }, outcome: { [p2.branch]: GOOD } }, { reviewed: [p2.branch], closes: true }],
      ['stale-recovery', 'the fixed phase that is still blocked keeps the epic open', { actions: stackedRun, comments: [entry(p1, GOOD, tips[p1.branch]), entry(p2, BAD, tips[p2.branch]), entry(p3, GOOD, tips[p3.branch])], git: { branches: { ...tips, [p2.branch]: sha('b9') }, head: tips[p3.branch] }, outcome: { [p2.branch]: BAD } }, { reviewed: [p2.branch], closes: false }],
      ['stale-recovery', 'a phase whose own branch moved after a COMPLETE review is re-reviewed alone', { actions: stackedRun, comments: completeAtOwnTips, git: { branches: { ...tips, [p1.branch]: sha('a9') }, head: tips[p3.branch] }, outcome: { [p1.branch]: GOOD } }, { reviewed: [p1.branch], closes: true }],
      ['stale-recovery', 'a moved phase whose fresh review is blocked keeps the epic open', { actions: stackedRun, comments: completeAtOwnTips, git: { branches: { ...tips, [p1.branch]: sha('a9') }, head: tips[p3.branch] }, outcome: { [p1.branch]: BAD } }, { reviewed: [p1.branch], closes: false }],
      // The single-PR completion PR is bound to HEAD, the tip of the one branch the run stays on.
      ['single-pr', 'a record at HEAD is valid', { actions: [single], comments: [entry(single, GOOD, singleTip)], git: { branches: { [single.branch]: singleTip }, head: singleTip } }, { reviewed: [], closes: true }],
      ['single-pr', 'HEAD advanced past the record: stale, re-reviewed, closes on COMPLETE', { actions: [single], comments: [entry(single, GOOD, singleTip)], git: { branches: { [single.branch]: sha('f6') }, head: sha('f6') }, outcome: { [single.branch]: GOOD } }, { reviewed: [single.branch], closes: true }],
      ['single-pr', 'HEAD advanced past the record: a blocked fresh review keeps the epic open', { actions: [single], comments: [entry(single, GOOD, singleTip)], git: { branches: { [single.branch]: sha('f6') }, head: sha('f6') }, outcome: { [single.branch]: BAD } }, { reviewed: [single.branch], closes: false }],
      // CATCH-ALL: only a record that is exactly COMPLETE, names the branch, carries a full head and equals the readable tip is valid.
      ['invalid-records', 'no record at all', { actions: alone, comments: [], git: aloneGit, outcome: aloneFixed }, { reviewed: [p1.branch], closes: true }],
      ['invalid-records', 'a recorded BLOCKED', { actions: alone, comments: [entry(p1, BAD, aloneTip)], git: aloneGit, outcome: aloneFixed }, { reviewed: [p1.branch], closes: true }],
      ['invalid-records', 'a recorded PENDING', { actions: alone, comments: [entry(p1, 'LOCAL_REVIEW_PENDING', aloneTip)], git: aloneGit, outcome: aloneFixed }, { reviewed: [p1.branch], closes: true }],
      ['invalid-records', 'a recorded value that is not a review word', { actions: alone, comments: [entry(p1, 'complete', aloneTip)], git: aloneGit, outcome: aloneFixed }, { reviewed: [p1.branch], closes: true }],
      ['invalid-records', 'a recorded value that is missing', { actions: alone, comments: [entry(p1, undefined, aloneTip)], git: aloneGit, outcome: aloneFixed }, { reviewed: [p1.branch], closes: true }],
      ['invalid-records', 'a record with no head', { actions: alone, comments: [entry(p1, GOOD, undefined)], git: aloneGit, outcome: aloneFixed }, { reviewed: [p1.branch], closes: true }],
      ['invalid-records', 'a record with an abbreviated head', { actions: alone, comments: [entry(p1, GOOD, aloneTip.slice(0, 7))], git: aloneGit, outcome: aloneFixed }, { reviewed: [p1.branch], closes: true }],
      ['invalid-records', 'a record that names only another branch', { actions: alone, comments: [entry(p2, GOOD, aloneTip)], git: aloneGit, outcome: aloneFixed }, { reviewed: [p1.branch], closes: true }],
      ['invalid-records', 'an older COMPLETE outvoted by a newer BLOCKED', { actions: alone, comments: [entry(p1, GOOD, aloneTip), entry(p1, BAD, aloneTip)], git: aloneGit, outcome: aloneFixed }, { reviewed: [p1.branch], closes: true }],
      ['invalid-records', 'a newer COMPLETE at the tip supersedes an older BLOCKED', { actions: alone, comments: [entry(p1, BAD, aloneTip), entry(p1, GOOD, aloneTip)], git: aloneGit, outcome: aloneFixed }, { reviewed: [], closes: true }],
      ['invalid-records', 'a branch that cannot be read can only be blocked, never guessed', { actions: alone, comments: [entry(p1, GOOD, aloneTip)], git: { branches: {}, head: aloneTip }, outcome: aloneFixed }, { reviewed: [p1.branch], closes: false }],
    ];
    const scenarioProblems = (group) => (src) =>
      SCENARIOS.filter(([id]) => id === group).flatMap(([, name, input, expected]) => {
        const got = decide(src, input);
        const same = got.reviewed.join() === expected.reviewed.join() && got.closes === expected.closes;
        return same ? [] : [`${name}: reviewed [${got.reviewed}] closes ${got.closes}, expected [${expected.reviewed}] closes ${expected.closes}`];
      });

    // ---- structural properties over the other places the rule is stated or used ----
    const bindingProblems = (src) => {
      const commands = tipCommands(src);
      const problems = ['phase-gate', 'completion'].filter((kind) => !commands[kind]).map((kind) => `no tip command for a ${kind} PR`);
      // The table binds only actions that own a PR (createPr=true): an action that owns none has nothing to gate.
      Object.entries(tableRows(src)).forEach(([kind, row]) => {
        if (!row.binds.includes('createPr=true')) problems.push(`the ${kind} row binds actions that own no PR`);
      });
      if (commands['phase-gate'] && !commands['phase-gate'].includes('<action.branch>')) problems.push('a stacked phase PR is not bound to its own branch');
      if (commands['phase-gate'] && /\bHEAD\b/.test(commands['phase-gate'])) problems.push('a stacked phase PR is bound to the checked-out HEAD');
      if (commands.completion && !/\bHEAD\b/.test(commands.completion)) problems.push('the single-PR completion PR is not bound to HEAD');
      return problems;
    };
    const conditionProblems = (src) => {
      const block = slice(src, FRESHNESS_FROM, FRESHNESS_TO);
      const items = block.split('\n').filter((line) => /^\d+\. /.test(line)).map(flatten);
      const problems = [];
      if (!items.some((item) => /exactly `LOCAL_REVIEW_COMPLETE`/.test(item))) problems.push('no condition requires exactly LOCAL_REVIEW_COMPLETE');
      if (!items.some((item) => /\bfull\b/.test(item) && /\bhead\b/.test(item))) problems.push('no condition requires a full head id');
      if (!items.some((item) => /\btip\b/.test(item) && /\bhead\b/.test(item) && /\bequals\b/.test(item))) problems.push('no condition compares the recorded head with the tip');
      if (!/\bNOT valid\b/.test(flatten(block))) problems.push('the list has no fail-closed complement');
      if (!/\bNEWEST\b/.test(block)) problems.push('the record is not the newest comment');
      return problems;
    };
    const recordProblems = (src) => {
      const section = flatten(slice(src, '## PR Boundary Behavior', '## Isolation Invariants'));
      const template = section.match(/Local review: <local_review> \| branch: <action\.branch> \| head: <([^>|]+)> \| remote: <remote_review> \| report: <reportPath>/);
      if (!template) return ['the recorded comment does not carry <local_review>, branch, head, remote and report in that order'];
      const problems = [];
      if (/HEAD_SHA/.test(template[1])) problems.push('the recorded head is the HEAD_SHA that was passed in, not the tip after the review');
      if (!/\bafter\b/.test(template[1])) problems.push('the recorded head is not read after the skill returns');
      return problems;
    };
    const scopeProblems = (src) => {
      const intro = flatten(slice(src, '## PR Boundary Behavior', '- **Stacked mode**'));
      const problems = [];
      if (!intro.includes('git merge-base <action.branch> <action.parentBranch>')) problems.push('BASE_SHA is not taken from the action\'s own branch');
      if (intro.includes('git merge-base HEAD <action.parentBranch>')) problems.push('BASE_SHA is still taken from the checked-out HEAD');
      if (!/`HEAD_SHA`=the tip of that action's own branch \(`git rev-parse refs\/heads\/<action\.branch>`/.test(intro)) problems.push('HEAD_SHA is not the tip of the action\'s own branch');
      if (!/checked out/.test(intro)) problems.push('the review does not run with the PR\'s own branch checked out');
      return problems;
    };
    // The binding lives in ONE place (the table). A sentence elsewhere that ties a recorded head to the current HEAD
    // re-introduces the global binding the table removed.
    const GLOBAL_BINDING = /(?:\bdiffer\w*|\bequals?\b|\bbound to\b|\bbinds?\b)[^.|]{0,80}\bcurrent\b[^.|]{0,40}`?HEAD`?/i;
    const restatedBindingProblems = (src) =>
      [
        ['Checkpoint Loop', slice(src, '### Checkpoint Loop', '### RecoverResume')],
        ['ProcessResults', slice(src, '### ProcessResults(results)', '## Result Sentinel')],
        ['PR Boundary Behavior', slice(src, '## PR Boundary Behavior', '## Isolation Invariants')],
        ['HALT Conditions', slice(src, '## HALT Conditions')],
      ]
        .filter(([, body]) => GLOBAL_BINDING.test(flatten(body)))
        .map(([name]) => `${name} binds a recorded head to the current HEAD`);
    const loopProblems = (src) => {
      const rollup = slice(src, '### Checkpoint Loop', '### RecoverResume').split('\n').find((line) => /\brollup\b/.test(line));
      if (!rollup) return ['the Checkpoint Loop has no rollup line'];
      const blockedAt = rollup.indexOf('status:blocked');
      const completeAt = rollup.indexOf('status:complete');
      if (blockedAt < 0 || completeAt < blockedAt) return ['the rollup line does not return blocked before complete'];
      const problems = [];
      // complete is the positive outcome: granted by everything being closed, never by falling through an `else`.
      const grant = rollup.slice(blockedAt, completeAt);
      if (/\belse\b/i.test(grant)) problems.push('complete is the else-branch of the rollup');
      if (!/\bclosed\b/.test(grant)) problems.push('complete is not conditioned on everything being closed');
      // blocked covers ANY story or epic the rollup left open, not only one a review kept open.
      if (/\bbecause\b/.test(rollup.slice(rollup.indexOf('rollup left'), blockedAt))) problems.push('blocked is limited to a review-caused open bead');
      return problems;
    };
    const reentryProblems = (src) => {
      const block = flatten(slice(src, '**Re-entry', FRESHNESS_FROM));
      const problems = [];
      if (!block.includes('git rev-parse --verify --quiet refs/heads/<appendNextBranch>')) problems.push('no probe says whether the next branch already exists');
      if (!block.includes('git town append') || !block.includes('git town propose')) problems.push('re-entry does not say what happens to propose and append');
      return problems;
    };
    const malformedInputProblems = (src) => {
      const halts = slice(src, '## HALT Conditions').split('\n').filter((line) => line.startsWith('- ')).map(flatten);
      const line = halts.find((halt) => /PR_ACTIONS/.test(halt));
      if (!line) return ['no HALT condition covers a malformed PR_ACTIONS'];
      return /→[^→]*`blocked`/.test(line) ? [] : ['a malformed PR_ACTIONS does not return blocked'];
    };
    // A PR whose own branch is gone cannot be re-reviewed: the verdict is BLOCKED (naming the branch), never a review of another branch.
    const missingBranchProblems = (src) => {
      const halts = slice(src, '## HALT Conditions').split('\n').filter((line) => line.startsWith('- ')).map(flatten);
      const line = halts.find((halt) => /\bmissing\b/.test(halt) && /\bbranch\b/.test(halt) && /fresh review/.test(halt));
      if (!line) return ['no HALT condition covers a PR whose own branch is gone'];
      return /→[^→]*`LOCAL_REVIEW_BLOCKED`/.test(line) ? [] : ['a PR whose own branch is gone is not BLOCKED'];
    };
    // A COMPLETE is only ever recorded WITH the tip it is bound to: a tip that cannot be read after the skill returned
    // is one of the BLOCKED outcomes, never a record without a head.
    const unreadableTipProblems = (src) => {
      const section = flatten(slice(src, '## PR Boundary Behavior', '- **Stacked mode**'));
      const from = section.indexOf('every other outcome is blocked');
      const to = section.indexOf('Record `remote_review', from);
      if (from < 0 || to < 0) return ['the quality-gate result does not list its BLOCKED outcomes'];
      return /\btip\b[^.]*\bcannot be read\b/.test(section.slice(from, to)) ? [] : ['a branch tip that cannot be read after the review is not among the BLOCKED outcomes'];
    };
    // ORDER inside each mode's gate: the Freshness check comes first (a valid record skips the review), then the review,
    // and only then publication.
    const gateOrderProblems = (src) => {
      const problems = [];
      [
        ['stacked', flatten(slice(src, '- **Stacked mode**', '- **Single-PR mode**'))],
        ['single-PR', flatten(slice(src, '- **Single-PR mode**', '- **Raw mode**'))],
      ].forEach(([mode, bullet]) => {
        const freshness = bullet.indexOf('Freshness rule');
        const review = bullet.indexOf('Quality Gate Review');
        const propose = bullet.indexOf('git town propose');
        if (freshness < 0 || review < 0 || propose < 0) problems.push(`${mode}: the gate does not name the Freshness rule, the review and propose`);
        else if (!(freshness < review && review < propose)) problems.push(`${mode}: the gate does not run Freshness, then the review, then propose`);
      });
      return problems;
    };
    // A story that already closed on a COMPLETE is not reopened by a later blocked review: the blocked PR keeps the epic open.
    const closedStoryProblems = (src) => {
      const rule = flatten(slice(src, FRESHNESS_FROM, FRESHNESS_TO));
      return /story that already closed[^.]*\bstays closed\b[^.]*root epic open/.test(rule) ? [] : ['a later blocked review of an already-closed story does not say that the story stays closed and the epic stays open'];
    };
    const projectWideProblems = (src) => {
      const step7 = flatten(slice(src, '### ProcessResults(results)', '## Result Sentinel').split('\n').find((line) => /^7\. /.test(line)));
      return /project-wide[^.]*\b(?:never|not)\b[^.]*\bstep 6\b/.test(step7) ? [] : ['project-wide mode is not stated to leave step 6 gating in force'];
    };

    const PROPERTIES = [
      ['tip-binding-table', bindingProblems],
      ['stacked-positive', scenarioProblems('stacked-positive')],
      ['stale-recovery', scenarioProblems('stale-recovery')],
      ['single-pr', scenarioProblems('single-pr')],
      ['invalid-records', scenarioProblems('invalid-records')],
      ['validity-conditions', conditionProblems],
      ['record-template', recordProblems],
      ['review-scope', scopeProblems],
      ['no-restated-global-binding', restatedBindingProblems],
      ['loop-complete-is-positive-only', loopProblems],
      ['reentry-skips-published', reentryProblems],
      ['malformed-pr-actions-blocked', malformedInputProblems],
      ['missing-branch-blocks', missingBranchProblems],
      ['closed-story-stays-closed', closedStoryProblems],
      ['gate-checks-freshness-before-review', gateOrderProblems],
      ['unreadable-tip-blocks', unreadableTipProblems],
      ['project-wide-keeps-step-6', projectWideProblems],
    ].map(([id, check]) => ({ id, check: guarded(check) }));

    test.each(PROPERTIES)('Scenario: $id holds on the shipped SKILL.md', ({ check }) => {
      expect(check(text)).toEqual([]);
    });

    test('the scenarios are not vacuous: positive controls reach complete, every invalid record is reviewed, the table is read from the skill', () => {
      const groups = (id) => SCENARIOS.filter(([group]) => group === id);
      // Every group has cases, and the positive controls expect to close with nothing re-reviewed.
      ['stacked-positive', 'stale-recovery', 'single-pr', 'invalid-records'].forEach((id) => expect(groups(id).length).toBeGreaterThan(0));
      groups('stacked-positive').forEach(([, , , expected]) => expect(expected).toEqual({ reviewed: [], closes: true }));
      expect(groups('stale-recovery').some(([, , , expected]) => expected.closes === true && expected.reviewed.length === 1)).toBe(true);
      expect(groups('stale-recovery').some(([, , , expected]) => expected.closes === false)).toBe(true);
      // The decision follows the table: both documented commands resolve, and they resolve different tips for a stacked PR.
      const commands = tipCommands(text);
      const git = { branches: tips, head: sha('d4') };
      expect(readTip(commands['phase-gate'], p1, git)).toBe(tips[p1.branch]);
      expect(readTip(commands.completion, single, { branches: {}, head: singleTip })).toBe(singleTip);
    });

    // Each mutant reverts or drops ONE guarantee in an in-memory copy of the shipped skill; the property that guards it must report.
    const MUTANTS = [
      ['binding stacked phases to the global HEAD', 'stacked-positive', (src) => replaceOnce(src, '`git rev-parse --verify --quiet refs/heads/<action.branch>^{commit}`', '`git rev-parse HEAD`')],
      ['binding stacked phases to the global HEAD', 'tip-binding-table', (src) => replaceOnce(src, '`git rev-parse --verify --quiet refs/heads/<action.branch>^{commit}`', '`git rev-parse HEAD`')],
      ['dropping the per-branch tip compare', 'stale-recovery', (src) => replaceOnce(src, '`git rev-parse --verify --quiet refs/heads/<action.branch>^{commit}`', '(not compared)')],
      ['dropping the per-branch tip compare', 'invalid-records', (src) => replaceOnce(src, '`git rev-parse --verify --quiet refs/heads/<action.branch>^{commit}`', '(not compared)')],
      ['binding the single-PR completion PR to a tip other than HEAD', 'single-pr', (src) => replaceOnce(src, '`git rev-parse HEAD` -- the one branch', '`git rev-parse HEAD~1` -- the one branch')],
      ['binding the single-PR completion PR to a branch tip instead of HEAD', 'tip-binding-table', (src) => replaceOnce(src, '`git rev-parse HEAD` -- the one branch', '`git rev-parse --verify --quiet refs/heads/<action.branch>^{commit}` -- the one branch')],
      ['binding actions that own no PR', 'tip-binding-table', (src) => replaceOnce(src, '| `completion` (single-PR, `createPr=true`)', '| `completion` (single-PR)')],
      ['dropping the tip/head equality condition', 'validity-conditions', (src) => replaceOnce(src, '4. the tip in the table above can be read and equals that `head`.', '4. the tip in the table above exists.')],
      ['dropping the exactly-COMPLETE condition', 'validity-conditions', (src) => replaceOnce(src, '2. its value is exactly `LOCAL_REVIEW_COMPLETE`;', '2. its value is not `LOCAL_REVIEW_BLOCKED`;')],
      ['dropping the fail-closed complement', 'validity-conditions', (src) => replaceOnce(src, 'Anything else is NOT valid:', 'Anything else is valid:')],
      ['dropping the branch from the recorded comment', 'record-template', (src) => replaceOnce(src, '<local_review> | branch: <action.branch> | head:', '<local_review> | head:')],
      ['recording the HEAD_SHA that was passed in instead of the post-review tip', 'record-template', (src) => replaceOnce(src, '<tip of that branch read after the skill returned>', '<HEAD_SHA reviewed>')],
      ['taking BASE_SHA from the checked-out HEAD', 'review-scope', (src) => replaceOnce(src, '`git merge-base <action.branch> <action.parentBranch>`', '`git merge-base HEAD <action.parentBranch>`')],
      ['restating the global HEAD binding in ProcessResults step 7', 'no-restated-global-binding', (src) => replaceOnce(src, "that is not the tip of that PR's own branch (a stacked phase PR is bound to its own phase branch, so a later phase's commits never invalidate it)", 'that differs from the current `HEAD`')],
      ['letting complete fall out of an else-branch', 'loop-complete-is-positive-only', (src) => replaceOnce(src, '→ only when every scoped story, and the root epic when SCOPE is one, is closed → RETURN {status:complete', '→ else → RETURN {status:complete')],
      ['limiting blocked to a review-caused open bead', 'loop-complete-is-positive-only', (src) => replaceOnce(src, 'if rollup left any story or the root epic open → RETURN', "if rollup left any story or the root epic open because an owned PR's fresh/valid local_review is not LOCAL_REVIEW_COMPLETE → RETURN")],
      ['dropping the already-appended probe', 'reentry-skips-published', (src) => replaceOnce(src, 'git rev-parse --verify --quiet refs/heads/<appendNextBranch>', 'git branch --list')],
      ['reading a malformed PR_ACTIONS as Raw mode', 'malformed-pr-actions-blocked', (src) => replaceOnce(src, '→ return `blocked` naming the malformed input', '→ treat it as Raw mode')],
      ['reviewing another branch when a PR\'s own branch is gone', 'missing-branch-blocks', (src) => replaceOnce(src, '→ `LOCAL_REVIEW_BLOCKED` naming that branch and its recorded `head` if there is one;', '→ review the checked-out HEAD instead;')],
      ['reopening an already-closed story on a later blocked review', 'closed-story-stays-closed', (src) => replaceOnce(src, 'stays closed when a later fresh review of its PR is blocked', 'is reopened when a later fresh review of its PR is blocked')],
      ['running the stacked review before consulting the Freshness rule', 'gate-checks-freshness-before-review', (src) => replaceOnce(src, "apply the Freshness rule below to this phase's PR alone -- a valid record means the gate already passed and no review runs; any other state runs the Quality Gate Review above, scoped to this phase's own diff, and records it", "run the Quality Gate Review above for every phase, scoped to this phase's own diff, and record it -- a valid record under the Freshness rule below changes nothing")],
      ['running the single-PR review before consulting the Freshness rule', 'gate-checks-freshness-before-review', (src) => replaceOnce(src, "apply the Freshness rule below to the `completion` PR first -- a valid record means its review already ran, any other state runs the Quality Gate Review above once over the whole scope's diff --", "run the Quality Gate Review above once over the whole scope's diff, whatever the Freshness rule below holds,")],
      ['recording COMPLETE although the post-review tip cannot be read', 'unreadable-tip-blocks', (src) => replaceOnce(src, 'and a branch tip that cannot be read once the skill has returned.', 'and nothing else.')],
      ['letting project-wide mode relax step 6', 'project-wide-keeps-step-6', (src) => replaceOnce(src, 'but never relaxes step 6', 'and skips the PR gates')],
    ].map(([name, property, mutate]) => ({ name, property, mutate, check: PROPERTIES.find((p) => p.id === property).check }));

    test.each(MUTANTS)('negative control: $name is reported by $property', ({ mutate, check }) => {
      const mutant = mutate(text);

      expect(mutant).not.toBe(text);
      expect(check(mutant).length).toBeGreaterThan(0);
    });

    test('every property has at least one mutant that it reports', () => {
      PROPERTIES.forEach(({ id }) => expect(MUTANTS.some((mutant) => mutant.property === id)).toBe(true));
    });
  });
});
