/**
 * Customer overview + approval endpoints.
 *
 * `/api/overview` serves the plain-language view behind the Overview tab
 * (authored summary first, markdown derivation as fallback). `/api/approval`
 * records the customer's decision on the concept and must serialize through the
 * same revision-checked path as question/comment writes, so the decision rides
 * the SSE broadcast and lands in the completion artifact.
 *
 * Runs as a suite of its own (same helpers as server.test.js, redefined here)
 * so `jest <file>` picks up exactly one describe tree.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const sessionLib = require('../../lib/refinement-review/session');
const { startServer } = require('../../lib/refinement-review/server');

const SAMPLE_MD = [
  '# Sample PRD',
  '',
  '## Overview',
  '',
  'Intro paragraph for testing.',
  '',
  '### Acceptance Criteria',
  '',
  '- criterion A',
  '',
  '## Open Questions',
  '',
].join('\n');

let tmp;
const activeServers = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-approval-'));
});

afterEach(async () => {
  while (activeServers.length > 0) {
    const s = activeServers.pop();
    try {
      await s.stop();
    } catch (_) {
      /* already closed */
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeSource(content = SAMPLE_MD, name = 'doc.md') {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
}

function writeUi() {
  const dir = path.join(tmp, 'ui');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>x</title>');
  fs.writeFileSync(path.join(dir, 'app.js'), 'console.log(1)');
  return dir;
}

/**
 * Boot a server over a fresh session. `options.source` overrides the document,
 * `options.customerSummary` authors the customer view up front.
 */
async function setup(options = {}) {
  const source = writeSource(options.source || SAMPLE_MD, options.sourceName || 'doc.md');
  const sessionPath = path.join(tmp, 'session.json');
  const { session, token } = sessionLib.createSession({
    sessionPath,
    kind: options.kind || 'prd',
    sourcePath: source,
    questions: options.questions || [{ id: 'q1', prompt: 'First?' }],
    customerSummary: options.customerSummary,
  });
  const server = await startServer({
    sessionPath,
    token,
    uiDir: writeUi(),
    log: () => {},
    logError: () => {},
  });
  activeServers.push(server);
  return { source, sessionPath, token, session, server };
}

function request(server, method, route, { token, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: server.host,
        port: server.port,
        method,
        path: route,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (_) {
            /* non-json response */
          }
          resolve({ status: res.statusCode, text, json });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    req.end(body !== undefined ? JSON.stringify(body) : undefined);
  });
}

/** Revision currently recorded in the session (drives well-formed requests). */
async function revisionOf(ctx) {
  const sess = await request(ctx.server, 'GET', '/api/session', { token: ctx.token });
  return sess.json.revision;
}

/** Collect `session` events emitted while `action` runs. */
async function sseDuring(ctx, action) {
  const events = [];
  let done = false;
  let sseReq;
  const streamOpened = new Promise((resolve, reject) => {
    sseReq = http.request(
      {
        hostname: ctx.server.host,
        port: ctx.server.port,
        method: 'GET',
        path: `/api/events?token=${encodeURIComponent(ctx.token)}`,
        headers: { accept: 'text/event-stream' },
      },
      (res) => {
        res.setEncoding('utf8');
        let buf = '';
        res.on('data', (chunk) => {
          buf += chunk;
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            let event = 'message';
            let data = '';
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('data:')) data += line.slice(5).trim();
            }
            if (event === 'session' && data) {
              try {
                events.push(JSON.parse(data));
              } catch (_) {
                /* ignore */
              }
            }
          }
        });
        resolve();
      },
    );
    sseReq.on('error', (err) => {
      if (!done) reject(err);
    });
    sseReq.end();
  });
  await streamOpened;
  await action();
  await new Promise((r) => setTimeout(r, 120));
  done = true;
  sseReq.destroy();
  return events;
}

