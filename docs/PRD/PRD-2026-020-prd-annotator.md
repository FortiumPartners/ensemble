# PRD-2026-020: Ensemble PRD Annotator

---
**Document ID:** PRD-2026-020
**Version:** 1.0.2
**Status:** Draft
**Date:** 2026-04-22
**Scale Depth:** STANDARD
**Total Requirements:** 21
**Readiness Score:** 4.5 / 5.0 (PASS)
---

## PRD Health Summary

| Metric | Value |
|--------|-------|
| Must requirements | 17 |
| Should requirements | 4 |
| Could requirements | — |
| Won't (this release) | — |
| AC coverage | 21/21 (100%) |
| Risk flags | 6 |
| Cross-requirement dependencies | 19 |

---

## Product Summary

**Problem Statement:**
Ensemble's existing `refine-prd` command is terminal-only and conversational — users answer Q&A questions without seeing the PRD, so they cannot judge impact or context. Non-technical product managers who do not use the terminal are excluded from the review process entirely. This limits PRD quality and stakeholder participation, depressing Implementation Readiness Gate scores on generated documents.

**Solution Overview:**
Two-tiered feature delivery. The MVP enhances `refine-prd` by launching a local browser that renders the full PRD as styled HTML and auto-scrolls to the relevant section as each terminal interview question is asked, giving respondents context-awareness. The full feature introduces a new `annotate-prd` slash command that opens a plannotator-style annotation UI where any stakeholder — regardless of terminal access — can add inline comments, delete suggestions, insert suggestions, and replace suggestions as a separate annotation layer. Multiple collaborators share a session via a server-generated URL. When annotations are complete, Claude packages them and produces a revised PRD with a visible diff and an approve/re-annotate cycle.

**Value Proposition:**
- Every reviewer sees the full PRD while answering refinement questions, producing higher-quality, more contextual feedback
- Non-technical PMs and stakeholders can participate in PRD review without opening a terminal
- Annotation layers never corrupt the PRD source, enabling safe concurrent collaboration
- Claude-driven revision closes the loop: annotations directly produce an improved PRD with traceable changes

**Target Users:**
- Developers using `refine-prd` who lose context when answering questions blind
- Product managers who own PRD quality but cannot use the terminal
- Tech leads reviewing PRDs at architecture sign-off
- Any team member (2–5 person standard team) participating in a PRD review session

---

## User Analysis

### User Roles

| Role | Pain Today | What They Gain |
|------|-----------|----------------|
| Developer (refine-prd user) | Answers Q&A without seeing the PRD; cannot judge scope impact | Browser scrolls to relevant section as each question appears |
| Product manager | Excluded from review; must relay feedback through a developer | Opens browser URL, annotates PRD sections directly without terminal |
| Tech lead | Reviews PRD in editor, feedback is informal and untracked | Structured annotation types (comment, delete, insert, replace) with sidecar file |
| Any collaborator | Multiple reviewers cannot annotate simultaneously | Shared session URL; real-time aggregation; version-mismatch warning |

### Success Metrics
- Implementation Readiness Gate scores on PRDs refined after this feature are measurably higher than baseline
- Stakeholders can complete a full annotation session and submit to Claude without terminal interaction
- Zero PRD source files corrupted by concurrent annotation activity
- Target: PRDs refined via annotation average +0.5 points higher on the Implementation Readiness Gate than PRDs refined with terminal-only refine-prd. Baseline measured by comparing Readiness Gate scores before and after annotation-assisted refinement.

---

## Goals and Non-Goals

### Goals (v1)

**MVP — Enhanced refine-prd:**
- Launch a local HTTP server serving the PRD as styled HTML whenever `refine-prd` is invoked
- Auto-scroll the browser to the PRD section most relevant to the current terminal interview question
- Keep terminal Q&A and browser scroll synchronized throughout the session

**Full feature — annotate-prd:**
- New `annotate-prd` slash command launching a browser-based annotation UI
- Four annotation types: comment, delete suggestion, insert suggestion, replace suggestion
- Annotations stored in a JSON sidecar file — never embedded in the PRD markdown source
- Shareable URL for multi-collaborator sessions
- Real-time annotation aggregation via WebSocket or SSE
- PRD version-mismatch detection and per-annotation relevance verification
- Claude feedback integration: annotations packaged and submitted to produce a revised PRD
- Diff view of original vs. revised PRD with approve/re-annotate cycle

