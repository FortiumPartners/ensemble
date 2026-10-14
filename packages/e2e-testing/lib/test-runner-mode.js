'use strict';

/**
 * TRD-011: mode-aware run-config resolution for
 * /ensemble:author-playwright-tests.
 *
 * Pure mapping/config-resolution logic only — this module does not launch
 * Playwright itself (that's runtime behavior when the real session runs
 * against a real target app). It answers one question: given the session's
 * mode (TRD-007's 'headed'|'headless' choice, threaded through
 * delegation-contract.js's `mode` field) and whatever auth state is
 * available, what auth strategy and launch config should the test run use?
 *
 * TRD-037 (found live-dogfooding this feature — the same thread as an
 * earlier "auth state file not found" blocker resurfacing, because this
 * module's documented model still didn't reflect it): mode and auth
 * strategy are ORTHOGONAL, not the same choice wearing two names. This
 * module originally modeled headed as "always a live interactive login, no
 * stored credentials" and headless as "always a stored storage-state file"
 * — but that conflates two independent concerns. Many real Playwright
 * harnesses behind SSO (Entra ID and otherwise) capture ONE stored auth
 * state once, out of band, and reuse it for EVERY run afterward, headed or
 * headless alike — headed/headless there only toggles whether a human is
 * watching the browser, never how authentication happens. So:
 *   - If a stored auth-state path is available, it is used regardless of
 *     mode — mode only ever controls Playwright's `headless` launch option.
 *   - A live interactive login is the FALLBACK, only available when a human
 *     is actually present to perform it (mode === 'headed') and no stored
 *     state was given.
 *   - Headless with no stored state remains impossible — there is no human
 *     present to log in live — reported as a clear error, not a silent
 *     fallback (AC-013-4, TRD-011 Implementation AC unchanged).
 * That stored auth-state file lives in the consuming project, not this
 * repo — this module only ever references its path, never reads/creates it.
 *
 * TRD-036 (found live-dogfooding this feature): a stored storage-state file
 * is scoped to the origin it was captured against. A consuming repo with
 * more than one QA/staging deploy target (per-branch or per-developer slots
 * are a common pattern, not specific to any one project) can resolve a
 * DIFFERENT environment URL from one session to the next — reusing one
 * static authStatePath across every environment produces a session that
 * silently doesn't apply (an auth redirect loop), a failure that looks like
 * a real regression exactly the same way an environment-mismatch test
 * failure does (see grounded-marker-checker.js). deriveAuthStatePath() below
 * derives a per-environment-scoped path from whatever base path a consuming
 * repo already configures, so switching environments naturally uses (or
 * creates) a distinct stored state rather than reusing a stale one from a
 * different origin.
 *
 * Convention: plain functions over plain data, matching this package's
 * existing modules (ac-decision-loop.js, delegation-contract.js,
 * req-batcher.js) — strict validation, no silent defaulting.
 */

const VALID_MODES = ['headed', 'headless'];

/**
 * @typedef {Object} RunConfig
 * @property {'headed'|'headless'} mode
 * @property {boolean} headless - Playwright launch option mirroring mode
 * @property {Object} auth
 * @property {'interactive-login'|'stored-storage-state'} auth.strategy
 * @property {string|null} auth.authStatePath - path to the consuming
 *   project's stored auth-state file when a stored state was provided
 *   (regardless of mode); null when falling back to a live interactive login
 * @property {number} [slowMo] - Playwright `SlowMo` launch option in ms; present
 *   only when a follow-along pause was requested (headed mode only)
 */

/**
 * Follow-along pause (headed only): Playwright's own `SlowMo` launch option
 * delays every browser action so the QA engineer can watch the run. It is a
 * launch option, never test source, so there is nothing to strip before a
 * test lands. Returns `{slowMo}` to spread into the run config, or `{}` when
 * no pause was requested.
 *
 * @throws {Error} if slowMoMs is not a positive integer, or mode is not
 *   'headed' (no human is watching a headless run -- strict, never ignored)
 */
function resolveSlowMo(mode, slowMoMs) {
  if (slowMoMs === undefined || slowMoMs === null) return {};
  if (!Number.isInteger(slowMoMs) || slowMoMs <= 0) {
    throw new Error(`slowMoMs must be a positive integer (milliseconds) when provided (got: ${JSON.stringify(slowMoMs)})`);
  }
  if (mode !== 'headed') {
    throw new Error('slowMoMs only applies to headed mode — no human is watching a headless run');
  }
  return { slowMo: slowMoMs };
}

