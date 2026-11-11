'use strict';

/**
 * /ensemble:assess is the single entry point for the assessment skills.
 *
 * It is an ordinary command with a routing workflow, NOT a `dispatch:` command:
 * dispatch.subcommands[].ref must name a sibling COMMAND (schema-validator.js step 5;
 * every generator throws on an unknown ref), and every target here is a SKILL. The routes are
 * therefore workflow actions in the form
 *
 *     `<token>` -> `skill://<skill-name>` - <description>
 *
 * and these tests parse them. Like the other assessment tests they are structural assertions
 * over prose sources (there is no runtime harness for a command), reading the files at run
 * time so editing a description never needs a test edit. They guard:
 *
 *   (a) every keyword and every `--only` dimension names a skill directory that exists, and
 *       the `--only` dimensions are exactly the ones assess-repo itself dispatches to;
 *   (b) the halting rules (empty/unknown keyword, misplaced or unknown --only) and the
 *       load-by-name fallback are present, and no leaf logic is re-inlined;
 *   (c) the generated Claude command is current, the Claude generator can discover the
 *       command, and ensemble-full registers and mirrors it.
 *
 * The Pi side (prompt and wrapper skill landing in this package and not in ensemble-pi) is
 * covered by packages/pi/tests/self-contained-packages.test.ts.
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const PKG_DIR = path.join(__dirname, '..');
const ROOT = path.join(PKG_DIR, '..', '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');
const SKILLS_DIR = path.join(PKG_DIR, 'skills');
const COMMAND_YAML = path.join(PKG_DIR, 'commands', 'assess.yaml');
const COMMAND_MD = path.join(PKG_DIR, 'commands', 'ensemble', 'assess.md');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const skillFile = (name) => path.join(SKILLS_DIR, name, 'SKILL.md');
const frontmatterName = (text) => (text.match(/^---\n[\s\S]*?^name:\s*(\S+)\s*$/m) || [])[1];

// `<token>` -> `skill://<name>` (optionally "`<token>` (alias `<alias>`)").
const ROUTE = /^`([a-z][a-z-]*)`(?: \(alias `([a-z][a-z-]*)`\))? -> `skill:\/\/([a-z0-9-]+)`/;
const LOOKS_LIKE_ROUTE = /^`[^`]+`.* -> /;

const command = yaml.load(fs.readFileSync(COMMAND_YAML, 'utf8'));
// The command is a manifest; the routing prose lives in the skill it names. Each
// "### Step N: ..." section carries its actions as a numbered list.
const SKILL_FILE = skillFile(command.skill);
const skillText = fs.readFileSync(SKILL_FILE, 'utf8');
const steps = [...skillText.matchAll(/^### Step (\d+): .*$([\s\S]*?)(?=^#{1,3} |(?![\s\S]))/gm)].map((match) => ({
  order: Number(match[1]),
  actions: [...match[2].matchAll(/^\d+\. (.*)$/gm)].map((item) => item[1]),
}));
const stepActions = (order) =>
  steps
    .filter((step) => step.order === order)
    .flatMap((step) => step.actions.map((action) => String(action)));
const ROUTE_STEP = 1;
const ONLY_STEP = 2;
const LOAD_STEP = 3;

const parseRoutes = (actions) =>
  actions.map((action) => action.match(ROUTE)).filter(Boolean).map(([, token, alias, skill]) => ({ token, alias, skill }));

// What assess-repo itself dispatches to: each "Load the `<leaf>` skill and follow it." block and
// the findings-file suffix (`docs/assessment/<REPORT_PREFIX>-<suffix>.md`) it names.
function assessRepoDimensions() {
  const text = fs.readFileSync(skillFile('assess-repo'), 'utf8');
  return [...text.matchAll(/^Load the `([^`\s]+)` skill and follow it\.$/gm)].map((match) => {
    const block = text.slice(match.index, text.indexOf('```', match.index));
    return { leaf: match[1], suffix: (block.match(/<REPORT_PREFIX>-([a-z-]+)\.md/) || [])[1] };
  });
}

describe('/ensemble:assess command source', () => {
  const keywordRoutes = parseRoutes(stepActions(ROUTE_STEP));
  const onlyRoutes = parseRoutes(stepActions(ONLY_STEP));

  test('is the ensemble:assess command, emitted to ensemble/assess.md', () => {
    expect(command.metadata.name).toBe('ensemble:assess');
    expect(command.metadata.output_path).toBe('ensemble/assess.md');
    expect(command.metadata.visibility).not.toBe('hidden'); // the front door stays typable
  });

  test('routes by workflow actions, because a dispatch: block cannot name skills', () => {
    expect(command.dispatch).toBeUndefined();

    // The reason, demonstrated against the real validator: a skill ref is rejected.
    const { validateCommandSchema } = require('../../../scripts/lib/schema-validator');
    const commandNames = new Set(
      fs
        .readdirSync(PACKAGES_DIR)
        .flatMap((pkg) => {
          const dir = path.join(PACKAGES_DIR, pkg, 'commands');
          return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.yaml')).map((f) => path.join(dir, f)) : [];
        })
        .map((file) => yaml.load(fs.readFileSync(file, 'utf8')).metadata.name.replace(/^ensemble:/, ''))
    );
    const asDispatcher = { ...command, dispatch: { subcommands: [{ keyword: 'repo', ref: 'assess-repo' }] } };
    expect(commandNames.has('assess-repo')).toBe(false); // it is a skill, not a command
    expect(() => validateCommandSchema(asDispatcher, COMMAND_YAML, new Set(), commandNames)).toThrow();
    expect(() => validateCommandSchema(command, COMMAND_YAML, new Set(), commandNames)).not.toThrow();
  });

  test('every route-shaped action parses, so none is silently ignored', () => {
    for (const order of [ROUTE_STEP, ONLY_STEP]) {
      const unparsed = stepActions(order).filter((action) => LOOKS_LIKE_ROUTE.test(action) && !ROUTE.test(action));
      expect(unparsed).toEqual([]);
    }
  });

  test('routes repo, team, config and report to their assessment skills', () => {
    expect(keywordRoutes.map(({ token, skill }) => [token, skill])).toEqual([
      ['repo', 'assess-repo'],
      ['team', 'assess-team'],
      ['config', 'assess-config'],
      ['report', 'assessment-report-suite'],
    ]);
    expect(keywordRoutes.every(({ alias }) => alias === undefined)).toBe(true);
  });

  test('maps --only dimensions to exactly the leaves assess-repo dispatches to, under its own dimension names', () => {
    const dimensions = assessRepoDimensions();
    expect(dimensions.length).toBeGreaterThan(0); // the scan is not vacuous
    expect(dimensions.every(({ suffix }) => typeof suffix === 'string')).toBe(true);

    // No dimension invented, none dropped.
    expect(onlyRoutes.map(({ skill }) => skill).sort()).toEqual(dimensions.map(({ leaf }) => leaf).sort());

    for (const { token, alias, skill } of onlyRoutes) {
      const { suffix } = dimensions.find(({ leaf }) => leaf === skill);
      // The canonical token is assess-repo's findings-file name for the dimension...
      expect(token).toBe(suffix);
      // ...and the leaf's own name without `assess-` is always accepted too.
      expect([token, alias]).toContain(skill.replace(/^assess-/, ''));
    }
  });

  test('names only skill directories that exist, whose frontmatter name is the directory name', () => {
    const everything = steps.flatMap((step) => step.actions.map(String)).join('\n');
    const referenced = [...new Set([...everything.matchAll(/skill:\/\/([a-z0-9-]+)/g)].map((match) => match[1]))];
    const routed = [...keywordRoutes, ...onlyRoutes].map(({ skill }) => skill);
    expect(routed.length).toBeGreaterThan(0);
    expect(referenced).toEqual(expect.arrayContaining(routed));
    for (const name of referenced) {
      expect(fs.existsSync(skillFile(name))).toBe(true);
      expect(frontmatterName(fs.readFileSync(skillFile(name), 'utf8'))).toBe(name);
    }
  });

  test('prints the keyword table and halts with no side effect for an empty or unknown first token', () => {
    const text = stepActions(ROUTE_STEP).join('\n');
    expect(text).toMatch(
      /If the first token matches no keyword, or \$ARGUMENTS is empty: print the keyword table below \(keyword \+ one-line description\) and HALT without side effects\./
    );
    // The table it prints follows that rule, so it is the one the user actually sees.
    const rule = stepActions(ROUTE_STEP).findIndex((action) => /matches no keyword/.test(action));
    const firstRoute = stepActions(ROUTE_STEP).findIndex((action) => ROUTE.test(action));
    expect(rule).toBeGreaterThanOrEqual(0);
    expect(firstRoute).toBeGreaterThan(rule);
  });

  test('halts without side effects for --only outside repo, and for a missing or unknown dimension', () => {
    const text = stepActions(ONLY_STEP).join('\n');
    expect(text).toMatch(/`--only <dimension>` is accepted with `repo` only/);
    expect(text).toMatch(/present with any other keyword: .*applies to `repo` only, and HALT without side effects/);
    expect(text).toMatch(/has no value, or its value is not a dimension below: print the dimension table below.*HALT without side effects/);
  });

  test('runs a valid --only dimension stand-alone: no assess-repo, no parallel tasks, no combined report', () => {
    const text = stepActions(ONLY_STEP).join('\n');
    expect(text).toMatch(/load that dimension's leaf skill instead of `assess-repo`/);
    expect(text).toMatch(/Do not load `assess-repo`, do not launch the parallel dimension tasks and do not write the combined report/);
  });

  test('carries the load-by-name fallback that the orchestrators carry', () => {
    const load = stepActions(LOAD_STEP).join('\n');
    expect(load).toMatch(/If your runtime cannot load a skill by name, read that skill's `SKILL\.md` file yourself/);
    // Same wording family as assess-repo's own fallback, so the two stay recognizably one rule.
    expect(fs.readFileSync(skillFile('assess-repo'), 'utf8')).toMatch(/cannot load a skill by name/);
  });

  test('stays a thin router: no leaf output template, scoring heading or analysis prompt is re-inlined', () => {
    const everything = steps.flatMap((step) => step.actions.map(String)).join('\n');
    expect(everything).not.toMatch(/Output structure|^#{1,6}\s*Score\s*(?::|$)|^Analyze:/m);
    expect(everything).not.toMatch(/Score:/);
  });
});

describe('/ensemble:assess generated artifacts and wiring', () => {
  test('commands/ensemble/assess.md is what the Claude generator writes from the YAML', () => {
    const { generateMarkdown } = require('../../../scripts/lib/markdown-generator');
    expect(fs.readFileSync(COMMAND_MD, 'utf8')).toBe(generateMarkdown(command, 'command', COMMAND_YAML));
  });

  test('plugin.json registers the commands directory, and the Claude generator discovers the command through it', async () => {
    expect(readJson(path.join(PKG_DIR, '.claude-plugin', 'plugin.json')).commands).toBe('./commands');

    const { discoverYamlFiles } = require('../../../scripts/lib/file-discovery');
    const discovered = await discoverYamlFiles(PACKAGES_DIR, { types: ['commands'] });
    expect(discovered.commands.map((file) => path.resolve(file))).toContain(path.resolve(COMMAND_YAML));
  });

  test('ships the command and the Pi prompt in the npm package, next to the skills', () => {
    expect(readJson(path.join(PKG_DIR, 'package.json')).files).toEqual(
      expect.arrayContaining(['commands/', 'prompts/', 'skills/'])
    );
  });

  test('ensemble-full mirrors the command directory and lists it in its plugin.json', () => {
    const mirror = path.join(PACKAGES_DIR, 'full', 'commands', 'assessment');
    const stat = fs.lstatSync(mirror);
    // A checkout without core.symlinks stores a link as a small file holding the target.
    const target = stat.isSymbolicLink() ? fs.readlinkSync(mirror) : fs.readFileSync(mirror, 'utf8').trim();
    expect(target.split(path.sep).join('/')).toBe('../../assessment/commands/ensemble');
    if (stat.isSymbolicLink()) {
      expect(fs.existsSync(path.join(mirror, 'assess.md'))).toBe(true);
    }

    const full = readJson(path.join(PACKAGES_DIR, 'full', '.claude-plugin', 'plugin.json'));
    expect(full.commands).toContain('./commands/assessment');
  });
});
