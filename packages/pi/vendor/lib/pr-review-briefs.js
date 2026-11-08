'use strict';

/**
 * Agent briefs for the pr-review-cycle skill (plan section 3G: "generate each agent's
 * brief from a template -- a claim plus file paths and nothing the orchestrator
 * concluded").
 *
 * Why this exists: on #234 the first three verifiers of one candidate were handed a
 * hand-written brief that carried the orchestrator's own reading, voted 3/3 real, and
 * were wrong; three fresh verifiers that recomputed the spans voted 0/3. A brief that
 * is pasted by an LLM can say anything. A brief rendered from a closed set of inputs
 * can only say what those inputs are.
 *
 * The policy prose of each brief stays maintainer-editable plain markdown in
 * `packages/development/skills/pr-review-cycle/templates/<role>-brief.md`; this module
 * owns only the part a maintainer must not be able to widen by accident or an
 * orchestrator on purpose: which inputs exist, of what shape, and that the template and
 * the inputs agree.
 *
 * The module is PURE: no file reads, no shell, no network. The template text is a
 * parameter; `pr-review-brief-files.js` is the module that finds and reads the files.
 *
 * Guarantees, each of them refusing (throwing) rather than degrading:
 *   - an unknown role is refused;
 *   - an input the role does not declare is refused, by name. That is the guard that
 *     keeps another verifier's vote, a verdict, the reviewer that raised a finding or
 *     the orchestrator's conclusion out of a brief as a field: there is no field they
 *     can arrive in;
 *   - a declared input that is absent, or of the wrong shape, is refused. Every input
 *     but the verifier's `claim` is a token from a closed grammar (a slice id, a
 *     `<sha>..<sha>` range, a repository-relative path or `path:line`, an absolute
 *     path for the prepared diff and snapshot) with no room for whitespace or
 *     parentheses, so a note cannot ride in a slice, range or path: it is refused;
 *   - a template whose placeholders are not exactly the role's declared inputs is
 *     refused (an undeclared placeholder would render as nothing, and a declared one
 *     the template forgot would silently drop an input, for a verifier the claim it
 *     was asked to settle);
 *   - a value that contains placeholder syntax is refused, and substitution is a
 *     single pass, so an input is never itself read as a template;
 *   - the verifier's free-text `claim` is the ONE input that is prose, so it is the one
 *     input a grammar cannot close. It is refused when it contains a word from
 *     VERIFIER_LEAKS (vote, verdict, orchestrator, conclusion, another verifier, ...).
 *     That screen is a backstop for the obvious leak, not a proof: a claim that
 *     avoids those words is accepted, and no program can prove a sentence carries no
 *     opinion. The claim is the finding's own failure mode and evidence, so what it
 *     says is the finding's; the structural guarantees above are the ones that hold.
 *
 * A refused INPUT is a `BriefRefusal`: the message is the one reported to a person, and `input` and `kind` (REFUSAL_KINDS:
 * leak, claim, location, path, other) are for a caller that must route the refusal. The review runner keeps a candidate
 * whose verifier brief is refused, unverified and named, so a refusal here is the one place that says why. The renderer's
 * rules do not move to make a run complete: a claim that names a verdict is refused even when it is about code, and the
 * claim must be reworded by whoever wrote it. `claimRules` states those rules to the reviewers who write claims.
 *
 * TRD/plan reference: docs/plans/pr-review-speedup-plan.md section 3G.
 */

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** `{{name}}`; a name is a camelCase identifier. */
const PLACEHOLDER = /\{\{([^{}]*)\}\}/g;
const PLACEHOLDER_NAME = /^[A-Za-z][A-Za-z0-9]*$/;

// Control characters other than the newline and tab a prose input may carry.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_OR_NEWLINE = /[\u0000-\u001F\u007F]/;

const MAX_LINE = 1024;
const MAX_PROSE = 4000;
const MAX_MINUTES = 24 * 60;

/**
 * What a verifier's claim must not read as. Each entry is `[pattern, what, words]`: a way an orchestrator or a sibling
 * verifier's reading leaks into the text a fresh verifier is meant to judge for itself, and `words`, each of which the
 * pattern matches: the strings a reviewer is told to avoid (`claimRules`), so what a reviewer reads and what the screen
 * refuses cannot drift apart (a test refuses every one of them, and every entry must have some).
 */
