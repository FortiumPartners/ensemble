# TRD Quality Rubric

## Purpose

This rubric evaluates the quality of AI-generated Technical Requirements Documents (TRDs). It measures technical depth, actionability, traceability to PRD requirements, and completeness. The rubric is designed to be used by judge.js with Claude Opus to provide consistent, reproducible quality scores.

## Scoring Scale

### Score 1 - Poor

TRD lacks technical substance. Engineering cannot begin without major rework.

**Technical Depth Indicators:**
- No architecture decisions documented
- Tech stack choices not justified
- Missing data models or API specifications
- No consideration of non-functional requirements
- Security and scalability not addressed

**Actionability Indicators:**
- No execution plan or task breakdown
- Tasks are vague ("implement backend")
- No clear starting point for developers
- Dependencies not identified
- No acceptance criteria for tasks

**Traceability Indicators:**
- PRD requirements not referenced
- No mapping from requirements to implementation
- Missing requirements not acknowledged
- User stories not connected to technical tasks
- Success criteria not addressed in design

**Completeness Indicators:**
- Missing critical sections (architecture OR execution plan)
- No testing strategy
- Deployment not addressed
- No database schema or data flow
- Missing API contract definitions

### Score 2 - Below Average

TRD has significant gaps. Engineering can start but will need frequent clarification.

**Technical Depth Indicators:**
- Basic architecture described but not justified
- Tech stack listed but rationale unclear
- Partial data models
- Some non-functional requirements mentioned
- Security acknowledged but not detailed

**Actionability Indicators:**
- Execution plan exists but tasks are large
- Some tasks actionable, others vague
- Sequencing unclear
- Major dependencies identified
- Limited acceptance criteria

**Traceability Indicators:**
- Some PRD requirements referenced
- Partial mapping to implementation
- Some gaps acknowledged
- User stories loosely connected
- Partial coverage of success criteria

**Completeness Indicators:**
- Most sections present but thin
- Basic testing approach
- Deployment mentioned but not planned
- Basic schema without relationships
- API endpoints listed without detail

### Score 3 - Acceptable (Baseline)

TRD is functional. Engineering can proceed with reasonable confidence.

**Technical Depth Indicators:**
- Architecture documented with diagram or description
- Tech stack justified for main choices
- Core data models defined
- Key non-functional requirements addressed
- Basic security considerations

**Actionability Indicators:**
- Execution plan with numbered tasks
- Most tasks are implementable units
- Clear phase or milestone structure
- Dependencies documented
- Basic acceptance criteria for key tasks

**Traceability Indicators:**
- PRD requirements explicitly referenced
- Requirements mapped to technical components
- Gaps acknowledged with rationale
- User stories linked to tasks
- Success criteria addressed in design

**Completeness Indicators:**
- All required sections present
- Testing strategy defined
- Deployment approach outlined
- Database schema with relationships
- API contracts with request/response

### Score 4 - Good

TRD is comprehensive. Engineering can proceed confidently with minimal questions.

**Technical Depth Indicators:**
- Architecture well-documented with alternatives considered
- Tech stack justified with trade-off analysis
- Complete data models with constraints
- NFRs quantified (latency, throughput, availability)
- Security design with threat model

**Actionability Indicators:**
- Detailed execution plan with estimates optional
- Tasks are atomic and clearly scoped
- Parallelization opportunities identified
- Dependency graph with critical path
- Acceptance criteria for all tasks

**Traceability Indicators:**
- Every PRD requirement explicitly addressed
- Bidirectional mapping (PRD <-> TRD)
- Out-of-scope items documented
- User stories decomposed into technical tasks
- Success criteria with implementation approach

**Completeness Indicators:**
- Thorough coverage of all aspects
- Testing strategy with coverage targets
- Deployment pipeline with stages
- Schema with indices and migrations
- OpenAPI/Swagger-level API documentation

### Score 5 - Excellent

TRD exemplifies best practices. Serves as a template for future TRDs.

**Technical Depth Indicators:**
- Comprehensive architecture with ADRs
- Tech stack with decision matrix
- Data models with validation rules and examples
- NFRs with measurement and alerting strategy
- Security hardening checklist

**Actionability Indicators:**
- Execution plan ready for sprint planning
- Tasks include code location hints
- Delegation recommendations (which agent/specialist)
- Risk-adjusted dependency management
- Acceptance criteria with test scenarios

**Traceability Indicators:**
- Requirements traceability matrix
- Impact analysis for each requirement
- Explicit decisions on deferred requirements
- User story to code path mapping
- Success criteria with monitoring dashboard design

