'use strict';

const { diffDrift } = require('../lib/drift');

// A minimal "current PRD" parse: only the bits diffDrift reads.
function prdWith(acs) {
  return {
    documentId: 'PRD-2026-a1b2c3d4',
    reqs: [{ id: 'REQ-001', acs }],
  };
}

const baseManifest = {
  prd: { document_id: 'PRD-2026-a1b2c3d4' },
  acs: {
    'AC-001-1': { req: 'REQ-001', hash: 'aaaaaaaaaaaa', feature_file: 'REQ-001.feature' },
    'AC-001-2': { req: 'REQ-001', hash: 'bbbbbbbbbbbb', feature_file: 'REQ-001.feature' },
  },
};

// hashAc-compatible stub ACs: feature-gen.hashAc hashes normalized text, so we
// build ACs whose real hash we precompute via the same module.
const { hashAc } = require('../lib/feature-gen');

describe('diffDrift', () => {
  test('reports IN_SYNC when manifest hashes match current ACs', () => {
    const ac1 = { id: 'AC-001-1', given: 'g1', when: 'w1', then: 't1' };
    const ac2 = { id: 'AC-001-2', given: 'g2', when: 'w2', then: 't2' };
    const manifest = {
      prd: { document_id: 'PRD-2026-a1b2c3d4' },
      acs: {
        'AC-001-1': { req: 'REQ-001', hash: hashAc(ac1), feature_file: 'REQ-001.feature' },
        'AC-001-2': { req: 'REQ-001', hash: hashAc(ac2), feature_file: 'REQ-001.feature' },
      },
    };
    const res = diffDrift(prdWith([ac1, ac2]), manifest);
    expect(res.inSync).toBe(true);
    expect(res.added).toEqual([]);
    expect(res.removed).toEqual([]);
    expect(res.changed).toEqual([]);
  });

  test('treats a matching AC set from a different PRD document as drift', () => {
    const ac1 = { id: 'AC-001-1', given: 'g1', when: 'w1', then: 't1' };
    const ac2 = { id: 'AC-001-2', given: 'g2', when: 'w2', then: 't2' };
    const manifest = {
      prd: { document_id: 'PRD-2026-different' },
      acs: {
        'AC-001-1': { req: 'REQ-001', hash: hashAc(ac1), feature_file: 'REQ-001.feature' },
        'AC-001-2': { req: 'REQ-001', hash: hashAc(ac2), feature_file: 'REQ-001.feature' },
      },
    };

    const res = diffDrift(prdWith([ac1, ac2]), manifest);

    expect(res.inSync).toBe(false);
    expect(res.prdMismatch).toBe(true);
    expect(res.added).toEqual([]);
    expect(res.removed).toEqual([]);
    expect(res.changed).toEqual([]);
  });

  test('detects ADDED ACs (present in PRD, absent from manifest)', () => {
    const ac1 = { id: 'AC-001-1', given: 'g1', when: 'w1', then: 't1' };
    const acNew = { id: 'AC-001-9', given: 'gn', when: 'wn', then: 'tn' };
    const manifest = {
      prd: { document_id: 'PRD-2026-a1b2c3d4' },
      acs: { 'AC-001-1': { req: 'REQ-001', hash: hashAc(ac1), feature_file: 'REQ-001.feature' } },
    };
    const res = diffDrift(prdWith([ac1, acNew]), manifest);
    expect(res.inSync).toBe(false);
    expect(res.added).toEqual(['AC-001-9']);
  });

  test('detects REMOVED ACs (in manifest, gone from PRD)', () => {
    const ac1 = { id: 'AC-001-1', given: 'g1', when: 'w1', then: 't1' };
    const manifest = {
      prd: { document_id: 'PRD-2026-a1b2c3d4' },
      acs: {
        'AC-001-1': { req: 'REQ-001', hash: hashAc(ac1), feature_file: 'REQ-001.feature' },
        'AC-001-2': { req: 'REQ-001', hash: 'bbbbbbbbbbbb', feature_file: 'REQ-001.feature' },
      },
    };
    const res = diffDrift(prdWith([ac1]), manifest);
    expect(res.inSync).toBe(false);
    expect(res.removed).toEqual(['AC-001-2']);
  });

  test('detects CHANGED ACs (hash mismatch)', () => {
    const ac1 = { id: 'AC-001-1', given: 'g1 EDITED', when: 'w1', then: 't1' };
    const res = diffDrift(prdWith([ac1]), {
      prd: { document_id: 'PRD-2026-a1b2c3d4' },
      acs: { 'AC-001-1': { req: 'REQ-001', hash: 'aaaaaaaaaaaa', feature_file: 'REQ-001.feature' } },
    });
    expect(res.inSync).toBe(false);
    expect(res.changed).toEqual(['AC-001-1']);
  });
});
