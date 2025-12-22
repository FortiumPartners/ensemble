/**
 * Unit tests for history-generator.js
 */

const path = require('path');

// Mock child_process
jest.mock('child_process', () => ({
  execSync: jest.fn()
}));

// Mock fs
jest.mock('fs', () => ({
  promises: {
    readdir: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    stat: jest.fn()
  }
}));

const { execSync } = require('child_process');
const fs = require('fs').promises;
const historyGenerator = require('../lib/history-generator');

describe('history-generator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('formatTitle', () => {
    it('should convert hyphenated filename to title case', () => {
      expect(historyGenerator.formatTitle('yaml-to-markdown-generator'))
        .toBe('YAML To Markdown Generator');
    });

    it('should handle special acronyms', () => {
      expect(historyGenerator.formatTitle('api-docs')).toBe('API Docs');
      expect(historyGenerator.formatTitle('cli-tool')).toBe('CLI Tool');
      expect(historyGenerator.formatTitle('prd-template')).toBe('PRD Template');
      expect(historyGenerator.formatTitle('trd-template')).toBe('TRD Template');
    });

    it('should handle single word', () => {
      expect(historyGenerator.formatTitle('feature')).toBe('Feature');
    });
  });

  describe('matchDocuments', () => {
    it('should match PRD and TRD with same filename', () => {
      const prds = [{
        filename: 'feature-x',
        filepath: '/docs/PRD/feature-x.md',
        type: 'PRD',
        id: 'PRD-001',
        title: 'Feature X',
        date: '2025-12-20',
        status: 'Approved',
        problem: 'Problem text',
        solution: 'Solution text',
        decisions: ['Decision 1']
      }];

      const trds = [{
        filename: 'feature-x',
        filepath: '/docs/TRD/feature-x.md',
        type: 'TRD',
        id: 'TRD-001',
        title: 'Feature X TRD',
        date: '2025-12-21',
        status: 'Ready',
        problem: null,
        solution: 'Technical solution',
        decisions: ['Technical decision']
      }];

      const result = historyGenerator.matchDocuments(prds, trds);

      expect(result).toHaveLength(1);
      expect(result[0].prd).toBeTruthy();
      expect(result[0].trd).toBeTruthy();
      expect(result[0].title).toBe('Feature X');
      expect(result[0].date).toBe('2025-12-20');
      expect(result[0].decisions).toContain('Decision 1');
      expect(result[0].decisions).toContain('Technical decision');
    });

    it('should handle PRD without TRD', () => {
      const prds = [{
        filename: 'orphan-prd',
        filepath: '/docs/PRD/orphan-prd.md',
        type: 'PRD',
        id: 'PRD-002',
        title: 'Orphan PRD',
        date: '2025-12-15',
        status: 'Draft',
        problem: 'Some problem',
        solution: null,
        decisions: []
      }];

      const result = historyGenerator.matchDocuments(prds, []);

      expect(result).toHaveLength(1);
      expect(result[0].prd).toBeTruthy();
      expect(result[0].trd).toBeNull();
    });

    it('should handle TRD without PRD', () => {
      const trds = [{
        filename: 'orphan-trd',
        filepath: '/docs/TRD/orphan-trd.md',
        type: 'TRD',
        id: 'TRD-002',
        title: 'Orphan TRD',
        date: '2025-12-10',
        status: 'Implemented',
        problem: null,
        solution: 'Direct implementation',
        decisions: ['Decision A']
      }];

      const result = historyGenerator.matchDocuments([], trds);

      expect(result).toHaveLength(1);
      expect(result[0].prd).toBeNull();
      expect(result[0].trd).toBeTruthy();
    });

    it('should sort entries newest first', () => {
      const prds = [
        { filename: 'old', date: '2025-01-01', title: 'Old', decisions: [] },
        { filename: 'new', date: '2025-12-01', title: 'New', decisions: [] },
        { filename: 'mid', date: '2025-06-01', title: 'Mid', decisions: [] }
      ];

      const result = historyGenerator.matchDocuments(prds, []);

      expect(result[0].date).toBe('2025-12-01');
      expect(result[1].date).toBe('2025-06-01');
      expect(result[2].date).toBe('2025-01-01');
    });

    it('should warn on duplicate filenames', () => {
      const prds = [
        { filename: 'duplicate', date: '2025-12-01', title: 'First', decisions: [] },
        { filename: 'duplicate', date: '2025-12-02', title: 'Second', decisions: [] }
      ];

      historyGenerator.matchDocuments(prds, []);

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('HIST-E004'));
    });

    it('should merge decisions and limit to 5', () => {
      const prds = [{
        filename: 'feature',
        date: '2025-12-01',
        title: 'Feature',
        decisions: ['D1', 'D2', 'D3']
      }];

      const trds = [{
        filename: 'feature',
        date: '2025-12-01',
        title: 'Feature',
        decisions: ['D4', 'D5', 'D6']
      }];

      const result = historyGenerator.matchDocuments(prds, trds);

      expect(result[0].decisions).toHaveLength(5);
    });

    it('should use TRD date if PRD date is missing', () => {
      const prds = [{
        filename: 'feature',
        date: null,
        title: 'Feature',
        decisions: []
      }];

      const trds = [{
        filename: 'feature',
        date: '2025-12-01',
        title: 'Feature',
        decisions: []
      }];

      const result = historyGenerator.matchDocuments(prds, trds);

      expect(result[0].date).toBe('2025-12-01');
    });
  });

  describe('generateMarkdown', () => {
    it('should generate valid markdown output', () => {
      const entries = [{
        date: '2025-12-20',
        title: 'Test Feature',
        prd: { id: 'PRD-001', filename: 'test-feature' },
        trd: { id: 'TRD-001', filename: 'test-feature' },
        status: 'Approved',
        problem: 'Test problem',
        solution: 'Test solution',
        decisions: ['Decision 1', 'Decision 2']
      }];

      const stats = { prdCount: 1, trdCount: 1 };
      const result = historyGenerator.generateMarkdown(entries, stats);

      expect(result).toContain('# Ensemble Project History');
      expect(result).toContain('## 2025-12-20 - Test Feature');
      expect(result).toContain('**PRD**: [PRD-001](../docs/PRD/test-feature.md)');
      expect(result).toContain('**TRD**: [TRD-001](../docs/TRD/test-feature.md)');
      expect(result).toContain('**Status**: Approved');
      expect(result).toContain('### Problem');
      expect(result).toContain('Test problem');
      expect(result).toContain('### Solution');
      expect(result).toContain('Test solution');
      expect(result).toContain('### Key Decisions');
      expect(result).toContain('- Decision 1');
    });

    it('should include PRD only indicator', () => {
      const entries = [{
        date: '2025-12-20',
        title: 'PRD Only',
        prd: { id: 'PRD-001', filename: 'prd-only' },
        trd: null,
        status: 'Draft',
        problem: null,
        solution: null,
        decisions: []
      }];

      const result = historyGenerator.generateMarkdown(entries, { prdCount: 1, trdCount: 0 });

      expect(result).toContain('*PRD only - TRD pending*');
    });

    it('should include TRD only indicator', () => {
      const entries = [{
        date: '2025-12-20',
        title: 'TRD Only',
        prd: null,
        trd: { id: 'TRD-001', filename: 'trd-only' },
        status: 'Implemented',
        problem: null,
        solution: null,
        decisions: []
      }];

      const result = historyGenerator.generateMarkdown(entries, { prdCount: 0, trdCount: 1 });

      expect(result).toContain('*TRD only - no linked PRD*');
    });

    it('should handle Unknown Date', () => {
      const entries = [{
        date: null,
        title: 'No Date Feature',
        prd: { filename: 'no-date' },
        trd: null,
        status: null,
        problem: null,
        solution: null,
        decisions: []
      }];

      const result = historyGenerator.generateMarkdown(entries, { prdCount: 1, trdCount: 0 });

      expect(result).toContain('## Unknown Date - No Date Feature');
    });
  });

  describe('isGitRepository', () => {
    it('should return true for git repository', () => {
      execSync.mockReturnValue('');

      expect(historyGenerator.isGitRepository('/path')).toBe(true);
      expect(execSync).toHaveBeenCalledWith('git rev-parse --git-dir', expect.any(Object));
    });

    it('should return false for non-git directory', () => {
      execSync.mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      expect(historyGenerator.isGitRepository('/path')).toBe(false);
    });
  });

  describe('hasChanges', () => {
    it('should return false for unchanged file', () => {
      execSync.mockReturnValue('');

      expect(historyGenerator.hasChanges('/path/file.md', '/path')).toBe(false);
    });

    it('should return true for changed file', () => {
      execSync
        .mockReturnValueOnce('') // ls-files succeeds
        .mockImplementationOnce(() => { throw new Error('diff'); }); // diff fails

      expect(historyGenerator.hasChanges('/path/file.md', '/path')).toBe(true);
    });

    it('should return true for new/untracked file', () => {
      execSync.mockImplementation(() => {
        throw new Error('Not tracked');
      });

      expect(historyGenerator.hasChanges('/path/file.md', '/path')).toBe(true);
    });
  });

  describe('commitHistoryFile', () => {
    it('should skip commit if not in git repo', () => {
      execSync.mockImplementation(() => {
        throw new Error('Not a git repo');
      });

      const result = historyGenerator.commitHistoryFile('/path/file.md', { prdCount: 1, trdCount: 1 }, '/path');

      expect(result).toBeNull();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('HIST-W005'));
    });

    it('should skip commit if no changes', () => {
      execSync.mockReturnValue(''); // All checks pass, no changes

      const result = historyGenerator.commitHistoryFile('/path/file.md', { prdCount: 1, trdCount: 1 }, '/path');

      expect(result).toBeNull();
    });

    it('should commit file with changes', () => {
      execSync
        .mockReturnValueOnce('') // git rev-parse (is git repo)
        .mockReturnValueOnce('') // git ls-files
        .mockImplementationOnce(() => { throw new Error('diff'); }) // git diff (has changes)
        .mockReturnValueOnce('') // git add
        .mockReturnValueOnce('') // git commit
        .mockReturnValueOnce('abc1234\n'); // git rev-parse --short HEAD

      const result = historyGenerator.commitHistoryFile('/path/file.md', { prdCount: 2, trdCount: 1 }, '/path');

      expect(result).toBe('abc1234');
      expect(execSync).toHaveBeenCalledWith(expect.stringContaining('git add'), expect.any(Object));
      expect(execSync).toHaveBeenCalledWith(expect.stringContaining('git commit'), expect.any(Object));
    });

    it('should handle git errors gracefully', () => {
      execSync
        .mockReturnValueOnce('') // is git repo
        .mockReturnValueOnce('') // ls-files
        .mockImplementationOnce(() => { throw new Error('diff'); }) // has changes
        .mockImplementationOnce(() => { throw new Error('commit failed'); }); // git add fails

      const result = historyGenerator.commitHistoryFile('/path/file.md', { prdCount: 1, trdCount: 1 }, '/path');

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('HIST-E006'));
    });
  });

  describe('generateHistory', () => {
    beforeEach(() => {
      // Mock directory scanning
      fs.readdir.mockResolvedValue([]);
      fs.writeFile.mockResolvedValue(undefined);
    });

    it('should generate history file successfully', async () => {
      fs.readdir
        .mockResolvedValueOnce([{ name: 'feature.md', isFile: () => true }])
        .mockResolvedValueOnce([]);

      fs.readFile.mockResolvedValue(`# PRD
| **Created** | 2025-12-20 |
| **PRD ID** | PRD-001 |

### Problem Statement
Test problem

### Solution
Test solution
`);

      // Mock git operations to skip
      execSync.mockImplementation(() => { throw new Error('skip'); });

      const result = await historyGenerator.generateHistory({
        docsDir: '/docs',
        autoCommit: false
      });

      expect(result.success).toBe(true);
      expect(result.stats.prdCount).toBe(1);
      expect(result.stats.entryCount).toBe(1);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should handle empty directories gracefully', async () => {
      fs.readdir.mockResolvedValue([]);

      const result = await historyGenerator.generateHistory({
        docsDir: '/docs',
        autoCommit: false
      });

      // Should succeed with empty results
      expect(result.success).toBe(true);
      expect(result.stats.prdCount).toBe(0);
      expect(result.stats.entryCount).toBe(0);
    });

    it('should handle write failure', async () => {
      fs.readdir.mockResolvedValue([]);
      fs.writeFile.mockRejectedValue(new Error('Disk full'));

      const result = await historyGenerator.generateHistory({
        docsDir: '/docs',
        autoCommit: false
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('HIST-E005');
    });
  });

  describe('printSummary', () => {
    it('should print success summary', () => {
      const result = {
        success: true,
        stats: {
          prdCount: 5,
          trdCount: 3,
          entryCount: 6,
          matchedPairs: 2,
          prdOnly: 3,
          trdOnly: 1
        },
        gitCommit: 'abc1234',
        duration: 150
      };

      historyGenerator.printSummary(result);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Phase 4: History Consolidation'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('found 5 documents'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Matched pairs: 2'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('commit abc1234'));
    });

    it('should print failure message', () => {
      const result = {
        success: false,
        error: 'Test error'
      };

      historyGenerator.printSummary(result);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Generation failed'));
    });

    it('should indicate no changes to commit', () => {
      const result = {
        success: true,
        stats: { prdCount: 0, trdCount: 0, entryCount: 0, matchedPairs: 0, prdOnly: 0, trdOnly: 0 },
        gitCommit: null,
        duration: 50
      };

      historyGenerator.printSummary(result);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No changes to commit'));
    });
  });
});
