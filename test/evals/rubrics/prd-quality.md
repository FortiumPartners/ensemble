# PRD Quality Rubric

## Purpose

This rubric evaluates the quality of AI-generated Product Requirements Documents (PRDs). It measures completeness, clarity, feasibility, and structure. The rubric is designed to be used by judge.js with Claude Opus to provide consistent, reproducible quality scores.

## Scoring Scale

### Score 1 - Poor

PRD is incomplete or unclear. Would require substantial rework before engineering can begin.

**Completeness Indicators:**
- Missing critical sections (no user stories OR no success criteria)
- Requirements are vague or undefined
- No mention of target users or personas
- Scope is undefined or contradictory
- No prioritization of features

**Clarity Indicators:**
- Requirements are ambiguous or contradictory
- Success criteria cannot be measured
- User stories lack clear acceptance criteria
- Technical jargon without explanation
- Multiple interpretations possible for key requirements

**Feasibility Indicators:**
- No consideration of technical constraints
- Requirements are technically impossible or unrealistic
- Timeline/scope mismatch not addressed
- Dependencies not identified
- No risk acknowledgment

**Structure Indicators:**
- No clear organization or sections
- Information scattered and hard to find
- Missing table of contents for long documents
- No consistent formatting
- Difficult to navigate or reference

### Score 2 - Below Average

PRD has gaps that would slow down engineering. Requires significant clarification before work can begin.

**Completeness Indicators:**
- Some sections present but superficial
- User stories exist but lack detail
- Success criteria present but not measurable
- Partial feature coverage
- Prioritization unclear

**Clarity Indicators:**
- Some requirements clear, others ambiguous
- Success criteria partially measurable
- User stories have some acceptance criteria
- Some unexplained assumptions
- Key terms not consistently defined

**Feasibility Indicators:**
- Limited technical consideration
- Some unrealistic expectations
- Basic dependencies identified
- Some risks acknowledged but not mitigated
- Partial scope definition

**Structure Indicators:**
- Basic organization but inconsistent
- Some sections well-structured, others not
- Navigation possible but difficult
- Formatting inconsistent
- Key sections hard to locate

### Score 3 - Acceptable (Baseline)

PRD is functional and actionable. Engineering can begin with minor clarifications.

**Completeness Indicators:**
- All required sections present
- User stories cover main functionality
- Success criteria exist for key features
- Core features prioritized
- Target users identified

**Clarity Indicators:**
- Most requirements unambiguous
- Success criteria measurable for main features
- User stories have basic acceptance criteria
- Key terms defined
- Few assumptions left unexplained

**Feasibility Indicators:**
- Basic technical constraints considered
- Requirements are technically achievable
- Major dependencies identified
- Key risks acknowledged
- Scope is defined and reasonable

**Structure Indicators:**
- Clear section organization
- Logical flow of information
- Key sections easy to find
- Consistent formatting
- Can be used as reference during development

### Score 4 - Good

PRD is comprehensive and well-crafted. Engineering can proceed confidently with minimal questions.

**Completeness Indicators:**
- All sections thoroughly developed
- User stories comprehensive with edge cases
- Success criteria specific and measurable
- Clear prioritization (MoSCoW or similar)
- Multiple user personas addressed

**Clarity Indicators:**
- Requirements precise and unambiguous
- Success criteria quantified where possible
- User stories have detailed acceptance criteria
- Assumptions explicitly stated
- Glossary of key terms included

**Feasibility Indicators:**
- Technical constraints well-documented
- Requirements validated against stack capabilities
- Dependencies mapped with contingencies
- Risk mitigation strategies outlined
- Scope clearly bounded with future considerations noted

**Structure Indicators:**
- Excellent organization with clear hierarchy
- Information easy to locate and cross-reference
- Table of contents and section numbering
- Consistent, professional formatting
- Summary sections for quick reference

### Score 5 - Excellent

PRD exemplifies best practices. Serves as a template for future PRDs.

**Completeness Indicators:**
- Exhaustive coverage of all aspects
- User stories anticipate edge cases and error states
- Success criteria include metrics, thresholds, and measurement methods
- Prioritization with clear rationale
- Stakeholder perspectives comprehensively addressed

**Clarity Indicators:**
- Crystal clear requirements with no ambiguity
- Success criteria with specific numbers and deadlines
- User stories ready for immediate implementation
- All assumptions documented with validation status
- Domain-specific glossary with examples