### Non-Goals (v2+)
- Authentication or access control on the shared annotation URL (v1 assumes trusted local network)
- Mobile-responsive annotation UI (desktop browser assumed)
- Annotation on TRDs, runbooks, or non-PRD markdown documents
- Persistent annotation history across separate review sessions (sidecar file is per-session)
- Hosted/cloud annotation server (local server only in v1)
- Integration with issue trackers (GitHub Issues, Jira) to convert annotations to tickets

---

## Requirements by Feature Area

---

### Feature Area 1: PRD Browser Viewer (Shared Infrastructure)

#### REQ-001: Local HTTP Server with Styled PRD Rendering {#req-001}
**Priority:** Must | **Complexity:** Low

A local HTTP server launches and opens the system default browser, displaying the PRD markdown file rendered as styled HTML. The server must start, serve the page, and open the browser without manual user steps beyond invoking the command.

- AC-001-1: Given a valid PRD markdown file path, when `refine-prd` or `annotate-prd` is invoked, then a local HTTP server starts on an available port and the system browser opens to that address within 5 seconds.
- AC-001-2: Given the browser page loads, when the PRD is displayed, then markdown is rendered as styled HTML (headings, lists, code blocks, tables) without raw markdown syntax visible.
- AC-001-3: Given a port conflict on the default port, when the server starts, then it selects the next available port automatically and the browser is opened to the correct URL.
Port range 7331–7340 confirmed. Server defaults to 7331, falls back through 7340 if occupied.

#### REQ-002: Anchor IDs on PRD Headings {#req-002}
**Priority:** Must | **Complexity:** Low

PRD headings at H2 and H3 level are rendered with stable anchor IDs derived from their text content (slug format), enabling programmatic scroll targeting from the server.

- AC-002-1: Given a PRD with H2 headings (`## Goals and Non-Goals`) and H3 headings (`### REQ-001: ...`), when the page is rendered, then each heading has an `id` attribute matching its slugified text (e.g., `id="req-001"`).
- AC-002-2: Given the server sends a scroll instruction with a heading anchor, when the browser receives it, then `document.getElementById(anchor).scrollIntoView()` executes and the heading is visible in the viewport.
- AC-002-3: Given a PRD heading containing special characters (e.g., `## Goals & Non-Goals` or `### REQ-001: "Quoted Title"`), when the page is rendered, then the heading's `id` attribute is a valid HTML ID with special characters stripped or replaced (e.g., `id="goals--non-goals"`).

#### REQ-003: Fully Offline Browser UI {#req-003}
**Priority:** Must | **Complexity:** Low

The browser UI is fully functional without internet connectivity. All assets (CSS, JavaScript, fonts) are served locally by the HTTP server — no CDN or external URLs are referenced.

- AC-003-1: Given the host machine has no network access, when the local server serves the PRD viewer page, then all assets load and the UI is fully functional without any network errors in the browser console.
- AC-003-2: Given the page source, when inspected, then no `src` or `href` attributes reference external hostnames.
- AC-003-3: Given the browser UI uses fonts for rendering, when no custom fonts are available, then the UI falls back to system fonts and remains readable — no CDN-hosted font requests are made.

---

### Feature Area 2: Enhanced refine-prd

#### REQ-004: Automatic Browser Launch on refine-prd Invocation {#req-004}
**Priority:** Must | **Complexity:** Medium

When `refine-prd` is invoked with a PRD file path, it automatically launches the PRD Browser Viewer (REQ-001) alongside the existing terminal Q&A session. The browser launch is non-blocking — the terminal interview proceeds normally while the browser displays the PRD.

- AC-004-1: Given `refine-prd docs/PRD/PRD-2026-020-prd-annotator.md` is invoked, when the command starts, then the browser opens displaying the PRD and the terminal begins the interview sequence without waiting for user interaction with the browser.
- AC-004-2: Given the user closes the browser tab mid-session, when subsequent interview questions are asked in the terminal, then the terminal session continues normally and does not error.
- AC-004-3: Given the `refine-prd` session ends, when the command exits, then the local HTTP server shuts down automatically.
The `refine-prd` command supports a `--no-browser` flag to suppress browser launch for CI or headless environments.

