/**
 * Tests for the refinement-review server module.
 *
 * Uses real Node http clients (not supertest) so behavior is observed at
 * the same boundary the browser UI would see.
 */
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const sessionLib = require('../../lib/refinement-review/session');
const serverMod = require('../../lib/refinement-review/server');
const { startServer, _internal } = serverMod;

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
  '- criterion B',
  '',
  '## Open Questions',
  '',
].join('\n');

let tmp;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-server-'));
});
afterEach(async () => {
  // Tear down every server created in this test so Jest can exit cleanly.
  // Each test calls setupServer() which returns a fresh server; without this
  // hook the suite leaks a TCP listener per test (Jest warns "did not exit").
  while (activeServers.length > 0) {
    const s = activeServers.pop();
    try { await s.stop(); } catch (_) { /* already closed */ }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeSource(content = SAMPLE_MD) {
  const p = path.join(tmp, 'doc.md');
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

// Module-scoped list of servers awaiting teardown. Populated by setupServer
// and drained by the global afterEach above.
const activeServers = [];

async function setupServer(extra = {}) {
  const source = writeSource();
  const sessionPath = extra.sessionPath || path.join(tmp, 'session.json');
  const { session, token } = sessionLib.createSession({
    sessionPath,
    kind: 'prd',
    sourcePath: source,
    questions: [{ id: 'q1', prompt: 'First?' }, { id: 'q2', prompt: 'Second?' }],
  });
  const uiDir = extra.uiDir !== false ? writeUi() : null;
  const server = await startServer({
    sessionPath,
    token,
    uiDir,
    log: () => {},
    logError: () => {},
    ...extra,
  });
  activeServers.push(server);
  return { source, sessionPath, token, session, server, uiDir };
}

function request(server, method, path, { token, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: server.host,
        port: server.port,
        method,
        path,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const text = buf.toString('utf8');
          let json = null;
          const ct = (res.headers['content-type'] || '').toLowerCase();
          if (ct.includes('application/json')) {
            try {
              json = JSON.parse(text);
            } catch (_) {
              /* leave null */
            }
          }
          resolve({ status: res.statusCode, headers: res.headers, body: buf, text, json });
        });
        res.on('error', reject);
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

describe('auth', () => {
  test('rejects missing token with 401', async () => {
    const { server } = await setupServer();
    const r = await request(server, 'GET', '/api/session');
    expect(r.status).toBe(401);
  });

  test('rejects wrong token with 401', async () => {
    const { server } = await setupServer();
    const r = await request(server, 'GET', '/api/session', { token: 'wrong' });
    expect(r.status).toBe(401);
  });

  test('accepts query token for SSE (event source cannot set headers)', async () => {
    const { server, token } = await setupServer();
    // The SSE endpoint is GET /api/events; we just check that token-in-query
    // is accepted (the connection itself is long-lived; verify 200 not 401).
    const r = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          hostname: server.host,
          port: server.port,
          method: 'GET',
          path: `/api/events?token=${encodeURIComponent(token)}`,
          headers: { accept: 'text/event-stream' },
        },
        (res) => {
          resolve({ status: res.statusCode });
          res.on('data', () => {});
          req.destroy();
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(r.status).toBe(200);
  });
});

describe('auth hardening — Referrer-Policy on every response', () => {
  test('401 on API surfaces Referrer-Policy: no-referrer', async () => {
    const { server } = await setupServer();
    const r = await request(server, 'GET', '/api/session');
    expect(r.status).toBe(401);
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });

  test('404 on API surfaces Referrer-Policy: no-referrer', async () => {
    const { server, token } = await setupServer();
    const r = await request(server, 'GET', '/api/does-not-exist', { token });
    expect(r.status).toBe(404);
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });

  test('200 JSON surfaces Referrer-Policy: no-referrer', async () => {
    const { server, token } = await setupServer();
    const r = await request(server, 'GET', '/api/session', { token });
    expect(r.status).toBe(200);
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });

  test('static UI surfaces Referrer-Policy: no-referrer', async () => {
    const { server } = await setupServer();
    const r = await request(server, 'GET', '/');
    expect(r.status).toBe(200);
    expect(r.headers['referrer-policy']).toBe('no-referrer');
  });
});

describe('auth hardening — /api/exchange atomic nonce burn', () => {
  test('valid nonce → 302 to / with review-sid cookie', async () => {
    const { server, sessionPath } = await setupServer();
    const { _internal } = require('../../lib/refinement-review/server');
    const id = _internal.mintNonce({
      sessionPath,
      permissions: 'reviewer',
      sessionExpiresAt: Date.now() + 60000,
    });
    const r = await request(server, 'GET', `/api/exchange?nonce=${id}`);
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe('/');
    const setCookie = r.headers['set-cookie'] || [];
    expect(setCookie.length).toBeGreaterThan(0);
    const cookie = setCookie[0];
    expect(cookie.startsWith('review-sid=')).toBe(true);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Domain=/);
    expect(cookie).toMatch(/Max-Age=\d+/);
  });

  test('two concurrent burns: one 302, one 401', async () => {
    const { server, sessionPath } = await setupServer();
    const { _internal } = require('../../lib/refinement-review/server');
    const id = _internal.mintNonce({
      sessionPath,
      permissions: 'reviewer',
      sessionExpiresAt: Date.now() + 60000,
    });
    const fire = () =>
      new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: server.host,
            port: server.port,
            method: 'GET',
            path: `/api/exchange?nonce=${id}`,
          },
          (res) => resolve({ status: res.statusCode, headers: res.headers }),
        );
        req.on('error', reject);
        req.end();
      });
    const [a, b] = await Promise.all([fire(), fire()]);
    const codes = [a.status, b.status].sort();
    expect(codes).toEqual([302, 401]);
  });

  test('nonce probe with wrong ID does not mutate the map', async () => {
    const { server, sessionPath } = await setupServer();
    const { _internal } = require('../../lib/refinement-review/server');
    // Mint a VALID nonce, then probe with a DIFFERENT (wrong) id, then
    // assert the valid nonce still resolves. peekNonce('does-not-exist')
    // would be tautological; this checks a real map mutation guard.
    const goodId = _internal.mintNonce({
      sessionPath,
      permissions: 'reviewer',
      sessionExpiresAt: Date.now() + 60000,
    });
    const r = await request(server, 'GET', '/api/exchange?nonce=does-not-exist');
    expect(r.status).toBe(401);
    expect(_internal.peekNonce(goodId)).not.toBeNull();
    expect(_internal.peekNonce('does-not-exist')).toBeNull();
    // The good nonce still burns successfully — proving no global mutation
    // happened on the failed probe.
    const r2 = await request(server, 'GET', `/api/exchange?nonce=${goodId}`);
    expect(r2.status).toBe(302);
  });

});

