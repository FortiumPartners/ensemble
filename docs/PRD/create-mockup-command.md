# PRD: `/ensemble:create-mockup` Slash Command

**Document ID**: PRD-2026-008
**Version**: 1.1.0
**Date**: 2026-03-06
**Author**: Product Management Orchestrator
**Status**: Draft (Refined)
**Priority**: Medium

---

## Version History

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0.0 | 2026-03-06 | Product Management Orchestrator | Initial draft |
| 1.1.0 | 2026-03-06 | Product Management Orchestrator | Refined after user interview: (1) Added Storybook story template and Figma JSON export as initial-release output formats, (2) Changed default format from `all` to `ascii+spec`, with priority ordering across five formats, (3) Added monorepo multi-framework edge case requirements and acceptance criteria, (4) Moved command from `packages/product/` to `packages/development/`, (5) Made TRD a required input -- workflow is now PRD->TRD->Mockup->Implement, (6) Command extracts and applies technical constraints from TRD automatically |

---

## Table of Contents

1. [Product Summary](#1-product-summary)
2. [User Analysis](#2-user-analysis)
3. [Goals and Non-Goals](#3-goals-and-non-goals)
4. [Functional Requirements](#4-functional-requirements)
5. [Non-Functional Requirements](#5-non-functional-requirements)
6. [Acceptance Criteria](#6-acceptance-criteria)
7. [Technical Considerations](#7-technical-considerations)
8. [Risks and Mitigations](#8-risks-and-mitigations)
9. [Success Metrics](#9-success-metrics)
10. [Roadmap and Milestones](#10-roadmap-and-milestones)
11. [Appendix](#11-appendix)

---

## 1. Product Summary

### 1.1 Problem Statement

Developers using Ensemble's agent mesh in Claude Code face a recurring friction point when starting UI work: there is no structured way to generate a UI/UX mockup that respects the repository's existing design standards. Today, a developer who needs a mockup must:

1. **Manually audit the codebase** to identify the design system, component library, styling approach, color palette, typography, spacing tokens, and accessibility patterns already in use.
2. **Mentally synthesize** those standards before describing what they want to the frontend-developer agent or writing code from scratch.
3. **Risk inconsistency** because there is no automated step that captures and applies the repository's UI/UX conventions to a new feature mockup.

This gap exists specifically in the CLI context where visual design tools (Figma, Sketch) are unavailable. Developers need a text-native mockup format -- ASCII wireframes, HTML prototypes, structured component specifications, Storybook story templates, or Figma-compatible JSON exports -- that can be generated directly in the terminal workflow and that faithfully reflects the project's established patterns and the technical decisions already captured in the TRD.

### 1.2 Solution

Introduce a new slash command `/ensemble:create-mockup` that takes a TRD as required input and performs three distinct operations:

1. **TRD Extraction**: Reads the provided TRD to extract technical constraints -- chosen components, state management library, API endpoints, architecture patterns, and data models -- ensuring the mockup is grounded in decisions already made.

2. **Standards Discovery**: Automatically scans the repository to detect and document the UI/UX standards in use -- framework (React, Vue, Angular, Svelte, Blazor), component library (MUI, Chakra, Fluent UI, Radix, shadcn/ui), styling approach (CSS Modules, Tailwind, styled-components, SCSS), design tokens (colors, spacing, typography), accessibility patterns, and layout conventions.

3. **Mockup Generation**: Produces one or more mockup artifacts in formats appropriate for a CLI-to-design workflow:
   - **ASCII wireframe** (Markdown): Visual layout sketch using box-drawing characters, suitable for quick terminal review. *Priority 1 -- default output.*
   - **Component specification** (Markdown): Structured document defining component hierarchy, props, states, responsive breakpoints, and accessibility requirements -- ready for handoff to the `frontend-developer` agent. *Priority 2 -- default output.*
   - **Figma-compatible JSON export**: Structured JSON file conforming to the Figma Plugin API node format, importable into Figma for visual design handoff. *Priority 3 -- opt-in.*
   - **Storybook story template**: Framework-appropriate Storybook story files (CSF3 format) with pre-configured args, controls, and accessibility addon setup matching the detected component library. *Priority 4 -- opt-in.*
   - **HTML prototype** (file): A self-contained HTML file using the detected design tokens and component patterns, viewable in a browser. *Priority 5 -- opt-in.*

The command delegates to the `frontend-developer` agent (for framework detection and component expertise) and the `file-creator` agent (for safe file generation), leveraging existing Ensemble framework skills (React, Blazor, etc.) to ensure mockups match the project's idioms.

### 1.3 Value Proposition

| Stakeholder | Value |
|---|---|
| Frontend developers | Eliminates manual design system audit; mockups automatically conform to existing patterns and TRD constraints; Storybook stories are ready for development |
| Full-stack developers | Bridges the gap between TRD and implementation by providing a concrete UI spec grounded in technical decisions |
| Tech leads | Ensures UI consistency across features by encoding project standards into the mockup workflow |
| Product managers | Faster iteration from TRD to tangible UI representation without requiring external design tools |
| Designers | Figma JSON export enables importing CLI-generated layouts into Figma for visual refinement |
| Teams without designers | Provides a structured path from feature idea to UI specification in a CLI-only workflow |

---

## 2. User Analysis

### 2.1 User Personas

#### Persona 1: Sofia -- The Frontend Developer

- **Role**: Senior frontend developer, daily Ensemble user with `ensemble-full` installed
- **Context**: Works on a React + Tailwind + shadcn/ui project. Uses `/ensemble:create-prd` and `/ensemble:create-trd` regularly. Needs to mock up new features before writing component code.
- **Pain Points**:
  - Spends 15-30 minutes at the start of each feature manually reviewing the existing design system to ensure consistency
  - Has no way to quickly communicate a layout idea to teammates in the terminal (resorts to hand-drawn sketches on paper or switching to Figma)
  - The `frontend-developer` agent builds components well but has no structured "pre-implementation" step that validates the planned UI against project conventions
  - Manually writes Storybook stories from scratch for every new component
- **Need**: A command that produces a component spec, wireframe, and Storybook story template she can review before delegating to `frontend-developer` for implementation

#### Persona 2: Raj -- The Full-Stack Solo Developer

- **Role**: Independent developer building a SaaS product, Ensemble user for 3 months
- **Context**: Works alone on a Vue 3 + Vuetify project. No designer on the team. Uses Claude Code for both backend and frontend work.
- **Pain Points**:
  - Does not have design skills and struggles to plan UI layouts before coding
  - Often builds a component, realizes the layout is wrong, and rebuilds -- wasting 1-2 hours per feature
  - Wishes he could describe a feature in words and get back a structured UI plan that respects his existing Vuetify patterns
  - Cannot export layouts to Figma for feedback from contract designers
- **Need**: An automated way to go from a TRD to a structured mockup that follows his project's existing patterns, with optional Figma export for external review

#### Persona 3: Chen -- The Tech Lead

- **Role**: Tech lead managing a team of 4 developers on an Angular + Material monorepo with multiple applications
- **Context**: Reviews PRs daily and frequently catches UI inconsistencies (wrong spacing, misused components, accessibility gaps). Uses Ensemble orchestrators for planning. Manages a monorepo containing Angular frontend, shared component library, and internal tooling apps.
- **Pain Points**:
  - Developers on the team create UI features that deviate from the established design system because there is no pre-implementation checkpoint
  - TRDs define technical approach but not what the UI should look like in terms of the existing component vocabulary
  - No way to generate a "reference mockup" that developers can follow during implementation
  - Monorepo structure means different apps may use different subsets of the shared component library
- **Need**: A mockup generation step that sits between TRD creation and implementation, establishing the UI contract before development begins, with awareness of monorepo structure

### 2.2 User Journey Map

```
TRD Complete        TRD Extraction        Standards Discovery     Mockup Generation     Review & Iterate     Implementation
--------------      ----------------      --------------------    -------------------   ------------------   ---------------
User runs       --> Command reads     --> Command scans       --> Generates mockup  --> User reviews     --> Mockup feeds
/ensemble:          TRD to extract        repo for framework,     in requested           mockup, requests    into direct
create-mockup       components, state     component library,      format (default:       adjustments via     frontend-developer
with TRD path       mgmt, API             styling, tokens,        ASCII + spec;          re-running with     delegation
                    endpoints             accessibility           opt-in: Figma,         refinements
                                                                  Storybook, HTML)
```

### 2.3 User Pain Points Summary

| Pain Point | Severity | Frequency | Current Workaround |
|---|---|---|---|
| Manual design system audit per feature | High | Every new feature | Reading through existing components manually |
| No text-native mockup format for CLI | High | Every new feature | Switching to external tools or skipping mockups entirely |
| UI inconsistency across features | Medium | Per PR review cycle | Manual code review catching deviations late |
| Gap between TRD and implementation | Medium | Every feature sprint | Verbal/chat descriptions of desired UI |
| No pre-implementation UI validation | Medium | Every feature sprint | Building and then refactoring if wrong |
| No Storybook story scaffolding | Medium | Every new component | Writing boilerplate stories from scratch |
| Cannot export CLI layouts to Figma | Medium | When designer review needed | Manually recreating layouts in Figma |
| Monorepo framework detection confusion | Medium | Per monorepo feature | Manually specifying which app/framework to target |

---

## 3. Goals and Non-Goals

### 3.1 Goals

| ID | Goal | Measurable Target |
|---|---|---|
| G1 | Automatically detect UI/UX standards from any supported framework repository, including monorepos | Correct detection for React, Vue, Angular, Svelte, and Blazor projects with 90%+ accuracy; correct monorepo app isolation |
| G2 | Generate ASCII wireframe mockups in Markdown format | Output renders correctly in terminal and Markdown viewers |
| G3 | Generate self-contained HTML prototype files | HTML file opens in browser with correct styling reflecting detected design tokens |
| G4 | Generate structured component specification documents | Spec includes component tree, props, states, accessibility, and responsive behavior |
| G5 | Generate Figma-compatible JSON export files | JSON conforms to Figma Plugin API node format and imports successfully into Figma |
| G6 | Generate Storybook story templates in CSF3 format | Stories load in Storybook without errors and include controls, args, and a11y addon config |
| G7 | Integrate with existing Ensemble agent mesh | Delegates to `frontend-developer` and `file-creator` agents following established patterns |
| G8 | Leverage existing framework skills for mockup accuracy | Uses `packages/react/skills/SKILL.md`, `packages/blazor/skills/SKILL.md`, etc. for framework-specific patterns |
| G9 | Save all mockup artifacts to a consistent output directory | All outputs saved to `docs/mockups/` or user-specified path |
| G10 | Require and extract constraints from a TRD as input | TRD-specified components, state management, and API endpoints are reflected in all mockup outputs |

### 3.2 Non-Goals

| ID | Non-Goal | Rationale |
|---|---|---|
| NG1 | Generate pixel-perfect visual designs or raster images (PNG, SVG, PDF) | Claude Code is a CLI tool; text-based and structured data formats are the appropriate medium |
| NG2 | Replace dedicated design tools (Figma, Sketch, Adobe XD) | Figma JSON export is a bridge format for handoff, not a replacement for full design workflows |
| NG3 | Build a persistent design system documentation generator | The mockup command is feature-scoped, not a global design system tool (though it reads the existing system) |
| NG4 | Support non-web frameworks (iOS/Swift, Android/Kotlin, Flutter) | Web frameworks are the scope of existing Ensemble frontend skills |
| NG5 | Provide interactive mockup editing in the terminal | Mockups are generated artifacts to be reviewed and iterated by re-running the command |
| NG6 | Auto-implement mockups into component code | Implementation is handled by `frontend-developer` agent via `/ensemble:implement-trd` |
| NG7 | Generate mockups for backend/API features | This command is scoped to UI/UX; API documentation is handled by `/ensemble:generate-api-docs` |
| NG8 | Run without a TRD | A TRD is a required input to ensure mockups are grounded in technical decisions |

---

## 4. Functional Requirements

### 4.1 TRD Extraction Engine

The command must read and parse the provided TRD to extract technical constraints before generating mockups.

| ID | Requirement | Priority |
|---|---|---|
| FR-TE-1 | Accept a TRD file path as a required argument (e.g., `/ensemble:create-mockup docs/TRD/user-dashboard.md`) | Must |
| FR-TE-2 | Validate that the provided file exists and is a valid TRD document (contains expected sections: technical requirements, architecture, component choices) | Must |
| FR-TE-3 | Extract specified frontend components and their library source (e.g., "Use shadcn/ui Card for dashboard widgets") from the TRD | Must |
| FR-TE-4 | Extract state management approach from the TRD (e.g., Zustand, Redux, Pinia, signals) and reflect it in component specs | Must |
| FR-TE-5 | Extract API endpoint definitions from the TRD and map them to data-binding points in the component specification | Must |
| FR-TE-6 | Extract architecture patterns from the TRD (e.g., server components vs client components, SSR vs SPA) and reflect them in mockup structure | Should |
| FR-TE-7 | Extract data models and TypeScript interfaces from the TRD and use them for component props typing in the specification | Should |
| FR-TE-8 | If the TRD references a PRD, optionally follow the link to extract user-facing feature descriptions for wireframe labeling | Could |

### 4.2 Standards Discovery Engine

The command must scan the repository to identify and document existing UI/UX standards before generating any mockup.

| ID | Requirement | Priority |
|---|---|---|
| FR-SD-1 | Detect frontend framework by scanning `package.json`, project files (`.jsx`, `.tsx`, `.vue`, `.razor`, `angular.json`), and import patterns -- using the same framework detection signals defined in the `frontend-developer` agent | Must |
| FR-SD-2 | Detect component library (MUI, Chakra UI, Ant Design, Vuetify, Angular Material, Fluent UI, Radix, shadcn/ui, Headless UI) by scanning `package.json` dependencies and component imports | Must |
| FR-SD-3 | Detect styling approach (CSS Modules, Tailwind CSS, styled-components, Emotion, SCSS/SASS, CSS-in-JS, vanilla CSS) by scanning config files (`tailwind.config.*`, `postcss.config.*`, `.scss` files) and import patterns | Must |
| FR-SD-4 | Extract design tokens when available: colors from Tailwind config or CSS custom properties, spacing scale, typography scale, border radius values, breakpoint definitions | Should |
| FR-SD-5 | Detect accessibility patterns in use: ARIA patterns, keyboard navigation approaches, screen reader conventions, focus management strategies | Should |
| FR-SD-6 | Detect layout conventions: grid system (CSS Grid vs Flexbox vs framework grid), responsive patterns, container width conventions, navigation patterns (sidebar, topbar, tabs) | Should |
| FR-SD-7 | Produce a structured "UI Standards Report" (Markdown) as an intermediate artifact documenting all detected standards, saved alongside the mockup output | Should |
| FR-SD-8 | Cache standards discovery results for the current session to avoid redundant scanning when generating multiple mockups | Could |
| FR-SD-9 | Support monorepo detection: identify workspace root (`workspaces` in `package.json`, `pnpm-workspace.yaml`, `lerna.json`, `nx.json`), enumerate apps/packages, and scope standards discovery to the target application specified by the user or inferred from the TRD | Must |
| FR-SD-10 | When a monorepo is detected with multiple frameworks, prompt the user to select the target application if the TRD does not specify one, or auto-select based on TRD context | Must |

### 4.3 Mockup Generation -- ASCII Wireframe (Priority 1 -- Default)

| ID | Requirement | Priority |
|---|---|---|
| FR-AW-1 | Generate ASCII wireframe using Unicode box-drawing characters (`+`, `-`, `\|`, `+--+`) that renders correctly in monospace terminals and Markdown code blocks | Must |
| FR-AW-2 | Support common UI patterns: header/footer, sidebar navigation, content area, card grids, forms (input fields, buttons, dropdowns), tables, modals/dialogs | Must |
| FR-AW-3 | Include annotations within the wireframe indicating component names from the detected library (e.g., `[MUI: AppBar]`, `[shadcn: Card]`) | Should |
| FR-AW-4 | Support responsive annotations showing mobile, tablet, and desktop layouts (as separate wireframes or annotated breakpoints) | Should |
| FR-AW-5 | Include a legend mapping wireframe elements to detected component library components | Should |
| FR-AW-6 | Annotate data-binding points extracted from TRD API endpoints (e.g., `[GET /api/users -> UserList]`) | Should |

### 4.4 Mockup Generation -- Component Specification (Priority 2 -- Default)

| ID | Requirement | Priority |
|---|---|---|
| FR-CS-1 | Generate a Markdown document defining the component hierarchy (tree structure) for the requested feature | Must |
| FR-CS-2 | For each component, specify: name, description, props interface (TypeScript types), state management approach, events/callbacks | Must |
| FR-CS-3 | Map each component to the detected library equivalent (e.g., "Use `<Card>` from shadcn/ui" or "Use `<v-card>` from Vuetify") | Must |
| FR-CS-4 | Include accessibility requirements per component: ARIA attributes, keyboard interaction pattern, focus order, screen reader behavior | Should |
| FR-CS-5 | Include responsive behavior per component: breakpoint-specific layout changes, show/hide logic, stacking behavior | Should |
| FR-CS-6 | Include state management notes using the TRD-specified state management library: which state is local vs global, data flow direction, loading/error states, store/slice definitions | Must |
| FR-CS-7 | Generate an estimated component count and complexity assessment | Could |
| FR-CS-8 | Include API data binding section: for each component that consumes API data, reference the TRD endpoint, request/response types, and loading/error state handling | Must |
| FR-CS-9 | Use TypeScript interfaces and data models extracted from the TRD for props typing rather than generating new types | Should |

### 4.5 Mockup Generation -- Figma-Compatible JSON Export (Priority 3 -- Opt-in)

| ID | Requirement | Priority |
|---|---|---|
| FR-FJ-1 | Generate a JSON file conforming to the Figma Plugin API node structure (`FRAME`, `TEXT`, `RECTANGLE`, `GROUP`, `COMPONENT` node types) | Must |
| FR-FJ-2 | Map detected design tokens (colors, spacing, typography, border radius) to Figma style properties (`fills`, `strokes`, `effects`, `textStyle`) | Must |
| FR-FJ-3 | Represent the component hierarchy from the component spec as nested Figma frames with auto-layout properties | Should |
| FR-FJ-4 | Include Figma component variants where the detected library uses variant patterns (e.g., Button primary/secondary/destructive) | Should |
| FR-FJ-5 | Include a companion README explaining how to import the JSON into Figma using a plugin or the Figma REST API | Must |
| FR-FJ-6 | Apply responsive layout using Figma auto-layout constraints (`MIN_WIDTH`, `MAX_WIDTH`, `FILL_PARENT`) matching detected breakpoints | Could |

### 4.6 Mockup Generation -- Storybook Story Template (Priority 4 -- Opt-in)

| ID | Requirement | Priority |
|---|---|---|
| FR-ST-1 | Generate Storybook story files in Component Story Format 3 (CSF3) syntax compatible with Storybook 7+ | Must |
| FR-ST-2 | Generate one story file per component defined in the component specification, with appropriate file naming (`ComponentName.stories.tsx` or `.stories.vue`, etc.) | Must |
| FR-ST-3 | Include `meta` object with `title`, `component`, `tags: ['autodocs']`, `argTypes` with controls matching component props | Must |
| FR-ST-4 | Generate story variants: `Default`, `Loading`, `Error`, `Empty` states based on the component specification's state definitions | Should |
| FR-ST-5 | Include `@storybook/addon-a11y` configuration for accessibility testing within stories | Should |
| FR-ST-6 | Include `play` functions for interaction tests where the component spec defines user interactions (form submission, tab switching, etc.) | Could |
| FR-ST-7 | Use the TRD-specified state management library for stories that require global state (e.g., wrap in Redux Provider, Pinia setup) | Should |

### 4.7 Mockup Generation -- HTML Prototype (Priority 5 -- Opt-in)

| ID | Requirement | Priority |
|---|---|---|
| FR-HP-1 | Generate a self-contained HTML file (single file, no external dependencies beyond CDN links) that can be opened in a browser | Must |
| FR-HP-2 | Apply detected design tokens: colors, typography, spacing, border radius from the project's Tailwind config, CSS custom properties, or theme configuration | Must |
| FR-HP-3 | Use appropriate CDN-hosted CSS framework when detected (Tailwind CDN, Bootstrap CDN, etc.) for visual accuracy | Should |
| FR-HP-4 | Include responsive behavior matching detected breakpoints | Should |
| FR-HP-5 | Include basic interactivity where relevant (tab switching, dropdown toggling, modal open/close) using inline JavaScript | Could |
| FR-HP-6 | Include accessibility attributes (ARIA roles, labels, landmarks) matching detected project patterns | Should |
| FR-HP-7 | Include a comment header documenting which design tokens and components were used and their source files | Should |

### 4.8 Command Interface

| ID | Requirement | Priority |
|---|---|---|
| FR-CI-1 | Accept a TRD file path as a required first argument (e.g., `/ensemble:create-mockup docs/TRD/user-dashboard.md`) | Must |
| FR-CI-2 | Accept an optional feature description as additional `$ARGUMENTS` to supplement TRD context (e.g., `/ensemble:create-mockup docs/TRD/user-dashboard.md focus on the analytics card layout`) | Should |
| FR-CI-3 | Support format selection: `--format=ascii`, `--format=spec`, `--format=figma`, `--format=storybook`, `--format=html`, `--format=all` (default: `ascii,spec`) | Must |
| FR-CI-4 | Support output path override: `--output=<path>` (default: `docs/mockups/`) | Should |
| FR-CI-5 | Support an optional `--components` flag to list specific existing components to reuse in the mockup | Could |
| FR-CI-6 | Support an optional `--app=<name>` flag for monorepo projects to specify which application to target for standards discovery | Should |
| FR-CI-7 | Command must NOT implement any code -- it generates mockup artifacts only, consistent with the constraint pattern used by `create-prd` and `create-trd` | Must |
| FR-CI-8 | If no TRD path is provided, display an error message explaining that a TRD is required and suggesting `/ensemble:create-trd` to create one | Must |

### 4.9 Agent Delegation

| ID | Requirement | Priority |
|---|---|---|
| FR-AD-1 | Delegate framework detection and component expertise to the `frontend-developer` agent, which loads the appropriate framework skill (React SKILL.md, Blazor SKILL.md, etc.) | Must |
| FR-AD-2 | Delegate file creation (HTML prototypes, Markdown documents, JSON exports, story files) to the `file-creator` agent following its safe file operations protocol (overwrite prevention, path validation) | Must |
| FR-AD-3 | Route through `ensemble-orchestrator` or `tech-lead-orchestrator` when the mockup requires cross-cutting decisions (e.g., choosing between layout approaches) | Should |
| FR-AD-4 | Delegate TRD parsing and constraint extraction to the `tech-lead-orchestrator` to ensure accurate interpretation of technical decisions | Should |

### 4.10 Output Management

| ID | Requirement | Priority |
|---|---|---|
| FR-OM-1 | Save all mockup artifacts to `docs/mockups/<feature-name>/` directory | Must |
| FR-OM-2 | Use descriptive filenames: `wireframe.md`, `prototype.html`, `component-spec.md`, `ui-standards-report.md`, `figma-export.json`, `stories/` (directory for Storybook files) | Must |
| FR-OM-3 | Include a `README.md` in the mockup directory summarizing what was generated, the detected standards, TRD constraints applied, and next steps | Should |
| FR-OM-4 | Print a summary to the terminal listing all generated files with absolute paths | Must |

---

## 5. Non-Functional Requirements

### 5.1 Performance

| ID | Requirement | Target |
|---|---|---|
| NFR-P-1 | Standards discovery scan completion time | Less than 15 seconds for repositories up to 10,000 files |
| NFR-P-2 | Total mockup generation time (all five formats) | Less than 90 seconds |
| NFR-P-3 | Default mockup generation time (ASCII + spec) | Less than 45 seconds |
| NFR-P-4 | Individual mockup format generation time | Less than 30 seconds per format |
| NFR-P-5 | TRD extraction time | Less than 5 seconds |
| NFR-P-6 | Monorepo workspace enumeration time | Less than 10 seconds for monorepos with up to 50 packages |

### 5.2 Compatibility

| ID | Requirement | Target |
|---|---|---|
| NFR-C-1 | Supported frameworks for standards detection | React 18+, Vue 3+, Angular 15+, Svelte 4+, Blazor .NET 7+ |
| NFR-C-2 | ASCII wireframes render correctly in | macOS Terminal, iTerm2, VS Code terminal, GitHub Markdown preview |
| NFR-C-3 | HTML prototypes render correctly in | Chrome, Firefox, Safari (latest 2 versions) |
| NFR-C-4 | No breaking changes to existing Ensemble commands | Zero regressions in existing command behavior |
| NFR-C-5 | Figma JSON export compatible with | Figma Plugin API v1, Figma REST API v1 |
| NFR-C-6 | Storybook story templates compatible with | Storybook 7.x and 8.x (CSF3 format) |
| NFR-C-7 | Monorepo tool support | npm workspaces, pnpm workspaces, Yarn workspaces, Nx, Lerna, Turborepo |

### 5.3 Accessibility

| ID | Requirement | Target |
|---|---|---|
| NFR-A-1 | Generated HTML prototypes include WCAG 2.1 AA baseline | All prototypes pass automated axe-core audit at AA level |
| NFR-A-2 | Component specifications include accessibility requirements | 100% of components have ARIA and keyboard requirements documented |
| NFR-A-3 | ASCII wireframes include text labels (no visual-only information) | All wireframe elements have text identifiers |
| NFR-A-4 | Storybook stories include a11y addon configuration | All generated stories include `@storybook/addon-a11y` parameters |

### 5.4 Maintainability

| ID | Requirement | Target |
|---|---|---|
| NFR-M-1 | Command YAML follows existing schema (`command-yaml-schema.json`) | 100% schema compliant |
| NFR-M-2 | New framework support addable without modifying core command logic | Plugin-based framework detection using existing skill file pattern |
| NFR-M-3 | Unit test coverage for standards detection logic | 85%+ line coverage |
| NFR-M-4 | New output format addable without modifying existing format generators | Each format generator is an independent module |

---

## 6. Acceptance Criteria

### 6.1 TRD Extraction

- **AC-TE-1**: Given a TRD that specifies "Use shadcn/ui Card and Dialog components", when the command runs, then the component specification maps those exact components and the ASCII wireframe annotates them as `[shadcn: Card]` and `[shadcn: Dialog]`.
- **AC-TE-2**: Given a TRD that specifies "Use Zustand for client state management", when the command runs, then the component specification references Zustand stores (not Redux, Context, or other state management) for global state.
- **AC-TE-3**: Given a TRD that defines `GET /api/users` and `POST /api/users`, when the command runs, then the component specification includes data binding annotations referencing those endpoints with request/response types.
- **AC-TE-4**: Given no TRD path argument, when the command is invoked, then it displays an error: "A TRD file is required. Use /ensemble:create-trd to create one first." and does not proceed.
- **AC-TE-5**: Given an invalid file path or a non-TRD document, when the command is invoked, then it displays a descriptive error and does not proceed.

### 6.2 Standards Discovery

- **AC-SD-1**: Given a React + Tailwind + shadcn/ui repository, when the command runs, then the UI Standards Report correctly identifies: framework (React), styling (Tailwind CSS), component library (shadcn/ui), and extracts color palette and spacing scale from `tailwind.config.ts`.
- **AC-SD-2**: Given a Vue 3 + Vuetify repository, when the command runs, then the UI Standards Report correctly identifies: framework (Vue 3), styling (Vuetify theme system), component library (Vuetify), and extracts the theme configuration.
- **AC-SD-3**: Given a repository with no detectable frontend framework, when the command runs, then it produces a warning message and generates mockups using generic HTML/CSS patterns without framework-specific annotations.
- **AC-SD-4**: Given a repository with CSS custom properties (`:root { --primary: #3b82f6; }`), when the command runs, then the detected tokens include the custom properties and they are applied to the HTML prototype.
- **AC-SD-5**: Given a monorepo with an Angular frontend in `apps/web/` and a React admin panel in `apps/admin/`, when the command runs with `--app=web`, then standards discovery scopes to `apps/web/` and correctly detects Angular + Angular Material (not React).
- **AC-SD-6**: Given a monorepo with multiple frameworks and no `--app` flag, when the TRD specifies "Angular frontend application in apps/web/", then the command auto-selects `apps/web/` for standards discovery without prompting the user.
- **AC-SD-7**: Given a monorepo with multiple frameworks and no `--app` flag and no TRD context about which app, then the command prompts the user to select from the detected applications.

### 6.3 ASCII Wireframe

- **AC-AW-1**: Given the feature description "user settings page with profile editing and notification preferences", when the command generates an ASCII wireframe, then the output contains: a page header, a sidebar or tab navigation for settings sections, a profile editing form area, and a notifications preferences section -- all using box-drawing characters.
- **AC-AW-2**: Given a detected MUI component library, when the ASCII wireframe is generated, then components are annotated with their MUI equivalents (e.g., `[MUI: TextField]`, `[MUI: Switch]`, `[MUI: Tabs]`).
- **AC-AW-3**: The ASCII wireframe renders correctly when viewed with `cat` in a standard terminal with monospace font.

### 6.4 Component Specification

- **AC-CS-1**: Given the feature description "user dashboard with analytics cards and activity feed", when the command generates a component spec, then the output contains: a component tree diagram, at least 3 component definitions (e.g., `DashboardPage`, `AnalyticsCard`, `ActivityFeed`), each with props interface, state, and accessibility notes.
- **AC-CS-2**: Given a React + TypeScript project, when the component spec is generated, then props are defined using TypeScript interface syntax matching the project's conventions.
- **AC-CS-3**: Each component in the specification maps to a specific component from the detected library (or specifies "custom component" if no library match exists).
- **AC-CS-4**: The component specification includes a "Data Flow" section showing how data moves between components (props down, events up) and API data binding from TRD endpoints.

### 6.5 Figma JSON Export

- **AC-FJ-1**: Given `--format=figma`, when the command generates the Figma JSON, then the output is valid JSON conforming to the Figma Plugin API node structure with `FRAME`, `TEXT`, and `COMPONENT` node types.
- **AC-FJ-2**: The generated JSON, when imported into Figma via a plugin, produces a frame layout that visually corresponds to the ASCII wireframe.
- **AC-FJ-3**: Design tokens (colors, spacing, typography) in the JSON match the values detected from the repository.
- **AC-FJ-4**: A companion `figma-import-guide.md` file is generated alongside the JSON explaining the import process.

### 6.6 Storybook Story Templates

- **AC-ST-1**: Given `--format=storybook` and a React + TypeScript project, when the command generates stories, then each story file uses `.stories.tsx` extension and CSF3 syntax with typed `meta` and `StoryObj`.
- **AC-ST-2**: Given a Vue project, when the command generates stories, then each story file uses `.stories.ts` extension with Vue-specific CSF3 syntax.
- **AC-ST-3**: Each generated story includes at least `Default`, `Loading`, and `Error` variants.
- **AC-ST-4**: Stories load in Storybook 7+ without TypeScript or import errors when the project's Storybook is configured.
- **AC-ST-5**: Stories include `parameters: { a11y: { ... } }` configuration for the accessibility addon.

### 6.7 HTML Prototype

- **AC-HP-1**: Given a Tailwind CSS project with a custom color palette, when the command generates an HTML prototype, then the file uses the project's exact color values (not Tailwind defaults) in its styling.
- **AC-HP-2**: The generated HTML file is self-contained (single file) and opens correctly in Chrome without requiring a local server or build step.
- **AC-HP-3**: The generated HTML file includes semantic HTML elements (`<header>`, `<main>`, `<nav>`, `<section>`, `<form>`) and basic ARIA landmarks.
- **AC-HP-4**: The generated HTML file includes a responsive viewport meta tag and adapts layout at the detected breakpoints.

### 6.8 Command Integration

- **AC-CI-1**: The command YAML file (`create-mockup.yaml`) validates against the `command-yaml-schema.json` schema with zero errors.
- **AC-CI-2**: Running `/ensemble:create-mockup docs/TRD/some-feature.md` produces output files in `docs/mockups/<feature-name>/` without errors.
- **AC-CI-3**: Running `/ensemble:create-mockup docs/TRD/some-feature.md --format=ascii` produces only the ASCII wireframe (not other formats).
- **AC-CI-4**: Running `/ensemble:create-mockup` without a TRD path produces a clear error message.
- **AC-CI-5**: The command does NOT generate, build, or execute any implementation code. It produces documentation artifacts only.
- **AC-CI-6**: Running `/ensemble:create-mockup docs/TRD/some-feature.md --format=all` produces all five formats.
- **AC-CI-7**: Running `/ensemble:create-mockup docs/TRD/some-feature.md` (no `--format` flag) produces only ASCII wireframe and component specification.

### 6.9 Agent Delegation

- **AC-AD-1**: The `frontend-developer` agent is invoked for framework detection and loads the correct framework skill file (verified by checking that framework-specific component names appear in the output).
- **AC-AD-2**: The `file-creator` agent is invoked for all file write operations and respects its overwrite prevention protocol (will not overwrite existing mockup files without confirmation).
- **AC-AD-3**: If the detected framework has no corresponding Ensemble skill file, the command falls back to generic web patterns and logs a notice.

---

## 7. Technical Considerations

### 7.1 Command YAML Structure

The command will be added to the `packages/development/commands/` directory (alongside `create-trd.yaml`) since mockup creation is a post-TRD design activity that requires technical decisions as input. The command follows the established YAML schema.

```yaml
metadata:
  name: ensemble:create-mockup
  description: Read TRD constraints, scan repository UI/UX standards, and generate text-based mockups
  version: 1.0.0
  lastUpdated: "2026-03-06"
  category: design
  output_path: ensemble/create-mockup.md
  source: fortium
  model: opus-4-6

constraints:
  - DO NOT implement, build, or execute any code described in the mockup
  - This command creates ONLY mockup artifacts (wireframes, prototypes, specs, stories, Figma JSON)
  - A TRD file path is REQUIRED as the first argument
  - After creating mockups, stop and wait for user review before any implementation

workflow:
  phases:
    - name: TRD Extraction
      order: 1
      steps: [...]
    - name: Standards Discovery
      order: 2
      steps: [...]
    - name: Mockup Generation
      order: 3
      steps: [...]
    - name: Output Management
      order: 4
      steps: [...]
```

### 7.2 Agent Delegation Flow

```
User invokes /ensemble:create-mockup <trd-path>
        |
        v
ensemble-orchestrator
        |
        +--> tech-lead-orchestrator (TRD parsing + constraint extraction)
        |        |
        |        +--> Reads TRD file
        |        +--> Extracts component choices, state mgmt, API endpoints
        |        +--> Extracts architecture patterns and data models
        |        +--> Returns TRD constraints summary
        |
        +--> frontend-developer (framework detection + skill loading)
        |        |
        |        +--> Reads packages/react/skills/SKILL.md (or appropriate framework)
        |        +--> Scans repo for component library, styling, tokens
        |        +--> For monorepos: scopes scan to target app
        |        +--> Returns UI Standards Report
        |
        +--> frontend-developer (mockup content generation)
        |        |
        |        +--> Generates ASCII wireframe content (with TRD annotations)
        |        +--> Generates component specification (with TRD state mgmt + API bindings)
        |        +--> Generates Figma JSON export (if requested)
        |        +--> Generates Storybook story templates (if requested)
        |        +--> Generates HTML prototype content (if requested)
        |
        +--> file-creator (artifact file creation)
                 |
                 +--> Creates docs/mockups/<feature>/ directory
                 +--> Writes wireframe.md, component-spec.md (default)
                 +--> Writes figma-export.json, figma-import-guide.md (if requested)
                 +--> Writes stories/*.stories.tsx (if requested)
                 +--> Writes prototype.html (if requested)
                 +--> Writes ui-standards-report.md
                 +--> Writes README.md
```

### 7.3 Standards Detection Strategy

The standards detection builds on the `frontend-developer` agent's existing framework detection signals:

| Detection Target | Source Files | Detection Method |
|---|---|---|
| Framework | `package.json`, `*.csproj`, `angular.json` | Dependency scanning (same as `frontend-developer` agent) |
| Component library | `package.json` dependencies | Match against known library package names |
| Styling approach | `tailwind.config.*`, `postcss.config.*`, `*.module.css`, imports | Config file presence + import pattern analysis |
| Design tokens (colors) | `tailwind.config.*`, `:root` CSS custom properties, theme files | Config parsing + CSS variable extraction |
| Design tokens (spacing) | `tailwind.config.*`, theme files | Config parsing |
| Design tokens (typography) | `tailwind.config.*`, theme files, font imports | Config parsing + `@font-face` / Google Fonts detection |
| Accessibility patterns | Existing component code | Grep for `aria-*`, `role=`, focus management patterns |
| Layout conventions | Existing page/layout components | Pattern matching on grid/flex usage, container widths |
| Monorepo structure | `package.json` workspaces, `pnpm-workspace.yaml`, `nx.json`, `lerna.json`, `turbo.json` | Config file detection + workspace enumeration |

### 7.4 Monorepo Detection Strategy

When a monorepo is detected, the command must isolate standards discovery to a single target application:

| Monorepo Tool | Detection File | Workspace Enumeration |
|---|---|---|
| npm workspaces | `package.json` `workspaces` field | Glob resolution of workspace patterns |
| pnpm | `pnpm-workspace.yaml` | Parse `packages` array |
| Yarn (Berry) | `package.json` `workspaces` field | Glob resolution of workspace patterns |
| Nx | `nx.json` + `project.json` per app | Scan `apps/` and `libs/` directories |
| Lerna | `lerna.json` | Parse `packages` array |
| Turborepo | `turbo.json` | Uses npm/pnpm/yarn workspace detection |

**Target Application Resolution Order:**
1. `--app=<name>` CLI flag (explicit user override)
2. TRD context (e.g., TRD references `apps/web/` or package name)
3. Interactive prompt listing detected applications with their frameworks

### 7.5 Known Component Library Mappings

The command should maintain a mapping of common component libraries to their UI patterns:

| Library | Package Name | Common Components |
|---|---|---|
| MUI (Material UI) | `@mui/material` | `<AppBar>`, `<Card>`, `<TextField>`, `<Button>`, `<Tabs>` |
| shadcn/ui | `@radix-ui/*` + local components | `<Card>`, `<Button>`, `<Input>`, `<Dialog>`, `<Tabs>` |
| Chakra UI | `@chakra-ui/react` | `<Box>`, `<Card>`, `<Input>`, `<Button>`, `<Modal>` |
| Ant Design | `antd` | `<Card>`, `<Form>`, `<Input>`, `<Button>`, `<Modal>` |
| Vuetify | `vuetify` | `<v-card>`, `<v-btn>`, `<v-text-field>`, `<v-dialog>` |
| Angular Material | `@angular/material` | `<mat-card>`, `<mat-form-field>`, `<mat-button>` |
| Fluent UI | `@fluentui/react-components` | `<Card>`, `<Input>`, `<Button>`, `<Dialog>` |
| Radix Primitives | `@radix-ui/react-*` | `<Dialog>`, `<Tabs>`, `<Select>`, `<Popover>` |

### 7.6 Figma JSON Export Format

The Figma JSON export uses the Figma Plugin API node structure:

```json
{
  "document": {
    "type": "FRAME",
    "name": "UserSettingsPage",
    "layoutMode": "VERTICAL",
    "children": [
      {
        "type": "FRAME",
        "name": "Header [shadcn: NavigationMenu]",
        "layoutMode": "HORIZONTAL",
        "fills": [{ "type": "SOLID", "color": { "r": 1, "g": 1, "b": 1 } }],
        "children": [...]
      }
    ]
  },
  "metadata": {
    "generator": "ensemble:create-mockup",
    "trd": "docs/TRD/user-settings.md",
    "framework": "React 18",
    "componentLibrary": "shadcn/ui",
    "designTokens": {
      "colors": { "primary": "#3b82f6", "secondary": "#64748b" },
      "spacing": { "sm": 8, "md": 16, "lg": 24 },
      "borderRadius": { "sm": 4, "md": 8 }
    }
  }
}
```

### 7.7 Storybook CSF3 Format Reference

Generated stories follow CSF3 format:

```typescript
import type { Meta, StoryObj } from '@storybook/react';
import { ProfileSettings } from './ProfileSettings';

const meta = {
  title: 'Settings/ProfileSettings',
  component: ProfileSettings,
  tags: ['autodocs'],
  argTypes: {
    isLoading: { control: 'boolean' },
    user: { control: 'object' },
  },
  parameters: {
    a11y: { config: { rules: [{ id: 'color-contrast', enabled: true }] } },
  },
} satisfies Meta<typeof ProfileSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { user: { name: 'Jane Doe', email: 'jane@example.com' }, isLoading: false },
};

export const Loading: Story = {
  args: { isLoading: true },
};

export const Error: Story = {
  args: { user: { name: 'Jane Doe', email: 'jane@example.com' }, isLoading: false },
  // Simulates a save error
};
```

### 7.8 ASCII Wireframe Format Standard

Wireframes use a consistent box-drawing character set for terminal compatibility:

```
+-------------------------------------------------------+
| [AppBar] Logo              Search [___________] [Avatar] |
+-------------------------------------------------------+
|          |                                            |
| [Nav]    | [Content Area]                             |
| > Home   |                                            |
|   Users  | +------------------+ +------------------+  |
|   Settings | [Card: Analytics] | [Card: Revenue]   |  |
|          | | Users: 1,234     | | $45,678          |  |
|          | | GET /api/stats   | | GET /api/revenue |  |
|          | +------------------+ +------------------+  |
|          |                                            |
|          | +----------------------------------------+ |
|          | | [Table: Recent Activity]                | |
|          | | GET /api/activity                       | |
|          | | Name    | Action   | Date              | |
|          | | --------|----------|-------------------| |
|          | | Alice   | Created  | 2026-03-06        | |
|          | +----------------------------------------+ |
+-------------------------------------------------------+
```

### 7.9 Package Placement

The command belongs in `packages/development/` because:
- It requires a **TRD as input**, placing it in the post-TRD workflow alongside `create-trd` and `implement-trd`
- It generates **development artifacts** (Storybook stories, component specs) that directly feed into implementation
- The Figma JSON export is a **developer-to-designer handoff** artifact, not a product planning document
- The `development` package already owns the TRD-to-implementation workflow

File path: `packages/development/commands/create-mockup.yaml`

### 7.10 Integration with Existing Workflow

The mockup command integrates into the existing Ensemble product-first development (PFD) workflow:

```
/ensemble:create-prd       (1. Define what to build)
        |
        v
/ensemble:create-trd       (2. Define how to build it)
        |
        v
/ensemble:create-mockup    (3. Define what it looks like -- NEW, requires TRD)
        |
        v
/ensemble:implement-trd    (4. Build it)
```

The mockup output can be referenced during implementation: the component spec provides the UI contract, the Storybook stories provide the testing scaffold, and the Figma JSON enables designer review. The TRD constraints (components, state management, API endpoints) flow through from step 2 into the mockup, ensuring technical consistency.

---

## 8. Risks and Mitigations

### 8.1 Risk Register

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Standards detection produces incorrect results for complex or hybrid projects (e.g., React + Angular in a monorepo) | Medium | Medium | Implement monorepo-aware scanning with `--app` flag; scope detection to target application; when confidence is below 70%, flag detection as uncertain and ask user to confirm |
| R2 | ASCII wireframes are too limited to convey complex layouts | Medium | Low | Provide multiple representation levels: simple (box layout), detailed (with annotations), and always pair with a component spec for precision; users can select `--format=html` or `--format=figma` for richer representation |
| R3 | HTML prototypes diverge from actual project rendering | Medium | Medium | Use detected design tokens (not generic values); include a comment header listing assumptions; frame prototypes as "directional" not "pixel-perfect" |
| R4 | Component library detection fails for custom/internal design systems | Medium | Medium | Fall back to generic HTML component patterns; include a `--library` override flag for manual specification; scan for `components/` or `ui/` directories for custom component discovery |
| R5 | Generated component specs become stale quickly | Low | Low | Specs are generated per invocation (not persistent state); include timestamps; recommend re-running before implementation if more than 1 week has passed |
| R6 | Large repositories cause slow standards scanning | Low | Medium | Limit scanning to `src/`, `app/`, `components/`, `pages/` directories by default; support `--scan-paths` override; implement file count guardrails (skip dirs with 10,000+ files) |
| R7 | Tailwind config parsing fails for complex configurations (plugins, custom functions) | Medium | Low | Parse static values only; log warning for dynamic/computed values; extract what is statically analyzable and document gaps |
| R8 | Figma JSON export format drifts from Figma Plugin API | Low | Medium | Pin to Figma Plugin API v1 node types; include version metadata in export; document minimum compatible Figma plugin version |
| R9 | Storybook CSF3 format incompatibility across Storybook versions | Low | Medium | Target Storybook 7+ (CSF3 baseline); test generated stories against Storybook 7.x and 8.x; include Storybook version in story comments |
| R10 | TRD format varies and constraint extraction fails | Medium | High | Define expected TRD sections for extraction; fall back to standards discovery when TRD sections are missing or unparseable; log warnings for unextractable sections |
| R11 | Monorepo detection fails for non-standard workspace configurations | Low | Medium | Support top 6 monorepo tools (npm, pnpm, Yarn, Nx, Lerna, Turborepo); fall back to `--app` flag for manual override; scan for multiple `package.json` files as heuristic |

### 8.2 Dependencies

| Dependency | Owner | Risk Level | Contingency |
|---|---|---|---|
| `frontend-developer` agent availability | Ensemble development package | Low | Agent is core to Ensemble; stable and well-tested |
| `file-creator` agent availability | Ensemble core package | Low | Agent is core to Ensemble; stable and well-tested |
| `tech-lead-orchestrator` agent availability | Ensemble core package | Low | Agent is core to Ensemble; used for TRD parsing |
| Framework skill files (`packages/*/skills/SKILL.md`) | Ensemble framework packages | Low | Already maintained; 5 frameworks currently supported |
| Command YAML schema (`command-yaml-schema.json`) | Ensemble schemas | Low | Stable schema; additive changes only |
| Figma Plugin API specification | Figma (external) | Low | Stable API; versioned; backward compatible |
| Storybook CSF3 specification | Storybook (external) | Low | CSF3 is stable since Storybook 7.0 |

---

## 9. Success Metrics

### 9.1 Functional Metrics

| Metric | Target | Measurement |
|---|---|---|
| Framework detection accuracy | 90%+ across supported frameworks | Automated tests against sample repositories |
| Component library detection accuracy | 85%+ across top 8 libraries | Automated tests against sample `package.json` files |
| Design token extraction accuracy | 80%+ for Tailwind and CSS custom properties | Manual validation against 5 real projects |
| TRD constraint extraction accuracy | 90%+ for component, state mgmt, and API endpoint extraction | Automated tests against sample TRDs |
| Mockup generation success rate (no errors) | 95%+ | CI test suite pass rate |
| Command schema compliance | 100% | Automated schema validation |
| Monorepo target isolation accuracy | 95%+ | Automated tests against sample monorepo structures |
| Figma JSON import success rate | 90%+ | Manual validation with Figma plugin |
| Storybook story load success rate | 95%+ | Automated Storybook build test |

### 9.2 User Impact Metrics (3 months post-launch)

| Metric | Target | Measurement |
|---|---|---|
| Command usage frequency | 50+ invocations/month across Ensemble user base | Telemetry (if available) or GitHub issue/discussion activity |
| User-reported mockup quality satisfaction | 4/5 average rating | User feedback surveys or GitHub discussions |
| Time saved per feature mockup vs manual approach | 50%+ reduction (from ~30 min to ~15 min) | User-reported estimates |
| Features where mockup was generated before implementation | 30%+ of new UI features | Team workflow tracking |
| Figma JSON used for designer handoff | 20%+ of mockup invocations use `--format=figma` | Usage telemetry |
| Storybook stories used without modification | 60%+ of generated stories usable as-is or with minor edits | User-reported estimates |

### 9.3 Quality Metrics

| Metric | Target | Measurement |
|---|---|---|
| Unit test coverage for standards detection | 85%+ | Jest coverage reports |
| Unit test coverage for TRD extraction | 85%+ | Jest coverage reports |
| Command YAML schema validation | 100% pass | `npm run validate` |
| HTML prototype accessibility audit pass rate | 100% at WCAG 2.1 AA (automated checks) | axe-core automated audit |
| Zero regressions in existing commands | 0 failures | CI test suite |

---

## 10. Roadmap and Milestones

### Phase 1: Foundation (Week 1-2)

| Milestone | Deliverable | Success Criteria |
|---|---|---|
| M1.1 | Command YAML file (`create-mockup.yaml`) in `packages/development/commands/` with full workflow definition | Passes schema validation; integrates with `/ensemble:` namespace |
| M1.2 | TRD extraction logic: parse TRD, extract components, state management, API endpoints, data models | Correctly extracts constraints from 5 sample TRDs with 90%+ accuracy |
| M1.3 | Standards discovery logic: framework + component library detection (including monorepo support) | Correctly detects React, Vue, Angular, Svelte, Blazor + top 8 component libraries; correctly isolates monorepo apps |
| M1.4 | Standards discovery logic: styling approach + design token extraction | Correctly detects Tailwind, CSS Modules, styled-components; extracts color and spacing tokens |
| M1.5 | Unit tests for TRD extraction and standards discovery | 85%+ coverage |

### Phase 2: Core Mockup Generation (Week 3-4)

| Milestone | Deliverable | Success Criteria |
|---|---|---|
| M2.1 | ASCII wireframe generator with component annotations and TRD API data-binding annotations | Renders correctly in terminal; includes detected component library names and API endpoints |
| M2.2 | Component specification generator with TRD-sourced state management and API bindings | Produces complete component tree with props, state (using TRD state mgmt library), API bindings, and accessibility notes |
| M2.3 | Agent delegation wiring (tech-lead-orchestrator + frontend-developer + file-creator) | End-to-end execution via agent mesh without errors |
| M2.4 | Default format behavior (`ascii,spec`) and `--format` flag handling | Default produces two files; each format flag works independently; `all` produces five formats |

### Phase 3: Extended Formats (Week 5-6)

| Milestone | Deliverable | Success Criteria |
|---|---|---|
| M3.1 | Figma-compatible JSON export generator | JSON conforms to Figma Plugin API node format; imports into Figma via plugin; design tokens match repository |
| M3.2 | Storybook story template generator (CSF3) | Stories load in Storybook 7+; include controls, args, a11y addon config; framework-appropriate syntax |
| M3.3 | HTML prototype generator with design token application | Self-contained HTML opens in browser with project-accurate colors and spacing |

### Phase 4: Integration and Polish (Week 7-8)

| Milestone | Deliverable | Success Criteria |
|---|---|---|
| M4.1 | Monorepo `--app` flag and auto-detection from TRD context | Monorepo apps correctly isolated; TRD context auto-selects target app |
| M4.2 | Output management (directory creation, README, file listing) | All files saved to `docs/mockups/<feature>/` with summary README |
| M4.3 | Integration tests and documentation | CI passing; command documented in CLAUDE.md and plugin README |
| M4.4 | Figma import guide and Storybook setup guide | Companion documentation for new formats |

### Future Enhancements (Post-Launch)

- **Phase 5**: Add support for reading existing mockups and generating "diff mockups" showing what changes a new feature introduces
- **Phase 6**: Add `--interactive` mode for iterative mockup refinement within a session
- **Phase 7**: OpenCode translation support via `packages/opencode/` translation layer
- **Phase 8**: Support for design system documentation generation (extracting from mockup patterns across features)

---

## 11. Appendix

### 11.1 Related Documents

| Document | Location | Relevance |
|---|---|---|
| Frontend Developer Agent | `packages/development/agents/frontend-developer.yaml` | Primary delegate for framework detection and mockup content |
| File Creator Agent | `packages/core/agents/file-creator.yaml` | Delegate for safe file generation |
| Tech Lead Orchestrator Agent | `packages/core/agents/tech-lead-orchestrator.yaml` | Delegate for TRD parsing and constraint extraction |
| Create TRD Command | `packages/development/commands/create-trd.yaml` | Upstream command that produces the required TRD input |
| Implement TRD Command | `packages/development/commands/implement-trd.yaml` | Downstream consumer of mockup artifacts |
| Create PRD Command | `packages/product/commands/create-prd.yaml` | Pattern reference for command YAML structure |
| React Skill | `packages/react/skills/SKILL.md` | Framework skill loaded during React project mockups |
| Blazor Skill | `packages/blazor/skills/SKILL.md` | Framework skill loaded during Blazor project mockups |
| Command YAML Schema | `schemas/command-yaml-schema.json` | Validation schema for the command definition |
| OpenCode PRD | `docs/PRD/opencode-support.md` | Template reference for PRD structure |

### 11.2 Example Output -- ASCII Wireframe

```
Feature: User Settings Page
Framework: React 18 + Tailwind CSS + shadcn/ui
TRD: docs/TRD/user-settings.md
State Management: Zustand (from TRD)
Generated: 2026-03-06

+----------------------------------------------------------------+
| [shadcn: NavigationMenu]  Logo    Settings              [Avatar]|
+----------------------------------------------------------------+
|                |                                                |
| [shadcn: Tabs] |  [shadcn: Card]                               |
|                |  +------------------------------------------+ |
| > Profile      |  | Profile Settings                         | |
|   Notifications|  |                                          | |
|   Security     |  | [shadcn: Avatar]  [Upload Photo]         | |
|   Billing      |  |                                          | |
|                |  | Display Name [shadcn: Input ___________] | |
|                |  | Email        [shadcn: Input ___________] | |
|                |  | Bio          [shadcn: Textarea ________] | |
|                |  |              [_________________________] | |
|                |  |                                          | |
|                |  | Data: GET /api/users/:id (from TRD)      | |
|                |  | Save: PUT /api/users/:id (from TRD)      | |
|                |  |                                          | |
|                |  | [shadcn: Button (secondary)] [Cancel]    | |
|                |  | [shadcn: Button (primary)]   [Save]      | |
|                |  +------------------------------------------+ |
+----------------------------------------------------------------+

Legend:
  [shadcn: Component] = shadcn/ui component from project
  [___________]       = Text input field
  > Item              = Active/selected navigation item
  Data: / Save:       = API endpoints from TRD
```

### 11.3 Example Output -- Component Specification (excerpt)

```markdown
## Component Tree

SettingsPage
+-- SettingsLayout
    +-- SettingsSidebar (shadcn: Tabs, orientation=vertical)
    |   +-- TabItem: "Profile"
    |   +-- TabItem: "Notifications"
    |   +-- TabItem: "Security"
    |   +-- TabItem: "Billing"
    +-- SettingsContent (shadcn: Card)
        +-- ProfileSettings
            +-- AvatarUpload (shadcn: Avatar + Button)
            +-- ProfileForm
                +-- FormField: displayName (shadcn: Input)
                +-- FormField: email (shadcn: Input, type=email)
                +-- FormField: bio (shadcn: Textarea)
                +-- FormActions (shadcn: Button x2)

## Component: ProfileSettings

**Description**: Displays and allows editing of user profile information.

**Props**:
  interface ProfileSettingsProps {
    user: User;              // Type from TRD data model
    onSave: (data: ProfileFormData) => Promise<void>;
    isLoading?: boolean;
  }

**State** (Zustand -- from TRD):
  - Local: formData (useState), isDirty (derived), errors (useState)
  - Global: useUserStore.getState().currentUser (Zustand store from TRD)

**API Bindings** (from TRD):
  - Load: GET /api/users/:id -> User
  - Save: PUT /api/users/:id <- ProfileFormData -> User
  - Loading state: isLoading flag during API calls
  - Error state: API error mapped to form field errors or toast notification

**Accessibility**:
  - Form wrapped in <form> with aria-labelledby pointing to card title
  - Each input has associated <label> via htmlFor
  - Validation errors use aria-invalid and aria-describedby
  - Save button disabled when !isDirty, with aria-disabled
  - Focus moves to first error field on validation failure

**Responsive**:
  - Desktop (>=1024px): Side-by-side avatar + form
  - Tablet (>=768px): Stacked avatar above form
  - Mobile (<768px): Full-width stacked, sidebar becomes horizontal tabs
```

### 11.4 Example Output -- Figma JSON Export (excerpt)

```json
{
  "document": {
    "type": "FRAME",
    "name": "SettingsPage",
    "layoutMode": "HORIZONTAL",
    "primaryAxisSizingMode": "FIXED",
    "counterAxisSizingMode": "FIXED",
    "width": 1280,
    "height": 720,
    "fills": [{ "type": "SOLID", "color": { "r": 1, "g": 1, "b": 1 } }],
    "children": [
      {
        "type": "FRAME",
        "name": "SettingsSidebar [shadcn: Tabs]",
        "layoutMode": "VERTICAL",
        "width": 240,
        "itemSpacing": 4,
        "children": [
          { "type": "TEXT", "name": "TabItem: Profile", "characters": "Profile", "style": { "fontFamily": "Inter", "fontSize": 14 } },
          { "type": "TEXT", "name": "TabItem: Notifications", "characters": "Notifications" },
          { "type": "TEXT", "name": "TabItem: Security", "characters": "Security" },
          { "type": "TEXT", "name": "TabItem: Billing", "characters": "Billing" }
        ]
      }
    ]
  },
  "metadata": {
    "generator": "ensemble:create-mockup v1.0.0",
    "trd": "docs/TRD/user-settings.md",
    "framework": "React 18",
    "componentLibrary": "shadcn/ui",
    "stylingApproach": "Tailwind CSS",
    "stateManagement": "Zustand",
    "generatedAt": "2026-03-06T12:00:00Z"
  }
}
```

### 11.5 Example Output -- Storybook Story (excerpt)

```typescript
// ProfileSettings.stories.tsx
import type { Meta, StoryObj } from '@storybook/react';
import { ProfileSettings } from './ProfileSettings';

const meta = {
  title: 'Settings/ProfileSettings',
  component: ProfileSettings,
  tags: ['autodocs'],
  argTypes: {
    isLoading: { control: 'boolean', description: 'Loading state during API calls' },
    user: { control: 'object', description: 'User data from GET /api/users/:id' },
  },
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: 'color-contrast', enabled: true },
          { id: 'label', enabled: true },
        ],
      },
    },
  },
} satisfies Meta<typeof ProfileSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    user: { id: '1', name: 'Jane Doe', email: 'jane@example.com', bio: 'Product engineer' },
    isLoading: false,
  },
};

export const Loading: Story = {
  args: { isLoading: true },
};

export const Error: Story = {
  args: {
    user: { id: '1', name: 'Jane Doe', email: 'jane@example.com', bio: '' },
    isLoading: false,
  },
  parameters: {
    docs: { description: { story: 'Displays validation errors after failed PUT /api/users/:id' } },
  },
};

export const Empty: Story = {
  args: {
    user: { id: '1', name: '', email: '', bio: '' },
    isLoading: false,
  },
};
```

### 11.6 Glossary

| Term | Definition |
|---|---|
| **ASCII Wireframe** | A text-based UI layout sketch using box-drawing characters, renderable in monospace terminals |
| **Component Specification** | A structured document defining a UI component's props, state, behavior, and accessibility requirements |
| **CSF3** | Component Story Format version 3, the standard Storybook story authoring format since Storybook 7.0 |
| **Design Tokens** | The atomic values of a design system: colors, spacing, typography, border radius, shadows |
| **Figma JSON Export** | A structured JSON file conforming to the Figma Plugin API node format, importable into Figma for visual design work |
| **HTML Prototype** | A self-contained HTML file that approximates the visual appearance of a planned UI feature |
| **Monorepo** | A single repository containing multiple applications or packages, often with shared dependencies and tooling |
| **Standards Discovery** | The automated process of scanning a repository to identify its UI/UX conventions, frameworks, and design tokens |
| **Storybook Story Template** | A pre-configured CSF3 story file with component args, controls, and accessibility addon setup |
| **TRD** | Technical Requirements Document, defining the technical approach, architecture, and implementation details for a feature |
| **TRD Extraction** | The process of parsing a TRD to extract technical constraints (components, state management, API endpoints) for use in mockup generation |
| **UI/UX Standards** | The collective set of design decisions encoded in a repository: framework choice, component library, styling approach, design tokens, accessibility patterns, and layout conventions |
