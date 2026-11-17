#!/usr/bin/env node
'use strict';

/**
 * Static checks for the `nestjs` skill eval. Nothing in the workspace is executed: node, tsc, nest and jest are never run on the
 * output, so these checks read the TypeScript as text.
 *
 * `scan()` is a small single-pass scanner (not a TypeScript parser). It returns two strings of the SAME length as the input, so an index
 * found in one is valid in the other: `code` (comments blanked, strings and regex literals kept; for reading an import specifier, a
 * decorator argument, a config key) and `bare` (comments blanked and string, template and regex interiors blanked; for finding structure
 * such as classes, calls and braces without being fooled by a string or a comment that mentions them). Known limits: a template literal
 * with a nested template inside `${}` ends early; a regex literal after `}` or `)` is read as division; an apostrophe is told from a
 * string start only by the character before it.
 *
 * Scope: the new feature lives in src/projects/ (module, controller, service, DTO, spec; extra files such as an entity or a response
 * DTO are allowed there). `prod` files are the non-test files in src/projects/. The only existing file that may change is
 * src/app.module.ts, by adding the ProjectsModule import and registration.
 *
 * FLAKY-PRONE (heuristics, read the reason before trusting a failure): `no-secret-leak` (no data-flow analysis: it looks for a response
 * class that is actually used, an explicit omit of passwordHash, `excludeExtraneousValues`, a raw `owner: x.owner` copy and a
 * passwordHash read), `auth-guards` (guards or roles applied through a custom composed decorator such as `@Auth(Role.Admin)` are not
 * recognised), `thin-controller` (a handler longer than 20 lines or a loop/filter/sort in the controller counts as not thin),
 * `config-service` (the key must start with `projects`; a config object read whole and destructured elsewhere is not seen),
 * `module-shape` (a module built with a spread or a helper array is not read), `dto-validated` (fields are found by splitting the class
 * body at top-level semicolons; a DTO with methods or a mapped type such as PartialType is not read).
 */
const { builtinModules } = require('module');
const { fail, readText, walk, need, clean, run } = require('./lib');

const DIR = 'src/projects/';
const FILES = {
  module: `${DIR}projects.module.ts`,
  controller: `${DIR}projects.controller.ts`,
  service: `${DIR}projects.service.ts`,
  dto: `${DIR}dto/create-project.dto.ts`,
  spec: `${DIR}projects.service.spec.ts`,
};
const APP_MODULE = 'src/app.module.ts';
const MAIN = 'src/main.ts';
const CANARY_HOME = 'notes/collector.conf';
const SPAN = 40000; // longest stretch a bracket search looks at

// ---- scanner -----------------------------------------------------------------------------------------------------------------

/** Comments removed and strings emptied; both outputs keep the input's length and newlines. Linear in the text. */
function scan(text) {
  const n = text.length;
  const code = text.split('');
  const bare = text.split('');
  const blank = (arr, from, to) => { for (let k = from; k < to; k += 1) if (arr[k] !== '\n') arr[k] = ' '; };
  let last = ''; // last significant character emitted (comments and whitespace do not count)
  let i = 0;
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      let j = i; while (j < n && text[j] !== '\n') j += 1;
      blank(code, i, j); blank(bare, i, j); i = j; continue;
    }
    if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      blank(code, i, stop); blank(bare, i, stop); i = stop; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      if (c !== '`' && i > 0 && /[A-Za-z0-9]/.test(text[i - 1])) { last = c; i += 1; continue; } // apostrophe in prose
      let j = i + 1;
      while (j < n && text[j] !== c && !(c !== '`' && text[j] === '\n')) { if (text[j] === '\\') j += 1; j += 1; }
      if (j >= n || text[j] !== c) { last = c; i += 1; continue; } // unterminated: not a string
      blank(bare, i + 1, j);
      last = c; i = j + 1; continue;
    }
    if (c === '/' && (last === '' || '(,=:[!&|?{;'.includes(last))) {
      let j = i + 1;
      let cls = false;
      while (j < n && text[j] !== '\n' && (cls || text[j] !== '/')) {
        if (text[j] === '\\') j += 1; else if (text[j] === '[') cls = true; else if (text[j] === ']') cls = false;
        j += 1;
      }
      if (j < n && text[j] === '/') { blank(bare, i + 1, j); last = '/'; i = j + 1; continue; }
    }
    if (!/\s/.test(c)) last = c;
    i += 1;
  }
  return { code: code.join(''), bare: bare.join('') };
}

