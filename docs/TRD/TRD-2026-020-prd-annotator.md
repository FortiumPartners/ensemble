# TRD-2026-020: Ensemble PRD Annotator

---
**Document ID:** TRD-2026-020
**PRD Reference:** PRD-2026-020-prd-annotator.md
**Version:** 1.0.0
**Status:** Draft
**Date:** 2026-04-22
**Architecture Option:** B — Fastify + Vite + React
**Design Readiness Score:** 4.0 / 5.0 (PASS)
---

## Architecture Decision

### Chosen Approach: Option B — Fastify + Vite + React

The PRD Annotator is a browser-based PRD review and annotation system. It introduces Ensemble's first web UI layer. A Fastify HTTP server hosts the backend (REST + WebSocket), while a Vite-built React 18 SPA provides the annotation frontend. The system stores annotations in a JSON sidecar file alongside the PRD, never modifying the PRD source.

### Alternatives Considered

**Option A (rejected): Express + vanilla JS + SSE** — Simpler stack but vanilla JS annotation UI would require significantly more manual work. Four annotation types with distinct interaction patterns (comment, delete, insert, replace) justify a component framework. SSE is unidirectional; WebSocket is needed for bidirectional collaboration events.

**Option C (rejected): Express + Preact + esbuild** — Good middle ground but Preact's smaller ecosystem means building custom diff viewer and annotation components from scratch. React's ecosystem (react-diff-viewer-continued, react-markdown) provides these out of the box, reducing implementation time for Sprint 5.

### Architecture Rationale
- Fastify's schema-validated routing reduces boilerplate for the REST API
- React 18 provides the component model needed for four distinct annotation UIs
- Vite enables fast dev iteration and produces a single pre-built bundle for production
- WebSocket (via @fastify/websocket) enables real-time collaboration and scroll sync
- Zustand provides minimal-boilerplate state management with WebSocket-friendly patterns
- JSON sidecar file preserves PRD source integrity (never modifies the markdown)

---

## System Architecture

### Architecture Diagram

```
+-------------------------------------------------+
|  CLI Layer (packages/product/commands/)          |
|  +- annotate-prd.yaml (new command)             |
|  +- refine-prd.yaml (enhanced: --no-browser)    |
|     +- launches AnnotatorServer                 |
+-------------------------------------------------+
|  Server Layer (packages/annotator/server/)       |
|  +- Fastify HTTP server (port 7331-7340)        |
|  +- GET /             -> React SPA              |
|  +- GET /api/prd      -> PRD content JSON       |
|  +- GET /api/session  -> session info            |
|  +- POST /api/annotations    -> save            |
|  +- DELETE /api/annotations/:id -> delete       |
|  +- POST /api/submit  -> Claude feedback        |
|  +- WS /ws            -> real-time sync         |
|  |   +- scroll events (refine-prd sync)         |
|  |   +- annotation events (collab sync)         |
|  |   +- version-mismatch events                 |
|  +- chokidar file watcher (PRD changes)         |
+-------------------------------------------------+
|  Frontend Layer (packages/annotator/client/)     |
|  +- Vite + React 18 SPA                         |
|  +- react-markdown -> PRD rendering             |
|  +- Annotation components (4 types):            |
|  |   +- CommentAnnotation                       |
|  |   +- DeleteSuggestion                        |
|  |   +- InsertSuggestion                        |
|  |   +- ReplaceSuggestion                       |
|  +- AnnotationSummaryPanel                      |
|  +- DiffViewer (react-diff-viewer-continued)    |
|  +- VersionMismatchBanner                       |
|  +- RelevanceVerificationModal                  |
|  +- Zustand store (prd, annotations, session)   |
+-------------------------------------------------+
|  Storage Layer                                   |
|  +- JSON sidecar (*.annotations.json)           |
|  +- Atomic writes (tmp + rename)                |
|  +- Sidecar archival (*.applied.json)           |
+-------------------------------------------------+
|  OS Integration                                  |
|  +- ensemble:// protocol handler registration   |
+-------------------------------------------------+
```

### Data Flow

1. **refine-prd flow:** CLI invokes command -> Fastify server starts -> browser opens -> terminal asks Q&A via AskUserQuestion -> server sends scroll event via WS -> browser scrolls to section
2. **annotate-prd flow:** CLI invokes command -> Fastify server starts -> browser opens -> user creates annotations -> annotations saved to sidecar via REST API -> collaborators see updates via WS -> user clicks Submit -> annotations packaged -> Claude produces revision -> diff shown -> approve/re-annotate
3. **embedded link flow:** PM clicks ensemble:// link -> OS handler invokes CLI -> CLI starts or connects to server -> browser opens annotation UI

### Component Boundaries

| Component | Responsibility | Inputs | Outputs |
|-----------|---------------|--------|---------|
| `server/index.ts` | Fastify server lifecycle, port management | CLI args (PRD path, port) | Running HTTP/WS server |
| `server/routes/prd.ts` | PRD content API | PRD file path | JSON: { content, hash, headings } |
| `server/routes/annotations.ts` | Annotation CRUD | Annotation payloads | Sidecar file writes |
| `server/routes/submit.ts` | Claude submission bridge | Annotation set + PRD content | Revised PRD file |
| `server/routes/session.ts` | Session management | Server config | Session ID, URLs |
| `server/ws/handler.ts` | WebSocket connection handler | WS connections | Broadcast events |
| `server/services/sidecar.ts` | Sidecar file I/O | Annotation data | Atomic JSON writes |
| `server/services/file-watcher.ts` | PRD file change detection | PRD file path | Version-mismatch events |
| `server/services/port-finder.ts` | Available port selection | Port range 7331-7340 | Available port number |
| `client/src/App.tsx` | React app shell | Server URL | Rendered UI |
| `client/src/components/PrdViewer.tsx` | Markdown rendering | PRD content string | Styled HTML with anchor IDs |
| `client/src/stores/*.ts` | Zustand state management | API responses, WS events | Reactive state |

