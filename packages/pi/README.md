# @sunstone-partners/ensemble-pi

Pi runtime support — translates Ensemble YAML sources into Pi coding agent artifacts.

## Overview

`ensemble-pi` is the translation layer between the Ensemble plugin ecosystem and the
[Pi coding agent](https://github.com/mariozechner/pi). It reads Ensemble YAML command
definitions, agent manifests, and skill files from the monorepo and emits Pi-compatible
artifacts: prompt templates, agent definitions, skill directories, and an agent mesh reference.

The generated output lives inside this package and is loaded by Pi at runtime via the
`pi` manifest field in `package.json`.

## Installation

**From the Pi package registry:**

```bash
pi install @sunstone-partners/ensemble-pi
```

**Local development install:**

```bash
pi install ./packages/pi
```

### Native OMP delegation

Oh My Pi (OMP) loads this package through the same `pi` manifest. The agent
transformer maps an explicitly declared `Task` tool to OMP's native `task` tool.
OMP uses that lowercase name to infer spawn permission when `spawns` is absent;
its normal spawn-policy and recursion-depth guards still apply. Agents whose
source does not declare `Task` or `task` are not granted delegation.

In OMP, invoke the generated workflow skills, for example:

```text
/skill:ensemble-create-trd <prd-path>
```

The package supplies agent definitions, not a delegation implementation for
runtimes without a native `task` tool. The `Task` mapping does not change
approval gates. Model routing is a separate mechanism, described in the next
section.

### Model tiers and OMP roles

Ensemble agents declare an abstract model tier (`high` or `medium`). The agent
transformer writes it into the generated agent frontmatter as an OMP role-alias
list: `model: "@high,@default"` (8 agents) or `model: "@medium,@default"` (16
agents). OMP tries the list in order. `high` and `medium` are custom OMP roles,
not OMP built-ins, so they only exist once you define them in the OMP config
(`~/.omp/agent/config.yml`):

```yaml
modelRoles:
  default: <provider>/<model>
  high: <provider>/<model>
  medium: <provider>/<model>
```

What an agent runs on depends on which roles are configured:

1. The tier role is configured: the agent runs on that role's model.
2. The tier role is not configured but `modelRoles.default` is: the agent runs
   on the `default` model, so tiering has no effect.
3. Neither the tier role nor `modelRoles.default` is configured: `@default`
   resolves to nothing, the unresolved `@high` / `@medium` matches no model, and
   the agent cannot start ("No model selected").

To pin a single agent regardless of its tier, set `task.agentModelOverrides` in
the OMP config (agent name to model or role).

OMP itself reports neither case 2 nor case 3 usefully: case 2 is silent, and
case 3 fails with a "No model selected" error that advises `/login`. The
optional [`@sunstone-partners/ensemble-pi-extension`](../pi-extension/README.md#model-role-check),
installed from a checkout, reports both: a once-per-session warning for case
2, and for case 3 a refused spawn whose message names the missing
`modelRoles.<role>` keys, `~/.omp/agent/config.yml` and an example. It never
fires for a configured role or for an agent pinned with
`task.agentModelOverrides`. Without the extension, OMP stays quiet.

## Generated Artifacts

| Directory / File | Count | Description |
|-----------------|-------|-------------|
| `prompts/` | 38 files + `prompts/_hidden/` (8) | Prompt templates (one per Ensemble command outside the self-contained packages below; invoked `/ensemble-<cmd>`). `_hidden/` holds commands that are reachable only through a dispatcher; `package.json` `pi.prompts` is `./prompts/*.md` (non-recursive) so Pi does not register them |
| `agents/` | 34 files | Agent definition markdown (one per Ensemble agent) |
| `skills/` | one per skill | Skill documentation copied from all packages except `assessment` (see below) |
| `AGENTS.md` | 1 file | Agent mesh reference extracted from the monorepo |

All artifact counts reflect the current state after running `npm run generate:pi` from
the monorepo root. The `skills/` count is not pinned here; it varies as skills are added.

> **Assessment is not bundled.** The `assessment` package (`assess-*`,
> `architecture-overview-report`, `ai-readiness-diagnostic-report`,
> `assessment-report-suite`, `assessment-scoring-conflation-audit`) is excluded from
> `skills/` by the skill-copier. It ships as its own Pi package,
> `@sunstone-partners/ensemble-assessment`, together with its `/ensemble-assess` command
> (generated into `packages/assessment/prompts/`, not into `prompts/` here, because that prompt
> names skills this package does not contain). There is no dependency between the two
> packages, so install both if you want the workflow skills and assessments:
>
> ```bash
> pi install @sunstone-partners/ensemble-pi
> pi install @sunstone-partners/ensemble-assessment
> ```

### Self-contained packages

`SELF_CONTAINED_PI_PACKAGES` (`src/self-contained-packages.ts`) names the packages that are
installed as Pi packages of their own; today that is `assessment`. Listing a package there does two
things together, keyed by package directory and never by command name:

- the skill-copier skips its skills, so installing both packages never registers a skill twice;
- its commands are generated into the package itself (`<package>/prompts/` and the wrapper skills
  in `<package>/skills/`) by `generateSelfContainedPackages`, and `generate()` leaves them out of
  this package. Dispatcher refs resolve only within one package's own commands, so a command can
  never point at a prompt that package does not ship.

The wrapper skills of a self-contained package carry `user-invocable: false`: that package is also
a Claude Code plugin whose real command comes from the same YAML, and Claude Code would otherwise
list the Pi/OMP wrapper beside it. Pi and OMP ignore the key.

To add a package: list it in `SELF_CONTAINED_PI_PACKAGES`, give its `package.json` the `pi-package`
keyword and a `pi` manifest with `skills: ["./skills"]` and `prompts: ["./prompts/*.md"]` (the
non-recursive glob; a bare `./prompts` also registers `prompts/_hidden/`), and add `prompts/` to
its `files`. `tests/self-contained-packages.test.ts` checks the manifest and that nothing of the
package reaches this one. `npm run generate:pi` runs both generators (`generateAll`).

### Pruning stale output

The generator used to only add files, so removing or renaming a command, agent or skill left its
generated mirror behind. Every run now prunes: a generated file that the run did not reproduce is
removed, so the output always matches the sources (and CI's `git diff --exit-code` over the output
directories catches a source change committed without regenerating). `--dry-run` removes nothing,
`--verbose` logs every pruned path, and `generate()`, `generateSelfContainedPackages()` and
`generateAll()` resolve to `{ pruned: string[] }`: the absolute paths removed (on a dry run, the ones
that would be).

**Only a file the generator can prove it wrote is ever removed.** A file in the same directory that
carries no proof is hand-authored as far as the generator can tell, and stays.

| Output | Proof | Looked at |
|---|---|---|
| command prompts | first line is `<!-- Generated by ensemble-pi generator ... -->` | `prompts/*.md`, `prompts/_hidden/*.md` |
| command-wrapper skills | `disable-model-invocation: true`, `name` equal to the directory (`ensemble-<cmd>`), and the prompt's own `<!-- Command: ensemble-<cmd> \| Version: ... -->` as the first line of the body | `skills/ensemble-*/SKILL.md` |
| agents | the same marker comment, right after the frontmatter | `agents/*.md` |
| copied skills | the same marker comment, as the first line or right after the frontmatter | `skills/<name>/SKILL.md` and `REFERENCE.md`, and every `.md` below `skills/<name>/references/` |

A command that is backed by a skill (its YAML has a `skill:` key) is generated as a stub prompt whose third header line is `<!-- Skill: <name> -->`, and gets no command-wrapper skill: the source skill is copied by the skill copier, so there is exactly one skill per command. The skill is copied with its `references/` files when its SKILL.md names them: the copier ships every file a shipped file refers to by path, so an index SKILL.md that lists `references/phase-1-intake.md` and the like (in a table, a list or prose) ships each of them under `skills/<name>/references/`, stamped with the marker like the SKILL.md. A file in `references/` that nothing names is left out of the install, so name every one. The stub tells the agent to resolve the skill's relative paths against the skill's own directory, not the working directory. Pruning follows the skill: a reference that is deleted from the source, or that the SKILL.md stops naming, is pruned like the skill itself. If a generated wrapper would land on a copied source skill's path, `generate()` throws instead of overwriting it. A stub prompt is never mistaken for a wrapper, so pruning never removes the source skill.

The marker (`src/generated-marker.ts`) is why `agents/*.md` and every copied skill file start with a
comment line. A new writer into these directories must stamp its output with it, or its files will
never be pruned: `tests/prune-stale.test.ts` checks that every file the generator writes is
recognised. Beyond the table:

- a hand-authored file must not carry the marker: copying a generated file to start a new one
  brings the marker along, and the copy would then be pruned as stale, so delete that line first;
- nothing deeper than those paths is inspected (below `references/` there is no depth limit),
  symlinks are never followed (a `references/` that is one is not entered), and `AGENTS.md`,
  `vendor/` and placeholders such as `.gitkeep` are never touched;
- a directory that pruning empties is removed (a pruned skill's directory and its `references/`,
  `prompts/_hidden/`), but never `prompts/`, `agents/` or `skills/`, and one that still holds a
  hand-authored file stays;
- a wrapper generated from a prompt that is not itself generator output has no `Command:` line, so
  it is never pruned either;
- a command that changes visibility keeps exactly one copy of its prompt: the copy in the other
  location is pruned, with its wrapper skill when the command becomes hidden;
- a kind is pruned only if its sources were discovered at all. Finding no command YAML, no agent
  YAML or no skill points at a wrong `sourceRoot` or a broken glob, not at a repository that lost
  everything, and `--verbose` says when pruning of a kind is skipped for that reason;
- a self-contained package root gets its prompts and wrapper skills pruned and nothing else: the
  rest of `skills/` there is hand-authored source, whatever it contains;
- paths are compared case-folded, so on a case-insensitive filesystem a stale file whose name
  differs from the new one only in case is the file just written, not a stale one.

Agents and copied skills written before the marker existed carry none, so the first regeneration
after this change rewrites every live one with it and can prune none of them; a stale one among
them has to be deleted by hand, once.

## Usage

**Standard (via monorepo root):**

```bash
npm run generate:pi
```

**Direct CLI (after building):**

```bash
node packages/pi/dist/index.js
node packages/pi/dist/index.js --dry-run --verbose
node packages/pi/dist/index.js --validate
```

## CLI Flags

| Flag | Description |
|------|-------------|
| `--dry-run` | Preview all file writes and prunes without touching the disk |
| `--verbose` | Emit detailed progress for each transformer step, including every pruned file |
| `--validate` | Validate generated output against Pi schema rules; exit 1 on errors |

Flags can be combined: `--dry-run --verbose` previews all output with full logging.

Flags only reach the generator through the direct CLI. `npm run generate:pi -- --dry-run` does not
preview: the nested `npm run` consumes `--dry-run` itself and the generator runs for real, pruning
included. To see what a run would remove first, build and run `node packages/pi/dist/index.js
--dry-run --verbose`.

## Development

```bash
# Build TypeScript
npm run build

# Run tests
npm test

# Regenerate Pi artifacts from current Ensemble sources
npm run generate

# Validate versions are in sync (package.json vs plugin.json)
npm run validate:version
```

The `generate` script calls `node dist/index.js` after `build`. Run `npm run build &&
npm run generate` after any source changes.

## Architecture

```
Ensemble YAML sources (packages/*/commands/*.yaml, agents/*.yaml, skills/)
          |
          v
  Generator orchestrator (src/generator.ts)
          |
    ┌─────┴──────────────────────────────┐
    |             Transformer pipeline    |
    |  command-transformer   → prompts/  |
    |  agent-transformer     → agents/   |
    |  skill-copier          → skills/   |
    |  agents-md-generator   → AGENTS.md |
    └────────────────────────────────────┘
          |
          v
     Pi artifact output (this package)
```
**Transformer responsibilities:**

- **command-transformer** — converts Ensemble YAML `phases`/`steps`/`actions` into Pi
  prompt template markdown (for a self-contained Pi package, into that package's own
  `prompts/`)
- **agent-transformer** — converts YAML agent definitions into Pi agent markdown with
  Pi-compatible tool lists
- **skill-copier** — propagates `SKILL.md` files from all packages (except `pi`, `full`
  and the self-contained Pi packages) into `skills/`
- **agents-md-generator** — extracts the agent mesh overview from `packages/CLAUDE.md`
- **pruning** (`pruneStaleArtifacts` in `src/generator.ts`) — after the writers have run, removes
  the generated files this run did not reproduce (see Pruning stale output)
## Contributing

Bug reports and feature requests: [https://github.com/Sunstone-Partners/ensemble/issues](https://github.com/Sunstone-Partners/ensemble/issues)

See the [main ensemble repository](https://github.com/Sunstone-Partners/ensemble) for
development conventions, commit standards, and the PR process.

## License

Apache License 2.0. See the repository [LICENSE](../../LICENSE) and [NOTICE](../../NOTICE).
