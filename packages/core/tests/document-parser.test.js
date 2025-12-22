/**
 * Unit tests for document-parser.js
 */

const path = require('path');

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    readdir: jest.fn(),
    readFile: jest.fn(),
    stat: jest.fn()
  }
}));

const fs = require('fs').promises;
const documentParser = require('../lib/document-parser');

describe('document-parser', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress console.warn during tests
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('scanDirectory', () => {
    it('should return markdown files from directory', async () => {
      fs.readdir.mockResolvedValue([
        { name: 'doc1.md', isFile: () => true },
        { name: 'doc2.md', isFile: () => true },
        { name: 'readme.txt', isFile: () => true },
        { name: 'subdir', isFile: () => false }
      ]);

      const result = await documentParser.scanDirectory('/docs/PRD');

      expect(result).toHaveLength(2);
      expect(result).toContain('/docs/PRD/doc1.md');
      expect(result).toContain('/docs/PRD/doc2.md');
    });

    it('should return empty array for non-existent directory', async () => {
      const error = new Error('ENOENT');
      error.code = 'ENOENT';
      fs.readdir.mockRejectedValue(error);

      const result = await documentParser.scanDirectory('/docs/PRD');

      expect(result).toEqual([]);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('HIST-W001'));
    });

    it('should throw HistoryError for other errors', async () => {
      fs.readdir.mockRejectedValue(new Error('Permission denied'));

      await expect(documentParser.scanDirectory('/docs/PRD'))
        .rejects.toThrow(documentParser.HistoryError);
    });
  });

  describe('extractDate', () => {
    it('should extract date from metadata table', async () => {
      const content = `
| **Created** | 2025-12-22 |
| **Status** | Draft |
`;
      const result = await documentParser.extractDate(content, '/path/to/file.md');
      expect(result).toBe('2025-12-22');
    });

    it('should extract date from inline Created field', async () => {
      const content = `Created: 2025-11-15\nSome other content`;
      const result = await documentParser.extractDate(content, '/path/to/file.md');
      expect(result).toBe('2025-11-15');
    });

    it('should extract first date pattern as fallback', async () => {
      const content = `This document was written on 2025-10-01 for the project.`;
      const result = await documentParser.extractDate(content, '/path/to/file.md');
      expect(result).toBe('2025-10-01');
    });

    it('should fall back to file modification time', async () => {
      const content = 'No date in this content';
      fs.stat.mockResolvedValue({
        mtime: new Date('2025-09-15T12:00:00Z')
      });

      const result = await documentParser.extractDate(content, '/path/to/file.md');
      expect(result).toBe('2025-09-15');
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('HIST-W003'));
    });

    it('should return null if no date found and stat fails', async () => {
      const content = 'No date';
      fs.stat.mockRejectedValue(new Error('File not found'));

      const result = await documentParser.extractDate(content, '/path/to/file.md');
      expect(result).toBeNull();
    });
  });

  describe('extractId', () => {
    it('should extract PRD ID from metadata table', () => {
      const content = `| **PRD ID** | PRD-CORE-004 |`;
      const result = documentParser.extractId(content, 'PRD');
      expect(result).toBe('PRD-CORE-004');
    });

    it('should extract TRD ID from metadata table', () => {
      const content = `| **TRD ID** | TRD-CORE-003 |`;
      const result = documentParser.extractId(content, 'TRD');
      expect(result).toBe('TRD-CORE-003');
    });

    it('should extract ID pattern from anywhere in document', () => {
      const content = `This relates to PRD-INFRA-001 implementation.`;
      const result = documentParser.extractId(content, 'PRD');
      expect(result).toBe('PRD-INFRA-001');
    });

    it('should return null if no ID found', () => {
      const content = 'No ID in this document';
      const result = documentParser.extractId(content, 'PRD');
      expect(result).toBeNull();
    });
  });

  describe('extractTitle', () => {
    it('should extract title from H1 heading', () => {
      const content = `# My Feature Title\n\nSome content`;
      const result = documentParser.extractTitle(content);
      expect(result).toBe('My Feature Title');
    });

    it('should extract title from PRD H1 heading', () => {
      const content = `# Product Requirements Document: YAML Generator\n\n`;
      const result = documentParser.extractTitle(content);
      expect(result).toBe('YAML Generator');
    });

    it('should extract title from Feature field', () => {
      const content = `| **Feature** | History Tracking |`;
      const result = documentParser.extractTitle(content);
      expect(result).toBe('History Tracking');
    });

    it('should return null if no title found', () => {
      const content = 'No title here';
      const result = documentParser.extractTitle(content);
      expect(result).toBeNull();
    });
  });

  describe('extractStatus', () => {
    it('should extract status from metadata table', () => {
      const content = `| **Status** | Approved - Ready for Development |`;
      const result = documentParser.extractStatus(content);
      expect(result).toBe('Approved - Ready for Development');
    });

    it('should return null if no status found', () => {
      const content = 'No status in this document';
      const result = documentParser.extractStatus(content);
      expect(result).toBeNull();
    });
  });

  describe('extractProblem', () => {
    it('should extract problem from Problem Statement section', () => {
      const content = `
### 1.1 Problem Statement

The system lacks proper error handling which causes crashes.

### 1.2 Solution
`;
      const result = documentParser.extractProblem(content);
      expect(result).toBe('The system lacks proper error handling which causes crashes.');
    });

    it('should extract problem from Problem section', () => {
      const content = `
## Problem

Users cannot find their data.

## Solution
`;
      const result = documentParser.extractProblem(content);
      expect(result).toBe('Users cannot find their data.');
    });

    it('should truncate to 300 characters', () => {
      const longContent = 'A'.repeat(350);
      const content = `### Problem Statement\n\n${longContent}\n\n## Next`;
      const result = documentParser.extractProblem(content);
      expect(result.length).toBe(300);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should return null if no problem section found', () => {
      const content = 'No problem section here';
      const result = documentParser.extractProblem(content);
      expect(result).toBeNull();
    });
  });

  describe('extractSolution', () => {
    it('should extract solution from Solution Overview section', () => {
      const content = `
### 1.2 Solution Overview

Implement a retry mechanism with exponential backoff.

### 1.3 Goals
`;
      const result = documentParser.extractSolution(content);
      expect(result).toBe('Implement a retry mechanism with exponential backoff.');
    });

    it('should extract solution from Technical Approach section', () => {
      const content = `
### Technical Approach

Use event-driven architecture for better scalability.

### Implementation
`;
      const result = documentParser.extractSolution(content);
      expect(result).toBe('Use event-driven architecture for better scalability.');
    });

    it('should truncate to 300 characters', () => {
      const longContent = 'B'.repeat(350);
      const content = `### Solution\n\n${longContent}\n\n## Next`;
      const result = documentParser.extractSolution(content);
      expect(result.length).toBe(300);
      expect(result.endsWith('...')).toBe(true);
    });

    it('should return null if no solution section found', () => {
      const content = 'No solution section here';
      const result = documentParser.extractSolution(content);
      expect(result).toBeNull();
    });
  });

  describe('extractDecisions', () => {
    it('should extract decisions from Key Decisions Summary table', () => {
      const content = `
## Key Decisions Summary

| Decision Area | Resolution |
|---------------|------------|
| **Ordering** | Newest-first |
| **Format** | Markdown |

---
`;
      const result = documentParser.extractDecisions(content);
      expect(result).toContain('Ordering');
      expect(result).toContain('Format');
    });

    it('should extract decisions from bullet list', () => {
      const content = `
### Key Decisions

- Use filename-based matching
- Auto-commit changes
- Newest-first ordering
`;
      const result = documentParser.extractDecisions(content);
      expect(result).toContain('Use filename-based matching');
      expect(result).toContain('Auto-commit changes');
    });

    it('should limit to 5 decisions', () => {
      const content = `
### Key Decisions

- Decision 1
- Decision 2
- Decision 3
- Decision 4
- Decision 5
- Decision 6
- Decision 7
`;
      const result = documentParser.extractDecisions(content);
      expect(result).toHaveLength(5);
    });

    it('should return empty array if no decisions found', () => {
      const content = 'No decisions here';
      const result = documentParser.extractDecisions(content);
      expect(result).toEqual([]);
    });
  });

  describe('parseDocument', () => {
    const samplePRD = `# Product Requirements Document: Feature X

| Field | Value |
|-------|-------|
| **PRD ID** | PRD-CORE-001 |
| **Feature** | Feature X |
| **Status** | Approved |
| **Created** | 2025-12-20 |

## 1. Executive Summary

### 1.1 Problem Statement

The current system is slow.

### 1.2 Solution Overview

Make it faster with caching.

## Key Decisions

- Use Redis for caching
- Invalidate on write
`;

    it('should parse a complete PRD document', async () => {
      fs.readFile.mockResolvedValue(samplePRD);

      const result = await documentParser.parseDocument('/docs/PRD/feature-x.md', 'PRD');

      expect(result.filename).toBe('feature-x');
      expect(result.filepath).toBe('/docs/PRD/feature-x.md');
      expect(result.type).toBe('PRD');
      expect(result.id).toBe('PRD-CORE-001');
      expect(result.title).toBe('Feature X');
      expect(result.date).toBe('2025-12-20');
      expect(result.status).toBe('Approved');
      expect(result.problem).toBe('The current system is slow.');
      expect(result.solution).toBe('Make it faster with caching.');
      expect(result.decisions).toContain('Use Redis for caching');
    });

    it('should throw HistoryError if file cannot be read', async () => {
      fs.readFile.mockRejectedValue(new Error('File not found'));

      await expect(documentParser.parseDocument('/docs/PRD/missing.md', 'PRD'))
        .rejects.toThrow(documentParser.HistoryError);
    });
  });

  describe('scanAndParseDocuments', () => {
    it('should scan and parse documents from both directories', async () => {
      // Mock directory scanning
      fs.readdir
        .mockResolvedValueOnce([{ name: 'feature.md', isFile: () => true }]) // PRD
        .mockResolvedValueOnce([{ name: 'feature.md', isFile: () => true }]); // TRD

      // Mock file reading
      fs.readFile
        .mockResolvedValueOnce(`# PRD: Feature\n| **Created** | 2025-12-20 |`)
        .mockResolvedValueOnce(`# TRD: Feature\n| **Created** | 2025-12-21 |`);

      const result = await documentParser.scanAndParseDocuments('/docs');

      expect(result.prds).toHaveLength(1);
      expect(result.trds).toHaveLength(1);
      expect(result.prds[0].type).toBe('PRD');
      expect(result.trds[0].type).toBe('TRD');
    });

    it('should handle empty directories', async () => {
      fs.readdir.mockResolvedValue([]);

      const result = await documentParser.scanAndParseDocuments('/docs');

      expect(result.prds).toEqual([]);
      expect(result.trds).toEqual([]);
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('HIST-W001'));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('HIST-W002'));
    });

    it('should continue parsing if one document fails', async () => {
      fs.readdir
        .mockResolvedValueOnce([
          { name: 'good.md', isFile: () => true },
          { name: 'bad.md', isFile: () => true }
        ])
        .mockResolvedValueOnce([]);

      fs.readFile
        .mockResolvedValueOnce(`# Good Doc\n| **Created** | 2025-12-20 |`)
        .mockRejectedValueOnce(new Error('Parse error'));

      const result = await documentParser.scanAndParseDocuments('/docs');

      expect(result.prds).toHaveLength(1);
      expect(result.prds[0].filename).toBe('good');
    });
  });

  describe('HistoryError', () => {
    it('should create error with code and message', () => {
      const error = new documentParser.HistoryError('HIST-E001', 'Test error', '/path/file.md');

      expect(error.code).toBe('HIST-E001');
      expect(error.filepath).toBe('/path/file.md');
      expect(error.message).toBe('[HIST-E001] Test error');
      expect(error.name).toBe('HistoryError');
    });
  });
});
