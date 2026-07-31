const fs = require('fs');
const path = require('path');

describe('implement-trd-beads command progress behavior', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('does not pause for routine progress or context checkpoints', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('Non-Interactive Progress Policy');
    expect(text).toContain('Do NOT stop, pause, ask for acknowledgement');
    expect(text).toContain('real user decision');
    expect(text).not.toContain('Context checkpoint: <N> tasks completed this session');
    expect(text).not.toContain('/compact to compress conversation context');
  });

  test('resolves shorthand agents to runtime namespaced plugin agents before delegation', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('AGENT_ALIAS_MAP');
    expect(text).toContain('ensemble-full:backend-developer');
    expect(text).toContain('Task(agent_type=<resolved_specialist>');
    expect(text).toContain('resolved @code-reviewer');
    expect(text).toContain('resolved @deep-debugger');
  });

  test('does not call trd_progress after every task', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('Do NOT call trd_progress() here');
    expect(text).not.toContain('After each task (or parallel group): br sync --flush-only, then call trd_progress()');
  });
});


describe('implement-trd-beads RCA quality gates', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');

  test('supports AC/XC synthetic task ids and Definition of Done closure gates', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('AC-NNN-M');
    expect(text).toMatch(/xc-validation:<XC_ID>/);  // XC validation token from DoD gate
    expect(text).toContain('Definition of Done gate');
    expect(text).toContain('no new src/**/*.FIXME');
    expect(text).toContain('Only close when verdict:proven');
  });
});


describe('implement-trd-beads direct multi-TRD deprecation', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');
  test('errors on direct multiple TRDs and points to create-workstream-trd', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('Multiple TRDs passed directly');
    expect(text).toContain('/ensemble:create-workstream-trd');
    expect(text).toContain('--legacy-multi');
    expect(text).toContain('DEPRECATED: direct multi-TRD mode');
  });
});


