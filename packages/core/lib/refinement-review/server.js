/**
 * Local-only refinement-review HTTP server.
 *
 * Serves the session API and a small browser UI over Node's built-in `http`.
 * Binds to `127.0.0.1` by default; `--host` overrides for team access. Every
 * API route requires a per-session credential. The session envelope is
 * authoritative; mutations go through `session.mutateSession` so optimistic
 * concurrency and document-integrity guarantees are preserved.
 *
 * @module @sunstone-partners/ensemble-core/refinement-review/server
 *
 * Auth model
 * -----------
 * The server speaks three orthogonal secrets:
 *
 *   1. **`opts.token` (bearer).** Durable, per-session. Used by API clients
 *      via `Authorization: Bearer <token>` and by the bootstrap when minting
 *      share URLs. Never written to a cookie. Never logged.
 *
 *   2. **Exchange nonce.** Short-lived (10 min), single-use. Appears in
 *      share URLs as `?nonce=<id>`. Burned atomically on successful
 *      exchange: nonces are STORED ONLY WHILE VALID, deleted on burn, and
 *      are NEVER read back after a successful exchange. Probes that 401
 *      must not mutate the nonce map.
 *
 *   3. **Cookie session id.** Opaque, per-device. Set by `/api/exchange`,
 *      read by the request auth layer. The cookie record maps directly to
 *      `{ sessionPath, csrfKey, expiresAt }` — the bearer is NOT stored in
 *      the cookie. Cookie attributes: `HttpOnly; Secure; SameSite=Strict;
 *      Path=/` (no `Domain=`). The cookie is bound to the exact
 *      `sessionPath` it was minted for, so a SID minted for one session
 *      cannot authorize against a different session in the same process.
 *
 * Defence headers
 * ---------------
 * Every response sets `Referrer-Policy: no-referrer` so URLs carrying a
 * single-use nonce are not leaked via the `Referer` header on outbound
 * navigation. The cookie is the durable surface; the URL is the entry
 * surface; the bearer is the API surface.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const session = require('./session');
const overview = require('./overview');
const { openUrl } = require('./opener');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 0; // let the OS assign
const NONCE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const SESSION_COOKIE_NAME = 'review-sid';
const MAX_DISPLAY_NAME_LENGTH = 100;
const PROXY_KEEPALIVE_INTERVAL_MS = 25_000;

// ---------------------------------------------------------------------------
// In-memory auth state. Both maps are intentionally in-memory; the policy is
// "post-restart everyone re-authenticates via URL" — there is no crash
// recovery for these and that is fine for a local-only review server.
// ---------------------------------------------------------------------------
const nonces = new Map();
const sessions = new Map();

// Multi-use invites (long-lived mode only). The invite is the
// exchange credential: GET /api/exchange?invite=<id> returns a form,
// POST /api/identify { name, invite } re-validates it and mints a cookie.
// Invites are NOT burned on POST (multi-use). They live in-process and
// are wiped on server restart, like nonces and sessions.
const invites = new Map();
// The `--collab` share URL is minted by startServer/setTunnelUrl and printed
// for the reviewer to open. Two distinct failure classes produced the
// reported intermittent 404s:
//   1. TUNNEL WARM-UP RACE — fixed in tunnel.js: the QuickTunnel readiness
//      probe now waits for the Cloudflare edge to route the URL before the
//      server's share URL is printed/opened. (An edge 404/502/503 never
//      reaches this server, so it cannot be handled here — only prevented.)
//   2. STALE CREDENTIAL — a nonce/invite was already redeemed or expired
//      (10-min TTL) before the reviewer clicked. The API keeps its original
//      401 JSON contract (probers depend on it); browsers that navigate to
//      a dead link get the human-readable diagnostic below instead of a
//      bare "not found", so the failure is self-explanatory.
// Path-style exchange URLs (`/api/exchange/nonce/<id>`) would make
// credential delivery immune to query-string mangling — deferred, needs a
// route + re-mint audit before adoption.

/**
 * One-line hint describing why a share credential was rejected.
 * @param {'nonce'|'invite'} kind
 * @param {object} [opts] - session opts (longLived)
 */
function shareCredentialHint(kind, opts = {}) {
  if (kind === 'invite') {
    return opts.longLived === true
      ? 'The invite is expired or the session was completed/restarted. Ask the host for the current invite URL.'
      : 'This session is not running in long-lived mode. Ask the host for a nonce URL.';
  }
  return 'Exchange nonces are single-use and expire 10 minutes after the server starts. Re-open the link the host just printed, or ask them to print a fresh one.';
}

/**
 * True when the request looks like a top-level browser navigation (a
 * reviewer clicking a share link) rather than an API fetch or a scripted
 * probe. Browser navigations send `Accept: text/html`; API clients and
 * curl-style probes do not.
 * @param {import('http').IncomingMessage} req
 */
function wantsHtml(req) {
  const accept = req.headers.accept;
  return typeof accept === 'string' && /text\/html|application\/xml/.test(accept)
    && !/application\/json/.test(accept);
}

/**
 * Human-readable diagnostic page for a dead share link, served ONLY on
 * browser navigation. API/probe callers keep the 401 JSON contract (they
 * assert on it); a reviewer opening a stale link in a browser instead gets
 * this — one short sentence explaining the single-use/10-minute nonce model
 * and what to do next. 200 by design: a 404 here reads as "the server is
 * missing", which is the wrong conclusion. The credential is already dead,
 * so there is nothing sensitive to leak beyond the (public) review model.
 */
