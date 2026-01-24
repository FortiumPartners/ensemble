# Router Rules System Improvement Plan

**Version:** 1.0.0
**Created:** 2025-12-31
**Status:** ✅ Completed

## Executive Summary

This document outlines a phased approach to improving the router rules system while maintaining backwards compatibility and avoiding regression. The current implementation is working and stable; all changes must be additive and non-breaking.

---

## Current State Analysis

### Strengths (Preserve These)
- Zero external dependencies (Python stdlib only)
- Clean separation of concerns (config, rules loading, matching, templating)
- Robust error handling (always exits 0, never blocks user)
- Well-tested (~500 lines of tests covering major scenarios)
- Project rules merge cleanly with global rules
- Word boundary matching prevents partial matches

### Issues Identified

| Priority | Issue | Risk Level | Impact |
|----------|-------|------------|--------|
| HIGH | No JSON Schema validation | Medium | Silent failures from malformed rules |
| HIGH | Framework detection too narrow (7 frameworks) | Low | Missed routing opportunities |
| MEDIUM | Limited category coverage (2 of 10) | Low | Incomplete project rules |
| MEDIUM | No custom agent/skill discovery | Low | Manual configuration required |
| LOW | Missing agents/skills in global rules | Low | Incomplete routing |

---

## Phase 1: Schema Validation (HIGH Priority)

### 1.1 Problem Statement

The `validate_rules()` function (line 226-229) only checks for 3 required keys:
```python
def validate_rules(rules: Dict[str, Any]) -> bool:
    """Validate rules have required sections."""
    required_keys = ["agent_categories", "skills", "injection_templates"]
    return all(key in rules for key in required_keys)
```

This allows malformed structures like:
```json
{
  "agent_categories": "not-an-object",  // Should be object
  "skills": [],                          // Should be object
  "injection_templates": {}              // Valid but empty
}
```

### 1.2 Proposed Solution

Add structural validation WITHOUT adding external dependencies:

```python
def validate_rules_structure(rules: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Validate rules structure with detailed error reporting.

    Returns:
        - (True, []) if valid
        - (False, [list of errors]) if invalid
    """
    errors = []

    # Check required top-level keys
    required_keys = ["agent_categories", "skills", "injection_templates"]
    for key in required_keys:
        if key not in rules:
            errors.append(f"Missing required key: {key}")

    if errors:
        return False, errors

    # Validate agent_categories structure
    if not isinstance(rules["agent_categories"], dict):
        errors.append("agent_categories must be an object")
    else:
        for cat_name, cat_data in rules["agent_categories"].items():
            if not isinstance(cat_data, dict):
                errors.append(f"agent_categories.{cat_name} must be an object")
                continue
            if "triggers" not in cat_data:
                errors.append(f"agent_categories.{cat_name} missing 'triggers'")
            elif not isinstance(cat_data["triggers"], list):
                errors.append(f"agent_categories.{cat_name}.triggers must be array")
            if "agents" not in cat_data:
                errors.append(f"agent_categories.{cat_name} missing 'agents'")
            elif not isinstance(cat_data["agents"], list):
                errors.append(f"agent_categories.{cat_name}.agents must be array")

    # Validate skills structure
    if not isinstance(rules["skills"], dict):
        errors.append("skills must be an object")
    else:
        for skill_name, skill_data in rules["skills"].items():
            if not isinstance(skill_data, dict):
                errors.append(f"skills.{skill_name} must be an object")
                continue
            if "triggers" not in skill_data:
                errors.append(f"skills.{skill_name} missing 'triggers'")
            elif not isinstance(skill_data["triggers"], list):
                errors.append(f"skills.{skill_name}.triggers must be array")

    # Validate injection_templates structure
    if not isinstance(rules["injection_templates"], dict):
        errors.append("injection_templates must be an object")

    return len(errors) == 0, errors
```

### 1.3 Implementation Strategy

**Backwards Compatibility:**
- Keep existing `validate_rules()` function unchanged
- Add new `validate_rules_structure()` as opt-in validation
- Log warnings for structural issues but don't fail (graceful degradation)

**Rollback Plan:**
- If validation causes issues, disable via `ROUTER_STRICT_VALIDATION=0` env var
- Keep the original validation as fallback

### 1.4 Test Coverage Required

