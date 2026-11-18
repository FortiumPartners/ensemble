'use strict';

/**
 * TRD-024-TEST -- shared prose neutrality and unchanged beads behaviour (TRD-2026-6995dc96
 * TRD-024-TEST; AC-011-1, AC-011-2, AC-011-3).
 *
 *   1. AC-011-1: the shared TRD-implementation command and skill prose names no tracker binary
 *      and no beads storage path outside text explicitly scoped to beads.
 *   2. AC-011-3: a beads project's work items still match the TRD-020 golden plan, and the beads
 *      adapter still resolves create / dep-add / close to `br` argv.
 *   3. AC-011-2: the create and link capability ids the shared prose names resolve to a kata argv
 *      under the kata manifest and to a `br` argv under the beads manifest: one capability id in
 *      the text, two different argv[0]. Pure argv resolution; no kata binary.
 *
 * Coverage limits, stated plainly:
 *   - AC-011-2 is only PARTIALLY covered for close. The shared prose says
 *     `run tracker.close --arg id=<..> (no reason arg)`, but kata's tracker.close is a deliberate
 *     refusal (INVALID_ARG naming tracker.close-with-reason). That is an OPEN GAP, tracked by
 *     follow-up bead br-jbxpe, and is pinned by a known-gap test below that fails once the prose
 *     is fixed. tracker.close-with-reason -> `kata close` is only supporting evidence.
 *   - AC-011-3 is covered via the TRD-020 scaffold-plan golden plus argv assertions on the beads
 *     adapter, not by running a full implement-trd flow.
 *
 * Env overrides (so a RED run can use scratch copies and never mutate shared files):
 *   PROSE_NEUTRALITY_ROOT  directory laid out like packages/development to read prose from
 *   KATA_MANIFEST_OVERRIDE a scratch copy of the kata adapter manifest
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const yaml = require('js-yaml');

const { buildArgv } = require('../lib/toolchain/runner');
const { findViolations } = require('../../../scripts/lint-provider-refs');

const PKG_DIR = path.join(__dirname, '..');
const REPO_ROOT = path.resolve(PKG_DIR, '..', '..');
const PROSE_ROOT = process.env.PROSE_NEUTRALITY_ROOT || PKG_DIR;
const GOLDEN_DIR = path.join(__dirname, 'fixtures', 'implement-trd');
const TRD_CLI = path.join(PKG_DIR, 'lib', 'trd-cli.js');
const TRD_PATH = path.join(REPO_ROOT, 'docs', 'TRD', 'TRD-2026-6995dc96-configurable-tasks-backend-kata.md');

const BEADS_MANIFEST = yaml.load(
  fs.readFileSync(path.join(PKG_DIR, 'skills', 'adapter-tracker-beads', 'adapter.yaml'), 'utf8')
);
const KATA_MANIFEST = yaml.load(
  fs.readFileSync(
    process.env.KATA_MANIFEST_OVERRIDE || path.join(PKG_DIR, 'skills', 'adapter-tracker-kata', 'adapter.yaml'),
    'utf8'
  )
);

// ---- the prose set -------------------------------------------------------------------------

const PROSE_SKILL_DIRS = [
  'ensemble-implement-trd-tasks',
  'implement-trd-tasks-reference',
  'ensemble-beads-build',
  'ensemble-beads-build-wave',
  'ensemble-implement-bead',
  'ensemble-fix-issue',
];

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.isFile() && /\.(md|yaml)$/.test(e.name)) out.push(p);
  }
  return out;
}

function proseFiles(root) {
  const files = [path.join(root, 'commands', 'implement-trd-tasks.yaml')].filter((f) => fs.existsSync(f));
  for (const d of PROSE_SKILL_DIRS) files.push(...walk(path.join(root, 'skills', d)));
  return files.sort();
}

// ---- the scanner ---------------------------------------------------------------------------

// A tracker binary: every binary the beads adapter declares that is tracker-specific (the
// adapter also lists `cat`, a generic utility), plus the known beads trio.
const TRACKER_BINARIES = new Set(
  [...(BEADS_MANIFEST.binaries || []), 'br', 'bv', 'bd'].filter((b) => b !== 'cat')
);
// Subcommands the beads adapter allowlists for each binary, used to catch an invocation written
// as bare prose (outside backticks or a fence), which findViolations does not see.
const BINARY_SUBS = new Map();
for (const entry of BEADS_MANIFEST.allowlist || []) {
  if (TRACKER_BINARIES.has(entry.bin)) BINARY_SUBS.set(entry.bin, new Set(entry.sub || []));
}
const STORAGE_PATH_RES = [/\.beads\b/, /\bbeads\.jsonl\b/, /\bissues\.jsonl\b/];

/**
 * "Beads-scoped" is defined narrowly and explicitly. Text is beads-scoped only when:
 *   (a) it sits under a Markdown heading whose text contains the word "beads" (the section runs
 *       to the next heading of the same or a higher level), or
 *   (b) its own line carries an explicit scope marker naming the backend: the phrase
 *       "beads backend", "beads-only" or "beads-scoped" (case-insensitive).
 * Mentioning a beads doc, the word "tracker-owned", or a beads-named skill directory does NOT
 * scope text: a kata project has no `.beads/` directory.
 */
