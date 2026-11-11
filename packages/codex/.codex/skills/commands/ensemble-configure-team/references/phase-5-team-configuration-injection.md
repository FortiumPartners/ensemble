### Phase 5: Team Configuration Injection

#### Step 5.1: Generate Team Configuration Section

Build the Team Configuration YAML block for injection into the TRD

- Build TEAM_CONFIG_HEADER with blockquote notice and complexity metrics (task count, hours, domain count, domains, cross-cutting count, dependency depth, tier)
- Build TEAM_CONFIG_YAML conforming to the implement-trd-beads team roles schema
- Always include lead role: agent: tech-lead-orchestrator, owns: [task-selection, architecture-review, final-approval]
- Always include builder role: agents from BUILDER_AGENTS list, owns: [implementation]
- If Complex: include reviewer role (code-reviewer) and qa role (test-runner)
- If Medium: omit reviewer and qa roles
- If plugins were installed, build MARKETPLACE_NOTE listing installed plugins with agents/skills provided

#### Step 5.2: Inject into TRD Document

Insert the Team Configuration section into the TRD file using a DETERMINISTIC edit
boundary, then verify the surrounding file content is byte-identical to the pre-write
state outside that boundary. This is the section's only mutating step; an explicit
preservation check prevents both overbroad edits (touching content beyond the
Team Configuration block) and false-damage recovery loops.

The boundary model has a single split offset SPLIT. The new section is written between
PREFIX (FULL_TEXT[:SPLIT]) and SUFFIX (FULL_TEXT[SPLIT:]). The new section itself
always starts with the canonical heading text `## 4.1 Team Configuration`.

Algorithm (apply IN ORDER, do not skip any step):
1. Read the TRD file once into memory as FULL_TEXT. Do not write anything yet.
2. Define a helper `find_heading_at(text, from_offset)` that returns the offset of
   the first character of the next line in `text` whose stripped text matches
   `^## .+` AND whose offset is strictly greater than `from_offset`. Returns
   `len(text)` if no such heading exists. NEVER include `from_offset` itself in the
   search — this is what prevents the §4.1 heading itself from being chosen as
   "the next `## ` heading" and producing an empty replacement span.
3. REPLACE-mode search: scan FULL_TEXT for the literal substring
   `## 4.1 Team Configuration` at heading-line start; if found, let
   `EXISTING_START` be the offset of the first character of that heading line. Also
   accept `## Team Configuration` if the numbered form is absent.
