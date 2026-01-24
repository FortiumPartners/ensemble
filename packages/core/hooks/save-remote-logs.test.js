#!/usr/bin/env node

/**
 * save-remote-logs.test.js - Unit tests for save-remote-logs hook
 *
 * Tests the SessionEnd hook that captures remote session logs.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Import functions from the hook module
const {
  getSessionLogDir,
  getSessionStartTime,
  findSessionLogs,
  extractSessionId,
  copyLogs,
  commitLogs,
  DEFAULT_LOGS_DEST
} = require('./save-remote-logs.js');

// Test utilities
let testDir;
let testLogDir;
let testDestDir;

function setupTestEnvironment() {
  // Create temporary test directories
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'save-logs-test-'));
  testLogDir = path.join(testDir, 'session-logs');
  testDestDir = path.join(testDir, 'repo', DEFAULT_LOGS_DEST);

  fs.mkdirSync(testLogDir, { recursive: true });
  fs.mkdirSync(path.join(testDir, 'repo'), { recursive: true });

  // Initialize git repo for commit tests
  execSync('git init', { cwd: path.join(testDir, 'repo'), encoding: 'utf8' });
  execSync('git config user.email "test@test.com"', { cwd: path.join(testDir, 'repo'), encoding: 'utf8' });
  execSync('git config user.name "Test User"', { cwd: path.join(testDir, 'repo'), encoding: 'utf8' });

  return testDir;
}

function cleanupTestEnvironment() {
  if (testDir && fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

function createTestSessionLog(filename, content, mtime = null) {
  const filePath = path.join(testLogDir, filename);
  fs.writeFileSync(filePath, content);
  if (mtime) {
    fs.utimesSync(filePath, mtime, mtime);
  }
  return filePath;
}

// Test runner
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passCount++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}`);
    failCount++;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\n  Expected: ${JSON.stringify(expected)}\n  Actual: ${JSON.stringify(actual)}`);
  }
}

function assertArrayLength(array, expectedLength, message = '') {
  if (!Array.isArray(array)) {
    throw new Error(`${message}\n  Expected array, got: ${typeof array}`);
  }
  if (array.length !== expectedLength) {
    throw new Error(`${message}\n  Expected length: ${expectedLength}\n  Actual length: ${array.length}`);
  }
}

function assertTrue(value, message = '') {
  if (!value) {
    throw new Error(`${message}\n  Expected truthy value, got: ${value}`);
  }
}

// Tests

test('getSessionLogDir extracts directory from transcript path', () => {
  const result = getSessionLogDir('/home/user/.claude/projects/proj/abc123.jsonl');
  assertEqual(result, '/home/user/.claude/projects/proj');
});

test('getSessionLogDir returns null for null input', () => {
  const result = getSessionLogDir(null);
  assertEqual(result, null);
});

test('extractSessionId extracts ID from transcript path', () => {
  const result = extractSessionId('/path/to/abc-123-def.jsonl');
  assertEqual(result, 'abc-123-def');
});

test('extractSessionId returns null for null input', () => {
  const result = extractSessionId(null);
  assertEqual(result, null);
});

test('DEFAULT_LOGS_DEST has expected value', () => {
  assertEqual(DEFAULT_LOGS_DEST, '.claude-sessions/logs');
});

// Integration tests that require file system
console.log('\n--- Integration Tests ---\n');

setupTestEnvironment();

try {
  test('getSessionStartTime reads timestamp from JSONL first line', () => {
    const sessionId = 'test-session-123';
    const timestamp = '2026-01-14T10:00:00.000Z';
    const content = JSON.stringify({ timestamp, type: 'user', sessionId }) + '\n';
    const filePath = createTestSessionLog(`${sessionId}.jsonl`, content);

    const result = getSessionStartTime(filePath);
    assertTrue(result instanceof Date, 'Should return a Date');
    assertEqual(result.toISOString(), timestamp);
  });

  test('findSessionLogs finds files created after start time', () => {
    const now = new Date();
    const past = new Date(now.getTime() - 60000); // 1 minute ago
    const future = new Date(now.getTime() + 60000); // 1 minute from now

    // Create main session (current)
    const mainContent = JSON.stringify({ timestamp: now.toISOString(), type: 'user' }) + '\n';
    createTestSessionLog('main-session.jsonl', mainContent);

    // Create subagent session (newer than start)
    const subContent = JSON.stringify({ timestamp: now.toISOString(), type: 'user' }) + '\n';
    createTestSessionLog('sub-session.jsonl', subContent);

    // Create old session (older than start)
    const oldContent = JSON.stringify({ timestamp: past.toISOString(), type: 'user' }) + '\n';
    const oldPath = createTestSessionLog('old-session.jsonl', oldContent, past);

    const logs = findSessionLogs(testLogDir, now, 'main-session');

    // Should find main session (by ID match) and sub session (by time)
    // Old session should still be found since its mtime is when we wrote it
    assertTrue(logs.length >= 2, `Should find at least 2 logs, found ${logs.length}`);
    assertTrue(logs.some(l => l.includes('main-session')), 'Should include main session');
  });

  test('copyLogs copies files to destination', () => {
    const sessionId = 'copy-test-session';
    const content = JSON.stringify({ type: 'test' }) + '\n';
    const srcPath = createTestSessionLog(`${sessionId}.jsonl`, content);

    const copied = copyLogs([srcPath], testDestDir);

    assertArrayLength(copied, 1, 'Should copy 1 file');
    assertTrue(fs.existsSync(copied[0]), 'Destination file should exist');

    const destContent = fs.readFileSync(copied[0], 'utf-8');
    assertEqual(destContent, content, 'Content should match');
  });

  test('copyLogs creates destination directory if needed', () => {
    const newDestDir = path.join(testDir, 'repo', 'new-dest', 'logs');
    const sessionId = 'new-dest-session';
    const content = JSON.stringify({ type: 'test' }) + '\n';
    const srcPath = createTestSessionLog(`${sessionId}.jsonl`, content);

    const copied = copyLogs([srcPath], newDestDir);

    assertArrayLength(copied, 1, 'Should copy 1 file');
    assertTrue(fs.existsSync(newDestDir), 'Destination directory should exist');
  });

  test('commitLogs creates git commit', () => {
    const repoDir = path.join(testDir, 'repo');
    const sessionId = 'commit-test-session';

    // Create a file to commit
    const logsDir = path.join(repoDir, '.claude-sessions', 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const logFile = path.join(logsDir, `${sessionId}.jsonl`);
    fs.writeFileSync(logFile, JSON.stringify({ type: 'test' }) + '\n');

    const result = commitLogs([logFile], sessionId, repoDir);

    assertTrue(result, 'Commit should succeed');

    // Verify commit exists
    const gitLog = execSync('git log --oneline -1', { cwd: repoDir, encoding: 'utf8' });
    assertTrue(gitLog.includes('session-logs'), 'Commit message should mention session-logs');
  });

  test('commitLogs returns false for empty file list', () => {
    const repoDir = path.join(testDir, 'repo');
    const result = commitLogs([], 'empty-session', repoDir);
    assertEqual(result, false, 'Should return false for empty file list');
  });

} finally {
  cleanupTestEnvironment();
}

// Summary
console.log('\n--- Summary ---');
console.log(`Passed: ${passCount}`);
console.log(`Failed: ${failCount}`);

process.exit(failCount > 0 ? 1 : 0);
