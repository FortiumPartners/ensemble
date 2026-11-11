'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { readSkillReference } = require('./helpers/pr-review-cycle-skill');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const json = (...p) => JSON.parse(read(...p));

describe('final review prose and versions', () => {
  test('cycle gate step treats a missing ledger as unavailable, never []', () => {
    const step = readSkillReference('merge-gate.md');
    expect(step).toMatch(/missing ledger is unavailable, never empty/i);
    expect(step).toMatch(/review-data-unavailable/);
    expect(step).toMatch(/Do not pass\s+`\[\]`/);
  });

  test('pr-merge refuses to pass an empty ledger when no review is recorded', () => {
    const cmd = read('packages/git/skills/ensemble-pr-merge/SKILL.md');
    expect(cmd).toMatch(/never be given an empty ledger/);
    expect(cmd).toMatch(/MODE=local\/remote/);
  });

  test('cycle Step 4 uses the closed severity vocabulary', () => {
    const skill = read('packages/development/skills/pr-review-cycle/SKILL.md');
    const step4 =
      skill.slice(skill.indexOf('### Step 4'), skill.indexOf('### Step 5')) +
      readSkillReference('triage-fix-reverify.md').split('### Step 5')[0];
    expect(step4).not.toMatch(/Critical|Major|Minor/);
    expect(step4).toMatch(/Important/);
  });

  test('sweep records through recordRound with a valid disposition and a declaration object', () => {
    const skill = read('packages/development/skills/pr-review-sweep/SKILL.md');
    expect(skill).toMatch(/recordRound/);
    expect(skill).toMatch(/fix\|duplicate\|not-applicable\|deferred\|adjudicate\|resolved/);
    expect(skill).toMatch(/declaration`\s+is `\{ sourceSha/);
  });

  test('explainer TIER is lowercase', () => {
    const skill = read('packages/development/skills/pr-review-explainer/SKILL.md');
    expect(skill).toMatch(/'low'` \\\| `'medium'` \\\| `'high'`/);
    expect(skill).not.toMatch(/'Medium'/);
  });

  test('code-reviewer output contract includes disposition', () => {
    const doc = yaml.load(read('packages/quality/agents/code-reviewer.yaml'));
    expect(doc.outputContract.findingFields).toContain('disposition');
  });

  test('pi and full versions agree across package.json, plugin.json and both marketplaces', () => {
    for (const [pkg, name, npmName] of [
      ['pi', 'ensemble-pi'],
      ['full', 'ensemble-full'],
    ]) {
      const v = json('packages', pkg, 'package.json').version;
      expect(json('packages', pkg, '.claude-plugin', 'plugin.json').version).toBe(v);
      for (const m of ['marketplace.json', '.claude-plugin/marketplace.json']) {
        const entry = json(m).plugins.find((p) => p.name === name);
        expect(entry.version).toBe(v);
      }
    }
  });
});
