'use strict';

/**
 * Tests for planDeltaReview and the import graph it consumes (kata 801a). Every fail-closed rule has its own
 * test: removing the rule must make that test (and only that rule's tests) fail.
 */

const { planDeltaReview } = require('../lib/pr-review-delta');
const { buildImportGraph, referencesOf, namesFile, mentionNeedles } = require('../lib/pr-review-import-graph');
const { chooseReviewRange } = require('../lib/pr-review-scope');
const { classifyPaths } = require('../lib/pr-review-paths');

const BASE = 'b'.repeat(40);
const REVIEWED = 'a'.repeat(40);
const HEAD = 'c'.repeat(40);

const deltaRange = (overrides = {}) => ({
  ok: true,
  mode: 'delta',
  range: `${REVIEWED}..${HEAD}`,
  fullRange: `${BASE}...${HEAD}`,
  baseSha: BASE,
  headSha: HEAD,
  lastReviewedSha: REVIEWED,
  reason: 'delta-since-last-review',
  unvouched: [],
  ...overrides,
});

const DECLARATION = { sourceSha: BASE, sensitive: ['secure/**'], high: ['core/**'] };
const classify = (changedPaths) => classifyPaths({ changedPaths, declaration: DECLARATION, baseSha: BASE });

const FILES = [
  'src/thing.js',
  'src/app.js',
  'src/other.js',
  'src/util/index.js',
  'src/use-util.js',
  'tests/thing.test.js',
  'tests/app-flow.test.js',
  'tests/stem/thing.spec.js',
  'core/engine.js',
  'secure/keys.js',
];
const LINES = [
  { path: 'src/app.js', text: "const thing = require('./thing');" },
  { path: 'src/other.js', text: "const x = require('./unrelated');" },
  { path: 'src/use-util.js', text: "import { u } from './util';" },
  { path: 'tests/app-flow.test.js', text: "const thing = require('../src/thing.js');" },
];
const graph = (overrides = {}) => ({ ...buildImportGraph({ filePaths: FILES, lines: LINES }), ...overrides });
/** What the review-state report of the completed round that reviewed REVIEWED against BASE recorded. */
const recorded = (overrides = {}) => ({ headSha: REVIEWED, baseSha: BASE, ...overrides });

function plan(overrides = {}) {
  const changedPaths = overrides.changedPaths || ['src/thing.js'];
  return planDeltaReview({
    delta: deltaRange(),
    changedPaths,
    pathsClassification: classify(changedPaths),
    reviewed: recorded(),
    importGraph: graph(),
    ...overrides,
  });
}

const readPaths = (result) => result.readSet.map((entry) => entry.path);

describe('planDeltaReview: the delta plus its blast radius (AC1)', () => {
  it('reads the changed file, the files that import it and the tests that import it or carry its name', () => {
    const result = plan();
    expect(result.mode).toBe('delta');
    expect(readPaths(result)).toEqual(['src/app.js', 'src/thing.js', 'tests/app-flow.test.js', 'tests/stem/thing.spec.js', 'tests/thing.test.js']);
    const byPath = Object.fromEntries(result.readSet.map((entry) => [entry.path, entry.reasons]));
    expect(byPath['src/thing.js']).toEqual(['changed']);
    expect(byPath['src/app.js']).toEqual(['caller-of:src/thing.js']);
    expect(byPath['tests/app-flow.test.js']).toEqual(['test-of:src/thing.js']);
    expect(byPath['tests/thing.test.js']).toEqual(['test-of:src/thing.js']);
  });

  it('does not read what neither imports nor tests a changed file', () => {
    expect(readPaths(plan())).not.toContain('src/other.js');
  });

  it('finds the importers of a directory module through its index file', () => {
    expect(readPaths(plan({ changedPaths: ['src/util/index.js'] }))).toContain('src/use-util.js');
  });

  it('still names the importers of a file the delta deleted', () => {
    const lines = [...LINES, { path: 'src/other.js', text: "const gone = require('./removed');" }];
    const importGraph = buildImportGraph({ filePaths: FILES, lines });
    const result = plan({ changedPaths: ['src/removed.js'], importGraph });
    expect(result.mode).toBe('delta');
    expect(readPaths(result)).toEqual(['src/other.js', 'src/removed.js']);
  });

  it('keeps a changed test file in the read set as changed', () => {
    const result = plan({ changedPaths: ['tests/thing.test.js'] });
    expect(result.readSet).toEqual([{ path: 'tests/thing.test.js', reasons: ['changed'] }]);
  });

  it('lists the read set in byte order with no path twice', () => {
    const result = plan({ changedPaths: ['src/thing.js', 'src/app.js'] });
    expect(readPaths(result)).toEqual([...new Set(readPaths(result))].sort());
    expect(result.readSet.find((entry) => entry.path === 'src/app.js').reasons).toEqual(['caller-of:src/thing.js', 'changed']);
  });
});

