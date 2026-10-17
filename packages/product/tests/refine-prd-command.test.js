'use strict';

// refine-prd is the review. It used to end on a printed summary, which left a
// refined PRD indistinguishable from a draft and gave the session nothing to do
// next. It now closes with an explicit lock decision, asked through
// AskUserQuestion, and only the LOCK branch prints create-trd.

const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '../commands/refine-prd.yaml');
const generatedPath = path.join(__dirname, '../commands/ensemble/refine-prd.md');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

const bothForms = [
  ['source YAML', sourcePath],
  ['generated command markdown', generatedPath],
];

describe('refine-prd closes with a lock decision', () => {
  test.each(bothForms)('%s has a PRD Lock step', (_label, filePath) => {
    expect(read(filePath)).toContain('PRD Lock');
  });

  test.each(bothForms)('%s always runs the lock step last', (_label, filePath) => {
    const text = read(filePath);
    expect(text).toContain('This step ALWAYS runs, and it is the last thing this command does');
    // The old ending. If a run can still finish on the summary, the lock is optional.
    expect(text).toContain('The run does not end on a printed summary');
  });

  test.each(bothForms)('%s asks through AskUserQuestion, not prose', (_label, filePath) => {
    const text = read(filePath);
    expect(text).toContain('Present the close-out through AskUserQuestion, not prose');
    expect(text).toContain('has not read the PRD and is not going to');
  });

  test.each(bothForms)('%s recommends locking and sets the status', (_label, filePath) => {
    const text = read(filePath);
    expect(text).toContain('Option 1, and the recommendation: LOCK the PRD');
    expect(text).toContain('status: Locked');
  });

  test.each(bothForms)('%s gates create-trd behind the lock', (_label, filePath) => {
    const text = read(filePath);
    expect(text).toContain('print it only on the LOCK branch');
    expect(text).toContain('An unlocked PRD has no business producing a TRD');
  });

  // The distinction that keeps this from turning one prompt into seven: a
  // finding is anything the PRD or the constitution already has a rule for, and
  // findings are applied during Synthesis rather than asked about here.
  test.each(bothForms)('%s asks only genuinely open questions', (_label, filePath) => {
    const text = read(filePath);
    expect(text).toContain('Ask genuine open questions ONLY');
    expect(text).toContain('never manufacture a question to fill the slot');
  });

  test.each(bothForms)('%s auto-locks under --foreman', (_label, filePath) => {
    expect(read(filePath)).toContain('If --foreman is set, skip the question, lock the PRD');
  });
});
