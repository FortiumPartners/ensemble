---
name: react
description: Use when editing a React 18+ codebase (react dependency, .jsx/.tsx) and you need to match its conventions; not for Vue/Angular/Svelte or non-UI TypeScript.
metadata:
  version: 2.0.0
---

# React conventions

Detect before writing: check `package.json` for Next.js vs Vite, the test runner (Vitest/Jest + Testing Library), the state library and styling approach, then follow what the repo already uses. Do not introduce a second one.

Gotchas:
- Function components and hooks only; match the repo's TypeScript strictness and props typing style.
- Fetching: use the repo's data layer (React Query/SWR/Next server components); never fetch in a bare `useEffect` unless that is already the codebase pattern.
- Keep effects free of derived state; derive during render. Lists need stable keys, never array index for reorderable data.
- Next.js: respect the `"use client"` boundary; do not import server-only modules into client components.
- Tests: query by role/label with Testing Library; avoid snapshot tests for behavior.
- Accessibility is part of done: semantic elements, labels, keyboard focus.
