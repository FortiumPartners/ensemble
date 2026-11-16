---
document_id: PRD-2026-b2c3d4e5
label: prd-slugify
version: 1.0.1
status: Locked
date: 2026-11-01
scale_depth: LIGHT
total_requirements: 3
readiness_score: 4.2
---

# PRD-2026-b2c3d4e5: Slugify Helper

## PRD Health Summary

- **Risk flags:** none
- **Dependencies:** 2 cross-requirement dependencies (see Dependency Map)
- **Constitution compliance:** passed

## Product Summary

**Problem:** Teams hand-roll URL slugs inconsistently.

**Solution:** A small `slugify(text)` JavaScript function in `src/slugify.js`.

**Target users:** Developers on the team.

## Requirements

### REQ-001: Lowercase and join words with a dash (Must)

- AC-001-1: Given the text `Hello, World!`, when `slugify` runs, then it returns `hello-world`.
- AC-001-2: Given text with runs of non-alphanumeric characters, when `slugify` runs, then each run becomes a single `-`.

### REQ-002: Trim leading and trailing dashes (Must)

- AC-002-1: Given the text `--Hello--`, when `slugify` runs, then it returns `hello`.

### REQ-003: Tolerate empty and non-string input (Should)

- AC-003-1: Given an empty string or a non-string value, when `slugify` runs, then it returns an empty string.

## Goals and Non-Goals

**Goals:** One consistent slug function.

**Non-goals:** Unicode transliteration.

## Dependency Map

- REQ-002 depends on REQ-001
- REQ-003 depends on REQ-001

## Changelog

- **1.0.1 (2026-11-02):** Refinement pass. Locked.
- **1.0.0 (2026-11-01):** Initial draft from `create-prd`.
