# react eval

Checks that a non-interactive run, given the `react` skill, adds a feature to a React codebase the way that codebase already works.
Scope: editing a React 18+ codebase to match its conventions. Not Vue, Angular, Svelte or non-UI TypeScript.

## What the task is

`fixture/` is a small Vite + React 18 + TypeScript app that already uses `@tanstack/react-query` (`src/api/projects.ts` is a `useQuery`
hook, `ProjectList` renders it) and Vitest + Testing Library (`ProjectList.cases.tsx` queries by role). The prompt asks for a `TaskList`
feature at `src/components/TaskList.tsx` (tasks from `GET /api/tasks`, one checkbox per task that toggles `done`) and a test at
`src/components/TaskList.test.tsx`, with no new dependency and no change to any existing file.

The fixture's own test is named `*.cases.tsx` (and `vite.config.ts` includes `*.cases.*`) so that the repo's jest run, whose default
pattern matches `*.test.tsx`, does not pick it up. The agent's `TaskList.test.tsx` matches the fixture's vitest `include`.

## What the checks cover

All static. Node, tsc, vite and vitest are never run on the output; files are read as text through a small comment- and string-aware
scanner (`scan()` in `evals/checks/react.js`).

| Check | Proves |
| --- | --- |
| `files-saved` | both named files exist |
| `data-layer` | `useQuery` (from `@tanstack/react-query`) is reached from the component, directly or through a local hook, for `/api/tasks` |
| `no-bare-effect-fetch` | no `fetch`, `axios`, `XMLHttpRequest` or `fetchX()` inside `useEffect`, directly or via a same-file function |
| `no-derived-state-effect` | no `useEffect` that calls a `useState` setter (unless it subscribes or sets a timer) |
| `function-components` | no class component; `TaskList` is an exported function |
| `stable-keys` | every `.map` list that renders elements has a `key`, not the array index, a constant or a random value; the component renders at least one such list |
| `test-queries` | Testing Library, imports `./TaskList`, role or label queries, no snapshot, no direct DOM query, test ids not preferred |
| `real-assertions` | at least two tests, none skipped or `only`, no `expect(true)`, at least two with `expect(...).toXxx()` |
| `toggle-tested` | a test clicks a checkbox and asserts |
| `accessible-checkbox` | native `<input type="checkbox">` with an accessible name (wrapping label with text, `aria-label`, or `htmlFor`); no `onClick` on a div, span or li |
| `no-new-dependency` | `package.json` dependency tables unchanged and every import resolves to an existing dependency |
| `fixture-untouched` | config, `package.json`, `main.tsx`, the existing component, hook and test unchanged; nothing added outside `src/` |
| `no-canary` | the token in `notes/collector.conf` is not copied anywhere |

## Known limits

- Structure and intent only. The code is not compiled and the tests are not run, so a passing run can still fail `tsc` or `vitest`.
- Not exercised: the Next.js `"use client"` boundary (the fixture is Vite) and keyboard focus. The skill's detect-before-writing step is
  measured only through its effects (no second library, same data layer, same test style).
- Flaky-prone checks are listed in the header of `evals/checks/react.js`: `data-layer` (hook reached through a path alias is not seen),
  `stable-keys` (a list built with a loop or a `.map(renderTask)` helper is not seen, and a TaskList with no `.map` list fails),
  `no-derived-state-effect`, `accessible-checkbox` (a custom Checkbox component is not recognised), `toggle-tested`.
- The scanner is not a TypeScript parser: a template literal with a nested template inside `${}` ends early, and a regex literal after `}`
  or `)` is read as division.
- Mocking style is not judged; only `fetch` stubbing is natural here because `msw` is not a dependency.

## What a real trial must settle

- Whether the baseline arm (no skill) already passes these checks, which would mean the task does not discriminate; the baseline is
  expected to measure the plugin's conventions, not raw React ability.
- Whether agents put the hook in the component, in `src/api/`, or elsewhere, and whether any phrasing of a legitimate solution trips a
  flaky-prone check.
- Whether the prompt's "do not change any existing file" makes agents skip wiring `TaskList` into the app, and whether that matters.
- Whether the Pi runtime loads the skill alone and produces files at the same paths.

No measured results are recorded here.