const VERIFIER_LEAKS = Object.freeze([
  [/\bverdicts?\b/i, 'a verdict', Object.freeze(['verdict'])],
  [/\bvot(?:e|es|ed|ing)\b/i, 'a vote', Object.freeze(['vote', 'voted', 'voting'])],
  [/\bnot-real\b/i, 'a verdict', Object.freeze(['not-real'])],
  [/\babstain(?:s|ed)?\b/i, 'a verdict', Object.freeze(['abstain'])],
  [/\borchestrat(?:or|ors|ed|ion)\b/i, 'the orchestrator', Object.freeze(['orchestrator', 'orchestration'])],
  [/\bconclu(?:de|des|ded|sion|sions)\b/i, 'a conclusion', Object.freeze(['conclude', 'conclusion'])],
  [/\b(?:other|another|previous|earlier|prior|first|second|third) verifiers?\b/i, 'another verifier', Object.freeze(['another verifier', 'first verifier'])],
  [/\bverifiers? (?:said|found|confirmed|agreed|disagreed|judged)\b/i, 'another verifier', Object.freeze(['verifiers said', 'verifier confirmed'])],
  [/\b(?:confirmed|judged|ruled|deemed|found|established|verified) (?:to be |as )?real\b/i, 'a conclusion', Object.freeze(['confirmed real', 'judged to be real'])],
  [/\b(?:is|are) (?:a |an )?(?:real|confirmed) (?:bug|issue|finding|defect|problem)\b/i, 'a conclusion', Object.freeze(['is a real bug', 'is a confirmed defect'])],
]);

/**
 * Why a brief refuses one input, as a closed vocabulary a caller can act on without reading the message:
 *   leak      a claim that reads as a vote, a verdict, the orchestrator, a conclusion or another verifier (`VERIFIER_LEAKS`);
 *   claim     a claim that is not acceptable text: empty, over `MAX_PROSE`, with control characters or with placeholder braces;
 *   location  a cited location that is not `file:line` or `file:start-end`;
 *   path      a path outside the closed path grammar (whitespace, parentheses, quotes, "..");
 *   other     anything else (an input no candidate owns: a range, a lens, a minutes count, a prepared directory).
 */
const REFUSAL_KINDS = Object.freeze(['leak', 'claim', 'location', 'path', 'other']);

/** The kind an input's refusal has unless its check names one: what the input is. */
const INPUT_KIND = Object.freeze({ claim: 'claim', location: 'location', paths: 'path', snapshotDir: 'path', diffPath: 'path', ruleFiles: 'path', sensitivePaths: 'path' });

/**
 * A brief refused an input. The message is the one the renderer has always thrown; `input` names the refused input and
 * `kind` (one of REFUSAL_KINDS) says why, so a caller that must record or route a refusal (the review runner keeps the
 * candidate unverified and names the kind) never parses the message. An unknown role, an undeclared or missing input and a
 * bad template stay plain Errors: they are the caller's or the installation's fault, not the input's.
 */
class BriefRefusal extends Error {
  constructor(message, { role, input, kind }) {
    super(message);
    this.name = 'BriefRefusal';
    this.role = role;
    this.input = input;
    this.kind = kind;
  }
}

// ---------------------------------------------------------------------------
// Input kinds
// ---------------------------------------------------------------------------

/** A single line of text. Every grammar below starts here. */
function checkLine(value, name) {
  if (typeof value !== 'string' || value.trim() === '') return `'${name}' must be a non-empty string`;
  if (CONTROL_OR_NEWLINE.test(value)) return `'${name}' must be a single line without control characters`;
  if (value.length > MAX_LINE) return `'${name}' is longer than ${MAX_LINE} characters`;
  return null;
}

/**
 * Every input except the claim is a token from a closed grammar, never a line of prose:
 * a slice id, an object id range, a repository path, a `path:line`. A grammar that has
 * no room for whitespace or parentheses has no room for a sentence, so a vote, a verdict
 * or an orchestrator's note cannot ride in a path or a range. (A word list could not
 * promise that; the grammar does.) The cost is deliberate: a path that falls outside the
 * grammar is refused, never rendered.
 */
