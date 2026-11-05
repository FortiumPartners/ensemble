Phase 3 complete.

## What the review found

`FOREMAN_BASE_BRANCH=dev`; `git diff dev...HEAD` at review start was **45 insertions in two report files and zero source changes** — the bead's defect was still live at HEAD. `REVIEW_CODERABBIT_REPORT.md` had **no findings markers** to carry forward (recorded in the report), but its prose carried one Critical: the unfixed truncation. Verified against code, still live → fixed here.

## Fix

`packages/development/lib/trd-cli.js:1656-1664` — `const code = main(...); process.exit(code);` → `process.exitCode = main(...)` plus a comment. Piped stdout is written asynchronously, so everything past the 64 KiB libuv buffer was in flight when the process was killed. Chose this over the bead's `fs.writeSync(1,…)` because it keeps `main()`'s exit-code contract and matches repo precedent (`scripts/tests/fixtures/toolchain/real-ledger-steps/fail.js`, `estimate-actual.js:95`). `packages/pi/vendor/lib/trd-cli.js` regenerated via root `npm run generate` + `generate:pi` (never hand-edited), now byte-identical. New fixture + 13-test regression file, CHANGELOG bullet.

**Red-first proof:** 6 failed / 7 passed with source reverted to `dev`; 13 passed on the fix. Raw shell pipe: `65536 INVALID` → `124742 valid`. Exit codes unchanged (0/1/1/1); `generate:validate` and `npm run validate` exit 0. Full `packages/development` suite: 6213 passed, 1 failed — `tests/local-ci-adversarial.test.js:286`, which fails identically with this change reverted (nested `.foreman/worktrees/...` PATH trips its own assertion); reported as a Minor finding, not mine.

Declined: authoring the missing implement-phase artifact; the same latent bug in four sibling CLIs (out of bead scope); Prettier (no repo gate, `dev` equally unflagged).

## Caveat worth your attention

This session's write path intermittently **silently mangles file contents** — it ate prose inside angle brackets and dropped whole sentences, and once reverted my own source fix with a `Successfully wrote` result. I caught it via `git status`, re-verified the source on disk (diff = 6 comment lines + 1 changed line), and rewrote the report with Python heredocs, checking on-disk bytes after each write. The report's structure, both marker lines, and all three findings bullets are verified intact; a couple of its longer prose sentences still read slightly clipped. `ask_advisor` was unavailable (`Advisor model not found: openai-codex/gpt-5.5`), so no advisor gate was obtainable.

Report: `docs/reports/foreman-beads:ensemble:br-bhj9/REVIEW_REPORT.md`. Fixes left **uncommitted** for Foreman.