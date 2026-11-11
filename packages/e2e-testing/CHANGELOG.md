# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.0.0] - 2025-12-09

### Added

- Initial release extracted from ensemble v3.x monolith
- Plugin structure created for modular installation

## [Unreleased]

### Added

- Tool abstraction layer: `adapter-e2e-quality-playwright`, the default `e2e-quality` adapter. See `docs/guides/adapter-authoring.md`.
- `/ensemble:author-playwright-tests` now captures an end-state screenshot for every authored test, on a pass and on a failure. Each test opens `await using var evidence = EvidenceCapture.For(page, acId);` (a framework-neutral C# helper the command adds to the E2E test project, `lib/evidence-capture.js`); a proposal without it, or a run that leaves no screenshot, is rejected by `delegation-contract.js`. Screenshots are written to `E2E_EVIDENCE_DIR` (default `<temp>/e2e-evidence`), never into the repo, and are attached to the synced ADO Test Case through a command you configure in `E2E_EVIDENCE_ATTACH_CMD` (the Azure DevOps MCP cannot upload files; with none configured the command reports the gap and keeps the files).

- Plugin extraction and population (in progress)

### Changed

- The `writing-playwright-tests` skill and its `playwright.config.ts` template now set `screenshot: 'on'` (was `'only-on-failure'`), so passing tests get an end-state screenshot too.
- Trimmed narrative from step descriptions in `author-playwright-tests.yaml` and `playwright-tester.yaml` to stay within the prompt word budget; no step, action or rule changed.