- AC-004-4: Given `refine-prd --no-browser docs/PRD/PRD-2026-020.md` is invoked, when the command starts, then the terminal interview proceeds normally and no browser window is opened.

#### REQ-005: Browser Auto-Scroll to Relevant PRD Section {#req-005}
**Priority:** Must | **Complexity:** Medium

As each interview question is asked in the terminal, the browser auto-scrolls to the PRD section most relevant to that question. Relevance is determined by matching question content to PRD heading text or REQ-NNN identifiers.

- AC-005-1: Given an interview question referencing a specific requirement (e.g., "Tell me more about REQ-007"), when the question is displayed in the terminal, then the browser scrolls to the `#req-007` anchor.
- AC-005-2: Given an interview question about a feature area (e.g., "Goals and Non-Goals"), when the question is displayed, then the browser scrolls to the matching H2 or H3 heading.
- AC-005-3: Given an interview question that cannot be matched to any heading, when the question is displayed, then the browser remains at its current scroll position and no error is thrown.

#### REQ-006: Terminal and Browser Scroll Synchronization {#req-006}
**Priority:** Must | **Complexity:** Medium

Terminal Q&A and browser scroll remain synchronized — the browser scroll position always reflects the PRD section associated with the current active question. Scroll updates are delivered in real time (no manual refresh required).

- AC-006-1: Given the interviewer moves from question 3 to question 4, when question 4 appears in the terminal, then the browser scroll fires simultaneously and completes within 500ms of the question appearing — no prefetch or predictive scroll is required.
- AC-006-2: Given multiple rapid question transitions (e.g., user skips through questions), when each transition occurs, then only the final destination section is scrolled to (no intermediate scroll jitter).
Synchronization transport (WebSocket, SSE, or long-poll) is an implementation detail deferred to TRD.

---

### Feature Area 3: Annotation Engine

#### REQ-007: Four Annotation Types on Any PRD Section {#req-007}
**Priority:** Must | **Complexity:** Medium | **[RISK: annotation UI complexity — four distinct interaction patterns (comment, delete, insert, replace) require careful UX design to avoid overwhelming reviewers]**

Users can add four annotation types on any PRD section: comment (free-text note), delete suggestion (marks section for removal), insert suggestion (proposes new text to add), and replace suggestion (proposes replacement text for existing content). Each annotation is associated with the PRD heading or text range it targets.

- AC-007-1: Given the annotation UI is open, when a user selects a PRD section and chooses "Comment", then a text input appears and the saved annotation is associated with that section's anchor ID.
- AC-007-2: Given a user selects a text range and chooses "Delete suggestion", then the selected text is visually highlighted and a delete annotation is recorded in the sidecar file with the selected text as the target.
- AC-007-3: Given a user selects a section and chooses "Insert suggestion", then a text editor appears for new content and the annotation is stored with an insertion position (before/after the target anchor).
- AC-007-4: Given a user selects a text range and chooses "Replace suggestion", then a split editor shows original and proposed text side by side and the annotation is stored with both original and replacement text.

#### REQ-008: Annotations Stored in JSON Sidecar File {#req-008}
**Priority:** Must | **Complexity:** Low

Annotations are stored as a separate JSON sidecar file alongside the PRD (e.g., `PRD-2026-020.annotations.json`), never embedded in or modifying the PRD markdown source.

- AC-008-1: Given one or more annotations are submitted, when the sidecar file is written, then the PRD markdown source file is byte-for-byte identical to its state before the annotation session.
- AC-008-2: Given the sidecar file, when parsed, then each annotation entry contains: `id` (UUID), `type` (comment|delete|insert|replace), `anchor` (heading slug or text range), `author`, `timestamp`, and `content` fields.
- AC-008-3: Given the sidecar filename convention, when a PRD at `docs/PRD/PRD-2026-020-prd-annotator.md` is annotated, then the sidecar is written to `docs/PRD/PRD-2026-020-prd-annotator.annotations.json`.
Sidecar filename convention confirmed: full PRD filename with `.annotations.json` suffix.

#### REQ-009: annotate-prd Slash Command {#req-009}
**Priority:** Must | **Complexity:** Low

