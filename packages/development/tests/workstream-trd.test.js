'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCreateWorkstreamTrd } = require('../lib/trd-cli');
const { nextWorkstreamPath } = require('../lib/workstream-trd');

function trd(title, n, ac) {
  return `---\ndesign_readiness_score: 4.5\nstatus: Draft\n---\n# ${title}\n\nSummary.\n\nBased on PRD: docs/PRD/PRD-2026-00${n}.md\n\n## Master Task List\n\n### PR 1: Feature\n\n**Shippable State:** Done.\n\n- [ ] **TRD-001**: Implement thing [satisfies REQ-001]\n  - Validates PRD ACs: ${ac}\n  - Actions:\n    1. Build it\n`;
}

describe('create-workstream-trd', () => {
  test('writes a single executable workstream TRD with provenance and AC validation tasks', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workstream-trd-'));
    const a = path.join(dir, 'TRD-2026-001-alpha.md');
    const b = path.join(dir, 'TRD-2026-002-beta.md');
    const out = path.join(dir, 'workstream.md');
    fs.writeFileSync(a, trd('Alpha', 1, 'AC-001-1'));
    fs.writeFileSync(b, trd('Beta', 2, 'AC-002-1'));
    const result = runCreateWorkstreamTrd([a, b, '--out', out]);
    expect(result.ok).toBe(true);
    expect(result.path).toBe(out);
    const md = fs.readFileSync(out, 'utf8');
    expect(md).toContain('## Source TRD Manifest');
    expect(md).toContain('Source TRD: ' + a);
    expect(md).toContain('Source AC: AC-001-1');
    expect(md).toContain('**TRD-S01-001**');
    expect(md).toContain('**TRD-S01-AC-001-1**');
    expect(md).toContain('/ensemble:implement-trd-beads');
  });

  test('default workstream path uses micro UUID instead of sequence number', () => {
    const out = nextWorkstreamPath('docs/TRD/workstreams', 2026, 'alpha-beta', 'a1b2c3d4');
    expect(out).toBe('docs/TRD/workstreams/TRD-2026-a1b2c3d4-workstream-alpha-beta.md');
    expect(out).not.toMatch(/TRD-2026-\d{3}-workstream/);
  });
});
