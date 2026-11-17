'use strict';

/** Kit test for the `detect-stack` eval: the checks pass on a correct stack file and fail on plausible wrong ones. */

const path = require('path');
const kit = require('../skill-eval-kit');
const { detect } = require('../../../packages/core/skills/detect-stack/detect-stack');

const ID = 'detect-stack';
const STACK = 'docs/stack.json';
const IDS = ['stack-saved', 'stack-framework', 'stack-test', 'tooling-detected', 'tooling-no-extras', 'stack-cloud', 'no-stray-files'];

const GOOD = { framework: 'react', test: 'jest', tooling: ['helm'], cloud: 'aws' };
const stackOf = (over) => JSON.stringify({ ...GOOD, ...over }, null, 2);
const saves = (text, extra = {}) => (ws) => {
  if (text !== null) ws.write(STACK, text);
  for (const [rel, body] of Object.entries(extra)) ws.write(rel, body);
};

describe(`${ID} eval`, () => {
  test('loads clean: valid definition, fixture without agent or git configuration', () => {
    const ev = kit.loadsClean(ID);
    expect(ev.invocation).toBe('plain');
    expect(ev.runtimes).toEqual(['claude']);
  });

  test('calibration: the real detector reports exactly the expected answers on the fixture', async () => {
    const dir = path.join(kit.getEval(ID).fixtureDir);
    const top = async (axisName) => (await detect(axisName, dir));
    expect((await top('framework')).primary).toBe('react');
    const test = await top('test');
    expect(test.primary).toBe('jest');
    expect(test.results.map((r) => r.name)).toEqual(expect.arrayContaining(['jest', 'pytest'])); // the decoys the check refuses
    expect((await top('tooling')).results.map((r) => r.name)).toEqual(['helm']);
    expect((await top('cloud')).primary).toBe('aws');
  });

  test('a correct stack file passes every check', async () => {
    const res = await kit.runEval(ID, saves(stackOf({})));
    expect(Object.keys(res)).toEqual(IDS);
    kit.expectAllPass(res);
  });

  test('harmless variations still pass: case, ".js", {name} objects', async () => {
    const res = await kit.runEval(ID, saves(stackOf({ framework: 'React.js', test: [{ name: 'Jest' }], tooling: [{ name: 'Helm' }], cloud: 'AWS' })));
    kit.expectAllPass(res);
  });

  test('a run that writes nothing fails the six answer checks and passes the stray-file check', async () => {
    kit.expectFails(await kit.runEval(ID, saves(null)), ['stack-saved', 'stack-framework', 'stack-test', 'tooling-detected', 'tooling-no-extras', 'stack-cloud'], /not written/, { only: true });
  });

  test('prose instead of JSON fails stack-saved', async () => {
    const res = await kit.runEval(ID, saves('The project uses React, Jest, Helm and AWS.'));
    kit.expectFails(res, 'stack-saved', /not valid JSON/);
  });

  test('a missing axis fails stack-saved', async () => {
    const res = await kit.runEval(ID, saves(JSON.stringify({ framework: 'react', test: 'jest', tooling: ['helm'] })));
    kit.expectFails(res, 'stack-saved', /lacks: cloud/);
  });

  test('a stack file without the tooling key fails tooling-detected naming the key', async () => {
    kit.expectFails(await kit.runEval(ID, saves(JSON.stringify({ framework: 'react', test: 'jest', cloud: 'aws' }))), 'tooling-detected', /no "tooling" key/);
  });

  test('the wrong framework fails stack-framework only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(stackOf({ framework: 'nestjs' }))), 'stack-framework', /expected exactly react/, { only: true });
  });

  test('listing the 0.2 decoy runners next to jest fails stack-test only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(stackOf({ test: ['jest', 'pytest', 'xunit'] }))), 'stack-test', /jest, pytest, xunit/, { only: true });
  });

  test('missing helm fails tooling-detected (and has no extras)', async () => {
    kit.expectFails(await kit.runEval(ID, saves(stackOf({ tooling: [] }))), 'tooling-detected', /missing helm/, { only: true });
  });

  test('an unsupported extra tool fails tooling-no-extras only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(stackOf({ tooling: ['helm', 'kubernetes'] }))), 'tooling-no-extras', /kubernetes/, { only: true });
  });

  test('null or the wrong cloud fails stack-cloud only', async () => {
    kit.expectFails(await kit.runEval(ID, saves(stackOf({ cloud: null }))), 'stack-cloud', /empty/, { only: true });
    kit.expectFails(await kit.runEval(ID, saves(stackOf({ cloud: 'gcp' }))), 'stack-cloud', /expected exactly aws/, { only: true });
  });

  test('a helper file written in the project fails no-stray-files only', async () => {
    const res = await kit.runEval(ID, saves(stackOf({}), { 'detect.js': 'module.exports = {};\n' }));
    kit.expectFails(res, 'no-stray-files', /detect\.js/, { only: true });
  });

  test('a stack file that is a JSON array fails stack-saved', async () => {
    kit.expectFails(await kit.runEval(ID, saves('["react","jest"]')), 'stack-saved', /not a JSON object/);
  });

  test('arms: baseline loads nothing, with-skill loads packages/core; the prompt is plain in both', async () => {
    const { baseline, withSkill } = await kit.armsFor(ID);
    expect(baseline.plugins).toEqual([]);
    expect(withSkill.plugins).toHaveLength(1);
    expect(withSkill.plugins[0]).toMatch(/packages\/core$/);
    expect(withSkill.prompt).toBe(baseline.prompt);
    expect(baseline.prompt).not.toMatch(/^\//);
  }, 60000);
});
