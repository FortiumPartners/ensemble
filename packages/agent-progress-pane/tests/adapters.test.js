/**
 * Tests for terminal multiplexer adapters
 */

// Mock child_process at the top level before any imports
jest.mock('child_process', () => ({
  spawnSync: jest.fn(() => ({
    status: 0,
    stdout: Buffer.from('123'),
    stderr: Buffer.from('')
  })),
  execSync: jest.fn(() => 'mocked output'),
  spawn: jest.fn()
}));

const {
  BaseMultiplexerAdapter,
  WeztermAdapter,
  ZellijAdapter,
  TmuxAdapter,
  MultiplexerDetector
} = require('../hooks/adapters');

const { spawnSync, execSync } = require('child_process');

describe('BaseMultiplexerAdapter', () => {
  it('should be abstract', () => {
    const adapter = new BaseMultiplexerAdapter('test');
    expect(adapter.name).toBe('test');
  });

  it('should throw on abstract methods', async () => {
    const adapter = new BaseMultiplexerAdapter('test');
    await expect(adapter.isAvailable()).rejects.toThrow('must be implemented');
    await expect(adapter.splitPane({})).rejects.toThrow('must be implemented');
    await expect(adapter.closePane('1')).rejects.toThrow('must be implemented');
    await expect(adapter.sendKeys('1', 'test')).rejects.toThrow('must be implemented');
    await expect(adapter.getPaneInfo('1')).rejects.toThrow('must be implemented');
  });
});

describe('WeztermAdapter', () => {
  let adapter;
  let originalEnv;

  beforeEach(() => {
    adapter = new WeztermAdapter();
    originalEnv = { ...process.env };
    // Clear mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should initialize', () => {
    expect(adapter.name).toBe('wezterm');
  });

  describe('isAvailable', () => {
    it('should detect wezterm via WEZTERM_PANE environment variable', async () => {
      process.env.WEZTERM_PANE = '123';
      const result = await adapter.isAvailable();
      expect(result).toBe(true);
    });

    it('should detect wezterm via CLI when env var not set', async () => {
      delete process.env.WEZTERM_PANE;
      execSync.mockReturnValueOnce('wezterm cli version');
      const result = await adapter.isAvailable();
      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith('which wezterm', { stdio: 'pipe' });
    });

    it('should return false when wezterm not available', async () => {
      delete process.env.WEZTERM_PANE;
      execSync.mockImplementationOnce(() => {
        throw new Error('Command not found');
      });
      const result = await adapter.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('splitPane', () => {
    it('should split pane with default options (right direction)', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '456',
        stderr: ''
      });

      const paneId = await adapter.splitPane({
        command: 'bash -c "echo test"'
      });

      expect(paneId).toBe('456');
      expect(spawnSync).toHaveBeenCalledWith('wezterm', [
        'cli', 'split-pane',
        '--right',
        '--percent', '40',
        '--',
        'bash -c "echo test"'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should split pane with bottom direction', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '789',
        stderr: ''
      });

      const paneId = await adapter.splitPane({
        direction: 'bottom',
        percent: 30,
        command: 'htop'
      });

      expect(paneId).toBe('789');
      expect(spawnSync).toHaveBeenCalledWith('wezterm', [
        'cli', 'split-pane',
        '--bottom',
        '--percent', '30',
        '--',
        'htop'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should split pane with cwd option', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '999',
        stderr: ''
      });

      const paneId = await adapter.splitPane({
        direction: 'right',
        percent: 50,
        cwd: '/home/user/project',
        command: 'npm test'
      });

      expect(paneId).toBe('999');
      expect(spawnSync).toHaveBeenCalledWith('wezterm', [
        'cli', 'split-pane',
        '--right',
        '--percent', '50',
        '--cwd', '/home/user/project',
        '--',
        'npm test'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should handle command as array', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '111',
        stderr: ''
      });

      const paneId = await adapter.splitPane({
        command: ['bash', '-c', 'echo "hello world"']
      });

      expect(paneId).toBe('111');
      expect(spawnSync).toHaveBeenCalledWith('wezterm', [
        'cli', 'split-pane',
        '--right',
        '--percent', '40',
        '--',
        'bash', '-c', 'echo "hello world"'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should throw error on split failure', async () => {
      spawnSync.mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'Error: Invalid pane direction'
      });

      await expect(adapter.splitPane({ command: 'test' }))
        .rejects.toThrow('Failed to split pane');
    });
  });

  describe('closePane', () => {
    it('should close a pane by ID', async () => {
      execSync.mockReturnValueOnce('');
      await adapter.closePane('123');
      expect(execSync).toHaveBeenCalledWith('wezterm cli kill-pane --pane-id 123', { stdio: 'pipe' });
    });

    it('should handle errors gracefully when closing pane', async () => {
      execSync.mockImplementationOnce(() => {
        throw new Error('Pane not found');
      });
      // Should not throw, just log error
      await expect(adapter.closePane('999')).resolves.toBeUndefined();
    });
  });

  describe('sendKeys', () => {
    it('should send text to a pane', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.sendKeys('123', 'echo hello');

      expect(spawnSync).toHaveBeenCalledWith('wezterm', [
        'cli', 'send-text',
        '--pane-id', '123',
        '--no-paste',
        'echo hello'
      ], { stdio: 'pipe' });
    });

    it('should throw error on send failure', async () => {
      spawnSync.mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'Error: Pane not found'
      });

      await expect(adapter.sendKeys('999', 'test'))
        .rejects.toThrow('Failed to send text');
    });
  });

  describe('getPaneInfo', () => {
    it('should get pane information by ID', async () => {
      execSync.mockReturnValueOnce(JSON.stringify([
        { pane_id: 123, title: 'Pane 1', size: { cols: 80, rows: 24 } },
        { pane_id: 456, title: 'Pane 2', size: { cols: 120, rows: 40 } }
      ]));

      const info = await adapter.getPaneInfo('456');

      expect(info).toEqual({ pane_id: 456, title: 'Pane 2', size: { cols: 120, rows: 40 } });
      expect(execSync).toHaveBeenCalledWith('wezterm cli list --format json', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should return null when pane not found', async () => {
      execSync.mockReturnValueOnce(JSON.stringify([
        { pane_id: 123, title: 'Pane 1' }
      ]));

      const info = await adapter.getPaneInfo('999');
      expect(info).toBeNull();
    });

    it('should return null on error', async () => {
      execSync.mockImplementationOnce(() => {
        throw new Error('WezTerm not running');
      });

      const info = await adapter.getPaneInfo('123');
      expect(info).toBeNull();
    });
  });
});