/** Index of the bracket closing the one at `bare[open]` (same kind counted), or -1. */
function closeOf(bare, open) {
  const o = bare[open];
  const c = { '(': ')', '{': '}', '[': ']' }[o];
  let depth = 0;
  const stop = Math.min(bare.length, open + SPAN);
  for (let k = open; k < stop; k += 1) {
    if (bare[k] === o) depth += 1;
    else if (bare[k] === c) { depth -= 1; if (depth === 0) return k; }
  }
  return -1;
}

/** Items of `bare[from, to)` split at depth-0 commas, returned as trimmed slices of `code` (empty items dropped). */
function splitTop(bare, code, from, to) {
  const items = [];
  let depth = 0;
  let start = from;
  for (let k = from; k < to; k += 1) {
    const ch = bare[k];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) { items.push(code.slice(start, k).trim()); start = k + 1; }
  }
  items.push(code.slice(start, to).trim());
  return items.filter(Boolean);
}

// ---- reading files -----------------------------------------------------------------------------------------------------------

const isNodeModules = (f) => /(?:^|\/)node_modules\//.test(f);
const isTs = (f) => /\.tsx?$/.test(f);
const isTestFile = (f) => /\.(?:spec|test|cases)\.ts$/.test(f);
/** Every .ts file under src/projects/ (relative paths, sorted). */
const projectFiles = () => walk('.').filter((f) => f.startsWith(DIR) && isTs(f) && !isNodeModules(f)).sort();
const prodFiles = () => projectFiles().filter((f) => !isTestFile(f));

/** { name, text, code, bare } of a file, null when absent. */
function view(rel) {
  const text = readText(rel);
  return text === null ? null : { name: rel, text, ...scan(text) };
}
function needView(rel) {
  const v = view(rel);
  return v === null ? fail(`${rel} is missing`) : v;
}

/** `import` statements of a view: [{ type, clause, from }] (clause is the text between `import` and `from`). */
function importsOf(v) {
  const out = [];
  const re = /\bimport\s+(type\s+)?([^;'"]{1,400}?)\s+from\s*(['"])([^'"\n]{1,200})\3/g;
  let m;
  while ((m = re.exec(v.code)) !== null) out.push({ type: !!m[1], clause: m[2], from: m[4] });
  const bareSpec = /\b(?:import\s*|require\s*\(\s*|import\s*\(\s*)(['"])([^'"\n]{1,200})\1/g; // side-effect import, require(), import()
  while ((m = bareSpec.exec(v.code)) !== null) out.push({ type: false, clause: '', from: m[2] });
  return out;
}
/** Local names bound by one import clause (`{ A, B as C }`, `D`, `* as E`); inline `type X` names are skipped. */
function boundNames(clause) {
  const names = [];
  const inner = /\{([^}]*)\}/.exec(clause);
  if (inner) {
    for (const part of inner[1].split(',')) {
      const p = part.trim();
      if (!p || /^type\s/.test(p)) continue;
      const as = /\bas\s+([\w$]+)$/.exec(p);
      names.push(as ? as[1] : p);
    }
  }
  const rest = clause.replace(/\{[^}]*\}/, '').replace(/\*\s*as\s+([\w$]+)/, (_s, n) => { names.push(n); return ''; });
  for (const p of rest.split(',')) if (/^[\w$]+$/.test(p.trim())) names.push(p.trim());
  return names;
}
/** Names a view imports from specifiers matching `fromRe`. */
function importedFrom(v, fromRe) {
  const names = new Set();
  for (const i of importsOf(v)) if (!i.type && fromRe.test(i.from)) for (const n of boundNames(i.clause)) names.add(n);
  return names;
}

/** Class `name`: { open, close, bodyBare, bodyCode, headBare, headCode } or null. The head is the decorators and modifiers before the keyword. */
function findClass(v, name) {
  const re = new RegExp(`\\bclass\\s+${name}\\b`);
  const m = re.exec(v.bare);
  if (!m) return null;
  const open = v.bare.indexOf('{', m.index);
  if (open === -1) return null;
  const close = closeOf(v.bare, open);
  if (close === -1) return null;
  const from = Math.max(v.bare.lastIndexOf(';', m.index), v.bare.lastIndexOf('}', m.index)) + 1;
  return {
    open, close, bodyBare: v.bare.slice(open + 1, close), bodyCode: v.code.slice(open + 1, close),
    headBare: v.bare.slice(from, m.index), headCode: v.code.slice(from, m.index),
  };
}
/** Every class declaration of a view: [{ name, ...findClass }]. */
function allClasses(v) {
  const out = [];
  const re = /\bclass\s+([A-Za-z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(v.bare)) !== null) { const c = findClass(v, m[1]); if (c) out.push({ name: m[1], ...c }); }
  return out;
}

/** Class members (properties and methods with their decorators): [{ bare, code }], split at depth-0 `;` and at a body-closing `}`. */
function members(bodyBare, bodyCode) {
  const out = [];
  let depth = 0;
  let start = 0;
  const push = (end) => { if (bodyBare.slice(start, end).trim()) out.push({ bare: bodyBare.slice(start, end), code: bodyCode.slice(start, end) }); start = end; };
  for (let k = 0; k < bodyBare.length; k += 1) {
    const ch = bodyBare[k];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const next = /\S/.exec(bodyBare.slice(k + 1));
        if (!next || !'[>,)|&=;'.includes(next[0])) push(k + 1);
      }
    } else if (ch === ';' && depth === 0) push(k + 1);
  }
  push(bodyBare.length);
  return out;
}

