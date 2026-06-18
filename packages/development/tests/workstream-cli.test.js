'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { runValidateWorkstream, runWorkstreamPlan } = require('../lib/trd-cli');

function writeTrd(dir, name, title) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `---\ndocument_id: TRD-TEST\nprd_reference: docs/PRD/demo.md\ndesign_readiness_score: 4.2\nstatus: Draft\n---\n\n# ${title}\n\nBased on PRD: docs/PRD/demo.md\n\n## Master Task List\n\n### PR 1: First\n\n**Shippable State:** Users can run the first slice.\n\n- [ ] **TRD-001**: Do work (1h) [satisfies REQ-001]\n  - Validates PRD ACs: AC-001-1\n  - Target File: demo.js\n  - Actions:\n    1. Implement\n  - Implementation AC:\n    - Given input, when run, then output is correct.\n`);
  return file;
}

describe('workstream CLI handlers', () => {
  test('validate-workstream and workstream-plan return JSON-safe objects', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workstream-cli-'));
    const a = writeTrd(dir, 'TRD-2026-900-alpha.md', 'Alpha');
    const b = writeTrd(dir, 'TRD-2026-901-beta.md', 'Beta');
    expect(runValidateWorkstream([a, b])).toMatchObject({ ok: true });
    const plan = runWorkstreamPlan([a, b, '--stacked'], {});
    expect(plan.ok).toBe(true);
    expect(plan.releaseTrain.titlePrefix).toContain('[release-train:');
    expect(plan.scaffoldPlans).toHaveLength(2);
  });
});
