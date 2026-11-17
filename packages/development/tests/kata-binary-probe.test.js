'use strict';

/**
 * Real-binary kata probe (TRD-030, PRD REQ-016). This is the repository's always-present
 * kata-dependent check: it asserts behaviour of the installed `kata` binary, so it goes through
 * the shared guard and is reported skipped, with the reason "tool absent", on a runner that
 * has no kata. It is what gives the CI no-kata leg a nonzero kata skip count to assert.
 */

const { guardKata, kataVersion, registerKataCheck } = require('./helpers/kata-guard');

const PROBE = registerKataCheck('kata --version exits 0 and prints a version');

guardKata('kata binary probe (real kata)', () => {
  test(PROBE, () => {
    const res = kataVersion();
    expect(res.available).toBe(true);
    expect(res.status).toBe(0);
    expect(res.stdout + res.stderr).toMatch(/\d+\.\d+/);
  });
}, { checks: [PROBE] });
