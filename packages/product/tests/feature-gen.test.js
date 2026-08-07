'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parsePRD } = require('../lib/prd-parser');
const {
  hashAc,
  renderFeature,
  buildArtifacts,
  writeArtifacts,
} = require('../lib/feature-gen');

const SAMPLE = fs.readFileSync(
  path.join(__dirname, 'fixtures/PRD-sample.md'),
  'utf8'
);
const prd = parsePRD(SAMPLE);

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'feat-test-'));
}

describe('hashAc', () => {
  test('is stable and normalization-insensitive to whitespace/case', () => {
    const a = { id: 'AC-001-1', given: 'a user', when: 'x', then: 'y', raw: '' };
    const b = { id: 'AC-001-1', given: 'A   USER', when: 'X', then: 'Y', raw: '' };
    expect(hashAc(a)).toBe(hashAc(b));
    expect(hashAc(a)).toMatch(/^[0-9a-f]{12}$/);
  });

  test('changes when the AC content changes', () => {
    const a = { id: 'AC-001-1', given: 'a user', when: 'x', then: 'y', raw: '' };
    const c = { id: 'AC-001-1', given: 'a user', when: 'x', then: 'z', raw: '' };
    expect(hashAc(a)).not.toBe(hashAc(c));
  });
});

describe('renderFeature', () => {
  const req = prd.reqs[0];
  const text = renderFeature(prd, req);

  test('emits Feature + traceability tags', () => {
    expect(text).toContain('@prd-2026-a1b2c3d4');
    expect(text).toContain('@REQ-001');
    expect(text).toContain('Feature: User Authentication');
  });

  test('shows the human label (authored) as a comment, id still the key', () => {
    expect(text).toContain('# Label: prd-sample-feature');
  });

  test('falls back to a derived label when none is authored', () => {
    const noLabel = { ...prd, label: null, documentId: 'PRD-2026-zz', title: 'Login Flow' };
    const t = renderFeature(noLabel, noLabel.reqs[0]);
    expect(t).toContain('# Label: prd-login-flow');
  });

  test('emits a tagged, hashed Scenario per AC with Given/When/Then steps', () => {
    expect(text).toContain('@AC-001-1');
    expect(text).toMatch(/@hash:[0-9a-f]{12}/);
    expect(text).toContain('Given a user with valid credentials');
    expect(text).toContain('When they submit the login form');
    expect(text).toContain('Then they are authenticated and see the dashboard');
  });

  test('marks needs-clarification ACs without dropping them', () => {
    const reqText = renderFeature(prd, prd.reqs[1]);
    expect(reqText).toContain('@needs-clarification');
    expect(reqText).toContain('# NEEDS CLARIFICATION');
    // free-form AC text is still preserved as a comment
    expect(reqText).toContain('AC-002-2');
  });
});

test('renders structured needs-clarification ACs as comments only', () => {
  const marked = parsePRD(`---
document_id: PRD-2026-clarify
label: clarify-marker
---

# PRD-2026-clarify: Clarification Marker

### REQ-101: Clarify Structured AC [Must] [Low]

- **AC-101-1:** Given a customer has a saved card, when they check out, then payment is captured [NEEDS CLARIFICATION: confirm SCA rules].
`);
  const markedText = renderFeature(marked, marked.reqs[0]);

  expect(markedText).toContain('@needs-clarification');
  expect(markedText).toContain(
    '# Given a customer has a saved card, when they check out, then payment is captured'
  );
  expect(markedText).not.toMatch(/^    Given /m);
  expect(markedText).not.toMatch(/^    When /m);
  expect(markedText).not.toMatch(/^    Then /m);
});

describe('buildArtifacts + manifest', () => {
  const artifacts = buildArtifacts(prd, 'PRD-sample');

  test('produces one feature file per requirement plus a manifest', () => {
    const names = artifacts.files.map((f) => f.relPath).sort();
    expect(names).toEqual(['REQ-001.feature', 'REQ-002.feature']);
    expect(artifacts.manifest.prd.document_id).toBe('PRD-2026-a1b2c3d4');
    expect(artifacts.manifest.prd.label).toBe('prd-sample-feature');
  });

  test('manifest maps every AC to req, hash, file and clarification flag', () => {
    const m = artifacts.manifest.acs;
    expect(Object.keys(m).sort()).toEqual([
      'AC-001-1',
      'AC-001-2',
      'AC-002-1',
      'AC-002-2',
      'AC-002-3',
    ]);
    expect(m['AC-001-1'].req).toBe('REQ-001');
    expect(m['AC-001-1'].feature_file).toBe('REQ-001.feature');
    expect(m['AC-001-1'].hash).toMatch(/^[0-9a-f]{12}$/);
    expect(m['AC-002-2'].needs_clarification).toBe(true);
  });
});

describe('writeArtifacts', () => {
  test('writes feature files + manifest to disk', () => {
    const dir = mkTmp();
    const res = writeArtifacts(prd, 'PRD-sample', dir);
    expect(fs.existsSync(path.join(res.outDir, 'REQ-001.feature'))).toBe(true);
    expect(fs.existsSync(path.join(res.outDir, '.prd-trace.json'))).toBe(true);
  });

  test('is idempotent — re-running yields byte-identical output', () => {
    const dir = mkTmp();
    writeArtifacts(prd, 'PRD-sample', dir);
    const first = fs.readFileSync(
      path.join(dir, 'PRD-sample', 'REQ-001.feature'),
      'utf8'
    );
    const firstManifest = fs.readFileSync(
      path.join(dir, 'PRD-sample', '.prd-trace.json'),
      'utf8'
    );
    writeArtifacts(prd, 'PRD-sample', dir);
    const second = fs.readFileSync(
      path.join(dir, 'PRD-sample', 'REQ-001.feature'),
      'utf8'
    );
    const secondManifest = fs.readFileSync(
      path.join(dir, 'PRD-sample', '.prd-trace.json'),
      'utf8'
    );
    expect(second).toBe(first);
    expect(secondManifest).toBe(firstManifest);
  });

  test('dry run writes nothing', () => {
    const dir = mkTmp();
    const res = writeArtifacts(prd, 'PRD-sample', dir, { dryRun: true });
    expect(fs.existsSync(res.outDir)).toBe(false);
    expect(res.planned.length).toBeGreaterThan(0);
  });
});
