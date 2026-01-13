1.3 Technology Stack

- note that we will use node for hook executable that we build, unless they can be written with straightforward bash/sh scripts; python to be avoided, except for router hook which is already written (note that we will refactor this at some later date)
- Also note that for code formatter, we have a predefined table we will use

1.4 Integration Points

- Our initial secondary LLM (when we implement) will use OpenAI, gpt-5.2

2.1 Two-Layer Architecture

- For packages, let's allow the following: router, permitter, reviewer (secondary LLM review), skills, core; restructure existing ensemble folders as needed (note we will COPY existing ensemble files; this will be a new repo)

**Plugin Architecture Details (Existing Ensemble Structure)**:

- Update accordingly (per above comments)

2.2 Component Architecture

- Update accordingly (per above comments)

2.4 Hook System Architecture

- Formatter hook can be a shell script that routes to the correct tool based on the language; no need for it to be node
- It does not appear (as of this point in the document, at least) that the table of formatters from the PRD was properly reflected here

2.5.2 Governance Files

- We don't specify project router-rules (from the router); this is part of the governance files, and they need to live somewhere in the .claude/ folder structure

3.2 Artifact Commands

- /create-prd and /create-trd should have very clear instructions to start from the current ensembles commands and document templates; TRD will need to updated based on the planning and other structural requirements we have; the details here are nowhere near sufficient
- /implement-trd should be BASED ON /implement-trd-enhanced, but will need to be reworked for our orchestration; the details here are nowhere near sufficient
- Looking for explicit instructions on starting from existing commands and document templates - copy them from ensemble and then iterate on them

3.3.1 /implement-trd (F4.2)

- CRITICAL NOTE: It's also not clear in the TRD that all commands and agents are .md prompts, with commands sometimes using helper shell scripts. This needs to be captured, and the TRD clearly structured around this... command "implementation" in most cases is writing a well-formed prompt. At the same time, the design should clearly state if/when helper shell scripts will be used, and ensure the command (prompt) incorporates them properly
  - For example, the execute_task_cycle code is structured as a function, but the implement-trd command is not code, it's an orchestration prompt. this key point seems to be missed in the TRD
  - Similarly, ensure that it's clearly documented (and reflected in the TRD) that subagents are similarly prompts
  - In the PRD, a URL was provided with potential prompt templates -- ensure this is in the TRD, along with the URL reference to the claude subagent documentation (for best practices)

3.5 Hook Specifications

- Let's note that if a hook CAN be easily written in bash/sh script, that is acceptable as well
- Router will also need to copy generate router rules (both global and project specific) commands

3.5.3 Formatter Hook (F6.3)

- We state the formatter hook will be implemented in node, but then show a table of different tools -- this seems inconsistent. it seems the best approach is for the tool to be a shell script that routes to the correct formatter
- We will further need to ensure the correct formatter(s) is/are identified, installed, and configured as part of init-project

3.5.4 Status Hook (F6.4)

- I'm not sure we can actually build a hook to do this -- it would need to be able to review what's been done and update implement.json. VALIDATE THIS -- how can we actually implement this? Can we do this, or can we merely confirm that implement.json has been updated (from when we started)?

3.5.5 Learning Hook (F6.5)

- Should git add other changed files

3.6.2 Subagent Frontmatter Template

- All subagents should use opus
- I feel several frontmatter fields are missing in the yaml template (we omit tools on purpose, but there are several others in the spec that should be here) -- see the PRD for  the reference URL
- Use the following existing ensemble subagents as starting points:
- product-manager -> product-manager-orchestrator
- technical-architect -> tech-lead-orchestrator
- spec-planner -> n/a (new)
- frontend-implementer -> frontend-developer
- backend-implementer -> backend-developer
- mobile-implementer -> mobile-developer
- verify-app -> (new)
- code-simplifier (new)
- code-reviewer -> code-reviewer
- devops-engineer -> infrastructure-developer
- cicd-specialist -> deployment-orchestrator

These are merely "examples" - we can also use online examples from the link provided in PRD; we should construct each agent as a fresh prompt based on best practice; the above are merely to be used as reference

4. Master Task List

4.2 Phase 1: Core Plugin and Vendored Runtime

TRD-P002  Implement skill library loader - what does this mean? there's no loading to be done; the claude plugin framework handles skill loading

