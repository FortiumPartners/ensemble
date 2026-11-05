'use strict';

const { extractPrdContext, extractReqPriorities } = require('../lib/prd-parser');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MINIMAL_PRD = `
# REQ-001 — HTTP command ingress

The system MUST accept commands via HTTP POST to a Phoenix endpoint.

**AC-001-1:** Given a valid JSON command payload, When the POST request is received at \`/api/commands\`, Then the system dispatches the command to the CommandRouter and returns a 202 response.

**AC-001-2:** Given an invalid JSON payload, When the POST request is received, Then the system returns a 400 response with an error message.

# REQ-002 — Event persistence

All domain events MUST be persisted to the event store before acknowledgement.

**AC-002-1:** Given a validated command, When the aggregate processes the command, Then the resulting events are appended to the event store stream before the response is returned.
`.trim();

const PRD_WITH_INFRA = `
# INFRA-001 — Database schema

Infrastructure requirements for the persistence layer.

# REQ-003 — Projection rebuild

Projection handlers MUST rebuild their read models from the event store on startup.

**AC-003-1:** Given a projection handler that has no stored checkpoint, When it starts, Then it replays all events from the beginning of the stream.
`.trim();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractPrdContext', () => {
  test('returns empty context for empty/null input', () => {
    expect(extractPrdContext('')).toEqual({ requirements: {}, acs: {} });
    expect(extractPrdContext(null)).toEqual({ requirements: {}, acs: {} });
    expect(extractPrdContext(undefined)).toEqual({ requirements: {}, acs: {} });
  });

  test('parses REQ-NNN requirements with title', () => {
    const ctx = extractPrdContext(MINIMAL_PRD);
    expect(ctx.requirements['REQ-001']).toBeDefined();
    expect(ctx.requirements['REQ-001'].id).toBe('REQ-001');
    expect(ctx.requirements['REQ-001'].title).toBe('HTTP command ingress');
    expect(ctx.requirements['REQ-001'].text).toContain('MUST accept commands via HTTP POST');
  });

  test('parses AC-NNN-N acceptance criteria with Given/When/Then', () => {
    const ctx = extractPrdContext(MINIMAL_PRD);
    expect(ctx.acs['AC-001-1']).toBeDefined();
    expect(ctx.acs['AC-001-1'].reqId).toBe('REQ-001');
    expect(ctx.acs['AC-001-1'].given).toBe('a valid JSON command payload');
    expect(ctx.acs['AC-001-1'].when).toBe('the POST request is received at `/api/commands`');
    expect(ctx.acs['AC-001-1'].then).toBe('the system dispatches the command to the CommandRouter and returns a 202 response');
  });

  test('collects acIds in requirement entry in document order', () => {
    const ctx = extractPrdContext(MINIMAL_PRD);
    expect(ctx.requirements['REQ-001'].acIds).toEqual(['AC-001-1', 'AC-001-2']);
  });

  test('parses multiple requirements', () => {
    const ctx = extractPrdContext(MINIMAL_PRD);
    expect(ctx.requirements['REQ-002']).toBeDefined();
    expect(ctx.requirements['REQ-002'].acIds).toEqual(['AC-002-1']);
  });

  test('acEntry.text contains full Given/When/Then prose', () => {
    const ctx = extractPrdContext(MINIMAL_PRD);
    expect(ctx.acs['AC-001-1'].text).toContain('Given');
    expect(ctx.acs['AC-001-1'].text).toContain('When');
    expect(ctx.acs['AC-001-1'].text).toContain('Then');
  });

  test('handles INFRA/ARCH non-PRD tokens without crashing', () => {
    const ctx = extractPrdContext(PRD_WITH_INFRA);
    expect(ctx.requirements['REQ-003']).toBeDefined();
    expect(ctx.requirements['INFRA-001']).toBeUndefined();
  });

  test('requirement text strips markdown formatting', () => {
    const ctx = extractPrdContext(MINIMAL_PRD);
    // Bold markers should be stripped from text
    expect(ctx.requirements['REQ-001'].text).not.toContain('**');
  });

  test('ac.given/when/then handles missing parts gracefully', () => {
    const partial = `
# REQ-99 — Partial AC

**AC-99-1:** Given a thing, Then it should happen.
`;
    const ctx = extractPrdContext(partial);
    expect(ctx.acs['AC-99-1'].given).toBe('a thing');
    expect(ctx.acs['AC-99-1'].when).toBe('');
    expect(ctx.acs['AC-99-1'].then).toBe('it should happen');
  });

  test('requirement and ac ids are normalized to uppercase', () => {
    const ctx = extractPrdContext(MINIMAL_PRD);
    // IDs are stored uppercase regardless of input case
    expect(ctx.requirements['REQ-001']).toBeDefined();
    expect(ctx.acs['AC-001-1']).toBeDefined();
    // Lowercase variants are not stored
    expect(ctx.requirements['req-001']).toBeUndefined();
    expect(ctx.acs['ac-001-1']).toBeUndefined();
  });
});

