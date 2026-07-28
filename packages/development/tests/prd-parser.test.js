'use strict';

const { extractPrdContext } = require('../lib/prd-parser');

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
