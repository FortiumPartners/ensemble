'use strict';

/**
 * REGRESSION (br-et2): TRD frontmatter was read with snake_case keys only, so a
 * TRD written with Title-Case keys ("Document ID:", "Status:", ...) -- the
 * convention the existing CRIBs TRDs use -- parsed with documentId, label,
 * status and prdReference all null. Key lookup now ignores case and treats
 * spaces, hyphens and underscores alike.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseTRD, getFrontmatterField } = require('../lib/trd-parser');
const { runList, runStatus } = require('../lib/trd-cli');

const PRD = 'docs/PRD/PRD-2026-53de002b-demo.md';
const withFrontmatter = (lines) => `---\n${lines.join('\n')}\n---\n\n# Demo TRD\n`;

const SPELLINGS = {
  snake_case: [
    'document_id: TRD-2026-53de002b',
    'label: trd-demo',
    `prd_reference: ${PRD}`,
    'status: Draft',
    'kind: foundational',
    'design_readiness_score: 4.5',
  ],
  'Title Case': [
    'Document ID: TRD-2026-53de002b',
    'Label: trd-demo',
    `PRD Reference: ${PRD}`,
    'Status: Draft',
    'Kind: foundational',
    'Design Readiness Score: 4.5 — PASS',
  ],
  'bare PRD key (as in existing CRIBs TRDs)': [
    'Document ID: TRD-2026-53de002b',
    'Label: trd-demo',
    `PRD: ${PRD}`,
    'Status: Draft',
    'kind: foundational',
    'Design Readiness Score: 4.5',
  ],
};

describe('parseTRD — frontmatter key spelling', () => {
  test.each(Object.entries(SPELLINGS))('%s keys parse to the same fields', (_name, lines) => {
    const t = parseTRD(withFrontmatter(lines));
    expect(t.documentId).toBe('TRD-2026-53de002b');
    expect(t.label).toBe('trd-demo');
    expect(t.prdReference).toBe(PRD);
    expect(t.status).toBe('Draft');
    expect(t.kind).toBe('foundational');
    expect(t.designReadinessScore).toBe(4.5);
  });

  test('a missing field stays null / default', () => {
    const t = parseTRD(withFrontmatter(['Label: trd-demo']));
    expect(t.documentId).toBeNull();
    expect(t.status).toBeNull();
    expect(t.prdReference).toBeNull();
    expect(t.kind).toBe('trd');
  });
});

describe('getFrontmatterField', () => {
  test('matches regardless of case, spaces, hyphens and underscores', () => {
    for (const key of ['Document ID', 'document-id', 'DOCUMENT_ID', 'document_id']) {
      expect(getFrontmatterField({ [key]: 'x' }, 'document_id')).toBe('x');
    }
  });

  test('tries names in order and skips null values', () => {
    expect(getFrontmatterField({ prd: 'b', source_prd: 'c' }, 'prd_reference', 'prd', 'source_prd')).toBe('b');
    expect(getFrontmatterField({ prd_reference: null, prd: 'b' }, 'prd_reference', 'prd')).toBe('b');
  });

  test('returns undefined for missing fields and absent frontmatter', () => {
    expect(getFrontmatterField({ a: 1 }, 'b')).toBeUndefined();
    expect(getFrontmatterField(null, 'b')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// REGRESSION (br-o701): create-trd-style frontmatter that records the PRD as
// an id in `prd_reference` plus an explicit path in `prd_path` used to parse
// to null, because the frontmatter fallback only looked at PRD_REFERENCE_KEYS
// and looksLikePath() rejects a bare id. completion-verification then skips
// its PRD cross-check step entirely (no PRD linked).
// ---------------------------------------------------------------------------
describe('parseTRD - prd_reference id plus prd_path', () => {
  test('falls back to prd_path when prd_reference is a document id', () => {
    const t = parseTRD(
      withFrontmatter([
        'document_id: TRD-2026-82b6a138',
        'prd_reference: PRD-2026-82b6a138',
        `prd_path: ${PRD}`,
      ])
    );
    expect(t.prdReference).toBe(PRD);
  });

  test('a path-shaped prd_reference still wins over prd_path', () => {
    const t = parseTRD(
      withFrontmatter([
        `prd_reference: ${PRD}`,
        'prd_path: docs/PRD/PRD-2026-99999999-other.md',
      ])
    );
    expect(t.prdReference).toBe(PRD);
  });

  test('prd_path is ignored when a body reference exists', () => {
    const t =
      parseTRD(
        withFrontmatter([`prd_path: ${PRD}`]) +
          '\nBased on PRD: docs/PRD/PRD-2026-11111111-body.md\n'
      );
    expect(t.prdReference).toBe('docs/PRD/PRD-2026-11111111-body.md');
  });

  test('stays null for an id-only reference with no path anywhere', () => {
    const t = parseTRD(withFrontmatter(['prd_reference: PRD-2026-82b6a138']));
    expect(t.prdReference).toBeNull();
  });

  test('a body docs/PRD path takes precedence over prd_path', () => {
    const t = parseTRD(
      withFrontmatter([
        'prd_reference: PRD-2026-82b6a138',
        'prd_path: docs/PRD/PRD-2026-99999999-frontmatter.md',
      ]) + '\nSee docs/PRD/PRD-2026-11111111-body.md for the source.\n'
    );
    expect(t.prdReference).toBe('docs/PRD/PRD-2026-11111111-body.md');
  });
});

describe('trd-cli list and status accept Title-Case frontmatter keys', () => {
  let dir;
  const originalCwd = process.cwd();
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trd-cli-titlecase-'));
    fs.writeFileSync(
      path.join(dir, 'TRD-2026-bbbbbbbb-demo.md'),
      withFrontmatter([
        'Document ID: TRD-2026-bbbbbbbb',
        'PRD: docs/PRD/PRD-2026-bbbbbbbb-demo.md',
        'Version: 1.1.0',
        'Status: Approved',
      ])
    );
    // `list` and `status` ask `br` for bead counts in process.cwd(). Run from the throwaway dir so `br` finds no
    // workspace (NOT_INITIALIZED, counted as zero) instead of creating .beads/ runtime state in the repository.
    process.chdir(dir);
  });
  afterAll(() => {
    process.chdir(originalCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('runList reports id, version, prd_reference and status', () => {
    const [item] = runList(['--type', 'trd', '--dir', dir]).items;
    expect(item.id).toBe('TRD-2026-bbbbbbbb');
    expect(item.version).toBe('1.1.0');
    expect(item.prd_reference).toBe('docs/PRD/PRD-2026-bbbbbbbb-demo.md');
    expect(item.status).toBe('Approved');
  });

  test('runStatus reports version, prd_reference and status', () => {
    const res = runStatus(['demo', '--type', 'trd', '--dir', dir]);
    expect(res.version).toBe('1.1.0');
    expect(res.prd_reference).toBe('docs/PRD/PRD-2026-bbbbbbbb-demo.md');
    expect(res.status).toBe('Approved');
  });
});