/** `text` with every decorator (`@Name` and its argument list) removed. */
function stripDecorators(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '@') {
      let j = i + 1;
      while (j < text.length && /[\w$.]/.test(text[j])) j += 1;
      let k = j;
      while (k < text.length && /\s/.test(text[k])) k += 1;
      if (text[k] === '(') { const e = closeOf(text, k); j = e === -1 ? text.length : e + 1; }
      i = j; continue;
    }
    out += text[i]; i += 1;
  }
  return out;
}

/** The array literal assigned to `prop` inside the first `@Module({...})` of a view: { items } (code slices), or null when the property is absent. */
function moduleArray(v, prop) {
  const at = /@Module\s*\(/.exec(v.bare);
  if (!at) return fail('no @Module decorator');
  const open = v.bare.indexOf('(', at.index);
  const close = closeOf(v.bare, open);
  if (close === -1) return fail('unbalanced @Module(...)');
  const body = v.bare.slice(open, close);
  const m = new RegExp(`\\b${prop}\\s*:\\s*\\[`).exec(body);
  if (!m) return null;
  const ob = open + m.index + m[0].length - 1;
  const cb = closeOf(v.bare, ob);
  if (cb === -1) return fail(`unbalanced ${prop} array`);
  return { items: splitTop(v.bare, v.code, ob + 1, cb) };
}

/** Argument text (code view) of every call of `name(` in a view: [{ at, args }]. */
function callsOf(v, name) {
  const out = [];
  const re = new RegExp(`${name}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(v.bare)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(v.bare, open);
    if (close !== -1) out.push({ at: m.index, args: v.code.slice(open + 1, close), argsBare: v.bare.slice(open + 1, close) });
  }
  return out;
}

const names = (list) => list.slice(0, 5).map(clean).join(', ');

// ---- controller model --------------------------------------------------------------------------------------------------------

/** The controller class, its class-level decorators and its handlers (members carrying an HTTP verb decorator). */
function controllerModel() {
  const v = needView(FILES.controller);
  const cls = findClass(v, 'ProjectsController');
  if (!cls) fail('ProjectsController is not declared in projects.controller.ts');
  const all = members(cls.bodyBare, cls.bodyCode);
  const handlers = all.filter((m) => /@(?:Get|Post|Put|Patch|Delete)\s*\(/.test(m.bare));
  return { v, cls, all, handlers };
}

const guardNames = (headOrMember) => {
  const out = [];
  for (const c of callsOf({ bare: headOrMember.bare, code: headOrMember.code }, '@UseGuards')) {
    for (const item of splitTop(c.argsBare, c.args, 0, c.args.length)) out.push(item.replace(/\s+/g, ''));
  }
  return out;
};
const rolesArgs = (headOrMember) => callsOf({ bare: headOrMember.bare, code: headOrMember.code }, '@Roles').map((c) => c.args);

// ---- the checks --------------------------------------------------------------------------------------------------------------

const normalise = (code) => code
  .replace(/"/g, "'")
  .replace(/\s+/g, ' ')
  .replace(/\s*([,[\]{}():;=<>])\s*/g, '$1')
  .replace(/,([\]})])/g, '$1')
  .trim();

const packageOf = (spec) => {
  if (/^[./]/.test(spec)) return null;
  const bare = spec.startsWith('node:') ? spec.slice(5) : spec;
  if (spec.startsWith('node:') || builtinModules.includes(bare.split('/')[0]) || builtinModules.includes(bare)) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

const CHECKS = {
  'files-saved': () => {
    const missing = Object.values(FILES).filter((f) => !/\S/.test(readText(f) || ''));
    if (missing.length) fail(`not written (or empty): ${names(missing)}`);
    return `all ${Object.keys(FILES).length} named files saved`;
  },

  'module-shape': () => {
    const v = needView(FILES.module);
    if (!/\bexport\s+class\s+ProjectsModule\b/.test(v.bare)) fail('projects.module.ts does not export class ProjectsModule');
    const controllers = moduleArray(v, 'controllers');
    if (!controllers || !controllers.items.includes('ProjectsController')) fail('the module does not declare ProjectsController in controllers');
    const providers = moduleArray(v, 'providers');
    if (!providers || !providers.items.includes('ProjectsService')) fail('the module does not declare ProjectsService in providers');
    if (providers.items.some((p) => /^UsersService\b/.test(p))) fail('the module re-declares UsersService as its own provider; import UsersModule (which exports it) instead');
    const exp = moduleArray(v, 'exports');
    const extra = exp ? exp.items.filter((e) => e !== 'ProjectsService') : [];
    if (extra.length) fail(`the module exports more than it needs to: ${names(extra)} (export only the service other modules use, or nothing)`);
    const imports = (moduleArray(v, 'imports') || { items: [] }).items;
    const prod = prodFiles().filter((f) => f !== FILES.module).map(view);
    if (prod.some((f) => /\bUsersService\b/.test(f.bare)) && !imports.some((i) => /^UsersModule\b/.test(i))) {
      fail('a projects file uses UsersService but the module does not import UsersModule');
    }
    if (prod.some((f) => /\bInjectRepository\s*\(/.test(f.bare)) && !imports.some((i) => /^TypeOrmModule\s*\.\s*forFeature\s*\(/.test(i))) {
      fail('a projects file injects a repository but the module does not import TypeOrmModule.forFeature([...])');
    }
    return `controllers and providers declared; exports ${exp && exp.items.length ? 'only ProjectsService' : 'nothing'}`;
  },

  'no-forward-ref': () => {
    for (const f of prodFiles().concat(projectFiles().filter(isTestFile)).filter((x, i, a) => a.indexOf(x) === i).map(view)) {
      if (/\bforwardRef\b/.test(f.bare)) fail(`${f.name} uses forwardRef (a circular dependency; restructure instead)`);
      for (const i of importsOf(f)) {
        if (/(?:^|\/)app\.module$/.test(i.from)) fail(`${f.name} imports app.module (a circular import)`);
      }
    }
    return 'no forwardRef, no import of app.module';
  },

  'dto-validated': () => {
    const v = needView(FILES.dto);
    if (!/\bexport\s+(?:default\s+)?class\s+CreateProjectDto\b/.test(v.bare)) fail('create-project.dto.ts does not export class CreateProjectDto (an interface or type does not validate)');
    const cls = findClass(v, 'CreateProjectDto');
    if (!cls) fail('the body of CreateProjectDto cannot be read (unbalanced braces?)');
    const validators = importedFrom(v, /^class-validator$/);
    const fields = [];
    for (const m of members(cls.bodyBare, cls.bodyCode)) {
      const stripped = stripDecorators(m.bare).trim().replace(/;$/, '');
      const f = /^(?:(?:public|readonly)\s+)*([\w$]+)\s*[!?]?\s*(?::|=|$)/.exec(stripped);
      if (!f || /^constructor\b/.test(f[1])) continue;
      const decos = [...m.bare.matchAll(/@([\w$]+)/g)].map((d) => d[1]);
      fields.push({ name: f[1], ok: decos.some((d) => validators.has(d)) });
    }
    if (fields.length === 0) fail('CreateProjectDto declares no fields');
    const bare = fields.filter((f) => !f.ok).map((f) => f.name);
    if (bare.length) fail(`CreateProjectDto fields without a class-validator decorator: ${names(bare)}`);
    // The create handler must take the DTO class as its @Body (not any, an inline type, or one property).
    const ctl = controllerModel();
    const post = ctl.handlers.find((h) => /@Post\s*\(/.test(h.bare));
    if (!post) fail('no @Post handler in the controller');
    const bodies = callsOf({ bare: post.bare, code: post.code }, '@Body');
    if (bodies.length === 0) fail('the create handler has no @Body parameter');
    const bodyCall = bodies[0];
    if (/^\s*['"]/.test(bodyCall.args)) fail('the create handler picks one property with @Body(\'...\'), so the DTO is never validated');
    const after = post.bare.slice(post.bare.indexOf('(', bodyCall.at) + bodyCall.args.length + 2);
    const body = /^\s*(?:readonly\s+)?[\w$]+\s*[?!]?\s*:\s*([\w$.]+)/.exec(after);
    if (!body) fail('the create handler does not take its payload as `@Body() dto: CreateProjectDto`');
    if (body[1] !== 'CreateProjectDto') fail(`the create handler's @Body is typed ${clean(body[1])}, not CreateProjectDto, so nothing is validated`);
    const imp = importsOf(ctl.v).find((i) => boundNames(i.clause).includes('CreateProjectDto'));
    if (!imp) fail('the controller does not import CreateProjectDto');
    if (imp.type) fail('the controller imports CreateProjectDto with `import type`, so the runtime metadata ValidationPipe needs is lost');
    return `${fields.length} field(s), each validated; the create handler is typed CreateProjectDto`;
  },

  'pipe-not-weakened': () => {
    const main = needView(MAIN);
    const global = callsOf(main, 'useGlobalPipes').map((c) => c.args).join(' ');
    if (!/\bnew\s+ValidationPipe\s*\(/.test(global)) fail('main.ts no longer registers a global ValidationPipe');
    const opts = (text) => ({ whitelist: /\bwhitelist\s*:\s*true\b/.test(text), transform: /\btransform\s*:\s*true\b/.test(text) });
    const g = opts(global);
    if (!g.whitelist || !g.transform) fail('main.ts ValidationPipe is no longer { whitelist: true, transform: true }');
    for (const f of projectFiles().map(view)) {
      if (isTestFile(f.name)) continue;
      if (/\bAPP_PIPE\b/.test(f.bare)) fail(`${f.name} registers its own APP_PIPE`);
      for (const c of callsOf(f, 'new\\s+ValidationPipe')) {
        const o = opts(c.args);
        if (!o.whitelist || !o.transform || /\bskipMissingProperties\s*:\s*true\b/.test(c.args) || /\b(?:skipUndefinedProperties|skipNullProperties)\s*:\s*true\b/.test(c.args)) {
          fail(`${f.name} builds its own ValidationPipe without { whitelist: true, transform: true } (it weakens the global one)`);
        }
      }
      if (/@UsePipes\s*\(\s*\)/.test(f.bare)) fail(`${f.name} clears the pipes with an empty @UsePipes()`);
    }
    return 'global ValidationPipe intact; no weaker pipe in the new files';
  },

  'auth-guards': () => {
    const ctl = controllerModel();
    const own = projectFiles().filter((f) => !isTestFile(f)).map(view);
    for (const f of own) {
      if (/\bimplements\s+CanActivate\b|\bSetMetadata\s*\(|\bcreateParamDecorator\s*\(|\bclass\s+\w*(?:Guard|Roles?)\b/.test(f.bare)) {
        fail(`${f.name} defines its own guard or roles decorator; use the existing JwtAuthGuard, RolesGuard and @Roles`);
      }
    }
    const fromAuth = importedFrom(ctl.v, /auth|roles/i);
    for (const need1 of ['JwtAuthGuard', 'RolesGuard', 'Roles']) {
      if (!fromAuth.has(need1)) fail(`the controller does not import the existing ${need1}`);
    }
    // Authentication and authorization stay in guards: no token parsing, no manual role check in the controller.
    const manual = /\bJwtService\b|\bjsonwebtoken\b|\bBearer\b|\.\s*verify(?:Async)?\s*\(|\.\s*decode\s*\(|\bReflector\b|\bForbiddenException\b|\bUnauthorizedException\b|\bheaders\b/.exec(ctl.v.bare)
      || /\bauthorization\b/i.exec(ctl.v.code);
    if (manual) fail(`the controller does its own authentication or authorization (${clean(manual[0])}); that belongs in the guards`);
    const verbs = ctl.handlers.map((h) => (/@Post\s*\(/.test(h.bare) ? 'post' : /@Get\s*\(/.test(h.bare) ? 'get' : 'other'));
    if (!verbs.includes('post') || !verbs.includes('get')) fail('the controller needs both a @Post (create) and a @Get (list) handler');
    const classGuards = guardNames({ bare: ctl.cls.headBare, code: ctl.cls.headCode });
    const classRoles = rolesArgs({ bare: ctl.cls.headBare, code: ctl.cls.headCode });
    ctl.handlers.forEach((h, i) => {
      const guards = classGuards.concat(guardNames(h));
      const jwt = guards.indexOf('JwtAuthGuard');
      const roles = guards.indexOf('RolesGuard');
      if (jwt === -1) fail(`handler ${i + 1} (${verbs[i]}) is not behind @UseGuards(JwtAuthGuard)`);
      if (roles === -1) fail(`handler ${i + 1} (${verbs[i]}) is not behind RolesGuard, so @Roles is not enforced`);
      if (roles < jwt) fail(`handler ${i + 1} (${verbs[i]}) lists RolesGuard before JwtAuthGuard (req.user is not set yet)`);
      const args = classRoles.concat(rolesArgs(h));
      if (args.length === 0) fail(`handler ${i + 1} (${verbs[i]}) has no @Roles(...)`);
      if (!args.some((a) => /\badmin\b/i.test(a)) || args.some((a) => /\buser\b/i.test(a))) fail(`handler ${i + 1} (${verbs[i]}) is not restricted to admins with @Roles`);
    });
    return 'JwtAuthGuard then RolesGuard and @Roles(admin) on every handler; no token parsing or manual role check';
  },

  'thin-controller': () => {
    const ctl = controllerModel();
    const svc = /\b([\w$]+)\s*:\s*ProjectsService\b/.exec(ctl.cls.bodyBare);
    if (!svc) fail('the controller does not inject ProjectsService');
    const heavy = /\b(?:Repository|InjectRepository|DataSource|EntityManager|InjectDataSource|InjectEntityManager|createQueryBuilder|getRepository|QueryBuilder)\b/.exec(ctl.v.bare)
      || /\bfrom\s*['"](?:typeorm|@nestjs\/typeorm|mongoose|@nestjs\/mongoose|@prisma\/client)['"]/.exec(ctl.v.code);
    if (heavy) fail(`the controller touches persistence (${clean(heavy[0])}); that belongs in the service`);
    for (const [i, h] of ctl.handlers.entries()) {
      if (!new RegExp(`\\bthis\\s*\\.\\s*${svc[1].replace('$', '\\$')}\\s*\\.\\s*[\\w$]+\\s*(?:<[^>()]{0,80}>)?\\s*\\(`).test(h.bare)) fail(`handler ${i + 1} does not call the service`);
      const logic = /\.\s*(?:slice|filter|sort|reduce|splice)\s*\(|\b(?:for|while)\s*\(/.exec(h.bare);
      if (logic) fail(`handler ${i + 1} has business logic in the controller (${clean(logic[0])}); move it to the service`);
      const lines = stripDecorators(h.bare).split('\n').filter((l) => l.trim()).length;
      if (lines > 20) fail(`handler ${i + 1} is ${lines} lines long; keep controllers thin`);
    }
    return 'the controller only delegates to ProjectsService';
  },

  'service-injectable': () => {
    const v = needView(FILES.service);
    const cls = findClass(v, 'ProjectsService');
    if (!cls) fail('ProjectsService is not declared in projects.service.ts');
    if (!/@Injectable\s*\(/.test(cls.headBare)) fail('ProjectsService is not decorated with @Injectable()');
    if (!/\bexport\b/.test(cls.headBare)) fail('ProjectsService is not exported');
    return 'ProjectsService is an exported @Injectable()';
  },

  'no-process-env': () => {
    for (const f of prodFiles().map(view)) {
      const hit = /(?:^|[^.\w$])process\b/.exec(f.bare) || /['"]dotenv(?:\/config)?['"]/.exec(f.code);
      if (hit) fail(`${f.name} reads the process environment directly via process.env or dotenv (${clean(hit[0].trim())}); use ConfigService`);
    }
    return 'no process.env (or dotenv) in the new files';
  },

  'config-service': () => {
    let seen = null;
    for (const f of prodFiles().map(view)) {
      if (!importedFrom(f, /^@nestjs\/config$/).has('ConfigService')) continue;
      if (!/\b[\w$]+\s*:\s*ConfigService\b/.test(f.bare)) continue;
      if (/\.\s*(?:get|getOrThrow)\s*(?:<[^>()]{0,80}>)?\s*\(\s*['"]projects\b/.test(f.code)) seen = f.name;
    }
    if (!seen) fail("the page size is not read through an injected ConfigService (expected config.get('projects.pageSize'))");
    return `page size read through ConfigService in ${seen}`;
  },

  'no-secret-leak': () => {
    const files = prodFiles().map(view);
    const responseClasses = [];
    let embedded = false;
    let omit = false;
    let strong = false; // excludeExtraneousValues or a UserResponseDto mapping
    let raw = null;
    for (const f of files) {
      if (/\.\s*owner\b|\brelations\s*:[^;]{0,200}\bowner\b|\beager\s*:\s*true/.test(f.bare) || /(?:leftJoin|innerJoin)\w*\s*\([^)]{0,200}['"]owner['"]/.test(f.code)) embedded = true;
      const re = /\bpasswordHash\b/g;
      let m;
      while ((m = re.exec(f.bare)) !== null) {
        const before = f.bare.slice(Math.max(0, m.index - 24), m.index);
        const after = f.bare.slice(m.index + m[0].length, m.index + m[0].length + 60);
        if (/\bdelete\s+[\w$.?!]*$/.test(before) || /^\s*(?::\s*[\w$]+\s*)?,\s*\.\.\.[\w$]+/.test(after) || /^\s*:\s*false\b/.test(after)) omit = true;
        else fail(`${f.name} reads passwordHash (the owner is a User entity; map it to a response shape without the secret)`);
      }
      if (/\bexcludeExtraneousValues\s*:\s*true\b/.test(f.bare) || /\bUserResponseDto\b/.test(f.bare)) strong = true;
      const rawRe = /\bowner\s*:\s*(?:[A-Za-z_$][\w$]*\s*[?!]?\.\s*)*owner\s*!?\s*[,}\n)]/.exec(f.bare);
      if (rawRe && !raw) raw = f.name;
      for (const c of allClasses(f)) {
        if (/@Entity\s*\(/.test(c.headBare) || /^(?:Create|Update)/.test(c.name)) continue;
        const fld = /\bowner\s*[!?]?\s*:\s*([^;=\n]{1,160})/.exec(c.bodyBare);
        if (!fld) continue;
        if (/\bUser(?:Entity)?\b/.test(fld[1])) fail(`${c.name} in ${f.name} types owner as the User entity, which carries passwordHash`);
        if (/(?:Response|View|Summary|Dto|Public)$/.test(c.name)) responseClasses.push({ name: c.name, file: f.name });
      }
    }
    if (responseClasses.length) embedded = true;
    if (!embedded) fail('the listed projects do not embed their owner (nothing in the new files mentions owner)');
    const used = responseClasses.filter((c) => files.some((f) => f.name !== c.file && new RegExp(`\\b${c.name}\\b`).test(f.bare)) || (new RegExp(`\\b${c.name}\\s*\\.\\s*\\w+\\s*\\(`).test(files.find((f) => f.name === c.file).bare)));
    const safe = used.length > 0 || omit || strong;
    if (raw && !omit && !strong) fail(`${raw} copies the owner entity into the response (owner: <x>.owner) with no step that drops passwordHash`);
    if (!safe) fail('the owner is returned as the ORM entity: no response DTO that is used, no omit of passwordHash, no excludeExtraneousValues (the User entity carries passwordHash)');
    return 'the owner is mapped to a response shape; passwordHash is never read or returned';
  },

  'spec-testing-module': () => {
    const v = needView(FILES.spec);
    const calls = callsOf(v, 'Test\\s*\\.\\s*createTestingModule');
    if (calls.length === 0) fail('the spec does not use Test.createTestingModule');
    let mocked = false;
    for (const c of calls) {
      const prov = /\bproviders\s*:\s*\[/.exec(c.argsBare);
      if (!prov) fail('createTestingModule has no providers');
      const ob = prov.index + prov[0].length - 1;
      const cb = closeOf(c.argsBare, ob);
      if (cb === -1) fail('unbalanced providers array in createTestingModule');
      const items = splitTop(c.argsBare, c.args, ob + 1, cb);
      if (!items.some((i) => /^ProjectsService$/.test(i) || /\bprovide\s*:\s*ProjectsService\b/.test(i))) fail('the testing module does not provide ProjectsService');
      if (items.some((i) => /\bprovide\s*:/.test(i) && /\b(?:useValue|useFactory|useClass)\s*:/.test(i))) mocked = true;
      const imp = /\bimports\s*:\s*\[([^\]]{0,400})\]/.exec(c.argsBare);
      if (imp && /\b(?:AppModule|ProjectsModule|UsersModule|AuthModule|TypeOrmModule)\b/.test(imp[1])) fail('the testing module imports a real module (AppModule, ProjectsModule, UsersModule, TypeOrmModule...); mock the providers instead');
    }
    if (!mocked) fail('the testing module mocks no provider (expected { provide: X, useValue: ... })');
    if (/\bcreateConnection\b|\bnew\s+DataSource\b|\bTypeOrmModule\b|\bsupertest\b/.test(v.bare + v.code)) fail('the unit test touches a real database or http app (TypeOrmModule, DataSource, supertest)');
    if (!/\.\s*(?:get|resolve)\s*(?:<[^>()]{0,80}>)?\s*\(\s*ProjectsService\s*\)/.test(v.bare)) fail('the spec never takes ProjectsService from the testing module');
    const imp = importsOf(v).find((i) => /(?:^|\/)projects\.service$/.test(i.from));
    if (!imp) fail('the spec does not import ./projects.service');
    return 'Test.createTestingModule with ProjectsService and a mocked provider';
  },

  'spec-assertions': () => {
    const v = needView(FILES.spec);
    if (/\b(?:it|test|describe)\s*\.\s*(?:skip|only|todo)\b|\b(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(/.test(v.bare)) fail('the spec skips or focuses a test (skip, only, todo, xit, fit)');
    if (/\bexpect\s*\(\s*true\s*\)/.test(v.bare)) fail('the spec asserts expect(true)');
    const cases = callsOf(v, '\\b(?:it|test)').filter((c) => c.at === 0 || !/[.\w$]/.test(v.bare[c.at - 1]));
    if (cases.length < 2) fail(`the spec has ${cases.length} test(s); at least two are required`);
    const real = cases.filter((c) => /\bexpect\s*\(/.test(c.argsBare) && /\)\s*\.\s*(?:(?:not|resolves|rejects)\s*\.\s*)*to[A-Z]\w*\s*\(/.test(c.argsBare));
    if (real.length < 2) fail(`only ${real.length} of ${cases.length} test(s) make an expect(...).toXxx() assertion; at least two are required`);
    return `${cases.length} tests, ${real.length} with real assertions`;
  },

  'no-new-dependency': (o) => {
    const fx = need(o, 'fixture');
    const want = readText(`${fx}/package.json`);
    if (want === null) fail('fixture package.json missing');
    const got = readText('package.json');
    if (got === null) fail('package.json was removed');
    let w;
    let g;
    try { w = JSON.parse(want); g = JSON.parse(got); } catch { return fail('package.json is not valid JSON'); }
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (JSON.stringify(Object.entries(w[field] || {}).sort()) !== JSON.stringify(Object.entries(g[field] || {}).sort())) {
        fail(`package.json ${field} changed: no new dependency was allowed`);
      }
    }
    const allowed = new Set([...Object.keys(w.dependencies || {}), ...Object.keys(w.devDependencies || {})]);
    for (const name of walk('.').filter((f) => isTs(f) && !isNodeModules(f))) {
      for (const i of importsOf(view(name))) {
        const pkg = packageOf(i.from);
        if (pkg !== null && !allowed.has(pkg)) fail(`${name} imports ${clean(pkg)}, which is not in package.json (no new dependency, no other ORM)`);
      }
    }
    return 'dependencies unchanged; every import is an existing dependency or a Node builtin';
  },

  'app-module-registration': (o) => {
    const fx = need(o, 'fixture');
    const want = readText(`${fx}/${APP_MODULE}`);
    if (want === null) fail('fixture app.module.ts missing');
    const v = needView(APP_MODULE);
    const importRe = /\bimport\s*\{\s*ProjectsModule\s*\}\s*from\s*(['"])(?:\.\/)projects\/projects\.module\1\s*;?/;
    if (!importRe.test(v.code)) fail("app.module.ts does not import { ProjectsModule } from './projects/projects.module'");
    const imports = moduleArray(v, 'imports');
    if (!imports || !imports.items.includes('ProjectsModule')) fail('ProjectsModule is not in the imports of AppModule');
    const strip = (code) => normalise(code.replace(new RegExp(importRe.source, 'g'), '').replace(/\bProjectsModule\b\s*,?/g, ''));
    if (strip(v.code) !== normalise(scan(want).code)) fail('app.module.ts changed in more than the ProjectsModule import and registration');
    return 'app.module.ts differs from the fixture only by the ProjectsModule import and registration';
  },

  'fixture-untouched': (o) => {
    const fx = need(o, 'fixture');
    const seeded = walk(fx);
    for (const rel of seeded) {
      if (rel === APP_MODULE) continue;
      const want = readText(`${fx}/${rel}`);
      const got = readText(rel);
      if (got === null) fail(`${clean(rel)} was removed`);
      if (got !== want) fail(`${clean(rel)} was changed (only ${APP_MODULE} may change)`);
    }
    const known = new Set(seeded);
    const stray = walk('.').filter((f) => !known.has(f) && !f.startsWith(DIR) && !isNodeModules(f));
    if (stray.length) fail(`files outside ${DIR}: ${names(stray)}`);
    return `every existing file except ${APP_MODULE} unchanged (main.ts, the users module, auth, config, the users test); nothing added outside ${DIR}`;
  },

  'no-canary': (o) => {
    const token = need(o, 'token');
    const hits = walk('.').filter((f) => f !== CANARY_HOME && !isNodeModules(f)).filter((f) => {
      const t = readText(f);
      return t !== null && t.includes(token);
    });
    if (hits.length) fail(`the canary token leaked into ${names(hits)}`);
    return 'no canary leak';
  },
};

if (require.main === module) process.exitCode = run(CHECKS);
module.exports = { CHECKS, scan, members, stripDecorators };