describe('planDeltaReview: fails closed to a full re-read (AC1, AC2)', () => {
  const expectFull = (result, ...reasons) => {
    expect(result.mode).toBe('full');
    expect(result.readSet).toEqual([]);
    for (const reason of reasons) expect(result.reasons).toContain(reason);
  };

  it('a last reviewed head the review state does not record as reviewed (AC1: a head never seen)', () => {
    for (const reviewed of [undefined, null, {}, recorded({ headSha: null }), recorded({ headSha: true }), recorded({ headSha: 'main' })]) {
      expectFull(plan({ reviewed }), 'head-never-seen');
    }
  });

  it('a record for another head does not make this one seen, however readable that other commit is', () => {
    expectFull(plan({ reviewed: recorded({ headSha: 'e'.repeat(40) }) }), 'head-never-seen');
    expectFull(plan({ reviewed: recorded({ headSha: HEAD }) }), 'head-never-seen');
  });

  it('the record names the delta head whatever the case of its hex', () => {
    expect(plan({ reviewed: recorded({ headSha: REVIEWED.toUpperCase() }) }).mode).toBe('delta');
  });

  it('a base other than the one the last round reviewed against, a retargeted PR, is a full re-read (AC1)', () => {
    const moved = plan({ delta: deltaRange({ baseSha: 'f'.repeat(40) }) });
    expectFull(moved, 'base-moved');
    expect(moved.reasons).toEqual(['base-moved']);
    expect(plan({ reviewed: recorded({ baseSha: 'f'.repeat(40) }) }).reasons).toEqual(['base-moved']);
  });

  it('a base nobody recorded cannot be shown to be the same one, so it is a full re-read', () => {
    for (const reviewed of [{ headSha: REVIEWED }, recorded({ baseSha: null }), recorded({ baseSha: 'dev' }), recorded({ baseSha: true })]) {
      expectFull(plan({ reviewed }), 'reviewed-base-unknown');
    }
  });

  it('the base the last round reviewed against keeps the delta, whatever the case of its hex', () => {
    expect(plan({ reviewed: recorded({ baseSha: BASE.toUpperCase() }) }).mode).toBe('delta');
  });

  it('a delta touching a High path', () => {
    expectFull(plan({ changedPaths: ['src/thing.js', 'core/engine.js'], pathsClassification: classify(['src/thing.js', 'core/engine.js']) }), 'high-path-touched');
  });

  it('a delta touching a sensitive path', () => {
    expectFull(plan({ changedPaths: ['secure/keys.js'], pathsClassification: classify(['secure/keys.js']) }), 'sensitive-path-touched');
  });

  it('a delta touching a review declaration file', () => {
    const changedPaths = ['REVIEW.md'];
    const pathsClassification = { ok: true, paths: [{ path: 'REVIEW.md', sensitive: false, high: false, declarationFile: true }] };
    expectFull(plan({ changedPaths, pathsClassification }), 'sensitive-path-touched');
  });

  it('a classification that is unreadable, not ok, or that does not cover every changed path', () => {
    expectFull(plan({ pathsClassification: undefined }), 'classification-unreadable');
    expectFull(plan({ pathsClassification: { ...classify(['src/thing.js']), ok: false } }), 'classification-unreadable');
    expectFull(plan({ pathsClassification: { ok: true } }), 'classification-unreadable');
    expectFull(plan({ changedPaths: ['src/thing.js', 'src/app.js'], pathsClassification: classify(['src/thing.js']) }), 'classification-incomplete');
  });

  it('changed paths that are missing, malformed or empty', () => {
    expectFull(plan({ changedPaths: undefined }), 'changed-paths-unreadable');
    expectFull(plan({ changedPaths: ['src/thing.js', 42] }), 'changed-paths-unreadable');
    expectFull(plan({ changedPaths: ['src/thing.js', ''] }), 'changed-paths-unreadable');
    expectFull(plan({ changedPaths: [], pathsClassification: classify([]) }), 'empty-delta');
  });

  it('an import graph that is missing or unreadable: no blast radius, no justified read set', () => {
    expectFull(plan({ importGraph: undefined }), 'import-graph-unavailable');
    expectFull(plan({ importGraph: null }), 'import-graph-unavailable');
    expectFull(plan({ importGraph: { schema: 2, importers: { a: 'b' }, testFiles: [], computed: [] } }), 'import-graph-unreadable');
    expectFull(plan({ importGraph: { schema: 3, importers: {}, testFiles: [], computed: [] } }), 'import-graph-unreadable');
    expectFull(plan({ importGraph: { schema: 2, importers: {}, computed: [] } }), 'import-graph-unreadable');
    expectFull(plan({ importGraph: { schema: 2, importers: {}, testFiles: [] } }), 'import-graph-unreadable');
    expectFull(plan({ importGraph: { ...graph(), computed: 'src/a.js' } }), 'import-graph-unreadable');
  });

  it('a graph that lists files it could not read, without the name lines that place them', () => {
    const importGraph = buildImportGraph({ filePaths: FILES, lines: [{ path: 'src/dyn.js', text: 'require(pick())' }] });
    expect(importGraph.computed).toEqual(['src/dyn.js']);
    expectFull(plan({ importGraph }), 'name-scan-unavailable');
    expectFull(plan({ importGraph, nameLines: null }), 'name-scan-unavailable');
    expectFull(plan({ importGraph, nameLines: 'src/dyn.js' }), 'name-scan-unreadable');
    expectFull(plan({ importGraph, nameLines: [{ path: 'src/dyn.js' }] }), 'name-scan-unreadable');
    expectFull(plan({ importGraph, nameLines: [null] }), 'name-scan-unreadable');
    expect(plan({ importGraph, nameLines: [] }).mode).toBe('delta');
  });

  it('a delta that changes source in a language the graph does not read', () => {
    for (const file of ['lib/thing.py', 'scripts/run.sh', 'app/x.ex']) {
      expectFull(plan({ changedPaths: [file], pathsClassification: classify([file]) }), 'unanalyzed-source-changed');
    }
  });

  it('a file type nobody listed fails closed: an unlisted language or an unknown extension is not harmless by default', () => {
    for (const file of ['src/x.mts', 'src/x.cts', 'ui/App.vue', 'ui/App.svelte', 'lib/x.coffee', 'ui/page.html', 'ui/style.css', 'Makefile', 'bin/tool', 'lib/x.unknownext']) {
      expectFull(plan({ changedPaths: [file], pathsClassification: classify([file]) }), 'unanalyzed-source-changed');
    }
  });

  it('code the graph reads, and documentation, data and assets, are sized, not failed closed', () => {
    const sized = ['src/x.ts', 'src/x.tsx', 'src/x.mjs', 'src/x.cjs', 'src/x.jsx', 'docs/guide.md', 'README.MD', 'data/a.json', 'ci/b.yaml', 'ci/b.yml',
      'tests/__snapshots__/thing.test.js.snap', 'img/a.png', 'img/a.svg', 'dir/.gitkeep', '.gitignore', 'package-lock.json', 'yarn.lock'];
    for (const file of sized) {
      const result = plan({ changedPaths: [file], pathsClassification: classify([file]) });
      expect([file, result.mode, result.reasons]).toEqual([file, 'delta', ['delta-since-last-review']]);
    }
  });

  it('a range decision that is not a readable delta', () => {
    expectFull(plan({ delta: undefined }), 'delta-unreadable');
    expectFull(plan({ delta: { ok: false, status: 'REVIEW_BLOCKED' } }), 'delta-unreadable');
    expectFull(plan({ delta: deltaRange({ lastReviewedSha: 'main' }) }), 'delta-unreadable');
    expectFull(plan({ delta: deltaRange({ headSha: undefined }) }), 'delta-unreadable');
  });

  it('every applicable reason is reported, none is dropped', () => {
    const result = plan({ reviewed: undefined, importGraph: undefined, changedPaths: ['core/engine.js'], pathsClassification: classify(['core/engine.js']) });
    expect(result.reasons).toEqual(expect.arrayContaining(['head-never-seen', 'reviewed-base-unknown', 'high-path-touched', 'import-graph-unavailable']));
  });

  it('never throws on garbage input', () => {
    for (const input of [undefined, null, 7, 'x', [], {}]) expect(planDeltaReview(input).mode).toBe('full');
  });
});