function writeShareDiagnostic(res, kind, hint) {
  const body = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Review link expired</title>
  <meta name="referrer" content="no-referrer" />
  <style>
    body { font-family: system-ui, sans-serif; max-width: 560px; margin: 4em auto; padding: 1em; color: #111; line-height: 1.5; }
    h1 { font-size: 1.3em; margin: 0 0 0.5em; }
    p { color: #333; }
  </style>
</head>
<body>
  <h1>This review link is no longer valid</h1>
  <p>${escapeHtmlAttr(hint)}</p>
</body>
</html>`;
  res.writeHead(200, securityHeaders({
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  }));
  res.end(body);
}

/**
 * Mint a single-use exchange nonce. Caller stores the returned id in a
 * share URL as `?nonce=<id>`.
 */
function mintNonce(record) {
  const id = crypto.randomBytes(24).toString('base64url');
  nonces.set(id, { ...record, createdAt: Date.now() });
  return id;
}

/**
 * Look up a nonce WITHOUT mutating the map. Used by 401 probes so we don't
 * burn a nonce just because a request had the wrong bearer.
 */
function peekNonce(id) {
  const r = nonces.get(id);
  if (!r) return null;
  if (Date.now() - r.createdAt > NONCE_TTL_MS) {
    nonces.delete(id);
    return null;
  }
  return r;
}

/**
 * Atomic exchange: capture the record and delete the nonce from the map
 * inside the same tick. No awaits between lookup and delete. Returns
 * `null` if the nonce is absent/expired (and does NOT mutate the map in
 * that case), or the record on success.
 */
function consumeNonce(id) {
  const r = nonces.get(id);
  if (!r) return null;
  if (Date.now() - r.createdAt > NONCE_TTL_MS) {
    nonces.delete(id);
    return null;
  }
  // CRITICAL SECTION: capture + delete. No awaits here.
  const record = r;
  nonces.delete(id);
  return record;
}
/**
 * Mint a multi-use invite token. Caller stores the returned id in a
 * share URL as `?invite=<id>`. Unlike a nonce, an invite is NOT burned
 * on first use; multiple reviewers can independently exchange the same
 * invite and each get a distinct cookie session.
 */
function mintInvite(record) {
  const id = crypto.randomBytes(24).toString('base64url');
  invites.set(id, { ...record, createdAt: Date.now() });
  return id;
}

/**
 * Read-only invite lookup. Returns the record or null. Does NOT mutate
 * the map (invites are multi-use; the same id may be presented by many
 * distinct reviewers).
 */
function validateInvite(id) {
  if (typeof id !== 'string' || !id) return null;
  const rec = invites.get(id);
  if (!rec) return null;
  if (typeof rec.sessionExpiresAt === 'number' && rec.sessionExpiresAt <= Date.now()) {
    invites.delete(id);
    return null;
  }
  return rec;
}

/**
 * Escape a string for safe insertion into an HTML double-quoted attribute.
 * Unlike encodeURIComponent, this preserves the byte sequence so the form
 * POST round-trip sees the original token.
 */
function escapeHtmlAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Render the username form HTML returned by GET /api/exchange in
 * long-lived mode. The invite is passed as a hidden field so the browser
 * POSTs it back to /api/identify without needing JavaScript.
 */
function renderIdentifyForm(inviteId) {
  const safe = escapeHtmlAttr(inviteId);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Identify</title>
  <meta name="referrer" content="no-referrer" />
  <style>
    body { font-family: system-ui, sans-serif; max-width: 420px; margin: 4em auto; padding: 1em; color: #111; }
    input[type=text], button { font: inherit; padding: 0.5em; width: 100%; box-sizing: border-box; }
    button { margin-top: 1em; cursor: pointer; background: #1d4ed8; color: #fff; border: 0; border-radius: 4px; }
    h1 { font-size: 1.2em; margin: 0 0 0.5em; }
    p { color: #444; }
  </style>
</head>
<body>
  <h1>Identify yourself</h1>
  <p>Enter your name to join the review session.</p>
  <form method="POST" action="/api/identify">
    <input type="hidden" name="invite" value="${safe}" />
    <label for="name">Display name</label>
    <input id="name" name="name" type="text" required maxlength="${MAX_DISPLAY_NAME_LENGTH}" autocomplete="off" />
    <button type="submit">Join</button>
  </form>
</body>
</html>`;
}

/**
 * Parse the body of POST /api/identify. Accepts either JSON or
 * application/x-www-form-urlencoded so the HTML form (no JS) and any
 * programmatic client can both submit.
 */
function parseIdentifyBody(buf) {
  const text = buf.toString('utf8').trim();
  if (!text) return {};
  if (text[0] === '{' || text[0] === '[') {
    return JSON.parse(text);
  }
  const out = {};
  for (const pair of text.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    if (eq < 0) {
      out[decodeURIComponent(pair)] = '';
      continue;
    }
    const k = decodeURIComponent(pair.slice(0, eq).replace(/\+/g, ' '));
    const v = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
    out[k] = v;
  }
  return out;
}

/**
 * Mint a cookie session bound to a session envelope path. Returns the
 * opaque session id; the caller sets the cookie via `buildSessionCookie`.
 *
 * `displayName` is optional; when set, the SSE handler uses it to
 * populate the presence viewers list (long-lived mode only).
 */
function mintSession({ sessionPath, permissions, expiresAt, displayName }) {
  const sid = crypto.randomBytes(32).toString('base64url');
  const csrfKey = crypto.randomBytes(16).toString('base64url');
  sessions.set(sid, {
    sessionPath,
    permissions: permissions || 'reviewer',
    csrfKey,
    expiresAt: expiresAt || Date.now() + NONCE_TTL_MS,
    displayName:
      typeof displayName === 'string' && displayName
        ? displayName.slice(0, MAX_DISPLAY_NAME_LENGTH)
        : null,
    connectedAt: Date.now(),
  });
  return sid;
}

/**
 * Validate a cookie session id AND ensure it was minted for this exact
 * `expectedSessionPath`. Returns the record on success, null on
 * missing/expired/bound-to-another-session. Expired records are deleted
 */
function validateSession(sid, expectedSessionPath) {
  if (!sid) return null;
  const r = sessions.get(sid);
  if (!r) return null;
  if (Date.now() > r.expiresAt) {
    sessions.delete(sid);
    return null;
  }
  // Bind the cookie to the session it was minted for. Without this, a SID
  // minted on one server instance would authorize against any other
  // instance in the same process (rare, but a real defensive gap).
  if (expectedSessionPath && r.sessionPath !== expectedSessionPath) {
    return null;
  }
  return r;
}

/**
 * Parse a Cookie header into a `{ name: value }` map. URL-decodes values.
 * Tolerant of malformed pairs (skips them).
 */
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    if (!name) continue;
    const raw = pair.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch (_) {
      out[name] = raw;
    }
  }
  return out;
}

/**
 * Build a `Set-Cookie` value for a session id. Cookie attributes:
 * `HttpOnly; Secure; SameSite=Strict; Path=/` (no `Domain=`); `Max-Age`
 * is matched to the session's `expiresAt`.
 */
