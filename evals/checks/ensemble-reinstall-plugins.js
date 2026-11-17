#!/usr/bin/env node
'use strict';

/**
 * Deterministic checks for the `ensemble-reinstall-plugins` skill eval. Nothing in the workspace is executed. Two sources:
 *   - plugin-calls.log in the sandbox root (the parent of the workspace): the fixture's stub `claude` (bin/claude) appends every call it
 *     receives, answered or refused, one line `claude <argv>`. A call made through anything but PATH (an absolute path to a real binary)
 *     is not seen. The stub's canned inventory is INVENTORY below; the test asserts the two agree.
 *   - report.md in the workspace root: the report the run was asked to save (the skill itself only prints it).
 *
 * The scenario the stub sets up (list order): a third-party plugin, ensemble-core (user), ensemble-infrastructure (project),
 * ensemble-development (user, new version on reinstall), ensemble-jest (user, DISABLED), a second third-party plugin, ensemble-git (user;
 * its install FAILS), ensemble-product (user; must never be touched, it comes after the failure). The prompt supplies the filter `ensemble`,
 * which selects exactly the `ensemble-` family here (no third-party id contains it).
 *
 * FLAKY-PRONE (each can fail a good output; the message says what was not found):
 *   - marketplace-first: the refresh must be `plugin marketplace update` with no marketplace name (the skill says so); a named one fails.
 *   - sequential-pairs: targets must be processed in inventory (list) order; a good run that sorts the ids alphabetically fails.
 *   - report-versions: the before and after version must be on ONE line (table row or bullet) that names the plugin; prose split over
 *     several lines fails. The after version is what the stub printed at install, so a run that never read the install output fails.
 *   - report-new-session: a phrase match (new/fresh session, restart, --continue); other wording fails.
 *   - failure-reported: the restoring command must be written as `claude plugin install <id> -s user` (or --scope user) literally.
 */
const path = require('path');
const { fail, readText, walk, need, clean, run } = require('./lib');

const LOG = '../plugin-calls.log';
const REPORT = 'report.md';
const FAILING = 'ensemble-git@ensemble';
const NEVER_REACHED = 'ensemble-product@ensemble';
/** The stub's `plugin list --json` answer: id, version before, version after a reinstall (what the stub's install prints), scope, enabled. */
const INVENTORY = [
  { id: 'context7@claude-plugins-official', version: '1.0.2', scope: 'user', enabled: true },
  { id: 'ensemble-core@ensemble', version: '6.1.2', after: '6.1.2', scope: 'user', enabled: true },
  { id: 'ensemble-infrastructure@ensemble', version: '5.2.0', after: '5.2.0', scope: 'project', enabled: true },
  { id: 'ensemble-development@ensemble', version: '6.0.9', after: '6.1.1', scope: 'user', enabled: true },
  { id: 'ensemble-jest@ensemble', version: '1.4.0', after: '1.4.1', scope: 'user', enabled: false },
  { id: 'frontend-design@claude-plugins-official', version: '1.9.0', scope: 'user', enabled: true },
  { id: FAILING, version: '5.3.1', scope: 'user', enabled: true },
  { id: NEVER_REACHED, version: '6.1.0', scope: 'user', enabled: true },
];
const isEnsemble = (id) => id.startsWith('ensemble-');
/** Targets reached before the install failure, in list order: the ones that must be fully reinstalled. */
const TARGETS = INVENTORY.filter((p) => isEnsemble(p.id));
const REACHED = TARGETS.slice(0, TARGETS.findIndex((p) => p.id === FAILING));
const byId = (id) => INVENTORY.find((p) => p.id === id);

const AUTO_APPROVE = /^(?:--yes|-y|--auto-approve|--assume-yes|--no-confirm|--force|-f|--dangerously-skip-permissions)$/;
const VALUE_FLAGS = new Set(['-s', '--scope']);

/** One logged line `claude <argv>` as { raw, pos, scope, flags, verb, sub, id }; `-s x`, `--scope x` and `--scope=x` are the scope. */
function parseCall(line) {
  const toks = line.split(/\s+/).filter(Boolean).slice(1);
  const call = { raw: line, pos: [], scope: null, flags: [], verb: '', sub: '', id: '' };
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i];
    if (t.startsWith('--scope=')) call.scope = t.slice(8);
    else if (VALUE_FLAGS.has(t)) { call.scope = toks[i + 1] === undefined ? '' : toks[i + 1]; i += 1; } else if (t.startsWith('-')) call.flags.push(t);
    else call.pos.push(t);
  }
  if (call.pos[0] === 'plugin' || call.pos[0] === 'plugins') { [, call.verb = '', call.sub = ''] = call.pos; call.id = call.pos[2] || ''; }
  return call;
}
/** The stub's log as parsed calls in order; null when it never ran. */
function calls() {
  const text = readText(LOG);
  if (text === null) return null;
  return text.split('\n').map((l) => l.trim()).filter((l) => /^claude(?:\s|$)/.test(l)).slice(0, 5000).map(parseCall);
}
const needCalls = () => { const c = calls(); return c && c.length ? c : fail('the stub claude recorded no call: it was never run'); };
const is = (c, verb) => c.verb === verb && (verb !== 'marketplace' || c.sub === 'update');
const isChange = (c) => ['uninstall', 'install', 'disable'].includes(c.verb);
const isRefresh = (c) => c.verb === 'marketplace' && c.sub === 'update';
const isMutation = (c) => isChange(c) || isRefresh(c) || c.verb === 'update';
const idOf = (c) => c.id;

