'use strict';

const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '../commands/ensemble/init-project.md');

function constitutionTemplate() {
  const text = fs.readFileSync(sourcePath, 'utf8');
  const stepStart = text.indexOf('### Step 3: Generate Constitution');
  expect(stepStart).toBeGreaterThan(-1);
  const fenceStart = text.indexOf('```markdown', stepStart);
  const fenceEnd = text.indexOf('```', fenceStart + 1);
  expect(fenceStart).toBeGreaterThan(-1);
  expect(fenceEnd).toBeGreaterThan(fenceStart);
  return text.slice(fenceStart, fenceEnd);
}

describe('init-project generated constitution headings', () => {
  test('every enforceable rule section heading matches the Constitution Gate Contract\'s article-id pattern', () => {
    const template = constitutionTemplate();
    // "## Changelog" is a log table, not an enforceable rule section -- the
    // Constitution Gate Contract only requires *enforceable checks* to map to
    // an article id, not every heading in the document.
    const headings = template
      .split('\n')
      .filter((line) => line.startsWith('## ') && line !== '## Changelog');

    expect(headings.length).toBeGreaterThan(0);
    // The Constitution Gate Contract (create-prd.yaml / create-trd.yaml, "Extract
    // source article heading identifiers") matches repo-local heading text such
    // as "Article I", "Article 1", or "A1". A plain "## 1. Core Principles"
    // numbered section (the bug this test guards against) satisfies none of
    // those and is unmappable to an article id.
    const articleHeading = /^## Article [IVXLCDM]+: /;
    for (const heading of headings) {
      expect(heading).toMatch(articleHeading);
    }
  });

  test('covers all five constitution sections', () => {
    const template = constitutionTemplate();
    expect(template).toContain('## Article I: Core Principles');
    expect(template).toContain('## Article II: Tech Stack');
    expect(template).toContain('## Article III: Quality Gates (Definition of Done)');
    expect(template).toContain('## Article IV: Approval Requirements');
    expect(template).toContain('## Article V: Agent Delegation Standards');
  });
});
