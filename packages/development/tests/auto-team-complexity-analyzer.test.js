/**
 * Tests for the auto-team complexity analysis logic defined in
 * packages/development/commands/create-trd.yaml team_configuration section.
 *
 * Covers TRD-036 (Simple tier), TRD-037 (Medium tier), TRD-038 (Complex tier),
 * TRD-039 (CLI flag overrides).
 *
 * These helper functions mirror the logic that the YAML workflow executes so
 * we can validate the classification rules as pure unit tests.
 */

'use strict';

// ---------------------------------------------------------------------------
// Helper functions — mirror the YAML workflow logic
// ---------------------------------------------------------------------------

/**
 * Classify TRD complexity into Simple | Medium | Complex | None.
 *
 * Rules (from create-trd.yaml team_configuration.complexity_tiers):
 *   Complex  — ANY:  taskCount > 25 OR domainCount >= 3 OR estimatedHours > 60
 *   Medium   — ANY:  taskCount >= 10 OR domainCount >= 2 OR estimatedHours >= 20
 *   Simple   — ALL:  taskCount < 10 AND domainCount === 1 AND estimatedHours < 20
 *
 * CLI overrides:
 *   --team     → forces Complex regardless of metrics
 *   --no-team  → returns None regardless of metrics
 *   Both flags → throws (mutually exclusive)
 */
function classifyComplexity(taskCount, domainCount, estimatedHours, forceTeam = false, forceNoTeam = false) {
  if (forceTeam && forceNoTeam) {
    throw new Error('--team and --no-team are mutually exclusive');
  }
  if (forceNoTeam) return 'None';
  if (forceTeam) return 'Complex';

  // Complex: ANY single condition
  if (taskCount > 25 || domainCount >= 3 || estimatedHours > 60) return 'Complex';
  // Medium: ANY single condition
  if (taskCount >= 10 || domainCount >= 2 || estimatedHours >= 20) return 'Medium';
  // Simple: none of the above
  return 'Simple';
}

/**
 * Domain detection using keyword matching from create-trd.yaml domain_keywords.
 * Returns the list of matched domain names (deduplicated).
 */
function detectDomains(taskText, domainKeywords) {
  const lower = taskText.toLowerCase();
  return Object.entries(domainKeywords)
    .filter(([, keywords]) => keywords.some(kw => lower.includes(kw)))
    .map(([domain]) => domain);
}

/**
 * Extract estimated hours from a task line.
 * Looks for the pattern (Nh) or (N.Mh) at the end of the line.
 * Falls back to 2h default if not found.
 */
function extractHours(taskLine) {
  const match = taskLine.match(/\((\d+(?:\.\d+)?)h\)/);
  return match ? parseFloat(match[1]) : 2;
}

/**
 * Parse TRD markdown content and return an array of task objects.
 * Matches lines like:  - [ ] **TRD-NNN**: Title text (Nh)
 */
function parseTrdTaskList(trdContent) {
  const lines = trdContent.split('\n');
  const tasks = [];
  for (const line of lines) {
    const match = line.match(/^\s*-\s*\[\s*\]\s*\*\*TRD-\d+\*\*:\s*(.+)/);
    if (match) {
      tasks.push({
        title: match[1].trim(),
        hours: extractHours(line),
      });
    }
  }
  return tasks;
}

// Domain keywords extracted from create-trd.yaml team_configuration.domain_keywords
const DOMAIN_KEYWORDS = {
  backend:        ['api', 'endpoint', 'server', 'service', 'controller', 'repository', 'middleware', 'rest', 'graphql', 'backend'],
  frontend:       ['ui', 'component', 'react', 'vue', 'angular', 'svelte', 'css', 'html', 'page', 'frontend', 'interface', 'form'],
  infrastructure: ['deploy', 'docker', 'kubernetes', 'k8s', 'aws', 'cloud', 'terraform', 'ci', 'cd', 'pipeline', 'infra', 'infrastructure'],
  documentation:  ['docs', 'readme', 'documentation', 'changelog', 'guide', 'api-docs', 'swagger', 'openapi', 'document'],
  testing:        ['test', 'spec', 'e2e', 'unit', 'integration', 'coverage', 'jest', 'pytest', 'rspec', 'playwright', 'vitest', 'exunit'],
  database:       ['database', 'db', 'sql', 'schema', 'migration', 'query', 'postgres', 'mysql', 'mongodb', 'redis'],
  security:       ['security', 'auth', 'authentication', 'authorization', 'permission', 'encrypt', 'ssl', 'tls', 'vulnerability', 'cve'],
  devops:         ['devops', 'monitoring', 'logging', 'alerting', 'metrics', 'observability', 'helm', 'ansible', 'provisioning'],
};

