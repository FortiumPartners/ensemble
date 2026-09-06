---
name: ensemble-analyze-complexity
description: Score work complexity and choose an adaptive Ensemble planning route (Codex skill for /ensemble:analyze-complexity)
user-invocable: true
argument-hint: '[work-description] [--route simple|medium|complex] [--no-adaptive-planning] [--foreman]'
model: gpt-5.1-codex
---

# Ensemble Command: /ensemble:analyze-complexity

This Codex skill mirrors the Ensemble slash command `/ensemble:analyze-complexity`.
Follow the workflow below, adapt to the current repository, and keep outputs structured.

<!-- DO NOT EDIT - Generated from analyze-complexity.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Analyze a user or Foreman work item before planning starts. Normalize input,
redact likely secrets in audit text, compute deterministic complexity scores
for scope size, dependencies, risk factors, and team size, map the final
score to Simple/Medium/Complex planning depth, apply explicit overrides,
and disclose the selected route before invoking or instructing downstream
Ensemble commands.

## Workflow

### Phase 1: Input Normalization

**1. Resolve subject and description**
   Resolve COMPLEXITY_ANALYZER per the tool-path-resolution skill (packages/development/skills/tool-path-resolution/SKILL.md) for packages/development/lib/complexity-analyzer.js. If none of the 4 tiers resolve OR 'which node' fails: print 'ERROR: Node.js and the complexity analyzer (lib/complexity-analyzer.js) are required for deterministic complexity scoring. Ensure Node.js is installed and the ensemble-development plugin is present.' and exit 1.
Run node "$COMPLEXITY_ANALYZER" analyze with the provided arguments.
If --foreman is present, read FOREMAN_TASK_TITLE as the subject and FOREMAN_TASK_DESCRIPTION as the description.
If no subject or description exists, print the missing-subject error and stop before creating any downstream artifact.


**2. Resolve adaptive planning controls**
   Apply --no-adaptive-planning first. If absent, read Ensemble config files for adaptive_planning.enabled.
When disabled, print that adaptive planning was skipped and leave existing direct command behavior unchanged.


### Phase 2: Complexity Scoring

**1. Redact audit text**
   Redact likely secrets such as API keys, tokens, passwords, and bearer tokens before rationale or report output.
Preserve the original subject and description for downstream route payloads.


**2. Score required dimensions**
   Compute numeric and qualitative scores for scope size, dependencies, risk factors, and team size.
Include concrete evidence per elevated dimension in the rationale.


**3. Map score to route**
   Use inclusive score bands: 1-3 Simple, 4-6 Medium, 7-10 Complex.
Simple points to /ensemble:fix-issue, Medium points to PRD/TRD planning then stops, and Complex includes PRD/TRD refinement gates then stops before implementation.


**4. Confidence and fallback handling**
   Mark confidence low when fewer than two dimensions have scoreable evidence.
If AI output is malformed, use deterministic heuristic fallback only when enough structural detail exists; otherwise halt with no side effects.
In low-confidence Foreman mode, select a safer higher-depth plausible route and record missing details.


### Phase 3: Route Selection and Disclosure

**1. Apply route override**
   Accept only --route simple, --route medium, or --route complex.
Preserve the recommended route and record the selected override source.
Reject any other override value with valid choices listed and no route side effects.


**2. Print pre-planning disclosure**
   Print score, route, confidence, override status, dimension detail, and rationale before downstream dispatch text.
In interactive low-confidence mode, request clarification or explicit confirmation before route execution.


**3. Emit Foreman artifacts**
   When --foreman and FOREMAN_ARTIFACT_PATH are set, write the human-readable phase report to exactly FOREMAN_ARTIFACT_PATH and a JSON sidecar named <basename>.classification.json next to it.


### Phase 4: Downstream Route Contract

**1. Simple route**
   Invoke or instruct /ensemble:fix-issue with the original non-redacted work description.


**2. Medium route**
   Invoke or instruct /ensemble:create-prd followed by /ensemble:create-trd, then stop before implementation until explicit approval.


**3. Complex route**
   Invoke or instruct /ensemble:create-prd, /ensemble:refine-prd, /ensemble:create-trd, and /ensemble:refine-trd, then stop before implementation until explicit approval.


## Expected Output

**Format:** Complexity disclosure and optional Foreman artifacts

**Structure:**
- **Score disclosure**: Score, selected route, recommended route, confidence, override state, and rationale
- **Route plan**: Downstream Ensemble command sequence and approval stop state
- **Foreman classification sidecar**: Machine-readable JSON written adjacent to FOREMAN_ARTIFACT_PATH in Foreman mode

## Usage

```
/ensemble:analyze-complexity [work-description] [--route simple|medium|complex] [--no-adaptive-planning] [--foreman]
```