```python
class TestValidateRulesStructure:
    def test_valid_rules_pass(self, sample_rules):
        valid, errors = validate_rules_structure(sample_rules)
        assert valid is True
        assert len(errors) == 0

    def test_agent_categories_not_object(self):
        rules = {"agent_categories": [], "skills": {}, "injection_templates": {}}
        valid, errors = validate_rules_structure(rules)
        assert valid is False
        assert "agent_categories must be an object" in errors

    def test_missing_triggers(self):
        rules = {
            "agent_categories": {"dev": {"agents": []}},
            "skills": {},
            "injection_templates": {}
        }
        valid, errors = validate_rules_structure(rules)
        assert valid is False
        assert any("missing 'triggers'" in e for e in errors)

    def test_triggers_not_array(self):
        rules = {
            "agent_categories": {"dev": {"triggers": "not-array", "agents": []}},
            "skills": {},
            "injection_templates": {}
        }
        valid, errors = validate_rules_structure(rules)
        assert valid is False
        assert any("triggers must be array" in e for e in errors)
```

### 1.5 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaks existing valid rules | Low | High | Add validation as warning-only first |
| Performance impact | Very Low | Low | Validation runs once at startup |
| False positives | Low | Medium | Comprehensive test suite |

---

## Phase 2: Expanded Framework Detection (HIGH Priority)

### 2.1 Problem Statement

The `generate-project-router-rules.md` command only detects 7 frameworks:
- React, Next.js, NestJS, Rails, Phoenix, Flutter, Blazor

Missing 30+ commonly used frameworks.

### 2.2 Proposed Solution

Expand detection matrix in the command:

```markdown
### 1.2 Identify Frameworks (Expanded)

| Category | Framework | Detection Method | Skills to Map |
|----------|-----------|-----------------|---------------|
| **Frontend** |
| | React | `react` in package.json | `jest` |
| | Next.js | `next` in package.json | `vercel`, `jest` |
| | Vue | `vue` in package.json | `jest` |
| | Nuxt | `nuxt` in package.json | `jest` |
| | Angular | `@angular/core` in package.json | `jest` |
| | Svelte | `svelte` in package.json | `jest` |
| | SvelteKit | `@sveltejs/kit` in package.json | `jest` |
| | Remix | `@remix-run/react` in package.json | `jest` |
| | Astro | `astro` in package.json | `jest` |
| | Gatsby | `gatsby` in package.json | `jest` |
| | Solid | `solid-js` in package.json | `jest` |
| | Qwik | `@builder.io/qwik` in package.json | `jest` |
| **Backend Node** |
| | NestJS | `@nestjs/core` in package.json | `jest`, `nestjs` |
| | Express | `express` in package.json | `jest` |
| | Fastify | `fastify` in package.json | `jest` |
| | Hono | `hono` in package.json | `jest` |
| | Koa | `koa` in package.json | `jest` |
| **Python** |
| | Django | `django` in requirements.txt/pyproject.toml | `pytest` |
| | Flask | `flask` in requirements.txt/pyproject.toml | `pytest` |
| | FastAPI | `fastapi` in requirements.txt/pyproject.toml | `pytest` |
| | Starlette | `starlette` in requirements.txt/pyproject.toml | `pytest` |
| **Ruby** |
| | Rails | `rails` in Gemfile | `rspec`, `rails` |
| | Sinatra | `sinatra` in Gemfile | `rspec` |
| | Hanami | `hanami` in Gemfile | `rspec` |
| **Elixir** |
| | Phoenix | `phoenix` in mix.exs | `exunit`, `phoenix` |
| | LiveView | `phoenix_live_view` in mix.exs | `exunit`, `phoenix` |
| **Go** |
| | Gin | `github.com/gin-gonic/gin` in go.mod | |
| | Echo | `github.com/labstack/echo` in go.mod | |
| | Fiber | `github.com/gofiber/fiber` in go.mod | |
| | Chi | `github.com/go-chi/chi` in go.mod | |
| **Rust** |
| | Actix | `actix-web` in Cargo.toml | |
| | Axum | `axum` in Cargo.toml | |
| | Rocket | `rocket` in Cargo.toml | |
| **Java/Kotlin** |
| | Spring Boot | `org.springframework.boot` in pom.xml/build.gradle | |
| | Quarkus | `io.quarkus` in pom.xml | |
| | Micronaut | `io.micronaut` in build.gradle | |
| **.NET** |
| | Blazor | `Microsoft.AspNetCore.Components` in .csproj | `xunit`, `blazor` |
| | ASP.NET Core | `Microsoft.AspNetCore` in .csproj | `xunit` |
| **PHP** |
| | Laravel | `laravel/framework` in composer.json | |
| | Symfony | `symfony/framework-bundle` in composer.json | |
| **Mobile** |
| | Flutter | `pubspec.yaml` exists | `flutter` |
| | React Native | `react-native` in package.json | `jest` |
| | Expo | `expo` in package.json | `jest` |
```