describe('ZellijAdapter', () => {
  let adapter;
  let originalEnv;

  beforeEach(() => {
    adapter = new ZellijAdapter();
    originalEnv = { ...process.env };
    // Clear mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should initialize', () => {
    expect(adapter.name).toBe('zellij');
  });

  describe('isAvailable', () => {
    it('should detect zellij via ZELLIJ_SESSION_NAME environment variable', async () => {
      process.env.ZELLIJ_SESSION_NAME = 'my-session';
      const result = await adapter.isAvailable();
      expect(result).toBe(true);
    });

    it('should detect zellij via ZELLIJ environment variable', async () => {
      delete process.env.ZELLIJ_SESSION_NAME;
      process.env.ZELLIJ = '1';
      const result = await adapter.isAvailable();
      expect(result).toBe(true);
    });

    it('should detect zellij via CLI when env vars not set', async () => {
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.ZELLIJ;
      execSync.mockReturnValueOnce('zellij 0.40.0');
      const result = await adapter.isAvailable();
      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith('which zellij', { stdio: 'pipe' });
    });

    it('should return false when zellij not available', async () => {
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.ZELLIJ;
      execSync.mockImplementationOnce(() => {
        throw new Error('Command not found');
      });
      const result = await adapter.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('splitPane', () => {
    it('should split pane with default options (right direction)', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      const paneId = await adapter.splitPane({
        command: 'bash'
      });

      // Zellij returns timestamp-based ID
      expect(paneId).toMatch(/^zellij-\d+$/);
      expect(spawnSync).toHaveBeenCalledWith('zellij', [
        'run',
        '--direction', 'right',
        '--close-on-exit',
        '--',
        'bash'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should split pane with bottom direction', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      const paneId = await adapter.splitPane({
        direction: 'bottom',
        command: 'htop'
      });

      expect(paneId).toMatch(/^zellij-\d+$/);
      expect(spawnSync).toHaveBeenCalledWith('zellij', [
        'run',
        '--direction', 'down',
        '--close-on-exit',
        '--',
        'htop'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should split pane with down direction (alias for bottom)', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.splitPane({
        direction: 'down',
        command: 'tail -f log.txt'
      });

      expect(spawnSync).toHaveBeenCalledWith('zellij', [
        'run',
        '--direction', 'down',
        '--close-on-exit',
        '--',
        'tail -f log.txt'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should split pane with cwd option', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.splitPane({
        direction: 'right',
        cwd: '/home/user/project',
        command: 'npm test'
      });

      expect(spawnSync).toHaveBeenCalledWith('zellij', [
        'run',
        '--direction', 'right',
        '--close-on-exit',
        '--cwd', '/home/user/project',
        '--',
        'npm test'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should split pane with name option', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.splitPane({
        direction: 'right',
        name: 'monitoring-pane',
        command: 'watch -n 1 date'
      });

      expect(spawnSync).toHaveBeenCalledWith('zellij', [
        'run',
        '--direction', 'right',
        '--close-on-exit',
        '--name', 'monitoring-pane',
        '--',
        'watch -n 1 date'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should handle command as array', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.splitPane({
        command: ['bash', '-c', 'echo "hello world"']
      });

      expect(spawnSync).toHaveBeenCalledWith('zellij', [
        'run',
        '--direction', 'right',
        '--close-on-exit',
        '--',
        'bash', '-c', 'echo "hello world"'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should use default shell when no command specified', async () => {
      const originalShell = process.env.SHELL;
      process.env.SHELL = '/bin/zsh';

      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.splitPane({});

      expect(spawnSync).toHaveBeenCalledWith('zellij', [
        'run',
        '--direction', 'right',
        '--close-on-exit',
        '--',
        '/bin/zsh'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      process.env.SHELL = originalShell;
    });

    it('should fallback to /bin/sh when SHELL not set', async () => {
      const originalShell = process.env.SHELL;
      delete process.env.SHELL;

      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.splitPane({});

      expect(spawnSync).toHaveBeenCalledWith('zellij', [
        'run',
        '--direction', 'right',
        '--close-on-exit',
        '--',
        '/bin/sh'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });

      process.env.SHELL = originalShell;
    });

    it('should throw error on split failure', async () => {
      spawnSync.mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'Error: Invalid direction'
      });

      await expect(adapter.splitPane({ command: 'test' }))
        .rejects.toThrow('Failed to split pane');
    });

    it('should throw error with stderr message', async () => {
      spawnSync.mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'Zellij not in a session'
      });

      await expect(adapter.splitPane({ command: 'ls' }))
        .rejects.toThrow('Zellij not in a session');
    });
  });

  describe('closePane', () => {
    it('should close currently focused pane', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.closePane('zellij-123');

      expect(spawnSync).toHaveBeenCalledWith('zellij', ['action', 'close-pane'], { stdio: 'pipe' });
    });

    it('should handle errors gracefully when closing pane', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      spawnSync.mockImplementationOnce(() => {
        throw new Error('Pane not focused');
      });

      // Should not throw, just log error
      await expect(adapter.closePane('zellij-999')).resolves.toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[zellij] closePane warning: Pane not focused')
      );

      consoleErrorSpy.mockRestore();
    });

    it('should ignore paneId parameter (Zellij limitation)', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      // Different paneIds should result in same call
      await adapter.closePane('some-pane-id');
      const firstCall = spawnSync.mock.calls[0];

      jest.clearAllMocks();
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.closePane('different-pane-id');
      const secondCall = spawnSync.mock.calls[0];

      expect(firstCall).toEqual(secondCall);
    });
  });

  describe('sendKeys', () => {
    it('should send text to currently focused pane', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.sendKeys('zellij-123', 'echo hello');

      expect(spawnSync).toHaveBeenCalledWith('zellij', [
        'action',
        'write-chars',
        'echo hello'
      ], { stdio: 'pipe' });
    });

    it('should send multi-line text', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      const multilineText = 'line1\nline2\nline3';
      await adapter.sendKeys('zellij-456', multilineText);

      expect(spawnSync).toHaveBeenCalledWith('zellij', [
        'action',
        'write-chars',
        multilineText
      ], { stdio: 'pipe' });
    });

    it('should throw error on send failure', async () => {
      spawnSync.mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: Buffer.from('Error: Not in a Zellij session')
      });

      await expect(adapter.sendKeys('zellij-999', 'test'))
        .rejects.toThrow('Failed to send text');
    });

    it('should handle special characters', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      const specialText = 'echo "test with $VAR and `cmd`"';
      await adapter.sendKeys('zellij-789', specialText);

      expect(spawnSync).toHaveBeenCalledWith('zellij', [
        'action',
        'write-chars',
        specialText
      ], { stdio: 'pipe' });
    });

    it('should ignore paneId parameter (Zellij limitation)', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.sendKeys('pane1', 'test');
      const firstCall = spawnSync.mock.calls[0];

      jest.clearAllMocks();
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.sendKeys('pane2', 'test');
      const secondCall = spawnSync.mock.calls[0];

      expect(firstCall).toEqual(secondCall);
    });
  });

  describe('getPaneInfo', () => {
    it('should return null (not supported by Zellij CLI)', async () => {
      const info = await adapter.getPaneInfo('zellij-123');
      expect(info).toBeNull();
    });

    it('should return null for any paneId', async () => {
      expect(await adapter.getPaneInfo('any-id')).toBeNull();
      expect(await adapter.getPaneInfo('zellij-456')).toBeNull();
      expect(await adapter.getPaneInfo('')).toBeNull();
    });
  });
});

