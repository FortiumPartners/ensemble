'use strict';
/**
 * Tests for TRD-2026-8d825f54 TRD-002: per-category contract versioning,
 * `checkCompat()` and `checkAdditiveOnly()` in
 * packages/development/lib/toolchain/contracts.js (PRD REQ-003, AC-003-1, AC-003-2, AC-003-3).
 */

const path = require('path');

const { checkCompat, checkAdditiveOnly, loadContracts } = require('../../packages/development/lib/toolchain/contracts');

const CATEGORIES_DIR = path.join(
  __dirname,
  '..',
  '..',
  'packages',
  'development',
  'toolchain',
  'categories'
);

describe('checkCompat', () => {
  test('AC-003-1: adapter targeting an earlier minor sees a later-minor capability as unavailable but ok', () => {
    const contract = {
      version: '1.1',
      capabilities: {
        base: { inputs: ['in'], outputs: ['out'], required: true },
        x: { inputs: ['in'], outputs: ['out'], required: false, addedInMinor: 1 }
      }
    };

    const result = checkCompat('1.0', contract);

    expect(result.ok).toBe(true);
    expect(result.unavailableCapabilities).toContain('x');
    expect(result.missingCapabilities).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test('AC-003-2: a major-version mismatch is not ok and names every missing capability plus both versions', () => {
    const contract = {
      version: '2.0',
      capabilities: {
        a: { inputs: ['in'], outputs: ['out'], required: true },
        b: { inputs: ['in'], outputs: ['out'], required: false }
      }
    };

    const result = checkCompat('1.3', contract);

    expect(result.ok).toBe(false);
    expect(new Set(result.missingCapabilities)).toEqual(new Set(['a', 'b']));
    expect(result.errors[0]).toEqual(expect.stringContaining('1.3'));
    expect(result.errors[0]).toEqual(expect.stringContaining('2.0'));
  });

  test('AC-003-3 (isolation): bumping an unrelated tracker contract to 2.0 does not affect host/workflow checkCompat results', () => {
    const hostContract = {
      version: '1.0',
      capabilities: {
        start: { inputs: ['in'], outputs: ['out'], required: true }
      }
    };
    const workflowContract = {
      version: '1.0',
      capabilities: {
        run: { inputs: ['in'], outputs: ['out'], required: true }
      }
    };

    const hostResultBefore = checkCompat('1.0', hostContract);
    const workflowResultBefore = checkCompat('1.0', workflowContract);

    // Construct a separately-versioned tracker contract fixture, bumped to a new major.
    const trackerContract = {
      version: '2.0',
      capabilities: {
        track: { inputs: ['in'], outputs: ['out'], required: true }
      }
    };
    checkCompat('1.0', trackerContract);

    const hostResultAfter = checkCompat('1.0', hostContract);
    const workflowResultAfter = checkCompat('1.0', workflowContract);

    expect(hostResultAfter).toEqual(hostResultBefore);
    expect(workflowResultAfter).toEqual(workflowResultBefore);
  });
});

describe('checkAdditiveOnly', () => {
  test('AC-003-3: removing a capability within the same major fails and names the removed capability', () => {
    const previousContract = {
      version: '1.0',
      capabilities: {
        a: { inputs: ['in'], outputs: ['out'], required: true },
        b: { inputs: ['in'], outputs: ['out'], required: true }
      }
    };
    const nextContract = {
      version: '1.1',
      capabilities: {
        a: { inputs: ['in'], outputs: ['out'], required: true }
      }
    };

    const result = checkAdditiveOnly(previousContract, nextContract);

    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes("'b'"))).toBe(true);
  });

  test('flipping a capability required flag within the same major fails and names that capability', () => {
    const previousContract = {
      version: '1.0',
      capabilities: {
        a: { inputs: ['in'], outputs: ['out'], required: true }
      }
    };
    const nextContract = {
      version: '1.1',
      capabilities: {
        a: { inputs: ['in'], outputs: ['out'], required: false }
      }
    };

    const result = checkAdditiveOnly(previousContract, nextContract);

    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes("'a'"))).toBe(true);
  });

  test('adding only a new optional capability within the same major passes', () => {
    const previousContract = {
      version: '1.0',
      capabilities: {
        a: { inputs: ['in'], outputs: ['out'], required: true }
      }
    };
    const nextContract = {
      version: '1.1',
      capabilities: {
        a: { inputs: ['in'], outputs: ['out'], required: true },
        x: { inputs: ['in'], outputs: ['out'], required: false, addedInMinor: 1 }
      }
    };

    const result = checkAdditiveOnly(previousContract, nextContract);

    expect(result).toEqual({ ok: true, errors: [] });
  });

  test('adding a new required capability within the same major fails and names that capability', () => {
    const previousContract = {
      version: '1.0',
      capabilities: {
        a: { inputs: ['in'], outputs: ['out'], required: true }
      }
    };
    const nextContract = {
      version: '1.1',
      capabilities: {
        a: { inputs: ['in'], outputs: ['out'], required: true },
        x: { inputs: ['in'], outputs: ['out'], required: true, addedInMinor: 1 }
      }
    };

    const result = checkAdditiveOnly(previousContract, nextContract);

    expect(result.ok).toBe(false);
    expect(result.errors.some((message) => message.includes("'x'"))).toBe(true);
  });

  test('a major-version bump permits a newly added required capability', () => {
    const previousContract = {
      version: '1.0',
      capabilities: {
        a: { inputs: ['in'], outputs: ['out'], required: true }
      }
    };
    const nextContract = {
      version: '2.0',
      capabilities: {
        a: { inputs: ['in'], outputs: ['out'], required: true },
        x: { inputs: ['in'], outputs: ['out'], required: true }
      }
    };

    const result = checkAdditiveOnly(previousContract, nextContract);

    expect(result).toEqual({ ok: true, errors: [] });
  });
});

