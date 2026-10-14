'use strict';

/**
 * Head-bound remote review evaluator.
 *
 * Collects reviews, inline comments, threads and check runs for a PR and
 * determines whether a configured bot's review is actually bound to the exact
 * current head commit AND in a terminal reviewed state. NO side effects, NO
 * network calls -- the caller supplies the already-fetched facts.
 *
 * FAIL CLOSED. Every kind of item and every state it can be in has a defined
 * verdict, and only a recognised good value counts: a missing, null,
 * malformed, wrong-typed or unrecognised value is never read as "fine", it
 * keeps the phase pending with a named reason. REMOTE_REVIEW_COMPLETE is
 * returned only when no reason was recorded AND at least one item bound to the
 * current head counted as evidence.
 *
 * Verdicts, for items authored by a configured bot (anyone else's items are
 * ignored). A review or check run whose author cannot be read -- missing, blank
 * or not text -- might be a bot's: it can object, as below, but it is never
 * evidence and nothing supersedes it; in any other state it is inert, as is a
 * comment with no readable author:
 *
 *   review     The state must be APPROVED, COMMENTED, CHANGES_REQUESTED,
 *              DISMISSED or PENDING (letter case ignored; CHANGES_REQUESTED
 *              alone also tolerates "changes requested" spellings, a leniency
 *              that can only ever block). Any other state -- a missing,
 *              blank or non-text one included -- blocks, whatever head the
 *              review is bound to.
 *              A reviewer's standing follows GitHub: their LATEST APPROVED,
 *              CHANGES_REQUESTED or DISMISSED review decides, and a later
 *              COMMENTED or PENDING review does not supersede it. It is judged
 *              over ALL of the bot's reviews whatever head they are bound to (an
 *              unsuperseded CHANGES_REQUESTED from an older head still blocks),
 *              and again over the reviews bound to the current head alone (an
 *              approval of an older head never supersedes a request on the
 *              current one). A COMMENTED review, or an APPROVED review that is
 *              the standing one, bound to the current head is evidence.
 *   check run  Evidence only when bound to the current head AND its conclusion
 *              is success or neutral. failure, cancelled, timed_out and
 *              action_required block, and so do a missing conclusion (still
 *              running) and any unknown one; skipped and stale neither count
 *              nor block. A check run bound to another commit says nothing
 *              about this head, but one with no commit identity cannot be shown
 *              to, so it is judged like one on the head -- except that it can
 *              never be evidence.
 *   comment    Evidence when bound to the current head. A comment never
 *              blocks, and can never override a block from a review, a check
 *              run or a thread.
 *   thread     Resolved only when `resolved` is exactly true; any other entry,
 *              a null or non-object one included, is unresolved and blocks.
 *
 * The facts themselves are validated the same way: a non-object facts value, a
 * missing headSha, a missing or malformed botLogins, any of reviews, comments,
 * threads and checkRuns that is not an array (an empty array is how "none" is
 * said), an entry that is not an object, and an `access` that is supplied but
 * is not exactly { ok: boolean } each keep the phase pending.
 */

function hasValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

/** The five states GitHub gives a review. */
const REVIEW_STATES = new Set(['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED', 'DISMISSED', 'PENDING']);

/** The states that decide a reviewer's standing; a later COMMENTED or PENDING review never supersedes one. */
const DECISIVE_STATES = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']);

/**
 * A review's state, upper-cased, when it is one of the five; otherwise null -- unrecognised, missing and non-text alike.
 * The one leniency runs in the blocking direction only: GitHub's CHANGES_REQUESTED also arrives as "changes requested"
 * or "ChangesRequested", and spelled any of those ways it still requests changes. No spelling of a good state is
 * accepted beyond its letter case.
 */
function reviewState(review) {
  if (typeof review.state !== 'string') return null;
  const state = review.state.toUpperCase();
  if (REVIEW_STATES.has(state)) return state;
  return state.replace(/[^A-Z]/g, '') === 'CHANGESREQUESTED' ? 'CHANGES_REQUESTED' : null;
}

/** A review's submission time in ms, or null when it is absent or unparseable -- a missing time is never guessed. */
function submittedTime(review) {
  if (typeof review.submittedAt !== 'string' || review.submittedAt.trim() === '') return null;
  const time = Date.parse(review.submittedAt);
  return Number.isNaN(time) ? null : time;
}

/**
 * The review that decides a reviewer's standing -- their latest APPROVED, CHANGES_REQUESTED or DISMISSED review -- or
 * undefined when they have none.
 *
 * "Later" is by submittedAt. Reviews arrive oldest first, so when either timestamp is missing or unparseable, or the
 * two tie, input order decides: the review listed later is the later one. A missing timestamp therefore can never make
 * an older review look newer than a later one that has a timestamp.
 */