describe('planDeltaReview composes with chooseReviewRange (AC3)', () => {
  const scope = { baseSha: BASE, headSha: HEAD };
  const commit = (sha, parents) => ({ sha, parents });

  it('a full range from review-range is never overridden to delta, whatever else is true', () => {
    for (const request of [
      { ...scope },
      { ...scope, lastReviewedSha: 'main' },
      { ...scope, lastReviewedSha: REVIEWED },
      { ...scope, lastReviewedSha: REVIEWED, commits: [commit(HEAD, [REVIEWED])], remediationShas: [] },
    ]) {
      const range = chooseReviewRange(request);
      expect(range.mode).toBe('full');
      const result = plan({ delta: range });
      expect(result.mode).toBe('full');
      expect(result.reasons).toEqual(expect.arrayContaining(['range-is-full', range.reason]));
    }
  });

  it('a vouched delta from review-range is refined, not replaced: same reason, a non-empty read set', () => {
    const range = chooseReviewRange({ ...scope, lastReviewedSha: REVIEWED, commits: [commit(HEAD, [REVIEWED])], remediationShas: [HEAD] });
    expect(range.mode).toBe('delta');
    const result = plan({ delta: range });
    expect(result.mode).toBe('delta');
    expect(result.reasons).toEqual(['delta-since-last-review']);
    expect(result.readSet.length).toBeGreaterThan(0);
  });

  it('a retargeted PR: review-range still offers the delta (it takes no reviewed base), the plan does not', () => {
    const retargeted = chooseReviewRange({ baseSha: 'f'.repeat(40), headSha: HEAD, lastReviewedSha: REVIEWED, commits: [commit(HEAD, [REVIEWED])], remediationShas: [HEAD] });
    expect(retargeted.mode).toBe('delta');
    const result = plan({ delta: retargeted });
    expect(result.mode).toBe('full');
    expect(result.reasons).toEqual(['base-moved']);
  });
});