const PATH_SEGMENT = /^[\p{L}\p{N}._@+~=[\]-]+$/u;
const OBJECT_ID = '(?:[0-9a-f]{40}|[0-9a-f]{64})';
const RANGE = new RegExp(`^${OBJECT_ID}\\.\\.${OBJECT_ID}$`, 'i');
const MAX_PATH = 512;

const GRAMMAR_HINT = 'letters, digits and . _ @ + ~ = [ ] - in "/"-separated segments, no whitespace, parentheses, quotes or ".."';

/** A repository-relative path, or (`absolute`) a path that may start with one "/". */
function checkPathToken(value, name, { absolute }) {
  const problem = checkLine(value, name);
  if (problem) return problem;
  if (value.length > MAX_PATH) return `'${name}' is longer than ${MAX_PATH} characters`;
  const body = absolute && value.startsWith('/') ? value.slice(1) : value;
  const segments = body.split('/');
  const ok = segments.every((segment) => PATH_SEGMENT.test(segment) && segment !== '.' && segment !== '..');
  if (!ok) {
    return `'${name}' must be ${absolute ? 'a path' : 'a repository-relative path'} (${GRAMMAR_HINT}); a brief carries paths, not prose`;
  }
  return null;
}

const checkRepoPath = (value, name) => checkPathToken(value, name, { absolute: false });

const IDENTITY = (value) => value;

/** A repository-relative path: what `paths`, `ruleFiles` and `sensitivePaths` list. */
const REPO_PATH = Object.freeze({ check: checkRepoPath, render: IDENTITY });

/** A path to a prepared file or directory outside the repository: `diffPath`, `snapshotDir`. */
const FILE_PATH = Object.freeze({
  check: (value, name) => checkPathToken(value, name, { absolute: true }),
  render: IDENTITY,
});

/**
 * A slice id: `whole-pr`, `(repository root)` or the area directory the `slices` call named, each with the `~N` the
 * size-driven split adds when it cuts one of them into several (`whole-pr~2`, `packages/x~1`; a merged `mixed~1`
 * is a plain path token). `~` is a path character, so only the root's parenthesised name needs its own case.
 */
const SLICE_ID = Object.freeze({
  check(value, name) {
    if (value === 'whole-pr' || value === '(repository root)' || /^\(repository root\)~[1-9][0-9]{0,3}$/.test(value)) return null;
    const problem = checkRepoPath(value, name);
    return problem && `${problem} (or "whole-pr", or "(repository root)", each optionally followed by "~" and a number)`;
  },
  render: IDENTITY,
});

/** A reviewer's lens: a lower-case token (`correctness`, `security`, `docs-mirrors`), never a sentence. */
const LENS = Object.freeze({
  check(value, name) {
    if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(value)) {
      return `'${name}' must be a lens token: lower case letters, digits and "-", at most 32 characters`;
    }
    return null;
  },
  render: IDENTITY,
});

/** `<baseSha>..<headSha>`, each a full object id (what the `scope` call returns). */
const COMMIT_RANGE = Object.freeze({
  check(value, name) {
    const problem = checkLine(value, name);
    if (problem) return problem;
    if (!RANGE.test(value)) return `'${name}' must be '<baseSha>..<headSha>', each a full 40 or 64 digit hexadecimal object id`;
    return null;
  },
  render: IDENTITY,
});

/**
 * `path:line` or `path:start-end`, the path in the repository-path grammar. A check answers `null`, a message (its kind is
 * the input's: `INPUT_KIND`) or `{kind, message}` when it knows better: here, a path that is outside the grammar is a
 * `path` refusal, not a `location` one.
 */
const LOCATION = Object.freeze({
  check(value, name) {
    const problem = checkLine(value, name);
    if (problem) return problem;
    const match = /^(.+):(\d+)(?:-(\d+))?$/.exec(value);
    if (!match) return `'${name}' must be 'file:line' or 'file:start-end'`;
    const pathProblem = checkRepoPath(match[1], name);
    return pathProblem === null ? null : { kind: 'path', message: pathProblem };
  },
  render: IDENTITY,
});

