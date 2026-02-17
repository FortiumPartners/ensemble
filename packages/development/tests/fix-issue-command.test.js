/**
 * Unit tests for fix-issue.yaml command structure
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

describe('Fix-Issue Command', () => {
  let commandYaml;

  beforeAll(() => {
    const commandPath = path.join(__dirname, '../commands/fix-issue.yaml');
    const yamlContent = fs.readFileSync(commandPath, 'utf-8');
    commandYaml = yaml.load(yamlContent);
  });

  describe('Metadata', () => {
    test('has valid metadata structure', () => {
      expect(commandYaml.metadata).toBeDefined();
      expect(commandYaml.metadata.name).toBe('ensemble:fix-issue');
      expect(commandYaml.metadata.description).toBe('Lightweight workflow for bug fixes and small issues');
      expect(commandYaml.metadata.version).toBe('1.0.0');
      expect(commandYaml.metadata.category).toBe('implementation');
      expect(commandYaml.metadata.model).toBe('sonnet');
      expect(commandYaml.metadata.source).toBe('fortium');
    });

    test('has valid output path', () => {
      expect(commandYaml.metadata.output_path).toBe('ensemble/fix-issue.md');
    });
  });

  describe('Parameters', () => {
    test('defines all required parameters', () => {
      expect(commandYaml.parameters).toBeInstanceOf(Array);
      expect(commandYaml.parameters.length).toBe(6);

      const paramNames = commandYaml.parameters.map(p => p.name);
      expect(paramNames).toContain('description');
      expect(paramNames).toContain('issue');
      expect(paramNames).toContain('branch');
      expect(paramNames).toContain('skip-tests');
      expect(paramNames).toContain('draft-pr');
      expect(paramNames).toContain('interactive');
    });

    test('description parameter is optional string', () => {
      const param = commandYaml.parameters.find(p => p.name === 'description');
      expect(param.type).toBe('string');
      expect(param.required).toBe(false);
      expect(param.description).toContain('Issue description');
    });

    test('issue parameter is optional number', () => {
      const param = commandYaml.parameters.find(p => p.name === 'issue');
      expect(param.type).toBe('number');
      expect(param.required).toBe(false);
      expect(param.description).toContain('GitHub issue number');
    });

    test('branch parameter is optional string', () => {
      const param = commandYaml.parameters.find(p => p.name === 'branch');
      expect(param.type).toBe('string');
      expect(param.required).toBe(false);
      expect(param.description).toContain('Custom branch name');
    });

    test('skip-tests parameter is boolean with default false', () => {
      const param = commandYaml.parameters.find(p => p.name === 'skip-tests');
      expect(param.type).toBe('boolean');
      expect(param.default).toBe(false);
      expect(param.description).toContain('Skip test validation');
    });

    test('draft-pr parameter is boolean with default false', () => {
      const param = commandYaml.parameters.find(p => p.name === 'draft-pr');
      expect(param.type).toBe('boolean');
      expect(param.default).toBe(false);
      expect(param.description).toContain('Create draft PR');
    });

    test('interactive parameter is boolean with default false', () => {
      const param = commandYaml.parameters.find(p => p.name === 'interactive');
      expect(param.type).toBe('boolean');
      expect(param.default).toBe(false);
      expect(param.description).toContain('Enable detailed user interviews');
    });
  });

  describe('Mission', () => {
    test('has valid mission structure', () => {
      expect(commandYaml.mission).toBeDefined();
      expect(commandYaml.mission.summary).toBeDefined();
      expect(commandYaml.mission.behavior).toBeInstanceOf(Array);
      expect(commandYaml.constraints).toBeInstanceOf(Array);
    });

    test('mission summary describes workflow', () => {
      expect(commandYaml.mission.summary).toContain('bug fix workflow');
      expect(commandYaml.mission.summary).toContain('specialized agents');
    });

    test('defines expected behaviors', () => {
      expect(commandYaml.mission.behavior.length).toBeGreaterThan(5);

      const behaviors = commandYaml.mission.behavior.join(' ');
      expect(behaviors).toContain('3-phase workflow');
      expect(behaviors).toContain('Analysis & Planning');
      expect(behaviors).toContain('Execution');
      expect(behaviors).toContain('Validation & Delivery');
      expect(behaviors).toContain('TodoWrite');
      expect(behaviors).toContain('GitHub CLI');
    });

    test('defines constraints', () => {
      expect(commandYaml.constraints.length).toBeGreaterThan(3);

      const constraints = commandYaml.constraints.join(' ');
      expect(constraints).toContain('GitHub only');
      expect(constraints).toContain('GitHub CLI');
      expect(constraints).toContain('Tests must pass');
    });
  });

  describe('Workflow', () => {
    test('has 3 phases', () => {
      expect(commandYaml.workflow).toBeDefined();
      expect(commandYaml.workflow.phases).toBeInstanceOf(Array);
      expect(commandYaml.workflow.phases.length).toBe(3);
    });

    test('Phase 1: Analysis & Planning', () => {
      const phase = commandYaml.workflow.phases[0];
      expect(phase.name).toBe('Analysis & Planning');
      expect(phase.order).toBe(1);
      expect(phase.steps).toBeInstanceOf(Array);
      expect(phase.steps.length).toBe(3);

      // Step 1: Codebase Analysis
      const step1 = phase.steps[0];
      expect(step1.title).toBe('Codebase Analysis');
      expect(step1.agent).toBe('general-purpose');
      expect(step1.model).toBe('haiku');
      expect(step1.instructions).toContain('Extract keywords');
      expect(step1.instructions).toContain('Search codebase');

      // Step 2: Collaborative Planning
      const step2 = phase.steps[1];
      expect(step2.title).toBe('Collaborative Planning');
      expect(step2.model).toBe('sonnet');
      expect(step2.instructions).toContain('product-management-orchestrator');
      expect(step2.instructions).toContain('tech-lead-orchestrator');
      expect(step2.instructions).toContain('infrastructure-orchestrator');
      expect(step2.instructions).toContain('qa-orchestrator');

      // Step 3: User Interview
      const step3 = phase.steps[2];
      expect(step3.title).toBe('User Interview (Conditional)');
      expect(step3.conditional).toBe(true);
      expect(step3.trigger).toContain('Ambiguity detection');
      expect(step3.instructions).toContain('AskUserQuestion');
    });

    test('Phase 2: Execution', () => {
      const phase = commandYaml.workflow.phases[1];
      expect(phase.name).toBe('Execution');
      expect(phase.order).toBe(2);
      expect(phase.steps).toBeInstanceOf(Array);
      expect(phase.steps.length).toBe(3);

      // Step 1: Branch Creation
      const step1 = phase.steps[0];
      expect(step1.title).toBe('Branch Creation');
      expect(step1.tool).toBe('Bash');
      expect(step1.instructions).toContain('git checkout -b');
      expect(step1.instructions).toContain('fix/issue-');

      // Step 2: Task List Generation
      const step2 = phase.steps[1];
      expect(step2.title).toBe('Task List Generation');
      expect(step2.tool).toBe('TodoWrite');
      expect(step2.instructions).toContain('Generate 3-10 specific');
      expect(step2.instructions).toContain('activeForm');

      // Step 3: Task Execution
      const step3 = phase.steps[2];
      expect(step3.title).toBe('Task Execution');
      expect(step3.model).toBe('sonnet');
      expect(step3.instructions).toContain('backend-developer');
      expect(step3.instructions).toContain('frontend-developer');
      expect(step3.instructions).toContain('infrastructure-developer');
    });

    test('Phase 3: Validation & Delivery', () => {
      const phase = commandYaml.workflow.phases[2];
      expect(phase.name).toBe('Validation & Delivery');
      expect(phase.order).toBe(3);
      expect(phase.steps).toBeInstanceOf(Array);
      expect(phase.steps.length).toBe(2);

      // Step 1: Test Validation
      const step1 = phase.steps[0];
      expect(step1.title).toBe('Test Validation');
      expect(step1.agent).toBe('test-runner');
      expect(step1.model).toBe('haiku');
      expect(step1.retry).toBe(2);
      expect(step1.instructions).toContain('Detect test framework');
      expect(step1.instructions).toContain('2 attempts');

      // Step 2: PR Creation
      const step2 = phase.steps[1];
      expect(step2.title).toBe('PR Creation');
      expect(step2.tool).toBe('Bash');
      expect(step2.model).toBe('haiku');
      expect(step2.instructions).toContain('gh pr create');
      expect(step2.instructions).toContain('conventional commit');
    });
  });

  describe('Validation', () => {
    test('specifies required tools', () => {
      expect(commandYaml.validation).toBeDefined();
      expect(commandYaml.validation.required_tools).toBeInstanceOf(Array);

      const tools = commandYaml.validation.required_tools;
      expect(tools).toContain('Bash');
      expect(tools).toContain('Read');
      expect(tools).toContain('Write');
      expect(tools).toContain('Edit');
      expect(tools).toContain('Grep');
      expect(tools).toContain('Glob');
      expect(tools).toContain('Task');
      expect(tools).toContain('TodoWrite');
    });

    test('specifies required agents', () => {
      expect(commandYaml.validation.required_agents).toBeInstanceOf(Array);

      const agents = commandYaml.validation.required_agents;
      expect(agents).toContain('general-purpose');
      expect(agents).toContain('product-management-orchestrator');
      expect(agents).toContain('tech-lead-orchestrator');
      expect(agents).toContain('infrastructure-orchestrator');
      expect(agents).toContain('qa-orchestrator');
      expect(agents).toContain('backend-developer');
      expect(agents).toContain('frontend-developer');
      expect(agents).toContain('infrastructure-developer');
      expect(agents).toContain('test-runner');
      expect(agents).toContain('git-workflow');
      expect(agents).toContain('github-specialist');
    });

    test('specifies required external tools', () => {
      expect(commandYaml.validation.required_external).toBeInstanceOf(Array);

      const external = commandYaml.validation.required_external;
      expect(external).toContain('git (version 2.0+)');
      expect(external).toContain('gh (GitHub CLI, authenticated)');
    });
  });

  describe('Workflow Steps Ordering', () => {
    test('all phases have sequential ordering', () => {
      commandYaml.workflow.phases.forEach((phase, index) => {
        expect(phase.order).toBe(index + 1);
      });
    });

    test('all steps within phases have sequential ordering', () => {
      commandYaml.workflow.phases.forEach(phase => {
        phase.steps.forEach((step, index) => {
          expect(step.order).toBe(index + 1);
        });
      });
    });
  });

  describe('Git Workflow Integration', () => {
    test('branch creation uses conventional naming', () => {
      const executionPhase = commandYaml.workflow.phases[1];
      const branchStep = executionPhase.steps[0];

      expect(branchStep.instructions).toContain('fix/issue-{number}-{slugified-description}');
      expect(branchStep.instructions).toContain('fix/{slugified-description}');
    });

    test('PR creation includes conventional commit format', () => {
      const deliveryPhase = commandYaml.workflow.phases[2];
      const prStep = deliveryPhase.steps[1];

      expect(prStep.instructions).toContain('conventional commit format');
      expect(prStep.instructions).toContain('Fix:');
      expect(prStep.instructions).toContain('Fix #{number}:');
    });

    test('PR template includes required sections', () => {
      const deliveryPhase = commandYaml.workflow.phases[2];
      const prStep = deliveryPhase.steps[1];

      expect(prStep.instructions).toContain('## Problem');
      expect(prStep.instructions).toContain('## Solution');
      expect(prStep.instructions).toContain('## Changes');
      expect(prStep.instructions).toContain('## Test Plan');
      expect(prStep.instructions).toContain('## Checklist');
      expect(prStep.instructions).toContain('Fixes #{issue-number}');
    });
  });

  describe('Model Selection', () => {
    test('uses haiku for analysis (fast, cost-effective)', () => {
      const analysisPhase = commandYaml.workflow.phases[0];
      const analysisStep = analysisPhase.steps[0];

      expect(analysisStep.model).toBe('haiku');
    });

    test('uses sonnet for planning (quality)', () => {
      const analysisPhase = commandYaml.workflow.phases[0];
      const planningStep = analysisPhase.steps[1];

      expect(planningStep.model).toBe('sonnet');
    });

    test('uses sonnet for implementation (quality)', () => {
      const executionPhase = commandYaml.workflow.phases[1];
      const taskExecutionStep = executionPhase.steps[2];

      expect(taskExecutionStep.model).toBe('sonnet');
    });

    test('uses haiku for testing (fast)', () => {
      const deliveryPhase = commandYaml.workflow.phases[2];
      const testStep = deliveryPhase.steps[0];

      expect(testStep.model).toBe('haiku');
    });

    test('uses haiku for PR creation (fast)', () => {
      const deliveryPhase = commandYaml.workflow.phases[2];
      const prStep = deliveryPhase.steps[1];

      expect(prStep.model).toBe('haiku');
    });
  });

  describe('Error Handling', () => {
    test('test validation includes retry logic', () => {
      const deliveryPhase = commandYaml.workflow.phases[2];
      const testStep = deliveryPhase.steps[0];

      expect(testStep.retry).toBe(2);
      expect(testStep.instructions).toContain('Attempt 1');
      expect(testStep.instructions).toContain('Attempt 2');
      expect(testStep.instructions).toContain('IF tests still fail');
      expect(testStep.instructions).toContain('HALT workflow');
    });

    test('branch creation checks for conflicts', () => {
      const executionPhase = commandYaml.workflow.phases[1];
      const branchStep = executionPhase.steps[0];

      expect(branchStep.instructions).toContain('Check if branch exists');
      expect(branchStep.instructions).toContain('git branch --list');
    });

    test('PR creation handles push errors', () => {
      const deliveryPhase = commandYaml.workflow.phases[2];
      const prStep = deliveryPhase.steps[1];

      expect(prStep.instructions).toContain('Handle push errors');
    });
  });

  describe('Agent Delegation', () => {
    test('planning phase delegates to 4 orchestrators', () => {
      const analysisPhase = commandYaml.workflow.phases[0];
      const planningStep = analysisPhase.steps[1];

      expect(planningStep.instructions).toContain('Task(product-management-orchestrator)');
      expect(planningStep.instructions).toContain('Task(tech-lead-orchestrator)');
      expect(planningStep.instructions).toContain('Task(infrastructure-orchestrator)');
      expect(planningStep.instructions).toContain('Task(qa-orchestrator)');
    });

    test('execution phase routes to specialized developers', () => {
      const executionPhase = commandYaml.workflow.phases[1];
      const taskExecutionStep = executionPhase.steps[2];

      expect(taskExecutionStep.instructions).toContain('Backend code → backend-developer');
      expect(taskExecutionStep.instructions).toContain('Frontend code → frontend-developer');
      expect(taskExecutionStep.instructions).toContain('Infrastructure → infrastructure-developer');
    });
  });

  describe('TodoWrite Integration', () => {
    test('task list generation uses TodoWrite', () => {
      const executionPhase = commandYaml.workflow.phases[1];
      const taskListStep = executionPhase.steps[1];

      expect(taskListStep.tool).toBe('TodoWrite');
      expect(taskListStep.instructions).toContain('content:');
      expect(taskListStep.instructions).toContain('activeForm:');
      expect(taskListStep.instructions).toContain('status: "pending"');
    });

    test('task execution tracks progress', () => {
      const executionPhase = commandYaml.workflow.phases[1];
      const taskExecutionStep = executionPhase.steps[2];

      expect(taskExecutionStep.instructions).toContain('status: "in_progress"');
      expect(taskExecutionStep.instructions).toContain('status: "completed"');
    });
  });
});
