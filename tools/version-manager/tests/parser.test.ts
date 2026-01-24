import { parseConventionalCommit } from '../src/parser';
import { VersionError, ErrorCodes } from '../src/errors';

describe('parseConventionalCommit', () => {
  describe('valid commits', () => {
    it('should parse simple feat commit', () => {
      const message = 'feat(core): add new utility function';
      const result = parseConventionalCommit(message);

      expect(result.type).toBe('feat');
      expect(result.scope).toBe('core');
      expect(result.subject).toBe('add new utility function');
      expect(result.breaking).toBe(false);
    });

    it('should parse fix commit', () => {
      const message = 'fix(router): resolve routing bug';
      const result = parseConventionalCommit(message);

      expect(result.type).toBe('fix');
      expect(result.scope).toBe('router');
      expect(result.subject).toBe('resolve routing bug');
      expect(result.breaking).toBe(false);
    });

    it('should parse commit without scope', () => {
      const message = 'docs: update README';
      const result = parseConventionalCommit(message);

      expect(result.type).toBe('docs');
      expect(result.scope).toBeUndefined();
      expect(result.subject).toBe('update README');
      expect(result.breaking).toBe(false);
    });

    it('should parse commit with body', () => {
      const message = 'feat(core): add utility\n\nThis is a longer description of the feature.';
      const result = parseConventionalCommit(message);

      expect(result.type).toBe('feat');
      expect(result.subject).toBe('add utility');
      expect(result.body).toContain('longer description');
    });

    it('should parse commit with footer', () => {
      const message = 'fix(api): resolve issue\n\nCloses #123';
      const result = parseConventionalCommit(message);

      expect(result.type).toBe('fix');
      expect(result.references).toBeDefined();
      expect(result.references?.length).toBeGreaterThan(0);
    });
  });

  describe('breaking changes', () => {
    it('should detect breaking change with ! suffix', () => {
      const message = 'feat(core)!: rewrite API';
      const result = parseConventionalCommit(message);

      expect(result.type).toBe('feat');
      expect(result.breaking).toBe(true);
    });

    it('should detect breaking change with BREAKING CHANGE footer', () => {
      const message = 'feat(core): update API\n\nBREAKING CHANGE: API signature changed';
      const result = parseConventionalCommit(message);

      expect(result.type).toBe('feat');
      expect(result.breaking).toBe(true);
      expect(result.notes).toBeDefined();
      expect(result.notes?.some(note => note.title === 'BREAKING CHANGE')).toBe(true);
    });

    it('should detect breaking change with BREAKING-CHANGE footer', () => {
      const message = 'feat(core): update API\n\nBREAKING-CHANGE: API signature changed';
      const result = parseConventionalCommit(message);

      expect(result.type).toBe('feat');
      expect(result.breaking).toBe(true);
    });

    it('should detect both ! and footer breaking change', () => {
      const message = 'feat(core)!: update API\n\nBREAKING CHANGE: Complete rewrite';
      const result = parseConventionalCommit(message);

      expect(result.type).toBe('feat');
      expect(result.breaking).toBe(true);
    });

    it('should remove ! from type', () => {
      const message = 'feat(core)!: breaking change';
      const result = parseConventionalCommit(message);

      expect(result.type).toBe('feat');
      expect(result.type).not.toContain('!');
    });
  });

  describe('commit types', () => {
    const types = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'chore'];

    types.forEach(type => {
      it(`should parse ${type} commit type`, () => {
        const message = `${type}(core): do something`;
        const result = parseConventionalCommit(message);

        expect(result.type).toBe(type);
      });
    });
  });

  describe('malformed commits', () => {
    it('should reject commit without type', () => {
      const message = 'add new feature';
      expect(() => parseConventionalCommit(message)).toThrow(VersionError);
      expect(() => parseConventionalCommit(message)).toThrow(expect.objectContaining({
        code: ErrorCodes.PARSE_ERROR.code
      }));
    });

    it('should reject commit without colon', () => {
      const message = 'feat add feature';
      expect(() => parseConventionalCommit(message)).toThrow(VersionError);
    });

    it('should reject commit with uppercase type', () => {
      const message = 'FEAT(core): add feature';
      expect(() => parseConventionalCommit(message)).toThrow(VersionError);
    });

    it('should reject commit with empty scope', () => {
      const message = 'feat(): add feature';
      expect(() => parseConventionalCommit(message)).toThrow(VersionError);
    });

    it('should reject commit without subject', () => {
      const message = 'feat(core):';
      expect(() => parseConventionalCommit(message)).toThrow(VersionError);
    });

    it('should reject commit with whitespace-only subject', () => {
      const message = 'feat(core):   ';
      expect(() => parseConventionalCommit(message)).toThrow(VersionError);
    });
  });

  describe('edge cases', () => {
    it('should handle scope with hyphens', () => {
      const message = 'feat(agent-progress-pane): add feature';
      const result = parseConventionalCommit(message);

      expect(result.scope).toBe('agent-progress-pane');
    });

    it('should handle subject with special characters', () => {
      const message = 'feat(core): add feature (v2.0)';
      const result = parseConventionalCommit(message);

      expect(result.subject).toContain('(v2.0)');
    });

    it('should handle multiline body', () => {
      const message = 'feat(core): add feature\n\nLine 1\nLine 2\nLine 3';
      const result = parseConventionalCommit(message);

      expect(result.body).toContain('Line 1');
      expect(result.body).toContain('Line 3');
    });

    it('should handle issue references', () => {
      const message = 'fix(api): resolve bug\n\nFixes #123\nCloses #456';
      const result = parseConventionalCommit(message);

      expect(result.references).toBeDefined();
      expect(result.references?.length).toBeGreaterThan(0);
    });

    it('should reject commit with only whitespace after colon', () => {
      const message = 'feat(core):    ';
      expect(() => parseConventionalCommit(message)).toThrow(VersionError);
      expect(() => parseConventionalCommit(message)).toThrow(/Missing commit/);
    });

    it('should handle commit with no body or footer', () => {
      const message = 'feat(core): add feature';
      const result = parseConventionalCommit(message);

      expect(result.body).toBeUndefined();
      expect(result.footer).toBeUndefined();
    });

    it('should handle commit with no notes or references', () => {
      const message = 'feat(core): add feature';
      const result = parseConventionalCommit(message);

      expect(result.notes).toBeDefined();
      expect(result.references).toBeDefined();
    });
  });

  describe('input sanitization integration', () => {
    it('should sanitize input before parsing', () => {
      const message = 'feat(core): add feature\r\n\r\nBody with CRLF';
      const result = parseConventionalCommit(message);

      expect(result.type).toBe('feat');
      expect(result.body).not.toContain('\r');
    });

    it('should reject disallowed special characters', () => {
      // Note: <, >, @, /, =, + are now allowed for emails, paths, and version refs
      // Test with actually disallowed characters like $ or &
      const message = 'feat(core): test $INJECT_VAR &';
      expect(() => parseConventionalCommit(message)).toThrow(VersionError);
    });

    it('should allow angle brackets and @ symbols (for emails and tags)', () => {
      // These are now allowed since they're common in commit messages
      const message = 'feat(core): add <Component> with email@example.com';
      expect(() => parseConventionalCommit(message)).not.toThrow();
    });

    it('should trim whitespace before parsing', () => {
      const message = '  feat(core): add feature  \n';
      const result = parseConventionalCommit(message);

      expect(result.type).toBe('feat');
    });
  });

});
