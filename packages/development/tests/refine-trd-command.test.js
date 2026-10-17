'use strict';

// refine-trd is the review. It used to end on a printed summary, so a session
// reached the end of the pipeline with nothing telling it whether to build. It
// now closes with an explicit go/no-go, asked through AskUserQuestion, and only
// the GO branch prints an implement command.

const fs = require('fs');
const path = require('path');

const sourcePath = path.join(__dirname, '../commands/refine-trd.yaml');
const generatedPath = path.join(__dirname, '../commands/ensemble/refine-trd.md');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

const bothForms = [
  ['source YAML', sourcePath],
  ['generated command markdown', generatedPath],
];

describe('refine-trd closes with a go/no-go', () => {
  test.each(bothForms)('%s has an Implementation Go / No-Go step', (_label, filePath) => {
    expect(read(filePath)).toContain('Implementation Go / No-Go');
  });

  test.each(bothForms)('%s always runs the decision step last', (_label, filePath) => {
    const text = read(filePath);
    expect(text).toContain('This step ALWAYS runs, and it is the last thing this command does');
    expect(text).toContain('The run does not end on a printed summary');
  });

  test.each(bothForms)('%s asks through AskUserQuestion, not prose', (_label, filePath) => {
    const text = read(filePath);
    expect(text).toContain('Present the close-out through AskUserQuestion, not prose');
    expect(text).toContain('has not read the TRD and is not going to');
  });

  test.each(bothForms)('%s gates the implement command behind GO', (_label, filePath) => {
    const text = read(filePath);
    expect(text).toContain('Option 1, and the recommendation: GO');
    expect(text).toContain('print it only on the GO branch');
  });

  // The PRD is locked before the TRD exists. A TRD refined against a PRD that
  // has since moved is a refined copy of the wrong document, so this path has to
  // refuse implementation outright rather than warn and carry on.
  test.each(bothForms)('%s checks the source PRD is locked', (_label, filePath) => {
    const text = read(filePath);
    expect(text).toContain('confirm the TRD');
    expect(text).toContain('status');
    expect(text).toContain('the requirements can still move underneath the build');
  });

  test.each(bothForms)('%s refuses to offer implementation when the PRD moved', (_label, filePath) => {
    const text = read(filePath);
    expect(text).toContain('do NOT offer implementation at all');
    expect(text).toContain('/ensemble:create-trd to re-create this TRD');
    expect(text).toContain('a refined copy of the wrong document');
  });

  // implement-trd-beads and implement-trd are separate commands, not a flag.
  // Plain implement-trd makes no beads calls and cannot resume across sessions.
  test.each(bothForms)('%s prefers implement-trd-beads and says why', (_label, filePath) => {
    const text = read(filePath);
    expect(text).toContain('Prefer implement-trd-beads over implement-trd');
    expect(text).toContain('separate commands, not a flag');
  });

  test.each(bothForms)('%s asks only genuinely open questions', (_label, filePath) => {
    expect(read(filePath)).toContain('Ask genuine open questions ONLY');
  });

  test.each(bothForms)('%s auto-goes under --foreman', (_label, filePath) => {
    expect(read(filePath)).toContain('If --foreman is set, skip the question, record GO');
  });

  // expectedOutput has always declared a Configure-Team Suggestion, but no step
  // emitted it. A declared output that nothing produces is a check measuring
  // nothing.
  test.each(bothForms)('%s actually emits the configure-team recommendation it declares', (_label, filePath) => {
    const text = read(filePath);
    expect(text).toContain('Configure-Team Suggestion');
    expect(text).toContain('recommending /ensemble:configure-team be re-run');
  });
});
