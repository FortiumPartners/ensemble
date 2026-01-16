# Act Local CI - Comprehensive Reference

**Production Patterns and Advanced Configuration**

## Overview

The act-local-ci skill enables local testing of GitHub Actions workflows using [nektos/act](https://github.com/nektos/act). This eliminates the push-wait-fail-fix cycle by running CI pipelines on your local machine before committing changes.

## Architecture

```
act-local-ci/
├── SKILL.md                  # Quick reference (<5KB)
├── REFERENCE.md              # This file
├── scripts/
│   └── run-act.js           # Wrapper script with enhanced output
└── templates/
    └── act-config.yaml      # Default configuration template
```

## Installation

### macOS

```bash
# Homebrew (recommended)
brew install act

# Binary download
curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash
```

### Linux

```bash
# Script install
curl -s https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash

# Arch Linux
yay -S act

# Nix
nix-env -iA nixpkgs.act
```

### Windows

```powershell
# Chocolatey
choco install act-cli

# Scoop
scoop install act

# WinGet
winget install nektos.act
```

### Docker Requirement

Act requires Docker to be installed and running:

```bash
# Verify Docker
docker --version
docker ps  # Should not error

# Start Docker if needed (varies by OS)
# macOS: Open Docker Desktop
# Linux: sudo systemctl start docker
```

## Command Reference

### Basic Commands

```bash
# List all workflows and jobs
act -l

# Run default event (push)
act

# Run specific event
act push
act pull_request
act workflow_dispatch
act schedule

# Dry run (preview without executing)
act --dryrun
act -n
```

### Job Selection

```bash
# Run specific job
act -j <job-name>
act -j build
act -j test
act -j deploy

# Run specific workflow file
act -W .github/workflows/test.yml
act -W .github/workflows/release.yml

# Run jobs matching pattern
act -j 'test-*'
```

### Event Configuration

```bash
# Push event with branch context
act push --eventpath event.json

# Pull request event
cat > pr-event.json << 'EOF'
{
  "pull_request": {
    "number": 1,
    "head": {
      "ref": "feature-branch",
      "sha": "abc123"
    },
    "base": {
      "ref": "main"
    }
  }
}
EOF
act pull_request --eventpath pr-event.json

# Workflow dispatch with inputs
cat > dispatch-event.json << 'EOF'
{
  "inputs": {
    "environment": "staging",
    "version": "1.2.3"
  }
}
EOF
act workflow_dispatch --eventpath dispatch-event.json
```

### Runner Images

```bash
# Use specific platform image
act -P ubuntu-latest=catthehacker/ubuntu:act-latest
act -P ubuntu-22.04=catthehacker/ubuntu:act-22.04
act -P ubuntu-20.04=catthehacker/ubuntu:act-20.04

# Use micro image (smaller, faster, less compatible)
act -P ubuntu-latest=node:16-buster-slim

# Use full image (larger, most compatible)
act -P ubuntu-latest=catthehacker/ubuntu:full-latest
```

### Image Size Comparison

| Image Type | Size | Compatibility | Best For |
|------------|------|---------------|----------|
| Micro | ~200MB | Limited | Simple Node.js workflows |
| Medium | ~500MB | Good | Most workflows |
| Large | ~2GB | Very Good | Complex builds |
| Full | ~9GB | Excellent | Maximum compatibility |

## Secrets and Environment Variables

### Passing Secrets

```bash
# Inline secret
act -s MY_SECRET=value

# Multiple secrets
act -s TOKEN=abc123 -s API_KEY=xyz789

# From environment
export GITHUB_TOKEN=ghp_xxx
act -s GITHUB_TOKEN

# From file
cat > .secrets << 'EOF'
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
NPM_TOKEN=npm_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
EOF
act --secret-file .secrets
```

### Environment Variables

```bash
# Inline env var
act --env MY_VAR=value

# From file
cat > .env << 'EOF'
NODE_ENV=test
CI=true
CUSTOM_VAR=value
EOF
act --env-file .env
```

### GitHub Token

```bash
# Required for API calls, package downloads, etc.
# Create a Personal Access Token at:
# https://github.com/settings/tokens

act -s GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## Configuration Files

### .actrc (Project Root)

```bash
# Default runner images
-P ubuntu-latest=catthehacker/ubuntu:act-latest
-P ubuntu-22.04=catthehacker/ubuntu:act-22.04
-P ubuntu-20.04=catthehacker/ubuntu:act-20.04

# Default secrets file
--secret-file .secrets

# Default env file
--env-file .env

# Artifact storage
--artifact-server-path /tmp/artifacts

# Reuse containers between runs
--reuse
```

### ~/.actrc (User Global)

```bash
# Global defaults that apply to all projects
-P ubuntu-latest=catthehacker/ubuntu:act-latest

# Default container architecture
--container-architecture linux/amd64
```

### Docker Resources

```bash
# Increase container resources
act --container-options "--memory=4g --cpus=2"

# Use host network
act --container-options "--network=host"
```

## Service Containers

### Database Services

```yaml
# .github/workflows/test.yml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: testdb
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7
        ports:
          - 6379:6379
```

```bash
# Run with services
act -j test --container-options "--network=host"
```

### Docker Compose Alternative

For complex service dependencies, use Docker Compose:

```yaml
# docker-compose.ci.yml
version: '3.8'
services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_USER: test
      POSTGRES_PASSWORD: test
      POSTGRES_DB: testdb
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U test"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7
    ports:
      - "6379:6379"
```

```bash
# Start services first
docker-compose -f docker-compose.ci.yml up -d

# Wait for health
sleep 10

# Run act with host network
act -j test --container-options "--network=host"

# Cleanup
docker-compose -f docker-compose.ci.yml down
```

## Advanced Patterns

### Pre-Push Validation Script

```bash
#!/bin/bash
# scripts/pre-push-ci.sh

set -e

echo "Running local CI validation..."

# List available jobs
echo "Available workflows:"
act -l

# Run lint job
echo "Running lint..."
act -j lint --quiet

# Run test job
echo "Running tests..."
act -j test

# Run build job
echo "Running build..."
act -j build

echo "All CI checks passed locally!"
```

### Git Hook Integration

```bash
# .git/hooks/pre-push
#!/bin/bash

echo "Running local CI checks before push..."

# Quick validation
act -j test --dryrun 2>&1 | head -20

# Ask for confirmation
read -p "Run full CI locally? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    act -j test
    if [ $? -ne 0 ]; then
        echo "CI failed! Fix issues before pushing."
        exit 1
    fi
fi

exit 0
```

### Matrix Build Testing

```yaml
# .github/workflows/test.yml
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, ubuntu-22.04]
        node: [18, 20, 22]
        include:
          - os: ubuntu-latest
            node: 22
            coverage: true