function standingReview(reviews) {
  let standing;
  for (const review of reviews) {
    if (!DECISIVE_STATES.has(reviewState(review))) continue;
    if (standing === undefined) {
      standing = review;
      continue;
    }
    const time = submittedTime(review);
    const standingTime = submittedTime(standing);
    if (time === null || standingTime === null || time >= standingTime) standing = review;
  }
  return standing;
}

/** A check run counts only by concluding like this. */
const PASSING_CONCLUSIONS = new Set(['success', 'neutral']);

/** A check run that concluded like this objected. */
const FAILING_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'action_required']);

/** A check run that concluded like this gave no verdict either way. */
const INERT_CONCLUSIONS = new Set(['skipped', 'stale']);

/** 'passes' | 'failed' | 'inert' | 'incomplete' (no conclusion yet) | 'unrecognised'. Letter case is ignored, nothing else normalised. */
function checkOutcome(check) {
  const { conclusion } = check;
  if (conclusion === undefined || conclusion === null || (typeof conclusion === 'string' && conclusion.trim() === '')) {
    return 'incomplete';
  }
  if (typeof conclusion !== 'string') return 'unrecognised';
  const lowered = conclusion.toLowerCase();
  if (PASSING_CONCLUSIONS.has(lowered)) return 'passes';
  if (FAILING_CONCLUSIONS.has(lowered)) return 'failed';
  if (INERT_CONCLUSIONS.has(lowered)) return 'inert';
  return 'unrecognised';
}

/**
 * One collection of the remote set as tagged item copies. Anything but an array is reported, and so is every entry that
 * is not an object: a malformed entry might be exactly the review or check run that objects, so it is never skipped
 * silently. A hole in a sparse array is an undefined entry.
 */
function collect(list, name, kind, note) {
  if (!Array.isArray(list)) {
    note(`${name} must be an array`);
    return [];
  }
  const items = [];
  let malformed = 0;
  for (const entry of list) {
    if (isObject(entry)) {
      items.push({ ...entry, kind });
    } else {
      malformed += 1;
    }
  }
  if (malformed > 0) note(`${name} holds ${malformed} entr${malformed === 1 ? 'y' : 'ies'} that ${malformed === 1 ? 'is' : 'are'} not an object`);
  return items;
}

/** How a review's unrecognised state reads in a reason. */
function describeState(review) {
  return typeof review.state === 'string'
    ? `an unrecognised state ${JSON.stringify(review.state.slice(0, 40))}`
    : 'no recognisable state (missing or not text)';
}

/**
 * @param {Object} facts  Every collection is required: pass an empty array for "none".
 * @param {string} facts.headSha
 * @param {Array}  facts.reviews        Each review: { id, author, commitSha, state, submittedAt? }, oldest first
 * @param {Array}  facts.comments       Each comment: { id, author, commitSha }
 * @param {Array}  facts.threads        Each thread: { id, resolved }
 * @param {Array}  facts.checkRuns      Each check run: { id, author, commitSha, conclusion }
 * @param {Array}  facts.botLogins      Configured bot usernames (e.g. CodeRabbit); a non-empty array of non-empty strings
 * @param {Object} [facts.access]       { ok, reason } -- review retrieval access result; when supplied it must be exactly { ok: boolean }
 * @returns {{remotePhase: string, collected: Array, unresolvedThreads: Array, unverifiable: Array, reasons: string[]}}
 *   `remotePhase` is REMOTE_REVIEW_COMPLETE exactly when `reasons` is empty -- every blocker, and the lack of any
 *   evidence bound to the head, is a reason; otherwise it is REMOTE_REVIEW_PENDING and `reasons` names what is
 *   missing, malformed or blocking.
 */
