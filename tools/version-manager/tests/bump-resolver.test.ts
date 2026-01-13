import { determineBumpType, applyPrecedence } from '../src/bump-resolver';
import { CommitMessage } from '../src/parser';

describe('determineBumpType', () => {
  describe('single commits', () => {
    it('should return major for breaking change', () => {
      const commits: CommitMessage[] = [{
        type: 'feat',
        breaking: true,
        subject: 'rewrite API'
      }];

      expect(determineBumpType(commits)).toBe('major');
    });

    it('should return minor for feat', () => {
      const commits: CommitMessage[] = [{
        type: 'feat',
        breaking: false,
        subject: 'add new feature'
      }];

      expect(determineBumpType(commits)).toBe('minor');
    });

    it('should return patch for fix', () => {
      const commits: CommitMessage[] = [{
        type: 'fix',
        breaking: false,
        subject: 'resolve bug'
      }];

      expect(determineBumpType(commits)).toBe('patch');
    });

    it('should return none for docs', () => {
      const commits: CommitMessage[] = [{
        type: 'docs',
        breaking: false,
        subject: 'update README'
      }];

      expect(determineBumpType(commits)).toBe('none');
    });

    it('should return none for chore', () => {
      const commits: CommitMessage[] = [{
        type: 'chore',
        breaking: false,
        subject: 'update dependencies'
      }];

      expect(determineBumpType(commits)).toBe('none');
    });

    it('should return none for style', () => {
      const commits: CommitMessage[] = [{
        type: 'style',
        breaking: false,
        subject: 'format code'
      }];

      expect(determineBumpType(commits)).toBe('none');
    });

    it('should return none for refactor', () => {
      const commits: CommitMessage[] = [{
        type: 'refactor',
        breaking: false,
        subject: 'restructure code'
      }];

      expect(determineBumpType(commits)).toBe('none');
    });

    it('should return none for test', () => {
      const commits: CommitMessage[] = [{
        type: 'test',
        breaking: false,
        subject: 'add tests'
      }];

      expect(determineBumpType(commits)).toBe('none');
    });

    it('should return none for perf', () => {
      const commits: CommitMessage[] = [{
        type: 'perf',
        breaking: false,
        subject: 'optimize performance'
      }];

      expect(determineBumpType(commits)).toBe('none');
    });
  });

  describe('breaking changes with different types', () => {
    it('should return major for breaking feat', () => {
      const commits: CommitMessage[] = [{
        type: 'feat',
        breaking: true,
        subject: 'breaking feature'
      }];

      expect(determineBumpType(commits)).toBe('major');
    });

    it('should return major for breaking fix', () => {
      const commits: CommitMessage[] = [{
        type: 'fix',
        breaking: true,
        subject: 'breaking fix'
      }];

      expect(determineBumpType(commits)).toBe('major');
    });

    it('should return major for breaking docs', () => {
      const commits: CommitMessage[] = [{
        type: 'docs',
        breaking: true,
        subject: 'breaking docs change'
      }];

      expect(determineBumpType(commits)).toBe('major');
    });
  });

  describe('multiple commits', () => {
    it('should apply precedence: major > minor > patch', () => {
      const commits: CommitMessage[] = [
        { type: 'fix', breaking: false, subject: 'patch fix' },
        { type: 'feat', breaking: false, subject: 'minor feature' },
        { type: 'feat', breaking: true, subject: 'breaking change' }
      ];

      expect(determineBumpType(commits)).toBe('major');
    });

    it('should return minor when highest is feat', () => {
      const commits: CommitMessage[] = [
        { type: 'fix', breaking: false, subject: 'patch fix' },
        { type: 'feat', breaking: false, subject: 'minor feature' },
        { type: 'docs', breaking: false, subject: 'docs update' }
      ];

      expect(determineBumpType(commits)).toBe('minor');
    });

    it('should return patch when highest is fix', () => {
      const commits: CommitMessage[] = [
        { type: 'fix', breaking: false, subject: 'patch fix' },
        { type: 'docs', breaking: false, subject: 'docs update' },
        { type: 'chore', breaking: false, subject: 'chore task' }
      ];

      expect(determineBumpType(commits)).toBe('patch');
    });

    it('should return none when all are non-versioning types', () => {
      const commits: CommitMessage[] = [
        { type: 'docs', breaking: false, subject: 'docs update' },
        { type: 'chore', breaking: false, subject: 'chore task' },
        { type: 'style', breaking: false, subject: 'format code' }
      ];

      expect(determineBumpType(commits)).toBe('none');
    });

    it('should return major for multiple breaking changes', () => {
      const commits: CommitMessage[] = [
        { type: 'feat', breaking: true, subject: 'breaking change 1' },
        { type: 'feat', breaking: true, subject: 'breaking change 2' }
      ];

      expect(determineBumpType(commits)).toBe('major');
    });
  });

  describe('empty input', () => {
    it('should return none for empty array', () => {
      expect(determineBumpType([])).toBe('none');
    });
  });
});

describe('applyPrecedence', () => {
  it('should return major when major is present', () => {
    expect(applyPrecedence(['major', 'minor', 'patch'])).toBe('major');
  });

  it('should return major when only major and patch', () => {
    expect(applyPrecedence(['major', 'patch'])).toBe('major');
  });

  it('should return minor when minor is highest', () => {
    expect(applyPrecedence(['minor', 'patch', 'none'])).toBe('minor');
  });

  it('should return patch when patch is highest', () => {
    expect(applyPrecedence(['patch', 'none'])).toBe('patch');
  });

  it('should return none when all are none', () => {
    expect(applyPrecedence(['none', 'none'])).toBe('none');
  });

  it('should return none for empty array', () => {
    expect(applyPrecedence([])).toBe('none');
  });

  it('should handle single major', () => {
    expect(applyPrecedence(['major'])).toBe('major');
  });

  it('should handle single minor', () => {
    expect(applyPrecedence(['minor'])).toBe('minor');
  });

  it('should handle single patch', () => {
    expect(applyPrecedence(['patch'])).toBe('patch');
  });

  it('should handle single none', () => {
    expect(applyPrecedence(['none'])).toBe('none');
  });

  it('should prioritize major over many minors', () => {
    expect(applyPrecedence(['minor', 'minor', 'minor', 'major'])).toBe('major');
  });

  it('should prioritize minor over many patches', () => {
    expect(applyPrecedence(['patch', 'patch', 'patch', 'minor'])).toBe('minor');
  });
});
