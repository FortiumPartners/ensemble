'use strict';

/**
 * The bundle exposes ONE prd-cli.js (packages/full/lib/prd-cli.js). It must
 * serve both command sets: the registry commands (list, status,
 * migrate-frontmatter) that the development package ships and the feature
 * pipeline commands (parse, generate-features, check-drift) that the product
 * package ships.
 *
 * These tests are the superset proof: for every registry subcommand the
 * product CLI must behave exactly like the development CLI (same stdout JSON,
 * same exit code, same file effects).
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PRODUCT_CLI = path.resolve(__dirname, '..', 'lib', 'prd-cli.js');
const DEVELOPMENT_CLI = path.resolve(__dirname, '..', '..', 'development', 'lib', 'prd-cli.js');

const PRD_FIXTURE = `---
id: PRD-001
status: Draft
design_readiness_score: 3
---

# Sample PRD

## REQ-001: The system shall do the thing

### AC-001: The thing happens

### AC-002: The other thing happens
`;

const SECOND_PRD_FIXTURE = `---
id: PRD-002
status: Approved
design_readiness_score: 5
---

# Second PRD

## REQ-001: Another requirement

### AC-001: Another acceptance criterion
`;

function writeFixture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'sample-prd.md'), PRD_FIXTURE, 'utf8');
  fs.writeFileSync(path.join(dir, 'second-prd.md'), SECOND_PRD_FIXTURE, 'utf8');
}

function runCli(cli, args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout };
  } catch (err) {
    return { status: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

/** Replace the fixture path and mtimes so both CLIs can be compared byte for byte. */
function normalize(stdout, dir) {
  return stdout
    .split(dir)
    .join('<FIXTURE>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<TIMESTAMP>');
}

describe('packages/product prd-cli registry superset', () => {
  let workDir;
  let fixtureDir;
  let devFixtureDir;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(__dirname, '.tmp-prd-cli-registry-'));
    fixtureDir = path.join(workDir, 'product');
    devFixtureDir = path.join(workDir, 'development');
    writeFixture(fixtureDir);
    writeFixture(devFixtureDir);
  });

  afterAll(() => {
    if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
  });

  test.each([
    ['list', ['list', '--type', 'prd']],
    ['status', ['status', 'sample-prd']],
    ['status without slug', ['status']],
  ])('%s matches the development CLI output', (_name, args) => {
    const product = runCli(PRODUCT_CLI, [...args, '--dir', fixtureDir], workDir);
    const development = runCli(DEVELOPMENT_CLI, [...args, '--dir', devFixtureDir], workDir);
    expect(product.status).toBe(development.status);
    expect(normalize(product.stdout, fixtureDir)).toBe(normalize(development.stdout, devFixtureDir));
  });

  test('migrate-frontmatter matches the development CLI output and file effects', () => {
    const product = runCli(PRODUCT_CLI, ['migrate-frontmatter', fixtureDir], workDir);
    const development = runCli(DEVELOPMENT_CLI, ['migrate-frontmatter', devFixtureDir], workDir);
    expect(product.status).toBe(development.status);
    expect(normalize(product.stdout, fixtureDir)).toBe(normalize(development.stdout, devFixtureDir));
    for (const file of ['sample-prd.md', 'second-prd.md']) {
      expect(fs.readFileSync(path.join(fixtureDir, file), 'utf8')).toBe(
        fs.readFileSync(path.join(devFixtureDir, file), 'utf8')
      );
    }
  });

  test('the product CLI still serves the feature pipeline commands', () => {
    const prdPath = path.join(fixtureDir, 'sample-prd.md');
    const parsed = runCli(PRODUCT_CLI, ['parse', prdPath, '--json'], workDir);
    expect(parsed.status).toBe(0);
    expect(JSON.parse(parsed.stdout).ok).toBe(true);
  });
});
