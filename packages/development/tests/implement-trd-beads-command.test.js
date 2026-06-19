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

  test('does not call trd_progress after every task', () => {
    const text = fs.readFileSync(yamlPath, 'utf8');
    expect(text).toContain('Do NOT call trd_progress() here');
    expect(text).not.toContain('After each task (or parallel group): br sync --flush-only, then call trd_progress()');
  });
});