```

```bash
# Run all matrix combinations
act -j test

# Run specific combination
act -j test --matrix os:ubuntu-latest --matrix node:20

# Run with specific input
act -j test --input node-version=20
```

### Workflow Debugging

```bash
# Verbose output
act -v

# Very verbose output
act -vv

# Keep containers running for inspection
act --reuse

# Shell into running container
docker exec -it act-<job-name> /bin/bash

# Inspect container logs
docker logs act-<job-name>
```

## Troubleshooting

### Common Issues

#### 1. Docker Not Running

```
Error: Cannot connect to the Docker daemon
```

**Solution**:
```bash
# macOS
open -a Docker

# Linux
sudo systemctl start docker
sudo usermod -aG docker $USER  # Add user to docker group
```

#### 2. Missing Secrets

```
Error: Context access might be invalid: secrets.GITHUB_TOKEN
```

**Solution**:
```bash
# Pass required secrets
act -s GITHUB_TOKEN=$GITHUB_TOKEN

# Or use secrets file
echo "GITHUB_TOKEN=ghp_xxx" > .secrets
act --secret-file .secrets
```

#### 3. actions/checkout Fails

```
Error: Unable to find repository
```

**Solution**:
```bash
# Use local checkout
# Add to workflow:
- uses: actions/checkout@v4
  with:
    path: .

