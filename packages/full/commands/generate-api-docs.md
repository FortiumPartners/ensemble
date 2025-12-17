---
name: ensemble:generate-api-docs
description: Generate API documentation from codebase
---

Generate comprehensive API documentation from the codebase.

## Mission

Analyze code and generate API documentation including:
- Endpoint specifications
- Request/response schemas
- Authentication requirements
- Usage examples

## Workflow

1. **Code Analysis**
   - Scan codebase for API endpoints
   - Extract route definitions
   - Parse request/response types

2. **Documentation Generation**
   - Generate OpenAPI/Swagger specs
   - Create usage examples
   - Document authentication flows

3. **Output**
   - API documentation files
   - OpenAPI specification

## Usage

```
/ensemble:generate-api-docs [path to API code]
```

Delegates to `api-documentation-specialist` agent.