function buildSessionCookie(sid, record) {
  const maxAge = Math.max(1, Math.floor((record.expiresAt - Date.now()) / 1000));
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sid)}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

/**
 * Serialize a session envelope to JSON with no whitespace for SSE.
 * @param {object} envelope
 */
function jsonStringify(envelope) {
  return JSON.stringify(envelope);
}

/**
 * Read the full request body into a Buffer.
 * @param {http.IncomingMessage} req
 * @param {number} limit - max bytes (default 1 MiB)
 * @returns {Promise<Buffer>}
 */
function readBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/**
 * Extract a credential from the request. Order of preference:
 *   1. `review-sid` cookie (durable per-device, validated against `sessions`).
 *   2. `Authorization: Bearer <token>` header.
 *   3. `?token=<token>` query parameter (used by SSE clients that cannot
 *      easily set headers on `EventSource`).
 * @param {http.IncomingMessage} req
 * @param {URL} url
 * @returns {{ kind: 'cookie'|'bearer'|'query', value: string }|null}
 */
function tokenFromRequest(req, url) {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE_NAME]) {
    return { kind: 'cookie', value: cookies[SESSION_COOKIE_NAME] };
  }
  const auth = req.headers['authorization'];
  if (typeof auth === 'string') {
    const m = /^Bearer\s+(\S+)$/.exec(auth);
    if (m) return { kind: 'bearer', value: m[1] };
  }
  const q = url.searchParams.get('token');
  if (q) return { kind: 'query', value: q };
  return null;
}

/**
 * Apply `Referrer-Policy: no-referrer` to every response. Returns the
 * header object so callers can extend it (e.g. add `content-type`).
 */
function securityHeaders(extra) {
  return Object.assign(
    { 'referrer-policy': 'no-referrer' },
    extra || {},
  );
}

/**
 * Write a JSON response. Sets `Content-Type: application/json`,
 * `Referrer-Policy: no-referrer`, and a `Cache-Control: no-store` header
 * so clients always revalidate against the server.
 * @param {http.ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function writeJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, securityHeaders({
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
    'cache-control': 'no-store',
  }));
  res.end(data);
}

/**
 * Write a 302 redirect. Sets `Referrer-Policy: no-referrer` and an empty
 * body. Caller is responsible for any `Set-Cookie` header.
 */
function writeRedirect(res, location, setCookie) {
  const headers = {
    location,
    'content-length': 0,
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  };
  if (setCookie) headers['set-cookie'] = setCookie;
  res.writeHead(302, headers);
  res.end();
}

/**
 * @typedef {object} ServerOptions
 * @property {string} sessionPath - path to the session JSON file
 * @property {string} token - bearer token required on every API route
 * @property {string} [host] - bind host (default 127.0.0.1)
 * @property {number} [port] - bind port (default 0 = random)
 * @property {string} [uiDir] - static UI directory (served at `/`)
 * @property {string} [artifactPath] - where to write the response snapshot
 * @property {(msg: string) => void} [logError]
 * @property {boolean} [open=false] - attempt to open the share URL
 *   (`<origin>/api/exchange?nonce=<id>`) in the user's default browser
 *   after binding. The opener is invoked fire-and-forget; the returned
 *   `openResult` Promise resolves with `{ opened, reason?, command? }` so
 *   the caller can decide whether to log a fallback. NEVER log the share
 *   URL — the bearer is never present but a single-use nonce is.
 * @property {object} [openerOpts] - forwarded to `openUrl`; allows tests
 *   to inject a `platform` and a stub `spawn`.
 * @property {string} [tunnelUrl] - if set, this is used as the public
 *   share URL origin (e.g. `https://xyz.trycloudflare.com`) instead of
 *   the local bind URL. The nonce-bearing share URL is rewritten so the
 *   reviewer lands on the tunnel, not the local server.
 */

/**
 * Start the refinement-review server.
 */
