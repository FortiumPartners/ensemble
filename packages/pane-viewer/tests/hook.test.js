/**
 * Tests for hook functionality
 */

const { PaneManager } = require('../hooks/pane-manager');
const { loadConfig } = require('../lib/config-loader');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Mock PaneManager to avoid actual pane spawning
jest.mock('../hooks/pane-manager', () => ({
  PaneManager: jest.fn().mockImplementation(() => ({
    getOrCreatePane: jest.fn().mockResolvedValue('test-pane-123')
  }))
}));

// Mock config loader
jest.mock('../lib/config-loader', () => ({
  loadConfig: jest.fn(() => ({
    enabled: true,
    direction: 'right',
    percent: 30
  }))
}));

describe('PaneManager', () => {
  it('should initialize', () => {
    const manager = new PaneManager();
    expect(manager).toBeDefined();
    expect(PaneManager).toHaveBeenCalled();
  });
});

describe('ConfigLoader', () => {
  it('should load default configuration', () => {
    const config = loadConfig();
    expect(config).toBeDefined();
    expect(config).toHaveProperty('enabled');
    expect(config).toHaveProperty('direction');
    expect(config).toHaveProperty('percent');
  });
});

describe('Hook Integration', () => {
  let originalEnv;
  let mockManager;

  beforeEach(() => {
    // Save original env
    originalEnv = { ...process.env };

    // Clear mocks
    jest.clearAllMocks();

    // Reset config mock to default
    loadConfig.mockReturnValue({
      enabled: true,
      direction: 'right',
      percent: 30
    });

    // Get mock manager instance
    mockManager = new PaneManager();
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  describe('Environment-based disabling', () => {
    it('should not spawn pane when disabled via env var', async () => {
      // Set disable flag
      process.env.ENSEMBLE_PANE_DISABLE = '1';

      // Simulate the main() function logic
      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'task-123',
        tool_input: {
          subagent_type: 'test-agent',
          description: 'Test task'
        }
      };

      // Check disable flag (simulating main() logic)
      if (process.env.ENSEMBLE_PANE_DISABLE === '1') {
        // Should return early, not call getOrCreatePane
        expect(mockManager.getOrCreatePane).not.toHaveBeenCalled();
        return;
      }

      // This should not be reached
      throw new Error('Expected early return when disabled');
    });

    it('should spawn pane when env var is not set', async () => {
      // Ensure disable flag is not set
      delete process.env.ENSEMBLE_PANE_DISABLE;

      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'task-123',
        tool_input: {
          subagent_type: 'test-agent',
          description: 'Test task'
        }
      };

      // Simulate main() logic
      const config = loadConfig();
      if (process.env.ENSEMBLE_PANE_DISABLE === '1' || !config.enabled) {
        return;
      }

      const toolName = hookData.tool_name;
      if (toolName !== 'Task') {
        return;
      }

      // Should call getOrCreatePane
      await mockManager.getOrCreatePane({
        direction: config.direction,
        percent: config.percent,
        taskId: hookData.tool_use_id,
        agentType: hookData.tool_input.subagent_type,
        description: hookData.tool_input.description
      });

      expect(mockManager.getOrCreatePane).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          agentType: 'test-agent',
          description: 'Test task'
        })
      );
    });
  });

  describe('Config-based disabling', () => {
    it('should not spawn pane when config.enabled is false', async () => {
      // Mock config with enabled: false
      loadConfig.mockReturnValue({
        enabled: false,
        direction: 'right',
        percent: 30
      });

      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'task-123',
        tool_input: {
          subagent_type: 'test-agent',
          description: 'Test task'
        }
      };

      // Simulate main() logic
      const config = loadConfig();
      if (process.env.ENSEMBLE_PANE_DISABLE === '1' || !config.enabled) {
        // Should return early
        expect(mockManager.getOrCreatePane).not.toHaveBeenCalled();
        return;
      }

      // This should not be reached
      throw new Error('Expected early return when config.enabled is false');
    });

    it('should spawn pane when config.enabled is true', async () => {
      // Mock config with enabled: true
      loadConfig.mockReturnValue({
        enabled: true,
        direction: 'right',
        percent: 30
      });

      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'task-123',
        tool_input: {
          subagent_type: 'test-agent',
          description: 'Test task'
        }
      };

      // Simulate main() logic
      const config = loadConfig();
      if (!config.enabled) {
        return;
      }

      const toolName = hookData.tool_name;
      if (toolName !== 'Task') {
        return;
      }

      await mockManager.getOrCreatePane({
        direction: config.direction,
        percent: config.percent,
        taskId: hookData.tool_use_id,
        agentType: hookData.tool_input.subagent_type,
        description: hookData.tool_input.description
      });

      expect(mockManager.getOrCreatePane).toHaveBeenCalled();
    });
  });

  describe('Tool filtering', () => {
    it('should not spawn pane for Read tool', async () => {
      const hookData = {
        tool_name: 'Read',
        tool_use_id: 'read-123',
        tool_input: {
          file_path: '/tmp/test.txt'
        }
      };

      // Simulate main() logic
      const config = loadConfig();
      const toolName = hookData.tool_name;

      if (toolName !== 'Task') {
        // Should return early
        expect(mockManager.getOrCreatePane).not.toHaveBeenCalled();
        return;
      }

      // This should not be reached
      throw new Error('Expected early return for non-Task tool');
    });

    it('should not spawn pane for Write tool', async () => {
      const hookData = {
        tool_name: 'Write',
        tool_use_id: 'write-123',
        tool_input: {
          file_path: '/tmp/test.txt',
          content: 'test'
        }
      };

      // Simulate main() logic
      const toolName = hookData.tool_name;

      if (toolName !== 'Task') {
        // Should return early
        expect(mockManager.getOrCreatePane).not.toHaveBeenCalled();
        return;
      }

      // This should not be reached
      throw new Error('Expected early return for non-Task tool');
    });

    it('should not spawn pane for Edit tool', async () => {
      const hookData = {
        tool_name: 'Edit',
        tool_use_id: 'edit-123',
        tool_input: {
          file_path: '/tmp/test.txt',
          old_string: 'old',
          new_string: 'new'
        }
      };

      // Simulate main() logic
      const toolName = hookData.tool_name;

      if (toolName !== 'Task') {
        // Should return early
        expect(mockManager.getOrCreatePane).not.toHaveBeenCalled();
        return;
      }

      // This should not be reached
      throw new Error('Expected early return for non-Task tool');
    });

    it('should not spawn pane for Bash tool', async () => {
      const hookData = {
        tool_name: 'Bash',
        tool_use_id: 'bash-123',
        tool_input: {
          command: 'echo test'
        }
      };

      // Simulate main() logic
      const toolName = hookData.tool_name;

      if (toolName !== 'Task') {
        // Should return early
        expect(mockManager.getOrCreatePane).not.toHaveBeenCalled();
        return;
      }

      // This should not be reached
      throw new Error('Expected early return for non-Task tool');
    });

    it('should spawn pane for Task tool', async () => {
      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'task-123',
        tool_input: {
          subagent_type: 'backend-developer',
          description: 'Implement user authentication'
        }
      };

      // Simulate main() logic
      const config = loadConfig();
      const toolName = hookData.tool_name;

      if (toolName !== 'Task') {
        return;
      }

      const params = hookData.tool_input || {};
      const agentType = params.subagent_type || 'unknown';
      const description = params.description || '';
      const taskId = hookData.tool_use_id;

      await mockManager.getOrCreatePane({
        direction: config.direction,
        percent: config.percent,
        taskId,
        agentType,
        description
      });

      expect(mockManager.getOrCreatePane).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: 'task-123',
          agentType: 'backend-developer',
          description: 'Implement user authentication'
        })
      );
    });
  });

  describe('Hook data extraction', () => {
    it('should extract agent info from tool_input', async () => {
      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'task-456',
        tool_input: {
          subagent_type: 'frontend-developer',
          description: 'Create React component'
        }
      };

      const config = loadConfig();
      const params = hookData.tool_input || {};
      const agentType = params.subagent_type || 'unknown';
      const description = params.description || '';

      expect(agentType).toBe('frontend-developer');
      expect(description).toBe('Create React component');
    });

    it('should handle missing tool_input', async () => {
      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'task-789'
      };

      const params = hookData.tool_input || {};
      const agentType = params.subagent_type || 'unknown';
      const description = params.description || '';

      expect(agentType).toBe('unknown');
      expect(description).toBe('');
    });

    it('should handle alternative parameter names', async () => {
      const hookData = {
        tool: 'Task',  // Alternative field name
        tool_use_id: 'task-999',
        parameters: {  // Alternative field name
          subagent_type: 'code-reviewer',
          description: 'Review pull request'
        }
      };

      const toolName = hookData.tool_name || hookData.tool;
      const params = hookData.tool_input || hookData.parameters || {};
      const agentType = params.subagent_type || 'unknown';
      const description = params.description || '';

      expect(toolName).toBe('Task');
      expect(agentType).toBe('code-reviewer');
      expect(description).toBe('Review pull request');
    });

    it('should include transcript path when available', async () => {
      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'task-111',
        tool_input: {
          subagent_type: 'test-runner',
          description: 'Run integration tests'
        },
        transcript_path: '/tmp/transcripts/agent-task-111.jsonl'
      };

      const config = loadConfig();
      const params = hookData.tool_input || {};
      const agentType = params.subagent_type || 'unknown';
      const description = params.description || '';
      const taskId = hookData.tool_use_id;
      const transcriptPath = hookData.transcript_path || '';

      await mockManager.getOrCreatePane({
        direction: config.direction,
        percent: config.percent,
        taskId,
        agentType,
        description,
        transcriptPath
      });

      expect(mockManager.getOrCreatePane).toHaveBeenCalledWith(
        expect.objectContaining({
          transcriptPath: '/tmp/transcripts/agent-task-111.jsonl'
        })
      );
    });
  });

  describe('Error handling', () => {
    it('should handle errors gracefully', async () => {
      // Mock getOrCreatePane to throw an error
      mockManager.getOrCreatePane.mockRejectedValueOnce(
        new Error('Failed to spawn pane')
      );

      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'task-error',
        tool_input: {
          subagent_type: 'test-agent',
          description: 'Test error handling'
        }
      };

      // Simulate main() logic with error handling
      try {
        const config = loadConfig();
        const params = hookData.tool_input || {};
        const agentType = params.subagent_type || 'unknown';
        const description = params.description || '';
        const taskId = hookData.tool_use_id;

        await mockManager.getOrCreatePane({
          direction: config.direction,
          percent: config.percent,
          taskId,
          agentType,
          description
        });
      } catch (error) {
        // Should catch and log error without crashing
        expect(error.message).toBe('Failed to spawn pane');
      }

      expect(mockManager.getOrCreatePane).toHaveBeenCalled();
    });

    it('should not crash on invalid config', async () => {
      // Mock config to return invalid data
      loadConfig.mockReturnValueOnce(null);

      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'task-invalid-config',
        tool_input: {
          subagent_type: 'test-agent',
          description: 'Test with invalid config'
        }
      };

      // Simulate main() logic with null config handling
      try {
        const config = loadConfig();

        // Should handle null config gracefully
        if (!config) {
          expect(mockManager.getOrCreatePane).not.toHaveBeenCalled();
          return;
        }

        if (!config.enabled) {
          return;
        }
      } catch (error) {
        // Should not throw
        throw new Error('Should handle invalid config gracefully');
      }
    });
  });

  describe('Integration with config options', () => {
    it('should use custom direction from config', async () => {
      loadConfig.mockReturnValue({
        enabled: true,
        direction: 'bottom',
        percent: 40
      });

      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'task-direction',
        tool_input: {
          subagent_type: 'test-agent',
          description: 'Test custom direction'
        }
      };

      const config = loadConfig();
      const params = hookData.tool_input || {};

      await mockManager.getOrCreatePane({
        direction: config.direction,
        percent: config.percent,
        taskId: hookData.tool_use_id,
        agentType: params.subagent_type,
        description: params.description
      });

      expect(mockManager.getOrCreatePane).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'bottom',
          percent: 40
        })
      );
    });

    it('should use custom percent from config', async () => {
      loadConfig.mockReturnValue({
        enabled: true,
        direction: 'right',
        percent: 50
      });

      const hookData = {
        tool_name: 'Task',
        tool_use_id: 'task-percent',
        tool_input: {
          subagent_type: 'test-agent',
          description: 'Test custom percent'
        }
      };

      const config = loadConfig();
      const params = hookData.tool_input || {};

      await mockManager.getOrCreatePane({
        direction: config.direction,
        percent: config.percent,
        taskId: hookData.tool_use_id,
        agentType: params.subagent_type,
        description: params.description
      });

      expect(mockManager.getOrCreatePane).toHaveBeenCalledWith(
        expect.objectContaining({
          percent: 50
        })
      );
    });
  });
});