TRD-P003  Create agent template system - this is not necessary; we are not "templating" agents in this way. we simply have the base agent template (.md file); we copy it to the project, and then the LLM updates it as necessary. 

TRD-P004  Implement command template system - commands are not modified at all; the .md files are simply copied to the project .claude/commands folder; there is nothing to be done here

TRD-P005  Create hook bundling mechanism - this mechanism already exists in the claude plugin framework; review documentation to understand how it works (and/or see existing ensemble implementation)

TRD-R002  Implement tech stack detection - must be absolutely clear this is via an LLM prompt; there should be no code for this, the init-project command does this entirely by scanning the codebase. That most likely looks at package.json, requirements.txt, etc., but this is 100% an LLM function

TRD-R003  Create stack.md generator - again, this is done via LLM - not a script or executable or any such thing

TRD-R004  Create constitution.md template - review existing ensemble init-project; the current mechanism and template/structure for generating constitution.md is perfectly fine

TRD-R006  Implement skill selection logic - LLM should review stack.md against a list of skills to determine matches; then copy the relevant skill folders over -- simple implementation. Give clear guidance on this

TRD-R007  Create settings.json generator - assess if we need a GENERATOR, or simply a settings.json that we deploy to the project. what variability are we expecting?

TRD-C001  Create init-project shell scaffolder - is this not a duplicate of TRD-R001? would init-project not just use that? not sure what the distinction is here, but there should be significant reuse

TRD-C002  Implement repository analysis - ensure this is LLM function

TRD-C003  Create subagent customization logic - this is an LLM function; ensure that's clearly documented. we should absolutely not waste time trying to write code to do this; the init-project command will do the modification of each agent according to its prompt

TRD-H001  Copy Permitter hook from legacy - this is an exact copy, but may need to do some integration into new plugin (and the vendored version)

TRD-H002  Copy Router hook from legacy - this is an exact copy, but may need to do some integration into new plugin (and the vendored version)

A0 - Subagent Templates - just ensure we note that there's nothing "templatized" about these -- they should all be constructed as fully formed, ready-to-work agents

TRD-C101  Create /create-prd command - start from existing version, modify as needed

TRD-C103  Create /refine-prd command - start from existing version, modify as needed

TRD-C104  Create /create-trd command - start from existing version, modify as needed

TRD-C105  Implement execution plan generation - ensure create-trd runs in plan mode

TRD-C108  Create /refine-trd command - start from existing version, modify as needed

TRD-C201  Create implement-trd command shell - not sure why we're calling it a "shell"; should be based off existing "implement-trd-enhanced", modified for our vendored version, reduced agent set, and modified process (and TRD format)

C2 - /implement-trd Command

- TRD parser is not a script or anything like that -- don't like the implication that it is. this is a detailed prompt, nothing more
- Assess if, for claude, an XML prompt is helpful for a command to keep it structured/ordered. 
- The "delegation" requirements are critical, but fundamentally come down to how well we write/structure this prompt -- I believe? 
- Key point is that this entire command is a complex prompt; see agentos or speckit (open source github repos) for examples of complex implementation commands
- Should support running /implement-trd (no arguments) or "--continue" to continue the session
- When ready, should attempt to auto-dispatch to claude code on the web

TRD-C302  Implement Constitution change proposal - this is just part of the update-project command; the proposal will come via the command, there is nothing specific to "implement" other than the command prompt;  unless the purpose of this task is to document that it must be part of the prompt

TRD-C303  Implement stack.md update proposal - same as above; unless the purpose of this task is to document that it must be part of the prompt

C4 - Wiggum Mode - review the wiggum plugin (official and unofficial) and ensure we're following the same pattern

T0 - Testing

- Let's be very clear what our test exercises are:
  - React+TS Simple Todo list app that allows you to create a checklist and then check items off (very simply, just showcases UI + backend)
  - FastAPI example that does something very simple (make something up, but it should be straightforward); the purpose is just to go through the process of building a FastAPI example
  - Node.js express example - a simple full-stack example; perhaps we do our todo list with a front end and backend together

 6.1 Testing Requirements

- Note that testing of commands, subagents, skills will be quite limited
- The primary test mechanism will be to launch claude with command-line arguments:
  - --prompt to pass the desired prompt, --session-id to pass in a session-id, --dangerously-skip-permissions to allow a command to run uninterrupted; can then review session logs to see if agents/skills/hooks were used -- this is quite clunky though
  - Much testing will need to be manually done by the user
  - 