describe('planDeltaReview: every form of reference to a changed file reaches the read set (AC1)', () => {
  // one consumer per form, each loading src/thing.js the way its name says; none of these was seen by the old graph
  const FORMS = [
    ['jest.requireActual', 'src/f-actual.js', ["const real = jest.requireActual('./thing');"]],
    ['jest.requireMock', 'src/f-mock.js', ["const m = jest.requireMock('./thing');"]],
    ['jest.mock', 'src/f-jest-mock.js', ["jest.mock('./thing', () => ({}));"]],
    ['require.resolve', 'src/f-resolve.js', ["const p = require.resolve('./thing');"]],
    ['a template literal without interpolation', 'src/f-template.js', ['const t = require(`./thing`);']],
    ['an argument on the line after the call', 'src/f-multiline.js', ['const t = require(', "  './thing'"]],
    ['a dynamic import', 'src/f-dynamic.js', ["const t = await import('./thing.js');"]],
    ['a path handed to a worker', 'src/f-worker.js', ["new Worker('./thing.js');"]],
    ['an HTML script tag', 'src/page.html', ['<script src="./thing.js"></script>']],
    ['an HTML script tag without ./', 'src/page2.html', ['<script src="thing.js"></script>']],
    ['an HTML root-relative script tag', 'ui/page3.html', ['<script src="/src/thing.js"></script>']],
  ];

  it.each(FORMS)('%s', (_form, consumer, texts) => {
    const importGraph = buildImportGraph({ filePaths: [...FILES, consumer], lines: texts.map((text) => ({ path: consumer, text })) });
    const result = plan({ importGraph, nameLines: [] });
    expect(result.mode).toBe('delta');
    expect(readPaths(result)).toContain(consumer);
  });

  it('a changed jest snapshot reaches the test that owns it', () => {
    const snapshot = 'tests/__snapshots__/thing.test.js.snap';
    const result = plan({ changedPaths: [snapshot], pathsClassification: classify([snapshot]) });
    expect(result.reasons).toEqual(['delta-since-last-review']);
    expect(result.readSet).toEqual([
      { path: snapshot, reasons: ['changed'] },
      { path: 'tests/stem/thing.spec.js', reasons: [`test-of:${snapshot}`] },
      { path: 'tests/thing.test.js', reasons: [`test-of:${snapshot}`] },
    ]);
  });
});