describe('auth hardening — cookie > bearer > query', () => {
  test('cookie session ID authenticates independently of bearer token', async () => {
    const { server, sessionPath } = await setupServer();
    const { _internal } = require('../../lib/refinement-review/server');
    const id = _internal.mintNonce({
      sessionPath,
      permissions: 'reviewer',
      sessionExpiresAt: Date.now() + 60000,
    });
    const exchange = await request(server, 'GET', `/api/exchange?nonce=${id}`);
    expect(exchange.status).toBe(302);
    const sid = exchange.headers['set-cookie'][0].split(';')[0].split('=')[1];
    const r = await request(server, 'GET', '/api/session', {
      headers: { Cookie: `review-sid=${sid}` },
    });
    expect(r.status).toBe(200);
  });

  test('cookie beats bearer header when both are present', async () => {
    const { server, sessionPath } = await setupServer();
    const { _internal } = require('../../lib/refinement-review/server');
    const id = _internal.mintNonce({
      sessionPath,
      permissions: 'reviewer',
      sessionExpiresAt: Date.now() + 60000,
    });
    const exchange = await request(server, 'GET', `/api/exchange?nonce=${id}`);
    const sid = exchange.headers['set-cookie'][0].split(';')[0].split('=')[1];
    const r = await request(server, 'GET', '/api/session', {
      token: 'definitely-wrong-token',
      headers: { Cookie: `review-sid=${sid}` },
    });
    expect(r.status).toBe(200);
  });
  test('cookie bound to a different sessionPath is rejected', async () => {
    // Two servers, two distinct session files. The SID minted from server A
    // must NOT authenticate against server B because validateSession ties
    // records to opts.sessionPath.
    const otherTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-server-other-'));
    const otherSessionPath = path.join(otherTmp, 'session.json');
    const a = await setupServer();
    const { _internal } = require('../../lib/refinement-review/server');
    const id = _internal.mintNonce({
      sessionPath: a.sessionPath,
      permissions: 'reviewer',
      sessionExpiresAt: Date.now() + 60000,
    });
    const exchange = await request(a.server, 'GET', `/api/exchange?nonce=${id}`);
    const sid = exchange.headers['set-cookie'][0].split(';')[0].split('=')[1];
    const other = await setupServer({ sessionPath: otherSessionPath });
    const r = await request(other.server, 'GET', '/api/session', {
      headers: { Cookie: `review-sid=${sid}` },
    });
    expect(r.status).toBe(401);
    fs.rmSync(otherTmp, { recursive: true, force: true });
  });

  test('cookie session expiry is enforced', async () => {
    const { server, sessionPath } = await setupServer();
    const { _internal } = require('../../lib/refinement-review/server');
    const id = _internal.mintNonce({
      sessionPath,
      permissions: 'reviewer',
      sessionExpiresAt: Date.now() + 100,
    });
    const exchange = await request(server, 'GET', `/api/exchange?nonce=${id}`);
    expect(exchange.status).toBe(302);
    const sid = exchange.headers['set-cookie'][0].split(';')[0].split('=')[1];
    await new Promise((resolve) => setTimeout(resolve, 150));
    const r = await request(server, 'GET', '/api/session', {
      headers: { Cookie: `review-sid=${sid}` },
    });
    expect(r.status).toBe(401);
  });
});


describe('GET /api/session', () => {
  test('returns the envelope', async () => {
    const { server, token } = await setupServer();
    const r = await request(server, 'GET', '/api/session', { token });
    expect(r.status).toBe(200);
    expect(r.json.schemaVersion).toBe(1);
    expect(r.json.document.kind).toBe('prd');
    expect(r.json.questions).toHaveLength(2);
  });
});

describe('GET /api/document', () => {
  test('returns the markdown with ETag', async () => {
    const { server, token } = await setupServer();
    const r = await request(server, 'GET', '/api/document', { token });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/markdown/);
    expect(r.text).toBe(SAMPLE_MD);
    expect(r.headers.etag).toMatch(/^"[0-9a-f]{64}"$/);
  });

  test('honors If-None-Match → 304', async () => {
    const { server, token } = await setupServer();
    const first = await request(server, 'GET', '/api/document', { token });
    const etag = first.headers.etag;
    const second = await request(server, 'GET', '/api/document', {
      token,
      headers: { 'if-none-match': etag },
    });
    expect(second.status).toBe(304);
  });
});

describe('PATCH /api/questions/:id', () => {
  test('updates a question, bumps revision, returns envelope', async () => {
    const { server, token } = await setupServer();
    const r = await request(server, 'PATCH', '/api/questions/q1', {
      token,
      body: { revision: 1, status: 'answered', answer: 'A1', author: 'pm' },
    });
    expect(r.status).toBe(200);
    expect(r.json.revision).toBe(2);
    expect(r.json.questions[0].status).toBe('answered');
    expect(r.json.questions[0].answer).toBe('A1');
    expect(r.json.questions[0].author).toBe('pm');
  });

  test('rejects stale revision with 409', async () => {
    const { server, token } = await setupServer();
    const a = await request(server, 'PATCH', '/api/questions/q1', {
      token,
      body: { revision: 1, status: 'answered', answer: 'A1', author: 'pm' },
    });
    expect(a.status).toBe(200);
    const b = await request(server, 'PATCH', '/api/questions/q2', {
      token,
      body: { revision: 1, status: 'answered', answer: 'A2', author: 'pm' },
    });
    expect(b.status).toBe(409);
    expect(b.json.code).toBe('REVISION_CONFLICT');
    expect(b.json.currentRevision).toBe(2);
  });

  test('rejects unknown question with 404', async () => {
    const { server, token } = await setupServer();
    const r = await request(server, 'PATCH', '/api/questions/nope', {
      token,
      body: { revision: 1, status: 'answered', answer: 'x', author: 'pm' },
    });
    expect(r.status).toBe(404);
  });

  test('rejects invalid status with 400', async () => {
    const { server, token } = await setupServer();
    const r = await request(server, 'PATCH', '/api/questions/q1', {
      token,
      body: { revision: 1, status: 'bogus', answer: 'x', author: 'pm' },
    });
    expect(r.status).toBe(400);
  });
});