### Technology Choices

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| HTTP server | Fastify 4.x | Fast, schema-validated routing, WebSocket plugin |
| Frontend framework | React 18 | Rich component ecosystem, annotation UI complexity justifies it |
| Build tool | Vite 5.x | Fast dev builds, pre-built output for production |
| State management | Zustand | Minimal boilerplate, WebSocket-friendly |
| Markdown rendering | react-markdown + remark-gfm + rehype-slug | GitHub-flavored markdown with heading IDs |
| Diff view | react-diff-viewer-continued | Maintained fork with side-by-side and unified diff |
| WebSocket | @fastify/websocket (ws) | Native Fastify integration |
| File watching | chokidar | Already an Ensemble root dependency |
| Browser launch | open (npm) | Cross-platform browser opening |

### Integration Points

| Integration | Protocol | Notes |
|------------|----------|-------|
| CLI -> Server | Process spawn + HTTP | CLI starts server, opens browser to URL |
| Browser -> Server | HTTP REST + WebSocket | REST for CRUD, WS for real-time events |
| Server -> PRD file | Filesystem (chokidar) | Read on request, watch for changes |
| Server -> Sidecar file | Filesystem (atomic write) | Write tmp + rename for crash safety |
| Server -> Claude | Ensemble prompt bridge | Packages annotations into structured prompt |
| OS -> CLI | ensemble:// protocol handler | OS-level URL scheme registration |

---

## Package Structure

```
packages/annotator/
+-- .claude-plugin/plugin.json
+-- package.json
+-- tsconfig.json
+-- server/
|   +-- index.ts           # Fastify server entry
|   +-- routes/
|   |   +-- prd.ts         # PRD content API
|   |   +-- annotations.ts # CRUD endpoints
|   |   +-- submit.ts      # Claude submission bridge
|   |   +-- session.ts     # Session management
|   +-- ws/
|   |   +-- handler.ts     # WebSocket connection handler
|   |   +-- events.ts      # Event type definitions
|   +-- services/
|   |   +-- sidecar.ts     # Sidecar file read/write/archive
|   |   +-- file-watcher.ts # chokidar PRD watcher
|   |   +-- port-finder.ts  # Port 7331-7340 selection
|   |   +-- session.ts      # Session ID and URL generation
|   +-- types.ts           # Server-side type definitions
+-- client/
|   +-- index.html
|   +-- src/
|   |   +-- App.tsx
|   |   +-- main.tsx
|   |   +-- components/
|   |   |   +-- PrdViewer.tsx
|   |   |   +-- annotations/
|   |   |   |   +-- CommentAnnotation.tsx
|   |   |   |   +-- DeleteSuggestion.tsx
|   |   |   |   +-- InsertSuggestion.tsx
|   |   |   |   +-- ReplaceSuggestion.tsx
|   |   |   |   +-- AnnotationToolbar.tsx
|   |   |   +-- AnnotationSummaryPanel.tsx
|   |   |   +-- DiffViewer.tsx
|   |   |   +-- VersionMismatchBanner.tsx
|   |   |   +-- RelevanceVerificationModal.tsx
|   |   +-- stores/
|   |   |   +-- prdStore.ts
|   |   |   +-- annotationStore.ts
|   |   |   +-- sessionStore.ts
|   |   +-- hooks/
|   |   |   +-- useWebSocket.ts
|   |   |   +-- useTextSelection.ts
|   |   +-- types.ts
|   |   +-- styles/
|   |       +-- annotator.css
|   +-- vite.config.ts
+-- shared/
|   +-- types.ts           # Shared types (annotation, session)
+-- scripts/
|   +-- register-protocol.ts  # OS protocol handler registration
|   +-- build-client.ts       # Vite build script
+-- tests/
    +-- server/
    +-- client/
```

---

## Master Task List

### Sprint 0: Project Scaffolding

#### TRD-001: Initialize packages/annotator/ package structure [satisfies ARCH]

- **Description:** Create package.json, tsconfig.json, plugin.json, and full directory structure for the annotator package.
- **Estimate:** 2h
- **Implementation ACs:**
  - Given the package is created, when `npm run validate` is run, then plugin.json passes schema validation
  - Given the package, when `npm install` runs from the workspace root, then all dependencies install without errors

---

#### TRD-002: Set up Vite + React client project [satisfies ARCH]

- **Description:** Configure Vite with React 18, TypeScript, create index.html, main.tsx, App.tsx shell.
- **Estimate:** 3h
- **Depends:** TRD-001
- **Implementation ACs:**
  - Given the client directory, when `npm run build:client` runs, then Vite produces a dist/ with index.html, JS, and CSS bundles
  - Given the built output, when served statically, then a blank React app renders in the browser

---

#### TRD-003: Set up Fastify server with port management [satisfies REQ-001]

- **Description:** Fastify server entry, port finder (7331-7340), serves Vite-built client, auto-opens browser.
- **Estimate:** 4h
- **Depends:** TRD-001, TRD-002
- **Validates PRD ACs:** AC-001-1, AC-001-3
- **Implementation ACs:**
  - Given port 7331 is available, when the server starts, then it binds to 7331 and opens the browser
  - Given port 7331 is in use, when the server starts, then it tries 7332-7340 until finding an available port
  - Given the server is running, when the browser navigates to the URL, then the React app loads

---

#### TRD-003-TEST: Test port management and server startup [verifies TRD-003] [satisfies REQ-001] [depends: TRD-003]

- **Description:** Test port fallback, server lifecycle, browser launch mock.
- **Estimate:** 2h
- **Implementation ACs:**
  - Given a mock where port 7331 is occupied, when startServer() is called, then it binds to 7332
  - Given the server starts successfully, when stop() is called, then the port is released