describe('planDeltaReview: a file whose references the graph cannot read is placed by name (AC1)', () => {
  const place = (consumer, scanned, named, overrides = {}) => {
    const importGraph = buildImportGraph({ filePaths: [...FILES, consumer], lines: scanned.map((text) => ({ path: consumer, text })) });
    expect(importGraph.computed).toEqual([consumer]);
    return plan({ importGraph, nameLines: named.map((text) => ({ path: consumer, text })), ...overrides });
  };

  it('an interpolated template literal, which names the file after the interpolation', () => {
    const line = 'const t = require(`${base}/thing.js`);';
    const result = place('src/f-interpolated.js', [line], [line]);
    expect(result.mode).toBe('delta');
    expect(result.readSet).toContainEqual({ path: 'src/f-interpolated.js', reasons: ['names:src/thing.js'] });
  });

  it('an interpolated template literal that leaves the extension out', () => {
    const line = 'const t = require(`${base}/thing`);';
    expect(readPaths(place('src/f-no-ext.js', [line], [line]))).toContain('src/f-no-ext.js');
  });

  it('a computed specifier whose file name is spelled elsewhere in the file', () => {
    const result = place('src/f-computed.js', ['const mod = require(file);'], ["const file = path.join(__dirname, 'thing.js');"]);
    expect(result.readSet).toContainEqual({ path: 'src/f-computed.js', reasons: ['names:src/thing.js'] });
  });

  it('a computed specifier built from a repository path', () => {
    const result = place('src/f-root.js', ['const mod = require(path.join(ROOT, rel));'], ["const rel = 'src/thing.js';"]);
    expect(readPaths(result)).toContain('src/f-root.js');
  });

  it('a computed specifier that names no changed file is not read: the over-approximation is by name, so it can be told apart', () => {
    const result = place('src/f-other.js', ['const mod = require(file);'], ["const file = path.join(__dirname, 'other.js');"]);
    expect(result.mode).toBe('delta');
    expect(readPaths(result)).not.toContain('src/f-other.js');
  });

  it('each changed file is named on its own: the one that is not named adds nothing', () => {
    const result = place('src/f-two.js', ['const mod = require(file);'], ["const file = path.join(__dirname, 'thing.js');"], {
      changedPaths: ['src/thing.js', 'src/unnamed.js'],
      pathsClassification: classify(['src/thing.js', 'src/unnamed.js']),
    });
    expect(result.readSet.find((entry) => entry.path === 'src/f-two.js').reasons).toEqual(['names:src/thing.js']);
  });

  it('a file the graph read exactly is not added for naming a changed file: only the unreadable ones are placed by name', () => {
    const importGraph = buildImportGraph({ filePaths: [...FILES, 'src/dyn.js', 'src/labels.js'], lines: [{ path: 'src/dyn.js', text: 'require(pick())' }, { path: 'src/labels.js', text: "const label = '../thing.js';" }] });
    expect(importGraph.computed).toEqual(['src/dyn.js']);
    const nameLines = [{ path: 'src/labels.js', text: "const label = '../thing.js';" }, { path: 'src/dyn.js', text: "const unrelated = 'x.js';" }];
    expect(readPaths(plan({ importGraph, nameLines }))).not.toContain('src/dyn.js');
    // labels.js is a file the graph read exactly: its '../thing.js' is an edge (it is a caller), not a name
    expect(plan({ importGraph, nameLines }).readSet.find((entry) => entry.path === 'src/labels.js')).toBeUndefined();
  });
});