describe('POST /api/comments', () => {
  test('adds a comment, bumps revision', async () => {
    const { server, token } = await setupServer();
    const r = await request(server, 'POST', '/api/comments', {
      token,
      body: {
        revision: 1,
        body: 'Looks good',
        anchor: { section: '## Overview', lineStart: 1, lineEnd: 4, selectedText: '## Overview' },
        author: 'dev',
      },
    });
    expect(r.status).toBe(201);
    expect(r.json.revision).toBe(2);
    expect(r.json.comments).toHaveLength(1);
    expect(r.json.comments[0].body).toBe('Looks good');
  });

  test('rejects anchor with line out of bounds', async () => {
    const { server, token } = await setupServer();
    const r = await request(server, 'POST', '/api/comments', {
      token,
      body: {
        revision: 1,
        body: 'Bad',
        anchor: { section: null, lineStart: 9999, lineEnd: 9999, selectedText: null },
        author: 'dev',
      },
    });
    expect(r.status).toBe(400);
  });

  test('accepts null anchor (general comment)', async () => {
    const { server, token } = await setupServer();
    const r = await request(server, 'POST', '/api/comments', {
      token,
      body: { revision: 1, body: 'General', anchor: null, author: 'dev' },
    });
    expect(r.status).toBe(201);
    expect(r.json.comments[0].anchor).toBeNull();
  });
  // Regression: a comment anchored to a range that covers a markdown table
  // (header through last data row) must validate and persist. The earlier
  // round of tests only exercised heading-only ranges; the user-facing bug
  // surfaced when an NFR table review tried to anchor lines 457..469.
  test('accepts anchor whose lineEnd spans an entire table range', async () => {
    const TABLE_SOURCE = [
      '# PRD',                                  // line 1
      '',                                       // line 2
      '## NFR Section',                         // line 3
      '',                                       // line 4
      'Intro for NFRs.',                        // line 5
      '',                                       // line 6
      '| ID | Requirement | Target |',          // line 7  table header
      '|----|----|----|',                       // line 8  table separator
      '| NFR1.2 | Update latency | <500ms |',    // line 9
      '| NFR2.3 | State consistency | <5s |',    // line 10
      '| NFR3.1 | Audit log retention | 30d |', // line 11
    ].join('\n');

    const source = writeSource(TABLE_SOURCE);
    const sessionPath = path.join(tmp, 'session-table.json');
    const { token } = sessionLib.createSession({
      sessionPath,
      kind: 'prd',
      sourcePath: source,
      questions: [{ id: 'q-table', prompt: 'Verify NFR table range?' }],
    });
    const uiDir = writeUi();
    const server = await startServer({
      sessionPath,
      token,
      uiDir,
      log: () => {},
      logError: () => {},
    });

    // Anchor across the full 5-row table: lineStart at header, lineEnd at
    // last row. selectedText stays null because the range is multi-line.
    let r;
    try {
      r = await request(server, 'POST', '/api/comments', {
        token,
        body: {
          revision: 1,
          body: 'Verify NFR rows highlight together on nav',
          anchor: {
            section: '## NFR Section',
            lineStart: 7,
            lineEnd: 11,
            selectedText: null,
          },
          author: 'qa',
        },
      });
    } finally {
      await server.stop();
    }

    expect(r.status).toBe(201);
    expect(r.json.revision).toBe(2);
    expect(r.json.comments).toHaveLength(1);
    const stored = r.json.comments[0];
    expect(stored.author).toBe('qa');
    expect(stored.body).toBe('Verify NFR rows highlight together on nav');
    expect(stored.anchor.lineStart).toBe(7);
    expect(stored.anchor.lineEnd).toBe(11);
    expect(stored.anchor.lineEnd - stored.anchor.lineStart).toBe(4); // inclusive range
    expect(stored.anchor.selectedText).toBeNull();

    // validateAnchor (the underlying primitive) must accept the same shape
    // with no error for a table span whose lineEnd lands at the last row.
    const err = sessionLib.validateAnchor(
      { section: '## NFR Section', lineStart: 7, lineEnd: 11, selectedText: null },
      11
    );
    expect(err).toBeNull();
  });

});

describe('PATCH /api/comments/:id', () => {
  test('updates body and resolves', async () => {
    const { server, token } = await setupServer();
    const created = await request(server, 'POST', '/api/comments', {
      token,
      body: { revision: 1, body: 'Original', anchor: null, author: 'dev' },
    });
    const cid = created.json.comments[0].id;
    const patched = await request(server, 'PATCH', `/api/comments/${cid}`, {
      token,
      body: { revision: 2, body: 'Edited', resolved: true, author: 'pm' },
    });
    expect(patched.status).toBe(200);
    expect(patched.json.comments[0].body).toBe('Edited');
    expect(patched.json.comments[0].resolvedAt).not.toBeNull();
  });
});

describe('POST /api/complete', () => {
  test('freezes session, writes artifact, returns 410 afterwards', async () => {
    const { server, token } = await setupServer();
    await request(server, 'PATCH', '/api/questions/q1', {
      token,
      body: { revision: 1, status: 'answered', answer: 'A1', author: 'pm' },
    });
    const complete = await request(server, 'POST', '/api/complete', {
      token,
      body: { revision: 2, author: 'pm' },
    });
    expect(complete.status).toBe(200);
    expect(complete.json.artifactPath).toBeDefined();
    expect(fs.existsSync(complete.json.artifactPath)).toBe(true);
    const artifact = JSON.parse(fs.readFileSync(complete.json.artifactPath, 'utf8'));
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.questions[0].answer).toBe('A1');

    // Subsequent mutations: 410
    const after = await request(server, 'PATCH', '/api/questions/q2', {
      token,
      body: { revision: 3, status: 'answered', answer: 'A2', author: 'pm' },
    });
    expect(after.status).toBe(410);

    // GET /api/session still returns the envelope but completedAt is set
    const sess = await request(server, 'GET', '/api/session', { token });
    expect(sess.json.completedAt).not.toBeNull();
  });

  test('rejects second complete', async () => {
    const { server, token } = await setupServer();
    const first = await request(server, 'POST', '/api/complete', {
      token,
      body: { revision: 1, author: 'pm' },
    });
    expect(first.status).toBe(200);
    const second = await request(server, 'POST', '/api/complete', {
      token,
      body: { revision: 2, author: 'pm' },
    });
    expect(second.status).toBe(410);
  });
});