# Or bind mount current directory
act --bind
```

#### 4. Resource Constraints

```
Error: OOM killed or container timeout
```

**Solution**:
```bash
# Increase Docker resources
act --container-options "--memory=8g --cpus=4"

# Use smaller image
act -P ubuntu-latest=node:18-slim
```

#### 5. Apple Silicon (M1/M2/M3)

```
Error: exec format error
```

**Solution**:
```bash
# Force x86_64 architecture
act --container-architecture linux/amd64

# Or use arm64 images
act -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

#### 6. Unsupported Actions

Some actions don't work locally:
- `github/codeql-action` - Requires GitHub infrastructure
- `actions/upload-artifact` - Limited local support
- `actions/deploy-pages` - GitHub Pages specific

**Workaround**:
```yaml
# Conditional step for local testing
- name: Upload artifact
  if: ${{ !env.ACT }}
  uses: actions/upload-artifact@v4
```

### Performance Optimization

```bash
# Reuse containers between runs
act --reuse

# Use local cache
act --cache-server-path ~/.act-cache

# Pull images in advance
docker pull catthehacker/ubuntu:act-latest

# Use bind mount for faster file access
act --bind
```

## Integration with Ensemble Agents

### Pre-Release Validation

```javascript
// In release-agent workflow
Task({
  subagent_type: "test-runner",
  prompt: `Run local CI validation using act:
    1. Execute: act -l (list workflows)
    2. Execute: act -j test (run test job)
    3. Execute: act -j build (run build job)
    Report results and any failures.`
});
```

### CI/CD Debugging

```javascript
// In deep-debugger workflow
Task({
  subagent_type: "deep-debugger",
  prompt: `Debug failing GitHub Actions workflow locally:
    1. Run: act -j <failing-job> -v
    2. Analyze verbose output
    3. Identify root cause
    4. Suggest fix`
});
```

### Infrastructure Validation

```javascript
// In infrastructure-developer workflow
Task({
  subagent_type: "infrastructure-developer",
  prompt: `Validate CI/CD changes locally before push:
    1. Check .github/workflows/ for syntax
    2. Run: act --dryrun (validate without executing)
    3. Run: act -j deploy (test deploy job)
    Report validation status.`
});
```

## Best Practices

### 1. Always Test Locally First

```bash
# Before pushing any workflow changes
act -n  # Dry run first
act     # Then full run
git push
```

### 2. Use .actrc for Consistency

```bash
# Team-shared settings in .actrc
-P ubuntu-latest=catthehacker/ubuntu:act-latest
--secret-file .secrets.example
```

### 3. Gitignore Secrets

```gitignore
# .gitignore
.secrets
.env.local
*.secret
```

### 4. Document Required Secrets

```bash
# .secrets.example (checked into repo)
# Copy to .secrets and fill in values
GITHUB_TOKEN=<your-github-token>
NPM_TOKEN=<your-npm-token>
```

### 5. Test Matrix Subsets

```bash
# Don't test all combinations locally
act -j test --matrix node:20  # Test primary version only
```

### 6. Use Conditional Steps

```yaml
# Skip expensive steps locally
- name: Deploy to production
  if: ${{ github.event_name != 'act' && !env.ACT }}
  run: ./deploy.sh
```

## Related Skills

- **changelog-generator**: Generate changelogs from conventional commits
- **smoke-test-runner**: Execute smoke tests before release
- **release-agent**: Automated release orchestration

## References

- [nektos/act GitHub](https://github.com/nektos/act)
- [act Documentation](https://nektosact.com/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [catthehacker Docker Images](https://github.com/catthehacker/virtual-environments)
