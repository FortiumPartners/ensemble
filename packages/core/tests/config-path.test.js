/**
 * Unit tests for config-path.js XDG-compliant configuration paths
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// Mock fs and os modules
jest.mock('fs');
jest.mock('os');

const configPath = require('../lib/config-path');

describe('config-path', () => {
  const originalEnv = process.env;
  const mockHomeDir = '/home/testuser';

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.XDG_CONFIG_HOME;

    os.homedir.mockReturnValue(mockHomeDir);
    fs.existsSync.mockReturnValue(false);
    fs.mkdirSync.mockReturnValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  describe('getEnsembleConfigRoot', () => {
    it('should use XDG_CONFIG_HOME when set', () => {
      process.env.XDG_CONFIG_HOME = '/custom/config';
      const result = configPath.getEnsembleConfigRoot();
      expect(result).toBe('/custom/config/ensemble');
    });

    it('should use ~/.config/ensemble when ~/.config exists', () => {
      fs.existsSync.mockReturnValue(true);
      const result = configPath.getEnsembleConfigRoot();
      expect(result).toBe(path.join(mockHomeDir, '.config', 'ensemble'));
    });

    it('should fall back to ~/.ensemble when ~/.config does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      const result = configPath.getEnsembleConfigRoot();
      expect(result).toBe(path.join(mockHomeDir, '.ensemble'));
    });

    it('should prioritize XDG_CONFIG_HOME over ~/.config', () => {
      process.env.XDG_CONFIG_HOME = '/xdg/config';
      fs.existsSync.mockReturnValue(true); // ~/.config exists but should be ignored
      const result = configPath.getEnsembleConfigRoot();
      expect(result).toBe('/xdg/config/ensemble');
    });
  });

  describe('getPluginConfigPath', () => {
    it('should return plugin-specific path under config root', () => {
      fs.existsSync.mockReturnValue(false);
      const result = configPath.getPluginConfigPath('task-progress-pane');
      expect(result).toBe(path.join(mockHomeDir, '.ensemble', 'plugins', 'task-progress-pane'));
    });

    it('should work with XDG_CONFIG_HOME', () => {
      process.env.XDG_CONFIG_HOME = '/custom';
      const result = configPath.getPluginConfigPath('pane-viewer');
      expect(result).toBe('/custom/ensemble/plugins/pane-viewer');
    });
  });

  describe('getLogsPath', () => {
    it('should return logs root when no plugin specified', () => {
      fs.existsSync.mockReturnValue(false);
      const result = configPath.getLogsPath();
      expect(result).toBe(path.join(mockHomeDir, '.ensemble', 'logs'));
    });

    it('should return plugin-specific logs path', () => {
      fs.existsSync.mockReturnValue(false);
      const result = configPath.getLogsPath('task-progress-pane');
      expect(result).toBe(path.join(mockHomeDir, '.ensemble', 'logs', 'task-progress-pane'));
    });
  });

  describe('getCachePath', () => {
    it('should return cache root when no plugin specified', () => {
      fs.existsSync.mockReturnValue(false);
      const result = configPath.getCachePath();
      expect(result).toBe(path.join(mockHomeDir, '.ensemble', 'cache'));
    });

    it('should return plugin-specific cache path', () => {
      fs.existsSync.mockReturnValue(false);
      const result = configPath.getCachePath('context-fetcher');
      expect(result).toBe(path.join(mockHomeDir, '.ensemble', 'cache', 'context-fetcher'));
    });
  });

  describe('getSessionsPath', () => {
    it('should return sessions directory path', () => {
      fs.existsSync.mockReturnValue(false);
      const result = configPath.getSessionsPath();
      expect(result).toBe(path.join(mockHomeDir, '.ensemble', 'sessions'));
    });
  });

  describe('ensureDir', () => {
    it('should create directory if it does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      const testPath = '/test/path';
      configPath.ensureDir(testPath);
      expect(fs.mkdirSync).toHaveBeenCalledWith(testPath, { recursive: true, mode: 0o700 });
    });

    it('should not create directory if it exists', () => {
      fs.existsSync.mockReturnValue(true);
      const testPath = '/existing/path';
      configPath.ensureDir(testPath);
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should return the directory path', () => {
      const testPath = '/test/path';
      const result = configPath.ensureDir(testPath);
      expect(result).toBe(testPath);
    });
  });

  describe('initializeConfigStructure', () => {
    it('should create all required directories', () => {
      fs.existsSync.mockReturnValue(false);
      const result = configPath.initializeConfigStructure();

      expect(result).toHaveProperty('root');
      expect(result).toHaveProperty('plugins');
      expect(result).toHaveProperty('logs');
      expect(result).toHaveProperty('cache');
      expect(result).toHaveProperty('sessions');
    });

    it('should create directories with correct structure', () => {
      fs.existsSync.mockReturnValue(false);
      configPath.initializeConfigStructure();

      // Should have created 5 directories
      expect(fs.mkdirSync).toHaveBeenCalledTimes(5);
    });
  });

  describe('getLegacyPaths', () => {
    it('should return old ensemble config paths', () => {
      const result = configPath.getLegacyPaths();
      expect(result.taskProgressPane).toBe(path.join(mockHomeDir, '.ensemble/plugins/task-progress-pane'));
      expect(result.paneViewer).toBe(path.join(mockHomeDir, '.ensemble/plugins/pane-viewer'));
    });
  });

  describe('hasLegacyConfig', () => {
    it('should return true if task-progress-pane legacy dir exists', () => {
      fs.existsSync.mockImplementation((p) => {
        return p === path.join(mockHomeDir, '.ensemble/plugins/task-progress-pane');
      });
      expect(configPath.hasLegacyConfig()).toBe(true);
    });

    it('should return true if pane-viewer legacy dir exists', () => {
      fs.existsSync.mockImplementation((p) => {
        return p === path.join(mockHomeDir, '.ensemble/plugins/pane-viewer');
      });
      expect(configPath.hasLegacyConfig()).toBe(true);
    });

    it('should return false if no legacy dirs exist', () => {
      fs.existsSync.mockReturnValue(false);
      expect(configPath.hasLegacyConfig()).toBe(false);
    });
  });
});