A new `annotate-prd` slash command is added to the `packages/product/commands/` directory. Invoking `/ensemble:annotate-prd [prd-path]` starts the annotation server and opens the annotation UI in the system browser.

- AC-009-1: Given `/ensemble:annotate-prd docs/PRD/PRD-2026-020-prd-annotator.md` is invoked, when the command starts, then the annotation server starts and the browser opens to the annotation UI displaying the specified PRD.
- AC-009-2: Given the command is invoked without a PRD path argument, when it starts, then it prompts the user to supply a PRD path before continuing.
- AC-009-3: Given the command YAML is added to `packages/product/commands/`, when `npm run validate` runs, then the command passes schema validation.

#### REQ-010: Annotation Summary Panel {#req-010}
**Priority:** Should | **Complexity:** Low

Users can view an annotation summary panel listing all annotations collected so far, grouped by section, before submitting them to Claude. The panel shows annotation type, target section, and a preview of annotation content.

- AC-010-1: Given at least one annotation has been added, when the user opens the summary panel, then all annotations are listed grouped by their target PRD section in document order.
- AC-010-2: Given the summary panel, when the user selects an annotation, then the browser scrolls to the annotated section in the PRD view.
- AC-010-3: Given the summary panel, when the user clicks "Delete" on an annotation entry, then that annotation is removed from the sidecar file and the panel updates without a page reload.

---

### Feature Area 4: Collaboration Server

#### REQ-011: Shareable Session URL for Multi-Collaborator Annotation {#req-011}
**Priority:** Must | **Complexity:** High | **[RISK: requires server infrastructure — session ID routing, URL generation, and implicit trust model (no authentication in v1) must be designed carefully to avoid accidental exposure on shared networks]**

The annotation server generates a shareable URL (e.g., `http://[host]:[port]/session/[session-id]`) so multiple team members can view and annotate the same PRD session simultaneously from their own browsers.

- AC-011-1: Given the annotation server starts, when the URL is printed to the terminal, then any browser on the same local network that navigates to the URL can load the annotation UI and add annotations.
- AC-011-2: Given two collaborators are connected to the same session URL, when collaborator A adds an annotation, then collaborator B sees the annotation appear without manual refresh.
- AC-011-3: Given a session URL, when the annotation server is stopped, then navigating to the URL returns a connection error (session is not persisted across server restarts without REQ-019 disk persistence).
Confirmed: v1 ships with no authentication — trusted local network only. Authentication deferred to v2.

#### REQ-012: Real-Time Annotation Aggregation {#req-012}
**Priority:** Must | **Complexity:** High | **[RISK: WebSocket server complexity — concurrent write ordering to the sidecar file requires an atomic append or mutex strategy to avoid corrupt JSON; conflict-free annotation model (additive only) reduces but does not eliminate the risk]**

Annotations from multiple simultaneous collaborators are aggregated in real time via WebSocket or SSE. The aggregation model is additive only — annotations are appended, not merged or overwritten — so concurrent submissions do not conflict.

- AC-012-1: Given two collaborators submit annotations within 100ms of each other, when both annotations are processed, then both appear in the sidecar file with distinct UUIDs and neither annotation is lost.
- AC-012-2: Given a collaborator's browser loses connection mid-session, when it reconnects, then the full current annotation set is delivered and subsequent real-time updates resume.
- AC-012-3: Given five simultaneous collaborators each adding one annotation, when all submissions complete, then the sidecar file contains exactly five entries with no duplicate IDs and valid JSON structure.

#### REQ-013: PRD Version-Mismatch Detection {#req-013}
**Priority:** Must | **Complexity:** Medium | **[RISK: file watch timing edge cases — if the PRD is saved and the watch event fires before the browser poll interval, the warning may lag; aggressive polling degrades performance]**

The system detects when the underlying PRD file changes (via file hash comparison or filesystem timestamp) while an annotation session is open and displays a prominent version-mismatch warning banner in the browser UI.

- AC-013-1: Given an active annotation session, when the PRD file is modified on disk, then a version-mismatch warning appears in the browser within 10 seconds of the file change.
- AC-013-2: Given the warning is displayed, when the user dismisses it without refreshing, then the warning remains dismissible but is re-shown if the file changes again.
- AC-013-3: Given no file change has occurred, when the session is active for 60 minutes, then no false-positive version-mismatch warning is shown.
Confirmed: 10-second polling interval for file-change detection.

