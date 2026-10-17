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

describe('trd-cli list and status accept Title-Case frontmatter keys', () => {
  let dir;
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
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

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
