/**
 * Pure structural checks for the `--foreman` behavior of new-feature.yaml and
 * feature.yaml (TRD-2026-1d3e0dd6). Every function takes a parsed YAML document
 * and returns a list of violation strings (empty = holds). Nothing here reads or
 * writes files, so the same checks can be run against deliberately broken clones
 * to prove they can fail (TRD-011-TEST).
 */

const FOREMAN_RE = /FOREMAN|--foreman/;
// A prompt to, or a wait on, a human.
const ASK_RE = /AskUserQuestion|\bask(?:s|ed)? the user\b|explicit (?:approval|confirmation)|\bvia ask\b/i;
// Says that no question is put to the user.
const NO_PROMPT_RE = /without asking|asks? nothing|no (?:question|prompt)|never asks?|not asked|is not asked/i;
const STAGE_SKILLS = ['create-prd', 'refine-prd', 'create-trd', 'refine-trd', 'implement-trd-beads'];

function step(doc, phaseName, order) {
  const phase = (doc.workflow.phases || []).find((p) => p.name === phaseName);
  return phase && (phase.steps || []).find((s) => s.order === order);
}

function actions(s) {
  return (s && s.actions) || [];
}

const foremanActions = (s) => actions(s).filter((a) => FOREMAN_RE.test(a));
const first = (list, re) => list.find((a) => re.test(a));