#### REQ-014: Annotation Relevance Verification After Version Mismatch {#req-014}
**Priority:** Must | **Complexity:** Medium | **[RISK: heuristic anchor matching — after PRD restructuring, annotation targets may point to headings that were renamed or moved, not just removed; the "Section removed" detection (AC-014-2) may miss these cases]**

When a version mismatch is detected, users can refresh the browser to load the updated PRD. Each existing annotation is then individually presented with a "Still relevant?" prompt so the user can confirm, edit, or discard it before submitting to Claude.

- AC-014-1: Given a version mismatch and the user clicks "Refresh to new version", when the page reloads, then the updated PRD is displayed and each prior annotation is shown with a "Still relevant / Edit / Discard" control overlaid on its target section.
- AC-014-2: Given a prior annotation whose target heading no longer exists in the updated PRD, when it is presented for relevance check, then it is flagged "Section removed" and pre-selected for discard.
- AC-014-3: Given the user confirms, edits, or discards all annotations, when they click "Continue to submission", then only confirmed and edited annotations remain in the sidecar file.

---

### Feature Area 5: Claude Feedback Integration

#### REQ-015: Annotation Packaging and Claude Submission {#req-015}
**Priority:** Must | **Complexity:** Medium

All confirmed annotations are packaged into a structured feedback payload and submitted to Claude to produce a revised PRD. The payload includes the original PRD content and the full annotation sidecar data.

- AC-015-1: Given a completed annotation session with at least one confirmed annotation, when the user clicks "Submit to Claude", then Claude receives the full PRD content and all annotation entries as a structured prompt.
- AC-015-2: Given Claude receives the feedback payload, when it completes the revision, then a new PRD file is written with a bumped version suffix (e.g., `PRD-2026-020-prd-annotator-v2.md`) and the original file is not overwritten.
- AC-015-3: Given zero confirmed annotations (all discarded), when the user clicks "Submit to Claude", then the UI shows a validation message requesting at least one annotation before submission.
Confirmed: each revision is saved as a separate file with incremented version suffix (`-v2`, `-v3`, etc.). Original PRD is never overwritten.

#### REQ-016: Diff View of Original vs. Revised PRD {#req-016}
**Priority:** Should | **Complexity:** Medium

After Claude applies annotations and produces a revised PRD, the browser displays a diff view comparing the original PRD with the revised version. Changed sections are highlighted; unchanged sections are collapsed by default.

- AC-016-1: Given Claude has produced a revised PRD, when the diff view is shown, then added lines are highlighted green, removed lines are highlighted red, and unchanged lines are shown in a collapsed "N lines unchanged" group.
- AC-016-2: Given the diff view, when the user expands a collapsed section, then the full original and revised text for that section is visible.
- AC-016-3: Given the diff view, when the user clicks a changed section, then the corresponding annotation(s) that caused the change are listed in a side panel.

#### REQ-017: Approve or Re-Annotate Revised PRD {#req-017}
**Priority:** Should | **Complexity:** Low

From the diff view, users can either approve the revised PRD (saving it as the canonical version) or trigger a new annotation round on the revised PRD, starting the annotation cycle again.

- AC-017-1: Given the diff view, when the user clicks "Approve", then the revised PRD file is saved to `docs/PRD/` as the new canonical PRD and the annotation sidecar is archived or cleared.
- AC-017-2: Given the diff view, when the user clicks "Re-annotate", then the annotation UI reloads with the revised PRD as the new source document and a fresh empty annotation set.
- AC-017-3: Given the user approves, when the save completes, then the terminal prints the saved file path and the server shuts down cleanly.

---

### Feature Area 6: Non-Functional Requirements

#### REQ-018: Rendering Performance for Large PRDs {#req-018}
**Priority:** Should | **Complexity:** Low

The PRD viewer renders PRDs containing up to 200 requirements without perceptible rendering lag. Initial page load and scroll operations remain responsive on standard developer hardware.

