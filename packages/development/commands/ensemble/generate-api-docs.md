---
name: ensemble:generate-api-docs
description: Generate comprehensive OpenAPI/Swagger API documentation from codebase
---
<!-- DO NOT EDIT - Generated from generate-api-docs.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Generate comprehensive API documentation from codebase analysis, including OpenAPI/Swagger
specifications, endpoint descriptions, request/response examples, and error documentation.

## Workflow

### Phase 1: API Discovery

**1. Endpoint Scanning**
   Scan codebase for API endpoints

**2. Schema Extraction**
   Extract request/response schemas

### Phase 2: Documentation Generation

**1. OpenAPI Generation**
   Generate OpenAPI 3.0 specification

   **Delegation:** @api-documentation-specialist
   Discovered endpoints and schemas

**2. Example Creation**
   Create request/response examples

## Expected Output

**Format:** OpenAPI 3.0 Specification

**Structure:**
- **openapi.yaml**: Complete OpenAPI specification
- **API Documentation**: Human-readable API documentation

## Usage

```
/ensemble:generate-api-docs
```