/**
 * Resolve the auth/launch config a test run should use, given the session's
 * mode and whatever stored auth state is available. See this module's own
 * header (TRD-037) for why mode (visibility) and auth strategy (credential
 * source) are resolved independently rather than one implying the other.
 *
 * @param {'headed'|'headless'} mode - session-wide execution mode (TRD-007);
 *   controls ONLY the Playwright `headless` launch option, never auth strategy
 * @param {string} [authStatePath] - path to the consuming project's stored
 *   auth-state file (see deriveAuthStatePath() when the target repo has more
 *   than one QA/staging deploy target). When present, used regardless of
 *   mode. When absent, mode 'headed' falls back to a live interactive login;
 *   mode 'headless' has no fallback and throws (no human present to log in)
 * @param {{slowMoMs?: number}} [opts] - slowMoMs: follow-along pause in ms
 *   (headed only); see resolveSlowMo. Omit for no pause.
 * @returns {RunConfig}
 * @throws {Error} if mode is not exactly 'headed'|'headless' (no silent
 *   default), if slowMoMs is invalid or given in headless mode, or if mode is
 *   'headless' with no authStatePath provided (can't
 *   run headless with no stored auth state — reported as a clear error
 *   rather than silently falling back to headed or crashing obscurely)
 */
function resolveRunConfig(mode, authStatePath, opts = {}) {
  if (!VALID_MODES.includes(mode)) {
    throw new Error(`Invalid mode '${mode}': must be one of ${VALID_MODES.map((m) => `'${m}'`).join(', ')}`);
  }
  const slowMo = resolveSlowMo(mode, opts.slowMoMs);

  // undefined/null mean "no stored state provided" (fall through to mode's
  // own fallback below); anything else provided must be a valid non-empty
  // string, in EITHER mode -- a stray number/object is almost certainly a
  // caller bug, never silently treated as "no path given" just because the
  // mode happens to have a fallback.
  const wasProvided = authStatePath !== undefined && authStatePath !== null;
  if (wasProvided && (typeof authStatePath !== 'string' || authStatePath.trim() === '')) {
    throw new Error('authStatePath must be a non-empty string when provided');
  }

  if (wasProvided) {
    return {
      mode,
      headless: mode === 'headless',
      auth: { strategy: 'stored-storage-state', authStatePath },
      ...slowMo,
    };
  }

  if (mode === 'headed') {
    return {
      mode: 'headed',
      headless: false,
      auth: { strategy: 'interactive-login', authStatePath: null },
      ...slowMo,
    };
  }

  // headless with no stored auth state -- no human present to log in live
  throw new Error(
    'headless mode requires authStatePath (path to a stored auth-state file) — ' +
      'cannot run headless with no stored auth state'
  );
}

/**
 * TRD-036: derive a per-environment-scoped auth-state path from whatever
 * base path a consuming repo already configures (e.g. "e2e-auth-state.json"
 * or "app-e2e-auth-state.json" — this module has no opinion on naming).
 * A stored storage-state file is scoped to the origin it was captured
 * against; a repo with more than one QA/staging deploy target (per-branch or
 * per-developer slots are common) can resolve a different environment URL
 * from one session to the next, and reusing one static path across every
 * environment silently fails (an auth redirect loop that looks like a real
 * regression). Deriving a distinct path per environment means switching
 * environments naturally uses — or, the first time, needs to create — its
 * own stored state rather than reusing a stale one from a different origin.
 *
 * Purely a path-string transform: no file I/O, no knowledge of whether the
 * derived path actually exists yet. A caller hitting a missing derived file
 * for a never-before-used environment is an expected, not exceptional,
 * outcome — see this function's own header for why.
 *
 * @param {string} baseAuthStatePath - the consuming repo's configured base
 *   auth-state path, e.g. "secrets/e2e-auth-state.json"
 * @param {string} qaEnvUrl - the resolved QA/staging environment URL (e.g.
 *   qa-env-guard.js's resolveQaEnvUrl() output)
 * @returns {string} baseAuthStatePath with a sanitized, environment-specific
 *   token inserted before its extension, e.g.
 *   "secrets/e2e-auth-state.qa-example-com.json"
 * @throws {Error} if either argument is missing/blank
 */
function deriveAuthStatePath(baseAuthStatePath, qaEnvUrl) {
  if (typeof baseAuthStatePath !== 'string' || baseAuthStatePath.trim() === '') {
    throw new Error('deriveAuthStatePath requires a non-empty baseAuthStatePath');
  }
  if (typeof qaEnvUrl !== 'string' || qaEnvUrl.trim() === '') {
    throw new Error('deriveAuthStatePath requires a non-empty qaEnvUrl');
  }

  const token = qaEnvUrl
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  const lastDot = baseAuthStatePath.lastIndexOf('.');
  const lastSlash = Math.max(baseAuthStatePath.lastIndexOf('/'), baseAuthStatePath.lastIndexOf('\\'));
  // Only treat a "." as an extension separator if it comes after the last
  // path separator — otherwise a dotted directory name would get split instead.
  if (lastDot > lastSlash) {
    return `${baseAuthStatePath.slice(0, lastDot)}.${token}${baseAuthStatePath.slice(lastDot)}`;
  }
  return `${baseAuthStatePath}.${token}`;
}

module.exports = { resolveRunConfig, deriveAuthStatePath, VALID_MODES };
