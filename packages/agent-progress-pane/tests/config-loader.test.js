const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock fs module before requiring config-loader
jest.mock('fs');

const { loadConfig, saveConfig, resetConfig, DEFAULT_CONFIG } = require('../lib/config-loader');

describe('config-loader', () => {
  const mockConfigDir = path.join(os.homedir(), '.ensemble/plugins/agent-progress-pane');
  const mockConfigPath = path.join(mockConfigDir, 'config.json');
  const oldConfigPath = path.join(os.homedir(), '.ensemble/plugins/pane-viewer', 'config.json');

  beforeEach(() => {
    // Clear all mocks before each test
    jest.clearAllMocks();

    // Mock console.error to suppress error output in tests
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  describe('loadConfig()', () => {
    it('should return default config when file does not exist', () => {
      // Arrange - loadConfig checks CONFIG_PATH then OLD_CONFIG_PATH
      fs.existsSync.mockReturnValue(false);

      // Act
      const config = loadConfig();

      // Assert
      expect(config).toEqual(DEFAULT_CONFIG);
      expect(fs.existsSync).toHaveBeenCalledWith(mockConfigPath);
      expect(fs.existsSync).toHaveBeenCalledWith(oldConfigPath);
      // loadConfig doesn't create directory - that's saveConfig's job
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should load from new path when it exists', () => {
      // Arrange
      fs.existsSync.mockReturnValueOnce(true); // CONFIG_PATH exists
      fs.readFileSync.mockReturnValue(JSON.stringify({ enabled: false }));

      // Act
      loadConfig();

      // Assert - should not check old path if new path exists
      expect(fs.existsSync).toHaveBeenCalledWith(mockConfigPath);
      expect(fs.readFileSync).toHaveBeenCalledWith(mockConfigPath, 'utf-8');
    });

    it('should fall back to old path for backward compatibility', () => {
      // Arrange
      fs.existsSync
        .mockReturnValueOnce(false) // CONFIG_PATH doesn't exist
        .mockReturnValueOnce(true); // OLD_CONFIG_PATH exists
      fs.readFileSync.mockReturnValue(JSON.stringify({ enabled: false }));

      // Act
      loadConfig();

      // Assert - should check old path when new doesn't exist
      expect(fs.existsSync).toHaveBeenCalledWith(mockConfigPath);
      expect(fs.existsSync).toHaveBeenCalledWith(oldConfigPath);
      expect(fs.readFileSync).toHaveBeenCalledWith(oldConfigPath, 'utf-8');
    });

    it('should merge user config with defaults', () => {
      // Arrange
      const userConfig = {
        enabled: false,
        direction: 'left',
        maxAgentHistory: 100
      };

      fs.existsSync.mockReturnValueOnce(true); // CONFIG_PATH exists
      fs.readFileSync.mockReturnValue(JSON.stringify(userConfig));

      // Act
      const config = loadConfig();

      // Assert
      expect(config).toEqual({
        ...DEFAULT_CONFIG,
        ...userConfig
      });
      expect(fs.readFileSync).toHaveBeenCalledWith(mockConfigPath, 'utf-8');
    });

    it('should preserve default values for properties not in user config', () => {
      // Arrange
      const userConfig = {
        enabled: false
      };

      fs.existsSync.mockReturnValueOnce(true); // CONFIG_PATH exists
      fs.readFileSync.mockReturnValue(JSON.stringify(userConfig));

      // Act
      const config = loadConfig();

      // Assert
      expect(config.multiplexer).toBe(DEFAULT_CONFIG.multiplexer);
      expect(config.direction).toBe(DEFAULT_CONFIG.direction);
      expect(config.percent).toBe(DEFAULT_CONFIG.percent);
      expect(config.enabled).toBe(false); // User override
    });

    it('should return default config if user config is invalid JSON', () => {
      // Arrange
      fs.existsSync.mockReturnValueOnce(true); // CONFIG_PATH exists
      fs.readFileSync.mockReturnValue('{ invalid json }');

      // Act
      const config = loadConfig();

      // Assert
      expect(config).toEqual(DEFAULT_CONFIG);
      expect(console.error).toHaveBeenCalledWith(
        '[config] Failed to load config:',
        expect.any(String)
      );
    });

    it('should return default config if readFileSync throws error', () => {
      // Arrange
      fs.existsSync.mockReturnValueOnce(true); // CONFIG_PATH exists
      fs.readFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      // Act
      const config = loadConfig();

      // Assert
      expect(config).toEqual(DEFAULT_CONFIG);
      expect(console.error).toHaveBeenCalledWith(
        '[config] Failed to load config:',
        'Permission denied'
      );
    });

    it('should handle empty user config object', () => {
      // Arrange
      fs.existsSync.mockReturnValueOnce(true); // CONFIG_PATH exists
      fs.readFileSync.mockReturnValue('{}');

      // Act
      const config = loadConfig();

      // Assert
      expect(config).toEqual(DEFAULT_CONFIG);
    });
  });

  describe('saveConfig()', () => {
    beforeEach(() => {
      // Mock existsSync to simulate directory exists
      fs.existsSync.mockReturnValue(true);
    });

    it('should save merged config to disk', () => {
      // Arrange
      const userConfig = {
        enabled: false,
        direction: 'left'
      };

      // Act
      const result = saveConfig(userConfig);

      // Assert
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockConfigPath,
        expect.stringContaining('"enabled": false')
      );
      expect(result).toEqual({
        ...DEFAULT_CONFIG,
        ...userConfig
      });
    });

    it('should create config directory if it does not exist', () => {
      // Arrange - ensureConfigDir checks CONFIG_DIR
      fs.existsSync.mockReturnValueOnce(false); // CONFIG_DIR doesn't exist
      const userConfig = { enabled: false };

      // Act
      saveConfig(userConfig);

      // Assert - ensureConfigDir creates the directory
      expect(fs.existsSync).toHaveBeenCalledWith(mockConfigDir);
      expect(fs.mkdirSync).toHaveBeenCalledWith(mockConfigDir, { recursive: true });
    });

    it('should format JSON with 2-space indentation', () => {
      // Arrange
      const userConfig = { enabled: false };

      // Act
      saveConfig(userConfig);

      // Assert
      const savedContent = fs.writeFileSync.mock.calls[0][1];
      const parsed = JSON.parse(savedContent);

      expect(savedContent).toContain('  '); // 2-space indent
      expect(parsed).toEqual({
        ...DEFAULT_CONFIG,
        enabled: false
      });
    });

    it('should preserve all default values in saved config', () => {
      // Arrange
      const userConfig = { enabled: false };

      // Act
      saveConfig(userConfig);

      // Assert
      const savedContent = fs.writeFileSync.mock.calls[0][1];
      const parsed = JSON.parse(savedContent);

      expect(parsed).toHaveProperty('multiplexer', DEFAULT_CONFIG.multiplexer);
      expect(parsed).toHaveProperty('direction', DEFAULT_CONFIG.direction);
      expect(parsed).toHaveProperty('percent', DEFAULT_CONFIG.percent);
      expect(parsed).toHaveProperty('reusePane', DEFAULT_CONFIG.reusePane);
      expect(parsed).toHaveProperty('colors', DEFAULT_CONFIG.colors);
      expect(parsed).toHaveProperty('maxAgentHistory', DEFAULT_CONFIG.maxAgentHistory);
    });

    it('should return merged config object', () => {
      // Arrange
      const userConfig = {
        direction: 'bottom',
        percent: 30
      };

      // Act
      const result = saveConfig(userConfig);

      // Assert
      expect(result).toEqual({
        ...DEFAULT_CONFIG,
        direction: 'bottom',
        percent: 30
      });
    });

    it('should handle empty config object', () => {
      // Arrange
      const userConfig = {};

      // Act
      const result = saveConfig(userConfig);

      // Assert
      expect(result).toEqual(DEFAULT_CONFIG);
      const savedContent = fs.writeFileSync.mock.calls[0][1];
      const parsed = JSON.parse(savedContent);
      expect(parsed).toEqual(DEFAULT_CONFIG);
    });

    it('should override multiple default values', () => {
      // Arrange
      const userConfig = {
        enabled: false,
        multiplexer: 'tmux',
        direction: 'left',
        percent: 50,
        reusePane: false,
        colors: false,
        maxAgentHistory: 25,
        autoCloseTimeout: 10
      };

      // Act
      const result = saveConfig(userConfig);

      // Assert
      expect(result).toEqual(userConfig);
      const savedContent = fs.writeFileSync.mock.calls[0][1];
      const parsed = JSON.parse(savedContent);
      expect(parsed).toEqual(userConfig);
    });
  });

  describe('resetConfig()', () => {
    beforeEach(() => {
      // Mock existsSync to simulate directory exists
      fs.existsSync.mockReturnValue(true);
    });

    it('should reset to default configuration', () => {
      // Act
      const result = resetConfig();

      // Assert
      expect(result).toEqual(DEFAULT_CONFIG);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        mockConfigPath,
        expect.stringContaining('"enabled": true')
      );
    });

    it('should create config directory if it does not exist', () => {
      // Arrange
      fs.existsSync.mockReturnValue(false);

      // Act
      resetConfig();

      // Assert
      expect(fs.mkdirSync).toHaveBeenCalledWith(mockConfigDir, { recursive: true });
    });

    it('should save default config with proper formatting', () => {
      // Act
      resetConfig();

      // Assert
      const savedContent = fs.writeFileSync.mock.calls[0][1];
      const parsed = JSON.parse(savedContent);

      expect(savedContent).toContain('  '); // 2-space indent
      expect(parsed).toEqual(DEFAULT_CONFIG);
    });

    it('should write all default properties to file', () => {
      // Act
      resetConfig();

      // Assert
      const savedContent = fs.writeFileSync.mock.calls[0][1];
      const parsed = JSON.parse(savedContent);

      expect(parsed).toHaveProperty('enabled', true);
      expect(parsed).toHaveProperty('multiplexer', 'auto');
      expect(parsed).toHaveProperty('direction', 'right');
      expect(parsed).toHaveProperty('percent', 40);
      expect(parsed).toHaveProperty('reusePane', true);
      expect(parsed).toHaveProperty('colors', true);
      expect(parsed).toHaveProperty('maxAgentHistory', 50);
    });

    it('should return a copy of default config, not reference', () => {
      // Act
      const result = resetConfig();

      // Assert
      expect(result).toEqual(DEFAULT_CONFIG);
      expect(result).not.toBe(DEFAULT_CONFIG); // Different object reference

      // Mutating result should not affect DEFAULT_CONFIG
      result.enabled = false;
      expect(DEFAULT_CONFIG.enabled).toBe(true);
    });
  });

  describe('DEFAULT_CONFIG constant', () => {
    it('should have expected default values', () => {
      expect(DEFAULT_CONFIG).toEqual({
        enabled: true,
        multiplexer: 'auto',
        direction: 'right',
        percent: 40,
        reusePane: true,
        colors: true,
        maxAgentHistory: 50,
        autoCloseTimeout: 0
      });
    });

    it('should be exported as a constant', () => {
      expect(DEFAULT_CONFIG).toBeDefined();
      expect(typeof DEFAULT_CONFIG).toBe('object');
    });
  });

  describe('Integration scenarios', () => {
    it('should handle load -> save -> load cycle', () => {
      // Arrange - first load: no config file exists
      fs.existsSync
        .mockReturnValueOnce(false) // CONFIG_PATH doesn't exist (first load)
        .mockReturnValueOnce(false) // OLD_CONFIG_PATH doesn't exist (first load)
        .mockReturnValue(true); // All subsequent calls return true (save, second load)

      // First load - gets defaults
      const config1 = loadConfig();
      expect(config1).toEqual(DEFAULT_CONFIG);

      // Save with changes
      const userConfig = { enabled: false, direction: 'left' };
      const savedConfig = saveConfig(userConfig);
      expect(savedConfig.enabled).toBe(false);

      // Mock readFileSync to return saved config
      fs.readFileSync.mockReturnValue(JSON.stringify(savedConfig));

      // Second load - should get saved config
      const config2 = loadConfig();
      expect(config2.enabled).toBe(false);
      expect(config2.direction).toBe('left');
    });

    it('should handle save -> reset -> load cycle', () => {
      // Arrange
      fs.existsSync.mockReturnValue(true);

      // Save custom config
      const userConfig = { enabled: false, maxAgentHistory: 100 };
      saveConfig(userConfig);

      // Reset to defaults
      const resetResult = resetConfig();
      expect(resetResult).toEqual(DEFAULT_CONFIG);

      // Mock readFileSync to return default config
      fs.readFileSync.mockReturnValue(JSON.stringify(DEFAULT_CONFIG));

      // Load should return defaults
      const loadedConfig = loadConfig();
      expect(loadedConfig).toEqual(DEFAULT_CONFIG);
    });
  });
});