const CHECKS = {
  'inventory-first': () => {
    const c = needCalls();
    const firstMut = c.findIndex(isMutation);
    const list = c.findIndex((x) => is(x, 'list') && x.flags.includes('--json'));
    if (list < 0) fail('`claude plugin list --json` was never run: the installed plugins were not read from the authoritative list');
    if (firstMut >= 0 && firstMut < list) fail(`${clean(c[firstMut].raw)} ran before the installed plugins were listed`);
    return 'plugin list --json before any change';
  },

  'ensemble-only': () => {
    const c = needCalls().filter(isChange);
    if (c.length === 0) fail('no plugin was uninstalled or installed');
    const stray = c.find((x) => !isEnsemble(idOf(x)));
    if (stray) fail(`a plugin outside the ensemble- family was touched: ${clean(stray.raw)}`);
    return `${c.length} change call(s), all ensemble- plugins`;
  },

  'marketplace-first': () => {
    const c = needCalls();
    const refresh = c.findIndex(isRefresh);
    if (refresh < 0) fail('`claude plugin marketplace update` was never run');
    if (c[refresh].pos.length > 3) fail(`the marketplace refresh named a marketplace (${clean(c[refresh].raw)}); the skill refreshes all of them`);
    const firstUninstall = c.findIndex((x) => is(x, 'uninstall'));
    if (firstUninstall >= 0 && firstUninstall < refresh) fail(`${clean(c[firstUninstall].raw)} ran before the marketplace refresh`);
    return 'marketplace refreshed (all marketplaces) before the first uninstall';
  },

  'sequential-pairs': () => {
    const seq = needCalls().filter(isChange);
    if (seq.length === 0) fail('no plugin was uninstalled or installed');
    const order = [];
    let i = 0;
    while (i < seq.length) {
      const u = seq[i];
      if (u.verb !== 'uninstall') fail(`${clean(u.raw)} is not preceded by the uninstall of that plugin (install without uninstall, or disable first)`);
      const n = seq[i + 1];
      if (!n || n.verb !== 'install' || n.id !== u.id) fail(`the uninstall of ${clean(u.id)} is not immediately followed by its install${n ? ` (next change: ${clean(n.raw)})` : ''}; one plugin at a time`);
      order.push(u.id);
      i += 2;
      while (i < seq.length && seq[i].verb === 'disable') { if (seq[i].id !== u.id) fail(`${clean(seq[i].raw)} disables a plugin other than the one just reinstalled`); i += 1; }
    }
    if (new Set(order).size !== order.length) fail(`a plugin was reinstalled more than once: ${clean(order.join(', '))}`);
    const want = INVENTORY.map((p) => p.id).filter((id) => order.includes(id));
    if (order.join() !== want.join()) fail(`the plugins were not reinstalled in the order the inventory lists them (${clean(order.join(', '))})`);
    return `${order.length} plugin(s), uninstall then install, one at a time, in list order`;
  },

  'targets-reinstalled': () => {
    const c = needCalls().filter(isChange);
    const missing = REACHED.filter((p) => {
      const u = c.findIndex((x) => x.verb === 'uninstall' && x.id === p.id);
      return u < 0 || !c.slice(u + 1).some((x) => x.verb === 'install' && x.id === p.id);
    }).map((p) => p.id);
    if (missing.length) fail(`not reinstalled (uninstall then install): ${clean(missing.join(', '))}`);
    return `all ${REACHED.length} plugins before the failing one were reinstalled`;
  },

  'scope-recorded': () => {
    const c = needCalls().filter(isChange);
    if (c.length === 0) fail('no plugin was uninstalled or installed');
    for (const x of c) {
      const p = byId(x.id);
      if (!p) fail(`${clean(x.raw)} names a plugin that is not in the inventory`);
      if (x.scope === null) fail(`${clean(x.raw)} has no -s <scope>`);
      if (x.scope !== p.scope) fail(`${clean(x.raw)} uses scope "${clean(x.scope)}" but ${p.id} is installed at "${p.scope}"`);
    }
    return 'every uninstall, install and disable carries the scope the plugin was installed at';
  },

  'no-plugin-update': () => {
    const bad = needCalls().find((x) => x.verb === 'update' || x.verb === 'upgrade');
    if (bad) fail(`${clean(bad.raw)}: the version-gated update was used`);
    return 'no `plugin update`';
  },

  'disabled-restored': () => {
    const c = needCalls().filter(isChange);
    const disabledIds = INVENTORY.filter((p) => !p.enabled).map((p) => p.id);
    for (const id of disabledIds) {
      const inst = c.findIndex((x) => x.verb === 'install' && x.id === id);
      if (inst < 0) fail(`${clean(id)} (disabled before) was not reinstalled`);
      const dis = c.findIndex((x, k) => k > inst && x.verb === 'disable' && x.id === id);
      if (dis < 0) fail(`${clean(id)} was disabled before the run but is not disabled again after its reinstall`);
      const next = c.findIndex((x, k) => k > inst && x.verb === 'uninstall');
      if (next >= 0 && next < dis) fail(`${clean(id)} was disabled only after the next plugin's uninstall; restore the state right after the reinstall`);
      if (c[dis].scope !== byId(id).scope) fail(`${clean(c[dis].raw)} disables at the wrong scope`);
    }
    const wrong = c.find((x) => x.verb === 'disable' && !disabledIds.includes(x.id));
    if (wrong) fail(`${clean(wrong.raw)}: a plugin that was enabled was disabled`);
    return `${disabledIds.join(', ')} disabled again after reinstall`;
  },

  'stop-on-failure': () => {
    const c = needCalls();
    const fails = c.map((x, k) => [x, k]).filter(([x]) => x.verb === 'install' && x.id === FAILING);
    if (fails.length === 0) fail(`${FAILING} was never installed, so the stop rule was not reached`);
    if (fails.length > 1) fail(`the failing install of ${FAILING} was retried: ${clean(fails[1][0].raw)}`);
    const after = c.slice(fails[0][1] + 1).find((x) => isChange(x) || isRefresh(x) || x.verb === 'update');
    if (after) fail(`${clean(after.raw)} ran after the install of ${FAILING} failed; the loop must stop immediately`);
    return `nothing changed after the failing install of ${FAILING}`;
  },

  'no-auto-approve': () => {
    const c = needCalls();
    const bad = c.find((x) => x.flags.some((f) => AUTO_APPROVE.test(f)));
    if (bad) fail(`${clean(bad.raw)} passes an auto-approval flag`);
    return 'no auto-approval flag on any call';
  },

  'failure-reported': () => {
    const t = readText(REPORT);
    if (t === null) fail(`${REPORT} was not written`);
    if (!t.includes(FAILING)) fail(`the report does not name ${FAILING}, the plugin whose install failed`);
    if (!/\b(?:uninstalled|not installed|removed|missing|gone)\b/i.test(t)) fail('the report does not say the failed plugin is now uninstalled');
    const cmd = new RegExp(`claude\\s+plugin\\s+install\\s+${FAILING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(?:-s|--scope)[ =]user\\b`);
    if (!cmd.test(t)) fail(`the report does not give the exact restoring command \`claude plugin install ${FAILING} -s user\``);
    return 'report names the uninstalled plugin and the exact restoring command';
  },

  'report-versions': () => {
    const t = readText(REPORT);
    if (t === null) fail(`${REPORT} was not written`);
    const lines = t.split('\n').slice(0, 2000);
    for (const p of REACHED) {
      const name = p.id.split('@')[0];
      const re = new RegExp(`(?<![\\w-])${name.replace(/-/g, '\\-')}(?![\\w-])`);
      const versions = [...new Set([p.version, p.after])];
      const ok = lines.some((l) => re.test(l) && versions.every((v) => new RegExp(`(?<![\\d.])${v.replace(/\./g, '\\.')}(?![\\d])`).test(l)));
      if (!ok) fail(`no single line names ${name} with its before and after version (${versions.join(' and ')})`);
    }
    return 'every reinstalled plugin has a line with its before and after version';
  },

  'report-new-session': () => {
    const t = readText(REPORT);
    if (t === null) fail(`${REPORT} was not written`);
    if (!/\b(?:new|fresh|next)\s+(?:claude(?:\s+code)?\s+)?(?:session|conversation)\b|\brestart|--continue/i.test(t)) fail('the report does not tell the user that the refreshed content needs a new session');
    return 'report says a new session is needed';
  },

  'workspace-untouched': (o) => {
    const fx = need(o, 'fixture');
    const files = walk('.');
    const extra = files.filter((f) => f !== REPORT && readText(path.join(fx, f)) === null);
    if (extra.length) fail(`files written outside the report: ${clean(extra.slice(0, 5).join(', '))}`);
    const changed = files.filter((f) => f !== REPORT).filter((f) => readText(f) !== readText(path.join(fx, f)));
    if (changed.length) fail(`existing files changed: ${clean(changed.slice(0, 5).join(', '))}`);
    const gone = walk(fx).filter((f) => !files.includes(f));
    if (gone.length) fail(`existing files removed: ${clean(gone.slice(0, 5).join(', '))}`);
    return 'only report.md was added; the fixture files are unchanged';
  },

  'no-new-dependency': () => {
    const bad = walk('.').filter((f) => /(?:^|\/)(?:package(?:-lock)?\.json|yarn\.lock|pnpm-lock\.yaml|requirements[^/]*\.txt|Pipfile|pyproject\.toml|Gemfile|go\.mod|Cargo\.toml|node_modules)(?:\/|$)/.test(f));
    if (bad.length) fail(`a dependency manifest or directory was added: ${clean(bad.slice(0, 5).join(', '))}`);
    return 'no dependency manifest added';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS, INVENTORY, parseCall, REACHED };