- AC-018-1: Given a PRD with 200 REQ-NNN requirements, when the page is loaded, then the browser completes initial render within 3 seconds on a machine with 8 GB RAM and a modern browser.
- AC-018-2: Given the rendered PRD, when a programmatic scroll is triggered (REQ-005/REQ-006), then the target section is in the viewport within 500ms of the scroll command.
Confirmed: 3-second render budget on 8 GB RAM with modern browser for PRDs up to 200 requirements.

#### REQ-019: Annotation State Persistence to Disk {#req-019}
**Priority:** Should | **Complexity:** Low

Annotation state persists to disk automatically so it survives browser refresh or server restart without data loss. Annotations are written to the sidecar file incrementally as they are submitted, not only on session close.

- AC-019-1: Given the user adds three annotations and refreshes the browser, when the page reloads, then all three annotations are visible with no manual re-entry required.
- AC-019-2: Given the annotation server crashes and is restarted with the same PRD path, when the user reloads the browser, then the existing sidecar annotations are loaded and the session resumes with no annotation loss.
- AC-019-3: Given an annotation is submitted, when the write to the sidecar file fails (e.g., disk full), then an error is displayed in the browser and the annotation is not silently lost.

#### REQ-020: Embedded PRD Link and Auto-Server Launch {#req-020}
**Priority:** Must | **Complexity:** Medium | **[RISK: custom URL scheme registration requires OS-level setup at install time — must be tested on macOS, Linux, and Windows]**

The PRD markdown file includes an embedded annotation link (e.g., a markdown link or comment block) that, when clicked by any stakeholder, automatically launches the annotation server and opens the annotation UI without requiring terminal access. Stakeholders who only have access to the PRD document can participate in annotation without knowing any CLI commands. Additionally, when the developer starts the annotation server via the `annotate-prd` command, a shareable session URL is printed to the terminal for distribution to collaborators on the same network.

- AC-020-1: Given a PRD file with an embedded annotation link, when a PM double-clicks or opens that link, then the OS invokes the registered Ensemble URL scheme handler, the annotation server starts (or connects to an already-running instance), and the browser opens to the annotation UI for that PRD.
- AC-020-2: Given the annotation server is already running when the embedded link is clicked, when the handler is invoked, then no second server is started — the browser connects to the existing session.
- AC-020-3: Given `annotate-prd docs/PRD/PRD-2026-020-prd-annotator.md` is invoked, when the server starts, then the terminal prints both the local URL and the LAN-accessible session URL (e.g., `http://[local-ip]:[port]/session/[session-id]`) for sharing with collaborators.
- AC-020-4: Given a freshly generated PRD from `create-prd`, when the PRD file is saved, then an annotation link section is appended to the bottom of the PRD in a format such as `<!-- annotate: ensemble://annotate-prd?file=PRD-2026-020-prd-annotator.md -->` or a markdown link block.
Confirmed: OS protocol handler (`ensemble://`) registered at install time. Clicking the embedded link invokes the Ensemble CLI, which starts or connects to the annotation server.

#### REQ-021: Sidecar Archival After Claude Revision {#req-021}
**Priority:** Must | **Complexity:** Low

After Claude successfully applies annotations and produces a revised PRD, the consumed annotation sidecar file is archived (renamed with an `.applied` suffix, e.g., `PRD-2026-020-prd-annotator.annotations.applied.json`) and a fresh empty sidecar is initialized for the next annotation round on the revised PRD. This ensures each annotation round has a clean slate and applied annotations are preserved for audit.

- AC-021-1: Given Claude produces a revised PRD (`PRD-2026-020-prd-annotator-v2.md`), when the revision is confirmed, then the original sidecar file is renamed to `PRD-2026-020-prd-annotator.annotations.applied.json` and a new empty `PRD-2026-020-prd-annotator-v2.annotations.json` sidecar is created alongside the revised PRD.
- AC-021-2: Given the archived sidecar, when opened, then it contains the full annotation set that was submitted to Claude, preserving an audit trail of what feedback was applied.
- AC-021-3: Given a second annotation round on the revised PRD, when annotations are submitted to Claude again, then they are written to the fresh v2 sidecar and do not mix with the archived v1 annotations.

---

## Dependency Map