describe('startServer.completed promise', () => {
  test('resolves with {artifactPath, session} when /api/complete succeeds', async () => {
    const { server, token, sessionPath } = await setupServer();
    // Kick off a race: POST /api/complete and await server.completed.
    const [completeResp, completed] = await Promise.all([
      request(server, 'POST', '/api/complete', {
        token,
        body: { revision: 1, author: 'pm' },
      }),
      Promise.race([
        server.completed,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('completed promise timed out')), 3000),
        ),
      ]),
    ]);
    expect(completeResp.status).toBe(200);
    expect(completed.artifactPath).toBe(completeResp.json.artifactPath);
    expect(fs.existsSync(completed.artifactPath)).toBe(true);
    expect(completed.session.schemaVersion).toBe(1);
    expect(completed.session.completedAt).not.toBeNull();
    expect(completed.session.completedBy).toBe('pm');
    expect(completed.session.questions).toHaveLength(2);
    expect(completed.session.questions[0].id).toBe('q1');

    // Sanity: artifact on disk matches what the promise resolved with.
    const onDisk = JSON.parse(fs.readFileSync(completed.artifactPath, 'utf8'));
    expect(onDisk.sessionId).toBe(completed.session.sessionId);
    expect(path.dirname(completed.artifactPath)).toBe(path.dirname(sessionPath));

    await server.stop();
  });

  test('completion artifact preserves targetAnchor on each question', async () => {
    // Build a session with targetAnchor on one question so we can verify it
    // survives the artifact write (both via server.completed and on disk).
    const source = writeSource();
    const sessionPath = path.join(tmp, 'ta-session.json');
    const { session, token } = sessionLib.createSession({
      sessionPath,
      kind: 'prd',
      sourcePath: source,
      questions: [
        {
          id: 'qa',
          prompt: 'Why?',
          targetAnchor: { lineStart: 3, lineEnd: 5, highlightText: 'fragment' },
        },
        { id: 'qb', prompt: 'How?' }, // no targetAnchor — must default to null
      ],
    });
    expect(session.questions[0].targetAnchor).toEqual({
      lineStart: 3,
      lineEnd: 5,
      highlightText: 'fragment',
    });
    expect(session.questions[1].targetAnchor).toBeNull();

    const server = await startServer({
      sessionPath,
      token,
      uiDir: writeUi(),
      log: () => {},
      logError: () => {},
    });
    try {
      // Trigger completion; the same request the UI makes.
      const resp = await request(server, 'POST', '/api/complete', {
        token,
        body: { revision: 1, author: 'pm' },
      });
      expect(resp.status).toBe(200);

      const completed = await Promise.race([
        server.completed,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('completed promise timed out')), 3000),
        ),
      ]);

      // Resolved via server.completed
      expect(completed.session.questions[0].targetAnchor).toEqual({
        lineStart: 3,
        lineEnd: 5,
        highlightText: 'fragment',
      });
      expect(completed.session.questions[1].targetAnchor).toBeNull();

      // And persisted to disk in the artifact JSON
      const onDisk = JSON.parse(fs.readFileSync(completed.artifactPath, 'utf8'));
      expect(onDisk.questions[0].targetAnchor).toEqual({
        lineStart: 3,
        lineEnd: 5,
        highlightText: 'fragment',
      });
      expect(onDisk.questions[1].targetAnchor).toBeNull();
    } finally {
      await server.stop();
    }
  });

  test('remains pending until /api/complete is called, then resolves', async () => {
    const { server, token } = await setupServer();
    // After setupServer, completed is still pending (no /api/complete yet).
    let settled = false;
    server.completed.then(() => { settled = true; }).catch(() => {});
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);

    await request(server, 'POST', '/api/complete', {
      token,
      body: { revision: 1, author: 'pm' },
      headers: { 'x-wait': '50' },
    }).catch(() => {});

    const result = await Promise.race([
      server.completed,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('completed promise timed out')), 3000),
      ),
    ]);
    expect(result.artifactPath).toBeDefined();
    expect(result.session.completedAt).not.toBeNull();
    await server.stop();
  });
});