const SCOPE_MARKER_RE = /\bbeads backend\b|\bbeads-only\b|\bbeads-scoped\b/i;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;

function scanProse(content) {
  const hits = [];
  const lines = content.split('\n');
  let scopeLevel = null; // heading level of the open beads-scoped section
  let inFence = false;

  const unscoped = [];
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const h = !inFence && HEADING_RE.exec(line);
    if (h) {
      const level = h[1].length;
      if (scopeLevel !== null && level <= scopeLevel) scopeLevel = null;
      if (scopeLevel === null && /\bbeads\b/i.test(h[2])) scopeLevel = level;
    }
    if (scopeLevel !== null || SCOPE_MARKER_RE.test(line)) {
      unscoped.push(''); // blank keeps line numbers and fence parity intact
      return;
    }
    unscoped.push(line);
    for (const re of STORAGE_PATH_RES) {
      if (re.test(line)) hits.push({ line: i + 1, kind: 'storage-path', text: line.trim().slice(0, 120) });
    }
    for (const [bin, subs] of BINARY_SUBS) {
      const m = new RegExp(`(?:^|[\\s\`;&|(])${bin}\\s+([a-z-]+)`).exec(line);
      if (m && subs.has(m[1])) hits.push({ line: i + 1, kind: 'binary', text: `${bin} ${m[1]}` });
    }
  });
  // Fenced and inline-code command positions, via the repo's own provider-reference rule. The
  // scoped lines were blanked above, so scoped fences stay inert.
  for (const v of findViolations(unscoped.join('\n'), TRACKER_BINARIES)) {
    hits.push({ line: v.line, kind: 'binary', text: v.binary });
  }
  // One finding per line and kind, whichever detector saw it.
  const seen = new Set();
  return hits.filter((h) => {
    const key = `${h.line}:${h.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---- 1. AC-011-1 ---------------------------------------------------------------------------

// Recorded leaks, tracked by follow-up bead br-jbxpe; NOT widened scope. Exit condition: shrink
// these ledgers as the prose is fixed (a fixed leak fails the test until its entry is removed).
const KNOWN_CORE_LEAKS = ['skills/implement-trd-tasks-reference/SKILL.md:17'];
const KNOWN_FLOW_LEAK_COUNTS = {
  'skills/ensemble-beads-build-wave/references/phase-1-preflight.md': 1,
  'skills/ensemble-beads-build-wave/references/phase-2-execute.md': 2,
  'skills/ensemble-beads-build/SKILL.md': 1,
  'skills/ensemble-beads-build/references/phase-1-preflight.md': 2,
  'skills/ensemble-beads-build/references/phase-2-execute.md': 1,
  'skills/ensemble-beads-build/references/phase-3-quality-gate.md': 1,
  'skills/ensemble-beads-build/references/phase-4-completion.md': 1,
  'skills/ensemble-implement-bead/SKILL.md': 2,
  'skills/ensemble-implement-bead/references/phase-1-preflight.md': 1,
  'skills/ensemble-implement-bead/references/phase-2-execute.md': 2,
};

describe('TRD-024-TEST: shared prose names no tracker binary or beads path outside beads scope (AC-011-1)', () => {
  const files = proseFiles(PROSE_ROOT);

  test('the sweep is non-vacuous: the command and every skill directory contribute files', () => {
    expect(files.length).toBeGreaterThanOrEqual(25);
    const rel = files.map((f) => path.relative(PROSE_ROOT, f).split(path.sep).join('/'));
    expect(rel).toContain('commands/implement-trd-tasks.yaml');
    for (const d of PROSE_SKILL_DIRS) {
      expect(rel.some((r) => r.startsWith(`skills/${d}/`))).toBe(true);
    }
    expect(rel.some((r) => r.startsWith('skills/ensemble-implement-trd-tasks/references/'))).toBe(true);
  });

  test('the scanner derives its binaries from the beads adapter', () => {
    expect([...TRACKER_BINARIES].sort()).toEqual(expect.arrayContaining(['bd', 'br', 'bv']));
    expect(TRACKER_BINARIES.has('cat')).toBe(false);
    expect(BINARY_SUBS.get('br').has('create')).toBe(true);
  });

  describe('scanner self-check', () => {
    test.each([
      ['a fenced br command', '```bash\nbr create --title x\n```', 'binary'],
      ['an inline-code br command', 'Run `br close abc` now.', 'binary'],
      ['a bare-prose br invocation', '- Then br dep add A B to wire it.', 'binary'],
      ['a bv command after a pipe', 'Run `echo x | bv --robot-next`', 'binary'],
      ['a storage path', 'Read .beads/issues.jsonl to schedule.', 'storage-path'],
      ['the beads.jsonl name', 'Parse beads.jsonl directly.', 'storage-path'],
    ])('detects %s', (_name, text, kind) => {
      expect(scanProse(text).map((h) => h.kind)).toContain(kind);
    });

    test.each([
      ['under a beads heading', '## Beads backend\n\nRun `br create --title x`; see .beads/issues.jsonl.\n'],
      ['under a heading containing beads', '### Notes for beads\n```\nbr close abc\n```\n'],
      ['on a line with an explicit marker', 'Beads backend only: `br close abc` writes .beads/issues.jsonl.'],
    ])('allows the same text %s', (_name, text) => {
      expect(scanProse(text)).toEqual([]);
    });

    test('a beads-scoped section ends at the next heading of the same level', () => {
      const text = '## Beads backend\nbr create x\n## Neutral\nrun `br create --title y`\n';
      const hits = scanProse(text);
      expect(hits.map((h) => h.line)).toEqual([4]);
    });

    test('a doc link or the word tracker-owned does not scope a leak', () => {
      expect(scanProse('minus .beads/ paths (tracker-owned export: docs/guides/beads-tracked-export.md)')).not.toEqual(
        []
      );
    });

    test('neutral capability-call prose is clean', () => {
      expect(scanProse('Run node "$TOOLCHAIN_CLI" run tracker.create --arg title="x" --json')).toEqual([]);
    });
  });

  const leaksByFile = () => {
    const out = {};
    for (const f of files) {
      const hits = scanProse(fs.readFileSync(f, 'utf8'));
      if (hits.length) out[path.relative(PROSE_ROOT, f).split(path.sep).join('/')] = hits;
    }
    return out;
  };

  test('no named tracker binary appears in shell-command position anywhere in the prose set', () => {
    const bins = [];
    for (const [file, hits] of Object.entries(leaksByFile())) {
      for (const h of hits.filter((x) => x.kind === 'binary')) bins.push(`${file}:${h.line} ${h.text}`);
    }
    expect(bins).toEqual([]);
  });

  test('the TRD-implementation command and its two skills hold no storage path outside beads scope, bar the recorded leak', () => {
    const core = (f) =>
      f === 'commands/implement-trd-tasks.yaml' ||
      f.startsWith('skills/ensemble-implement-trd-tasks/') ||
      f.startsWith('skills/implement-trd-tasks-reference/');
    const found = Object.entries(leaksByFile())
      .filter(([f]) => core(f))
      .flatMap(([f, hits]) => hits.map((h) => `${f}:${h.line}`));
    expect(found).toEqual(KNOWN_CORE_LEAKS);
  });

  // The beads-named flows (beads-build, beads-build-wave, implement-bead) still name `.beads/`
  // as the tracker adapter's own state. Their text does not say it is beads-scoped, so under
  // this test's narrow definition each mention is a leak. The ledger pins the exact per-file
  // count: a new leak fails, and fixing one fails until the ledger shrinks with it.
  test('beads-named flow prose storage-path mentions do not exceed the recorded ledger', () => {
    const counts = {};
    for (const [f, hits] of Object.entries(leaksByFile())) {
      if (f.startsWith('skills/ensemble-implement-trd-tasks/') || f.startsWith('skills/implement-trd-tasks-reference/')) continue;
      counts[f] = hits.length;
    }
    expect(counts).toEqual(KNOWN_FLOW_LEAK_COUNTS);
  });
});

// ---- 2. AC-011-3 ---------------------------------------------------------------------------

// The manifest writes `${name}` placeholders; buildArgv expects the bare `{name}` form.
function resolveArgv(manifest, capability, args) {
  const cap = manifest.capabilities[capability];
  if (!cap) throw new Error(`manifest declares no ${capability}`);
  const tr = (r) => r.map((e) => (typeof e === 'string' ? e.replace(/\$\{([^{}]+)\}/g, '{$1}') : e));
  const template = tr(cap.run);
  const variants = cap.variants
    ? Object.fromEntries(
        Object.entries(cap.variants).map(([sel, byValue]) => [
          sel,
          Object.fromEntries(Object.entries(byValue).map(([v, run]) => [v, tr(run)])),
        ])
      )
    : undefined;
  return buildArgv(template, args, { inputs: {}, variants });
}

const CREATE_ARGS = { title: 'T', type: 'task', description: 'D' };
const LINK_ARGS = { id: 'A', dependsOnId: 'B', type: 'blocks' };

describe('TRD-024-TEST: a beads project keeps its work items and argv (AC-011-3)', () => {
  const captured = JSON.parse(fs.readFileSync(path.join(GOLDEN_DIR, 'cli-plan_scaffold_plan.json'), 'utf8')).json.plan;
  let current;

  beforeAll(() => {
    const stdout = execFileSync(process.execPath, [TRD_CLI, 'scaffold-plan', TRD_PATH], {
      cwd: PKG_DIR,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    current = JSON.parse(stdout).plan;
  }, 60000);

  // A TRD checkbox records progress, not the work-item contract the capture pins.
  const noBox = (s) => s.replace(/\[([ xX])\]/g, '[ ]');
  const items = (plan) => ({
    epic: plan.epic.titlePrefix,
    stories: plan.stories.map((s) => `${s.phaseN} | ${s.titlePrefix} | ${noBox(s.title)}`),
    tasks: plan.tasks.map((t) => `${t.id} | phase ${t.phaseN} | ${t.titlePrefix} | ${noBox(t.title)}`),
    edges: plan.deps.map((d) => `${d.type} ${d.blockerId} -> ${d.blockedId}`).sort(),
  });

  test('the golden plan is non-trivial', () => {
    expect(captured.tasks.length).toBeGreaterThan(0);
    expect(captured.stories.length).toBeGreaterThan(0);
    expect(captured.deps.length).toBeGreaterThan(0);
  });

  test('scaffold-plan titles, edges and phase grouping equal the TRD-020 golden plan', () => {
    expect(items(current)).toEqual(items(captured));
  });

  test('the beads adapter still maps create, dep-add and close to br argv', () => {
    expect(resolveArgv(BEADS_MANIFEST, 'tracker.create', CREATE_ARGS)).toEqual([
      'br', 'create', '--title', 'T', '--type', 'task', '-d', 'D', '--json',
    ]);
    expect(resolveArgv(BEADS_MANIFEST, 'tracker.dep-add', LINK_ARGS)).toEqual([
      'br', 'dep', 'add', 'A', 'B', '--type', 'blocks', '--json',
    ]);
    expect(resolveArgv(BEADS_MANIFEST, 'tracker.close', { id: 'A' })).toEqual(['br', 'close', 'A', '--json']);
  });
});

// ---- 3. AC-011-2 ---------------------------------------------------------------------------

describe('TRD-024-TEST: the same prose resolves to a kata capability call on a kata project (AC-011-2)', () => {
  const refsDir = path.join(PROSE_ROOT, 'skills', 'ensemble-implement-trd-tasks', 'references');
  const proseText = walk(refsDir).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const named = (cap) => new RegExp(`(?:run|invoke|call) ${cap.replace('.', '\\.')}(?![\\w-])`).test(proseText);

  test('the shared prose states the create, link and close instructions as capability calls', () => {
    expect(walk(refsDir).length).toBeGreaterThanOrEqual(5);
    for (const cap of ['tracker.create', 'tracker.dep-add', 'tracker.close']) {
      expect(named(cap)).toBe(true);
    }
  });

  test('create resolves to kata create on kata and br create on beads: one id, two argv[0]', () => {
    const kata = resolveArgv(KATA_MANIFEST, 'tracker.create', CREATE_ARGS);
    const beads = resolveArgv(BEADS_MANIFEST, 'tracker.create', CREATE_ARGS);
    expect(kata.slice(0, 2)).toEqual(['kata', 'create']);
    expect(beads.slice(0, 2)).toEqual(['br', 'create']);
    expect(kata[0]).not.toBe(beads[0]);
  });

  test('link resolves to kata edit --blocked-by on kata and br dep add on beads', () => {
    const kata = resolveArgv(KATA_MANIFEST, 'tracker.dep-add', LINK_ARGS);
    const beads = resolveArgv(BEADS_MANIFEST, 'tracker.dep-add', LINK_ARGS);
    expect(kata[0]).toBe('kata');
    expect(kata).toEqual(expect.arrayContaining(['edit', 'A', '--blocked-by', 'B']));
    expect(beads.slice(0, 3)).toEqual(['br', 'dep', 'add']);
    expect(kata[0]).not.toBe(beads[0]);
  });

  // OPEN GAP (follow-up bead br-jbxpe): this does NOT prove close resolves to a kata call. The
  // shared prose names tracker.close with no reason, which kata refuses. Written to FAIL once the
  // prose names tracker.close-with-reason; at that point delete this test and replace it with a
  // passing proof that close resolves to `kata close`, like the create and link tests above.
  test('KNOWN GAP br-jbxpe: prose tracker.close (no reason) is refused on kata and prose lacks close-with-reason', () => {
    expect(named('tracker.close')).toBe(true);
    expect(/tracker\.close-with-reason/.test(proseText)).toBe(false);

    let err;
    try {
      resolveArgv(KATA_MANIFEST, 'tracker.close', { id: 'A' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(err.code).toBe('INVALID_ARG');
    expect(err.message).toMatch(/tracker\.close-with-reason/);
  });

  // Supporting evidence only: the capability the prose should name does resolve to kata close.
  test('supporting: tracker.close-with-reason resolves to kata close; beads close stays br', () => {
    const withReason = resolveArgv(KATA_MANIFEST, 'tracker.close-with-reason', {
      id: 'A',
      reason: 'a substantive closing message of well over forty characters',
      commit: 'abc1234',
    });
    expect(withReason.slice(0, 2)).toEqual(['kata', 'close']);
    expect(resolveArgv(BEADS_MANIFEST, 'tracker.close', { id: 'A' })[0]).toBe('br');
  });
});
