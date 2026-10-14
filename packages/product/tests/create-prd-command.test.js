'use strict';

const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '../commands/create-prd.yaml');
const generatedPath = path.join(__dirname, '../commands/ensemble/create-prd.md');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function contractSection(text) {
  const outputStart = text.indexOf('Output Management');
  expect(outputStart).toBeGreaterThan(-1);
  const start = text.lastIndexOf('Constitution Gate Contract', outputStart);
  expect(start).toBeGreaterThan(-1);
  return text.slice(start, outputStart);
}

function unguardedConstitutionBypassLines(section) {
  const bypassWords = /(proceed anyway|override|skip|auto-proceed|default-proceed)/i;
  const constitutionScope = /(constitution|article)/i;
  const explicitDeny = /(Do not offer|excluded|cannot bypass|non-bypassable|only for non-constitution|preserved only)/i;
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => constitutionScope.test(line) && bypassWords.test(line) && !explicitDeny.test(line));
}

describe('create-prd command document ids', () => {
  test('uses micro UUID artifact IDs instead of sequence numbers', () => {
    const text = read(sourcePath);
    expect(text).toContain('PRD-{current_year}-{micro_uuid}');
    expect(text).toContain('8 lowercase hex');
    expect(text).toContain('Do NOT scan for highest sequence numbers');
    expect(text).toContain('docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md');
    expect(text).not.toContain('find highest PRD-YYYY-NNN and increment');
  });
});

describe('create-prd constitution gate contract', () => {
  test.each([
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  ])('%s pins source precedence, config errors, and non-bypassable semantics', (_label, filePath) => {
    const text = read(filePath);
    const contract = contractSection(text);

    expect(contract).toContain('docs/standards/constitution.md');
    expect(contract).toContain('.specify/memory/constitution.md');
    expect(contract).toContain('strict precedence');
    expect(contract).toContain('normalized contents differ');
    expect(contract).toContain('CONSTITUTION_CONFIG_ERROR');
    expect(contract).toContain('Every enforceable constitution check MUST map to at least one source article id');
    expect(contract).toContain('unmapped article check is a gate configuration failure');
    expect(contract).toContain('Constitution violations are non-bypassable in every mode, including --foreman');
    expect(contract).toContain('Do not offer any proceed anyway, override, skip, soft-confirmation, default-proceed, or Foreman auto-proceed path');
    expect(unguardedConstitutionBypassLines(contract)).toEqual([]);
  });

  test.each([
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  ])('%s requires article-specific violation formatting', (_label, filePath) => {
    const contract = contractSection(read(filePath));

    expect(contract).toContain('article id');
    expect(contract).toContain('article title when available');
    expect(contract).toContain('failing draft section');
    expect(contract).toContain('specific finding');
    expect(contract).toContain('remediation hint');
    expect(contract).toContain('list every failing article id');
    expect(contract).toContain('never collapse them to a generic constitution failure');
  });

  test.each([
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  // The gate blocks whatever next step this command prints. That step used to be
  // create-trd and is now refine-prd -- a created PRD has not been reviewed, and
  // refine-prd is the review. The contract is unchanged: on a violation, nothing
  // downstream gets printed. Only the command named in it moved.
  ])('%s hard-blocks PRD save and the next step on violation', (_label, filePath) => {
    const contract = contractSection(read(filePath));

    expect(contract).toContain('before creating docs/PRD/');
    expect(contract).toContain('writing any repo-local PRD artifact');
    expect(contract).toContain('printing the /ensemble:refine-prd next step');
    expect(contract).toContain('do not write docs/PRD/PRD-YYYY-<micro_uuid>-<slug>.md');
    expect(contract).toContain('do not print /ensemble:refine-prd next-step output');
  });

  test.each([
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  ])('%s records Foreman failure reports separately from successful artifacts', (_label, filePath) => {
    const contract = contractSection(read(filePath));

    expect(contract).toContain('FOREMAN_ARTIFACT_PATH');
    expect(contract).toContain('write a failure phase report to that exact path');
    expect(contract).toContain('creating parent directories as needed');
    expect(contract).toContain('must not claim a saved repo-local PRD artifact');
  });

  test.each([
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  ])('%s preserves non-constitution CONCERNS auto-proceed only after constitution pass', (_label, filePath) => {
    const text = read(filePath);
    const contract = contractSection(text);

    expect(text).toContain('CONCERNS');
    expect(text).toContain('Implementation Readiness Gate');
    expect(contract).toContain('preserved only');
    expect(contract).toContain('non-constitution concerns');
    expect(contract).toContain('constitution violations');
    expect(contract).toContain('CONCERNS auto-proceed');
  });

  test.each([
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  ])('%s adds the saved-document success audit status', (_label, filePath) => {
    const text = read(filePath);

    expect(text).toContain('Constitution compliance: passed');
    expect(text).toContain('only after constitution compliance passes');
  });

  test.each([
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  ])('%s makes the gate observable on every invocation, independent of pass/fail (br-0eg)', (_label, filePath) => {
    const contract = contractSection(read(filePath));

    // Printed unconditionally before source resolution -- makes "gate ran"
    // detectable even when a session is serving a stale, pre-gate cached
    // copy of everything downstream of this line.
    expect(contract).toContain('Constitution Gate: running');
    expect(contract).toContain('MUST print on every single invocation, unconditionally, before any pass/fail/HALT determination');
    // A distinct terminal-status line per outcome, so silence is never
    // possible and "ran and passed" can't be confused with "never ran".
    expect(contract).toContain('Constitution Gate: HALT (CONSTITUTION_CONFIG_ERROR)');
    expect(contract).toContain('Constitution Gate: HALT (article violation:');
    expect(contract).toContain('Constitution Gate: PASSED');
    // The known session-caching staleness risk is documented in the gate
    // itself, not just left to bite silently.
    expect(contract).toContain('Known limitation');
    expect(contract).toContain('keeps serving its first-loaded copy');
    expect(contract).toContain('Restart the session');
  });
});
