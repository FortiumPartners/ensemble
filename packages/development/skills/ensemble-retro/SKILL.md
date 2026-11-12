---
name: ensemble-retro
description: "Post-release retrospective - estimate accuracy, PRD success-metric status, incidents, and proposed follow-ups"
disable-model-invocation: true
metadata:
  version: "2.0.0"
  category: planning
---

Close the feedback loop after a release - compare what was planned with what happened, and turn the gaps into follow-ups.

## Constraints

- Writes only docs/retros/<date>-<release>.md; proposes but never creates beads or edits PRD/TRD without explicit user approval
- Every number comes from a command you ran; if a source (host adapter, tracker, error tracker) is unavailable say so in the report instead of guessing
- Mark each success metric met, not met, or unmeasured - never infer a measurement that has no evidence

## Capabilities

**Required:** tracker.list, workflow.log
**Optional:** tracker.create, host.change-request-list

## Workflow

### Phase 1: Gather

#### Step 1.1: Resolve the Range

Establish the starting ref and release label

- --release vX.Y.Z: the range is the previous release tag before vX.Y.Z (the nearest earlier tag in the tag list) to vX.Y.Z, and the release date is the tag date. --since <ref>: the range is <ref>..HEAD and the label is the ref. With neither, HALT and ask. If the ref does not resolve, HALT and say so

#### Step 1.2: Collect What Shipped

List merged PRs and closed beads in the range

- Resolve TOOLCHAIN_CLI (RELATIVE_PATH packages/development/lib/toolchain-cli.js) with the tool-path-resolution skill (skills/tool-path-resolution/SKILL.md). Run: node "$TOOLCHAIN_CLI" preflight --require tracker.list --require workflow.log --require tracker.create [add --non-interactive when FOREMAN_TASK_TITLE is set] --json; on a non-ok result print the error and HALT before any tracker call. tracker.create (optional) is only invoked later, after explicit user approval (Propose Follow-ups).
- Run: node "$TOOLCHAIN_CLI" run workflow.log --arg ref=<range> --arg limit=1000 --json and keep the merge commits (one line each) from its commits list; plus node "$TOOLCHAIN_CLI" run host.change-request-list --arg filter="merged since <start-date>" --json (optional capability; {ok:false} -> no host adapter resolves or none is configured, skip the merged-PR list silently)
- Run: node "$TOOLCHAIN_CLI" run tracker.list --json > a temp file; closed beads with closed_at inside the range are the shipped beads

#### Step 1.3: Compute Estimate vs Actual

Run the estimate-actual library over the beads export

- Resolve ESTIMATE_ACTUAL (RELATIVE_PATH packages/development/lib/estimate-actual.js) with the tool-path-resolution skill (skills/tool-path-resolution/SKILL.md), then run: node $ESTIMATE_ACTUAL --issues-json <file>
- Narrow its beads to the shipped set. Report count, median ratio, p90 ratio, and the beads with the largest ratio (actual/estimate) in either direction. Report withoutEstimate as a coverage gap. Actual time is created-to-closed wall clock, so state that it overstates effort

#### Step 1.4: Compare Against PRD Success Metrics

Find the PRD and score each success metric

- Find the TRD for the release (docs/TRD/, from bead labels or titles). Read its frontmatter key prd_reference (also accepted: prd, source_prd) to locate the PRD. If none, say the PRD is unknown and list every metric as unmeasured
- Extract the PRD's success metrics. For each, find evidence (analytics, test or benchmark output, issue data, error tracker). Status: met (evidence meets the target), not met (evidence misses it), unmeasured (no evidence; say what would measure it)

#### Step 1.5: Collect Incidents

Find problems opened since the release

- Resolve the host adapter: node "$TOOLCHAIN_CLI" resolve --json and read data.host.adapter. HOST-SPECIFIC EXCEPTION: no host.* capability covers GitHub issue search by date (host.yaml has only change-request-* operations, not a generic issue-search capability), so when data.host.adapter == "github", search all issues created on or after <release-date> through the GitHub host's own issue search (fields: number, title, state, labels, createdAt, url) and flag bug/incident-labelled or regression-looking issues; on any other resolved adapter (or when that search is unavailable), skip this line and note in the report that GitHub issue search was not performed
- Query an error-tracker MCP tool ONLY if one is configured in this session; otherwise note that none was queried

### Phase 2: Report

#### Step 2.1: Write the Retro

Write docs/retros/<YYYY-MM-DD>-<release>.md (create docs/retros/ if missing; overwrite the same file on rerun)

- Sections: What Shipped (PRs, beads), Estimate Accuracy (the metrics above), Success Metrics (met / not met / unmeasured table with evidence), Incidents, Follow-ups

#### Step 2.2: Propose Follow-ups

Propose, do not create

- List proposed beads (title, rationale, source: missed metric, incident, or estimate outlier) and proposed PRD/TRD refinements (what to change and why)
- Ask for approval. Before the first approved tracker.create call run: node "$TOOLCHAIN_CLI" confirm-status tracker.create [add --non-interactive when FOREMAN_TASK_TITLE is set] --json; if data.required is true and data.confirmed is false and the session is interactive, ask via AskUserQuestion "Create <N> follow-up bead(s) via the tracker adapter? [yes/no]" and on yes run node "$TOOLCHAIN_CLI" confirm-record tracker.create --json before proceeding (under --non-interactive/--foreman, never prompt; proceed only if confirm-status already reports confirmed:true or required:false). For each approved item run: node "$TOOLCHAIN_CLI" run tracker.create --arg title="<title>" --arg type=task --arg description="<rationale>" --json, or hand the PRD changes to /ensemble:refine-prd. Print the retro path and what was created

## Expected Output

**Format:** docs/retros/<date>-<release>.md plus follow-up proposals awaiting approval

**Structure:**

- **What Shipped**: Merged PRs and closed beads in the range
- **Estimate Accuracy**: Count, median and p90 actual/estimate ratio, outliers, beads without estimates
- **Success Metrics**: Each PRD metric with status met, not met, or unmeasured and its evidence
- **Incidents**: Issues and errors opened since release
- **Follow-ups**: Proposed beads and PRD refinements