**Completeness Indicators:**
- Production-ready documentation
- Testing pyramid with all levels
- CI/CD pipeline specification
- Database with seed data and migrations
- API with examples, errors, and versioning

## Quality Dimensions Summary

| Dimension | Weight | Key Focus |
|-----------|--------|-----------|
| Technical Depth | 30% | Architecture justified, tech stack appropriate, NFRs addressed |
| Actionability | 25% | Execution plan specific, tasks implementable, dependencies clear |
| Traceability | 25% | PRD requirements mapped, user stories connected, gaps acknowledged |
| Completeness | 20% | All sections present, testing strategy, deployment plan |

## Document-Specific Considerations

This rubric applies to TRDs for software implementations. Evaluators should consider:

- **API Projects**: Endpoint specifications, authentication, rate limiting, versioning
- **Frontend Projects**: Component hierarchy, state management, build pipeline
- **Data Projects**: ETL flows, schema evolution, backup strategy
- **Mobile Projects**: Platform-specific considerations, offline support, app store requirements
- **Infrastructure Projects**: IaC approach, scaling strategy, disaster recovery

The specific technical details vary by project type, but the underlying quality principles remain constant.

## Evaluation Prompt Template

Use this prompt template when invoking Claude for TRD evaluation:

```
You are an expert technical architect evaluating the quality of an AI-generated TRD.

## Task
Evaluate the following TRD against the TRD Quality Rubric for overall document quality.

## TRD to Evaluate

{trd_content}

## Context (Original PRD)

{context_content}

## Rubric

{rubric_content}

## Instructions

1. First, analyze the TRD carefully against each dimension in the rubric:
   - Technical Depth (30%): Architecture justified, tech stack appropriate, NFRs addressed
   - Actionability (25%): Execution plan specific, tasks implementable, dependencies clear
   - Traceability (25%): PRD requirements mapped, user stories connected, gaps acknowledged
   - Completeness (20%): All sections present, testing strategy, deployment plan

2. Think through your evaluation step by step (Chain-of-Thought reasoning).

3. Provide specific examples from the TRD to justify your assessment for each dimension.

4. Assign a final score from 1-5 based on the rubric definitions.

## Output Format

Respond in JSON format:
{
  "score": <1-5>,
  "justification": "<2-3 sentence summary of overall quality>",
  "dimension_scores": {
    "technical_depth": <1-5>,
    "actionability": <1-5>,
    "traceability": <1-5>,
    "completeness": <1-5>
  },
  "strengths": ["<specific strength with TRD example>", "..."],
  "weaknesses": ["<specific weakness with TRD example>", "..."],
  "reasoning": "<detailed step-by-step analysis>"
}
```

## Examples

### Example: Score 2 (Below Average)

```markdown
# TaskFlow TRD

## Tech Stack
- Python
- FastAPI
- PostgreSQL

## Tasks
1. Set up project
2. Create database
3. Build API
4. Add tests
```

**Assessment:**
- Technical Depth: Stack listed but no justification, no architecture
- Actionability: Tasks too vague, no acceptance criteria
- Traceability: No PRD references, requirements not mapped
- Completeness: Missing architecture, deployment, security

**Score: 2** - Basic structure but lacks detail for implementation.

### Example: Score 4 (Good)

```markdown
# TaskFlow TRD v1.0

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│  FastAPI    │────▶│  PostgreSQL │
│   (React)   │     │   Server    │     │   Database  │
└─────────────┘     └─────────────┘     └─────────────┘
```

### Tech Stack Rationale
- **FastAPI**: Async performance, auto-generated OpenAPI docs, Pydantic validation
- **PostgreSQL**: ACID compliance, JSON support, scalability

## Execution Plan

### Phase 1: Foundation (Week 1)
| Task ID | Task | Acceptance Criteria |
|---------|------|---------------------|
| TRD-001 | Initialize FastAPI project with poetry | `poetry run pytest` passes |
| TRD-002 | Create Task SQLAlchemy model | Model maps to PRD US-001 fields |
| TRD-003 | Implement POST /tasks endpoint | Returns 201, validates input |

### Requirements Mapping
| PRD Requirement | TRD Implementation |
|-----------------|-------------------|
| US-001: Task Creation | TRD-002, TRD-003 |
| SC-001: <200ms response | TRD-010 (add indices) |
```

**Assessment:**
- Technical Depth: Architecture diagram, justified stack choices
- Actionability: Numbered tasks with acceptance criteria
- Traceability: Explicit requirements mapping table
- Completeness: Good coverage with clear phases

**Score: 4** - Comprehensive TRD ready for implementation.

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-13 | Initial rubric creation |