function checkNewFeature(doc) {
  const out = {};
  const v = (group, cond, msg) => {
    (out[group] = out[group] || []);
    if (!cond) out[group].push(msg);
  };

  // REQ-001
  const param = (doc.parameters || []).find((p) => p.name === 'foreman');
  v('parameter', !!param, 'no `foreman` parameter');
  v('parameter', param && param.type === 'boolean' && param.default === false,
    '`foreman` must be boolean with default false');
  const e1 = step(doc, 'Entry Point Resolution', 1);
  const def = first(foremanActions(e1), /FOREMAN/);
  v('flagRule', !!def && /--foreman/.test(def) && /supported/i.test(def),
    'Entry Step 1 must define FOREMAN from --foreman and call it a supported flag');
  v('flagRule', !!def && /--skip-refine/.test(def) && /never|not/i.test(def),
    'Entry Step 1 must state --foreman is not an equivalent of --skip-refine');

  // REQ-002 forwarding + auto-accept
  const x1 = step(doc, 'Execute Stage', 1);
  const fwd = foremanActions(x1);
  for (const skill of STAGE_SKILLS) {
    v('forwarding', fwd.some((a) => new RegExp(`${skill}(?: --plan)? --foreman\\b`).test(a)),
      `Execute Stage 1 must forward --foreman to ${skill} under FOREMAN`);
  }
  v('forwarding', fwd.some((a) => /--plan/.test(a)), 'forwarding to implement-trd-beads must keep --plan');
  v('forwarding', fwd.some((a) => /not (?:true|set|present)|absent|otherwise/i.test(a)),
    'forwarding must state --foreman is not added when FOREMAN is not true');
  v('forwarding', fwd.some((a) => /FOREMAN_\*|FOREMAN_TASK_TITLE/.test(a)),
    'must state the FOREMAN_* environment contract is untouched');
  const x2 = step(doc, 'Execute Stage', 2);
  const acc = first(foremanActions(x2), /success/i);
  v('autoAccept', !!acc && NO_PROMPT_RE.test(acc) && /decline|edit/i.test(acc),
    'Execute Stage 2 must record success without asking and offer no decline/edit path under FOREMAN');

  // REQ-003 retry
  const e4 = step(doc, 'Entry Point Resolution', 4);
  const retry = first(foremanActions(e4), /retr/i);
  v('retry', !!retry && NO_PROMPT_RE.test(retry) && /once/i.test(retry),
    'Entry Step 4 must retry the parked stage once, without asking, under FOREMAN');
  v('retry', actions(e4).some((a) => ASK_RE.test(a) && !FOREMAN_RE.test(a)),
    'the interactive retry question must remain for FOREMAN != true');
  const x3 = step(doc, 'Execute Stage', 3);
  v('retry', foremanActions(x3).length === 0 && actions(x3).some((a) => /do not retry/i.test(a)),
    'Execute Stage 3 (failure) must stay unchanged: no FOREMAN text and still forbid in-invocation retry');

  // REQ-004 implementation approval
  const x5 = step(doc, 'Execute Stage', 5);
  const grant = first(foremanActions(x5), /implementationApprovedAt/);
  v('implApproval', !!grant && NO_PROMPT_RE.test(grant), 'implementation approval must be granted without asking under FOREMAN');
  v('implApproval', !!grant && /(?:single|one|same)[^.]*mutate\(\)/i.test(grant),
    'implementationApprovedAt and the stage advance must be one mutate() call');
  v('implApproval', !!grant && /--foreman policy/.test(grant) && /approval_wait/.test(grant),
    'the grant must be recorded with a --foreman policy detail and kind approval_wait');
  v('implApproval', actions(x5).some((a) => ASK_RE.test(a) && !FOREMAN_RE.test(a)),
    'the human approval question must remain for FOREMAN != true');
  const s1 = step(doc, 'Stage Resolution', 1);
  v('implApproval', foremanActions(s1).some((a) => /implementation_approval/.test(a) && /re-?grant/i.test(a)),
    'the staleness check must re-grant through the recorded path under FOREMAN');

  // REQ-005 PR approval
  const x6 = step(doc, 'Execute Stage', 6);
  const pr = first(foremanActions(x6), /prApprovedAt/);
  v('prApproval', !!pr && NO_PROMPT_RE.test(pr) && /pr_create/.test(pr), 'PR approval must be granted without asking and advance to pr_create');
  v('prApproval', !!pr && /never in the same[^.]*implementationApprovedAt/i.test(pr),
    'prApprovedAt must be set in a call distinct from implementationApprovedAt');
  v('prApproval', foremanActions(x6).some((a) => /no PR provider available/.test(a) && /done/.test(a)),
    'isAvailable() false must still record "no PR provider available" and end at done');
  const x7 = step(doc, 'Execute Stage', 7);
  v('prApproval', foremanActions(x7).length === 0 && actions(x7).some((a) => /prApprovedAt/.test(a) && /null/.test(a)),
    'PR creation must keep the null-prApprovedAt denial and carry no FOREMAN text');

  // REQ-006 abandon
  const e6 = step(doc, 'Entry Point Resolution', 6);
  const ab = first(foremanActions(e6), /abandon\(/);
  v('abandon', !!ab && NO_PROMPT_RE.test(ab), 'Entry Step 6 must call abandon() without asking under FOREMAN');
  v('abandon', actions(e6).some((a) => ASK_RE.test(a) && !FOREMAN_RE.test(a)),
    'the abandon confirmation must remain for FOREMAN != true');
  v('abandon', actions(e6).some((a) => /nothing to abandon/.test(a) && !FOREMAN_RE.test(a)),
    'the no-active-run path must stay unchanged');

  // REQ-007 events
  const e5 = step(doc, 'Entry Point Resolution', 5);
  const ev = actions(e5);
  const evIdx = ev.findIndex((a) => FOREMAN_RE.test(a) && /human/i.test(a));
  v('event', evIdx >= 0 && /no run|create no/i.test(ev[evIdx]), 'Entry Step 5 must refuse (no run created) under FOREMAN');
  const valIdx = ev.findIndex((a) => /validateEventPayload/.test(a));
  v('event', valIdx >= 0 && evIdx > valIdx, 'validation must precede the foreman refusal');
  v('event', /default-deny/i.test(ev[0] || '') && !FOREMAN_RE.test(ev[0] || ''), 'default-deny action must stay first and unchanged');

  // REQ-009 hard stops
  const inv = (doc.constraints || []).find((c) => FOREMAN_RE.test(c));
  v('invariants', !!inv && /RUN_ALREADY_ACTIVE/.test(inv) && /read-only/i.test(inv) && /retry/i.test(inv),
    'constraints must state --foreman never bypasses RUN_ALREADY_ACTIVE, read-only --status, or the no-retry rule');
  const statusAction = first(actions(e4), /^If `status` is true/);
  v('invariants', !!statusAction && !FOREMAN_RE.test(statusAction), 'the --status action must not be altered by FOREMAN');
  for (const n of [2, 3]) {
    v('invariants', foremanActions(step(doc, 'Entry Point Resolution', n)).length === 0,
      `Entry Step ${n} (exclusivity) must carry no FOREMAN text`);
  }

  // Guard: every step that asks a human also has a foreman branch.
  out.guard = [];
  for (const phase of doc.workflow.phases || []) {
    for (const s of phase.steps || []) {
      if (actions(s).some((a) => ASK_RE.test(a)) && foremanActions(s).length === 0) {
        out.guard.push(`unguarded question in "${phase.name}" step ${s.order} (${s.title})`);
      }
    }
  }
  return out;
}

function checkFrontDoor(doc) {
  const out = { extraction: [], insertion: [], ordinaryText: [] };
  const s = step(doc, 'Dispatch', 1);
  const acts = actions(s);
  const validation = acts.findIndex((a) => /Command input validation at the boundary/.test(a));
  const extract = acts.findIndex((a) => FOREMAN_RE.test(a) && /remov/i.test(a) && /immediately after the keyword/i.test(a));
  if (extract < 0) out.extraction.push('no action removes a leading --foreman token immediately after the keyword');
  if (extract >= 0 && validation >= 0 && extract > validation) out.extraction.push('extraction must come before the validation action');
  const lastBuild = acts.findIndex((a) => /^keyword `abandon`/.test(a));
  const run = acts.findIndex((a) => /^For whichever keyword matched/.test(a));
  const insert = acts.findIndex((a) => FOREMAN_RE.test(a) && /\/ensemble:new-feature/.test(a) && /immediately after/i.test(a) && /insert/i.test(a));
  if (insert < 0) out.insertion.push('no action inserts --foreman immediately after /ensemble:new-feature');
  if (insert >= 0 && !(insert > lastBuild && insert < run)) out.insertion.push('insertion must come after the invocation is built and before it is run');
  if (!acts.some((a) => FOREMAN_RE.test(a) && /ordinary text/i.test(a))) out.ordinaryText.push('must state --foreman elsewhere is ordinary text');
  return out;
}

const flat = (r) => Object.values(r).reduce((n, list) => n + list.length, 0);

module.exports = { checkNewFeature, checkFrontDoor, flat, step, actions, FOREMAN_RE, ASK_RE, STAGE_SKILLS };
