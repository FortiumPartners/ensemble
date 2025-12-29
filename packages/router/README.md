# ensemble-router

> UserPromptSubmit Router Hook for Intelligent Agent Delegation

A Claude Code hook that analyzes user prompts and provides routing hints for specialized subagents and skills. Part of the Ensemble plugin ecosystem.

## Features

- **Keyword-based routing**: Matches prompts against configurable trigger patterns
- **Agent delegation hints**: Recommends appropriate specialist agents for tasks
- **Skill invocation**: Suggests relevant skills based on detected technologies
- **Project-specific rules**: Supports `.claude/router-rules.json` for project customization
- **Zero dependencies**: Uses only Python stdlib
- **Fast execution**: <20ms latency target

## Installation

Install via the Ensemble marketplace:

```bash
claude plugins install ensemble-router
```

Or add to your Claude Code settings manually.

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ROUTER_RULES_PATH` | `../lib/router-rules.json` (relative to script) | Path to global rules file |
| `ROUTER_DEBUG` | `0` | Enable debug logging to stderr (`1`, `true`, `yes`) |
| `ROUTER_SHORT_THRESHOLD` | `5` | Word count threshold for "short" prompts |

### Project-Specific Rules

Create `.claude/router-rules.json` in your project to customize routing:

```json
{
  "version": "1.0.0",
  "project_name": "my-nextjs-app",
  "triggers": {
    "development": ["nextjs", "react", "typescript"],
    "infrastructure_build": ["vercel"]
  },
  "skill_mappings": {
    "nextjs": ["vercel", "jest"],
    "react": ["jest"]
  },
  "project_context": {
    "primary_language": "TypeScript",
    "framework": "Next.js",
    "deployment": "Vercel"
  }
}
```

Project rules are merged with global rules at runtime, with project-specific matches receiving stronger routing language.

## Routing Scenarios

The router determines context hints based on these scenarios:

| Scenario | Condition | Behavior |
|----------|-----------|----------|
| `SHORT_NO_MATCH` | < 5 words, no matches | Orchestrator reminder |
| `AGENTS_ONLY` | Agents matched, no skills | Delegate to subagent |
| `AGENTS_AND_SKILLS` | Both matched | Delegate with skill guidance |
| `SKILLS_ONLY` | Skills matched, no agents | Invoke specialized skills |
| `LONG_NO_MATCH` | >= 5 words, no matches | Orchestrator guidance |
| `PROJECT_*` | Project-specific matches | Mandatory delegation (no escape hatch) |

## Commands

### /generate-router-rules

Regenerate the global `router-rules.json` by introspecting available agents and skills in the current session.

```
/generate-router-rules
```

### /generate-project-router-rules

Generate project-specific routing rules by analyzing the project's technology stack.

```
/generate-project-router-rules
```

This analyzes:
- Package manager and dependencies
- Frameworks (React, Next.js, NestJS, Rails, etc.)
- Infrastructure (Vercel, Railway, Docker, etc.)
- Testing frameworks (Jest, pytest, RSpec, etc.)

## Agent Mesh

The router supports routing to these agent categories (28 agents total):

| Category | Example Agents |
|----------|----------------|
| **Orchestration** | ensemble-orchestrator, tech-lead-orchestrator |
| **Development** | frontend-developer, backend-developer, mobile-developer |
| **Quality** | code-reviewer, test-runner, deep-debugger, playwright-tester |
| **Infrastructure** | deployment-orchestrator, infrastructure-developer |
| **Documentation** | documentation-specialist, api-documentation-specialist |
| **Utility** | general-purpose, git-workflow, file-creator |

## Skills

The router recognizes 24+ skills including:

- **Deployment**: vercel, railway, supabase
- **Frameworks**: nestjs, flutter
- **Testing**: jest, pytest, rspec, exunit, xunit, playwright-test
- **Workflow**: create-prd, create-trd, implement-trd, release
- **Detection**: framework-detector, test-detector

## Development

### Running Tests

```bash
python3 -m pytest packages/router/tests/test_router.py -v
```

### Manual Testing

```bash
# Test with debug output
echo '{"prompt": "Deploy to vercel"}' | ROUTER_DEBUG=1 python3 packages/router/hooks/router.py

# Test project context
echo '{"prompt": "Build the frontend", "cwd": "/path/to/project"}' | ROUTER_DEBUG=1 python3 packages/router/hooks/router.py
```

## Design Principles

1. **Zero Dependencies**: Only Python stdlib - no pip, no virtualenv
2. **Never Blocks**: Always exits with code 0
3. **Fast**: <20ms latency target
4. **Mandatory Delegation**: Project matches have no escape hatch
5. **Orchestrator Role**: Main session coordinates, agents implement

## License

MIT - See LICENSE file for details.

## Author

Fortium Partners - [https://github.com/FortiumPartners](https://github.com/FortiumPartners)