| Requirement | Depends On | Notes |
|-------------|-----------|-------|
| REQ-002 (heading anchors) | REQ-001 (local server) | Anchors are part of the rendering pipeline |
| REQ-003 (offline assets) | REQ-001 (local server) | Server must serve all assets |
| REQ-004 (refine-prd launch) | REQ-001, REQ-002, REQ-003 | Uses shared browser viewer infrastructure |
| REQ-005 (auto-scroll) | REQ-002 (anchor IDs), REQ-004 (browser open) | Scroll targets require anchor IDs |
| REQ-006 (sync) | REQ-005 (auto-scroll) | Synchronization builds on scroll mechanism |
| REQ-007 (annotation types) | REQ-002 (anchor IDs) | Annotations target heading anchors |
| REQ-008 (sidecar file) | REQ-007 (annotation types) | Sidecar stores typed annotation records |
| REQ-009 (annotate-prd command) | REQ-001, REQ-007, REQ-008 | Command bootstraps the full annotation UI |
| REQ-010 (summary panel) | REQ-007, REQ-008 | Panel reads from sidecar |
| REQ-011 (shareable URL) | REQ-009 (annotation server) | URL is generated by the annotation server |
| REQ-012 (real-time aggregation) | REQ-011 (session URL), REQ-008 (sidecar) | Aggregation writes to shared sidecar |
| REQ-013 (version mismatch) | REQ-001 (server), REQ-008 (sidecar) | Server watches PRD file; sidecar holds session state |
| REQ-014 (relevance verify) | REQ-013 (version mismatch) | Verification triggered by mismatch detection |
| REQ-015 (Claude submission) | REQ-008 (sidecar), REQ-014 (relevance verify) | Submission uses confirmed annotations |
| REQ-016 (diff view) | REQ-015 (Claude submission) | Diff requires revised PRD from Claude |
| REQ-017 (approve/re-annotate) | REQ-016 (diff view) | Actions are on the diff view |
| REQ-019 (persistence) | REQ-008 (sidecar) | Persistence is a property of sidecar write behavior |
| REQ-020 (embedded link / auto-launch) | REQ-001, REQ-009, REQ-011 | Auto-launch depends on annotation server infrastructure and session URL generation |
| REQ-021 (sidecar archival) | REQ-008 (sidecar), REQ-015 (Claude submission) | Archival triggered after Claude produces the revised PRD |

### Implementation Clusters

**Cluster A — Viewer Foundation (ship first):** REQ-001, REQ-002, REQ-003
**Cluster B — Enhanced refine-prd (MVP):** REQ-004, REQ-005, REQ-006
**Cluster C — Annotation Engine:** REQ-007, REQ-008, REQ-009, REQ-010, REQ-019
**Cluster D — Collaboration:** REQ-011, REQ-012, REQ-013, REQ-014, REQ-020
**Cluster E — Claude Integration:** REQ-015, REQ-016, REQ-017, REQ-021
**Cluster F — Non-Functional:** REQ-018

---

## Adversarial Review

All 6 issues from the adversarial review session were resolved and incorporated into this document (v1.0.1). Resolutions include: promoting REQ-011 and REQ-012 from Should to Must priority to reflect their centrality to the multi-collaborator use case; adding REQ-020 (embedded PRD link and auto-server launch) so stakeholders without terminal access can join annotation sessions via a single click; adding REQ-021 (sidecar archival after Claude revision) to enforce clean annotation rounds with a preserved audit trail; clarifying the AC-006-1 scroll timing to confirm simultaneous firing (not prefetch); and adding NEEDS CLARIFICATION item 11 documenting the unresolved URL scheme mechanism for REQ-020.

Issues identified and resolutions applied:

1. **Annotation UI complexity vs. usability** — Four annotation types (comment, delete, insert, replace) each require a distinct interaction pattern. Risk of overwhelming non-technical PMs. **Resolution:** REQ-007 includes separate ACs for each type with explicit UX behavior. Flagged [RISK] on REQ-007. A summary panel (REQ-010) gives reviewers a recovery path if they misuse a type.

2. **Concurrent sidecar writes corrupting JSON** — If two collaborators submit annotations simultaneously and both write to the sidecar file, the JSON can be corrupted. **Resolution:** REQ-012 requires an atomic append or mutex write strategy and explicitly specifies the additive-only conflict model. Marked [RISK] on REQ-012.

