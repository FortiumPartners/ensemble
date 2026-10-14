---
name: assessment-scoring-conflation-audit
description: "Detect and fix assessment dimensions that conflate unrelated factors (readiness vs practice, infrastructure vs execution) or unrelated entities (one repo's score calibrated to another repo's or a portfolio composite's finding) before finalizing scores"
---

## When to Use
Before finalizing composite dimension scores in assessments:
- Grade seems misaligned with evidence text
- Finding text contains explicit lower grades ("D-level") that contradict composite grade
- Dimension label suggests execution/practice but evidence focuses on infrastructure/readiness
- Multi-factor average masks important gaps
- A document shows both per-entity (repo/team) scores and a portfolio-wide composite score for related ground, and a reader could reasonably ask "why doesn't the repo score match the portfolio score?"

## Scoring Scale

Numeric scores use the 1.0–5.0 scale defined in `skill://assessment-report-suite`'s "Scoring Scale" section: whole-number anchors 5=A, 4=B, 3=C, 2=D, 1=F, each split into three sub-bands (width 1/3) for `+`/`-`. Concretely: B+=[4.167,4.5), B=[3.833,4.167), B-=[3.5,3.833), C+=[3.167,3.5), C=[2.833,3.167), C-=[2.5,2.833), D+=[2.167,2.5), D=[1.833,2.167), D-=[1.5,1.833), F=[0,1.5). Do not use whole-integer buckets (5=A,4=B,3=C,2=D,1=F with no +/- subdivision) or any other ad hoc mapping — always derive the letter from this range table before applying any conflation fix below.

## Detection Checklist

1. **Read the evidence first.** Does it explicitly grade one axis (e.g., "tool adoption signals = D") while the composite is higher?
2. **Check dimension label vs evidence.** "AI Adoption" should measure practice, not just code quality.
3. **Look for averaging trade-offs.** Is a B in one area (type hints) canceling a D in another (tool signals)?
4. **Verify stakeholder intent.** Which axis matters for the business decision—readiness or execution?
5. **Check for cross-entity conflation.** Was this entity's (repo's/team's) score justified by citing *another* entity's finding, or a portfolio composite that aggregates multiple entities? A portfolio composite blending a CRITICAL finding in Repo A with a HIGH or lower-severity finding in Repo B is not evidence about Repo B's own severity — borrowing the composite's score for Repo B double-counts Repo A's problem.

## Remediation

### Option 1: Decompose (Preferred)
Split into separate, clear dimensions:
- **Code AI-Readiness** (infrastructure, patterns) → actual score for that axis
- **Agentic Development Practice** (tool adoption, workflows) → honest score for that axis

Example: "AI Adoption" → "Code AI-Readiness (C+)" + "Agentic Development Practice (D)"

### Option 2: Explicit Finding Text
If merging factors, rewrite finding to expose the gap:
```
Old: "AI Adoption | 2.3 | D+ | Good type hints and playbooks; limited tool signals."
New: "AI Adoption | 1.8 | D- | Strong type hints and documentation (engineering quality); agentic tool signals absent (D-level: no Copilot, CodeGen, or LLM workflows detected). Code readiness enables future agentic work; current practice shows zero AI-first development."
```

### Option 3: Weighted Remapping
If both axes matter equally and you can't decompose:
- Reweight to emphasize the weaker axis
- Example: Instead of averaging (B + D = C), apply 50% each using the numeric anchors: 0.5×B (4.0) + 0.5×D (2.0) = 3.0 (C)
- This usually drops the score closer to the real gap

### Option 4: Cross-Entity Anti-Conflation (repo vs. portfolio)
When a repo/team-level dimension score and a portfolio composite cover overlapping ground:
- Re-derive the entity's score from *only that entity's own evidence* — never from the composite's aggregate severity or from a sibling entity's finding.
- Example fix (real case): Terrateam's Security dimension was miscalibrated to 2.3/D+ by analogy to the portfolio's "Agentic Security Posture" composite (2.3/D+), which aggregates Argo's unauthenticated-API CRITICAL finding and SOC BFF's unpatched-RCE CRITICAL finding — neither of which exists in Terrateam. Terrateam's own worst finding was a HIGH-risk (not CRITICAL) optional webhook secret, already reflected in its own documented Phase 3.5 cap (B+ → B = 3.9). Corrected: keep Terrateam Security at 3.9/B, sourced from Terrateam's own cap rationale, not the portfolio composite.
- If the entity average and the portfolio composite still diverge materially after this fix, that is expected when they cover disjoint dimension sets (e.g. portfolio-only Team Capability/Value Creation/Product Management/Metrics have no per-repo equivalent) — state the scope difference in one sentence rather than forcing the numbers to match.

## Verification

After fix, confirm:
1. Grade reflects the weaker/more critical axis
2. Finding text explicitly names the gap (e.g., "zero tool signals detected")
3. Stakeholder won't misinterpret grade as "this team does AI development"
4. Grade is consistent with scale floor (if C- is floor, don't use D)
5. The numeric-to-letter conversion matches the range table in the Scoring Scale section above — recheck any grade that looks generous (e.g. a score at or below 2.5 should never read as "C+"; per the table it is C- or lower)
6. Every per-entity dimension score's rationale cites only that entity's own evidence — if the rationale text names a different repo/team or a portfolio composite as the reason for the number, that is a cross-entity conflation and must be re-derived from the entity's own evidence (Option 4)
7. If both a per-entity score and a portfolio composite appear in the same document, the document states in prose why the two are not expected to match (disjoint scope) rather than leaving the discrepancy unexplained