describe('TmuxAdapter', () => {
  let adapter;
  let originalEnv;

  beforeEach(() => {
    adapter = new TmuxAdapter();
    originalEnv = { ...process.env };
    // Clear mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should initialize', () => {
    expect(adapter.name).toBe('tmux');
  });

  describe('isAvailable', () => {
    it('should detect tmux via TMUX environment variable', async () => {
      process.env.TMUX = '/tmp/tmux-1000/default,123,0';
      const result = await adapter.isAvailable();
      expect(result).toBe(true);
    });

    it('should detect tmux via CLI when env var not set', async () => {
      delete process.env.TMUX;
      execSync.mockReturnValueOnce('/usr/bin/tmux');
      const result = await adapter.isAvailable();
      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith('which tmux', { stdio: 'pipe' });
    });

    it('should return false when tmux not available', async () => {
      delete process.env.TMUX;
      execSync.mockImplementationOnce(() => {
        throw new Error('Command not found');
      });
      const result = await adapter.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe('splitPane', () => {
    it('should split pane with default options (right direction)', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '%456',
        stderr: ''
      });

      const paneId = await adapter.splitPane({
        command: 'bash -c "echo test"'
      });

      expect(paneId).toBe('%456');
      expect(spawnSync).toHaveBeenCalledWith('tmux', [
        'split-window',
        '-h',  // horizontal = side by side
        '-p', '40',
        '-d',  // Don't focus
        '-P', '-F', '#{pane_id}',
        'bash -c "echo test"'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should split pane with bottom direction', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '%789',
        stderr: ''
      });

      const paneId = await adapter.splitPane({
        direction: 'bottom',
        percent: 30,
        command: 'htop'
      });

      expect(paneId).toBe('%789');
      expect(spawnSync).toHaveBeenCalledWith('tmux', [
        'split-window',
        '-v',  // vertical = stacked
        '-p', '30',
        '-d',
        '-P', '-F', '#{pane_id}',
        'htop'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should split pane with down direction (alias for bottom)', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '%999',
        stderr: ''
      });

      const paneId = await adapter.splitPane({
        direction: 'down',
        percent: 25,
        command: 'tail -f log.txt'
      });

      expect(paneId).toBe('%999');
      expect(spawnSync).toHaveBeenCalledWith('tmux', expect.arrayContaining([
        'split-window',
        '-v'  // vertical for down
      ]), expect.any(Object));
    });

    it('should split pane with cwd option', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '%111',
        stderr: ''
      });

      const paneId = await adapter.splitPane({
        direction: 'right',
        percent: 50,
        cwd: '/home/user/project',
        command: 'npm test'
      });

      expect(paneId).toBe('%111');
      expect(spawnSync).toHaveBeenCalledWith('tmux', [
        'split-window',
        '-h',
        '-p', '50',
        '-d',
        '-P', '-F', '#{pane_id}',
        '-c', '/home/user/project',
        'npm test'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should handle command as array', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '%222',
        stderr: ''
      });

      const paneId = await adapter.splitPane({
        command: ['bash', '-c', 'echo "hello world"']
      });

      expect(paneId).toBe('%222');
      expect(spawnSync).toHaveBeenCalledWith('tmux', [
        'split-window',
        '-h',
        '-p', '40',
        '-d',
        '-P', '-F', '#{pane_id}',
        'bash -c echo "hello world"'  // Array joined with space
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should throw error on split failure', async () => {
      spawnSync.mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'create pane failed: pane too small'
      });

      await expect(adapter.splitPane({ command: 'test' }))
        .rejects.toThrow('Failed to split pane');
    });
  });

  describe('closePane', () => {
    it('should close a pane by ID', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.closePane('%123');

      expect(spawnSync).toHaveBeenCalledWith('tmux', [
        'kill-pane',
        '-t', '%123'
      ], {
        stdio: 'pipe'
      });
    });

    it('should handle errors gracefully when closing pane', async () => {
      spawnSync.mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: Buffer.from('can\'t find pane %999')
      });

      // Should not throw, just log error
      await expect(adapter.closePane('%999')).resolves.toBeUndefined();
    });

    it('should handle exceptions gracefully', async () => {
      spawnSync.mockImplementationOnce(() => {
        throw new Error('tmux not running');
      });

      // Should not throw, just log error
      await expect(adapter.closePane('%123')).resolves.toBeUndefined();
    });
  });

  describe('sendKeys', () => {
    it('should send keys to a pane', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.sendKeys('%123', 'echo hello');

      expect(spawnSync).toHaveBeenCalledWith('tmux', [
        'send-keys',
        '-t', '%123',
        'echo hello'
      ], { stdio: 'pipe' });
    });

    it('should send special keys (Enter)', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '',
        stderr: ''
      });

      await adapter.sendKeys('%123', 'Enter');

      expect(spawnSync).toHaveBeenCalledWith('tmux', [
        'send-keys',
        '-t', '%123',
        'Enter'
      ], { stdio: 'pipe' });
    });

    it('should throw error on send failure', async () => {
      spawnSync.mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: Buffer.from('can\'t find pane %999')
      });

      await expect(adapter.sendKeys('%999', 'test'))
        .rejects.toThrow('Failed to send keys');
    });
  });

  describe('getPaneInfo', () => {
    it('should get pane information by ID', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '%123:80:24:bash\n%456:120:40:vim\n%789:100:30:htop',
        stderr: ''
      });

      const info = await adapter.getPaneInfo('%456');

      expect(info).toEqual({
        pane_id: '%456',
        width: 120,
        height: 40,
        current_command: 'vim'
      });
      expect(spawnSync).toHaveBeenCalledWith('tmux', [
        'list-panes',
        '-a',
        '-F', '#{pane_id}:#{pane_width}:#{pane_height}:#{pane_current_command}'
      ], {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
    });

    it('should return null when pane not found', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '%123:80:24:bash',
        stderr: ''
      });

      const info = await adapter.getPaneInfo('%999');
      expect(info).toBeNull();
    });

    it('should return null on error', async () => {
      spawnSync.mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'no server running'
      });

      const info = await adapter.getPaneInfo('%123');
      expect(info).toBeNull();
    });

    it('should handle exceptions gracefully', async () => {
      spawnSync.mockImplementationOnce(() => {
        throw new Error('tmux not running');
      });

      const info = await adapter.getPaneInfo('%123');
      expect(info).toBeNull();
    });
  });

  describe('listPanes', () => {
    it('should list all panes', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '%123:80:24:bash\n%456:120:40:vim\n%789:100:30:htop',
        stderr: ''
      });

      const panes = await adapter.listPanes();

      expect(panes).toHaveLength(3);
      expect(panes[0]).toEqual({
        pane_id: '%123',
        width: 80,
        height: 24,
        current_command: 'bash'
      });
      expect(panes[1]).toEqual({
        pane_id: '%456',
        width: 120,
        height: 40,
        current_command: 'vim'
      });
      expect(panes[2]).toEqual({
        pane_id: '%789',
        width: 100,
        height: 30,
        current_command: 'htop'
      });
    });

    it('should return empty array on error', async () => {
      spawnSync.mockReturnValueOnce({
        status: 1,
        stdout: '',
        stderr: 'no server running'
      });

      const panes = await adapter.listPanes();
      expect(panes).toEqual([]);
    });

    it('should handle exceptions gracefully', async () => {
      spawnSync.mockImplementationOnce(() => {
        throw new Error('tmux not running');
      });

      const panes = await adapter.listPanes();
      expect(panes).toEqual([]);
    });

    it('should filter empty lines', async () => {
      spawnSync.mockReturnValueOnce({
        status: 0,
        stdout: '%123:80:24:bash\n\n%456:120:40:vim\n',
        stderr: ''
      });

      const panes = await adapter.listPanes();
      expect(panes).toHaveLength(2);
    });
  });
});