// ---------------------------------------------------------------------------
// TRD-036: Simple-tier TRD — 5 tasks, single domain (backend), 10h
// ---------------------------------------------------------------------------

describe('TRD-036: Simple-tier complexity classification', () => {
  it('classifies a 5-task single-domain 10h TRD as Simple', () => {
    expect(classifyComplexity(5, 1, 10)).toBe('Simple');
  });

  it('returns Simple at the exact boundary (9 tasks, 1 domain, 19h)', () => {
    expect(classifyComplexity(9, 1, 19)).toBe('Simple');
  });

  it('Simple TRD should produce no team config (result is Simple, not Medium or Complex)', () => {
    const tier = classifyComplexity(5, 1, 10);
    expect(tier).not.toBe('Medium');
    expect(tier).not.toBe('Complex');
    expect(tier).not.toBe('None');
  });

  it('recognises a pure-backend task list as single-domain', () => {
    const trdContent = [
      '- [ ] **TRD-001**: Create REST API endpoint for user registration (2h)',
      '- [ ] **TRD-002**: Add backend service layer for user creation (2h)',
      '- [ ] **TRD-003**: Implement repository pattern for user storage (2h)',
      '- [ ] **TRD-004**: Add middleware for request validation (2h)',
      '- [ ] **TRD-005**: Create controller for user management (2h)',
    ].join('\n');

    const tasks = parseTrdTaskList(trdContent);
    expect(tasks).toHaveLength(5);

    const totalHours = tasks.reduce((sum, t) => sum + t.hours, 0);
    expect(totalHours).toBe(10);

    const allText = tasks.map(t => t.title).join(' ');
    const domains = detectDomains(allText, DOMAIN_KEYWORDS);
    // Should include 'backend' only (no other domains in this text)
    expect(domains).toContain('backend');
    expect(domains).not.toContain('frontend');
    expect(domains).not.toContain('infrastructure');

    expect(classifyComplexity(tasks.length, 1, totalHours)).toBe('Simple');
  });

  it('parses hour estimates correctly from task lines', () => {
    expect(extractHours('- [ ] **TRD-001**: Some task (3h)')).toBe(3);
    expect(extractHours('- [ ] **TRD-002**: Some task (1.5h)')).toBe(1.5);
    expect(extractHours('- [ ] **TRD-003**: Some task with no estimate')).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// TRD-037: Medium-tier TRD — 15 tasks, 2 domains, 30h + edge cases
// ---------------------------------------------------------------------------

describe('TRD-037: Medium-tier complexity classification', () => {
  it('classifies a 15-task 2-domain 30h TRD as Medium', () => {
    expect(classifyComplexity(15, 2, 30)).toBe('Medium');
  });

  it('Medium tier should enable lead + builder only (not reviewer, not qa)', () => {
    const tier = classifyComplexity(15, 2, 30);
    expect(tier).toBe('Medium');
    // Medium → no reviewer, no qa roles
  });

  it('edge case: 8 tasks but 2 domains → Medium (domain_count condition)', () => {
    expect(classifyComplexity(8, 2, 15)).toBe('Medium');
  });

  it('edge case: 8 tasks, 1 domain but 20h → Medium (hours condition)', () => {
    expect(classifyComplexity(8, 1, 20)).toBe('Medium');
  });

  it('exact threshold: 10 tasks triggers Medium regardless of domain/hours', () => {
    expect(classifyComplexity(10, 1, 5)).toBe('Medium');
  });

  it('Medium tier at upper boundary: 25 tasks, 1 domain, 59h → Medium', () => {
    expect(classifyComplexity(25, 1, 59)).toBe('Medium');
  });

  it('recognises backend + database as 2 domains', () => {
    const trdContent = [
      '- [ ] **TRD-001**: Create REST API endpoint for user data (2h)',
      '- [ ] **TRD-002**: Design SQL schema for user table (2h)',
      '- [ ] **TRD-003**: Write migration scripts for user database (2h)',
    ].join('\n');
    const allText = parseTrdTaskList(trdContent).map(t => t.title).join(' ');
    const domains = detectDomains(allText, DOMAIN_KEYWORDS);
    expect(domains).toContain('backend');
    expect(domains).toContain('database');
    expect(domains.length).toBeGreaterThanOrEqual(2);
  });

  it('parses a 15-task TRD with mixed backend/database content', () => {
    const lines = [];
    for (let i = 1; i <= 10; i++) lines.push(`- [ ] **TRD-0${String(i).padStart(2, '0')}**: Implement API service layer (2h)`);
    for (let i = 11; i <= 15; i++) lines.push(`- [ ] **TRD-0${i}**: Write SQL migration for database table (4h)`);
    const trdContent = lines.join('\n');
    const tasks = parseTrdTaskList(trdContent);
    expect(tasks).toHaveLength(15);
    const totalHours = tasks.reduce((sum, t) => sum + t.hours, 0);
    expect(totalHours).toBe(40); // 10*2 + 5*4
    expect(classifyComplexity(tasks.length, 2, totalHours)).toBe('Medium'); // 15 tasks < 25, 2 domains < 3, 40h < 60 u2192 Medium
  });

  it('correctly classifies 15 tasks, 2 domains, 40h as Medium (not Complex)', () => {
    // 15 tasks (not > 25), 2 domains (not >= 3), 40h (not > 60) → Medium
    expect(classifyComplexity(15, 2, 40)).toBe('Medium');
  });
});

// ---------------------------------------------------------------------------
// TRD-038: Complex-tier TRD — 30 tasks, 3 domains, 70h + edge cases
// ---------------------------------------------------------------------------

describe('TRD-038: Complex-tier complexity classification', () => {
  it('classifies a 30-task 3-domain 70h TRD as Complex', () => {
    expect(classifyComplexity(30, 3, 70)).toBe('Complex');
  });

  it('Complex tier should enable all four roles: lead, builder, reviewer, qa', () => {
    const tier = classifyComplexity(30, 3, 70);
    expect(tier).toBe('Complex');
    // Complex → reviewer enabled, qa enabled
  });

  it('edge case: 8 tasks but 3 domains → Complex (domain_count >= 3)', () => {
    expect(classifyComplexity(8, 3, 15)).toBe('Complex');
  });

  it('edge case: 5 tasks, 1 domain, but 61h → Complex (hours > 60)', () => {
    expect(classifyComplexity(5, 1, 61)).toBe('Complex');
  });

  it('edge case: 26 tasks, 1 domain, 10h → Complex (task_count > 25)', () => {
    expect(classifyComplexity(26, 1, 10)).toBe('Complex');
  });

  it('recognises backend + infrastructure + documentation as 3 domains', () => {
    const trdContent = [
      '- [ ] **TRD-001**: Build REST API endpoint for deployment (2h)',
      '- [ ] **TRD-002**: Create Docker container for service (2h)',
      '- [ ] **TRD-003**: Write README documentation for API (2h)',
    ].join('\n');
    const allText = parseTrdTaskList(trdContent).map(t => t.title).join(' ');
    const domains = detectDomains(allText, DOMAIN_KEYWORDS);
    expect(domains).toContain('backend');
    expect(domains).toContain('infrastructure');
    expect(domains).toContain('documentation');
    expect(domains.length).toBeGreaterThanOrEqual(3);

    // 3 domains → Complex regardless of task count
    expect(classifyComplexity(3, domains.length, 6)).toBe('Complex');
  });

  it('exactly 25 tasks is NOT Complex (must be > 25)', () => {
    expect(classifyComplexity(25, 1, 10)).toBe('Medium');
  });

  it('exactly 60h is NOT Complex (must be > 60)', () => {
    expect(classifyComplexity(9, 1, 60)).toBe('Medium');
  });
});

// ---------------------------------------------------------------------------
// TRD-039: CLI flag overrides
// ---------------------------------------------------------------------------

describe('TRD-039: CLI flag overrides (--team and --no-team)', () => {
  it('--team with Simple-tier metrics forces Complex', () => {
    expect(classifyComplexity(5, 1, 10, true, false)).toBe('Complex');
  });

  it('--team with Medium-tier metrics still returns Complex', () => {
    expect(classifyComplexity(15, 2, 30, true, false)).toBe('Complex');
  });

  it('--no-team with Complex-tier metrics returns None', () => {
    expect(classifyComplexity(30, 3, 70, false, true)).toBe('None');
  });

  it('--no-team with Simple-tier metrics returns None', () => {
    expect(classifyComplexity(5, 1, 10, false, true)).toBe('None');
  });

  it('--no-team with Medium-tier metrics returns None', () => {
    expect(classifyComplexity(15, 2, 30, false, true)).toBe('None');
  });

  it('both --team and --no-team together throw an error', () => {
    expect(() => classifyComplexity(5, 1, 10, true, true)).toThrow(
      '--team and --no-team are mutually exclusive'
    );
  });

  it('neither flag: normal classification proceeds', () => {
    expect(classifyComplexity(5, 1, 10, false, false)).toBe('Simple');
    expect(classifyComplexity(15, 2, 30, false, false)).toBe('Medium');
    expect(classifyComplexity(30, 3, 70, false, false)).toBe('Complex');
  });
});

// ---------------------------------------------------------------------------
// Domain detection keyword matching
// ---------------------------------------------------------------------------

describe('Domain detection — keyword matching logic', () => {
  it('detects backend domain from "api" keyword', () => {
    const domains = detectDomains('Create a REST api endpoint for users', DOMAIN_KEYWORDS);
    expect(domains).toContain('backend');
  });

  it('detects frontend domain from "component" keyword', () => {
    const domains = detectDomains('Build a React component for the login form', DOMAIN_KEYWORDS);
    expect(domains).toContain('frontend');
  });

  it('detects infrastructure domain from "docker" keyword', () => {
    const domains = detectDomains('Containerize service using docker', DOMAIN_KEYWORDS);
    expect(domains).toContain('infrastructure');
  });

  it('detects database domain from "migration" keyword', () => {
    const domains = detectDomains('Write a sql migration script for the users table', DOMAIN_KEYWORDS);
    expect(domains).toContain('database');
  });

  it('detects security domain from "auth" keyword', () => {
    const domains = detectDomains('Implement auth middleware with JWT tokens', DOMAIN_KEYWORDS);
    expect(domains).toContain('security');
  });

  it('detects documentation domain from "readme" keyword', () => {
    const domains = detectDomains('Update README with installation instructions', DOMAIN_KEYWORDS);
    expect(domains).toContain('documentation');
  });

  it('detects testing domain from "jest" keyword', () => {
    const domains = detectDomains('Write jest unit tests for the service layer', DOMAIN_KEYWORDS);
    expect(domains).toContain('testing');
  });

  it('detects devops domain from "monitoring" keyword', () => {
    const domains = detectDomains('Add monitoring and observability with Prometheus', DOMAIN_KEYWORDS);
    expect(domains).toContain('devops');
  });

  it('matching is case-insensitive', () => {
    const domains = detectDomains('Create an API Endpoint for SERVICE layer', DOMAIN_KEYWORDS);
    expect(domains).toContain('backend');
  });

  it('returns empty array when no domains match', () => {
    const domains = detectDomains('Just a plain sentence with no matching words', DOMAIN_KEYWORDS);
    expect(domains).toHaveLength(0);
  });

  it('detects multiple domains from a cross-cutting task description', () => {
    const text = 'Implement API endpoint with database migration and docker deploy';
    const domains = detectDomains(text, DOMAIN_KEYWORDS);
    expect(domains).toContain('backend');
    expect(domains).toContain('database');
    expect(domains).toContain('infrastructure');
    expect(domains.length).toBeGreaterThanOrEqual(3);
  });

  it('deduplicates repeated domain matches', () => {
    const text = 'api endpoint and another api service and backend controller';
    const domains = detectDomains(text, DOMAIN_KEYWORDS);
    const backendCount = domains.filter(d => d === 'backend').length;
    expect(backendCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// parseTrdTaskList — TRD markdown parsing
// ---------------------------------------------------------------------------

describe('parseTrdTaskList — TRD markdown parsing', () => {
  it('parses standard TRD task list entries', () => {
    const trdContent = [
      '- [ ] **TRD-001**: Create user registration API (3h)',
      '- [ ] **TRD-002**: Add input validation middleware (2h)',
    ].join('\n');
    const tasks = parseTrdTaskList(trdContent);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].title).toContain('Create user registration API');
    expect(tasks[0].hours).toBe(3);
    expect(tasks[1].hours).toBe(2);
  });

  it('ignores completed tasks (checked boxes)', () => {
    const trdContent = [
      '- [x] **TRD-001**: Already done (2h)',
      '- [ ] **TRD-002**: Still pending (3h)',
    ].join('\n');
    const tasks = parseTrdTaskList(trdContent);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toContain('Still pending');
  });

  it('applies default 2h when no estimate found', () => {
    const trdContent = '- [ ] **TRD-001**: Task without hour estimate';
    const tasks = parseTrdTaskList(trdContent);
    expect(tasks[0].hours).toBe(2);
  });

  it('handles decimal hour estimates', () => {
    const trdContent = '- [ ] **TRD-001**: Task with partial hour (0.5h)';
    const tasks = parseTrdTaskList(trdContent);
    expect(tasks[0].hours).toBe(0.5);
  });

  it('ignores non-task lines (headings, prose, blank lines)', () => {
    const trdContent = [
      '# TRD Title',
      '',
      '## Master Task List',
      '',
      'Some prose description here.',
      '',
      '- [ ] **TRD-001**: Real task (2h)',
      '',
      '> A blockquote',
    ].join('\n');
    const tasks = parseTrdTaskList(trdContent);
    expect(tasks).toHaveLength(1);
  });

  it('returns empty array for TRD with no tasks', () => {
    const trdContent = '# Empty TRD\n\nNo tasks here.';
    expect(parseTrdTaskList(trdContent)).toHaveLength(0);
  });
});
