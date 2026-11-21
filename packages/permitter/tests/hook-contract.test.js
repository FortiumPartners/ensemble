/**
 * Contract tests for the PermissionRequest hook as Claude Code actually runs it.
 *
 * These spawn `hooks/permitter.js` as a real child process with a JSON payload on
 * stdin and assert on stdout + exit code, because that is the whole interface
 * Claude Code sees. Two defects these pin closed:
 *
 *   1. The registered hook command must be shell-quoted, otherwise an install path
 *      containing a space execs as two words and the hook exits 127.
 *   2. Claude Code accepts only "allow" | "deny" in hookSpecificOutput.decision
 *      .behavior for a PermissionRequest hook. "ask" is an invalid response, so any
 *      path that used to emit it silently discarded the hook's answer - and routed
 *      denylist hits to it, so a denylist hit never blocked. Deferral now means
 *      "say nothing": empty stdout, exit 0, and Claude Code shows its own prompt.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOK = path.join(__dirname, '..', 'hooks', 'permitter.js');
const PERMITTER_HOOKS_JSON = path.join(__dirname, '..', 'hooks', 'hooks.json');
const FULL_HOOKS_JSON = path.join(__dirname, '..', '..', 'full', 'hooks', 'hooks.json');

// The full bundle ships the hook as a symlink into packages/permitter; Claude Code
// resolves it at install time, so the JSON in packages/full is a second copy that
// has to carry the same quoting.
const HOOKS_JSON_FILES = [PERMITTER_HOOKS_JSON, FULL_HOOKS_JSON];

let sandboxRoot;
let sandboxHome;

/**
 * Build a throwaway cwd + HOME so the settings loader only ever sees patterns this
 * test wrote. The operator's own ~/.claude/settings.json must not leak in.
 */
function makeSandbox(permissions) {
  const dir = fs.mkdtempSync(path.join(sandboxRoot, 'permit-'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.claude', 'settings.json'),
    JSON.stringify({ permissions }, null, 2)
  );
  fs.mkdirSync(path.join(sandboxHome, '.claude'), { recursive: true });
  return dir;
}

function runHook(payload, opts = {}) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const res = spawnSync(process.execPath, [HOOK], {
    cwd: opts.cwd,
    encoding: 'utf8',
    input,
    env: {
      ...process.env,
      HOME: sandboxHome,
      PERMITTER_DEBUG: '0',
      // Keep the run hermetic: an operator-exported disable flag would make
      // every hook call defer. The disabled-hook test re-sets it via opts.env.
      ENSEMBLE_PERMITTER_DISABLE: '0',
      ...opts.env,
    },
  });
  return { stdout: res.stdout || '', stderr: res.stderr || '', status: res.status };
}

function decisionOf(stdout) {
  if (!stdout.trim()) return null;
  const parsed = JSON.parse(stdout);
  return parsed?.hookSpecificOutput?.decision ?? null;
}

beforeAll(() => {
  sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'permitter-contract-'));
  sandboxHome = path.join(sandboxRoot, 'home-empty');
});

afterAll(() => {
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
});

describe('hooks.json hook command is shell-quoted', () => {
  test.each(HOOKS_JSON_FILES)('%s registers a quoted command', (file) => {
    const hooks = JSON.parse(fs.readFileSync(file, 'utf8'));
    const commands = hooks.hooks.PermissionRequest.flatMap((entry) =>
      entry.hooks.map((h) => h.command)
    );
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      // The path must be wrapped in literal quotes inside the command string, so a
      // CLAUDE_PLUGIN_ROOT containing a space stays a single shell word.
      expect(command).toBe('"${CLAUDE_PLUGIN_ROOT}/hooks/permitter.js"');
    }
  });
});