describe('GET /api/overview', () => {
  test('serves the authored summary verbatim when present', async () => {
    const authored = '## What we are building\n\nA calmer billing flow.';
    const ctx = await setup({ customerSummary: authored });
    const res = await request(ctx.server, 'GET', '/api/overview', { token: ctx.token });
    expect(res.status).toBe(200);
    expect(res.json.source).toBe('authored');
    expect(res.json.title).toBe('PRD overview');
    expect(res.json.markdown).toBe(authored);
  });

  test('prefers authored text added mid-session over derivation', async () => {
    const ctx = await setup();
    const before = await request(ctx.server, 'GET', '/api/overview', { token: ctx.token });
    expect(before.json.source).toBe('derived');

    const rev = await revisionOf(ctx);
    sessionLib.mutateSession({
      sessionPath: ctx.sessionPath,
      actor: 'reviewer',
      expectedRevision: rev,
      mutate: (s) => {
        s.document.customerSummary = 'Authored later in the session.';
      },
    });

    const after = await request(ctx.server, 'GET', '/api/overview', { token: ctx.token });
    expect(after.json.source).toBe('authored');
    expect(after.json.markdown).toBe('Authored later in the session.');
  });

  test('derives a plain-language view when no summary was authored', async () => {
    const ctx = await setup();
    const res = await request(ctx.server, 'GET', '/api/overview', { token: ctx.token });
    expect(res.status).toBe(200);
    expect(res.json.source).toBe('derived');
    expect(res.json.title).toBe('Sample PRD');
    expect(res.json.markdown).toContain('Intro paragraph for testing');
    expect(res.json.markdown).toContain('Refinement tab');
  });

  test('reports empty when the document has no customer-facing section', async () => {
    const ctx = await setup({
      kind: 'trd',
      source: '# Bare TRD\n\n## Architecture\n\nUse Postgres for storage.\n',
    });
    const res = await request(ctx.server, 'GET', '/api/overview', { token: ctx.token });
    expect(res.status).toBe(200);
    expect(res.json.source).toBe('empty');
    expect(res.json.markdown).toBe('');
  });

  test('requires the bearer token', async () => {
    const ctx = await setup();
    const res = await request(ctx.server, 'GET', '/api/overview', {});
    expect(res.status).toBe(401);
  });
});