describe('implement-trd-beads POST-WORKER AUDIT control flow', () => {
  const yamlPath = path.join(__dirname, '../commands/implement-trd-beads.yaml');
  const text = fs.readFileSync(yamlPath, 'utf8');

  // Isolate sections by index — indentation-insensitive
  const acStart = text.indexOf('For AC-* beads (TASK_TRACEABILITY');
  const xcStart = text.indexOf('For XC-* beads (TASK_TRACEABILITY');
  const regularStart = text.indexOf('For regular task beads (not synthetic)');
  const acSection = acStart >= 0 && xcStart > acStart ? text.slice(acStart, xcStart) : '';
  const xcSection = xcStart >= 0 && regularStart > xcStart ? text.slice(xcStart, regularStart) : '';

  test('test-passed==false: early HALT before any attestation branch, no fallthrough to sync/amend', () => {
    const haltIndex = text.indexOf('HALT — do NOT return to step (h)');
    const acBeadsIndex = text.indexOf('For AC-* beads (TASK_TRACEABILITY');
    expect(haltIndex).toBeGreaterThan(0);
    expect(acBeadsIndex).toBeGreaterThan(haltIndex);
    const testFailureBlock = text.match(/test-passed == false[\s\S]*?HALT — do NOT return to step \(h\), do NOT retry[\s\S]*?drain is stopped/)?.[0] ?? '';
    expect(testFailureBlock).not.toMatch(/git add \.beads[\s\S]*?git commit --amend/s);
  });

  test('AC verdict not_proven: full reset chain, HALT, no stale continue-to-(h)', () => {
    const notProvenBlock = acSection.match(/COMMENT_VERDICT != 'proven'[\s\S]*?HALT — do NOT continue to step \(h\)[,;].*?drain is stopped/s)?.[0] ?? '';
    expect(notProvenBlock).toContain('br update <BEAD_ID> --status=open');
    expect(notProvenBlock).toContain('verdict:not_proven — ac-validation failed');
    expect(notProvenBlock).toContain('br sync --flush-only');
    expect(notProvenBlock).toContain('git commit --amend --no-edit');
    expect(notProvenBlock).toContain('DRAIN HALTED: AC verdict not_proven');
    expect(acSection).not.toMatch(/Skip phase-gate.*continue to step \(h\)/s);
  });

  test('XC verdict not_proven: full reset chain, HALT, no stale continue-to-(h)', () => {
    const notProvenBlock = xcSection.match(/COMMENT_VERDICT != 'proven'[\s\S]*?HALT — do NOT continue to step \(h\)[,;].*?drain is stopped/s)?.[0] ?? '';
    expect(notProvenBlock).toContain('br update <BEAD_ID> --status=open');
    expect(notProvenBlock).toContain('verdict:not_proven — xc-validation failed');
    expect(notProvenBlock).toContain('br sync --flush-only');
    expect(notProvenBlock).toContain('git commit --amend --no-edit');
    expect(notProvenBlock).toContain('DRAIN HALTED: XC verdict not_proven');
    expect(xcSection).not.toMatch(/Skip phase-gate.*continue to step \(h\)/s);
  });

  test('AC proven verdict: root epic gets req-verified token with verification_mode:worker', () => {
    const provenBlock = acSection.match(/COMMENT_VERDICT == 'proven'[\s\S]*?verification_mode:worker/s)?.[0] ?? '';
    expect(provenBlock).toContain('br comment add <ROOT_EPIC_ID>');
    expect(provenBlock).toMatch(/req-verified:<REQ_ID>.*?verification_mode:worker/s);
    expect(acSection).not.toContain("br comment add <ROOT_EPIC_ID> 'req-verified:undefined");
  });

  test('XC proven verdict: root epic gets req-verified from XC own satisfies_req_id, not dependsOn chain', () => {
    expect(xcSection).toContain('br comment add <BEAD_ID>');
    expect(xcSection).toMatch(/TASK_TRACEABILITY\[XC_ID\]\.satisfies_req_id/);
    expect(xcSection).not.toMatch(/dependsOn.*satisfies_req_id/);
    expect(xcSection).toContain('verification_mode:worker');
  });
  describe('WORKER_COMPLETE mandatory fields and cross-validation', () => {
    const postWorkerSection = text.slice(text.indexOf("Parse the following mandatory fields from the WORKER_COMPLETE block"));
    test('Parses all mandatory WORKER_COMPLETE fields: bead, test-passed, test-attempts, test-framework, branch, commit-sha, files-changed, validation, commit', () => {
      expect(postWorkerSection).toContain("worker_bead (from 'bead=')");
      expect(postWorkerSection).toContain("test_passed (from 'test-passed=')");
      expect(postWorkerSection).toContain("test_attempts (from 'test-attempts=')");
      expect(postWorkerSection).toContain("test_framework (from 'test-framework=')");
      expect(postWorkerSection).toContain("verified_branch (from 'branch=')");
      expect(postWorkerSection).toContain("commit_sha (from 'commit-sha=')");
      expect(postWorkerSection).toContain("files_changed (from 'files-changed=')");
      expect(postWorkerSection).toContain("validation_result (from 'validation=')");
      expect(postWorkerSection).toContain("worker_commit (from 'commit=')");
      expect(postWorkerSection).toContain("HALT with an AUDIT ERROR if any are missing or empty");
    });
    test('Requires worker_bead == BEAD_ID before any phase-gate or attestation', () => {
      expect(postWorkerSection).toMatch(/Require worker_bead == <BEAD_ID>[\s\S]*?WORKER_COMPLETE\.bead <worker_bead> does not match current bead <BEAD_ID>.*?Wrong task context.*?HALT/s);
    });

    test('test-passed==true requires commit-sha != none and commit-sha == git rev-parse HEAD', () => {
      expect(postWorkerSection).toMatch(/test_passed == 'true'[\s\S]*?commit_sha != 'none'[\s\S]*?commit_sha == \$\(git rev-parse HEAD\)[\s\S]*?HALT/s);
    });

    test('test-passed==false requires commit-sha == none (sentinel)', () => {
      expect(postWorkerSection).toMatch(/test_passed == 'false'[\s\S]*?commit_sha == 'none'[\s\S]*?Worker should not have committed on test failure[\s\S]*?HALT/s);
    });
  });
});
