---
name: ensemble:create-trd
description: Create Technical Requirements Document from PRD or feature specification
---

Create a comprehensive Technical Requirements Document (TRD) from a PRD or feature specification.

## Mission

Transform product requirements into technical specifications with:
- Architecture design decisions
- API specifications
- Database schema design
- Integration requirements
- Security considerations

## Workflow

1. **Requirements Analysis**
   - Parse PRD or feature specification
   - Identify technical components needed
   - Map functional requirements to technical solutions

2. **Technical Design**
   - Design system architecture
   - Define API contracts
   - Specify data models
   - Plan integration points

3. **Output**
   - Comprehensive TRD document
   - Save to `docs/TRD/` directory

## Usage

```
/ensemble:create-trd <PRD path or feature description>
```

Delegates to `tech-lead-orchestrator` for architecture decisions and technical planning.
