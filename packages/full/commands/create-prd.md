---
name: ensemble:create-prd
description: Create comprehensive Product Requirements Document from product description
---

Create a comprehensive Product Requirements Document (PRD) from a product description or feature idea.

## Mission

Analyze the provided product description or feature idea and create a structured PRD with:
- Product Summary (problem statement, solution, value proposition)
- User Analysis (users, personas, pain points, journey)
- Goals & Non-Goals (objectives, success criteria, scope boundaries)
- Acceptance Criteria (measurable success criteria with test scenarios)

## Workflow

1. **Product Analysis**
   - Analyze provided product description or feature idea
   - Identify primary users, personas, and pain points
   - Define primary goals, success criteria, and non-goals

2. **Requirements Definition**
   - Define functional requirements (what the product must do)
   - Define non-functional requirements (performance, security, accessibility)
   - Create measurable, testable acceptance criteria

3. **Output**
   - Generate comprehensive PRD document
   - Save to `docs/PRD/` directory

## Usage

```
/ensemble:create-prd <product description or feature idea>
```

Delegates to `product-management-orchestrator` for user analysis, acceptance criteria definition, and structured requirements documentation.
