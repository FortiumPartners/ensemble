import { execSync } from 'child_process';

describe('CLI - Version Bump Preview', () => {
  const cliPath = `${__dirname}/../dist/cli.js`;

  beforeAll(() => {
    // Ensure CLI is built
    try {
      execSync('npm run build', { cwd: `${__dirname}/..`, stdio: 'ignore' });
    } catch (error) {
      throw new Error('Failed to build CLI before tests');
    }
  });

  describe('Valid Commits', () => {
    test('feat commit should show MINOR bump', () => {
      // Create a test commit
      execSync('git add .', { cwd: `${__dirname}/../../..` });
      execSync('git commit -m "feat(test): add new feature" --no-verify', {
        cwd: `${__dirname}/../../..`,
        stdio: 'pipe'
      });

      try {
        const output = execSync(`node ${cliPath}`, {
          encoding: 'utf-8',
          cwd: `${__dirname}/..`
        });

        expect(output).toContain('Version Bump Preview');
        expect(output).toContain('Commit Type: feat');
        expect(output).toContain('Bump Type: MINOR');
      } finally {
        // Reset the test commit
        execSync('git reset --soft HEAD~1', {
          cwd: `${__dirname}/../../..`,
          stdio: 'ignore'
        });
      }
    });

    test('fix commit should show PATCH bump', () => {
      execSync('git add .', { cwd: `${__dirname}/../../..` });
      execSync('git commit -m "fix(test): fix bug" --no-verify', {
        cwd: `${__dirname}/../../..`,
        stdio: 'pipe'
      });

      try {
        const output = execSync(`node ${cliPath}`, {
          encoding: 'utf-8',
          cwd: `${__dirname}/..`
        });

        expect(output).toContain('Commit Type: fix');
        expect(output).toContain('Bump Type: PATCH');
      } finally {
        execSync('git reset --soft HEAD~1', {
          cwd: `${__dirname}/../../..`,
          stdio: 'ignore'
        });
      }
    });

    test('feat! commit should show MAJOR bump and breaking change warning', () => {
      execSync('git add .', { cwd: `${__dirname}/../../..` });
      execSync('git commit -m "feat!: breaking change" --no-verify', {
        cwd: `${__dirname}/../../..`,
        stdio: 'pipe'
      });

      try {
        const output = execSync(`node ${cliPath}`, {
          encoding: 'utf-8',
          cwd: `${__dirname}/..`
        });

        expect(output).toContain('Commit Type: feat');
        expect(output).toContain('Bump Type: MAJOR');
        expect(output).toContain('Breaking Change Detected');
      } finally {
        execSync('git reset --soft HEAD~1', {
          cwd: `${__dirname}/../../..`,
          stdio: 'ignore'
        });
      }
    });

    test('commit with BREAKING CHANGE footer should show MAJOR bump', () => {
      const commitMsg = `feat(test): add feature\n\nBREAKING CHANGE: API changed`;

      execSync('git add .', { cwd: `${__dirname}/../../..` });
      execSync(`git commit -m "${commitMsg}" --no-verify`, {
        cwd: `${__dirname}/../../..`,
        stdio: 'pipe'
      });

      try {
        const output = execSync(`node ${cliPath}`, {
          encoding: 'utf-8',
          cwd: `${__dirname}/..`
        });

        expect(output).toContain('Bump Type: MAJOR');
        expect(output).toContain('Breaking Change Detected');
      } finally {
        execSync('git reset --soft HEAD~1', {
          cwd: `${__dirname}/../../..`,
          stdio: 'ignore'
        });
      }
    });

    test('docs commit should show NONE bump', () => {
      execSync('git add .', { cwd: `${__dirname}/../../..` });
      execSync('git commit -m "docs(test): update docs" --no-verify', {
        cwd: `${__dirname}/../../..`,
        stdio: 'pipe'
      });

      try {
        const output = execSync(`node ${cliPath}`, {
          encoding: 'utf-8',
          cwd: `${__dirname}/..`
        });

        expect(output).toContain('Commit Type: docs');
        expect(output).toContain('Bump Type: NONE');
      } finally {
        execSync('git reset --soft HEAD~1', {
          cwd: `${__dirname}/../../..`,
          stdio: 'ignore'
        });
      }
    });

    test('commit with Co-Authored-By should be accepted', () => {
      const commitMsg = `feat(test): add feature\n\nCo-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>`;

      execSync('git add .', { cwd: `${__dirname}/../../..` });
      execSync(`git commit -m "${commitMsg}" --no-verify`, {
        cwd: `${__dirname}/../../..`,
        stdio: 'pipe'
      });

      try {
        const output = execSync(`node ${cliPath}`, {
          encoding: 'utf-8',
          cwd: `${__dirname}/..`
        });

        expect(output).toContain('Commit Type: feat');
        expect(output).toContain('Bump Type: MINOR');
      } finally {
        execSync('git reset --soft HEAD~1', {
          cwd: `${__dirname}/../../..`,
          stdio: 'ignore'
        });
      }
    });
  });

  describe('Invalid Commits', () => {
    test('malformed commit should show error', () => {
      execSync('git add .', { cwd: `${__dirname}/../../..` });
      execSync('git commit -m "invalid commit format" --no-verify', {
        cwd: `${__dirname}/../../..`,
        stdio: 'pipe'
      });

      try {
        // This should throw because the commit format is invalid
        expect(() => {
          execSync(`node ${cliPath}`, {
            encoding: 'utf-8',
            cwd: `${__dirname}/..`
          });
        }).toThrow();
      } finally {
        execSync('git reset --soft HEAD~1', {
          cwd: `${__dirname}/../../..`,
          stdio: 'ignore'
        });
      }
    });
  });

  describe('CLI Exit Codes', () => {
    test('valid commit should exit with code 0', () => {
      execSync('git add .', { cwd: `${__dirname}/../../..` });
      execSync('git commit -m "feat(test): test" --no-verify', {
        cwd: `${__dirname}/../../..`,
        stdio: 'pipe'
      });

      try {
        execSync(`node ${cliPath}`, {
          cwd: `${__dirname}/..`,
          stdio: 'ignore'
        });
        // If we get here, exit code was 0
        expect(true).toBe(true);
      } catch (error) {
        // Should not throw
        expect(error).toBeUndefined();
      } finally {
        execSync('git reset --soft HEAD~1', {
          cwd: `${__dirname}/../../..`,
          stdio: 'ignore'
        });
      }
    });
  });
});