describe('MultiplexerDetector', () => {
  let detector;
  let originalEnv;

  beforeEach(() => {
    detector = new MultiplexerDetector();
    originalEnv = { ...process.env };
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should initialize with adapters', () => {
    expect(Object.keys(detector.adapters)).toHaveLength(3);
    expect(detector.adapters.wezterm).toBeDefined();
    expect(detector.adapters.zellij).toBeDefined();
    expect(detector.adapters.tmux).toBeDefined();
  });

  describe('detectSession', () => {
    it('should detect WezTerm session from environment', async () => {
      process.env.WEZTERM_PANE = '123';
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.TMUX;

      const result = await detector.detectSession();

      expect(result).toEqual({
        multiplexer: 'wezterm',
        sessionId: '123',
        paneId: '123'
      });
    });

    it('should detect Zellij session from environment', async () => {
      delete process.env.WEZTERM_PANE;
      process.env.ZELLIJ_SESSION_NAME = 'my-session';
      process.env.ZELLIJ_PANE_ID = '456';
      delete process.env.TMUX;

      const result = await detector.detectSession();

      expect(result).toEqual({
        multiplexer: 'zellij',
        sessionId: 'my-session',
        paneId: '456'
      });
    });

    it('should detect Zellij session without pane ID', async () => {
      delete process.env.WEZTERM_PANE;
      process.env.ZELLIJ_SESSION_NAME = 'my-session';
      delete process.env.ZELLIJ_PANE_ID;
      delete process.env.TMUX;

      const result = await detector.detectSession();

      expect(result).toEqual({
        multiplexer: 'zellij',
        sessionId: 'my-session',
        paneId: null
      });
    });

    it('should detect tmux session from environment', async () => {
      delete process.env.WEZTERM_PANE;
      delete process.env.ZELLIJ_SESSION_NAME;
      process.env.TMUX = '/tmp/tmux-1000/default,123,0';
      process.env.TMUX_PANE = '%789';

      const result = await detector.detectSession();

      expect(result).toEqual({
        multiplexer: 'tmux',
        sessionId: '/tmp/tmux-1000/default',
        paneId: '%789'
      });
    });

    it('should detect tmux session without pane ID', async () => {
      delete process.env.WEZTERM_PANE;
      delete process.env.ZELLIJ_SESSION_NAME;
      process.env.TMUX = '/tmp/tmux-1000/default,123,0';
      delete process.env.TMUX_PANE;

      const result = await detector.detectSession();

      expect(result).toEqual({
        multiplexer: 'tmux',
        sessionId: '/tmp/tmux-1000/default',
        paneId: null
      });
    });

    it('should return null when no multiplexer detected', async () => {
      delete process.env.WEZTERM_PANE;
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.TMUX;

      const result = await detector.detectSession();

      expect(result).toBeNull();
    });

    it('should prioritize WezTerm over Zellij', async () => {
      process.env.WEZTERM_PANE = '123';
      process.env.ZELLIJ_SESSION_NAME = 'my-session';
      delete process.env.TMUX;

      const result = await detector.detectSession();

      expect(result.multiplexer).toBe('wezterm');
    });

    it('should prioritize Zellij over tmux', async () => {
      delete process.env.WEZTERM_PANE;
      process.env.ZELLIJ_SESSION_NAME = 'my-session';
      process.env.TMUX = '/tmp/tmux-1000/default,123,0';

      const result = await detector.detectSession();

      expect(result.multiplexer).toBe('zellij');
    });
  });

  describe('autoSelect', () => {
    it('should auto-select from session environment (WezTerm)', async () => {
      process.env.WEZTERM_PANE = '123';
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.TMUX;

      const adapter = await detector.autoSelect();

      expect(adapter).toBe(detector.adapters.wezterm);
    });

    it('should auto-select from session environment (Zellij)', async () => {
      delete process.env.WEZTERM_PANE;
      process.env.ZELLIJ_SESSION_NAME = 'my-session';
      delete process.env.TMUX;

      const adapter = await detector.autoSelect();

      expect(adapter).toBe(detector.adapters.zellij);
    });

    it('should auto-select from session environment (tmux)', async () => {
      delete process.env.WEZTERM_PANE;
      delete process.env.ZELLIJ_SESSION_NAME;
      process.env.TMUX = '/tmp/tmux-1000/default,123,0';

      const adapter = await detector.autoSelect();

      expect(adapter).toBe(detector.adapters.tmux);
    });

    it('should fallback to CLI availability check when no session', async () => {
      delete process.env.WEZTERM_PANE;
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.TMUX;

      // Mock CLI availability: wezterm not available, zellij available
      execSync
        .mockImplementationOnce(() => { throw new Error('wezterm not found'); })
        .mockReturnValueOnce('zellij');

      const adapter = await detector.autoSelect();

      expect(adapter).toBe(detector.adapters.zellij);
    });

    it('should check adapters in priority order (wezterm -> zellij -> tmux)', async () => {
      delete process.env.WEZTERM_PANE;
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.TMUX;

      // Mock CLI availability: none available
      execSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const adapter = await detector.autoSelect();

      expect(adapter).toBeNull();
      // Verify all adapters were checked
      expect(execSync).toHaveBeenCalledWith('which wezterm', expect.any(Object));
      expect(execSync).toHaveBeenCalledWith('which zellij', expect.any(Object));
      expect(execSync).toHaveBeenCalledWith('which tmux', expect.any(Object));
    });

    it('should return first available adapter from CLI check', async () => {
      delete process.env.WEZTERM_PANE;
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.TMUX;

      // Mock CLI availability: only tmux available
      execSync
        .mockImplementationOnce(() => { throw new Error('wezterm not found'); })
        .mockImplementationOnce(() => { throw new Error('zellij not found'); })
        .mockReturnValueOnce('/usr/bin/tmux');

      const adapter = await detector.autoSelect();

      expect(adapter).toBe(detector.adapters.tmux);
    });

    it('should return null when no adapter available', async () => {
      delete process.env.WEZTERM_PANE;
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.TMUX;

      execSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const adapter = await detector.autoSelect();

      expect(adapter).toBeNull();
    });
  });

  describe('getAdapter', () => {
    it('should get wezterm adapter by name', () => {
      const adapter = detector.getAdapter('wezterm');
      expect(adapter).toBe(detector.adapters.wezterm);
      expect(adapter.name).toBe('wezterm');
    });

    it('should get zellij adapter by name', () => {
      const adapter = detector.getAdapter('zellij');
      expect(adapter).toBe(detector.adapters.zellij);
      expect(adapter.name).toBe('zellij');
    });

    it('should get tmux adapter by name', () => {
      const adapter = detector.getAdapter('tmux');
      expect(adapter).toBe(detector.adapters.tmux);
      expect(adapter.name).toBe('tmux');
    });

    it('should return null for invalid adapter name', () => {
      const adapter = detector.getAdapter('invalid');
      expect(adapter).toBeNull();
    });

    it('should return null for undefined adapter name', () => {
      const adapter = detector.getAdapter(undefined);
      expect(adapter).toBeNull();
    });

    it('should return null for empty string', () => {
      const adapter = detector.getAdapter('');
      expect(adapter).toBeNull();
    });

    it('should be case-sensitive', () => {
      const adapter = detector.getAdapter('WezTerm');
      expect(adapter).toBeNull();
    });
  });

  describe('detectAvailable', () => {
    it('should detect all available multiplexers', async () => {
      // Mock all CLI tools as available
      execSync.mockReturnValue('available');

      const available = await detector.detectAvailable();

      expect(available).toHaveLength(3);
      expect(available[0]).toBe(detector.adapters.wezterm);
      expect(available[1]).toBe(detector.adapters.zellij);
      expect(available[2]).toBe(detector.adapters.tmux);
    });

    it('should detect only wezterm when others unavailable', async () => {
      // Set env var for WezTerm
      process.env.WEZTERM_PANE = '123';
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.TMUX;

      // Mock CLI: wezterm available (via env), others not
      execSync.mockImplementation((cmd) => {
        if (cmd.includes('wezterm')) return 'available';
        throw new Error('not found');
      });

      const available = await detector.detectAvailable();

      expect(available).toHaveLength(1);
      expect(available[0]).toBe(detector.adapters.wezterm);
    });

    it('should detect only zellij when others unavailable', async () => {
      delete process.env.WEZTERM_PANE;
      process.env.ZELLIJ_SESSION_NAME = 'my-session';
      delete process.env.TMUX;

      execSync.mockImplementation((cmd) => {
        if (cmd.includes('zellij')) return 'available';
        throw new Error('not found');
      });

      const available = await detector.detectAvailable();

      expect(available).toHaveLength(1);
      expect(available[0]).toBe(detector.adapters.zellij);
    });

    it('should detect only tmux when others unavailable', async () => {
      delete process.env.WEZTERM_PANE;
      delete process.env.ZELLIJ_SESSION_NAME;
      process.env.TMUX = '/tmp/tmux-1000/default,123,0';

      execSync.mockImplementation((cmd) => {
        if (cmd.includes('tmux')) return 'available';
        throw new Error('not found');
      });

      const available = await detector.detectAvailable();

      expect(available).toHaveLength(1);
      expect(available[0]).toBe(detector.adapters.tmux);
    });

    it('should return empty array when no multiplexers available', async () => {
      delete process.env.WEZTERM_PANE;
      delete process.env.ZELLIJ_SESSION_NAME;
      delete process.env.TMUX;

      execSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const available = await detector.detectAvailable();

      expect(available).toEqual([]);
    });

    it('should detect multiple available multiplexers (wezterm and tmux)', async () => {
      process.env.WEZTERM_PANE = '123';
      delete process.env.ZELLIJ_SESSION_NAME;
      process.env.TMUX = '/tmp/tmux-1000/default,123,0';

      execSync.mockImplementation((cmd) => {
        if (cmd.includes('wezterm') || cmd.includes('tmux')) return 'available';
        throw new Error('not found');
      });

      const available = await detector.detectAvailable();

      expect(available).toHaveLength(2);
      expect(available[0]).toBe(detector.adapters.wezterm);
      expect(available[1]).toBe(detector.adapters.tmux);
    });

    it('should maintain priority order in results', async () => {
      // Mock all as available
      execSync.mockReturnValue('available');

      const available = await detector.detectAvailable();

      // Should be in priority order: wezterm, zellij, tmux
      expect(available[0].name).toBe('wezterm');
      expect(available[1].name).toBe('zellij');
      expect(available[2].name).toBe('tmux');
    });
  });
});
