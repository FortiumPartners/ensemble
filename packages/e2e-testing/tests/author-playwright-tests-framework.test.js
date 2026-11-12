'use strict';

/**
 * Contract for the test-framework wiring in /ensemble:author-playwright-tests: the command detects the consuming
 * project's framework once, tells the authoring agent, and lands the test with spec-writer in that framework.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { resolveSkillFile, listSkillReferences, readSkillProse } = require('../../../scripts/lib/skill-backed-command');

const PKG = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(PKG, ...p), 'utf8');

// author-playwright-tests is skill-backed: its YAML is a manifest and its prompt is its skill.
// The skill's references/phase-N-*.md files hold the workflow as `### Phase N: <name>` headings,
// `#### Step N.M: <title>` headings, a description and `- <action>` bullets; read them back into
// the phases/steps/actions shape this contract asserts on (same reader as the evidence contract).
const yamlPath = path.join(PKG, 'commands', 'author-playwright-tests.yaml');
const manifest = yaml.load(fs.readFileSync(yamlPath, 'utf8'));
const skillFile = resolveSkillFile(yamlPath, manifest.skill);

function parsePhases(files) {
  const parsed = [];
  let current = null;
  let currentStep = null;
  let inActions = false;
  for (const file of files) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      let match = /^### Phase (\d+): (.+)$/.exec(line);
      if (match) {
        current = { name: match[2], steps: [] };
        parsed.push(current);
        currentStep = null;
        continue;
      }
      match = /^#### Step \d+\.(\d+): (.+)$/.exec(line);
      if (match && current) {
        currentStep = { order: Number(match[1]), title: match[2], actions: [] };
        current.steps.push(currentStep);
        inActions = false;
        continue;
      }
      if (!currentStep || line.trim() === '') continue;
      if (line.startsWith('- ')) {
        currentStep.actions.push(line.slice(2));
        inActions = true;
      } else if (inActions) {
        currentStep.actions[currentStep.actions.length - 1] += `\n${line}`;
      }
    }
  }
  return parsed;
}

const phases = parsePhases(listSkillReferences(skillFile));

const phase = (name) => phases.find((p) => p.name === name);
const actions = (phaseName, title) => phase(phaseName).steps.find((s) => s.title === title).actions.map(String).join('\n');

describe('the framework is detected once, before any test is proposed', () => {
  const setup = actions('Execution Setup', 'Ensure the Screenshot Helper');

  test('Execution Setup detects it from the E2E project and defaults to NUnit', () => {
    expect(setup).toContain('detectE2eFrameworkInDir(');
    expect(setup).toContain('$E2E_LIB/e2e-framework.js');
    expect(setup).toContain('"nunit" when it returns null');
  });

  test('that setup runs before the proposals and the runs', () => {
    const names = phases.map((p) => p.name);
    expect(names.indexOf('Execution Setup')).toBeLessThan(names.indexOf('REQ Batching and Delegation'));
  });
});

describe('the framework reaches the author and the writer', () => {
  test('the proposal request carries it, so an xUnit body builds its own page like the sibling tests', () => {
    const text = actions('REQ Batching and Delegation', 'Delegate the Proposal (Ground + Author, No Run) to @playwright-tester');
    expect(text).toContain('{acText, groundingDiff, acId, framework}');
    expect(text).toContain("framework is Phase 2 step 4's result");
    expect(text).toMatch(/xunit test builds its own page the way the project's sibling tests do/);
  });

  test('landing passes it to spec-writer and names what a new xUnit file needs', () => {
    const text = actions('Decision and Local Landing', 'Land the Confirmed, Passed Test');
    expect(text).toContain('specDetails.framework');
    expect(text).toContain('[Test] (nunit) or [Fact] (xunit)');
    expect(text).toContain('{collection, fixtureType} copied from a sibling spec class');
    expect(text).toMatch(/refuses to append the wrong framework to an existing file/);
  });

  test('the agent knows the field and what xunit means for the body', () => {
    const agent = read('agents', 'playwright-tester.yaml');
    expect(agent).toContain('Request {acText, groundingDiff, acId?, framework?}');
    expect(agent).toContain("framework 'xunit' means no PageTest `Page`");
  });
});

describe('the modules the command names exist', () => {
  test('e2e-framework.js is a real lib module the command resolves through $E2E_LIB', () => {
    expect(readSkillProse(skillFile)).toContain('$E2E_LIB/e2e-framework.js');
    expect(fs.existsSync(path.join(PKG, 'lib', 'e2e-framework.js'))).toBe(true);
  });
});