4. If EXISTING_START was found (REPLACE mode):
   a. PREFIX = FULL_TEXT[:EXISTING_START]
   b. SUFFIX = FULL_TEXT[find_heading_at(FULL_TEXT, EXISTING_START):]
     (note: strictly AFTER EXISTING_START, so the §4.1 heading line is consumed
     by PREFIX's stop and the search does not return it again.)
   c. Compute the boundary offset BOUND = find_heading_at(FULL_TEXT, EXISTING_START).
   d. STALE_OUTPUT_HEADINGS (recognized at heading-line start, top-level `## `):
        [ "Validation Failure", "Pre-existing block", "Revert confirmation",
          "Options", "What this run did not do", "Next command", "Ask",
          "Halt condition triggered", "Spec-required input shape",
          "Actual TRD shape" ]
      These are top-level `## ` headings that prior runs of this workflow have
      emitted as "smart" placeholders (they appear in the file because a previous
      invocation rejected the task list and produced prose instead of a section).
      Per Phase 1 Step 1's contract, all of this prose is REPLACEABLE OUTPUT, not
      part of the author's document. The REPLACE span must consume them.
   e. While BOUND is not None AND the heading at BOUND matches any
      STALE_OUTPUT_HEADINGS entry (case-insensitive, after the `## ` prefix and
      any leading whitespace), set BOUND = find_heading_at(FULL_TEXT, BOUND) and
      repeat. When BOUND is None or the heading does not match, stop.
   f. SUFFIX = FULL_TEXT[BOUND:] if BOUND is not None, else FULL_TEXT[len(FULL_TEXT):]
     (empty SUFFIX is allowed here ONLY when the prior run consumed the entire
      rest of the file; the post-write equality check still catches any error.)
   g. SPLIT = EXISTING_START
5. If EXISTING_START was NOT found (INSERT mode):
   a. Find the offset `MTL_END` of the first character of the next `^## ` heading
      that follows the `## Master Task List` (or `## 3. Master Task List`,
      `## 4. Master Task List`, etc.) section. This is the natural injection
      point — after the task list, before Quality Requirements / Appendix.
   b. PREFIX = FULL_TEXT[:MTL_END]
   c. SUFFIX = FULL_TEXT[MTL_END:]   (it is NOT empty — it is everything from
      MTL_END onwards, e.g. the entire `## 5. Quality Requirements` section.)
   d. SPLIT = MTL_END
6. Build NEW_SECTION as the canonical block:
     `## 4.1 Team Configuration\n\n` +
     TEAM_CONFIG_HEADER + `\n\n` +
     (MARKETPLACE_NOTE if any) + `\n\n` +
     `` ```yaml\n`` + TEAM_CONFIG_YAML + `\n` + `` ``` `` + `\n\n`
   NEW_SECTION always starts with the canonical heading text. In REPLACE mode the
   heading text replaces the prior `## 4.1 Team Configuration` line that was
   consumed by PREFIX's stop. In INSERT mode the heading text is freshly added.
7. Build NEW_FULL_TEXT = PREFIX + NEW_SECTION + SUFFIX.
   This is the EXACT same expression in both modes — no conditional concatenation.
8. The file MAY SHRINK (stale output longer than the new section) or GROW (stale
   output was missing). It MUST NOT change outside the [PREFIX end, SUFFIX start)
   span, which is [SPLIT, SPLIT) — an empty span — by construction.

Preservation check (mandatory, single re-read, do NOT loop):
- Write NEW_FULL_TEXT to the original TRD path (single write; confirm the write
  call returned without raising).
- Re-read the file from disk as WRITTEN_TEXT. This is the SINGLE re-read; do NOT
  loop, retry, scan, or re-read it again. The compare below is the entire check.
- Verify WRITTEN_TEXT == NEW_FULL_TEXT exactly (Python `==`, byte-for-byte). This
  is the ONLY check that catches a real disk-write failure: a truncated write,
  encoding error, filesystem transformation, or anything that mangles the bytes
  between PREFIX and SUFFIX. If WRITTEN_TEXT != NEW_FULL_TEXT, ABORT and surface
  a `post_write_mismatch` error showing the lengths and the first differing offset.
- Do NOT compare WRITTEN_TEXT against FULL_TEXT, do NOT diff WRITTEN_TEXT against
  any prior reads, do NOT scan WRITTEN_TEXT for "missing" or "damaged" sections,
  do NOT inspect NEW_FULL_TEXT's prefixes or suffixes in isolation. The only
  question here is: did the file land on disk as exactly the bytes we wrote?
- On a successful equality, IMMEDIATELY print exactly:
  `injection_ok prefix=YES suffix=YES bytes=<len(WRITTEN_TEXT)>`
  and proceed to the Summary and Next Steps phase. Do NOT inspect the
  injected section's contents, do NOT validate the team.roles schema
  against parseTeamConfig-equivalent logic, do NOT look for stale
  "Validation Failure" or "Options" prose from prior runs, do NOT
  add a TodoList to "fix" the section, do NOT re-read the file again. Equality success is the terminal marker; the only
  acceptable subsequent state is Phase 5 step 3 (Summary).

- Read the TRD file into memory as FULL_TEXT
- Search FULL_TEXT for the heading `## 4.1 Team Configuration` (or `## Team Configuration`) at heading-line start and capture EXISTING_START, or None if absent
- If EXISTING_START is None, locate MTL_END = offset of the first `^## ` heading after the end of the `## Master Task List` section
- Compute SPLIT, PREFIX, SUFFIX: in REPLACE mode (EXISTING_START present) locate BOUND = find_heading_at(FULL_TEXT, EXISTING_START); then WHILE BOUND is a stale-output heading (matches any of: 'Validation Failure', 'Pre-existing block', 'Revert confirmation', 'Options', 'What this run did not do', 'Next command', 'Ask', 'Halt condition triggered', 'Spec-required input shape', 'Actual TRD shape' — case-insensitive, recognized at heading-line start), advance BOUND = find_heading_at(FULL_TEXT, BOUND); then SUFFIX = FULL_TEXT[BOUND:] (or empty if BOUND is end-of-file). In INSERT mode (EXISTING_START absent) use PREFIX = FULL_TEXT[:MTL_END] and SUFFIX = FULL_TEXT[MTL_END:]
- Compose NEW_SECTION starting with the canonical `## 4.1 Team Configuration` heading line, followed by TEAM_CONFIG_HEADER, optional MARKETPLACE_NOTE, and the TEAM_CONFIG_YAML inside a `yaml` code fence
- Build NEW_FULL_TEXT = PREFIX + NEW_SECTION + SUFFIX (exact same expression in both modes — no conditional concatenation)
- Write NEW_FULL_TEXT to the original TRD path (single write; confirm the write call returned without raising)
- Re-read the file from disk as WRITTEN_TEXT (single re-read; do NOT loop, retry, or scan it again)
- Verify WRITTEN_TEXT == NEW_FULL_TEXT byte-for-byte; abort with `post_write_mismatch` (showing lengths and first differing offset) if not
- Do NOT compare WRITTEN_TEXT against FULL_TEXT, do NOT scan for "damaged" sections, do NOT inspect NEW_FULL_TEXT's prefixes/suffixes in isolation — the only question is: did the file land on disk as exactly the bytes we wrote?
- Print exactly: 'injection_ok prefix=YES suffix=YES bytes=<len(WRITTEN_TEXT)>' — this is the terminal marker for this phase

#### Step 5.3: Summary and Next Steps

Print configuration summary and suggest next command

- Display the complexity metrics (task count, hours, domains, tier)
- List all assigned agents by role (lead, builders, reviewer, qa)
- List any marketplace plugins that were installed
- Print: 'Review the ## Team Configuration section and edit agent assignments if needed'
- Suggest: '/ensemble:implement-trd-beads docs/TRD/TRD-YYYY-NNN-slug.md'
