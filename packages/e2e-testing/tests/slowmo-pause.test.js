'use strict';

/**
 * Follow-along pause (br-author-pw-slowmo-ug1): a headed run can ask Playwright
 * for a SlowMo delay so the QA engineer can watch it. It is a launch option,
 * never text in the test source, so nothing needs stripping before landing.
 */

const fs = require('fs');
const path = require('path');

const { resolveRunConfig } = require('../lib/test-runner-mode');
const { validateRunRequest } = require('../lib/delegation-contract');

const yamlText = fs.readFileSync(path.join(__dirname, '../commands/author-playwright-tests.yaml'), 'utf8');
const agentText = fs.readFileSync(path.join(__dirname, '../agents/playwright-tester.yaml'), 'utf8');

describe('resolveRunConfig slowMoMs', () => {
  test('headed with a live login carries slowMo', () => {
    expect(resolveRunConfig('headed', undefined, { slowMoMs: 1000 })).toEqual({
      mode: 'headed',
      headless: false,
      auth: { strategy: 'interactive-login', authStatePath: null },
      slowMo: 1000,
    });
  });

  test('headed with a stored auth state carries slowMo', () => {
    const config = resolveRunConfig('headed', '/secure/state.json', { slowMoMs: 2500 });
    expect(config.slowMo).toBe(2500);
    expect(config.auth.strategy).toBe('stored-storage-state');
  });

  test('omitted slowMoMs leaves the config shape untouched (no slowMo key)', () => {
    expect(Object.keys(resolveRunConfig('headed')).sort()).toEqual(['auth', 'headless', 'mode']);
    expect(Object.keys(resolveRunConfig('headed', undefined, { slowMoMs: null })).sort()).toEqual([
      'auth',
      'headless',
      'mode',
    ]);
  });

  test('headless rejects slowMoMs — no human is watching', () => {
    expect(() => resolveRunConfig('headless', '/secure/state.json', { slowMoMs: 1000 })).toThrow(/headed/);
  });

  test.each([0, -5, 1.5, '1000', NaN, Infinity])('rejects invalid slowMoMs %p', (bad) => {
    expect(() => resolveRunConfig('headed', undefined, { slowMoMs: bad })).toThrow(/positive integer/);
  });
});

describe('validateRunRequest slowMoMs', () => {
  const base = {
    acText: 'Given X when Y then Z',
    groundingDiff: { grounded: true },
    proposedTest: 'await Page.GotoAsync(TestConfiguration.QaBaseUrl);',
    targetEnv: 'https://qa.example.com',
    mode: 'headed',
  };

  test('headed request with slowMoMs is valid', () => {
    expect(validateRunRequest({ ...base, slowMoMs: 1000 })).toBe(true);
  });

  test('request without slowMoMs is still valid in either mode', () => {
    expect(validateRunRequest(base)).toBe(true);
    expect(validateRunRequest({ ...base, mode: 'headless', authStatePath: '/s.json' })).toBe(true);
  });

  test('headless request with slowMoMs is rejected', () => {
    expect(() => validateRunRequest({ ...base, mode: 'headless', slowMoMs: 1000 })).toThrow(/headed/);
  });

  test.each([0, -1, 0.5, '1000', null])('rejects invalid slowMoMs %p', (bad) => {
    expect(() => validateRunRequest({ ...base, slowMoMs: bad })).toThrow(/positive integer/);
  });
});

describe('author-playwright-tests.yaml wiring', () => {
  test('the pause prompt comes after QA-env verification and before the REQ loop', () => {
    const envIndex = yamlText.indexOf('Resolve and Verify the QA Environment');
    const pauseIndex = yamlText.indexOf('Offer a Follow-Along Pause');
    const reqLoopIndex = yamlText.indexOf('REQ Batching and Delegation');
    expect(envIndex).toBeGreaterThan(-1);
    expect(pauseIndex).toBeGreaterThan(envIndex);
    expect(pauseIndex).toBeLessThan(reqLoopIndex);
  });

  test('the prompt is skipped in headless mode and defaults to 1000 ms', () => {
    const step = yamlText.slice(yamlText.indexOf('Offer a Follow-Along Pause'), yamlText.indexOf('REQ Batching and Delegation'));
    expect(step).toMatch(/headless: skip this step entirely/);
    expect(step).toContain('slowMoMs = 1000');
  });

  test('the Run request carries slowMoMs and forbids sleeping in the test source', () => {
    const runStep = yamlText.slice(yamlText.indexOf('Run the Confirmed Test'), yamlText.indexOf('Land the Confirmed, Passed Test'));
    expect(runStep).toContain('slowMoMs');
    expect(runStep).toMatch(/never add a sleep or wait to proposedTest/);
  });

  test('the agent applies SlowMo as a launch option, never in the test source', () => {
    expect(agentText).toContain('SlowMo launch option');
    expect(agentText).toMatch(/never add a sleep\/WaitForTimeout to proposedTest/);
  });
});