describe('two-client collaboration', () => {
  /**
   * Drive the canonical two-client scenario from the plan:
   *   A answers Q1, B observes via SSE, B comments, A stale, A reloads
   *   and answers Q2, complete, artifact matches.
   */
  test('A answers, B observes via SSE, B comments, A stale 409, A answers Q2, complete', async () => {
    const { server, token } = await setupServer();

    // Open B's SSE stream
    const events = [];
    let sseReq;
    const sseReady = new Promise((resolve, reject) => {
      sseReq = http.request(
        {
          hostname: server.host,
          port: server.port,
          method: 'GET',
          path: `/api/events?token=${encodeURIComponent(token)}`,
          headers: { accept: 'text/event-stream' },
        },
        (res) => {
          expect(res.statusCode).toBe(200);
          res.setEncoding('utf8');
          let buf = '';
          res.on('data', (chunk) => {
            buf += chunk;
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const frame = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const lines = frame.split('\n');
              let event = 'message';
              let data = '';
              for (const line of lines) {
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
          res.on('end', () => resolve());
          res.on('error', reject);
          resolve();
        },
      );
      sseReq.on('error', reject);
      sseReq.end();
    });
    await sseReady;

    // A answers Q1 (revision 1 → 2)
    const a1 = await request(server, 'PATCH', '/api/questions/q1', {
      token,
      body: { revision: 1, status: 'answered', answer: 'A1', author: 'pm' },
    });
    expect(a1.status).toBe(200);

    // B observes the change via SSE
    await new Promise((r) => setTimeout(r, 50));
    expect(events.length).toBeGreaterThanOrEqual(1);
    const lastSeen = events[events.length - 1];
    expect(lastSeen.questions[0].answer).toBe('A1');
    expect(lastSeen.revision).toBe(2);

    // B adds an anchored comment (revision 2 → 3)
    const b1 = await request(server, 'POST', '/api/comments', {
      token,
      body: {
        revision: 2,
        body: 'B comment',
        anchor: { section: '## Overview', lineStart: 1, lineEnd: 4, selectedText: '## Overview' },
        author: 'dev',
      },
    });
    expect(b1.status).toBe(201);
    expect(b1.json.revision).toBe(3);

    // A attempts a stale PATCH (still thinks revision is 2)
    const stale = await request(server, 'PATCH', '/api/questions/q2', {
      token,
      body: { revision: 2, status: 'answered', answer: 'A2-stale', author: 'pm' },
    });
    expect(stale.status).toBe(409);
    expect(stale.json.code).toBe('REVISION_CONFLICT');
    expect(stale.json.currentRevision).toBe(3);

    // A reloads (we simulate by re-reading /api/session) and answers Q2 at rev 3
    const reloaded = await request(server, 'GET', '/api/session', { token });
    expect(reloaded.json.revision).toBe(3);
    const a2 = await request(server, 'PATCH', '/api/questions/q2', {
      token,
      body: { revision: 3, status: 'answered', answer: 'A2', author: 'pm' },
    });
    expect(a2.status).toBe(200);
    expect(a2.json.revision).toBe(4);
    expect(a2.json.questions[1].answer).toBe('A2');

    // Complete at revision 4
    const complete = await request(server, 'POST', '/api/complete', {
      token,
      body: { revision: 4, author: 'pm' },
    });
    expect(complete.status).toBe(200);

    // Artifact matches exactly what was submitted
    const artifact = JSON.parse(fs.readFileSync(complete.json.artifactPath, 'utf8'));
    expect(artifact.questions).toHaveLength(2);
    expect(artifact.questions[0]).toMatchObject({
      id: 'q1',
      status: 'answered',
      answer: 'A1',
      author: 'pm',
    });
    expect(artifact.questions[1]).toMatchObject({
      id: 'q2',
      status: 'answered',
      answer: 'A2',
      author: 'pm',
    });
    expect(artifact.comments).toHaveLength(1);
    expect(artifact.comments[0]).toMatchObject({
      body: 'B comment',
      author: 'dev',
      anchor: {
        section: '## Overview',
        lineStart: 1,
        lineEnd: 4,
        selectedText: '## Overview',
      },
    });
    expect(artifact.completedBy).toBe('pm');
    expect(artifact.completedAt).toBeDefined();

    sseReq.destroy();
    await server.stop();
  });
});

describe('static UI', () => {
  test('serves index.html at /', async () => {
    const { server, token } = await setupServer();
    const r = await request(server, 'GET', '/');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.text).toContain('<title>x</title>');
  });

  test('serves app.js with correct content type', async () => {
    const { server } = await setupServer();
    const r = await request(server, 'GET', '/app.js');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/javascript/);
  });

  test('rejects path traversal', async () => {
    const { server } = await setupServer();
    const r = await request(server, 'GET', '/../session.json');
    expect([403, 404]).toContain(r.status);
  });
});

describe('auto-open share URL', () => {
  // The opener is module-scoped inside server.js; mock it via jest.mock so
  // the assertion can capture exactly what `startServer` passes in. A real
  // platform-opener would attempt to spawn `open`/`xdg-open`/`cmd` which is
  // not appropriate in CI or unit-test runs.
  jest.mock('../../lib/refinement-review/opener', () => {
    const actual = jest.requireActual('../../lib/refinement-review/opener');
    return {
      ...actual,
      openUrl: jest.fn(() => Promise.resolve({ opened: true, command: 'open <url>' })),
    };
  });

  // Re-require AFTER the mock is installed so server.js picks up the stub.
  let openerMock;
  let startServerFresh;
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../lib/refinement-review/opener', () => {
      const actual = jest.requireActual('../../lib/refinement-review/opener');
      return {
        ...actual,
        openUrl: jest.fn(() => Promise.resolve({ opened: true, command: 'open <url>' })),
      };
    });
    openerMock = require('../../lib/refinement-review/opener');
    startServerFresh = require('../../lib/refinement-review/server').startServer;
  });

  test('open:true calls opener with nonce-bearing share URL; log sink is token-free', async () => {
    // Token deliberately includes every character whose encoding differs
    // between encodeURIComponent and the literal so the assertion catches
    // a forgotten encodeURIComponent call (a hex token would pass either way).
    const exoticToken = 'abc/&?token=x';
    const source = writeSource();
    const sessionPath = path.join(tmp, 'session.json');
    sessionLib.createSession({
      sessionPath,
      kind: 'prd',
      sourcePath: source,
      questions: [{ id: 'q1', prompt: 'First?' }],
    });
    const uiDir = writeUi();

    const logLines = [];
    const log = jest.fn((msg) => logLines.push(String(msg)));
    const logError = jest.fn();

    const server = await startServerFresh({
      sessionPath,
      token: exoticToken,
      uiDir,
      log,
      logError,
      open: true,
    });
    activeServers.push(server);

    // reviewUrl is the nonce-bearing share URL — `<origin>/api/exchange?nonce=<id>`.
    // The bearer token is NEVER in the share URL; authentication is delegated
    // to /api/exchange (which sets a cookie) and to the Authorization header
    // for API clients. The opener gets a real URL that won't 401.
    const expectedOrigin = server.url;
    expect(server.reviewUrl).toMatch(
      new RegExp(`^${expectedOrigin.replace(/\./g, '\\.')}/api/exchange\\?nonce=`),
    );
    expect(server.reviewUrl).not.toContain(exoticToken);
    expect(server.reviewUrl).not.toContain(encodeURIComponent(exoticToken));

    // The opener was called exactly once with the nonce-bearing share URL
    // and no openerOpts.
    expect(openerMock.openUrl).toHaveBeenCalledTimes(1);
    expect(openerMock.openUrl).toHaveBeenCalledWith(server.reviewUrl, {});

    // Wait for the fire-and-forget openResult to settle so we can inspect it.
    const openResult = await server.openResult;
    expect(openResult.opened).toBe(true);

    // Every line that flowed through `log` is token-free. The token, in
    // any of its forms (raw, partially encoded, fully encoded), must NOT
    // appear anywhere the log sink sees.
    expect(log).toHaveBeenCalled();
    for (const line of logLines) {
      expect(line).not.toContain(exoticToken);
      expect(line).not.toContain(encodeURIComponent(exoticToken));
      // The raw decoded token includes '/', '&', '?'; their presence in
      // the log line would indicate a leak even if the literal string
      // is not assembled.
      expect(line).not.toContain('abc/&?token=x');
    }

    // And the encoded form was never logged either (would indicate the
    // server copy-pasted the share URL into log).
    for (const line of logLines) {
      expect(line).not.toContain('abc%2F%26%3Ftoken%3Dx');
    }

    // logError was never called: a token-bearing log would have been
    // re-routed to logError first; assert no spurious errors.
    expect(logError).not.toHaveBeenCalled();

    await server.stop();
  });

  test('open:false (default) still returns reviewUrl for manual fallback but skips opener', async () => {
    const { server, token } = await setupServer();
    // Opener was NOT called because `open` was not passed.
    expect(openerMock.openUrl).not.toHaveBeenCalled();
    // reviewUrl is ALWAYS composed so the bootstrap can print the share URL
    // for manual fallback even when auto-open is suppressed (CI / --no-open /
    // non-TTY). It is the nonce-bearing share URL — not the bearer URL.
    expect(server.reviewUrl).toMatch(
      new RegExp(`^${server.url.replace(/\./g, '\\.')}/api/exchange\\?nonce=`),
    );
    // The token must not be in the share URL.
    expect(server.reviewUrl).not.toContain(token);
    // openResult is null because the opener was not invoked.
    expect(server.openResult).toBeNull();
  });
  test('opener exception is captured in openResult (does not reject or throw)', async () => {
    // Swap the mock to throw synchronously from the Promise constructor so
    // the .catch on the server's openResult wrapper is exercised.
    openerMock.openUrl.mockImplementationOnce(() =>
      Promise.reject(new Error('opener blew up')),
    );
    const source = writeSource();
    const sessionPath = path.join(tmp, 'session.json');
    sessionLib.createSession({
      sessionPath,
      kind: 'prd',
      sourcePath: source,
      questions: [{ id: 'q1', prompt: 'First?' }],
    });
    const uiDir = writeUi();
    const server = await startServerFresh({
      sessionPath,
      token: 'hex',
      uiDir,
      log: () => {},
      logError: () => {},
      open: true,
    });
    activeServers.push(server);

    const openResult = await server.openResult;
    expect(openResult.opened).toBe(false);
    expect(openResult.reason).toBe('exception');
    expect(openResult.error).toMatch(/opener blew up/);
    await server.stop();
  });
});

