### Phase 5: Constitution Gate

#### Step 5.1: Constitution Gate

Pre-save check against the project constitution

- Before writing anything, check the in-memory draft against docs/standards/constitution.md (fall back to .specify/memory/constitution.md; if neither exists HALT with CONSTITUTION_CONFIG_ERROR). On a violation HALT in every mode, including --foreman: list each failing article id, the failing draft section, the finding, and a remediation hint; do not create docs/TRD/, save the TRD, or print a next step. Under --foreman also write the failure report to FOREMAN_ARTIFACT_PATH. On pass, record `Constitution compliance: passed` in the TRD frontmatter.
- If $ARGUMENTS contains '--parser-tables': there is no Design Readiness Gate in this mode, so run this gate after architecture, task drafts and Foreman compatibility checks exist in memory, before creating docs/TRD/ or printing the foreman sling prd next step. Violations are non-bypassable unconditionally: do not offer any proceed anyway, override, skip, soft-confirmation or default-proceed path. On failure do not print the foreman sling prd next-step output.
