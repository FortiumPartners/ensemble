# Runtime Generation Templates

This directory contains templates and instructions used by `/init-project` to scaffold the vendored runtime.

## Directory Structure

```
templates/
├── README.md                           # This file
├── claude-directory/                   # .claude/ directory scaffolding
│   ├── agents/.gitkeep                 # Agent prompts directory
│   ├── rules/.gitkeep                  # Governance documents directory
│   ├── skills/.gitkeep                 # Stack-relevant skills directory
│   ├── commands/.gitkeep               # Workflow commands directory
│   ├── hooks/.gitkeep                  # Hook executables directory
│   ├── settings.json                   # Baseline settings configuration
│   └── router-rules.json               # Baseline router rules
├── trd-state/                          # .trd-state/ scaffolding
│   ├── current.json.template           # Current feature pointer template
│   └── implement.json.template         # Implementation status template
├── stack-detection-instructions.md     # LLM instructions for stack detection
├── stack.md.template                   # stack.md generation template
├── constitution.md.template            # constitution.md template
├── process.md.template                 # process.md template
├── skill-selection-instructions.md     # LLM instructions for skill selection
└── gitignore-additions.txt             # Lines to add to .gitignore
```

## Template Types

### Static Templates

These are copied directly during `/init-project`:

- `claude-directory/settings.json` - Baseline settings with hook configuration
- `claude-directory/router-rules.json` - Baseline routing patterns
- `trd-state/current.json.template` - Initial current feature pointer

### Dynamic Templates

These contain placeholders ({{VARIABLE}}) that the LLM fills in based on project analysis:

- `stack.md.template` - Technology stack definition
- `constitution.md.template` - Project constitution
- `process.md.template` - Workflow documentation
- `trd-state/implement.json.template` - Per-feature implementation status

### LLM Instructions

These guide the LLM during project initialization (NOT executable code):

- `stack-detection-instructions.md` - How to analyze project dependencies
- `skill-selection-instructions.md` - How to select relevant skills

### Configuration Additions

- `gitignore-additions.txt` - Lines to append to project's .gitignore

## Usage by /init-project

The `/init-project` command uses these templates as follows:

1. **Create directories**: Copy `claude-directory/` structure to `.claude/`
2. **Detect stack**: Follow `stack-detection-instructions.md` to analyze project
3. **Generate stack.md**: Use `stack.md.template` with detected information
4. **Generate constitution.md**: Use `constitution.md.template` with project config
5. **Generate process.md**: Use `process.md.template` with coverage settings
6. **Select skills**: Follow `skill-selection-instructions.md` to copy relevant skills
7. **Copy hooks**: Copy hook executables from plugin to `.claude/hooks/`
8. **Copy commands**: Copy command .md files from plugin to `.claude/commands/`
9. **Customize agents**: Copy and tailor agent .md files to `.claude/agents/`
10. **Create .trd-state/**: Copy `trd-state/current.json.template` to `.trd-state/current.json`
11. **Update .gitignore**: Append `gitignore-additions.txt` content

## Template Placeholder Syntax

Templates use Mustache-style placeholders:

- `{{VARIABLE}}` - Simple variable substitution
- `{{#each ARRAY}}...{{/each}}` - Array iteration
- `{{#if CONDITION}}...{{/if}}` - Conditional content

Common placeholders:

| Placeholder | Description |
|-------------|-------------|
| `{{PROJECT_NAME}}` | Name of the project |
| `{{PROJECT_DESCRIPTION}}` | Brief project description |
| `{{GENERATED_DATE}}` | Date of generation |
| `{{UNIT_COVERAGE}}` | Unit test coverage target |
| `{{INTEGRATION_COVERAGE}}` | Integration test coverage target |
| `{{LANGUAGES}}` | Array of detected languages |
| `{{FRAMEWORKS}}` | Array of detected frameworks |

## Modifying Templates

When modifying templates:

1. **Preserve structure** - Don't change section headings without updating dependent code
2. **Test placeholders** - Ensure all placeholders can be resolved
3. **Document changes** - Update this README with any new placeholders
4. **Keep instructions synchronized** - Update detection/selection instructions if templates change

## Related Documentation

- TRD Section 4.2 (R0 - Runtime Generation tasks)
- TRD Section 2.5 (State Management Architecture)
- TRD Section 3.1 (/init-project specification)
