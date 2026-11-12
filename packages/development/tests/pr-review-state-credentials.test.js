'use strict';

/**
 * The shared redactor (`pr-review-state.js` `redact`) on the credential shapes the merge sweep's review found it missing
 * (kata mdfr, review round 1, finding F2): a JSON web token reached the git-tracked bead store unredacted, while a `ghp_`
 * token in the same text was removed. Every value is assembled here, so no line of this file is itself a credential.
 */

const { redact } = require('../lib/pr-review-state');

const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiJ4In0', 'abc123_-DEF456xyz'].join('.');
const UNSIGNED_JWT = ['eyJhbGciOiJub25lIn0', 'eyJzdWIiOiJ4In0', ''].join('.');

const CASES = [
  ['a JSON web token', JWT],
  ['an unsigned JSON web token', UNSIGNED_JWT],
  ['a Stripe live secret key', ['sk', 'live', 'A1b2C3d4E5f6G7h8I9j0K1'].join('_')],
  ['a Stripe live restricted key', ['rk', 'live', 'A1b2C3d4E5f6G7h8I9j0K1'].join('_')],
  ['a Google API key', `AIza${'A1b2C3d4E5'.repeat(3)}f6G7h`],
  ['a GitLab personal access token', ['glpat', 'A1b2C3d4E5f6G7h8I9j0K1'].join('-')],
];

describe('redact: credential shapes that reach the git-tracked bead store', () => {
  test.each(CASES)('%s is removed from running text and from a labelled line', (_name, secret) => {
    expect(redact(`before ${secret} after`)).toBe('before [REDACTED] after');
    const labelled = redact(`Finding: the bot quoted ${secret}`);
    expect(labelled).not.toContain(secret);
    expect(labelled).toContain('[REDACTED]');
  });

  test.each(CASES)('%s is removed inside a value of an object, and redaction is idempotent', (_name, secret) => {
    const once = redact({ body: `quoted ${secret}`, list: [secret] });
    expect(JSON.stringify(once)).not.toContain(secret);
    expect(redact(once)).toEqual(once);
  });

  test('a JSON web token is removed whole: no segment of it is left behind', () => {
    const text = redact(`Authorization was ${JWT}; the rest is prose`);
    for (const part of JWT.split('.')) expect(text).not.toContain(part);
    expect(text).toContain('the rest is prose');
  });

  test('identifiers, hashes and prose that merely look near these shapes survive untouched', () => {
    for (const text of [
      'finding:pr12:comment345',
      'ci-failure:checkrun999',
      'a'.repeat(40),
      'the prefix eyJ marks base64 of a JSON object',
      'version 1.2.3 of a.b.c is fine',
      'see sk_live_ in the docs',
      'glpat- alone',
    ]) {
      expect(redact(text)).toBe(text);
    }
  });
});
