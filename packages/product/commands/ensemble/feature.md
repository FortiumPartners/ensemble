---
name: ensemble:feature
description: Orchestrate the full idea-to-plan pipeline: create-prd, refine-prd, create-trd, refine-trd, implement-trd-beads --plan
version: 1.0.0
category: planning
last-updated: 2026-03-15
argument-hint: <description> [--skip-refine]
model: high
---
<!-- DO NOT EDIT - Generated from feature.yaml -->
<!-- To modify this file, edit the YAML source and run: npm run generate -->


Orchestrate the complete idea-to-plan pipeline as a single command. Runs five commands
in strict sequence: (1) create-prd, (2) refine-prd, (3) create-trd, (4) refine-trd,
(5) implement-trd-beads --plan. Each step completes before the next begins. Refinement
steps (2 and 4) pause for user input via AskUserQuestion. The --skip-refine flag
bypasses both refinement steps for an uninterrupted run. Planning only -- no code
is executed. Terminates with a handoff message showing how to start implementation.

## Workflow

### Phase 1: Argument Parsing

**1. Parse Arguments and Set Variables**
   Parse $ARGUMENTS and initialize pipeline variables.

1. If $ARGUMENTS is empty or blank, print the following and exit without running any pipeline step:
   Usage: /ensemble:feature <description> [--skip-refine]

2. Scan $ARGUMENTS for the --skip-refine token. If found, set SKIP_REFINE=true and remove the token from the remaining text. If not found, set SKIP_REFINE=false.

3. Scan the remaining text for any other tokens that begin with --. If any unknown flag is found, print the following and exit without running any pipeline step:
   Error: Unknown flag '<flag>'. Only --skip-refine is supported.
   Usage: /ensemble:feature <description> [--skip-refine]

4. Set FEATURE_DESCRIPTION to the remaining argument text after removing --skip-refine if it was present. Preserve the description verbatim -- no transformation, truncation, or summarization.


### Phase 2: Pipeline Execution

**1. Step 1 - create-prd**
   Print: [Step 1/5] create-prd...

Invoke /ensemble:create-prd with FEATURE_DESCRIPTION as the argument. Pass the description verbatim with no modification.

After completion, use Glob to find the most recently modified .md file in docs/PRD/. Store the path as PRD_PATH.

If the command fails or no PRD file is found in docs/PRD/, print the following and halt the pipeline immediately:
[Step 1/5] create-prd failed. Pipeline halted.

Error details:
<error output from the failed step>

To retry from this step, run:
  /ensemble:create-prd <FEATURE_DESCRIPTION>


**2. Step 2 - refine-prd**
   Check SKIP_REFINE.

If SKIP_REFINE=true: Print [Step 2/5] refine-prd... (skipped) and proceed to Step 3. Do not invoke refine-prd.

If SKIP_REFINE=false: Print [Step 2/5] refine-prd... (pausing for your input) and invoke /ensemble:refine-prd. The refine-prd command internally uses AskUserQuestion to conduct the interview -- no special pause mechanism is needed here. Wait for refine-prd to complete before proceeding.

If refine-prd fails, print the following and halt the pipeline immediately:
[Step 2/5] refine-prd failed. Pipeline halted.

Error details:
<error output from the failed step>

To retry from this step, run:
  /ensemble:refine-prd


**3. Step 3 - create-trd**
   Print: [Step 3/5] create-trd...

Invoke /ensemble:create-trd with PRD_PATH (captured from Step 1) as the argument. Passing the explicit PRD path ensures create-trd reads the correct PRD and not a stale or unrelated document in docs/PRD/.

After completion, use Glob to find the most recently modified .md file in docs/TRD/. Store the path as TRD_PATH.

If the command fails or no TRD file is found in docs/TRD/, print the following and halt the pipeline immediately:
[Step 3/5] create-trd failed. Pipeline halted.

Error details:
<error output from the failed step>

To retry from this step, run:
  /ensemble:create-trd <PRD_PATH>


**4. Step 4 - refine-trd**
   Check SKIP_REFINE.

If SKIP_REFINE=true: Print [Step 4/5] refine-trd... (skipped) and proceed to Step 5. Do not invoke refine-trd.

If SKIP_REFINE=false: Print [Step 4/5] refine-trd... (pausing for your input) and invoke /ensemble:refine-trd. The refine-trd command internally uses AskUserQuestion to conduct the interview -- no special pause mechanism is needed here. Wait for refine-trd to complete before proceeding.

If refine-trd fails, print the following and halt the pipeline immediately:
[Step 4/5] refine-trd failed. Pipeline halted.

Error details:
<error output from the failed step>

To retry from this step, run:
  /ensemble:refine-trd


**5. Step 5 - implement-trd-beads --plan**
   Print: [Step 5/5] implement-trd-beads --plan...

Invoke /ensemble:implement-trd-beads with TRD_PATH (captured from Step 3) and the --plan flag. The --plan flag MUST be hardcoded. User arguments from $ARGUMENTS MUST NOT be forwarded to this command. Never invoke implement-trd-beads with --execute.

If the command fails, print the following and halt the pipeline immediately:
[Step 5/5] implement-trd-beads --plan failed. Pipeline halted.

Error details:
<error output from the failed step>

To retry from this step, run:
  /ensemble:implement-trd-beads --plan


### Phase 3: Handoff

**1. Present Handoff Message**
   This step only executes if all five pipeline steps completed without error. If any step halted the pipeline, this phase is never reached.

Print the following handoff message. Ensure a blank line appears above and below the message block for visual separation:

Pipeline complete. Your implementation plan is ready.

  PRD: <PRD_PATH>
  TRD: <TRD_PATH>

To start implementation:

  In this window:    /ensemble:implement-trd-beads <TRD_PATH> --execute
  In a new window:   ntm

Where <PRD_PATH> and <TRD_PATH> are the actual file paths captured from Steps 1 and 3 respectively.

After printing the handoff message, stop. Do not proceed with any implementation work.


## Expected Output

**Format:** Pipeline orchestration result

**Structure:**
- **Progress Indicators**: Progress line printed before each of the 5 pipeline steps
- **PRD File**: PRD document created at docs/PRD/ by the create-prd step
- **TRD File**: TRD document created at docs/TRD/ by the create-trd step
- **Bead Hierarchy**: Bead hierarchy created by implement-trd-beads --plan (planning only, no code executed)
- **Handoff Message**: Final message showing PRD path, TRD path, and execution options for starting implementation

## Usage

```
/ensemble:feature <description> [--skip-refine]
```