---

### Sprint 1: PRD Viewer Foundation (Cluster A)

#### TRD-004: Implement PRD markdown rendering with react-markdown [satisfies REQ-001, REQ-002]

- **Description:** PrdViewer component using react-markdown + remark-gfm + rehype-slug for heading anchor IDs.
- **Estimate:** 4h
- **Depends:** TRD-003
- **Validates PRD ACs:** AC-001-2, AC-002-1
- **Implementation ACs:**
  - Given a PRD markdown string, when rendered by PrdViewer, then headings, lists, code blocks, and tables are styled HTML (no raw markdown visible)
  - Given an H2 heading "## Goals and Non-Goals", when rendered, then the element has `id="goals-and-non-goals"`
  - Given an H3 heading "### REQ-001: Local HTTP Server", when rendered, then the element has `id="req-001-local-http-server"` or equivalent slug

---

#### TRD-004-TEST: Test PRD rendering and anchor generation [verifies TRD-004] [satisfies REQ-001, REQ-002] [depends: TRD-004]

- **Description:** Snapshot tests for markdown rendering, unit tests for anchor ID generation.
- **Estimate:** 2h
- **Implementation ACs:**
  - Given a PRD with special characters in headings (e.g., `## Goals & Non-Goals`), when rendered, then the `id` is a valid HTML ID with special chars stripped (verifies AC-002-3)
  - Given a PRD with 20 headings, when rendered, then all 20 have unique `id` attributes

---

#### TRD-005: Implement PRD content API endpoint [satisfies REQ-001]

- **Description:** GET /api/prd reads PRD file from disk, returns { content: string, hash: string, headings: [] }.
- **Estimate:** 2h
- **Depends:** TRD-003
- **Validates PRD ACs:** AC-001-1
- **Implementation ACs:**
  - Given a valid PRD path, when GET /api/prd is called, then it returns 200 with markdown content and SHA-256 hash
  - Given an invalid path, when GET /api/prd is called, then it returns 404 with an error message

---

#### TRD-006: Bundle all assets locally (offline mode) [satisfies REQ-003]

- **Description:** Configure Vite to inline fonts, ensure no external CDN references in build output.
- **Estimate:** 2h
- **Depends:** TRD-002
- **Validates PRD ACs:** AC-003-1, AC-003-2, AC-003-3
- **Implementation ACs:**
  - Given the built client output, when all `src` and `href` attributes are scanned, then none reference external hostnames
  - Given no network access, when the local server serves the page, then all assets load with zero network errors

---

#### TRD-006-TEST: Test offline asset bundling [verifies TRD-006] [satisfies REQ-003] [depends: TRD-006]

- **Description:** Scan built HTML for external URLs, test with network disabled.
- **Estimate:** 1h
- **Implementation ACs:**
  - Given the dist/ output, when scanned for external URLs via regex, then zero matches are found

---

#### TRD-007: Implement scrollIntoView API [satisfies REQ-002]

- **Description:** Client-side function that receives an anchor ID and calls scrollIntoView with smooth behavior.
- **Estimate:** 2h
- **Depends:** TRD-004
- **Validates PRD ACs:** AC-002-2
- **Implementation ACs:**
  - Given an anchor ID "req-007", when scrollToAnchor("req-007") is called, then the heading with that ID is visible in the viewport

---

### Sprint 2: Enhanced refine-prd (Cluster B)

#### TRD-008: Add browser launch to refine-prd command [satisfies REQ-004]

- **Description:** Modify refine-prd.yaml to launch the annotator server before starting the Q&A interview. Browser launch is non-blocking.
- **Estimate:** 4h
- **Depends:** TRD-003, TRD-004
- **Validates PRD ACs:** AC-004-1, AC-004-2, AC-004-3
- **Implementation ACs:**
  - Given refine-prd is invoked with a PRD path, when the command starts, then the browser opens and the terminal interview begins without waiting for browser interaction
  - Given the user closes the browser tab, when the next question is asked, then the terminal session continues normally
  - Given refine-prd ends, when the session exits, then the Fastify server shuts down

---

#### TRD-009: Add --no-browser flag to refine-prd [satisfies REQ-004]

- **Description:** Parse --no-browser flag from $ARGUMENTS, skip server launch when present.
- **Estimate:** 1h
- **Depends:** TRD-008
- **Validates PRD ACs:** AC-004-4
- **Implementation ACs:**
  - Given `refine-prd --no-browser docs/PRD/PRD-2026-020.md`, when invoked, then no browser opens and no server starts

---

#### TRD-010: Implement question-to-anchor matching [satisfies REQ-005]

- **Description:** Logic that maps interview questions to PRD heading anchors. Matches by REQ-NNN ID extraction or heading text fuzzy match.
- **Estimate:** 3h
- **Depends:** TRD-004
- **Validates PRD ACs:** AC-005-1, AC-005-2, AC-005-3
- **Implementation ACs:**
  - Given a question "Tell me more about REQ-007", when matchQuestionToAnchor() is called, then it returns "req-007"
  - Given a question "What about the Goals section?", when matched, then it returns the anchor for the "Goals and Non-Goals" heading
  - Given a question with no matching heading, when matched, then it returns null (no scroll)

---

#### TRD-010-TEST: Test question-to-anchor matching [verifies TRD-010] [satisfies REQ-005] [depends: TRD-010]

- **Description:** Unit tests for REQ-NNN extraction, heading fuzzy match, no-match fallback.
- **Estimate:** 2h
- **Implementation ACs:**
  - Given 10 sample questions spanning REQ references and heading text, when matched, then at least 8 return correct anchors and 2 unmatched return null

---

#### TRD-011: Implement WebSocket scroll sync [satisfies REQ-006]

