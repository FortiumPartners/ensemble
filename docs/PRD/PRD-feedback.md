1.7 Consolidated Artifact Table

- Clarify status location. Should this go in docs/TRD/TRDname/state? some very clear way to tie status to the TRD, and it should either be in docs/ or .claude.

2.3 User Journey

- Just want to note (here or elsewhere) that in many instances the INPUT to create-prd is the feature or user story from a requirements platform like Jira, Linear, AZDO. And in fact in many instances a skill or MCP may be used to pull in that story directly. This is the most common (tho not only) link between those tools and this framework.

F2: Vendored Runtime Generation

- Should have an explicit feature (F2.6) for hooks, specifying that hooks are copied. Hooks are a combination of the settings.json file (this is covered in F2.5) and shell scripts and/or prompts (handled in F2.6). There should be no modification of these, they just need to be copied.
- Note SOMEWHERE in the init-project command that the router hook has a command, generate-project-router-rules that needs to be run at the end of init-project (ideally init-project kicks it off automatically, or fully embeds it)
- Subagents will have template prompts delivered with the plugin; we start from those, maintain the template format, but tailor the subagent to the project, its tech stack, and its constitution

**Subagent Roster**:

- Add a app-debugger subagent to the roster; it will be tailored to fixing verification issues (and also for resolving bugs without a full spec), and producing a writeup

**Subagent Design Principles**:

- Ensure we reference this in subagent best practices: [Create custom subagents - Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- Include this site to reference when it's time to build out subagent prompts: [Claude Code Agents](https://subagents.cc/). Note we want to improve on these, but they can be starting points.

**Artifact Locations**:

- Not sure where best to note this, but want this instruction captured: IF we pulled or have a story number, issue number, etc., than the feature name we use for our PRD/TRD should be that identifier. IE if we have Jira story "VFM-1234", that should be our feature name for the PRD/TRD/etc., we don't need to get any fancier. Branches can be "VFM-1234-Phase1", etc.

F3: Artifact Commands

- Use the ultrathink keyword in the artifact generation commands to further semantically prompt claude to think through these; even if the model's likely already have "Thinking mode" enabled

**F4.1 /create-trd with Integrated Planning**:

- While we want to use the existing implement-trd-enhanced from the old version of Ensemble as our baseline, we DON'T want estimated timelines and "sprints"  in our plan. Phases, tasks, claude sessions, parallelization, offloading ABSOLUTELY, but timing no, until we can demonstrate an ability to do this reliably.
- If we're going to have a "rationale for eliminating separate /plan-trd" we need more context. This can be a callout (NOT FOR TRD notation) -- something noting that in design we considered and then abandoned a particular concept. But there's no reason to propagate this down to the TRD (and maybe further) if we're not going to do it. At the same time, a discussion of what we're trying to accomplish, why we considered separating out the planning stage, etc. might be very helpful.
- I previously made a comment on branch names. The idea that branch names can be FEATURE_NAME-CLAUDE SESSION NAME is ideal.
- For parallel execution, it should be noted that offloaded sessions will run on their own copy of the repository/worktree, so the planning stage can go beyond just file touches in understanding parallelization and look to actual potential conflicts.

**F4.2 /implement-trd Details**:

- Automated gates with bounded retries (max 2-3 attempts per gate) - let's expand on this. I want a maximum of three retries solving the same problem. But if we go into the verify step, solve a problem, and then move on to another problem, the counter should restart. Not sure how we account for that.
- Pausing for user decision when stuck is when not in wiggum mode

**Staged Execution Loop Diagram**:

- If Verify fails, and we go to "Debug + Retry" -- is this a concrete step, or are we really just routing back to Implement? IE do we launch the debug subagent or the implement subagent? I'm inclined toward a debug subagent, derived from the current ensemble's deep-debugger subagent. It seems like a debugger is well suited to resolving a particular problem, vs. an implementor that's suited to implementing a new feature. The debugger must get ALL relevant skills in the tech stack though, which could be quite context heavy. At the same time, it's job is not to TEST its fix but to analyze and make a fix.
- Implementation Complete doesn't have an update artifacts phase - we want to ensure our artifacts are regularly updated. The artifact update should almost always happen in parallel to the next phase/step starting.

**F6.1 Permitter Hook Details**:

CRITICAL IMPLEMENTATION NOTE: The permitter is already implemented in the legacy Ensemble implementation. We should COPY THE EXISTING IMPLEMENTATION EXACTLY, adjusting only for installation location and copying/vendoring it into the project. The executable should be migrated into Ensemble vNext with no change AT ALL, at least initially.

The existing implementation is working well and has been thoroughly tested.

**F6.2 Router Hook Details**:

CRITICAL IMPLEMENTATION NOTE: The router is already implemented in the legacy Ensemble implementation. We should COPY THE EXISTING IMPLEMENTATION EXACTLY, adjusting only for installation location and copying/vendoring it into the project. The executable should be migrated into Ensemble vNext with no change AT ALL, at least initially.

The existing implementation is working well and has been thoroughly tested.

**F6.3 Formatter Hook Details**:

Specify this standard set:

| Language / Files            | Extensions / Globs                                           | Formatter              | Install Path (Typical)                               | Fix Command (Pre-commit)         |
| --------------------------- | ------------------------------------------------------------ | ---------------------- | ---------------------------------------------------- | -------------------------------- |
| **Web / Frontend / Config** | `js,jsx,ts,tsx,mjs,cjs,html,css,scss,less,json,jsonc,yaml,yml,md,mdx,graphql,gql` | **Prettier**           | `npm install -g prettier`                            | `prettier --write <files>`       |
| **Python**                  | `py`                                                         | **Ruff formatter**     | `pip install ruff`                                   | `ruff format <files>`            |
| **Go**                      | `go`                                                         | **goimports**          | `go install golang.org/x/tools/cmd/goimports@latest` | `goimports -w <files>`           |
| **Terraform / HCL**         | `tf,tfvars`                                                  | **terraform fmt**      | `brew install terraform` / official binary           | `terraform fmt <files>`          |
| **Shell / Bash**            | `sh`                                                         | **shfmt**              | `brew install shfmt` / `apt install shfmt`           | `shfmt -w <files>`               |
| **C / C++ / Obj-C**         | `c,cc,cpp,cxx,h,hpp,m,mm`                                    | **clang-format**       | `brew install clang-format` / LLVM packages          | `clang-format -i <files>`        |
| **Rust**                    | `rs`                                                         | **rustfmt**            | `rustup component add rustfmt`                       | `rustfmt <files>`                |
| **Java**                    | `java`                                                       | **google-java-format** | `brew install google-java-format`                    | `google-java-format -i <files>`  |
| **Kotlin**                  | `kt,kts`                                                     | **ktlint**             | `brew install ktlint`                                | `ktlint -F <files>`              |
| **C# / .NET**               | `cs`                                                         | **CSharpier**          | `dotnet tool install -g csharpier`                   | `dotnet csharpier <files>`       |
| **Swift**                   | `swift`                                                      | **swift-format**       | `brew install swift-format`                          | `swift-format format -i <files>` |
| **Lua**                     | `lua`                                                        | **StyLua**             | `brew install stylua` / prebuilt binary              | `stylua <files>`                 |

User can override this, but these should be the defaults. Init project should set up AND INSTALL (if not already available) the correct prettier based on the project's tech stack. It should fully configure it and have it ready to go at the project level. 

Understanding Wiggum Mode vs Completion Gates

- Note that in the wiggum loop, we don't just feed back the prompt but also the session outputs, etc. (research and ensure this is documented properly -- what gets fed back int)
- implement-trd should ALWAYS define "Done" (i.e. done is defined as the status block meeting a certain "done" criteria). THAT is what we use as the promise. It's calculated and displayed whenever we run implement-trd; but if we're in wiggum mode, the command looks at the output and if the status is not 100% "done", runs again up to X times (default 5?) until we get there. This allows the actual acceptance criteria baked into the TRD to be applied, and the loop looks to the command to decide what the definition of done is on a more granular basis.
- Our status tracker should, by task and phase, document where we are in the implement -> verify -> simplify -> verify -> update artifacts cycle

**Remote/Web Offload Pattern**:

- implement-trd should support a Phase argument or claude session argument. In this way, if the TRD planning step identified (for example) 10 phases/claude sessions to split the implementation across, we can  say "& /implement-trd --phase 3 --wiggum" to have that session or phase run autonomously in claude on the web
- We can pull when done (via /teleport) or the completed work should be committed and pushed to the repo, and we monitor via git
- Do we explicitly need a sessionend hook that checks CLAUDE_CODE_REMOTE env to see that it MUST commit and push its work? Is that needed or does claude have a way to handle this? Please research

F9: Completion Gates with Bounded Retries

- Unclear why we need the completion gates? What do they actually do? The TRD should define acceptance criteria?

4.3 Future Features (P3 - Nice to Have)

- Removed this section entirely -- not relevant

TECHNICAL REQUIREMENTS:

TR5.1  Implementation status tracked in `.trd-state/` directory - Review directory per prior note

TR5.3  Status includes task status, commits, coverage, checkpoints - Review what truly needs to go in the status. Status of tasks relative to the implement->verify->simplify->verify cycle, as well as commit status for sure. Unsure if coverage belongs in there or not, please consider and advise.

TR5.4 - this requirement previously said status files were gitignored, but we need a way for parallel execution sessions to track status and know what's going on.

**Status Tracking Schema** (`.trd-state/<feature-name>/implement.json`): - validate this against current TRD status file; ensure this format truly makes sense.

**Remote Branch Naming Convention**: validate against prior comments

TR7.2  Playwright MCP server supported for E2E testing - evaluate if we'd be better with claude browser extension for E2E testing

5.8 File Structure - update if .trd-state is correct, per prior comments

5.9 Vendored Component Testing Strategy

- the "simple development exercises" are ok, but want to ensure they're kept very simple... we do NOT want these to become overly complicated, truly just a very simple baselining development exercise. 

5.10.1 Checkpoint-Based Recovery

- Note that for a session crash, our primary resumption mechanism should be a claude code session resume.
- KEY ADDITION - in our status file, for active work we should be capturing the claude code session ID when starting work, and then explicitly remove the session ID when ending. that way, we can use claude --resume (or equivalent) to resume broken sessions. I believe there are ways (pleas research) to resume subagents using an approach like this. So the subagent would register its session ID (for each phase - implementation, verification, simplification, etc.) and be able to resume by session

#### 5.10.3 Network Failure Handling

**For Secondary LLM Review**:

- The CLI tool that handles secondary review shouldhave retry built in. If it fails after a certain number of retries, it simply reports back that it failed, and the user moves on. Let's not overcomplicate this.

5.11 Version Compatibility

- This should be a P2 requirement; it's highly unlikely to be a major issue, as claude code updates automatically.

6. Acceptance Criteria

- Update these as required based on the revised/rewritten document. Reexamine all acceptance criteria.

