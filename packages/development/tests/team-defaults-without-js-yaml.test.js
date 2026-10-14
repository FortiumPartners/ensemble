'use strict';

/**
 * REGRESSION (br-kzn, br-s7k): a marketplace-cache install of ensemble-development
 * has no node_modules (nothing runs `npm install` there), and team-defaults.js did a
 * bare `require('js-yaml')` at module scope, so implement-trd-beads' Team
 * Configuration Detection step crashed the moment the module loaded.
 *
 * These tests load the module with js-yaml unresolvable and require the roster to
 * match what the real YAML parse produces.
 */

const DOMAIN_SETS = [
  [],
  ['backend'],
  ['backend', 'frontend'],
  ['database'],
  ['security'],
  ['backend', 'frontend', 'infrastructure', 'devops'],
];

/** Load team-defaults.js in a fresh module registry, optionally with js-yaml missing. */
function loadTeamDefaults({ withoutJsYaml }) {
  let mod;
  jest.isolateModules(() => {
    if (withoutJsYaml) {
      jest.doMock('js-yaml', () => {
        const err = new Error("Cannot find module 'js-yaml'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
      });
    }
    mod = require('../lib/team-defaults');
  });
  jest.dontMock('js-yaml');
  return mod;
}

describe('team-defaults without js-yaml', () => {
  const withYaml = loadTeamDefaults({ withoutJsYaml: false });

  test('the module still loads', () => {
    expect(() => loadTeamDefaults({ withoutJsYaml: true })).not.toThrow();
  });

  test('default_agents read without js-yaml equals the YAML-parsed map', () => {
    const without = loadTeamDefaults({ withoutJsYaml: true });
    const expected = withYaml.loadTeamConfiguration().default_agents;
    expect(Object.keys(expected).length).toBeGreaterThan(0);
    expect(without.loadTeamConfiguration().default_agents).toEqual(expected);
  });

  test.each(DOMAIN_SETS.map((domains) => [domains.join(',') || '(none)', domains]))(
    'resolveDefaultTeamRoles gives the same roster for domains %s',
    (_label, domains) => {
      const without = loadTeamDefaults({ withoutJsYaml: true });
      expect(without.resolveDefaultTeamRoles({ domains })).toEqual(
        withYaml.resolveDefaultTeamRoles({ domains })
      );
    }
  );
});
