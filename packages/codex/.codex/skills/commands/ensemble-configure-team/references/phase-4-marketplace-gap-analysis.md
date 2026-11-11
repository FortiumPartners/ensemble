### Phase 4: Marketplace Gap Analysis

Detect capability gaps and suggest marketplace plugins for installation.
Only executes when --team flag is present in $ARGUMENTS.

#### Step 4.1: Read Marketplace Catalog

Load and parse marketplace.json for available plugins

- Use Read tool to load marketplace.json from repository root
- If missing or malformed: log 'marketplace.json not found or invalid -- skipping gap analysis' and skip remaining steps in this phase
- Parse plugin entries into MARKETPLACE_CATALOG; exclude ensemble-full
- Set MARKETPLACE_AVAILABLE=true

#### Step 4.2: Installed Plugin Detection

Determine which marketplace plugins are already installed locally

- For each plugin in MARKETPLACE_CATALOG derive local path from source field
- Use Glob to check packages/<name>/ directory existence
- Build INSTALLED_PLUGINS set of currently available plugins
- Note which installed plugins provide agents vs skills

#### Step 4.3: Gap Analysis

Identify agent and skill gaps, match to marketplace plugins

- Identify agent gaps (domain default agent absent from AGENT_REGISTRY)
- Identify skill gaps (framework keywords present in tasks but corresponding skills/ directory absent)
- Three-tier matching: high-weight domain-to-tag, medium-weight keyword-to-tag, low-weight keyword-to-description
- Context-aware filtering: generic 'test' keyword alone must NOT trigger testing framework suggestions; require framework-specific keywords
- Consolidate multiple gaps pointing to same plugin into single suggestion with combined rationale
- Sort by relevance (agent gaps before skill gaps, then by task_count_benefiting descending)
- Build SUGGESTIONS list with plugin_name, description, gap_category, rationale, agents_provided, skills_provided, task_count_benefiting

#### Step 4.4: Suggestion Presentation and Installation

Present plugin suggestions to user and install approved plugins

- Check if AskUserQuestion tool is available; if not set NON_INTERACTIVE=true
- If NON_INTERACTIVE: log each suggestion as [INFO] and add all to DECLINED_PLUGINS
- If interactive: for each suggestion present yes/no prompt with plugin name, description, rationale
- Track APPROVED_PLUGINS and DECLINED_PLUGINS; do not re-prompt declined plugins
- For each approved plugin: run 'claude plugin install <name>' via Bash; track INSTALLED_DURING_RUN and FAILED_INSTALLS
- If plugins were installed, refresh AGENT_REGISTRY and SKILL_REGISTRY by re-running Phase 3 Step 1 in full (Steps 1a + 1b + 1c + 1d) AND Phase 3 Step 2 in full (Steps 2a + 2b + 2c): re-glob packages/*/agents/*.yaml, re-glob '~/.omp/plugins/node_modules/@*/*/agents/*.md' AND '~/.omp/plugins/node_modules/*/agents/*.md', re-glob '~/.omp/plugins/node_modules/@*/*/skills/*/SKILL.md' AND '~/.omp/plugins/node_modules/*/skills/*/SKILL.md', re-merge .claude/router-rules.json, and re-dedupe. ALSO re-run the symlink-safe find -L fallbacks ('find -L ~/.omp/plugins/node_modules -path "*/agents/*.md"' and 'find -L ~/.omp/plugins/node_modules -path "*/skills/*/SKILL.md"') so newly installed plugin symlinks are traversed even if OMP Glob refuses to cross them. Newly installed plugins expose runtime agent identifiers and skills that source-only scanning cannot see.
- Log summary: 'Marketplace analysis: N gaps identified, M plugins suggested, A approved, D declined, F failed'