- **Description:** @fastify/websocket handler. Server emits scroll events; client listens and calls scrollToAnchor. Debounce rapid transitions.
- **Estimate:** 4h
- **Depends:** TRD-007, TRD-010
- **Validates PRD ACs:** AC-006-1, AC-006-2
- **Implementation ACs:**
  - Given question 4 appears in the terminal, when the scroll event is sent, then the browser scrolls within 500ms
  - Given 5 rapid scroll events within 200ms, when processed, then only the last anchor is scrolled to

---

#### TRD-011-TEST: Test WebSocket scroll sync [verifies TRD-011] [satisfies REQ-006] [depends: TRD-011]

- **Description:** Test scroll event delivery, debounce behavior, reconnection.
- **Estimate:** 2h
- **Implementation ACs:**
  - Given a WS client connected, when a scroll event is emitted, then the client receives it within 100ms
  - Given 10 rapid events, when processed by the debouncer, then only 1 scroll action fires

---

### Sprint 3: Annotation Engine (Cluster C)

#### TRD-012: Define annotation data model and sidecar schema [satisfies REQ-008]

- **Description:** TypeScript types and JSON schema for annotation entries: { id, type, anchor, author, timestamp, content }.
- **Estimate:** 2h
- **Depends:** TRD-001
- **Validates PRD ACs:** AC-008-2
- **Implementation ACs:**
  - Given the TypeScript annotation type, when an annotation is created, then all required fields (id, type, anchor, author, timestamp, content) are present
  - Given the JSON schema, when validated with ajv, then valid annotations pass and invalid ones fail

---

#### TRD-013: Implement sidecar file service [satisfies REQ-008, REQ-019]

- **Description:** Read/write/delete annotations in JSON sidecar file. Atomic writes (write to .tmp, rename). Incremental persistence.
- **Estimate:** 4h
- **Depends:** TRD-012
- **Validates PRD ACs:** AC-008-1, AC-008-3, AC-019-1, AC-019-2, AC-019-3
- **Implementation ACs:**
  - Given annotations are written to the sidecar, when the PRD source file is compared before and after, then it is byte-for-byte identical
  - Given the PRD is at `docs/PRD/PRD-2026-020-prd-annotator.md`, when the sidecar is created, then it is at `docs/PRD/PRD-2026-020-prd-annotator.annotations.json`
  - Given a write failure (mock disk full), when an annotation is submitted, then the error is surfaced and the annotation is not silently lost
  - Given 3 annotations saved and the server crashes, when restarted, then all 3 annotations are present in the loaded sidecar

---

#### TRD-013-TEST: Test sidecar file service [verifies TRD-013] [satisfies REQ-008, REQ-019] [depends: TRD-013]

- **Description:** Tests for atomic writes, filename convention, persistence across restart, error handling.
- **Estimate:** 3h
- **Implementation ACs:**
  - Given concurrent write attempts, when both complete, then the sidecar file contains valid JSON with both annotations

---

#### TRD-014: Implement annotations REST API [satisfies REQ-008]

- **Description:** POST /api/annotations, DELETE /api/annotations/:id, GET /api/annotations -- all backed by sidecar service.
- **Estimate:** 3h
- **Depends:** TRD-013
- **Validates PRD ACs:** AC-008-1, AC-008-2
- **Implementation ACs:**
  - Given a valid annotation payload, when POST /api/annotations is called, then it returns 201 with the saved annotation including UUID
  - Given an annotation ID, when DELETE /api/annotations/:id is called, then the annotation is removed from the sidecar

---

#### TRD-015: Implement text selection handler [satisfies REQ-007]

- **Description:** useTextSelection hook: captures selected text range, maps to nearest heading anchor, provides selection coordinates for annotation toolbar positioning.
- **Estimate:** 3h
- **Depends:** TRD-004
- **Validates PRD ACs:** AC-007-1, AC-007-2, AC-007-3, AC-007-4
- **Implementation ACs:**
  - Given the user selects a text range in the PRD, when the selection is captured, then the hook returns { selectedText, anchorId, coordinates }
  - Given the user clicks without selecting text, when captured, then the hook returns the nearest section anchor

---

#### TRD-016: Implement Comment annotation component [satisfies REQ-007]

- **Description:** CommentAnnotation.tsx: text input for free-text note, saves to sidecar via API.
- **Estimate:** 3h
- **Depends:** TRD-015, TRD-014
- **Validates PRD ACs:** AC-007-1
- **Implementation ACs:**
  - Given a section is selected, when "Comment" is chosen, then a text input appears and submitting saves the annotation with type "comment"

---

#### TRD-017: Implement Delete suggestion component [satisfies REQ-007]

- **Description:** DeleteSuggestion.tsx: highlights selected text, creates delete annotation.
- **Estimate:** 2h
- **Depends:** TRD-015, TRD-014
- **Validates PRD ACs:** AC-007-2
- **Implementation ACs:**
  - Given text is selected, when "Delete" is chosen, then the text is visually highlighted red and a delete annotation is saved

---

#### TRD-018: Implement Insert suggestion component [satisfies REQ-007]

- **Description:** InsertSuggestion.tsx: text editor for new content, insert position selector (before/after anchor).
- **Estimate:** 3h
- **Depends:** TRD-015, TRD-014
- **Validates PRD ACs:** AC-007-3
- **Implementation ACs:**
  - Given a section is selected, when "Insert" is chosen, then a text editor appears with before/after position selector

---

#### TRD-019: Implement Replace suggestion component [satisfies REQ-007]

- **Description:** ReplaceSuggestion.tsx: split editor showing original and proposed text side by side.
- **Estimate:** 3h
- **Depends:** TRD-015, TRD-014
- **Validates PRD ACs:** AC-007-4
- **Implementation ACs:**
  - Given text is selected, when "Replace" is chosen, then a split editor shows original and proposed text side by side

