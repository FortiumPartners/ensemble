'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  runDocMaintenance,
  USER_GUIDE_TEMPLATE,
} = require('../lib/doc-maintenance');

describe('runDocMaintenance', () => {
  let repoRoot;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-maintenance-'));
    fs.writeFileSync(path.join(repoRoot, 'README.md'), '# README\n', 'utf8');
    fs.writeFileSync(path.join(repoRoot, 'AGENTS.md'), '# AGENTS\n', 'utf8');
  });

  afterEach(() => {
    delete process.env.ENSEMBLE_SKIP_DOC_HOOK;
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  test('creates docs/UserGuide.md from template when change scope includes added-command', () => {
    const result = runDocMaintenance({}, ['added command for users'], repoRoot, {
      changeScopeCategories: ['added-command'],
    });

    const userGuidePath = path.join(repoRoot, 'docs/UserGuide.md');
    expect(fs.existsSync(userGuidePath)).toBe(true);
    expect(fs.readFileSync(userGuidePath, 'utf8')).toBe(USER_GUIDE_TEMPLATE);
    expect(result.createdFiles).toContain('docs/UserGuide.md');
  });

  test('skips creation when change scope is not user-visible', () => {
    const result = runDocMaintenance({}, ['removed internal helper'], repoRoot, {
      changeScopeCategories: ['removed-feature'],
    });

    expect(fs.existsSync(path.join(repoRoot, 'docs/UserGuide.md'))).toBe(false);
    expect(result.logs).toContain('INFO: no-user-visible-changes');
  });

  test('updates README.md and AGENTS.md when proposed edits are allowed', () => {
    const result = runDocMaintenance({}, [], repoRoot, {
      proposedEdits: [
        { path: 'README.md', content: '# README\nupdated\n' },
        { path: 'AGENTS.md', content: '# AGENTS\nupdated\n' },
      ],
    });

    expect(fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8')).toContain('updated');
    expect(fs.readFileSync(path.join(repoRoot, 'AGENTS.md'), 'utf8')).toContain('updated');
    expect(result.filesUpdated).toEqual(['README.md', 'AGENTS.md']);
  });

  test('scope guard rejects writes outside allow-list', () => {
    const result = runDocMaintenance({}, [], repoRoot, {
      proposedEdits: [
        { path: 'docs/PRD/foo.md', content: 'blocked' },
      ],
    });

    expect(fs.existsSync(path.join(repoRoot, 'docs/PRD/foo.md'))).toBe(false);
    expect(result.rejectedPaths).toEqual(['docs/PRD/foo.md']);
    expect(result.logs).toContain('INFO: scope-guard-rejected-paths:docs/PRD/foo.md');
  });

  test('emits INFO when ENSEMBLE_SKIP_DOC_HOOK=1', () => {
    process.env.ENSEMBLE_SKIP_DOC_HOOK = '1';
    const result = runDocMaintenance({}, [], repoRoot, {});
    expect(result.logs).toContain('INFO: ENSEMBLE_SKIP_DOC_HOOK=1; skipping doc maintenance.');
    expect(result.skipped).toBe(true);
  });

  test('emits INFO when documentation-specialist is missing', () => {
    const result = runDocMaintenance({}, [], repoRoot, {
      documentationAgentMissing: true,
    });
    expect(result.logs).toContain('INFO: documentation-specialist not in agent registry; skipping PR-boundary doc maintenance.');
    expect(result.skipped).toBe(true);
  });

  test('accepts beadHistory synthesized from git log text', () => {
    const gitLogLike = [
      'commit abc123',
      'Status: closed',
      'Documentation: documentation-specialist',
      'feat: added command docs',
    ].join('\n');

    const result = runDocMaintenance({}, gitLogLike, repoRoot, {});
    expect(result.categories).toContain('added-command');
  });

  test('reads current docs and passes them to specialist runner', () => {
    let runnerInput = null;
    const result = runDocMaintenance({ trd: 'meta' }, ['added command'], repoRoot, {
      specialistRunner(input) {
        runnerInput = input;
        return [
          { path: 'README.md', content: `${input.files['README.md']}updated\n` },
        ];
      },
    });

    expect(runnerInput).toBeTruthy();
    expect(runnerInput.allowedPaths).toEqual(['README.md', 'AGENTS.md', 'docs/UserGuide.md']);
    expect(runnerInput.files['README.md']).toBe('# README\n');
    expect(result.filesUpdated).toContain('README.md');
    expect(fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8')).toContain('updated');
  });
});

describe('quickstart artifact docs', () => {
  test('README and CHANGELOG mention standard support, Foreman reporting, and beads v1 unsupported status', () => {
    const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
    const changelog = fs.readFileSync(path.join(__dirname, '../CHANGELOG.md'), 'utf8');
    const combined = `${readme}\n${changelog}`;

    expect(combined).toContain('Standard `/ensemble:implement-trd`');
    expect(combined).toContain('Foreman phase-report');
    expect(combined).toContain('quickstart path');
    expect(combined).toContain('coverage summary');
    expect(combined).toContain('quickstart generation is explicitly unsupported in v1');
    expect(readme).toContain('/ensemble:implement-trd-tasks` does not generate a `quickstart.md` validation runbook in v1');
  });
});