describe('the hook never emits the invalid "ask" behavior', () => {
  test('denylist hit is denied, not asked', () => {
    const cwd = makeSandbox({ deny: ['Bash(rm:*)'], allow: ['Bash(rm:*)'] });
    const res = runHook({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }, { cwd });
    expect(res.stdout).not.toContain('"behavior":"ask"');
    expect(res.status).toBe(0);
    expect(decisionOf(res.stdout)).toMatchObject({ behavior: 'deny' });
  });

  test('MCP denylist hit is denied, not asked', () => {
    const cwd = makeSandbox({ deny: ['mcp__playwright__*'] });
    const res = runHook({ tool_name: 'mcp__playwright__navigate', tool_input: {} }, { cwd });
    expect(res.stdout).not.toContain('"behavior":"ask"');
    expect(res.status).toBe(0);
    expect(decisionOf(res.stdout)).toMatchObject({ behavior: 'deny' });
  });

  test('disabled hook defers silently instead of asking', () => {
    const cwd = makeSandbox({ allow: ['Bash(ls:*)'] });
    const res = runHook(
      { tool_name: 'Bash', tool_input: { command: 'ls' } },
      { cwd, env: { ENSEMBLE_PERMITTER_DISABLE: '1' } }
    );
    expect(res.stdout).not.toContain('"behavior":"ask"');
    expect(res.stdout.trim()).toBe('');
    expect(res.status).toBe(0);
  });

  test('non-Bash tool defers silently instead of asking', () => {
    const cwd = makeSandbox({ allow: ['Bash(ls:*)'] });
    const res = runHook({ tool_name: 'Edit', tool_input: { command: 'ls' } }, { cwd });
    expect(res.stdout).not.toContain('"behavior":"ask"');
    expect(res.stdout.trim()).toBe('');
    expect(res.status).toBe(0);
  });

  test('empty command defers silently instead of asking', () => {
    const cwd = makeSandbox({ allow: ['Bash(ls:*)'] });
    const res = runHook({ tool_name: 'Bash', tool_input: { command: '' } }, { cwd });
    expect(res.stdout).not.toContain('"behavior":"ask"');
    expect(res.stdout.trim()).toBe('');
    expect(res.status).toBe(0);
  });

  test('unparseable command defers silently instead of asking', () => {
    const cwd = makeSandbox({ allow: ['Bash(ls:*)'] });
    const res = runHook({ tool_name: 'Bash', tool_input: { command: 'ls && $(' } }, { cwd });
    expect(res.stdout).not.toContain('"behavior":"ask"');
    expect(res.stdout.trim()).toBe('');
    expect(res.status).toBe(0);
  });

  test('command with no commands extracted defers silently instead of asking', () => {
    const cwd = makeSandbox({ allow: ['Bash(ls:*)'] });
    const res = runHook({ tool_name: 'Bash', tool_input: { command: '# just a comment' } }, { cwd });
    expect(res.stdout).not.toContain('"behavior":"ask"');
    expect(res.stdout.trim()).toBe('');
    expect(res.status).toBe(0);
  });

  test('MCP tool with no allowlist match defers silently instead of asking', () => {
    const cwd = makeSandbox({ allow: ['Bash(ls:*)'] });
    const res = runHook({ tool_name: 'mcp__playwright__navigate', tool_input: {} }, { cwd });
    expect(res.stdout).not.toContain('"behavior":"ask"');
    expect(res.stdout.trim()).toBe('');
    expect(res.status).toBe(0);
  });

  test('malformed stdin JSON defers silently instead of asking', () => {
    const cwd = makeSandbox({ allow: ['Bash(ls:*)'] });
    const res = runHook('{not json', { cwd });
    expect(res.stdout).not.toContain('"behavior":"ask"');
    expect(res.stdout.trim()).toBe('');
    expect(res.status).toBe(0);
  });

  test('empty stdin defers silently instead of asking', () => {
    const cwd = makeSandbox({ allow: ['Bash(ls:*)'] });
    const res = runHook('', { cwd });
    expect(res.stdout).not.toContain('"behavior":"ask"');
    expect(res.stdout.trim()).toBe('');
    expect(res.status).toBe(0);
  });
});

describe('allow-path behavior is unchanged', () => {
  test('allowlisted command is still auto-approved', () => {
    const cwd = makeSandbox({ allow: ['Bash(git status:*)'] });
    const res = runHook({ tool_name: 'Bash', tool_input: { command: 'git status' } }, { cwd });
    expect(res.status).toBe(0);
    expect(decisionOf(res.stdout)).toEqual({ behavior: 'allow' });
  });

  test('allowlisted MCP tool is still auto-approved', () => {
    const cwd = makeSandbox({ allow: ['mcp__playwright__*'] });
    const res = runHook({ tool_name: 'mcp__playwright__navigate', tool_input: {} }, { cwd });
    expect(res.status).toBe(0);
    expect(decisionOf(res.stdout)).toEqual({ behavior: 'allow' });
  });

  test('no allowlist match is still not approved', () => {
    const cwd = makeSandbox({ allow: ['Bash(git status:*)'] });
    const res = runHook({ tool_name: 'Bash', tool_input: { command: 'curl example.com' } }, { cwd });
    expect(res.status).toBe(0);
    const decision = decisionOf(res.stdout);
    expect(decision === null || decision.behavior === 'deny').toBe(true);
    expect(decision?.behavior).not.toBe('allow');
  });
});