---

#### TRD-020: Implement annotation toolbar [satisfies REQ-007]

- **Description:** AnnotationToolbar.tsx: floating toolbar that appears on text selection with 4 action buttons (Comment, Delete, Insert, Replace).
- **Estimate:** 2h
- **Depends:** TRD-015
- **Implementation ACs:**
  - Given text is selected, when the toolbar appears, then it shows 4 action buttons positioned near the selection
  - Given text is deselected, when the selection clears, then the toolbar hides

---

#### TRD-016-017-018-019-TEST: Test annotation components [verifies TRD-016, TRD-017, TRD-018, TRD-019] [satisfies REQ-007] [depends: TRD-016, TRD-017, TRD-018, TRD-019]

- **Description:** Component tests for all 4 annotation types, API integration, sidecar persistence.
- **Estimate:** 4h
- **Implementation ACs:**
  - Given each annotation type, when submitted, then the correct type value appears in the sidecar JSON

---

#### TRD-021: Create annotate-prd command YAML [satisfies REQ-009]

- **Description:** Add packages/product/commands/annotate-prd.yaml with schema-valid metadata.
- **Estimate:** 2h
- **Depends:** TRD-001
- **Validates PRD ACs:** AC-009-1, AC-009-2, AC-009-3
- **Implementation ACs:**
  - Given the YAML is added, when `npm run validate` runs, then it passes
  - Given no path argument, when the command is invoked, then it prompts for a PRD path

---

#### TRD-022: Implement annotation summary panel [satisfies REQ-010]

- **Description:** AnnotationSummaryPanel.tsx: lists all annotations grouped by section, click to scroll, delete button.
- **Estimate:** 3h
- **Depends:** TRD-014, TRD-007
- **Validates PRD ACs:** AC-010-1, AC-010-2, AC-010-3
- **Implementation ACs:**
  - Given 5 annotations across 3 sections, when the panel opens, then annotations are grouped by section in document order
  - Given a panel annotation is clicked, when the browser scrolls, then the target section is visible
  - Given delete is clicked on an annotation, when confirmed, then it is removed from the sidecar and the panel updates

---

### Sprint 4: Collaboration (Cluster D)

#### TRD-023: Implement session ID and URL generation [satisfies REQ-011]

- **Description:** Generate unique session IDs (nanoid), create shareable LAN URL with local IP detection.
- **Estimate:** 3h
- **Depends:** TRD-003
- **Validates PRD ACs:** AC-011-1, AC-020-3
- **Implementation ACs:**
  - Given the server starts, when the session is created, then a unique session ID is generated and the LAN URL is printed to terminal
  - Given the server is stopped, when the session URL is visited, then a connection error is shown (AC-011-3)

---

#### TRD-024: Implement WebSocket annotation broadcasting [satisfies REQ-012]

- **Description:** When any client submits an annotation, broadcast to all other connected clients. Additive-only model.
- **Estimate:** 4h
- **Depends:** TRD-011, TRD-014
- **Validates PRD ACs:** AC-012-1, AC-012-2, AC-012-3
- **Implementation ACs:**
  - Given collaborator A submits an annotation, when processed, then collaborator B sees it without refresh
  - Given a client reconnects, when the WS handshake completes, then the full annotation set is delivered
  - Given 5 concurrent submissions, then all 5 appear in the sidecar with distinct UUIDs

---

#### TRD-025: Implement concurrent write safety [satisfies REQ-012]

- **Description:** Mutex/queue for sidecar writes. Ensures atomic JSON updates under concurrent WebSocket submissions.
- **Estimate:** 3h
- **Depends:** TRD-013
- **Validates PRD ACs:** AC-012-1
- **Implementation ACs:**
  - Given 10 concurrent write attempts, when all complete, then the sidecar contains exactly 10 valid entries with no corruption

---

#### TRD-024-025-TEST: Test collaboration sync and write safety [verifies TRD-024, TRD-025] [satisfies REQ-012] [depends: TRD-024, TRD-025]

- **Description:** Concurrent write tests, broadcast tests, reconnection tests.
- **Estimate:** 3h
- **Implementation ACs:**
  - Given 5 simulated WS clients, when each submits 1 annotation concurrently, then the sidecar has 5 entries

---

#### TRD-026: Implement file watcher for PRD changes [satisfies REQ-013]

- **Description:** chokidar watcher on the PRD file. On change, compute new hash, compare with session hash, emit version-mismatch WS event if different. 10-second polling interval.
- **Estimate:** 3h
- **Depends:** TRD-003, TRD-005
- **Validates PRD ACs:** AC-013-1, AC-013-2, AC-013-3
- **Implementation ACs:**
  - Given the PRD file is modified, when chokidar detects the change, then a version-mismatch event is emitted within 10 seconds
  - Given no file change for 60 minutes, then no false-positive mismatch event fires

---

#### TRD-027: Implement version mismatch warning banner [satisfies REQ-013]

- **Description:** VersionMismatchBanner.tsx: prominent warning bar with "Refresh to new version" action.
- **Estimate:** 2h
- **Depends:** TRD-026
- **Validates PRD ACs:** AC-013-1, AC-013-2
- **Implementation ACs:**
  - Given a mismatch event is received, when the banner appears, then it shows "PRD has been modified" with a refresh button
  - Given the banner is dismissed, when the file changes again, then the banner reappears

---

#### TRD-028: Implement annotation relevance verification [satisfies REQ-014]

