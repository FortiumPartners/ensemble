# [SKILL_NAME] Integration Skill

> Template for creating Claude Code skill documentation for CLI tools and frameworks

<!--
INSTRUCTIONS FOR USE:
1. Replace all [PLACEHOLDER] tokens with actual values
2. Remove sections that don't apply to your tool
3. Keep structure consistent for agent parsing
4. Validate against skill schema after completion
5. Test with validation script: ./scripts/validate-git-town.sh (adapt for your tool)

PLACEHOLDERS:
- [SKILL_NAME]: Name of the tool/framework (e.g., "Git-Town", "Docker", "Kubernetes")
- [VERSION]: Current stable version (e.g., "14.0.0")
- [MIN_VERSION]: Minimum supported version (e.g., "14.0.0")
- [AUTHOR]: Skill author name
- [DATE]: Creation date (YYYY-MM-DD)
- [INSTALL_CMD]: Installation command (e.g., "brew install git-town")
- [CONFIG_CMD]: Configuration command (e.g., "git town config setup")
- [PRIMARY_CMD]: Main command pattern (e.g., "git town")
- [HOMEPAGE]: Official documentation URL
- [REPO_URL]: Source code repository URL
-->

**Version**: [VERSION]
**Author**: [AUTHOR]
**Last Updated**: [DATE]

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Installation & Setup](#installation--setup)
4. [Core Concepts](#core-concepts)
5. [Common Workflows](#common-workflows)
6. [Command Reference](#command-reference)
7. [Error Handling](#error-handling)
8. [Best Practices](#best-practices)
9. [Examples](#examples)
10. [Troubleshooting](#troubleshooting)

---

## Overview

<!-- Provide 2-3 paragraph overview of the tool/framework -->

**[SKILL_NAME]** is [brief description of what it does and its primary purpose].

**Key Features**:
- Feature 1: [Description]
- Feature 2: [Description]
- Feature 3: [Description]
- Feature 4: [Description]

**When to Use This Skill**:
- Use case 1: [Description]
- Use case 2: [Description]
- Use case 3: [Description]

**When NOT to Use**:
- Anti-pattern 1: [Description]
- Anti-pattern 2: [Description]

---

## Prerequisites

**Required**:
- Dependency 1: [Name] >= [version] ([installation link])
- Dependency 2: [Name] >= [version] ([installation link])

**Optional**:
- Optional dependency 1: [Name] ([purpose])
- Optional dependency 2: [Name] ([purpose])

**System Requirements**:
- Operating Systems: macOS, Linux, Windows
- Architecture: x86_64, ARM64
- Minimum RAM: [amount]
- Disk space: [amount]

---

## Installation & Setup

### Installation

**macOS** (Homebrew):
```bash
[INSTALL_CMD]
```

**Linux** (Package Manager):
```bash
# Debian/Ubuntu
apt-get install [package-name]

# RedHat/CentOS
yum install [package-name]

# Arch
pacman -S [package-name]
```

**Windows** (Package Manager):
```bash
# Scoop
scoop install [package-name]

# Chocolatey
choco install [package-name]

# Winget
winget install [package-name]
```

**From Source**:
```bash
git clone [REPO_URL]
cd [repo-name]
make install
```

### Verification

```bash
# Check installation
[PRIMARY_CMD] --version

# Expected output
[SKILL_NAME] version [VERSION]
```

### Configuration

**Interactive Setup**:
```bash
[CONFIG_CMD]
```

**Manual Configuration**:
```bash
# Configuration file location
# macOS/Linux: ~/.config/[tool-name]/config
# Windows: %APPDATA%\[tool-name]\config

# Example configuration
[example config content]
```

**Validation Script**:
```bash
#!/usr/bin/env bash
# scripts/validate-[tool-name].sh

# Exit codes
EXIT_SUCCESS=0           # All checks passed
EXIT_NOT_FOUND=1         # Tool not installed
EXIT_NOT_CONFIGURED=2    # Tool not configured
EXIT_OLD_VERSION=3       # Version too old
EXIT_INVALID_ENV=4       # Invalid environment

# Validate installation
validate_installation() {
    if ! command -v [PRIMARY_CMD] &>/dev/null; then
        echo "ERROR: [SKILL_NAME] not installed"
        echo "Install: [INSTALL_CMD]"
        return $EXIT_NOT_FOUND
    fi

    echo "✓ [SKILL_NAME] installed"
    return 0
}

# Validate version
validate_version() {
    local required_version="[MIN_VERSION]"
    local installed_version=$([PRIMARY_CMD] --version | grep -oP '\d+\.\d+\.\d+' | head -1)

    if [ -z "$installed_version" ]; then
        echo "ERROR: Cannot determine version"
        return 1
    fi

    echo "Installed version: $installed_version"
    echo "Required version: >= $required_version"

    # Version comparison logic here

    echo "✓ Version requirement met"
    return 0
}

# Validate configuration
validate_configuration() {
    # Check for required config values
    if ! [check config command]; then
        echo "ERROR: [SKILL_NAME] not configured"
        echo "Run: [CONFIG_CMD]"
        return $EXIT_NOT_CONFIGURED
    fi

    echo "✓ Configuration valid"
    return 0
}

# Main validation
main() {
    validate_installation || return $?
    validate_version || return $?
    validate_configuration || return $?

    echo "✓ All validation checks passed"
    return $EXIT_SUCCESS
}

main
exit $?
```

---

## Core Concepts

<!-- Explain the 3-5 most important concepts agents need to understand -->

### Concept 1: [Name]

**Definition**: [Clear definition]

**Why It Matters**: [Explanation of importance]

**Example**:
```bash
[example command or code]
```

**Agent Considerations**:
- When to use: [scenario]
- When to avoid: [scenario]
- Common mistakes: [pitfall]

---

### Concept 2: [Name]

[Follow same structure as Concept 1]

---

## Common Workflows

<!-- Document the 5-7 most common workflows agents will execute -->

### Workflow 1: [Workflow Name]

**Purpose**: [What this workflow accomplishes]

**Prerequisites**:
- Prerequisite 1
- Prerequisite 2

**Steps**:

```bash
# Step 1: [Description]
[command 1]

# Step 2: [Description]
[command 2]

# Step 3: [Description]
[command 3]
```

**Expected Output**:
```
[example output]
```

**Error Scenarios**:
| Error | Exit Code | Resolution |
|-------|-----------|------------|
| Error 1 | X | [Resolution steps] |
| Error 2 | Y | [Resolution steps] |

**Agent Decision Tree**:
```
Start Workflow
│
├─ Validate prerequisites
│  ├─ All met → Continue
│  └─ Missing → Escalate to user
│
├─ Execute Step 1
│  ├─ Success → Continue
│  └─ Failure → Handle error (see Error Handling)
│
├─ Execute Step 2
│  └─ [Continue pattern]
│
└─ Report success
```

---

### Workflow 2: [Workflow Name]

[Follow same structure as Workflow 1]

---

## Command Reference

<!-- Organize commands by category, provide comprehensive examples -->

### Category 1: [Category Name]

#### Command: `[command-name]`

**Purpose**: [Brief description]

**Syntax**:
```bash
[PRIMARY_CMD] [command-name] [required-arg] [--optional-flag]
```

**Parameters**:
- `required-arg`: [Description] (required)
- `--optional-flag`: [Description] (optional, default: [value])

**Examples**:

**Example 1: [Scenario]**
```bash
[PRIMARY_CMD] [command-name] example-value

# Output:
# [expected output]
```

**Example 2: [Scenario with flags]**
```bash
[PRIMARY_CMD] [command-name] example-value --flag

# Output:
# [expected output]
```

**Exit Codes**:
| Code | Meaning | Agent Action |
|------|---------|--------------|
| 0 | Success | Continue workflow |
| 1 | Error type 1 | [Action] |
| 2 | Error type 2 | [Action] |

**Agent Integration**:
```bash
# Wrapper function for safe execution
safe_[command_name]() {
    local arg="$1"

    # Validate input
    if [ -z "$arg" ]; then
        echo "ERROR: Argument required"
        return 1
    fi

    # Execute command
    [PRIMARY_CMD] [command-name] "$arg"
    local exit_code=$?

    # Handle errors
    case $exit_code in
        0)
            echo "✓ Command succeeded"
            ;;
        1)
            echo "✗ Error occurred"
            # Resolution logic
            ;;
    esac

    return $exit_code
}
```

---

### Category 2: [Category Name]

[Follow same structure for additional commands]

---

## Error Handling

<!-- Reference comprehensive error handling documentation -->

For complete error handling strategies, see [ERROR_HANDLING.md](./ERROR_HANDLING.md).

### Quick Reference

| Error Type | Exit Code | Detection | Auto-Resolve? | Escalate? |
|------------|-----------|-----------|---------------|-----------|
| Type 1 | X | [Pattern] | Yes | No |
| Type 2 | Y | [Pattern] | Conditional | Sometimes |
| Type 3 | Z | [Pattern] | No | Always |

### Common Error Patterns

**Error 1: [Name]**
```bash
# Detection
[PRIMARY_CMD] [command]
EXIT_CODE=$?
[ $EXIT_CODE -eq X ] && echo "Error 1 detected"

# Resolution
[resolution steps]
```

**Error 2: [Name]**
```bash
# Detection pattern
OUTPUT=$([PRIMARY_CMD] [command] 2>&1)
if echo "$OUTPUT" | grep -q "[error pattern]"; then
    echo "Error 2 detected"
fi

# Resolution
[resolution steps]
```

---

## Best Practices

<!-- 10-15 best practices for using this tool effectively -->

### 1. [Best Practice Name]

**Do**:
```bash
# Good example
[command showing best practice]
```

**Don't**:
```bash
# Anti-pattern
[command showing what to avoid]
```

**Rationale**: [Explanation of why this matters]

---

### 2. [Best Practice Name]

[Follow same structure]

---

## Examples

<!-- Real-world examples that combine multiple concepts -->

### Example 1: [Scenario Name]

**Scenario**: [Description of what this example demonstrates]

**Prerequisites**:
- Prerequisite 1
- Prerequisite 2

**Implementation**:

```bash
#!/usr/bin/env bash
# example-1.sh

# Step 1: Setup
echo "Setting up environment..."
[setup commands]

# Step 2: Main logic
echo "Executing workflow..."
[main commands]

# Step 3: Verification
echo "Verifying results..."
[verification commands]

# Step 4: Cleanup
echo "Cleaning up..."
[cleanup commands]
```

**Expected Output**:
```
[example output]
```

**Agent Considerations**:
- When to use this pattern: [scenario]
- Potential issues: [pitfall]
- Alternatives: [other approaches]

---

### Example 2: [Scenario Name]

[Follow same structure]

---

## Troubleshooting

<!-- Common issues and their solutions -->

### Issue 1: [Problem Description]

**Symptoms**:
- Symptom 1
- Symptom 2

**Diagnosis**:
```bash
# Commands to diagnose the issue
[diagnostic commands]
```

**Solution**:
```bash
# Steps to resolve
[resolution commands]
```

**Prevention**:
- Prevention tip 1
- Prevention tip 2

---

### Issue 2: [Problem Description]

[Follow same structure]

---

## Resources

- **Official Documentation**: [HOMEPAGE]
- **Source Code**: [REPO_URL]
- **Issue Tracker**: [REPO_URL]/issues
- **Community**: [Forum/Slack/Discord URL]
- **Tutorials**: [Tutorial links]

---

## Validation Checklist

Use this checklist to validate your skill documentation:

**Structure**:
- [ ] All placeholder tokens replaced
- [ ] Table of contents matches sections
- [ ] Headers follow consistent hierarchy (H1 → H2 → H3)
- [ ] Code blocks have language tags

**Content Completeness**:
- [ ] Prerequisites clearly listed
- [ ] Installation steps for all platforms
- [ ] Configuration instructions provided
- [ ] Core concepts explained (3-5 concepts)
- [ ] Common workflows documented (5-7 workflows)
- [ ] Command reference comprehensive
- [ ] Error handling documented
- [ ] Best practices provided (10-15 practices)
- [ ] Real-world examples included (3-5 examples)
- [ ] Troubleshooting section populated

**Agent Usability**:
- [ ] Exit codes documented
- [ ] Error detection patterns provided
- [ ] Auto-resolution criteria defined
- [ ] Escalation scenarios identified
- [ ] Decision trees included
- [ ] Validation script provided

**Code Quality**:
- [ ] All code examples tested
- [ ] Commands use correct syntax
- [ ] Exit codes are accurate
- [ ] Error messages match tool output
- [ ] Scripts follow shell best practices

**Metadata**:
- [ ] Version number current
- [ ] Author attributed
- [ ] Last updated date accurate
- [ ] External links valid

**Testing**:
- [ ] Validation script runs successfully
- [ ] Installation instructions work on target platforms
- [ ] Configuration steps produce expected results
- [ ] Examples execute without errors
- [ ] Error scenarios reproducible

---

## Change Log

### Version [VERSION] ([DATE])
- Initial skill documentation created
- [Change 1]
- [Change 2]

---

*Generated from SKILL_TEMPLATE.md*
*Template Version: 1.0.0*
*Last Updated: 2025-12-30*
