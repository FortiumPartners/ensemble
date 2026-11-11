# Known findings of the earlier published reviews (ground truth for the quality guard)

Source: PR comments on Sunstone-Partners/ensemble, read with `gh pr view <n> --json comments` (published artifacts; saved in
../old/pr<n>-comments.json). Reviewer: "@ldangelo's tooling", automated multi-reviewer pass (2 reviewers, 5 independent verifiers
per candidate), posted 2026-10-30. They say "every finding below is still present in `<head>`; none is resolved" and the PR head
has not moved since (#205 cca69fe, #207 48c862c), so they are findings for the SAME head the new run reviews.

## #207 (head 48c862c, base = #205's branch; 18 paths, +648/-79)

Important (old review: "rated important and each was probe-confirmed"):
- E1  lib/e2e-framework.js + lib/spec-writer.js scaffoldXunitFile: official Microsoft.Playwright.Xunit (PageTest) projects cannot be written; `baseClass:'PageTest'` silently dropped, emits class with no base and unused `_fixture`, body uses `Page` (does not compile).
- E2  lib/spec-writer.js inferFramework/appendTestMethod: probe /\[\s*(?:Fact|Theory)\s*[\](]/ also matches NUnit's `[Theory]`, inferFramework returns null for an NUnit file, mismatch guard skipped, xunit [Fact]/[Trait] appended into NUnit class.
- E3  lib/spec-writer.js findClassBodyRange: splices into FIRST class in the file; with a [CollectionDefinition] marker class first, the [Fact] lands in the marker class.
- E4  lib/spec-writer.js scaffoldXunitFile (~218-223) + commands/author-playwright-tests.yaml landing action: no step supplies collection/fixtureType/usings; scaffoldNewSpecFile throws `collection must be the project's xUnit collection name`.
- E5  lib/e2e-framework.js detectE2eFrameworkInDir: fs.readdirSync unguarded; non-existent dir or file path throws ENOENT/ENOTDIR instead of returning null.
- E6  agents/playwright-tester.yaml (Run-stage mode/slowMo text) + commands/author-playwright-tests.yaml (Run request shape): Run request carries no framework; headed/slow-mo overrides inert for the xUnit shape.

Nits: E7 (resolveFramework null vs undefined vs delegation-contract), E8 (testCategory unvalidated into xUnit [Trait]: injection probe), E9 (diff rewrites two unrelated steps, four mirrors), E10 (pre-existing: NUnit `[TestCategory]` is MSTest's attribute), E12 (PACKAGE_RE double quotes only), E13 (validateProposalResponse never inspects body for framework), E14 (scaffoldNewSpecFile ignores baseClass for xunit).
Later short note (2026-11-03): Low: inferFramework returns null for a file mixing both frameworks and silently falls back to nunit.
Also (stacked on #205, belongs to #205): D7, D10, D12, D14.

## #205 (head cca69fe, base dev merge-base 306934f; 23 paths, +961/-334)

Important: D7 stale screenshot satisfies the evidence gate (lib/delegation-contract.js:293-301, lib/evidence-capture.js:117-122).
Disputed security (need a human decision): D10 C# injection via `namespace` (lib/evidence-capture.js:72-76); D12 attach-template allow-list applies to the path only (lib/evidence-capture.js:133-149); D14 attach runs via the shell tool (commands/author-playwright-tests.yaml:271-273 and mirrors).
Nits: D1 (hasEvidenceCapture non-global regex), D13 (namespace source undefined), F5 (session-logger.js self-test dead assertions, pre-existing lines), F7 (TRD does not mention the feature).
Later note (2026-11-03): Medium: no confirmed test for the shell-quoting guard (SAFE_PATH_RE + double quotes); Low: config.template.ts sets screenshot:'on' for all tests; no version bump; CHANGELOG conflict with dev.

## #202 (head 26ea860; earlier reviews at b78540d and 9c4d3b4/e5ecd6a, i.e. OLDER heads)

NOT the same head: the author pushed 26ea860 after the Nov-4 merge review. Old findings (partly fixed at 13e5f08 per the Nov-4 comment):
F1 (Important) `--parser-tables` TRDs are never stamped (author: not applicable; reverted attempt) ; F2 ENSEMBLE_BDD warning dropped when a stamp wins (fixed); F3 splitFrontmatter ignores H1-before-frontmatter (fixed); F4 unreadable/relative --trd silently resolves to BDD on (fixed); S-1 (security Nit) implement-trd-beads.yaml:124 TRD path interpolated into a double-quoted shell string (pre-existing, accepted); nits.
=> a quality guard on #202 is only approximate (different head); say so.

## Baseline PRs (#225, #228, #229): no findings are recorded in the baseline docs
docs/guides/review-walltime-baseline-2026-11-07.json holds wall times, chains and gate-run counts only (grep for "finding" to confirm). The plan names findings only for #233 (Important 3 + 4 across fix rounds; not reviewable here: merged) and #234/#235 (prototype).