describe('referencesOf: every reference form is read or listed as computed, none is dropped (AC1)', () => {
  const specifiers = (text, file = 'src/a.js') => referencesOf(file, text).specifiers;
  const computed = (text, file = 'src/a.js') => referencesOf(file, text).computed;

  it('reads require, import, dynamic import and re-export specifiers, relative only', () => {
    expect(specifiers("const a = require('./a'); const b = require(\"../b\");")).toEqual(['./a', '../b']);
    expect(specifiers("import x from './x';")).toEqual(['./x']);
    expect(specifiers("} from './multi-line';")).toEqual(['./multi-line']);
    expect(specifiers("import './side-effect';")).toEqual(['./side-effect']);
    expect(specifiers("const m = await import('./lazy.js');")).toEqual(['./lazy.js']);
    expect(specifiers("export * from './re';")).toEqual(['./re']);
    expect(specifiers("const fs = require('fs'); import pkg from '@scope/pkg';")).toEqual([]);
    expect(specifiers("const d = require('.'); const p = require('..');")).toEqual(['.', '..']);
  });

  it('reads a relative path whatever calls it', () => {
    expect(specifiers("const real = jest.requireActual('../lib/x');")).toEqual(['../lib/x']);
    expect(specifiers("const m = jest.requireMock('./x');")).toEqual(['./x']);
    expect(specifiers("jest.mock('./x', () => ({ a: 1 }));")).toEqual(['./x']);
    expect(specifiers("const p = require.resolve('./x');")).toEqual(['./x']);
    expect(specifiers('const t = require(`./x`);')).toEqual(['./x']);
    expect(specifiers("  './on-its-own-line'")).toEqual(['./on-its-own-line']);
    expect(specifiers("new Worker('./w.js'); fork(\"../f.js\");")).toEqual(['./w.js', '../f.js']);
  });

  it('lists a call whose specifier is not a plain literal as computed instead of dropping it', () => {
    for (const text of [
      'const t = require(`./${name}`);',
      'const t = require(`${scripts}/x.js`);',
      'const t = require(',
      'const t = await import(',
      'const t = require(name);',
      'const t = require(path.join(ROOT, rel));',
      "const t = require('./a' + suffix);",
      'const t = await import(name);',
      'const t = jest.requireActual(name);',
      'const t = jest.mock(name);',
      'const p = require.resolve(name);',
      "const t = import(/* webpackChunkName: 'x' */ './x');",
    ]) {
      expect([text, computed(text)]).toEqual([text, true]);
    }
  });

  it('does not call a plain literal, a bare package, an empty call, prose or a comment computed', () => {
    for (const text of [
      "const t = require('./x');",
      "const t = require('fs');",
      "const t = require('./x', { paths: [] });",
      'const t = require(`./x`);',
      "const t = import('./x');",
      "const real = jest.requireActual('./x');",
      '// file is require()\'d before it, e.g. require(name)',
      ' * require(name) loads it',
      'the config is require()d',
    ]) {
      expect([text, computed(text)]).toEqual([text, false]);
    }
  });

  it('keeps what a computed line does name: `require(\'./a\' + suffix)` still reads ./a', () => {
    expect(referencesOf('src/a.js', "const t = require('./a' + suffix);")).toEqual({ specifiers: ['./a'], computed: true });
  });

  it('reads the src and href of an HTML file, and skips URLs and anchors', () => {
    const html = (text) => referencesOf('ui/index.html', text).specifiers;
    expect(html('<script src="./app.js"></script>')).toEqual(['./app.js']);
    expect(html('<script src="app.js"></script>')).toEqual(['./app.js']);
    expect(html('<script src="../vendor/lib.js"></script>')).toEqual(['../vendor/lib.js']);
    expect(html('<link rel="stylesheet" href="css/site.css?v=2">')).toEqual(['./css/site.css']);
    expect(html('<script src="/static/app.js#top"></script>')).toEqual(['/static/app.js']);
    for (const text of ['<script src="https://cdn.example.com/x.js"></script>', '<script src="//cdn.example.com/x.js"></script>',
      '<a href="#section">', '<a href="mailto:a@b.c">', '<img src="data:image/png;base64,AAAA">', '<a href="">']) {
      expect([text, html(text)]).toEqual([text, []]);
    }
    // a src attribute in a JavaScript file is not markup
    expect(referencesOf('src/a.js', '<script src="app.js">').specifiers).toEqual([]);
  });
});