### 2.3 Implementation Strategy

**Backwards Compatibility:**
- The command is documentation/guidance only
- Expanding the table doesn't change the router.py code
- Users regenerating rules will get better detection

**Rollback Plan:**
- Revert to previous command markdown if issues arise
- No runtime impact

### 2.4 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Incorrect framework detection | Medium | Low | Detection is advisory, not mandatory |
| Skill mapping errors | Low | Low | Skills are suggestions only |
| Command becomes too complex | Medium | Low | Organize by category tables |

---

## Phase 3: Extended Category Coverage (MEDIUM Priority)

### 3.1 Problem Statement

The `generate-project-router-rules.md` command only generates triggers for 2 categories:
- `development`
- `infrastructure_build`

But `router-rules.json` defines 10 categories:
- `product_documentation`
- `orchestration`
- `development`
- `quality_testing`
- `infrastructure_build`
- `git_github`
- `utility`
- `database`
- `metrics_analytics`
- `claude_code_help`

### 3.2 Proposed Solution

Update the command to detect and generate triggers for all 10 categories:

```json
{
  "triggers": {
    "development": ["nextjs", "react", "typescript"],
    "quality_testing": ["jest", "playwright", "cypress"],
    "infrastructure_build": ["vercel", "docker", "kubernetes"],
    "git_github": ["github actions", "ci/cd"],
    "database": ["postgresql", "prisma", "drizzle"],
    "product_documentation": ["storybook", "docusaurus"],
    "metrics_analytics": []
  }
}
```

### 3.3 Detection Additions

```markdown
### 1.5 Detect Documentation Tools

**Actions:**
- Check for `storybook` in devDependencies -> `product_documentation`
- Check for `docusaurus` -> `product_documentation`
- Check for `typedoc` -> `product_documentation`
- Check for `swagger-jsdoc` -> `product_documentation`

### 1.6 Detect Git/CI Tools

**Actions:**
- Check for `.github/workflows/` -> `git_github`
- Check for `.gitlab-ci.yml` -> `git_github`
- Check for `bitbucket-pipelines.yml` -> `git_github`

### 1.7 Detect Database Tools

**Actions:**
- Check for `prisma` in dependencies -> `database`
- Check for `drizzle-orm` -> `database`
- Check for `typeorm` -> `database`
- Check for `sequelize` -> `database`
- Check for `pg` (node-postgres) -> `database`
- Check for `sqlalchemy` in Python deps -> `database`
```

### 3.4 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Over-routing to wrong categories | Medium | Low | Categories are hints, not mandates |
| Increased complexity | Low | Low | Organize detections by phase |

---

## Phase 4: Custom Agent/Skill Discovery (MEDIUM Priority)

### 4.1 Problem Statement

The current system has hardcoded skill mappings. It cannot discover:
- User-created agents in `.claude/agents/`
- Project-specific skills in `.claude/skills/`
- Third-party plugins

### 4.2 Proposed Solution

Add optional discovery phase to `generate-project-router-rules.md`:

