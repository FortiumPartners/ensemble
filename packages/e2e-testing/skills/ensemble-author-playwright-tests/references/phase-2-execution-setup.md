### Phase 2: Execution Setup

#### Step 2.1: Ask Headed or Headless — Once Per Session

REQ-013: before running the first test in the session, ask the QA
engineer (in conversation — this session is interactive via Claude
Code, so "asking" means posing the question directly, not a GUI
dialog) whether they want to watch the browser run (headed) or let
it run independently and report status back (headless). This is a
single, one-time choice for the whole session, made once here
before the first test run — do not re-ask per AC.

- Before running the first test this session, ask the QA engineer: "Would you like to watch these tests run (headed), or should I run them independently and report status back (headless)?"
- If they do not specify a preference, default to headed — this session is interactive by default
- Record the chosen mode for the remainder of the session; do not ask again for subsequent ACs/tests

#### Step 2.2: Resolve and Verify the QA Environment

TRD-013/TRD-026 (satisfies REQ-013): safety-critical — never let a
test run against anything but the designated QA environment.
TRD-034: reachable is not the same as "running this branch's
code" — a reachable-but-wrong per-branch or per-developer slot
produces failures indistinguishable from a real regression, so
confirm the URL is the right one, not just that it responds.

- Call resolveQaEnvUrl(opts) from $E2E_LIB/qa-env-guard.js with an explicit opts.url or opts.envVar naming where the target app's QA URL is configured — never hardcode or guess one
- Call checkQaEnvReachable(url) from the same module. If reachable is false, halt the session here: report the unreachable environment to the QA engineer and do not run, propose, or land any test this session — never fall back to another URL
- Ask the QA engineer to confirm: "Is <resolved URL> running the code from this session's branch/PR? If this repo uses per-branch or per-developer QA/staging deployments, provide the correct URL for this session instead." Never assume the configured default is correct just because it is reachable — if they provide a different URL, re-run the reachability check against it before proceeding
- If the consuming repo configures a base auth-state path at all, call deriveAuthStatePath(baseAuthStatePath, url) from $E2E_LIB/test-runner-mode.js to get an environment-scoped authStatePath — regardless of mode (TRD-037: many real harnesses reuse one stored auth state for every run, headed or headless alike); never reuse one static path across different resolved URLs, since a stored auth state is scoped to the origin it was captured against
- Carry the resolved URL forward as targetEnv, and (when derived) the environment-scoped authStatePath, for every delegation request in the REQ loop below

#### Step 2.3: Offer a Follow-Along Pause (Headed Only) — Once Per Session

A headed run at full speed is hard to follow, so the QA engineer can
ask for a pause after each browser action: Playwright's own `SlowMo`
launch option (the Run request's `slowMoMs`, resolved by
test-runner-mode.js's resolveRunConfig), never text inserted into
the test source. Asked after the QA environment is verified, so a
session that halts there never prompts for it.

- If the mode recorded in step 1 is headless: skip this step entirely — no human is watching, so never ask and never set slowMoMs (validateRunRequest and resolveRunConfig both reject it in headless mode)
- If the mode is headed, ask once: "Add a 1-second pause after each browser action so you can follow along? (yes / no / or a different pause, e.g. 2s or 500ms)"
- No preference, or "yes": slowMoMs = 1000. A duration: convert it to whole milliseconds (a positive integer). "no": leave slowMoMs unset. If the answer is not a usable duration, say so and ask once more rather than guessing
- Record the result for the remainder of the session; do not re-ask per AC. Carry slowMoMs forward (when set) for every Run-stage delegation request in Phase 4

#### Step 2.4: Ensure the Screenshot Helper

Every confirmed test opens an EvidenceCapture scope, so its end state is screenshotted on a pass and on a failure.

- Call resolveEvidenceDir(process.env) from $E2E_LIB/evidence-capture.js; carry it forward as evidenceDir for every Run request
- If the consuming E2E test project has no EvidenceCapture.cs, write renderEvidenceHelper({namespace}) from the same module into it and tell the QA engineer it lands in this PR — confirmed tests call it, so it must exist before the first Run
