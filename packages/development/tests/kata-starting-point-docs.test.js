'use strict';
// TRD-025 / REQ-014: kata starting-point documentation (prerequisites, binding step,
// fresh-project walkthrough, documented unbound message).
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const skillDir = path.join(__dirname, '..', 'skills', 'ensemble-implement-trd-tasks');
const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
const refPath = path.join(__dirname, '..', 'skills', 'implement-trd-tasks-reference', 'reference', 'kata-starting-point.md');
const ref = fs.existsSync(refPath) ? fs.readFileSync(refPath, 'utf8') : '';
const adapter = yaml.load(
  fs.readFileSync(path.join(__dirname, '..', 'skills', 'adapter-tracker-kata', 'adapter.yaml'), 'utf8'),
);
const failMessage = adapter.health.find((h) => h.jsonAssert).jsonAssert.failMessage;

describe('kata starting-point docs (TRD-025)', () => {
  test('AC-014-1: prerequisites name kata 0.23.0, kata init and the binding file', () => {
    expect(ref).toContain('0.23.0');
    expect(ref).toContain('kata init --project <name>');
    expect(ref).toContain('.kata.toml');
    expect(ref).toContain('tracker: kata');
    expect(ref).toContain('.ensemble/toolchain.yaml');
  });

  test('AC-014-2: numbered walkthrough ends in scaffold', () => {
    const steps = ref.match(/^\d+\. .*$/gm) || [];
    expect(steps.length).toBeGreaterThanOrEqual(4);
    expect(steps[0]).toContain('0.23.0');
    expect(steps[1]).toContain('kata init --project');
    expect(steps[2]).toContain('tracker: kata');
    expect(steps[3]).toContain('/ensemble:implement-trd-tasks');
    expect(steps[3]).toMatch(/scaffold/i);
  });

  test('AC-014-3: documents the adapter failMessage verbatim and the HALT', () => {
    expect(typeof failMessage).toBe('string');
    expect(ref).toContain(failMessage);
    // Preflight prints the adapter-prefixed message (verified live: "kata: <failMessage>").
    expect(ref).toContain(`kata: ${failMessage}`);
    expect(ref).toMatch(/HALT/);
    expect(ref).toMatch(/before any work item is written/);
  });

  test('SKILL.md points at the reference and states the prerequisites briefly', () => {
    expect(skill).toContain('implement-trd-tasks-reference');
    expect(skill).toContain('reference/kata-starting-point.md');
    expect(skill).toContain('0.23.0');
    expect(skill).toContain('.kata.toml');
  });
});