describe('namesFile and mentionNeedles', () => {
  it.each([
    ['an interpolated template with the extension', 'const t = require(`${scripts}/smoke-util.js`);', 'skills/scripts/smoke-util.js'],
    ['an interpolated template without it', 'const t = require(`${scripts}/smoke-util`);', 'skills/scripts/smoke-util.js'],
    ['a quoted file name', "path.join(__dirname, 'smoke-util.js')", 'skills/scripts/smoke-util.js'],
    ['a path segment', "path.join(ROOT, 'skills', 'scripts', 'smoke-util.js')", 'skills/scripts/smoke-util.js'],
    ['a relative path', "const x = '../lib/smoke-util';", 'lib/smoke-util.js'],
    ['an HTML tag', '<script src="./app.js"></script>', 'ui/app.js'],
    ['a TypeScript file named by its compiled extension', "import x from './x.js';", 'src/x.ts'],
    ['a file with several dots', "require('./x.config.js')", 'src/x.config.js'],
    ['a file without an extension', "readFileSync('docs/LICENSE')", 'LICENSE'],
    ['a name followed by punctuation', 'see ./smoke-util.js, then', 'lib/smoke-util.js'],
  ])('names the file: %s', (_form, text, file) => {
    expect(namesFile(text, file)).toBe(true);
  });

  it.each([
    ['a bare word', "const mode = 'smoke-util';", 'lib/smoke-util.js'],
    ['a longer name', "require('./smoke-util-extra')", 'lib/smoke-util.js'],
    ['a name it only starts', "require('./smoke-utils')", 'lib/smoke-util.js'],
    ['the test of the file', "require('./smoke-util.test.js')", 'lib/smoke-util.js'],
    ['the same name with another extension', 'fs.readFile("./index.html")', 'src/index.js'],
    ['a name with the prefix of another word', "const x = 'a/smoke-util';", 'lib/smoke-utility.js'],
    ['a variable that has the stem for a name', 'const index = items.length;', 'src/index.js'],
    ['nothing', '', 'lib/smoke-util.js'],
  ])('does not name the file: %s', (_form, text, file) => {
    expect(namesFile(text, file)).toBe(false);
  });

  it('is never true for garbage', () => {
    expect(namesFile(undefined, 'a.js')).toBe(false);
    expect(namesFile('x', '')).toBe(false);
    expect(namesFile('x', null)).toBe(false);
  });

  it('gives every distinct stem once, each in the four spellings a mention starts with', () => {
    const needles = mentionNeedles(['src/thing.js', 'lib/thing.js', 'src/other.test.js']);
    expect(needles).toEqual(['/other.test', "'other.test", '"other.test', '`other.test', '/thing', "'thing", '"thing', '`thing']);
  });
});

