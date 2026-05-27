'use strict';

/**
 * Unit tests for known-model-ids.js
 */

const { KNOWN_MODEL_IDS } = require('../lib/known-model-ids');

describe('KNOWN_MODEL_IDS', () => {
  test('is frozen (immutable)', () => {
    expect(Object.isFrozen(KNOWN_MODEL_IDS)).toBe(true);
  });

  test('all entries are non-empty strings', () => {
    expect(KNOWN_MODEL_IDS.length).toBeGreaterThan(0);
    for (const id of KNOWN_MODEL_IDS) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  test('no entry matches the *-latest pattern', () => {
    for (const id of KNOWN_MODEL_IDS) {
      expect(id).not.toMatch(/-latest$/);
    }
  });

  test('contains at least 3 model IDs', () => {
    expect(KNOWN_MODEL_IDS.length).toBeGreaterThanOrEqual(3);
  });

  test('contains expected model IDs', () => {
    expect(KNOWN_MODEL_IDS).toContain('claude-opus-4-7');
    expect(KNOWN_MODEL_IDS).toContain('claude-sonnet-4-6');
    expect(KNOWN_MODEL_IDS).toContain('claude-haiku-4-5-20251001');
  });
});
