'use strict';

const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '../commands/create-trd-foreman.yaml');
const generatedPath = path.join(__dirname, '../commands/ensemble/create-trd-foreman.md');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function contractSection(text) {
  // Unlike create-trd.yaml, this file references "Output Management" in prose
  // (MCP Enhancement's early-skip step) before the phase heading itself, so
  // anchor on the LAST occurrence -- the actual "- name: Output Management" /
  // "### Phase N: Output Management" heading.
  const outputStart = text.lastIndexOf('Output Management');
  expect(outputStart).toBeGreaterThan(-1);
  const start = text.lastIndexOf('Constitution Gate Contract', outputStart);
  expect(start).toBeGreaterThan(-1);
  return text.slice(start, outputStart);
}

function unguardedConstitutionBypassLines(section) {
  const bypassWords = /(proceed anyway|override|skip|auto-proceed|default-proceed)/i;
  const constitutionScope = /(constitution|article)/i;
  const explicitDeny = /(Do not offer|non-bypassable|there is no)/i;
  return section
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => constitutionScope.test(line) && bypassWords.test(line) && !explicitDeny.test(line));
}

describe('create-trd-foreman constitution gate contract', () => {
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
    expect(contract).toContain('non-bypassable unconditionally');
    expect(contract).toContain('Do not offer any proceed anyway, override, skip, soft-confirmation, or default-proceed path');
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
  ])('%s hard-blocks TRD save and the foreman sling prd next step on violation', (_label, filePath) => {
    const contract = contractSection(read(filePath));

    expect(contract).toContain('before creating docs/TRD/');
    expect(contract).toContain('writing any repo-local TRD artifact');
    expect(contract).toContain('printing success, or printing the foreman sling prd next step');
    expect(contract).toContain('do not write docs/TRD/TRD-YYYY-<TRD_MICRO_UUID>-<slug>.md');
    expect(contract).toContain('do not print the foreman sling prd next-step output');
  });

  test.each([
    ['source YAML', sourcePath],
    ['generated command markdown', generatedPath],
  ])('%s adds the saved-document success audit status', (_label, filePath) => {
    const text = read(filePath);

    expect(text).toContain('Constitution compliance: passed');
    expect(text).toContain('only after constitution compliance passes');
  });

  test('source YAML constraints list constrains save to gate pass (constraints: is source-only, not rendered to the generated markdown)', () => {
    const text = read(sourcePath);
    expect(text).toContain('DO NOT save the TRD until the Constitution Gate Contract passes');
  });
});