/** A list of tokens, rendered as a markdown list; each entry is checked by `item`. */
function listKind(item, { allowEmpty }) {
  return Object.freeze({
    check(value, name) {
      if (!Array.isArray(value)) return `'${name}' must be an array of strings`;
      if (value.length === 0 && !allowEmpty) return `'${name}' must not be empty`;
      for (let i = 0; i < value.length; i += 1) {
        const problem = item.check(value[i], `${name}[${i}]`);
        if (problem) return problem;
      }
      return null;
    },
    render: (value) => (value.length === 0 ? '- (none)' : value.map((entry) => `- ${entry}`).join('\n')),
  });
}

/** A positive whole number of minutes. */
const MINUTES = Object.freeze({
  check(value, name) {
    if (!Number.isInteger(value) || value < 1 || value > MAX_MINUTES) {
      return `'${name}' must be a whole number of minutes between 1 and ${MAX_MINUTES}`;
    }
    return null;
  },
  render: (value) => String(value),
});

/** Free text the author of the claim wrote: multi-line allowed, bounded, and screened. */
function proseKind(leaks) {
  return Object.freeze({
    check(value, name) {
      if (typeof value !== 'string' || value.trim() === '') return `'${name}' must be a non-empty string`;
      if (CONTROL.test(value)) return `'${name}' must not contain control characters`;
      if (value.length > MAX_PROSE) return `'${name}' is longer than ${MAX_PROSE} characters`;
      for (const [pattern, what] of leaks) {
        const hit = pattern.exec(value);
        if (hit) return { kind: 'leak', message: `'${name}' reads as ${what} ("${hit[0]}"); a brief carries the claim and nothing anyone concluded about it` };
      }
      return null;
    },
    render: (value) => value,
  });
}

const PATHS = listKind(REPO_PATH, { allowEmpty: false });
const MAYBE_PATHS = listKind(REPO_PATH, { allowEmpty: true });

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/**
 * Every brief role: the template file that holds its policy text, and the COMPLETE set
 * of inputs it accepts. This table is the allowlist; nothing outside it can reach a
 * rendered brief. Add an input here and in the template together, or rendering refuses.
 */
const ROLES = Object.freeze({
  reviewer: Object.freeze({
    template: 'reviewer-brief.md',
    inputs: Object.freeze({
      slice: SLICE_ID,
      lens: LENS,
      timeboxMinutes: MINUTES,
      paths: PATHS,
      diffPath: FILE_PATH,
      snapshotDir: FILE_PATH,
    }),
  }),
  // the whole-range reader of a light run cut into several slices (`lib/pr-review-run.js`): the same rules as `reviewer`, framed for the
  // whole range (no slice id: its scope is every changed path)
  'range-reviewer': Object.freeze({
    template: 'range-reviewer-brief.md',
    inputs: Object.freeze({
      lens: LENS,
      timeboxMinutes: MINUTES,
      paths: PATHS,
      diffPath: FILE_PATH,
      snapshotDir: FILE_PATH,
    }),
  }),
  verifier: Object.freeze({
    template: 'verifier-brief.md',
    inputs: Object.freeze({
      claim: proseKind(VERIFIER_LEAKS),
      location: LOCATION,
      paths: PATHS,
      snapshotDir: FILE_PATH,
    }),
  }),
  classifier: Object.freeze({
    template: 'classifier-brief.md',
    inputs: Object.freeze({
      range: COMMIT_RANGE,
      diffPath: FILE_PATH,
    }),
  }),
  'second-assessor': Object.freeze({
    template: 'second-assessor-brief.md',
    inputs: Object.freeze({
      range: COMMIT_RANGE,
      diffPath: FILE_PATH,
      ruleFiles: MAYBE_PATHS,
      sensitivePaths: MAYBE_PATHS,
    }),
  }),
  'security-lane': Object.freeze({
    template: 'security-lane-brief.md',
    inputs: Object.freeze({
      range: COMMIT_RANGE,
      diffPath: FILE_PATH,
      snapshotDir: FILE_PATH,
      sensitivePaths: MAYBE_PATHS,
    }),
  }),
});

const roleNames = () => Object.keys(ROLES).join(', ');

function roleSpec(role) {
  if (typeof role !== 'string' || !hasOwn(ROLES, role)) {
    throw new Error(`unknown brief role ${JSON.stringify(role)} (expected one of ${roleNames()})`);
  }
  return ROLES[role];
}

/**
 * The placeholder names a template uses, in first-seen order. Throws on anything that
 * looks like placeholder syntax but is not a well-formed `{{name}}`: a typo in a
 * template must not render as literal braces.
 */