async function startServer(opts) {
  if (!opts || typeof opts.sessionPath !== 'string')
    throw new Error('sessionPath is required');
  if (typeof opts.token !== 'string' || !opts.token)
    throw new Error('token is required');

  const host = opts.host || DEFAULT_HOST;
  const explicitPort = opts.port !== undefined ? opts.port : DEFAULT_PORT;
  const uiDir = opts.uiDir ? path.resolve(opts.uiDir) : null;
  const artifactPath =
    opts.artifactPath || `${opts.sessionPath}.response.json`;
  const log = opts.log || (() => {});
  const logError = opts.logError || log;
  // Long-lived mode: default and validate TTL. The invite and the TTL timer
  // both consume this normalised value so they agree.
  const ttlMs = opts.longLived === true
    ? (Number.isFinite(opts.ttlMs) && opts.ttlMs > 0 ? opts.ttlMs : 6 * 60 * 60 * 1000)
    : null;
  // Resolves with `{ artifactPath, session }` when the reviewer hits Complete
  // in the UI (POST /api/complete). Rejects if completion fails. Foreground
  // launchers should `await` this instead of polling the artifact file.
  let resolveCompleted, rejectCompleted;
  const completed = new Promise((resolve, reject) => {
    resolveCompleted = resolve;
    rejectCompleted = reject;
  });
  const subscribers = new Set();
  /**
   * Presence map (long-lived mode only). `sid` is the cookie session id
   * from the request's `review-sid` cookie; a single sid may own several
   * concurrent EventSource connections (multi-tab reviewers). The
   * refcount keeps the row visible to other viewers until the LAST
   * connection closes.
   */
  const viewers = new Map();

  /**
   * TTL timer (long-lived mode only). When `opts.ttlMs` is set, the
   * server self-stops after that duration. `unref()` so the timer
   * alone never keeps the loop alive.
   */
  let ttlTimer = null;

  /**
   * Serialise the viewers list for SSE broadcast. Returns an array of
   * `{ name, connectedAt }` derived from the in-memory map. The sid
   * (cookie session id) is never broadcast — it is the bearer credential
   * and must not leak to other clients.
   */
  function viewersPayload() {
    const list = [];
    for (const v of viewers.values()) {
      list.push({ name: v.name, connectedAt: v.connectedAt });
    }
    return list;
  }

/**
 * Close every active SSE subscriber and clear in-process state. Called
 * before `server.close()` (from `stop()`) so the close callback can
 * fire without waiting for long-lived EventSource connections to drain
 * — without this, the TTL path would hang waiting for SSE sockets and
 * `completed` would never settle. Also called from POST /api/complete
 * for the same reason. The presence map is cleared so a restart cannot
 * inherit stale viewer rows.
 */
function tearDownSseSubscribers() {
  for (const sub of subscribers) {
    try {
      sub.end();
    } catch (_) {
      /* already closed */
    }
  }
  subscribers.clear();
  viewers.clear();
}


  /**
   * Broadcast the current viewers list to every SSE subscriber. Same
   * per-subscriber error handling as `broadcast`.
   */
  function broadcastViewers() {
    const payload = `event: viewers\ndata: ${JSON.stringify(viewersPayload())}\n\n`;
    for (const res of subscribers) {
      try {
        res.write(payload);
      } catch (e) {
        logError(`sse write failed: ${e.message}`);
      }
    }
  }

  /**
   * Record a new SSE connection for a viewer. Returns `true` if this
   * transition added a NEW viewer (caller should broadcast), `false`
   * if the sid was already present (caller should NOT broadcast — the
   * visible set did not change).
   */
  function addViewer(sid, displayName) {
    const existing = viewers.get(sid);
    if (existing) {
      existing.count += 1;
      return false;
    }
    viewers.set(sid, {
      name: displayName || 'anonymous',
      connectedAt: Date.now(),
      count: 1,
    });
    return true;
  }

  /**
   * Remove an SSE connection for a viewer. Returns `true` if this
   * transition removed the viewer from the map (caller should broadcast),
   * `false` if there are still other connections owned by the same sid.
   */
  function removeViewer(sid) {
    const existing = viewers.get(sid);
    if (!existing) return false;
    existing.count -= 1;
    if (existing.count > 0) return false;
    viewers.delete(sid);
    return true;
  }

  /**
   * Start the TTL timer. After `ttlMs` the server calls `stop()` which
   * closes the listener and any active SSE connections. Idempotent — a
   * second call replaces the prior timer.
   */
  function startTtl(ttlMs) {
    if (typeof ttlMs !== 'number' || !Number.isFinite(ttlMs) || ttlMs <= 0) return;
    clearTimeout(ttlTimer);
    ttlTimer = setTimeout(() => {
      log(`refinement-review TTL (${ttlMs}ms) reached; stopping`);
      stop().catch((e) => logError(`stop after TTL failed: ${e.message}`));
    }, ttlMs);
    if (typeof ttlTimer.unref === 'function') ttlTimer.unref();
  }

  /**
   * Cancel the TTL timer. Called by `stop()` so a TTL expiry never
   * re-fires after the server has already been torn down.
   */
  function clearTtl() {
    if (ttlTimer) {
      clearTimeout(ttlTimer);
      ttlTimer = null;
    }
  }
  /** Serializes mutation-driven persistence so two concurrent writers don't trample each other. */
  let writeChain = Promise.resolve();

  /**
   * Broadcast the current envelope to every SSE subscriber. Errors per
   * subscriber are logged but never thrown — one slow client must not
   * break the broadcast for the rest.
   */
  function broadcast(envelope) {
    const payload = `event: session\ndata: ${jsonStringify(envelope)}\n\n`;
    for (const res of subscribers) {
      try {
        res.write(payload);
      } catch (e) {
        logError(`sse write failed: ${e.message}`);
      }
    }
  }

  /**
   * Run a mutation through session.mutateSession, then broadcast the result.
   * All write paths serialize on `writeChain` so two concurrent requests
   * never race against the persisted JSON.
   */
  function mutate(expectedRevision, mutator) {
    const job = writeChain.then(async () => {
      const next = session.mutateSession({
        sessionPath: opts.sessionPath,
        expectedRevision,
        mutate: mutator,
      });
      broadcast(next);
      return next;
    });
    writeChain = job.catch(() => undefined);
    return job;
  }

  /**
   * Per-request handler. Resolves with nothing; routes return via `res`.
   */
  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const method = req.method || 'GET';

    // -------------------------------------------------------------------
    // /api/exchange: cookie session id from a single-use nonce.
    // This route does NOT require a credential — the nonce IS the credential.
    // It is intentionally placed before the static-UI branch AND the bearer
    // gate, so that a reviewer following a share URL can land here even if
    // they don't yet have a cookie or bearer.
    // -------------------------------------------------------------------
    // /api/exchange: two paths, gated by `opts.longLived`.
    //   - long-lived: validate invite (multi-use), serve HTML form
    //   - default: validate nonce (single-use), mint cookie + redirect
    //
    // /api/identify (long-lived only): POST { name, invite } mints the
    // cookie session bound to a display name. The invite is the
    // credential; the bearer gate does not apply.
    // -------------------------------------------------------------------
    if (method === 'GET' && url.pathname === '/api/exchange') {
      if (opts.longLived === true) {
        const inviteId = url.searchParams.get('invite');
        if (!inviteId) {
          writeJson(res, 400, { error: 'invite required' });
          return;
        }
        const invite = validateInvite(inviteId);
        if (!invite) {
          const hint = shareCredentialHint('invite', opts);
          if (wantsHtml(req)) {
            writeShareDiagnostic(res, 'invite', hint);
            return;
          }
          writeJson(res, 401, { error: 'invalid or expired invite', hint });
          return;
        }
        const html = renderIdentifyForm(inviteId);
        res.writeHead(200, securityHeaders({
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        }));
        res.end(html);
        return;
      }
      const nonceId = url.searchParams.get('nonce');
      if (!nonceId) {
        writeJson(res, 400, { error: 'nonce required' });
        return;
      }
      // Probe-only peek: probes (Authorization bearer check) MUST NOT mutate
      // the nonce map. But this route is the legitimate exchange endpoint, so
      // we burn the nonce. If the probe was wrong, the next legitimate
      // request gets a 401 (no nonce), which is the correct behavior.
      const record = consumeNonce(nonceId);
      if (!record) {
        const hint = shareCredentialHint('nonce', opts);
        if (wantsHtml(req)) {
          writeShareDiagnostic(res, 'nonce', hint);
          return;
        }
        writeJson(res, 401, { error: 'invalid or expired nonce', hint });
        return;
      }
      const sid = mintSession({
        sessionPath: record.sessionPath,
        permissions: record.permissions,
        expiresAt: record.sessionExpiresAt || Date.now() + NONCE_TTL_MS,
      });
      const sessionRec = sessions.get(sid);
      const cookie = buildSessionCookie(sid, sessionRec);
      // Redirect back to the SPA root with the nonce stripped from the URL.
      writeRedirect(res, '/', cookie);
      return;
    }
    if (method === 'POST' && url.pathname === '/api/identify' && opts.longLived === true) {
      let body;
      try {
        body = parseIdentifyBody(await readBody(req));
      } catch (e) {
        writeJson(res, 400, { error: 'invalid body' });
        return;
      }
      const inviteId = body && body.invite;
      if (typeof inviteId !== 'string' || !inviteId) {
        writeJson(res, 401, { error: 'invite required' });
        return;
      }
      const invite = validateInvite(inviteId);
      if (!invite) {
        writeJson(res, 401, { error: 'invalid or expired invite' });
        return;
      }
      const name = body && typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        writeJson(res, 400, { error: 'name required' });
        return;
      }
      if (name.length > MAX_DISPLAY_NAME_LENGTH) {
        writeJson(res, 400, { error: 'name too long' });
        return;
      }
      const sid = mintSession({
        sessionPath: invite.sessionPath,
        permissions: invite.permissions,
        expiresAt: invite.sessionExpiresAt,
        displayName: name,
      });
      const sessionRec = sessions.get(sid);
      const cookie = buildSessionCookie(sid, sessionRec);
      writeRedirect(res, '/', cookie);
      return;
    }

    // Static UI: anything not under /api is served from uiDir. In long-lived
    // mode the document is gated behind identification, so a valid cookie is
    // required before serving the static branch.
    const isApi = url.pathname.startsWith('/api/');
    if (!isApi) {
      if (opts.longLived === true) {
        const cookieCred = tokenFromRequest(req, url);
        const cookieRec = cookieCred && cookieCred.kind === 'cookie'
          ? validateSession(cookieCred.value, opts.sessionPath)
          : null;
        if (!cookieRec) {
          writeJson(res, 401, { error: 'unauthorized' });
          return;
        }
      }
      if (!uiDir) {
        res.writeHead(404, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
        res.end('not found');
        return;
      }
      // Resolve a safe file path; reject anything that escapes uiDir.
      let rel = decodeURIComponent(url.pathname);
      if (rel === '/') rel = '/index.html';
      const filePath = path.join(uiDir, rel);
      if (!filePath.startsWith(uiDir + path.sep) && filePath !== uiDir) {
        res.writeHead(403, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
        res.end('forbidden');
        return;
      }
      fs.stat(filePath, (err, st) => {
        if (err || !st.isFile()) {
          res.writeHead(404, securityHeaders({ 'content-type': 'text/plain; charset=utf-8' }));
          res.end('not found');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const ct =
          ext === '.html'
            ? 'text/html; charset=utf-8'
            : ext === '.js'
              ? 'application/javascript; charset=utf-8'
              : ext === '.css'
                ? 'text/css; charset=utf-8'
                : ext === '.json'
                  ? 'application/json; charset=utf-8'
                  : 'application/octet-stream';
        res.writeHead(200, securityHeaders({
          'content-type': ct,
          'content-length': st.size,
          'cache-control': 'no-store',
        }));
        fs.createReadStream(filePath).pipe(res);
      });
      return;
    }
    // All other API routes require a credential. Cookie is preferred
    // (durable per-device), then bearer, then query (SSE only).
    const cred = tokenFromRequest(req, url);
    if (!cred) {
      writeJson(res, 401, { error: 'unauthorized' });
      return;
    }
    // Long-lived mode: identification is the only path to API access. Even
    // the operator bearer token is rejected — only cookie sessions minted by
    // /api/identify after a valid invite are allowed.
    if (opts.longLived === true && cred.kind !== 'cookie') {
      writeJson(res, 401, { error: 'unauthorized' });
      return;
    }
    if (cred.kind === 'cookie') {
      const rec = validateSession(cred.value, opts.sessionPath);
      if (!rec) {
        writeJson(res, 401, { error: 'invalid session' });
        return;
      }
    } else if (cred.value !== opts.token) {
      writeJson(res, 401, { error: 'unauthorized' });
      return;
    }

    // SSE: GET /api/events (cookie preferred; token via query param for
    // EventSource clients that cannot set headers). In long-lived mode,
    // also tracks presence: each connected tab refcounts the cookie sid
    // in the viewers map and broadcasts `event: viewers` on 0<->1 transitions.
    if (method === 'GET' && url.pathname === '/api/events') {
      const envelope = session.loadSession(opts.sessionPath);
      if (envelope.completedAt) {
        writeJson(res, 410, { error: 'session completed' });
        return;
      }
      // Presence (long-lived only): resolve the cookie session sid. The
      // sid is NEVER broadcast — it is the bearer credential.
      let viewerSid = null;
      let viewerName = null;
      if (opts.longLived === true) {
        const cookies = parseCookies(req.headers.cookie);
        const sid = cookies[SESSION_COOKIE_NAME];
        if (sid) {
          const rec = validateSession(sid, opts.sessionPath);
          if (rec) {
            viewerSid = sid;
            viewerName = rec.displayName || 'anonymous';
          }
        }
      }
      res.writeHead(200, securityHeaders({
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      }));
      // Initial snapshot.
      res.write(`event: session\ndata: ${jsonStringify(envelope)}\n\n`);
      // Track presence BEFORE writing/broadcasting the viewers list, so
      // this response receives the up-to-date payload (including itself).
      let viewerAdded = false;
      if (opts.longLived === true && viewerSid) {
        viewerAdded = addViewer(viewerSid, viewerName);
      }
      subscribers.add(res);
      if (opts.longLived === true && viewerSid) {
        res.write(`event: viewers\ndata: ${JSON.stringify(viewersPayload())}\n\n`);
        if (viewerAdded) {
          broadcastViewers();
        }
      }
      subscribers.add(res);
      const heartbeat = setInterval(() => {
        try {
          res.write(': heartbeat\n\n');
        } catch (_) {
          /* socket closed */
        }
      }, PROXY_KEEPALIVE_INTERVAL_MS);
      // Don't let the heartbeat alone keep the loop alive once everything
      // else has settled (tests, dev tooling).
      if (typeof heartbeat.unref === 'function') heartbeat.unref();
      req.on('close', () => {
        clearInterval(heartbeat);
        subscribers.delete(res);
        if (opts.longLived === true && viewerSid) {
          // Cleanup fires on TCP close (the only reliable EventSource
          // signal). Decrement the per-sid refcount; broadcast only when
          // the last connection for this sid closes.
          if (removeViewer(viewerSid)) {
            broadcastViewers();
          }
        }
      });
      return;
    }

    // GET /api/session
    if (method === 'GET' && url.pathname === '/api/session') {
      const envelope = session.loadSession(opts.sessionPath);
      writeJson(res, 200, envelope);
      return;
    }
    // GET /api/overview — customer-facing summary for the approval tab.
    // Prefers the summary authored by the refinement command; falls back to
    // deriving one from the source markdown. Never 5xx's on an unreadable
    // derivation: an empty payload renders as the UI's empty state.
    if (method === 'GET' && url.pathname === '/api/overview') {
      const envelope = session.loadSession(opts.sessionPath);
      const authored = envelope.document.customerSummary;
      if (typeof authored === 'string' && authored.trim()) {
        writeJson(res, 200, {
          source: 'authored',
          title: `${envelope.document.kind.toUpperCase()} overview`,
          markdown: authored,
        });
        return;
      }
      let derived = { title: 'Product overview', markdown: '', source: 'empty' };
      try {
        derived = overview.deriveCustomerOverview(
          fs.readFileSync(envelope.document.sourcePath, 'utf8'),
        );
      } catch {
        // Unreadable source (moved/deleted mid-session): empty state, not an error.
      }
      writeJson(res, 200, derived);
      return;
    }
    // GET /api/me (long-lived only): returns the cookie session's
    // display name so the SPA can auto-populate the author field
    // without forcing the reviewer to retype. Keeps the envelope
    // shape unchanged and adds nothing to the persisted session.
    if (method === 'GET' && url.pathname === '/api/me' && opts.longLived === true) {
      const cookies = parseCookies(req.headers.cookie);
      const sid = cookies[SESSION_COOKIE_NAME];
      const rec = sid ? validateSession(sid, opts.sessionPath) : null;
      if (!rec) {
        writeJson(res, 401, { error: 'unauthorized' });
        return;
      }
      writeJson(res, 200, { name: rec.displayName || 'anonymous', connectedAt: rec.connectedAt || null });
      return;
    }


    // GET /api/document
    if (method === 'GET' && url.pathname === '/api/document') {
      const envelope = session.loadSession(opts.sessionPath);
      const content = fs.readFileSync(envelope.document.sourcePath);
      const etag = `"${envelope.document.sha256}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, securityHeaders());
        res.end();
        return;
      }
      res.writeHead(200, securityHeaders({
        'content-type': 'text/markdown; charset=utf-8',
        'content-length': content.length,
        etag,
        'cache-control': 'no-store',
      }));
      res.end(content);
      return;
    }

    // PATCH /api/questions/:id
    if (method === 'PATCH' && url.pathname.startsWith('/api/questions/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/questions/'.length));
      let body;
      try {
        body = JSON.parse((await readBody(req)).toString('utf8'));
      } catch (e) {
        writeJson(res, 400, { error: 'invalid json' });
        return;
      }
      try {
        const next = mutate(body.revision, (s) => {
          const q = s.questions.find((x) => x.id === id);
          if (!q) throw Object.assign(new Error('question not found'), { status: 404 });
          if (!['open', 'answered', 'skipped'].includes(body.status))
            throw Object.assign(new Error('invalid status'), { status: 400 });
          if (typeof body.author !== 'string' || !body.author)
            throw Object.assign(new Error('author required'), { status: 400 });
          if (body.selectedOptionId !== undefined && body.selectedOptionId !== null) {
            if (typeof body.selectedOptionId !== 'string' || !body.selectedOptionId)
              throw Object.assign(new Error('selectedOptionId must be non-empty string or null'), { status: 400 });
            if (!Array.isArray(q.options) || !q.options.some((o) => o.id === body.selectedOptionId))
              throw Object.assign(new Error(`selectedOptionId '${body.selectedOptionId}' does not match any option.id`), { status: 400 });
          }
          q.status = body.status;
          q.answer = body.answer ?? q.answer;
          q.selectedOptionId = body.selectedOptionId === undefined ? q.selectedOptionId : body.selectedOptionId;
          q.author = body.author;
          q.updatedAt = new Date().toISOString();
        });
        writeJson(res, 200, await next);
      } catch (e) {
        writeJson(res, e.status || 500, {
          error: e.message,
          code: e.code,
          currentRevision: e.currentRevision,
        });
      }
      return;
    }

    // POST /api/comments
    if (method === 'POST' && url.pathname === '/api/comments') {
      let body;
      try {
        body = JSON.parse((await readBody(req)).toString('utf8'));
      } catch (e) {
        writeJson(res, 400, { error: 'invalid json' });
        return;
      }
      try {
        const next = mutate(body.revision, (s) => {
          if (typeof body.body !== 'string' || !body.body)
            throw Object.assign(new Error('body required'), { status: 400 });
          if (typeof body.author !== 'string' || !body.author)
            throw Object.assign(new Error('author required'), { status: 400 });
          // Validate anchor bounds against current document length.
          if (body.anchor !== null && body.anchor !== undefined) {
            const content = fs.readFileSync(s.document.sourcePath, 'utf8');
            const totalLines = content.split(/\r\n|\r|\n/).length;
            const err = session.validateAnchor(body.anchor, totalLines);
            if (err) throw Object.assign(new Error(err), { status: 400 });
          }
          s.comments.push({
            id: session.newId(),
            body: body.body,
            anchor: body.anchor ?? null,
            author: body.author,
            createdAt: new Date().toISOString(),
            resolvedAt: null,
          });
        });
        writeJson(res, 201, await next);
      } catch (e) {
        writeJson(res, e.status || 500, {
          error: e.message,
          code: e.code,
          currentRevision: e.currentRevision,
        });
      }
      return;
    }

    // PATCH /api/comments/:id
    if (method === 'PATCH' && url.pathname.startsWith('/api/comments/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/comments/'.length));
      let body;
      try {
        body = JSON.parse((await readBody(req)).toString('utf8'));
      } catch (e) {
        writeJson(res, 400, { error: 'invalid json' });
        return;
      }
      try {
        const next = mutate(body.revision, (s) => {
          const c = s.comments.find((x) => x.id === id);
          if (!c) throw Object.assign(new Error('comment not found'), { status: 404 });
          if (typeof body.author !== 'string' || !body.author)
            throw Object.assign(new Error('author required'), { status: 400 });
          if (body.body !== undefined) {
            if (typeof body.body !== 'string' || !body.body)
              throw Object.assign(new Error('body must be non-empty string'), { status: 400 });
            c.body = body.body;
          }
          if (body.resolved === true) c.resolvedAt = new Date().toISOString();
          if (body.resolved === false) c.resolvedAt = null;
        });
        writeJson(res, 200, await next);
      } catch (e) {
        writeJson(res, e.status || 500, {
          error: e.message,
          code: e.code,
          currentRevision: e.currentRevision,
        });
      }
      return;
    }

    // POST /api/approval — record the customer's sign-off on the concept.
    // Routed through `mutate` so it serializes with question/comment writes
    // and broadcasts over SSE. A later decision overwrites the earlier one.
    if (method === 'POST' && url.pathname === '/api/approval') {
      let body;
      try {
        body = JSON.parse((await readBody(req)).toString('utf8'));
      } catch (e) {
        writeJson(res, 400, { error: 'invalid json' });
        return;
      }
      try {
        const next = await mutate(body.revision, (s) => {
          if (typeof body.author !== 'string' || !body.author.trim())
            throw Object.assign(new Error('author required'), { status: 400 });
          if (body.decision !== 'approved' && body.decision !== 'changes-requested')
            throw Object.assign(new Error('decision must be "approved" or "changes-requested"'), { status: 400 });
          if (body.note !== undefined && body.note !== null && typeof body.note !== 'string')
            throw Object.assign(new Error('note must be string or null'), { status: 400 });
          if (body.decision === 'changes-requested' && !(body.note && body.note.trim()))
            throw Object.assign(new Error('note required when requesting changes'), { status: 400 });
          s.approval = {
            decision: body.decision,
            author: body.author,
            note: body.note ? body.note : null,
            decidedAt: new Date().toISOString(),
          };
        });
        writeJson(res, 200, next);
      } catch (e) {
        writeJson(res, e.status || 500, {
          error: e.message,
          code: e.code,
          currentRevision: e.currentRevision,
        });
      }
      return;
    }

    // POST /api/complete
    if (method === 'POST' && url.pathname === '/api/complete') {
      let body;
      try {
        body = JSON.parse((await readBody(req)).toString('utf8'));
      } catch (e) {
        writeJson(res, 400, { error: 'invalid json' });
        return;
      }
      try {
        const finalSession = await mutate(body.revision, (s) => {
          if (typeof body.author !== 'string' || !body.author)
            throw Object.assign(new Error('author required'), { status: 400 });
          s.completedAt = new Date().toISOString();
          s.completedBy = body.author;
        });

        // Persist the response artifact.
        const artifact = {
          schemaVersion: 1,
          sessionId: finalSession.sessionId,
          completedAt: finalSession.completedAt,
          completedBy: finalSession.completedBy,
          document: {
            kind: finalSession.document.kind,
            sourcePath: finalSession.document.sourcePath,
            sha256: finalSession.document.sha256,
          },
          questions: finalSession.questions.map((q) => ({
            id: q.id,
            prompt: q.prompt,
            context: q.context,
            targetAnchor: q.targetAnchor,
            options: q.options,
            recommendedOptionId: q.recommendedOptionId,
            selectedOptionId: q.selectedOptionId,
            status: q.status,
            answer: q.answer,
            author: q.author,
            updatedAt: q.updatedAt,
          })),
          comments: finalSession.comments.map((c) => ({
            id: c.id,
            body: c.body,
            anchor: c.anchor,
            author: c.author,
            createdAt: c.createdAt,
            resolvedAt: c.resolvedAt,
          })),
          approval: finalSession.approval || null,
        };
        session.writeJsonAtomic(artifactPath, artifact);

        // Close all SSE clients; the session is gone. Reusing the
        // helper so /api/complete and stop() behave identically.
        tearDownSseSubscribers();

        writeJson(res, 200, { artifactPath, session: finalSession });
        resolveCompleted({ artifactPath, session: finalSession });

        // Long-lived mode: completion terminates the listener so reviewers
        // don't leave a port bound indefinitely. schedule on next tick so
        // the 200 response can flush before the socket closes.
        if (opts.longLived === true) {
          setImmediate(() => { stop().catch(() => {}); });
        }
      } catch (e) {
        writeJson(res, e.status || 500, {
          error: e.message,
          code: e.code,
          currentRevision: e.currentRevision,
        });
      }
      return;
    }

    writeJson(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      logError(`unhandled: ${err && err.message}`);
      if (!res.headersSent) writeJson(res, 500, { error: 'internal' });
      else res.end();
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(explicitPort, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  // Long-lived mode: schedule self-termination after the normalised TTL.
  if (opts.longLived === true && ttlMs !== null) {
    startTtl(ttlMs);
  }

  const addr = server.address();
  if (!addr || typeof addr === 'string')
    throw new Error('failed to bind server');

  log(`refinement-review listening on http://${addr.address}:${addr.port}`);

  // Local URL (used for the listen path).
  const localUrl = `http://${addr.address}:${addr.port}`;

  // Public origin (used for the share URL). If a tunnel is in play, the
  // bootstrap passes `opts.tunnelUrl` and we use that; otherwise we use
  // the local URL.
  const publicOrigin = opts.tunnelUrl
    ? String(opts.tunnelUrl).replace(/\/+$/, '')
    : localUrl;

  // Mint the share URL credential. Two modes:
  //   - long-lived: multi-use invite (no burn on POST /api/identify);
  //     URL is /api/exchange?invite=<id>.
  //   - default: single-use nonce (burned on GET /api/exchange).
  let shareNonce = null;
  let shareInvite = null;
  let reviewUrl;
  if (opts.longLived === true) {
    shareInvite = mintInvite({
      sessionPath: opts.sessionPath,
      permissions: 'reviewer',
      sessionExpiresAt: ttlMs !== null ? Date.now() + ttlMs : Date.now() + NONCE_TTL_MS,
    });
    reviewUrl = `${publicOrigin}/api/exchange?invite=${shareInvite}`;
  } else {
    shareNonce = mintNonce({
      sessionPath: opts.sessionPath,
      permissions: 'reviewer',
      sessionExpiresAt: Date.now() + NONCE_TTL_MS,
    });
    reviewUrl = `${publicOrigin}/api/exchange?nonce=${shareNonce}`;
  }

  // Fire-and-forget; do not block server startup on the opener. The Promise
  // is returned to the caller so the bootstrap can decide whether to await
  // it for UX feedback. Any rejection (which `openUrl` already catches and
  // converts to a structured result) is also captured here as a final
  // safety net.
  let openResult = null;
  if (opts.open === true) {
    const openerOpts = opts.openerOpts || {};
    openResult = openUrl(reviewUrl, openerOpts).catch((e) => ({
      opened: false,
      reason: 'exception',
      error: e && e.message,
    }));
  }

  let stopped = false;
  function stop() {
    return new Promise((resolve) => {
      if (stopped) {
        resolve();
        return;
      }
      stopped = true;
      clearTtl();
      // Close any active SSE subscribers BEFORE server.close() so the
      // close callback can fire without waiting for long-lived
      // EventSource connections to drain. Without this, the TTL path
      // hangs waiting for SSE sockets and `completed` never settles.
      tearDownSseSubscribers();
      server.close(() => {
        // Stop without /api/complete still settles `completed` so foreground
        // bootstraps can exit cleanly when the TTL timer fires (long-lived
        // mode) or when the caller tears down manually. /api/complete wins
        // because it sets completedBy/completedAt and resolves first.
        if (resolveCompleted) {
          resolveCompleted({ artifactPath, session: null, stopped: true });
          resolveCompleted = null;
          rejectCompleted = null;
        }
        resolve();
      });
    });
  }

  // Mutable result object. The bootstrap can call `setTunnelUrl(...)` once
  // cloudflared publishes the public origin; the share-nonce is re-minted
  // against the new origin and the opener (if requested at startup) is
  // re-fired with the corrected URL.
  const result = {
    url: localUrl,
    publicUrl: publicOrigin,
    host: addr.address,
    port: addr.port,
    address: addr,
    stop,
    completed,
    reviewUrl,
    shareNonce,
    shareInvite,
    longLived: opts.longLived === true,
    openResult,
  };

  /**
   * Update the public origin once a tunnel URL is known, mint a fresh
   * share-nonce against it, and rewrite the reviewUrl. If the server was
   * started with `open: true`, the opener is re-fired with the new URL
   * (the previous openResult is left as-is for caller introspection).
   *
   * Calling with the same URL is a no-op. Calling more than once
   * produces a fresh nonce each time; the caller is responsible for
   * not burning old nonces.
   *
   * @param {string} tunnelUrl
   * @returns {{ reviewUrl: string, shareNonce: string, publicUrl: string }}
   */
  function setTunnelUrl(tunnelUrl) {
    if (!tunnelUrl || typeof tunnelUrl !== 'string') {
      throw new TypeError('setTunnelUrl: tunnelUrl must be a non-empty string');
    }
    const newOrigin = String(tunnelUrl).replace(/\/+$/, '');
    let newReviewUrl;
    if (result.longLived === true) {
      const newInvite = mintInvite({
        sessionPath: opts.sessionPath,
        permissions: 'reviewer',
        sessionExpiresAt: ttlMs !== null ? Date.now() + ttlMs : Date.now() + NONCE_TTL_MS,
      });
      result.shareInvite = newInvite;
      result.shareNonce = null;
      newReviewUrl = `${newOrigin}/api/exchange?invite=${newInvite}`;
    } else {
      const newNonce = mintNonce({
        sessionPath: opts.sessionPath,
        permissions: 'reviewer',
        sessionExpiresAt: Date.now() + NONCE_TTL_MS,
      });
      result.shareNonce = newNonce;
      result.shareInvite = null;
      newReviewUrl = `${newOrigin}/api/exchange?nonce=${newNonce}`;
    }
    result.publicUrl = newOrigin;
    result.reviewUrl = newReviewUrl;
    if (opts.open === true) {
      const openerOpts = opts.openerOpts || {};
      result.openResult = openUrl(newReviewUrl, openerOpts).catch((e) => ({
        opened: false,
        reason: 'exception',
        error: e && e.message,
      }));
    }
    return {
      reviewUrl: result.reviewUrl,
      shareNonce: result.shareNonce,
      shareInvite: result.shareInvite,
      publicUrl: result.publicUrl,
    };
  }

  result.setTunnelUrl = setTunnelUrl;

  /**
   * Mint an additional share URL bound to the current publicUrl. Each call
   * produces a fresh, independent nonce; the original `result.shareNonce` /
   * `result.reviewUrl` are not modified. Use this to fan out multiple
   * reviewer links from a single session (e.g. operator wants N invitees).
   *
   * Unlike `setTunnelUrl`, this does not mutate `publicUrl` and does not
   * re-fire the opener. The returned `shareNonce` is bound to the same
   * `opts.sessionPath` and shares the same 10-minute TTL (`NONCE_TTL_MS`)
   * as the original share URL.
   *
   * @returns {{ reviewUrl: string, shareNonce: string, publicUrl: string }}
   */
  function createShareUrl() {
    if (result.longLived === true) {
      throw new Error('createShareUrl: not available in long-lived mode (use the printed invite URL)');
    }
    const nonce = mintNonce({
      sessionPath: opts.sessionPath,
      permissions: 'reviewer',
      sessionExpiresAt: Date.now() + NONCE_TTL_MS,
    });
    return {
      reviewUrl: `${result.publicUrl}/api/exchange?nonce=${nonce}`,
      shareNonce: nonce,
      publicUrl: result.publicUrl,
    };
  }

  result.createShareUrl = createShareUrl;
  return result;
}


module.exports = {
  startServer,
  DEFAULT_HOST,
  DEFAULT_PORT,
  SESSION_COOKIE_NAME,
  NONCE_TTL_MS,
  // exposed for tests and bootstrap integration
  _internal: {
    tokenFromRequest,
    readBody,
    writeJson,
    writeRedirect,
    parseCookies,
    buildSessionCookie,
    peekNonce,
    consumeNonce,
    mintNonce,
    mintSession,
    validateSession,
    securityHeaders,
    mintInvite,
    validateInvite,
    renderIdentifyForm,
    parseIdentifyBody,
  },
};