describe('POST /api/approval', () => {
  test('records an approval and advances the revision', async () => {
    const ctx = await setup();
    const res = await request(ctx.server, 'POST', '/api/approval', {
      token: ctx.token,
      body: { revision: 1, author: 'Cust', decision: 'approved' },
    });
    expect(res.status).toBe(200);
    expect(res.json.approval.decision).toBe('approved');
    expect(res.json.approval.author).toBe('Cust');
    expect(res.json.approval.note).toBeNull();
    expect(typeof res.json.approval.decidedAt).toBe('string');
    expect(res.json.revision).toBe(2);

    const sess = await request(ctx.server, 'GET', '/api/session', { token: ctx.token });
    expect(sess.json.approval.decision).toBe('approved');
    expect(sess.json.approval.decidedAt).toBe(res.json.approval.decidedAt);
  });

  test('stores the note for a changes-requested decision', async () => {
    const ctx = await setup();
    const res = await request(ctx.server, 'POST', '/api/approval', {
      token: ctx.token,
      body: {
        revision: 1,
        author: 'Cust',
        decision: 'changes-requested',
        note: 'Scope is too broad for phase one.',
      },
    });
    expect(res.status).toBe(200);
    expect(res.json.approval.decision).toBe('changes-requested');
    expect(res.json.approval.note).toBe('Scope is too broad for phase one.');
  });

  test('requires a note when requesting changes', async () => {
    const ctx = await setup();
    for (const note of [undefined, null, '', '   ']) {
      const rev = await revisionOf(ctx);
      const res = await request(ctx.server, 'POST', '/api/approval', {
        token: ctx.token,
        body: { revision: rev, author: 'Cust', decision: 'changes-requested', note },
      });
      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/note required/);
    }
    const sess = await request(ctx.server, 'GET', '/api/session', { token: ctx.token });
    expect(sess.json.approval ?? undefined).toBeUndefined();
    expect(sess.json.revision).toBe(1);
  });

  test('rejects an unknown decision', async () => {
    const ctx = await setup();
    const res = await request(ctx.server, 'POST', '/api/approval', {
      token: ctx.token,
      body: { revision: 1, author: 'Cust', decision: 'LGTM' },
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/decision/);
  });

  test('rejects a missing or blank author', async () => {
    const ctx = await setup();
    for (const author of [undefined, '', '   ', 42]) {
      const rev = await revisionOf(ctx);
      const res = await request(ctx.server, 'POST', '/api/approval', {
        token: ctx.token,
        body: { revision: rev, author, decision: 'approved' },
      });
      expect(res.status).toBe(400);
      expect(res.json.error).toMatch(/author/);
    }
  });

  test('rejects a non-string note', async () => {
    const ctx = await setup();
    const res = await request(ctx.server, 'POST', '/api/approval', {
      token: ctx.token,
      body: { revision: 1, author: 'Cust', decision: 'approved', note: 7 },
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/note/);
  });

  test('conflicts on a stale revision and reports the current one', async () => {
    const ctx = await setup();
    const first = await request(ctx.server, 'POST', '/api/approval', {
      token: ctx.token,
      body: { revision: 1, author: 'Cust', decision: 'approved' },
    });
    expect(first.status).toBe(200);
    const stale = await request(ctx.server, 'POST', '/api/approval', {
      token: ctx.token,
      body: { revision: 1, author: 'Cust', decision: 'changes-requested', note: 'nope' },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe('REVISION_CONFLICT');
    expect(stale.json.currentRevision).toBe(2);
  });

  test('last writer wins when the decision changes', async () => {
    const ctx = await setup();
    const first = await request(ctx.server, 'POST', '/api/approval', {
      token: ctx.token,
      body: { revision: 1, author: 'Cust', decision: 'approved' },
    });
    const res = await request(ctx.server, 'POST', '/api/approval', {
      token: ctx.token,
      body: {
        revision: first.json.revision,
        author: 'Cust',
        decision: 'changes-requested',
        note: 'Changed my mind; pricing is unclear.',
      },
    });
    expect(res.status).toBe(200);
    expect(res.json.approval.decision).toBe('changes-requested');
    expect(res.json.approval.note).toContain('Changed my mind');
  });

  test('rejects malformed json', async () => {
    const ctx = await setup();
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: ctx.server.host,
          port: ctx.server.port,
          method: 'POST',
          path: '/api/approval',
          headers: { authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' },
        },
        (r) => {
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () =>
            resolve({ status: r.statusCode, text: Buffer.concat(chunks).toString('utf8') }),
          );
        },
      );
      req.on('error', reject);
      req.end('{not json');
    });
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/invalid json/);
  });

  test('requires the bearer token', async () => {
    const ctx = await setup();
    const res = await request(ctx.server, 'POST', '/api/approval', {
      body: { revision: 1, author: 'Cust', decision: 'approved' },
    });
    expect(res.status).toBe(401);
  });

  test('rejects writes once the session is completed', async () => {
    const ctx = await setup();
    await request(ctx.server, 'POST', '/api/complete', {
      token: ctx.token,
      body: { revision: 1, author: 'pm' },
    });
    const res = await request(ctx.server, 'POST', '/api/approval', {
      token: ctx.token,
      body: { revision: 2, author: 'Cust', decision: 'approved' },
    });
    expect(res.status).toBe(410);
  });

  test('broadcasts the decision over SSE', async () => {
    const ctx = await setup();
    const events = await sseDuring(ctx, async () => {
      await request(ctx.server, 'POST', '/api/approval', {
        token: ctx.token,
        body: { revision: 1, author: 'Cust', decision: 'approved' },
      });
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].approval.decision).toBe('approved');
  });
});

describe('approval in the completion artifact', () => {
  test('carries the recorded decision into the artifact', async () => {
    const ctx = await setup();
    const approval = await request(ctx.server, 'POST', '/api/approval', {
      token: ctx.token,
      body: {
        revision: 1,
        author: 'Cust',
        decision: 'changes-requested',
        note: 'Drop the multi-currency phase.',
      },
    });
    expect(approval.status).toBe(200);
    const complete = await request(ctx.server, 'POST', '/api/complete', {
      token: ctx.token,
      body: { revision: approval.json.revision, author: 'pm' },
    });
    expect(complete.status).toBe(200);
    const artifact = JSON.parse(fs.readFileSync(complete.json.artifactPath, 'utf8'));
    expect(artifact.approval.decision).toBe('changes-requested');
    expect(artifact.approval.author).toBe('Cust');
    expect(artifact.approval.note).toBe('Drop the multi-currency phase.');
  });

  test('completes with approval null when no decision was recorded', async () => {
    const ctx = await setup();
    const complete = await request(ctx.server, 'POST', '/api/complete', {
      token: ctx.token,
      body: { revision: 1, author: 'pm' },
    });
    expect(complete.status).toBe(200);
    const artifact = JSON.parse(fs.readFileSync(complete.json.artifactPath, 'utf8'));
    expect(artifact.approval).toBeNull();
  });
});