/**
 * TRD-2026-8d825f54 TRD-002-TEST: additive-only contract versioning behavior, exercised
 * against the REAL shipped category contract files (not synthetic fixtures) loaded via
 * loadContracts() (PRD REQ-003, AC-003-1, AC-003-2, AC-003-3).
 */
describe('TRD-002-TEST: additive-only contract versioning behavior', () => {
  test('Scenario: Minor contract bump keeps adapter valid -- Given an adapter targeting contract 1.x and a later 1.y contract adding a capability, When the adapter is resolved, Then it still validates and the new capability is treated as unavailable.', () => {
    const contracts = loadContracts(CATEGORIES_DIR);
    const realTracker = contracts['tracker.yaml'];
    expect(realTracker).toBeDefined();
    const realCapabilityNames = Object.keys(realTracker.capabilities);
    expect(realCapabilityNames.length).toBeGreaterThan(0);

    // Deep-clone the REAL tracker contract (it already ships a real 'version') and bump its
    // minor, adding ONE new capability on top of the untouched real ones.
    const bumpedContract = JSON.parse(JSON.stringify(realTracker));
    bumpedContract.version = '1.1';
    // This scenario's premise is that the real contract is at 1.0 and the clone adds its one
    // capability at minor 1. tracker.label-one is genuinely shipped with addedInMinor: 1, so
    // carrying it into the clone would make a real capability unavailable at the 1.0 pin and
    // collide with the "every real capability survives" loop below. Strip the marker from the
    // cloned real capabilities; the scenario then has exactly one addition, tracker.search.
    for (const capability of Object.values(bumpedContract.capabilities)) {
      delete capability.addedInMinor;
    }
    bumpedContract.capabilities['tracker.search'] = {
      inputs: ['query'],
      outputs: ['ids'],
      required: false,
      addedInMinor: 1
    };

    const result = checkCompat('1.0', bumpedContract);

    expect(result.ok).toBe(true);
    expect(result.unavailableCapabilities).toEqual(['tracker.search']);
    expect(result.missingCapabilities).toEqual([]);
    expect(result.errors).toEqual([]);
    // Every REAL tracker capability must survive the minor bump unaffected.
    for (const realCapabilityName of realCapabilityNames) {
      expect(result.unavailableCapabilities).not.toContain(realCapabilityName);
      expect(result.missingCapabilities).not.toContain(realCapabilityName);
    }
  });

  test('Scenario: Major contract mismatch fails -- Given an adapter targeting contract 1.x and an installed contract 2.x, When the adapter is resolved, Then validation fails naming the contract versions and the capabilities the adapter lacks.', () => {
    const contracts = loadContracts(CATEGORIES_DIR);
    const realTracker = contracts['tracker.yaml'];
    expect(realTracker).toBeDefined();
    const realCapabilityNames = Object.keys(realTracker.capabilities);
    expect(realCapabilityNames.length).toBeGreaterThan(0);

    // Same real-capability-based clone as above, bumped to a new major version instead.
    const majorBumpedContract = JSON.parse(JSON.stringify(realTracker));
    majorBumpedContract.version = '2.0';

    const result = checkCompat('1.0', majorBumpedContract);

    expect(result.ok).toBe(false);
    expect(new Set(result.missingCapabilities)).toEqual(new Set(realCapabilityNames));
    expect(result.errors[0]).toEqual(expect.stringContaining('1.0'));
    expect(result.errors[0]).toEqual(expect.stringContaining('2.0'));
  });

  test('Scenario: Tracker major bump is isolated -- Given the tracker contract moves to a new major version, When adapters for other categories are resolved, Then their validation result is unchanged.', () => {
    // Load host from an independent loadContracts() call and deep-clone defensively, so it
    // cannot alias anything the tracker mutation below touches.
    const hostContracts = loadContracts(CATEGORIES_DIR);
    const realHost = hostContracts['host.yaml'];
    expect(realHost).toBeDefined();
    const hostContract = JSON.parse(JSON.stringify(realHost));

    const hostResultBefore = checkCompat('1.0', hostContract);

    // Load tracker from a SECOND, independent loadContracts() call and mutate only that
    // deep-cloned copy's major version; the host contract object above is untouched.
    const trackerContracts = loadContracts(CATEGORIES_DIR);
    const realTracker = trackerContracts['tracker.yaml'];
    expect(realTracker).toBeDefined();
    const trackerContract = JSON.parse(JSON.stringify(realTracker));
    trackerContract.version = '2.0';
    checkCompat('1.0', trackerContract);

    const hostResultAfter = checkCompat('1.0', hostContract);

    expect(hostResultAfter).toEqual(hostResultBefore);
  });
});