describe('setTunnelUrl after start', () => {
  test('rewrites publicUrl, mints a fresh nonce, and updates reviewUrl', async () => {
    const { server } = await setupServer({ open: false });

    const before = {
      publicUrl: server.publicUrl,
      reviewUrl: server.reviewUrl,
      shareNonce: server.shareNonce,
    };
    expect(before.publicUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const updated = server.setTunnelUrl('https://abc.trycloudflare.com/');
    expect(updated.publicUrl).toBe('https://abc.trycloudflare.com');
    expect(server.publicUrl).toBe('https://abc.trycloudflare.com');
    expect(updated.shareNonce).not.toBe(before.shareNonce);
    expect(server.shareNonce).not.toBe(before.shareNonce);
    expect(server.reviewUrl).toBe(
      `https://abc.trycloudflare.com/api/exchange?nonce=${updated.shareNonce}`,
    );
    expect(server.reviewUrl.startsWith('https://abc.trycloudflare.com/')).toBe(true);
  });

  test('calling setTunnelUrl twice mints two distinct nonces', async () => {
    const { server } = await setupServer({ open: false });
    const first = server.setTunnelUrl('https://abc.trycloudflare.com');
    const second = server.setTunnelUrl('https://xyz.trycloudflare.com');
    expect(first.shareNonce).not.toBe(second.shareNonce);
    expect(server.publicUrl).toBe('https://xyz.trycloudflare.com');
    expect(server.reviewUrl).toBe(
      `https://xyz.trycloudflare.com/api/exchange?nonce=${second.shareNonce}`,
    );
  });

  test('rejects empty / non-string tunnelUrl', async () => {
    const { server } = await setupServer({ open: false });
    expect(() => server.setTunnelUrl('')).toThrow(TypeError);
    expect(() => server.setTunnelUrl(null)).toThrow(TypeError);
    expect(() => server.setTunnelUrl(undefined)).toThrow(TypeError);
    expect(() => server.setTunnelUrl(42)).toThrow(TypeError);
  });

  test('stripping trailing slashes on tunnelUrl', async () => {
    const { server } = await setupServer({ open: false });
    server.setTunnelUrl('https://abc.trycloudflare.com///');
    expect(server.publicUrl).toBe('https://abc.trycloudflare.com');
    expect(server.reviewUrl).toBe(
      `https://abc.trycloudflare.com/api/exchange?nonce=${server.shareNonce}`,
    );
  });
});

describe('createShareUrl', () => {
  test('mints a fresh share URL bound to the current publicUrl', async () => {
    const { server } = await setupServer({ open: false });

    const before = {
      publicUrl: server.publicUrl,
      reviewUrl: server.reviewUrl,
      shareNonce: server.shareNonce,
    };

    const created = server.createShareUrl();
    expect(created.publicUrl).toBe(before.publicUrl);
    expect(created.shareNonce).not.toBe(before.shareNonce);
    expect(created.reviewUrl).toBe(
      `${before.publicUrl}/api/exchange?nonce=${created.shareNonce}`,
    );
    expect(server.reviewUrl).toBe(before.reviewUrl);
    expect(server.shareNonce).toBe(before.shareNonce);
    expect(server.publicUrl).toBe(before.publicUrl);
  });

  test('calling N times yields N independent nonces and N independent URLs', async () => {
    const { server } = await setupServer({ open: false });
    const N = 5;
    const created = [];
    for (let i = 0; i < N; i++) created.push(server.createShareUrl());
    const nonces = created.map((c) => c.shareNonce);
    expect(new Set(nonces).size).toBe(N);
    created.forEach((c, i) => {
      expect(c.reviewUrl).toBe(
        `${server.publicUrl}/api/exchange?nonce=${c.shareNonce}`,
      );
      expect(c.reviewUrl).toContain(`nonce=${c.shareNonce}`);
    });
  });
  test('each new share URL redeems independently through /api/exchange', async () => {
    const { server } = await setupServer();
    const a = server.createShareUrl();
    const b = server.createShareUrl();
    const c = server.createShareUrl();

    // Mint three cookies, one per share URL. Each must independently
    // reach the session API. All three must authenticate to the SAME
    // session (same sessionPath), so the envelope body is identical.
    const sids = [];
    const docs = [];
    for (const u of [a, b, c]) {
      const exchange = await request(server, 'GET', `/api/exchange?nonce=${u.shareNonce}`);
      expect(exchange.status).toBe(302);
      const sid = exchange.headers['set-cookie'][0].split(';')[0].split('=')[1];
      sids.push(sid);

      const r = await request(server, 'GET', '/api/session', {
        headers: { Cookie: `review-sid=${sid}` },
      });
      expect(r.status).toBe(200);
      docs.push(JSON.stringify(r.json.document));
    }

    expect(new Set(sids).size).toBe(3); // independent cookies
    expect(new Set(docs).size).toBe(1); // same document envelope across all cookies
  });

  test('createShareUrl after setTunnelUrl uses the new publicUrl', async () => {
    const { server } = await setupServer({ open: false });
    server.setTunnelUrl('https://abc.trycloudflare.com');
    const created = server.createShareUrl();
    expect(created.publicUrl).toBe('https://abc.trycloudflare.com');
    expect(created.reviewUrl.startsWith('https://abc.trycloudflare.com/')).toBe(true);
  });
});

function exchangeOnce(server, url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, method: 'GET', path: u.pathname + u.search },
      (res) => {
        res.resume();
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            setCookie: res.headers['set-cookie'],
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function exchangeAndGetCookie(server, url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, method: 'GET', path: u.pathname + u.search },
      (res) => {
        res.resume();
        res.on('end', () => {
          if (res.statusCode !== 302) {
            return reject(new Error(`expected 302 redirect, got ${res.statusCode}`));
          }
          const sc = res.headers['set-cookie'] || [];
          const joined = Array.isArray(sc) ? sc.join(';') : String(sc);
          const m = /review-sid=([^;]+)/.exec(joined);
          if (!m) return reject(new Error('no review-sid cookie in response'));
          resolve(m[1]);
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function requestWithCookie(server, method, p, sid) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: server.host,
        port: server.port,
        method,
        path: p,
        headers: { cookie: `review-sid=${sid}` },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

describe('long-lived review session', () => {
  function setupLongLived(extra = {}) {
    const source = writeSource();
    const sessionPath = path.join(tmp, `ll-${Math.random().toString(36).slice(2)}.json`);
    const { session, token } = sessionLib.createSession({
      sessionPath,
      kind: 'prd',
      sourcePath: source,
      questions: [{ id: 'q1', prompt: 'Q?' }],
    });
    const uiDir = extra.uiDir !== false ? writeUi() : null;
    return startServer({
      sessionPath,
      token,
      uiDir,
      longLived: true,
      port: 0,
      log: () => {},
      logError: () => {},
      ...extra,
    }).then((server) => {
      activeServers.push(server);
      return { source, sessionPath, token, session, server, uiDir };
    });
  }

  test('startServer emits shareInvite + longLived and no shareNonce', async () => {
    const { server } = await setupLongLived();
    expect(server.longLived).toBe(true);
    expect(typeof server.shareInvite).toBe('string');
    expect(server.shareInvite.length).toBeGreaterThan(0);
    expect(server.shareNonce).toBeNull();
    expect(server.reviewUrl).toContain(`/api/exchange?invite=${server.shareInvite}`);
  });

  test('GET /api/exchange?invite=<id> returns the identify form (200, HTML)', async () => {
    const { server } = await setupLongLived();
    const r = await request(server, 'GET', `/api/exchange?invite=${server.shareInvite}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.text).toContain('Identify yourself');
    expect(r.text).toContain(`value="${server.shareInvite}"`);
    expect(r.text).toMatch(/<form[^>]+action="\/api\/identify"/);
  });

  test('GET /api/exchange without an invite returns 400', async () => {
    const { server } = await setupLongLived();
    const r = await request(server, 'GET', '/api/exchange');
    expect(r.status).toBe(400);
  });

  test('GET /api/exchange with an unknown invite returns 401', async () => {
    const { server } = await setupLongLived();
    const r = await request(server, 'GET', '/api/exchange?invite=nope-not-real');
    expect(r.status).toBe(401);
  });

  test('the same invite can be exchanged by many distinct reviewers', async () => {
    const { server } = await setupLongLived();
    const invite = server.shareInvite;
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await request(server, 'GET', `/api/exchange?invite=${invite}`);
      expect(r.status).toBe(200);
      // First exchange returns the form; subsequent exchanges also return the
      // form because the invite is not burned. (The cookie is only minted
      // after POST /api/identify.)
    }
    // Spot-check the helper layer: validateInvite returns the record.
    const rec = _internal.validateInvite(invite);
    expect(rec).toBeTruthy();
    expect(rec.permissions).toBe('reviewer');
  });

  test('POST /api/identify with valid invite + name mints a cookie + redirects', async () => {
    const { server } = await setupLongLived();
    const r = await request(server, 'POST', '/api/identify', {
      body: { invite: server.shareInvite, name: 'Alice' },
    });
    expect(r.status).toBe(302);
    const sc = (r.headers['set-cookie'] || []).join(';');
    expect(sc).toMatch(/review-sid=[^;]+/);
    expect(r.headers.location).toBe('/');
  });

  test('POST /api/identify with missing/invalid invite returns 401', async () => {
    const { server } = await setupLongLived();
    const r1 = await request(server, 'POST', '/api/identify', {
      body: { invite: 'nope', name: 'Bob' },
    });
    expect(r1.status).toBe(401);
    const r2 = await request(server, 'POST', '/api/identify', {
      body: { name: 'Bob' },
    });
    expect(r2.status).toBe(401);
  });

  test('POST /api/identify rejects oversized names with 400', async () => {
    const { server } = await setupLongLived();
    const huge = 'x'.repeat(_internal.MAX_DISPLAY_NAME_LENGTH + 1);
    const r = await request(server, 'POST', '/api/identify', {
      body: { invite: server.shareInvite, name: huge },
    });
    expect(r.status).toBe(400);
  });

  test('static UI requires a cookie in long-lived mode', async () => {
    const { server } = await setupLongLived();
    const r1 = await request(server, 'GET', '/');
    expect(r1.status).toBe(401);
    const r2 = await request(server, 'GET', '/index.html');
    expect(r2.status).toBe(401);
  });

  test('bearer token cannot bypass the cookie gate in long-lived mode', async () => {
    const { server, token } = await setupLongLived();
    const r = await request(server, 'GET', '/api/session', { token });
    expect(r.status).toBe(401);
  });

  test('createShareUrl throws in long-lived mode', async () => {
    const { server } = await setupLongLived();
    expect(() => server.createShareUrl()).toThrow(/long-lived/);
  });

  test('validateInvite rejects an expired invite and removes it from the map', async () => {
    const { server } = await setupLongLived({ ttlMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const rec = _internal.validateInvite(server.shareInvite);
    expect(rec).toBeNull();
    // A second call confirms it was deleted (still null, no side-effects).
    expect(_internal.validateInvite(server.shareInvite)).toBeNull();
  });

  test('mintInvite + validateInvite round-trip a record with createdAt + expiry', async () => {
    const sessionPath = path.join(tmp, 'roundtrip.json');
    const id = _internal.mintInvite({
      sessionPath,
      permissions: 'reviewer',
      sessionExpiresAt: Date.now() + 1000,
    });
    expect(typeof id).toBe('string');
    const rec = _internal.validateInvite(id);
    expect(rec).toBeTruthy();
    expect(rec.sessionPath).toBe(sessionPath);
    expect(rec.createdAt).toBeGreaterThan(0);
    expect(rec.sessionExpiresAt).toBeGreaterThan(Date.now());
  });

  test('renderIdentifyForm produces valid HTML with the invite as a hidden field', () => {
    const html = _internal.renderIdentifyForm('abcd-1234');
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('value="abcd-1234"');
    expect(html).toContain('<form method="POST" action="/api/identify"');
    // The hidden invite MUST round-trip unmodified (no URL encoding).
    expect(html).not.toContain('value="abcd%2D1234"');
  });

  test('parseIdentifyBody handles JSON and url-encoded bodies', () => {
    expect(_internal.parseIdentifyBody(Buffer.from('{"invite":"abc","name":"Eve"}')))
      .toEqual({ invite: 'abc', name: 'Eve' });
    expect(_internal.parseIdentifyBody(Buffer.from('invite=abc&name=Eve+Smith')))
      .toEqual({ invite: 'abc', name: 'Eve Smith' });
    expect(_internal.parseIdentifyBody(Buffer.from(''))).toEqual({});
  });

  test('TTL timer auto-stops the server in long-lived mode', async () => {
    const { server } = await setupLongLived({ ttlMs: 50 });
    const completed = await server.completed;
    expect(completed.stopped).toBe(true);
    expect(server.url).toBeDefined();
  });

  test('TTL timer closes active SSE subscribers and still completes', async () => {
    // Regression: stop() must close SSE subscribers BEFORE server.close()
    // so the close callback can fire. Without this, an open EventSource
    // keeps the connection alive, server.close() hangs, and `completed`
    // never resolves — the foreground bootstrap would hang forever.
    const { server } = await setupLongLived({ ttlMs: 500 });

    // Long-lived mode requires cookie auth on every API route, including
    // /api/events. Mint a cookie via /api/identify first.
    const identified = await request(server, 'POST', '/api/identify', {
      body: { invite: server.shareInvite, name: 'Watcher' },
    });
    expect(identified.status).toBe(302);
    const sc = identified.headers['set-cookie'] || [];
    const sidMatch = sc.join(';').match(/review-sid=([^;]+)/);
    expect(sidMatch).not.toBeNull();
    const cookie = `review-sid=${sidMatch[1]}`;

    // Open SSE; resolve sseConnected only after the server has accepted
    // the response (status 200) so the assertion is observed before the
    // TTL race begins. Drain the body so response buffers don't grow.
    let resolveSseConnected;
    let rejectSseConnected;
    const sseConnected = new Promise((res, rej) => {
      resolveSseConnected = res;
      rejectSseConnected = rej;
    });
    const sseReq = http.request(
      {
        hostname: server.host,
        port: server.port,
        method: 'GET',
        path: '/api/events',
        headers: { accept: 'text/event-stream', cookie },
      },
      (res) => {
        if (res.statusCode !== 200) {
          rejectSseConnected(new Error(`expected 200 from /api/events, got ${res.statusCode}`));
          return;
        }
        resolveSseConnected();
        res.on('data', () => {});
      },
    );
    sseReq.on('error', (e) => {
      // Tolerate the socket close that stop() will trigger; surface only
      // genuine connection failures that arrived before sseConnected
      // resolved.
      rejectSseConnected(e);
    });
    sseReq.end();

    // Wait for the server to have actually accepted the SSE connection
    // (i.e. added the subscriber) before starting the TTL race. Without
    // this, the race could resolve before the subscriber ever existed.
    await sseConnected;

    // Race completed against a hard timeout. If stop() leaves SSE
    // subscribers open, completed will never settle and the timeout
    // branch fires. The timeout is cleared when completed wins so the
    // timer does not leak across the suite.
    let timeoutHandle;
    try {
      const completed = await Promise.race([
        server.completed,
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error('completed did not settle within 2s of TTL')),
            2000,
          );
        }),
      ]);
      expect(completed.stopped).toBe(true);
    } finally {
      clearTimeout(timeoutHandle);
      // Drop the client handle so Jest can exit cleanly. A successful
      // shutdown will have already closed the socket; destroy() is a
      // no-op on an already-closed request.
      sseReq.destroy();
    }
  });

  test('stop() is idempotent', async () => {
    const { server } = await setupLongLived();
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();
  });

  test('GET /api/me with cookie returns the viewer name and connectedAt', async () => {
    const { server } = await setupLongLived();
    const identified = await request(server, 'POST', '/api/identify', {
      body: { invite: server.shareInvite, name: 'Mira' },
    });
    expect(identified.status).toBe(302);
    const sc = identified.headers['set-cookie'] || [];
    const sidMatch = sc.join(';').match(/review-sid=([^;]+)/);
    expect(sidMatch).not.toBeNull();
    const cookie = `review-sid=${sidMatch[1]}`;
    const r = await request(server, 'GET', '/api/me', { headers: { cookie } });
    expect(r.status).toBe(200);
    expect(r.json).toEqual(expect.objectContaining({ name: 'Mira' }));
    expect(typeof r.json.connectedAt).toBe('number');
    expect(r.json.connectedAt).toBeGreaterThan(0);
  });

  test('GET /api/me without a cookie returns 401', async () => {
    const { server } = await setupLongLived();
    const r = await request(server, 'GET', '/api/me');
    expect(r.status).toBe(401);
  });

  test('GET /api/me rejects bearer token in long-lived mode', async () => {
    const { server, token } = await setupLongLived();
    const r = await request(server, 'GET', '/api/me', { token });
    expect(r.status).toBe(401);
  });
});

describe('share-link diagnostics (the --collab stale-404 class)', () => {
  // Root cause context: cloudflared announces the trycloudflare.com URL
  // before the Cloudflare edge routes it, so early hits get an edge-level
  // 404/502 that never reaches this server (prevented by the tunnel.js
  // readiness probe). The other stale-link class — a redeemed/expired
  // credential — DOES reach here. The contract now splits by caller:
  //   - API/probe callers: unchanged 401 JSON, plus a `hint` field.
  //   - Browser navigations: a short HTML page (200) instead of a bare 404.
  test('burned nonce still 401 JSON for API callers, with hint', async () => {
    const { server, token } = await setupServer();
    const first = await request(
      server,
      'GET',
      `/api/exchange?nonce=${server.shareNonce}`,
      { token },
    );
    expect(first.status).toBe(302);
    const again = await request(
      server,
      'GET',
      `/api/exchange?nonce=${server.shareNonce}`,
      { token },
    );
    expect(again.status).toBe(401);
    expect(again.json.error).toBe('invalid or expired nonce');
    expect(again.json.hint).toMatch(/single-use|expire/i);
    await server.stop();
  });

  test('burned nonce served as HTML diagnostic on browser navigation', async () => {
    const { server, token } = await setupServer();
    const nav = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
    const first = await request(
      server,
      'GET',
      `/api/exchange?nonce=${server.shareNonce}`,
      { token, headers: nav },
    );
    expect(first.status).toBe(302);
    const again = await request(
      server,
      'GET',
      `/api/exchange?nonce=${server.shareNonce}`,
      { token, headers: nav },
    );
    expect(again.status).toBe(200);
    expect(again.headers['content-type']).toMatch(/text\/html/);
    expect(again.text).toMatch(/no longer valid/i);
    expect(again.text).toMatch(/single-use|expire/i);
    await server.stop();
  });

  test('unknown invite keeps 401 JSON for API callers but HTML for browsers', async () => {
    const { server } = await setupServer({ longLived: true });
    const api = await request(server, 'GET', '/api/exchange?invite=deadbeef');
    expect(api.status).toBe(401);
    expect(api.json.error).toBe('invalid or expired invite');
    expect(api.json.hint).toMatch(/invite/i);
    const nav = { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
    const browser = await request(
      server,
      'GET',
      '/api/exchange?invite=deadbeef',
      { headers: nav },
    );
    expect(browser.status).toBe(200);
    expect(browser.headers['content-type']).toMatch(/text\/html/);
    await server.stop();
  });

  test('the exchange route burns the nonce regardless of bearer — URL is the credential', async () => {
    const { server, token } = await setupServer();
    // Contract check (guards a proposed security change): /api/exchange is
    // NOT bearer-gated — the nonce in the URL is the sole credential, so a
    // request with any (or no) bearer redeems and burns it. The
    // "probes must not mutate the nonce map" invariant is enforced inside
    // consumeNonce (peek-vs-burn split), not by rejecting bearers here.
    const probe = await request(
      server,
      'GET',
      `/api/exchange?nonce=${server.shareNonce}`,
      { token: 'wrong' },
    );
    expect(probe.status).toBe(302);
    const afterBurn = await request(
      server,
      'GET',
      `/api/exchange?nonce=${server.shareNonce}`,
      { token },
    );
    expect(afterBurn.status).toBe(401);
    await server.stop();
  });
});
