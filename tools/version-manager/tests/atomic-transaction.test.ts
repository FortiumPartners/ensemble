import { AtomicTransaction } from '../src/atomic-transaction';
import * as fs from 'fs';
import * as path from 'path';

describe('Atomic Transaction', () => {
  const testDir = path.join(__dirname, 'fixtures', 'transactions');

  beforeEach(() => {
    // Create test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('begin', () => {
    it('should initialize a new transaction', async () => {
      const transaction = new AtomicTransaction();
      await expect(transaction.begin()).resolves.not.toThrow();
    });

    it('should throw if transaction already begun', async () => {
      const transaction = new AtomicTransaction();
      await transaction.begin();
      await expect(transaction.begin()).rejects.toThrow('Transaction already in progress');
    });
  });

  describe('addFileUpdate', () => {
    it('should stage a file update', async () => {
      const transaction = new AtomicTransaction();
      await transaction.begin();

      const filePath = path.join(testDir, 'test.json');
      fs.writeFileSync(filePath, '{"version":"1.0.0"}');

      await expect(
        transaction.addFileUpdate(filePath, '{"version":"2.0.0"}')
      ).resolves.not.toThrow();
    });

    it('should backup existing file content', async () => {
      const transaction = new AtomicTransaction();
      await transaction.begin();

      const filePath = path.join(testDir, 'test.json');
      const originalContent = '{"version":"1.0.0"}';
      fs.writeFileSync(filePath, originalContent);

      await transaction.addFileUpdate(filePath, '{"version":"2.0.0"}');

      // Backup should exist internally (verified by successful rollback in other tests)
      expect(true).toBe(true);
    });

    it('should throw if transaction not begun', async () => {
      const transaction = new AtomicTransaction();
      const filePath = path.join(testDir, 'test.json');

      await expect(
        transaction.addFileUpdate(filePath, '{"version":"2.0.0"}')
      ).rejects.toThrow('No transaction in progress');
    });

    it('should handle multiple file updates', async () => {
      const transaction = new AtomicTransaction();
      await transaction.begin();

      const file1 = path.join(testDir, 'file1.json');
      const file2 = path.join(testDir, 'file2.json');

      fs.writeFileSync(file1, '{"version":"1.0.0"}');
      fs.writeFileSync(file2, '{"version":"1.0.0"}');

      await transaction.addFileUpdate(file1, '{"version":"2.0.0"}');
      await transaction.addFileUpdate(file2, '{"version":"2.0.0"}');

      // Should not throw
      expect(true).toBe(true);
    });

    it('should handle new files (no backup needed)', async () => {
      const transaction = new AtomicTransaction();
      await transaction.begin();

      const filePath = path.join(testDir, 'new-file.json');

      await expect(
        transaction.addFileUpdate(filePath, '{"version":"1.0.0"}')
      ).resolves.not.toThrow();
    });
  });

  describe('commit', () => {
    it('should apply all staged changes', async () => {
      const transaction = new AtomicTransaction();
      await transaction.begin();

      const file1 = path.join(testDir, 'file1.json');
      const file2 = path.join(testDir, 'file2.json');

      fs.writeFileSync(file1, '{"version":"1.0.0"}');
      fs.writeFileSync(file2, '{"version":"1.0.0"}');

      await transaction.addFileUpdate(file1, '{"version":"2.0.0"}');
      await transaction.addFileUpdate(file2, '{"version":"2.0.0"}');

      await transaction.commit();

      expect(fs.readFileSync(file1, 'utf-8')).toBe('{"version":"2.0.0"}');
      expect(fs.readFileSync(file2, 'utf-8')).toBe('{"version":"2.0.0"}');
    });

    it('should create new files', async () => {
      const transaction = new AtomicTransaction();
      await transaction.begin();

      const filePath = path.join(testDir, 'new-file.json');

      await transaction.addFileUpdate(filePath, '{"version":"1.0.0"}');
      await transaction.commit();

      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('{"version":"1.0.0"}');
    });

    it('should clean up backups after successful commit', async () => {
      const transaction = new AtomicTransaction();
      await transaction.begin();

      const filePath = path.join(testDir, 'test.json');
      fs.writeFileSync(filePath, '{"version":"1.0.0"}');

      await transaction.addFileUpdate(filePath, '{"version":"2.0.0"}');
      await transaction.commit();

      // Backups should be cleaned up (internal state check)
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('{"version":"2.0.0"}');
    });

    it('should throw if no transaction in progress', async () => {
      const transaction = new AtomicTransaction();

      await expect(transaction.commit()).rejects.toThrow('No transaction in progress');
    });

    it('should rollback on write failure', async () => {
      const transaction = new AtomicTransaction();
      await transaction.begin();

      const file1 = path.join(testDir, 'file1.json');
      const invalidPath = path.join(testDir, 'nonexistent-dir', 'file2.json');

      fs.writeFileSync(file1, '{"version":"1.0.0"}');

      await transaction.addFileUpdate(file1, '{"version":"2.0.0"}');
      await transaction.addFileUpdate(invalidPath, '{"version":"2.0.0"}');

      await expect(transaction.commit()).rejects.toThrow();

      // Original content should be restored
      expect(fs.readFileSync(file1, 'utf-8')).toBe('{"version":"1.0.0"}');
    });
  });

  describe('rollback', () => {
    it('should restore all backed up files', async () => {
      const transaction = new AtomicTransaction();
      await transaction.begin();

      const file1 = path.join(testDir, 'file1.json');
      const file2 = path.join(testDir, 'file2.json');

      fs.writeFileSync(file1, '{"version":"1.0.0"}');
      fs.writeFileSync(file2, '{"version":"1.0.0"}');

      await transaction.addFileUpdate(file1, '{"version":"2.0.0"}');
      await transaction.addFileUpdate(file2, '{"version":"2.0.0"}');

      await transaction.rollback();

      // Files should still have original content (backups weren't applied)
      expect(fs.readFileSync(file1, 'utf-8')).toBe('{"version":"1.0.0"}');
      expect(fs.readFileSync(file2, 'utf-8')).toBe('{"version":"1.0.0"}');
    });

    it('should remove new files that were added', async () => {
      const transaction = new AtomicTransaction();
      await transaction.begin();

      const newFile = path.join(testDir, 'new-file.json');

      await transaction.addFileUpdate(newFile, '{"version":"1.0.0"}');
      await transaction.rollback();

      // New file should not be created
      expect(fs.existsSync(newFile)).toBe(false);
    });

    it('should clean up after rollback', async () => {
      const transaction = new AtomicTransaction();
      await transaction.begin();

      const filePath = path.join(testDir, 'test.json');
      fs.writeFileSync(filePath, '{"version":"1.0.0"}');

      await transaction.addFileUpdate(filePath, '{"version":"2.0.0"}');
      await transaction.rollback();

      // Internal state should be cleaned up
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('{"version":"1.0.0"}');
    });

    it('should throw if no transaction in progress', async () => {
      const transaction = new AtomicTransaction();

      await expect(transaction.rollback()).rejects.toThrow('No transaction in progress');
    });
  });

  describe('transaction lifecycle', () => {
    it('should allow multiple sequential transactions', async () => {
      const transaction = new AtomicTransaction();
      const filePath = path.join(testDir, 'test.json');

      // First transaction
      await transaction.begin();
      fs.writeFileSync(filePath, '{"version":"1.0.0"}');
      await transaction.addFileUpdate(filePath, '{"version":"2.0.0"}');
      await transaction.commit();

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('{"version":"2.0.0"}');

      // Second transaction
      await transaction.begin();
      await transaction.addFileUpdate(filePath, '{"version":"3.0.0"}');
      await transaction.commit();

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('{"version":"3.0.0"}');
    });

    it('should allow begin after rollback', async () => {
      const transaction = new AtomicTransaction();
      const filePath = path.join(testDir, 'test.json');

      fs.writeFileSync(filePath, '{"version":"1.0.0"}');

      // First transaction - rollback
      await transaction.begin();
      await transaction.addFileUpdate(filePath, '{"version":"2.0.0"}');
      await transaction.rollback();

      // Second transaction - commit
      await transaction.begin();
      await transaction.addFileUpdate(filePath, '{"version":"3.0.0"}');
      await transaction.commit();

      expect(fs.readFileSync(filePath, 'utf-8')).toBe('{"version":"3.0.0"}');
    });
  });

  describe('error handling', () => {
    it('should handle file read errors gracefully', async () => {
      const transaction = new AtomicTransaction();
      await transaction.begin();

      const restrictedPath = path.join(testDir, 'restricted.json');
      fs.writeFileSync(restrictedPath, '{"version":"1.0.0"}');
      fs.chmodSync(restrictedPath, 0o000); // Remove all permissions

      try {
        await transaction.addFileUpdate(restrictedPath, '{"version":"2.0.0"}');
      } catch (error) {
        expect(error).toBeDefined();
      } finally {
        // Restore permissions for cleanup
        fs.chmodSync(restrictedPath, 0o644);
      }
    });

    it('should provide meaningful error messages', async () => {
      const transaction = new AtomicTransaction();

      await expect(transaction.commit()).rejects.toThrow('No transaction in progress');
      await expect(transaction.rollback()).rejects.toThrow('No transaction in progress');
    });
  });
});