**Feasibility Indicators:**
- Deep technical analysis with architecture considerations
- Requirements verified against existing system constraints
- Dependency graph with risk ratings
- Comprehensive risk assessment with mitigation plans
- Phased scope with clear milestones

**Structure Indicators:**
- Professional document quality
- Multiple navigation aids (TOC, index, cross-references)
- Executive summary for stakeholders
- Technical appendices for engineers
- Version history and change tracking

## Quality Dimensions Summary

| Dimension | Weight | Key Focus |
|-----------|--------|-----------|
| Completeness | 30% | All sections present, user stories comprehensive, success criteria defined |
| Clarity | 25% | Requirements unambiguous, acceptance criteria measurable, terms defined |
| Feasibility | 25% | Technical constraints considered, risks identified, scope realistic |
| Structure | 20% | Well-organized, navigable, consistent formatting |

## Document-Specific Considerations

This rubric applies to PRDs for software products. Evaluators should consider:

- **Web Applications**: API contracts, browser compatibility, responsive design
- **Mobile Apps**: Platform guidelines, offline behavior, permissions
- **APIs**: Versioning strategy, authentication, rate limiting
- **CLI Tools**: Argument structure, help text, error messages
- **Backend Services**: Scalability, monitoring, deployment strategy

The specific requirements vary by product type, but the underlying quality principles remain constant.

## Evaluation Prompt Template

Use this prompt template when invoking Claude for PRD evaluation:

```
You are an expert product manager evaluating the quality of an AI-generated PRD.

## Task
Evaluate the following PRD against the PRD Quality Rubric for overall document quality.

## PRD to Evaluate

{prd_content}

## Context (Original Requirements)

{context_content}

## Rubric

{rubric_content}

## Instructions

1. First, analyze the PRD carefully against each dimension in the rubric:
   - Completeness (30%): All sections present, user stories comprehensive, success criteria defined
   - Clarity (25%): Requirements unambiguous, acceptance criteria measurable, terms defined
   - Feasibility (25%): Technical constraints considered, risks identified, scope realistic
   - Structure (20%): Well-organized, navigable, consistent formatting

2. Think through your evaluation step by step (Chain-of-Thought reasoning).

3. Provide specific examples from the PRD to justify your assessment for each dimension.

4. Assign a final score from 1-5 based on the rubric definitions.

## Output Format

Respond in JSON format:
{
  "score": <1-5>,
  "justification": "<2-3 sentence summary of overall quality>",
  "dimension_scores": {
    "completeness": <1-5>,
    "clarity": <1-5>,
    "feasibility": <1-5>,
    "structure": <1-5>
  },
  "strengths": ["<specific strength with PRD example>", "..."],
  "weaknesses": ["<specific weakness with PRD example>", "..."],
  "reasoning": "<detailed step-by-step analysis>"
}
```

## Examples

### Example: Score 2 (Below Average)

```markdown
# Task App PRD

## Overview
We need a task app.

## Features
- Create tasks
- Delete tasks
- View tasks
```

**Assessment:**
- Completeness: Missing user stories, success criteria, prioritization
- Clarity: "Task app" is vague, no acceptance criteria
- Feasibility: No technical constraints or scope defined
- Structure: Minimal sections, no detail

**Score: 2** - Has basic structure but lacks detail and clarity for implementation.

### Example: Score 4 (Good)

```markdown
# TaskFlow PRD v1.0

## Executive Summary
TaskFlow is a task management API for development teams of 5-20 people...

## User Stories

### US-001: Task Creation
As a team member, I can create a task with:
- Title (required, 1-200 chars)
- Description (optional, markdown supported)
- Priority (low/medium/high, default: medium)
- Due date (optional, ISO 8601 format)

**Acceptance Criteria:**
- Task is created with unique ID
- Creator is automatically assigned as reporter
- API returns 201 with created task object

## Success Criteria
- API response time < 200ms p95
- 99.9% uptime SLA
- Zero critical security vulnerabilities
```

**Assessment:**
- Completeness: User stories with acceptance criteria, measurable success criteria
- Clarity: Specific field definitions, clear acceptance criteria
- Feasibility: Realistic metrics, acknowledges constraints
- Structure: Well-organized with clear sections

**Score: 4** - Comprehensive PRD with minor room for improvement (could add more edge cases).

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-13 | Initial rubric creation |
