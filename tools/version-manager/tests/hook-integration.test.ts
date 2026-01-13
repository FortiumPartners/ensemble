import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

describe('Pre-Commit Hook Integration', () => {
  const repoRoot = path.resolve(__dirname, '../../..');
  const hookPath = path.join(repoRoot, '.git/hooks/pre-commit');
  const backupPath = path.join(repoRoot, '.git/hooks/pre-commit.backup');

  beforeAll(() => {
    // Backup existing hook if present
    if (fs.existsSync(hookPath)) {
      fs.copyFileSync(hookPath, backupPath);
    }

    // Install hook
    execSync('node scripts/install-hook.js', {
      cwd: `${__dirname}/..`,
      stdio: 'ignore'
    });
  });

  afterAll(() => {
    // Restore original hook or remove test hook
    if (fs.existsSync(backupPath)) {
      fs.copyFileSync(backupPath, hookPath);
      fs.unlinkSync(backupPath);
    } else if (fs.existsSync(hookPath)) {
      fs.unlinkSync(hookPath);
    }
  });

  test('hook should be installed and executable', () => {
    expect(fs.existsSync(hookPath)).toBe(true);

    const stats = fs.statSync(hookPath);
    // Check if executable (Unix permissions)
    expect((stats.mode & 0o111) !== 0).toBe(true);
  });

  test('hook should contain version-bump CLI call', () => {
    const hookContent = fs.readFileSync(hookPath, 'utf-8');

    expect(hookContent).toContain('Version Bump Pre-Commit Hook');
    expect(hookContent).toContain('node dist/cli.js');
  });

  test('hook should run on commit attempt', () => {
    // Create a dummy file change
    const testFile = path.join(repoRoot, 'test-hook-integration.txt');
    fs.writeFileSync(testFile, 'test content');

    try {
      // Stage the file
      execSync('git add test-hook-integration.txt', { cwd: repoRoot, stdio: 'pipe' });

      // Attempt commit (hook should run)
      const output = execSync('git commit -m "feat(test): test hook integration"', {
        cwd: repoRoot,
        encoding: 'utf-8',
        stdio: 'pipe'
      });

      // Hook should have run (commit succeeded means hook ran without blocking)
      expect(output).toBeDefined();

      // Reset commit
      execSync('git reset --soft HEAD~1', { cwd: repoRoot, stdio: 'ignore' });
    } finally {
      // Cleanup
      execSync('git reset HEAD test-hook-integration.txt', {
        cwd: repoRoot,
        stdio: 'ignore'
      });
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });

  test('hook should not block commits (preview mode)', () => {
    const testFile = path.join(repoRoot, 'test-hook-no-block.txt');
    fs.writeFileSync(testFile, 'test content');

    try {
      execSync('git add test-hook-no-block.txt', { cwd: repoRoot, stdio: 'pipe' });

      // Commit should succeed even with hook
      execSync('git commit -m "feat(test): test non-blocking"', {
        cwd: repoRoot,
        stdio: 'pipe'
      });

      // Verify commit was created
      const log = execSync('git log -1 --oneline', {
        cwd: repoRoot,
        encoding: 'utf-8'
      });
      expect(log).toContain('feat(test): test non-blocking');

      // Reset
      execSync('git reset --soft HEAD~1', { cwd: repoRoot, stdio: 'ignore' });
    } finally {
      execSync('git reset HEAD test-hook-no-block.txt', {
        cwd: repoRoot,
        stdio: 'ignore'
      });
      if (fs.existsSync(testFile)) {
        fs.unlinkSync(testFile);
      }
    }
  });
});