```markdown
## Phase 1.8: Custom Agent Discovery (Optional)

Check for custom agents in the project:

**Actions:**
- Scan `.claude/agents/*.yaml` or `.claude/agents/*.md`
- Extract agent names and descriptions
- Add to project rules with custom trigger keywords

**Example Output:**
```json
{
  "custom_agents": {
    "my-custom-agent": {
      "triggers": ["custom", "my-agent"],
      "description": "Extracted from agent definition"
    }
  }
}
```

## Phase 1.9: Custom Skill Discovery (Optional)

Check for project-specific skills:

**Actions:**
- Scan `.claude/skills/` directory
- Extract skill names from filenames or YAML frontmatter
- Add to project rules

**Example Output:**
```json
{
  "skills": {
    "my-custom-skill": {
      "triggers": ["custom-skill"],
      "purpose": "Project-specific automation"
    }
  }
}
```
```

### 4.3 Router.py Changes

Add support for `custom_agents` in merge logic:

```python
def merge_rules(global_rules: Dict[str, Any], project_rules: Optional[Dict[str, Any]]) -> Tuple[Dict[str, Any], Set[str], Set[str]]:
    # ... existing merge logic ...

    # NEW: Merge custom agents into appropriate categories
    if "custom_agents" in project_rules:
        for agent_name, agent_data in project_rules["custom_agents"].items():
            # Add to utility category by default
            if "utility" in merged.get("agent_categories", {}):
                merged["agent_categories"]["utility"]["agents"].append({
                    "name": agent_name,
                    "purpose": agent_data.get("description", "Custom project agent"),
                    "tools": agent_data.get("tools", [])
                })
                # Add triggers
                if "triggers" in agent_data:
                    merged["agent_categories"]["utility"]["triggers"].extend(agent_data["triggers"])
                project_agents.add(agent_name)

    return merged, project_agents, project_skills
```

### 4.4 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Malformed custom agents crash router | Medium | High | Wrap in try/except, log warning |
| Duplicate agent names | Low | Medium | Warn but don't fail |
| Performance impact of scanning | Low | Low | Run only during rules generation |

---

## Phase 5: Missing Agents/Skills in Global Rules (LOW Priority)

### 5.1 Problem Statement

The `router-rules.json` is missing some agents and skills that exist in the ensemble ecosystem:

**Missing Agents:**
- `agent-meta-engineer` - Agent ecosystem management
- `test-reader-agent` - Test file analysis

**Missing Skills (14+):**
- `react` - React component development
- `rails` - Rails application patterns
- `phoenix` - Phoenix/Elixir patterns
- `blazor` - Blazor component patterns
- `aws-cloud` - AWS infrastructure
- `flyio` - Fly.io deployment
- `helm` - Helm chart management
- `kubernetes` - K8s configuration
- And more...

### 5.2 Proposed Solution

Update `router-rules.json` to include missing items.

This is a documentation update, not code change.

### 5.3 Implementation

```json
{
  "agent_categories": {
    "utility": {
      "agents": [
        // ... existing agents ...
        {
          "name": "agent-meta-engineer",
          "purpose": "Agent ecosystem management, agent YAML creation and optimization",
          "tools": ["Read", "Write", "Edit", "Bash"]
        },
        {
          "name": "test-reader-agent",
          "purpose": "Test file analysis, coverage understanding, test strategy assessment",
          "tools": ["Read", "Grep", "Glob"]
        }
      ]
    }
  },
  "skills": {
    // ... existing skills ...
    "react": {
      "triggers": ["react", "jsx", "react component", "react hook", "useState", "useEffect"],
      "patterns": ["react.*component", "use[A-Z]\\w+"],
      "purpose": "React component development patterns and best practices"
    },
    "rails": {
      "triggers": ["rails", "ruby on rails", "activerecord", "rails migration", "rails model"],
      "patterns": ["rails.*generate", "rake.*db"],
      "purpose": "Ruby on Rails application development patterns"
    },
    "phoenix": {
      "triggers": ["phoenix", "elixir", "liveview", "ecto", "phoenix channel"],
      "patterns": ["mix.*phx", "phoenix.*live"],
      "purpose": "Phoenix/Elixir application development patterns"
    },
    "blazor": {
      "triggers": ["blazor", "blazor server", "blazor wasm", "razor component"],
      "patterns": ["blazor.*component", "@code"],
      "purpose": "Blazor component development for .NET"
    },
    "aws-cloud": {
      "triggers": ["aws", "amazon web services", "ec2", "s3", "lambda", "cloudformation"],
      "patterns": ["aws.*deploy", "cdk.*"],
      "purpose": "AWS cloud infrastructure and services"
    },
    "flyio": {
      "triggers": ["fly.io", "flyctl", "fly deploy", "fly scale"],
      "patterns": ["fly.*deploy", "flyctl.*"],
      "purpose": "Fly.io deployment and management"
    },
    "helm": {
      "triggers": ["helm", "helm chart", "helm install", "helm upgrade"],
      "patterns": ["helm.*install", "helm.*upgrade"],
      "purpose": "Kubernetes Helm chart management"
    },
    "kubernetes": {
      "triggers": ["kubernetes", "k8s", "kubectl", "pod", "deployment", "service"],
      "patterns": ["kubectl.*apply", "k8s.*"],
      "purpose": "Kubernetes cluster and resource management"
    }
  }
}
```

### 5.4 Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Incorrect trigger keywords | Low | Low | Keywords are additive, not breaking |
| Skill/agent doesn't exist | Low | Medium | Verify against actual installations |

---

## Test Strategy

### Regression Prevention

1. **Existing Test Coverage**: 500+ lines in `test_router.py` - DO NOT MODIFY existing tests
2. **Add New Tests**: Create new test classes for new functionality
3. **Property-Based Testing**: Consider adding hypothesis tests for validation

### Test Categories

```
tests/
  test_router.py              # Existing tests (DO NOT MODIFY)
  test_validation.py          # NEW: Schema validation tests
  test_framework_detection.py # NEW: Framework detection tests (if applicable)
```

### CI Integration

```yaml
# .github/workflows/test-router.yml
- name: Run Router Tests
  run: |
    cd packages/router
    python -m pytest tests/ -v --tb=short

- name: Validate Rules Schema
  run: |
    cd packages/router
    python -c "from hooks.router import load_global_rules, validate_rules_structure; \
               rules = load_global_rules(); \
               valid, errors = validate_rules_structure(rules); \
               assert valid, f'Schema errors: {errors}'"
```

---

## Rollback Plan

### Phase 1 (Schema Validation)
- **Feature Flag**: `ROUTER_STRICT_VALIDATION=0` disables new validation
- **Fallback**: Original `validate_rules()` remains unchanged
- **Revert**: Single commit revert if issues arise

### Phase 2-3 (Command Updates)
- **No Runtime Impact**: Command changes only affect regeneration
- **Revert**: Restore previous command markdown files
- **User Recovery**: Users can manually edit `.claude/router-rules.json`

### Phase 4 (Custom Discovery)
- **Feature Flag**: `ROUTER_CUSTOM_DISCOVERY=0` disables discovery
- **Graceful Degradation**: Missing custom agents/skills logged, not failed
- **Revert**: Single commit revert

### Phase 5 (Missing Agents/Skills)
- **No Code Changes**: JSON file update only
- **Revert**: Restore previous `router-rules.json`

---

## Implementation Timeline

| Phase | Effort | Dependencies | Status |
|-------|--------|--------------|--------|
| Phase 1: Schema Validation | 2-3 hours | None | Ready to implement |
| Phase 2: Framework Detection | 1-2 hours | None | Ready to implement |
| Phase 3: Category Coverage | 1-2 hours | Phase 2 | Pending |
| Phase 4: Custom Discovery | 3-4 hours | Phase 1 | Pending |
| Phase 5: Missing Items | 1 hour | None | Ready to implement |

**Total Estimated Effort:** 8-12 hours across all phases

---

## Success Criteria

1. **Zero Regression**: All 500+ existing tests continue to pass
2. **Backwards Compatible**: Existing `.claude/router-rules.json` files work unchanged
3. **Graceful Degradation**: Malformed rules logged as warnings, not failures
4. **Improved Coverage**: Framework detection covers 40+ frameworks (vs current 7)
5. **Schema Validation**: Clear error messages for malformed rules

---

## Open Questions

1. Should schema validation be opt-in or opt-out by default?
2. Should we create a JSON Schema file (`router-rules-schema.json`) for external validation?
3. Should custom agent discovery happen at runtime or only during rules generation?

---

## Appendix: File Changes Summary

| File | Changes | Risk |
|------|---------|------|
| `hooks/router.py` | Add validation, custom agent merge | Medium |
| `lib/router-rules.json` | Add missing agents/skills | Low |
| `commands/generate-project-router-rules.md` | Expand framework detection | Low |
| `commands/generate-router-rules.md` | Minor updates | Low |
| `tests/test_router.py` | Add new test classes (no modifications to existing) | Low |
| NEW: `tests/test_validation.py` | New validation tests | None |

---

*This plan is subject to user approval before implementation begins.*
