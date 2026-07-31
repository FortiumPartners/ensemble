const fs = require('fs');
const path = require('path');

describe('implement-bead-worker synthetic failure paths', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-bead-worker.yaml');
  const text = fs.readFileSync(yamlPath, 'utf8');

  test('test-failure: prints WORKER_COMPLETE with literal sentinel values before HALT', () => {
    // The test-failure block must print WORKER_COMPLETE with literal sentinel commit-sha=none
    // files-changed=uncommitted validation=test-failed:exhausted-retries commit=none
    // before HALT, and must not use any variable interpolation for those fields
    const block = text.match(/tests still fail after 2 attempts:[\s\S]*?HALT/)?.[0] ?? '';
    expect(block).toContain('WORKER_COMPLETE:');
    expect(block).toMatch(/commit-sha=none/);
    expect(block).toMatch(/files-changed=uncommitted/);
    expect(block).toMatch(/validation=test-failed:exhausted-retries/);
    expect(block).toMatch(/commit=none/);
    expect(block).toMatch(/test-passed=false/);
    expect(block).toMatch(/test-attempts=3/);
    expect(block).toContain('HALT');
    // Must reset to open, comment, and sync before halting
    expect(block).toContain('br update <BEAD_ID> --status=open');
    expect(block).toContain('br sync --flush-only');
    expect(block).toContain('HALT');
  });

  test('test-failure: resets bead to open before HALT so standalone use cannot strand in_progress', () => {
    const block = text.match(/tests still fail after 2 attempts:[\s\S]*?HALT/)?.[0] ?? '';
    const resetIndex = block.indexOf('br update <BEAD_ID> --status=open');
    const haltIndex = block.indexOf('HALT');
    expect(resetIndex).toBeGreaterThan(0);
    expect(haltIndex).toBeGreaterThan(resetIndex);
    expect(block).toContain('status:open test-failed:exhausted-retries');
  });

  test('synthetic not_proven: worker self-resets to open and syncs before HALT', () => {
    // The not_proven HALT in Complete step 2 must self-reset the bead before HALT
    // so standalone callers (implement-bead.yaml) cannot leave it in_progress
    const block = text.match(/SYNTHETIC_KIND in \("ac-validation","cross-cutting"\)[\s\S]*?HALT/)?.[0] ?? '';
    expect(block).toContain('br update <BEAD_ID> --status=open');
    expect(block).toContain('br sync --flush-only');
    expect(block).toContain('HALT');
    // Must print WORKER_COMPLETE before HALT
    expect(block).toMatch(/WORKER_COMPLETE:.*test-passed=/);
  });

  test('synthetic not_proven: HALT message mentions worker self-reset and idempotent supervisor audit', () => {
    // Check the full text since "worker self-reset" appears in the HALT print message itself
    // (after the word HALT that terminates the regex capture block)
    expect(text).toContain('worker self-reset');
    expect(text).toContain('idempotent for TRD audit');
  });
  test('synthetic not_proven: worker stages beads export, amends, refreshes COMMIT_SHA, then prints WORKER_COMPLETE and HALT', () => {
    // Standalone callers (implement-bead.yaml) need an immutable reset record in git.
    const block = text.match(/SYNTHETIC_KIND in \("ac-validation","cross-cutting"\)[\s\S]*?HALT/)?.[0] ?? '';
    expect(block).toContain('br update <BEAD_ID> --status=open');
    expect(block).toContain('br comment add <BEAD_ID>');
    expect(block).toContain('br sync --flush-only');
    expect(block).toMatch(/git add \.beads\/beads\.jsonl/);
    expect(block).toContain('git commit --amend --no-edit');
    expect(block).toMatch(/WORKER_COMMIT_SHA=\$\(git rev-parse HEAD\)/);
    expect(block).toContain('WORKER_COMPLETE:');
    expect(block).toContain('HALT');
  });
});

describe('implement-bead-worker Preflight synthetic kind inference and validation', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-bead-worker.yaml');
  const text = fs.readFileSync(yamlPath, 'utf8');

  test('Preflight derives TITLE_SYNTHETIC_KIND from scaffold-anchored regex', () => {
    expect(text).toContain('Derive TITLE_SYNTHETIC_KIND');
    expect(text).toContain('/\\[trd:[^\\]]+:task:(AC-\\d');
    expect(text).toContain('/\\[trd:[^\\]]+:task:(XC-[A-Z0-9]');
  });

  test('mismatch between flag and title-derived kind causes HALT before validation', () => {
    const block = text.match(/SYNTHETIC_KIND != "" AND SYNTHETIC_KIND != TITLE_SYNTHETIC_KIND[\s\S]*?HALT/)?.[0] ?? '';
    expect(block).toContain('conflicts with title-derived kind');
    expect(block).toContain('HALT');
  });

  test('ac-validation flag with no AC_ID in title causes HALT', () => {
    const block = text.match(/--synthetic ac-validation but no AC ID[\s\S]*?HALT/)?.[0] ?? '';
    expect(block).toContain('HALT');
  });

  test('cross-cutting flag with no XC_ID in title causes HALT', () => {
    const block = text.match(/--synthetic cross-cutting but no XC ID[\s\S]*?HALT/)?.[0] ?? '';
    expect(block).toContain('HALT');
  });

  test('no flag: adopts title-derived SYNTHETIC_KIND via exact assignment', () => {
    expect(text).toContain('SYNTHETIC_KIND=TITLE_SYNTHETIC_KIND');
  });

  test('Validate phase AC_ID and XC_ID extraction uses scaffold-anchored regex', () => {
    expect(text).toContain('\\[trd:[^\\]]+:task:(AC-\\d');
    expect(text).toContain('\\[trd:[^\\]]+:task:(XC-[A-Z0-9]');
  });
});