describe('deny decisions carry a reason', () => {
  test('denylist hit reports a message naming the rule', () => {
    const cwd = makeSandbox({ deny: ['Bash(rm:*)'] });
    const res = runHook({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }, { cwd });
    const decision = decisionOf(res.stdout);
    expect(decision?.behavior).toBe('deny');
    expect(typeof decision.message).toBe('string');
    expect(decision.message.length).toBeGreaterThan(0);
  });

  test('deny message stays bounded for a very long command', () => {
    const cwd = makeSandbox({ deny: ['Bash(rm:*)'] });
    const longArg = 'a'.repeat(5000);
    const res = runHook({ tool_name: 'Bash', tool_input: { command: `rm ${longArg}` } }, { cwd });
    const decision = decisionOf(res.stdout);
    expect(decision?.behavior).toBe('deny');
    expect(decision.message.length).toBeLessThan(400);
    expect(decision.message).toContain('truncated');
  });

  test('deny message stays bounded for a very long deny pattern (Bash)', () => {
    const longArg = 'a'.repeat(5000);
    const cwd = makeSandbox({ deny: [`Bash(rm ${longArg}:*)`] });
    const res = runHook({ tool_name: 'Bash', tool_input: { command: `rm ${longArg}` } }, { cwd });
    const decision = decisionOf(res.stdout);
    expect(decision?.behavior).toBe('deny');
    // Both the echoed command and the echoed rule are capped at 200 characters.
    expect(decision.message.length).toBeLessThan(700);
  });

  test('deny message stays bounded for a very long deny pattern (MCP)', () => {
    const longTool = `mcp__srv__${'a'.repeat(5000)}`;
    const cwd = makeSandbox({ deny: [longTool] });
    const res = runHook({ tool_name: longTool, tool_input: {} }, { cwd });
    const decision = decisionOf(res.stdout);
    expect(decision?.behavior).toBe('deny');
    expect(decision.message.length).toBeLessThan(700);
  });

  test('deny decision has exactly the shape Claude Code accepts', () => {
    const cwd = makeSandbox({ deny: ['Bash(rm:*)'] });
    const res = runHook({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } }, { cwd });
    const parsed = JSON.parse(res.stdout);
    expect(parsed.hookSpecificOutput.hookEventName).toBe('PermissionRequest');
    expect(parsed.hookSpecificOutput.decision.behavior).toBe('deny');
    expect(typeof parsed.hookSpecificOutput.decision.message).toBe('string');
    expect(parsed.hookSpecificOutput.decision).not.toHaveProperty('ask');
    expect(res.stdout.trim().split('\n')).toHaveLength(1);
  });
});

describe('deny rules win over allow rules', () => {
  test('a denied command in a compound command is denied even when the first command is allowlisted', () => {
    const cwd = makeSandbox({ allow: ['Bash(ls:*)'], deny: ['Bash(rm:*)'] });
    const res = runHook(
      { tool_name: 'Bash', tool_input: { command: 'ls && rm -rf build' } },
      { cwd }
    );
    expect(res.stdout).not.toContain('"behavior":"ask"');
    expect(res.status).toBe(0);
    expect(decisionOf(res.stdout)).toMatchObject({ behavior: 'deny' });
  });

  test('an MCP tool on both the allowlist and the denylist is denied', () => {
    const cwd = makeSandbox({ allow: ['mcp__playwright__*'], deny: ['mcp__playwright__*'] });
    const res = runHook(
      { tool_name: 'mcp__playwright__navigate', tool_input: {} },
      { cwd }
    );
    expect(res.stdout).not.toContain('"behavior":"ask"');
    expect(res.status).toBe(0);
    expect(decisionOf(res.stdout)).toMatchObject({ behavior: 'deny' });
  });

  // A deny rule must win over an allowlist miss on an earlier command, otherwise
  // `unknowncmd && rm -rf build` only reaches the user's prompt and the denied
  // command is never blocked.
  test('a denied command is denied even when an earlier command is not allowlisted', () => {
    const cwd = makeSandbox({ allow: ['Bash(ls:*)'], deny: ['Bash(rm:*)'] });
    const res = runHook(
      { tool_name: 'Bash', tool_input: { command: 'unknowncmd && rm -rf build' } },
      { cwd }
    );
    expect(res.stdout).not.toContain('"behavior":"ask"');
    expect(res.status).toBe(0);
    expect(decisionOf(res.stdout)).toMatchObject({ behavior: 'deny' });
  });
});