function placeholdersOf(templateText) {
  const names = [];
  if (/\{\{\{|\}\}\}/.test(templateText)) throw new Error('template has a malformed placeholder: three braces in a row');
  for (const match of templateText.matchAll(PLACEHOLDER)) {
    const name = match[1];
    if (!PLACEHOLDER_NAME.test(name)) throw new Error(`template has a malformed placeholder ${JSON.stringify(match[0])}`);
    if (!names.includes(name)) names.push(name);
  }
  if (/\{\{|\}\}/.test(templateText.replace(PLACEHOLDER, ''))) {
    throw new Error('template has an unbalanced "{{" or "}}"');
  }
  return names;
}

/** Throws unless the template's placeholders are exactly the role's declared inputs. */
function checkTemplate(role, templateText) {
  const spec = roleSpec(role);
  if (typeof templateText !== 'string' || templateText === '') {
    throw new Error(`the ${role} brief template is missing or empty`);
  }
  const declared = Object.keys(spec.inputs);
  const used = placeholdersOf(templateText);
  const undeclared = used.filter((name) => !declared.includes(name));
  if (undeclared.length > 0) {
    throw new Error(`the ${role} brief template uses placeholder(s) no input provides: ${undeclared.join(', ')}`);
  }
  const unused = declared.filter((name) => !used.includes(name));
  if (unused.length > 0) {
    throw new Error(`the ${role} brief template never shows declared input(s): ${unused.join(', ')}`);
  }
}

/**
 * The strings a claim must avoid and the form it must take, for whoever writes a claim a verifier will be briefed with: a
 * reviewer's output contract states them (`pr-review-run-support.js`). Derived from the same tables the renderer checks with,
 * so a reviewer is never told one thing and refused for another.
 *
 * @returns {{refusedWords:string[], maxClaimLength:number, pathGrammar:string}}
 */
function claimRules() {
  return Object.freeze({
    refusedWords: Object.freeze(VERIFIER_LEAKS.flatMap((entry) => entry[2])),
    maxClaimLength: MAX_PROSE,
    pathGrammar: GRAMMAR_HINT,
  });
}

/**
 * Render one brief.
 *
 * @param {string} role          one of `ROLES`
 * @param {object} vars          exactly the inputs the role declares
 * @param {string} templateText  the text of the role's template file
 * @returns {string}
 * @throws a BriefRefusal (`input`, `kind`) when an input is unacceptable; a plain Error when the role, the template or the
 *   shape of the inputs is (see the file comment)
 */
function renderBrief(role, vars, templateText) {
  const spec = roleSpec(role);
  if (!isObject(vars)) throw new Error(`the ${role} brief needs its inputs as an object`);
  checkTemplate(role, templateText);

  const declared = Object.keys(spec.inputs);
  const unknown = Object.keys(vars).filter((name) => !declared.includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `the ${role} brief does not accept ${unknown.map((name) => `'${name}'`).join(', ')} (accepted: ${declared.join(', ')})`
    );
  }
  for (const name of declared) {
    if (!hasOwn(vars, name)) throw new Error(`the ${role} brief requires input '${name}'`);
  }

  const rendered = {};
  for (const name of declared) {
    const kind = spec.inputs[name];
    const problem = kind.check(vars[name], name);
    if (problem) {
      const { kind: why = INPUT_KIND[name] || 'other', message } = typeof problem === 'string' ? { message: problem } : problem;
      throw new BriefRefusal(`the ${role} brief refuses its input: ${message}`, { role, input: name, kind: why });
    }
    const text = kind.render(vars[name]);
    if (/\{\{|\}\}/.test(text)) {
      throw new BriefRefusal(`the ${role} brief refuses input '${name}': it contains "{{" or "}}"`, { role, input: name, kind: INPUT_KIND[name] || 'other' });
    }
    rendered[name] = text;
  }

  // One pass over the template: a substituted value is never scanned again.
  return templateText.replace(PLACEHOLDER, (_match, name) => rendered[name]);
}

module.exports = {
  ROLES,
  VERIFIER_LEAKS,
  REFUSAL_KINDS,
  BriefRefusal,
  renderBrief,
  claimRules,
  checkTemplate,
  placeholdersOf,
};