- **Description:** RelevanceVerificationModal.tsx: after refresh, shows each annotation with "Still relevant / Edit / Discard" controls. Detects removed headings.
- **Estimate:** 4h
- **Depends:** TRD-027, TRD-014
- **Validates PRD ACs:** AC-014-1, AC-014-2, AC-014-3
- **Implementation ACs:**
  - Given a refresh after mismatch, when existing annotations are checked, then each shows relevance controls
  - Given an annotation targets a removed heading, when shown, then it is flagged "Section removed" and pre-selected for discard
  - Given all annotations are resolved, when "Continue" is clicked, then only confirmed/edited annotations remain

---

#### TRD-028-TEST: Test version mismatch and relevance verification [verifies TRD-026, TRD-027, TRD-028] [satisfies REQ-013, REQ-014] [depends: TRD-028]

- **Description:** File watcher tests, banner display tests, relevance modal tests.
- **Estimate:** 3h
- **Implementation ACs:**
  - Given a PRD edit that removes a heading, when relevance is checked, then the annotation targeting that heading is flagged "Section removed"

---

#### TRD-029: Implement OS protocol handler registration [satisfies REQ-020]

- **Description:** scripts/register-protocol.ts: registers ensemble:// URL scheme on macOS (LSRegisterURL / Info.plist), Linux (xdg-mime), Windows (registry). Run at install time.
- **Estimate:** 4h
- **Depends:** TRD-003
- **Validates PRD ACs:** AC-020-1, AC-020-2
- **Implementation ACs:**
  - Given ensemble:// is registered on macOS, when a user clicks an ensemble:// link, then the CLI is invoked with the URL as an argument
  - Given the server is already running, when a second ensemble:// click occurs, then no second server starts -- browser connects to existing session

---

#### TRD-030: Implement embedded annotation link generation [satisfies REQ-020]