describe('extractReqPriorities', () => {
  const REAL_WORLD_PRD = `
### REQ-011: Dependency Source Priority

**Priority:** Must | **Complexity:** Medium | [RISK: existing Beads graph may diverge]

#### REQ-012: Something Should-priority

**Priority:** Should | **Complexity:** Low

#### REQ-013: No priority line at all

Just prose, no Priority line here.

### REQ-014: Won't-priority variant

**Priority:** Won't | **Complexity:** Low
`.trim();

  test('returns empty array for empty/null input', () => {
    expect(extractReqPriorities('')).toEqual([]);
    expect(extractReqPriorities(null)).toEqual([]);
    expect(extractReqPriorities(undefined)).toEqual([]);
  });

  test('matches H3/H4 "### REQ-NNN:" heading style with colon separator', () => {
    const reqs = extractReqPriorities(REAL_WORLD_PRD);
    const ids = reqs.map((r) => r.id);
    expect(ids).toEqual(['REQ-011', 'REQ-012', 'REQ-013', 'REQ-014']);
  });

  test('reads Must/Should priority from a dedicated **Priority:** line', () => {
    const reqs = extractReqPriorities(REAL_WORLD_PRD);
    const byId = Object.fromEntries(reqs.map((r) => [r.id, r.priority]));
    expect(byId['REQ-011']).toBe('Must');
    expect(byId['REQ-012']).toBe('Should');
  });

  test('a REQ with no Priority line resolves to null', () => {
    const reqs = extractReqPriorities(REAL_WORLD_PRD);
    const byId = Object.fromEntries(reqs.map((r) => [r.id, r.priority]));
    expect(byId['REQ-013']).toBeNull();
  });

  test("normalizes Won't/Wont variants to \"Won't\"", () => {
    const reqs = extractReqPriorities(REAL_WORLD_PRD);
    const byId = Object.fromEntries(reqs.map((r) => [r.id, r.priority]));
    expect(byId['REQ-014']).toBe("Won't");
  });

  test('does not match the legacy "# REQ-NNN — Title" em-dash heading style', () => {
    const reqs = extractReqPriorities(MINIMAL_PRD);
    expect(reqs).toEqual([]);
  });

  // Regression: beads:ensemble:br-mvaw. MoSCoW priority inline in the heading
  // (the shape create-trd emits, and the one
  // docs/PRD/PRD-2026-82b6a138-pr-review-cycle-time.md uses for all 25 REQs)
  // resolved to priority: null, so completion-verification Step 3's
  // Must/Should gate was vacuous and the skill reported a clean 0-gap pass.
  const INLINE_TAG_PRD = `
### REQ-001: One shared review procedure (Must)

Body prose.

### REQ-010: Explicit overrides never relabel (Should)

Body prose.

#### REQ-017: Truthful completion messaging (Must) [RISK: weakens a human checkpoint, so the record must be unambiguous]

Body prose.

### REQ-018: Delivered in phases [Could]

Body prose.

### REQ-019: Deferred work (Wont)

Body prose.

### REQ-020: No tag at all

Body prose.
`.trim();

  test('reads a MoSCoW priority written inline as "(Must)" at the end of the heading', () => {
    const byId = Object.fromEntries(extractReqPriorities(INLINE_TAG_PRD).map((r) => [r.id, r.priority]));
    expect(byId['REQ-001']).toBe('Must');
  });

  test('reads "(Should)" and bracketed "[Could]" inline tags', () => {
    const byId = Object.fromEntries(extractReqPriorities(INLINE_TAG_PRD).map((r) => [r.id, r.priority]));
    expect(byId['REQ-010']).toBe('Should');
    expect(byId['REQ-018']).toBe('Could');
  });

  test('reads an inline tag when a "[RISK: ...]" suffix follows it', () => {
    const byId = Object.fromEntries(extractReqPriorities(INLINE_TAG_PRD).map((r) => [r.id, r.priority]));
    expect(byId['REQ-017']).toBe('Must');
  });

  test("normalizes the unapostrophised inline tag '(Wont)' to \"Won't\"", () => {
    const byId = Object.fromEntries(extractReqPriorities(INLINE_TAG_PRD).map((r) => [r.id, r.priority]));
    expect(byId['REQ-019']).toBe("Won't");
  });

  test('canonicalizes a lower/upper-case priority tag to the documented spelling', () => {
    const prd = [
      '### REQ-001: Lowercase tag (must)',
      '### REQ-002: Uppercase tag [SHOULD]',
      "### REQ-003: Mixed case (Won'T)",
      '### REQ-004: Could (COULD)',
    ].join('\n');
    const byId = Object.fromEntries(extractReqPriorities(prd).map((r) => [r.id, r.priority]));
    expect(byId['REQ-001']).toBe('Must');
    expect(byId['REQ-002']).toBe('Should');
    expect(byId['REQ-003']).toBe("Won't");
    expect(byId['REQ-004']).toBe('Could');
  });

  test('a heading with neither an inline tag nor a Priority line still resolves to null', () => {
    const byId = Object.fromEntries(extractReqPriorities(INLINE_TAG_PRD).map((r) => [r.id, r.priority]));
    expect(byId['REQ-020']).toBeNull();
  });

  test('does not misread a title word or an FR ref as a priority tag', () => {
    const prd = [
      '### REQ-001: Completion contract must be truthful (Must)',
      '### REQ-002: What the reviewer must say',
      '### REQ-003: Message should arrive',
      '### REQ-004: The Must have list',
      '### REQ-005: Titles ending in won\'t',
      '#### REQ-006 (FR1.1): Dashboard spawns in terminal',
    ].join('\n');
    const reqs = extractReqPriorities(prd);
    const byId = Object.fromEntries(reqs.map((r) => [r.id, r.priority]));
    expect(reqs.map((r) => r.id)).toEqual(['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004', 'REQ-005', 'REQ-006']);
    expect(byId['REQ-001']).toBe('Must');
    expect(['REQ-002', 'REQ-003', 'REQ-004', 'REQ-005', 'REQ-006'].every((id) => byId[id] === null)).toBe(true);
  });

  test('a dedicated **Priority:** line still works when the heading has no tag', () => {
    const prd = ['### REQ-001: Inline only (Must)', '', 'Prose.', '', '### REQ-002: Line only', '', '**Priority:** Should | **Complexity:** Low'].join('\n');
    const byId = Object.fromEntries(extractReqPriorities(prd).map((r) => [r.id, r.priority]));
    expect(byId['REQ-001']).toBe('Must');
    expect(byId['REQ-002']).toBe('Should');
  });

  test('the inline-tag PRD in docs/PRD resolves every REQ to a gatable priority', () => {
    // The reported failing case end to end: pre-fix this returned 25 entries,
    // all null. Step 3 is only a real gate while the filter is non-empty.
    const fs = require('fs');
    const path = require('path');
    const prdPath = path.join(__dirname, '..', '..', '..', 'docs', 'PRD', 'PRD-2026-82b6a138-pr-review-cycle-time.md');
    const reqs = extractReqPriorities(fs.readFileSync(prdPath, 'utf8'));
    expect(reqs.length).toBeGreaterThan(0);
    expect(reqs.every((r) => r.priority === 'Must' || r.priority === 'Should')).toBe(true);
    expect(reqs.find((r) => r.id === 'REQ-001').priority).toBe('Must');
    expect(reqs.find((r) => r.id === 'REQ-010').priority).toBe('Should');
  });
});