3. **Authentication TBD on shareable URL** — Without authentication, any user on the local network who discovers the URL can annotate the PRD. **Resolution:** REQ-011 AC explicitly states v1 assumes trusted local network. Non-goal section documents authentication as v2. [NEEDS CLARIFICATION] marker placed on REQ-011 AC.

4. **PRD source file integrity during Claude revision** — If Claude overwrites the original PRD in place, annotation anchors in the sidecar become stale. **Resolution:** REQ-015-AC-015-2 requires Claude to write to a new file with a version suffix, preserving the original.

5. **File-watch reliability on macOS** — `fs.watch` on macOS (kqueue-based) can miss rapid consecutive file changes. **Resolution:** REQ-013 ACs specify a 10-second detection window (generous enough for polling fallback) and a false-negative tolerance AC (AC-013-3). Marked [RISK] on REQ-013.

6. **Scroll relevance matching is heuristic** — Matching interview questions to PRD headings by text content will have false negatives for general questions. **Resolution:** REQ-005-AC-005-3 explicitly specifies graceful no-op behavior when no match is found, preventing errors and setting reviewer expectations.

---

## Implementation Readiness Gate

| Dimension | Score | Notes |
|-----------|-------|-------|
| Completeness | 4.5 | All ambiguities resolved; --no-browser flag added; edge-case ACs added for REQ-002, REQ-003 |
| Testability | 4.5 | 3 new ACs added (AC-002-3, AC-003-3, AC-004-4); numeric success metric (+0.5 Readiness Gate) established |
| Clarity | 5 | Zero NEEDS CLARIFICATION markers remain; all 11 decisions documented in Clarification Log |
| Feasibility | 4 | Viewer and annotation engine follow established Node.js/local-server patterns; REQ-011/REQ-012 collaboration tier carries highest implementation risk |

**Overall Score: 4.5 / 5.0 — PASS**
**Previous Score: 4.0 → 4.5 (improved +0.5)**

---

## Clarification Log

All 11 items from the original NEEDS CLARIFICATION scan were resolved during refinement v1.0.2:

| # | Topic | Resolution |
|---|-------|------------|
| 1 | Default port range | 7331–7340 confirmed |
| 2 | Auth model (v1) | No auth; trusted local network; auth deferred to v2 |
| 3 | --no-browser flag | Yes — added to REQ-004 |
| 4 | Sync transport | Deferred to TRD (implementation detail) |
| 5 | Sidecar filename | Full PRD filename with .annotations.json suffix |
| 6 | Auth confirmation | Same as #2 — consolidated |
| 7 | File-watch interval | 10-second polling confirmed |
| 8 | Revision filename | Separate file with -v2/-v3 suffix; original preserved |
| 9 | Score target | +0.5 point improvement on Readiness Gate |
| 10 | Render budget | 3 seconds on 8 GB RAM, modern browser |
| 11 | URL scheme | OS protocol handler (ensemble://) at install time |

---

## Changelog

### v1.0.2 — 2026-04-22
- Resolved all 11 NEEDS CLARIFICATION markers with stakeholder confirmation
- Added AC-004-4 (--no-browser flag support)
- Added AC-002-3 (edge case: special characters in headings)
- Added AC-003-3 (edge case: system font fallback)
- Added risk flag to REQ-014 (heuristic anchor matching after PRD restructuring)
- Fixed PRD Health Summary: AC coverage 19/19 → 21/21, dependencies 12 → 19, risk flags 5 → 6
- Established numeric success metric: +0.5 Readiness Gate score improvement target
- Confirmed OS protocol handler (ensemble://) as the URL scheme mechanism for REQ-020

### v1.0.1 — 2026-04-22
- Promoted REQ-011, REQ-012 from Should to Must
- Added REQ-020 (embedded PRD link and auto-server launch)
- Added REQ-021 (sidecar archival after Claude revision)
- Clarified AC-006-1 scroll timing (simultaneous, not prefetch)
- Resolved 6 adversarial review issues

### v1.0.0 — 2026-04-22
- Initial PRD creation via create-prd v2.4.0

---

## Suggested Next Step

```
/ensemble:create-trd docs/PRD/PRD-2026-020-prd-annotator.md
```