- **Description:** Modify create-prd output to append an annotation link section (HTML comment with ensemble:// URL) at the bottom of generated PRDs.
- **Estimate:** 2h
- **Depends:** TRD-029
- **Validates PRD ACs:** AC-020-4
- **Implementation ACs:**
  - Given create-prd generates a PRD, when saved, then the file includes `<!-- annotate: ensemble://annotate-prd?file=<filename> -->` at the bottom

---

#### TRD-029-030-TEST: Test protocol handler and embedded link [verifies TRD-029, TRD-030] [satisfies REQ-020] [depends: TRD-029, TRD-030]

- **Description:** Test link generation, protocol handler invocation mock.
- **Estimate:** 2h
- **Implementation ACs:**
  - Given a generated PRD, when scanned for the annotation comment, then it matches the expected pattern

---

### Sprint 5: Claude Integration (Cluster E)

#### TRD-031: Implement annotation packaging [satisfies REQ-015]

- **Description:** Package PRD content + all confirmed annotations into a structured prompt for Claude. POST /api/submit endpoint.
- **Estimate:** 3h
- **Depends:** TRD-014
- **Validates PRD ACs:** AC-015-1, AC-015-3
- **Implementation ACs:**
  - Given 5 confirmed annotations, when packaged, then the prompt includes full PRD content and all 5 annotation entries with type, anchor, and content
  - Given zero confirmed annotations, when Submit is clicked, then a validation error is returned

---

#### TRD-032: Implement Claude revision bridge [satisfies REQ-015]

- **Description:** Submit packaged annotations to Claude, receive revised PRD, save with version suffix (-v2, -v3, etc.).
- **Estimate:** 4h
- **Depends:** TRD-031
- **Validates PRD ACs:** AC-015-2
- **Implementation ACs:**
  - Given Claude produces a revision, when saved, then the file is `PRD-2026-020-prd-annotator-v2.md` and the original is untouched
  - Given a v2 already exists, when a second revision is produced, then it saves as `-v3.md`

---

#### TRD-033: Implement sidecar archival [satisfies REQ-021]

- **Description:** After Claude revision is confirmed, rename sidecar to .applied.json, create fresh sidecar for revised PRD.
- **Estimate:** 2h
- **Depends:** TRD-032, TRD-013
- **Validates PRD ACs:** AC-021-1, AC-021-2, AC-021-3
- **Implementation ACs:**
  - Given a revision is confirmed, when archival runs, then the original sidecar is renamed to `.applied.json` and a new empty sidecar exists for the revised PRD
  - Given a second annotation round, when annotations are written, then they go to the v2 sidecar, not the archived v1

---

#### TRD-034: Implement diff view component [satisfies REQ-016]

- **Description:** DiffViewer.tsx using react-diff-viewer-continued. Side-by-side view with collapsible unchanged sections. Click changed section to see which annotation caused it.
- **Estimate:** 4h
- **Depends:** TRD-032
- **Validates PRD ACs:** AC-016-1, AC-016-2, AC-016-3
- **Implementation ACs:**
  - Given original and revised PRDs, when the diff view renders, then added lines are green, removed lines are red, unchanged sections are collapsed
  - Given a collapsed section, when expanded, then full text is visible
  - Given a changed section is clicked, when the side panel opens, then the corresponding annotations are listed

---

#### TRD-035: Implement approve/re-annotate actions [satisfies REQ-017]

- **Description:** Approve: save revised PRD as canonical, trigger sidecar archival, shut down server. Re-annotate: reload with revised PRD.
- **Estimate:** 2h
- **Depends:** TRD-034, TRD-033
- **Validates PRD ACs:** AC-017-1, AC-017-2, AC-017-3
- **Implementation ACs:**
  - Given Approve is clicked, when saved, then the terminal prints the file path and the server shuts down
  - Given Re-annotate is clicked, when reloaded, then the annotation UI shows the revised PRD with a fresh annotation set

---

#### TRD-031-035-TEST: Test Claude integration flow [verifies TRD-031, TRD-032, TRD-033, TRD-034, TRD-035] [satisfies REQ-015, REQ-016, REQ-017, REQ-021] [depends: TRD-035]

- **Description:** End-to-end tests for annotation packaging, Claude mock, sidecar archival, diff rendering, approve/re-annotate.
- **Estimate:** 4h
- **Implementation ACs:**
  - Given a mock Claude response, when the full submit -> diff -> approve flow runs, then the revised file exists, the sidecar is archived, and the server has stopped

---

### Sprint 6: Performance and Polish (Cluster F)

#### TRD-036: Performance testing with large PRDs [satisfies REQ-018]

- **Description:** Create a synthetic 200-requirement PRD, measure render time and scroll performance.
- **Estimate:** 3h
- **Depends:** TRD-004
- **Validates PRD ACs:** AC-018-1, AC-018-2
- **Implementation ACs:**
  - Given a 200-requirement PRD, when loaded, then initial render completes within 3 seconds
  - Given a programmatic scroll, when triggered, then the target heading is in viewport within 500ms

---

#### TRD-037: Performance optimization [satisfies REQ-018]

- **Description:** If TRD-036 reveals performance issues: implement virtualized rendering (react-window or similar), lazy loading of sections.
- **Estimate:** 4h
- **Depends:** TRD-036
- **Validates PRD ACs:** AC-018-1, AC-018-2
- **Implementation ACs:**
  - Given optimization is applied, when the 200-requirement PRD is re-tested, then it meets the 3s/500ms budgets

---

#### TRD-036-037-TEST: Performance regression test [verifies TRD-036, TRD-037] [satisfies REQ-018] [depends: TRD-037]

- **Description:** Automated performance benchmark that fails if render time exceeds 3s.
- **Estimate:** 2h
- **Implementation ACs:**
  - Given the performance test suite, when run in CI, then it reports pass/fail against the 3s budget

---

## Sprint Planning Summary

| Sprint | Focus | Tasks | Estimated Hours |
|--------|-------|-------|----------------|
| Sprint 0 | Scaffolding | TRD-001 to TRD-003-TEST | 11h |
| Sprint 1 | PRD Viewer (Cluster A) | TRD-004 to TRD-007 | 11h |
| Sprint 2 | Enhanced refine-prd (Cluster B) | TRD-008 to TRD-011-TEST | 16h |
| Sprint 3 | Annotation Engine (Cluster C) | TRD-012 to TRD-022 | 34h |
| Sprint 4 | Collaboration (Cluster D) | TRD-023 to TRD-030-TEST | 30h |
| Sprint 5 | Claude Integration (Cluster E) | TRD-031 to TRD-035-TEST | 19h |
| Sprint 6 | Performance (Cluster F) | TRD-036 to TRD-037-TEST | 9h |
| **Total** | | **37 implementation + 10 test = 47 tasks** | **~130h** |

---

## Acceptance Criteria Traceability

| REQ-NNN | Description | Implementation Tasks | Test Tasks |
|---------|-------------|---------------------|------------|
| REQ-001 | Local HTTP server with styled PRD | TRD-003, TRD-004, TRD-005, TRD-006 | TRD-003-TEST, TRD-004-TEST, TRD-006-TEST |
| REQ-002 | Anchor IDs on headings | TRD-004, TRD-007 | TRD-004-TEST |
| REQ-003 | Fully offline browser UI | TRD-006 | TRD-006-TEST |
| REQ-004 | Auto browser launch on refine-prd | TRD-008, TRD-009 | -- |
| REQ-005 | Browser auto-scroll | TRD-010 | TRD-010-TEST |
| REQ-006 | Terminal/browser scroll sync | TRD-011 | TRD-011-TEST |
| REQ-007 | Four annotation types | TRD-015, TRD-016, TRD-017, TRD-018, TRD-019, TRD-020 | TRD-016-017-018-019-TEST |
| REQ-008 | JSON sidecar file | TRD-012, TRD-013, TRD-014 | TRD-013-TEST |
| REQ-009 | annotate-prd command | TRD-021 | -- |
| REQ-010 | Annotation summary panel | TRD-022 | -- |
| REQ-011 | Shareable session URL | TRD-023 | -- |
| REQ-012 | Real-time aggregation | TRD-024, TRD-025 | TRD-024-025-TEST |
| REQ-013 | Version mismatch detection | TRD-026, TRD-027 | TRD-028-TEST |
| REQ-014 | Relevance verification | TRD-028 | TRD-028-TEST |
| REQ-015 | Claude submission | TRD-031, TRD-032 | TRD-031-035-TEST |
| REQ-016 | Diff view | TRD-034 | TRD-031-035-TEST |
| REQ-017 | Approve/re-annotate | TRD-035 | TRD-031-035-TEST |
| REQ-018 | Rendering performance | TRD-036, TRD-037 | TRD-036-037-TEST |
| REQ-019 | Annotation persistence | TRD-013 | TRD-013-TEST |
| REQ-020 | Embedded link / auto-launch | TRD-029, TRD-030 | TRD-029-030-TEST |
| REQ-021 | Sidecar archival | TRD-033 | TRD-031-035-TEST |

Traceability check: 21 requirements covered, 0 uncovered, 0 orphaned [satisfies] annotations.

---

## Team Configuration

> **Auto-generated by `/ensemble:configure-team`** — edit agent assignments below if needed.

### Complexity Metrics

| Metric | Value |
|--------|-------|
| Task count | 49 |
| Estimated hours | ~130h |
| Domain count | 4 (frontend, backend, infrastructure, testing) |
| Cross-cutting tasks | 6 |
| Dependency depth | 5 (TRD-001→003→004→011→024) |
| **Team tier** | **Complex** |

### Marketplace Analysis

Marketplace analysis: 0 gaps identified, 0 plugins suggested, 0 approved, 0 declined, 0 failed.

All required agents and skills are already available:
- **React skill** — `packages/react/skills/SKILL.md`
- **Jest skill** — `packages/jest/skills/SKILL.md`

### Agent Assignments

```yaml
team:
  lead:
    agent: tech-lead-orchestrator
    owns:
      - task-selection
      - architecture-review
      - final-approval

  builders:
    - agent: frontend-developer
      owns:
        - implementation
      domains:
        - frontend
      tasks:
        - "TRD-002: Vite + React setup"
        - "TRD-004: PRD markdown rendering"
        - "TRD-006: Offline asset bundling"
        - "TRD-007: scrollIntoView API"
        - "TRD-015: Text selection handler"
        - "TRD-016: Comment annotation component"
        - "TRD-017: Delete suggestion component"
        - "TRD-018: Insert suggestion component"
        - "TRD-019: Replace suggestion component"
        - "TRD-020: Annotation toolbar"
        - "TRD-022: Annotation summary panel"
        - "TRD-027: Version mismatch banner"
        - "TRD-028: Relevance verification modal"
        - "TRD-034: Diff view component"
        - "TRD-035: Approve/re-annotate actions"
      skills:
        - developing-with-react
        - developing-with-typescript

    - agent: backend-developer
      owns:
        - implementation
      domains:
        - backend
      tasks:
        - "TRD-003: Fastify server + port management"
        - "TRD-005: PRD content API endpoint"
        - "TRD-011: WebSocket scroll sync"
        - "TRD-012: Annotation data model + schema"
        - "TRD-013: Sidecar file service"
        - "TRD-014: Annotations REST API"
        - "TRD-023: Session ID + URL generation"
        - "TRD-024: WebSocket annotation broadcasting"
        - "TRD-025: Concurrent write safety"
        - "TRD-031: Annotation packaging"
        - "TRD-032: Claude revision bridge"
        - "TRD-033: Sidecar archival"
      skills:
        - developing-with-typescript
        - nestjs

    - agent: infrastructure-developer
      owns:
        - implementation
      domains:
        - infrastructure
      tasks:
        - "TRD-001: Package scaffolding"
        - "TRD-026: File watcher (chokidar)"
        - "TRD-029: OS protocol handler registration"
        - "TRD-030: Embedded annotation link generation"

  reviewer:
    agent: code-reviewer
    owns:
      - code-review
      - security-review

  qa:
    agent: qa-orchestrator
    owns:
      - test-orchestration
      - quality-gates
    fallback: test-runner
    tasks:
      - "All TRD-*-TEST tasks"
      - "TRD-036: Performance testing"
      - "TRD-037: Performance optimization"
    skills:
      - jest
```

### Sprint-to-Agent Mapping

| Sprint | Primary Agent(s) | Support |
|--------|-----------------|---------|
| Sprint 0 | infrastructure-developer, frontend-developer | tech-lead-orchestrator |
| Sprint 1 | frontend-developer | backend-developer (TRD-005) |
| Sprint 2 | backend-developer (server/WS), frontend-developer (TRD-010) | — |
| Sprint 3 | frontend-developer (components), backend-developer (API/sidecar) | code-reviewer |
| Sprint 4 | backend-developer (collab), infrastructure-developer (OS), frontend-developer (UI) | code-reviewer |
| Sprint 5 | backend-developer (Claude bridge), frontend-developer (diff view) | qa-orchestrator |
| Sprint 6 | qa-orchestrator | frontend-developer |

---

## Design Readiness Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Architecture Completeness | 4 | All components, interfaces, and data flows defined; WebSocket events, REST endpoints, and file I/O patterns specified |
| Task Coverage | 4 | All 21 REQ-NNN have implementation + test tasks; traceability matrix complete |
| Dependency Clarity | 4 | All dependencies explicit and acyclic; critical path: TRD-001 -> TRD-003 -> TRD-004 -> TRD-015 -> TRD-011 -> TRD-024 |
| Estimate Confidence | 4 | Estimates consistent (2-4h per task); no tasks exceed 4h; total ~130h for 7 sprints |

**Overall Score: 4.0 / 5.0 -- PASS**

### Known Risks

1. **First web UI in Ensemble (TRD-002, TRD-004)** -- React + Vite introduces a frontend build pipeline and npm dependencies not previously required by any Ensemble package. The `npm run validate` pipeline may need updates to handle client-side build artifacts. Mitigation: Sprint 0 scaffolding validates the build pipeline before feature work begins.

2. **WebSocket complexity for collaboration (TRD-024, TRD-025)** -- Concurrent annotation writes from multiple WS clients require a mutex strategy for sidecar file safety. The additive-only model reduces conflict risk but does not eliminate corrupt JSON from simultaneous disk writes. Mitigation: TRD-025 implements an in-memory write queue with atomic tmp+rename.

3. **OS protocol handler portability (TRD-029)** -- Registering `ensemble://` as a custom URL scheme requires different approaches on macOS (LSRegisterURL), Linux (xdg-mime), and Windows (registry). Testing all three is non-trivial. Mitigation: start with macOS (primary developer platform), gate Linux/Windows behind platform detection.

4. **Heuristic question-to-anchor matching (TRD-010)** -- Fuzzy matching of interview questions to PRD headings will have false negatives for general questions not referencing specific REQ-NNN IDs or heading text. Mitigation: REQ-005 AC-005-3 explicitly accepts graceful no-op behavior when no match is found.

5. **react-diff-viewer-continued maintenance (TRD-034)** -- This is a community fork; long-term maintenance is uncertain. Mitigation: the diff view is a Should priority (REQ-016), and a fallback to a simpler unified diff can be implemented if the library is abandoned.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-04-22 | Initial TRD with 47 tasks (37 implementation + 10 test), 7 sprints, ~130h total |

---

## Suggested Next Steps

```
/ensemble:configure-team docs/TRD/TRD-2026-020-prd-annotator.md
/ensemble:implement-trd-beads docs/TRD/TRD-2026-020-prd-annotator.md
```
