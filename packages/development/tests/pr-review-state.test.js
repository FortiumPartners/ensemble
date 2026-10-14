const fs = require('fs');
const os = require('os');
const path = require('path');
const { statePath, writeState, readState, redact } = require('../lib/pr-review-state');

function tmpCwd() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pr-review-state-'));
}

function pendingState(overrides = {}) {
  return {
    baseSha: 'base-sha-1',
    headSha: 'head-sha-1',
    ledger: [{ id: 'f1', disposition: 'fix', evidence: 'stack trace' }],
    localPhase: 'LOCAL_REVIEW_PENDING',
    remotePhase: 'REMOTE_REVIEW_PENDING',
    rounds: { used: 1, max: 2 },
    next: 'run-fix-round',
    ...overrides,
  };
}

describe('pr-review-state: redact', () => {
  test('redacts a GitHub-token-shaped value embedded in text', () => {
    const redacted = redact({ evidence: 'leaked token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' });
    expect(redacted.evidence).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
    expect(redacted.evidence).toContain('[REDACTED]');
  });

  test('redacts any field whose key names a credential regardless of shape', () => {
    const redacted = redact({ apiKey: 'plain-looking-value', password: 'hunter2' });
    expect(redacted.apiKey).toBe('[REDACTED]');
    expect(redacted.password).toBe('[REDACTED]');
  });

  test('redacts an Authorization header value', () => {
    const redacted = redact({ note: 'Authorization: Bearer abc123.def456' });
    expect(redacted.note).not.toContain('abc123.def456');
  });
});

describe('pr-review-state: writeState / readState', () => {
  test('secrets are redacted on disk -- a ledger entry containing a token leaves no token value in the file', () => {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    const state = pendingState({
      ledger: [{ id: 'f1', disposition: 'fix', evidence: 'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' }],
    });
    const result = writeState(target, state, { cwd });
    expect(result.ok).toBe(true);
    const raw = fs.readFileSync(target, 'utf8');
    expect(raw).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
  });

  test('report holds the required fields and lives under .ensemble/pr-review/', () => {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    expect(target).toContain(path.join('.ensemble', 'pr-review'));
    writeState(target, pendingState(), { cwd });
    const raw = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(raw.headSha).toBe('head-sha-1');
    expect(raw.baseSha).toBe('base-sha-1');
    expect(raw.ledger).toHaveLength(1);
    expect(raw.localPhase).toBe('LOCAL_REVIEW_PENDING');
    expect(raw.remotePhase).toBe('REMOTE_REVIEW_PENDING');
    expect(raw.next).toBe('run-fix-round');
  });

  test('resume re-checks the same head -- dispositioned findings are returned', () => {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    writeState(target, pendingState({ headSha: 'head-H' }), { cwd });
    const result = readState(target, 'head-H', { cwd });
    expect(result.ok).toBe(true);
    expect(result.discarded).toBe(false);
    expect(result.dispositionedFindings).toHaveLength(1);
    expect(result.dispositionedFindings[0].id).toBe('f1');
  });

  test('new head discards old state -- a different head does not return the prior review state', () => {
    const cwd = tmpCwd();
    const target = statePath('42', cwd);
    writeState(target, pendingState({ headSha: 'head-A' }), { cwd });
    const result = readState(target, 'head-B', { cwd });
    expect(result.ok).toBe(true);
    expect(result.discarded).toBe(true);
    expect(result.state).toBeNull();
    expect(result.dispositionedFindings).toEqual([]);
  });

  test('reading a path with no report yet reports not-exists without error', () => {
    const cwd = tmpCwd();
    const target = statePath('no-such-pr', cwd);
    const result = readState(target, 'any-head', { cwd });
    expect(result.ok).toBe(true);
    expect(result.exists).toBe(false);
  });

  test('refuses to write to a path outside .ensemble/pr-review/', () => {
    const cwd = tmpCwd();
    const outside = path.join(cwd, 'evil.json');
    const result = writeState(outside, pendingState(), { cwd });
    expect(result.ok).toBe(false);
    expect(fs.existsSync(outside)).toBe(false);
  });

  test('refuses to read from a path outside .ensemble/pr-review/', () => {
    const cwd = tmpCwd();
    const outside = path.join(cwd, 'evil.json');
    fs.writeFileSync(outside, JSON.stringify(pendingState()));
    const result = readState(outside, 'head-sha-1', { cwd });
    expect(result.ok).toBe(false);
  });
});