function evaluateRemoteReview(facts = {}) {
  const reasons = [];
  const note = (reason) => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  if (!isObject(facts)) {
    note('facts must be an object');
    return { remotePhase: 'REMOTE_REVIEW_PENDING', collected: [], unresolvedThreads: [], unverifiable: [], reasons };
  }

  const headSha = isText(facts.headSha) ? facts.headSha : undefined;
  if (headSha === undefined) note('missing headSha');

  const botLoginSet = new Set();
  const { botLogins } = facts;
  if (!Array.isArray(botLogins) || Array.from(botLogins).some((login) => !isText(login))) {
    note('botLogins must be an array of non-empty strings');
  } else if (botLogins.length === 0) {
    note('botLogins is empty: no bot is configured');
  } else {
    botLogins.forEach((login) => botLoginSet.add(login.toLowerCase()));
  }
  const isBot = (item) => typeof item.author === 'string' && botLoginSet.has(item.author.toLowerCase());
  // An item whose author cannot be read could be a bot's: it may object, but it can never count as evidence.
  const isUnattributed = (item) => !isText(item.author);

  // Access is only ever a failure signal: absent means nothing failed, but a supplied value must say so exactly.
  if (facts.access !== undefined) {
    const { access } = facts;
    if (!isObject(access) || typeof access.ok !== 'boolean') {
      note('access must be an object with a boolean ok');
    } else if (!access.ok) {
      note(isText(access.reason) ? access.reason : 'review access unavailable');
    }
  }

  const reviews = collect(facts.reviews, 'reviews', 'review', note);
  const comments = collect(facts.comments, 'comments', 'comment', note);
  const checkRuns = collect(facts.checkRuns, 'checkRuns', 'check', note);
  const allItems = [...reviews, ...comments, ...checkRuns];

  // Every item for the current head -- not only the latest summary -- and
  // never an item bound to a different (stale, pre-rebase) commit.
  const collected = allItems.filter((item) => hasValue(item.commitSha) && item.commitSha === headSha);
  const bound = new Set(collected);

  // Items with no commit identity at all can't be bound to any head; they
  // are reported separately rather than silently counted or dropped.
  const unverifiable = allItems.filter((item) => !isText(item.commitSha));

  // A thread is resolved only when it says so in so many words; null, a non-object and any other value are open.
  let unresolvedThreads = [];
  if (Array.isArray(facts.threads)) {
    unresolvedThreads = Array.from(facts.threads).filter((thread) => !(isObject(thread) && thread.resolved === true));
    if (unresolvedThreads.length > 0) note('unresolved review threads remain');
  } else {
    note('threads must be an array');
  }

  const evidence = [];
  let botBlocked = false;
  const block = (reason) => {
    botBlocked = true;
    note(reason);
  };

  // Reviews: one standing per bot, judged over all of its reviews and again over those bound to this head.
  const reviewsByBot = new Map();
  for (const review of reviews) {
    if (!isBot(review)) continue;
    const login = review.author.toLowerCase();
    if (!reviewsByBot.has(login)) reviewsByBot.set(login, []);
    reviewsByBot.get(login).push(review);
  }
  for (const authored of reviewsByBot.values()) {
    for (const review of authored) {
      if (reviewState(review) === null) block(`bot review has ${describeState(review)}`);
    }
    const onThisHead = authored.filter((review) => bound.has(review));
    const standingEverywhere = standingReview(authored);
    const standingHere = standingReview(onThisHead);
    if ([standingEverywhere, standingHere].some((review) => review !== undefined && reviewState(review) === 'CHANGES_REQUESTED')) {
      block('bot review requests changes');
    }
    evidence.push(...onThisHead.filter((review) => reviewState(review) === 'COMMENTED'));
    if (standingHere !== undefined && reviewState(standingHere) === 'APPROVED') evidence.push(standingHere);
  }

  // A review whose author cannot be read might be the bot's own. Whose it is cannot be told, so nothing supersedes it:
  // it objects if it requests changes or its state cannot be read, and in any other state it is inert.
  for (const review of reviews.filter(isUnattributed)) {
    const state = reviewState(review);
    if (state === null) block(`review with no readable author has ${describeState(review)}`);
    else if (state === 'CHANGES_REQUESTED') block('review with no readable author requests changes');
  }

  // Check runs: only a success or neutral conclusion from the bot, bound to this head, counts. An objection, an
  // unfinished run or an unrecognised conclusion blocks -- from the bot or from an author that cannot be read --
  // unless the run is provably about another commit.
  for (const check of checkRuns) {
    const byBot = isBot(check);
    if (!byBot && !isUnattributed(check)) continue;
    if (isText(check.commitSha) && !bound.has(check)) continue;
    const who = byBot ? 'bot check run' : 'check run with no readable author';
    const outcome = checkOutcome(check);
    if (outcome === 'passes') {
      if (byBot && bound.has(check)) evidence.push(check);
    } else if (outcome === 'failed') {
      block(`${who} did not succeed (${check.conclusion.toLowerCase()})`);
    } else if (outcome === 'incomplete') {
      block(`${who} has not concluded`);
    } else if (outcome === 'unrecognised') {
      block(`${who} has an unrecognised conclusion`);
    }
  }

  // Comments carry no verdict of their own: bound to the head they are evidence, and they never block.
  evidence.push(...comments.filter((comment) => isBot(comment) && bound.has(comment)));

  // Nothing counted and nothing objected: say why there is no evidence. This is what keeps an empty or irrelevant
  // fact set from completing, so the phase is complete exactly when no reason was recorded.
  if (evidence.length === 0 && !botBlocked) {
    const boundBotItems = collected.filter(isBot);
    if (boundBotItems.length > 0) {
      note('bot review on the current head is not in a terminal reviewed state');
    } else if (unverifiable.some(isBot)) {
      note('bot summary lacks commit identity and is unverifiable');
    } else {
      note('no bot review bound to the current head commit');
    }
  }

  return {
    remotePhase: reasons.length === 0 ? 'REMOTE_REVIEW_COMPLETE' : 'REMOTE_REVIEW_PENDING',
    collected,
    unresolvedThreads,
    unverifiable,
    reasons,
  };
}

module.exports = { evaluateRemoteReview };
