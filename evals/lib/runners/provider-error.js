'use strict';

/**
 * Which failed model calls are infrastructure problems (not the skill's fault) and so make a run `incomplete` rather than `fail`.
 * Only authentication/authorization (401, 403), payment (402), rate limiting (429) and server-side failure or overload
 * (500, 502, 503, 504, 529) count. A request the provider rejected for what was sent (400, 413, 422, "prompt is too long",
 * invalid_request_error, ...) stays an ordinary failure, and so does error text this file cannot place: conservative, because a
 * wrongly excused failure would hide a broken skill (rule 7).
 */

const INFRA_STATUS = new Set([401, 402, 403, 429, 500, 502, 503, 504, 529]);

// A status code stated as one: after "API Error", "status", "HTTP", at the start ("402: {...}", "403 Forbidden"), or as a JSON field.
const STATUS_RES = [
  /\bAPI Error:?\s*(\d{3})\b/i,
  /\bstatus(?:\s*code)?\s*[:=]?\s*(\d{3})\b/i,
  /\bHTTP\/?[\d.]*\s+(\d{3})\b/i,
  /^\s*(?:error:?\s*)?(\d{3})\b/i,
  /"(?:status|status_code|code)"\s*:\s*"?(\d{3})\b/i,
];
const REQUEST_REJECTED_RE = /invalid_request_error|prompt is too long|context[ _]length|context window|max_tokens|request too large|payload too large|unprocessable/i;
const INFRA_TEXT_RE = /not logged in|failed to authenticate|authentication_error|permission_error|invalid x-api-key|unauthorized|insufficient credits|credit balance is too low|rate[ _]limit|overloaded/i;

/** The status code the text states, or null. */
function statusOf(text) {
  for (const re of STATUS_RES) {
    const m = re.exec(text);
    if (m) return Number(m[1]);
  }
  return null;
}

/** True when `text` (an API/CLI error message) names an infrastructure failure. A stated status code decides. */
function isProviderErrorText(text) {
  if (typeof text !== 'string' || !text) return false;
  const status = statusOf(text);
  if (status !== null) return INFRA_STATUS.has(status);
  if (REQUEST_REJECTED_RE.test(text)) return false;
  return INFRA_TEXT_RE.test(text);
}

module.exports = { isProviderErrorText, statusOf, INFRA_STATUS };