describe('buildImportGraph', () => {
  const build = (lines, filePaths = FILES) => buildImportGraph({ filePaths, lines });

  it('lists the files whose references it could not read, sorted and once each', () => {
    const g = build([
      { path: 'src/b.js', text: 'require(x)' },
      { path: 'src/a.js', text: 'import(y)' },
      { path: 'src/a.js', text: 'require(z)' },
      { path: 'src/c.js', text: "require('./a')" },
    ]);
    expect(g.computed).toEqual(['src/a.js', 'src/b.js']);
    expect(build(LINES).computed).toEqual([]);
  });

  it('reads an HTML root-relative src from the repository root and a page-relative one from the page', () => {
    const g = build([
      { path: 'ui/index.html', text: '<script src="/src/thing.js"></script>' },
      { path: 'ui/page.html', text: '<script src="../src/app.js"></script>' },
    ]);
    expect(g.importers['src/thing.js']).toEqual(['ui/index.html']);
    expect(g.importers['src/app.js']).toEqual(['ui/page.html']);
  });

  it('resolves an extensionless specifier, an explicit one and a directory to the tracked file', () => {
    const g = build([
      { path: 'src/app.js', text: "require('./thing')" },
      { path: 'src/use-util.js', text: "require('./util')" },
      { path: 'tests/thing.test.js', text: "require('../src/thing.js')" },
    ]);
    expect(g.importers['src/thing.js']).toEqual(['src/app.js', 'tests/thing.test.js']);
    expect(g.importers['src/util/index.js']).toEqual(['src/use-util.js']);
  });

  it('prefers the file a specifier names exactly over the same name plus an extension', () => {
    const g = build([{ path: 'src/user.js', text: "require('./data')" }], ['src/data', 'src/data.js', 'src/user.js']);
    expect(g.importers).toEqual({ 'src/data': ['src/user.js'] });
  });

  it('resolves a TypeScript specifier that names the compiled extension', () => {
    const g = build([{ path: 'src/a.ts', text: "import { b } from './b.js';" }], ['src/a.ts', 'src/b.ts']);
    expect(g.importers['src/b.ts']).toEqual(['src/a.ts']);
  });

  it('keys an unresolvable relative specifier by its normalized path and drops one that leaves the repository', () => {
    const g = build([
      { path: 'src/a.js', text: "require('./gone')" },
      { path: 'src/b.js', text: "require('../../../escape')" },
    ]);
    expect(g.importers).toEqual({ 'src/gone': ['src/a.js'] });
  });

  it('ignores a file importing itself and lines it cannot read', () => {
    const g = build([{ path: 'src/a.js', text: "require('./a')" }, { path: '', text: "require('./x')" }, { path: 'src/c.js' }, null], ['src/a.js']);
    expect(g.importers).toEqual({});
  });

  it('lists every tracked test file for the name match, and is the same for the same input', () => {
    const a = build(LINES);
    expect(a.testFiles).toEqual(['tests/app-flow.test.js', 'tests/stem/thing.spec.js', 'tests/thing.test.js']);
    expect(JSON.stringify(build(LINES.slice().reverse()))).toBe(JSON.stringify(a));
  });
});
