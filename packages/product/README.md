# @sunstone-partners/ensemble-product

Product management agents and workflows (PRD creation, analysis)

## Installation

```bash
claude plugin install @sunstone-partners/ensemble-product
```

## Description

Part of the ensemble plugin ecosystem for Claude Code. This plugin provides product management agents and workflows (prd creation, analysis).

## Features

- Parse structured PRD requirements and acceptance criteria.
- Generate Gherkin features and Reqnroll/xUnit bindings deterministically.
- Check binding drift and migrate generated expressions without replacing implementations.

## Usage

After installation, this plugin's agents, commands, and skills will be automatically available in Claude Code.

### Literal Reqnroll bindings

`lib/reqnroll-cli.js generate-bindings <prd-path> --out <directory>` emits explicitly anchored, escaped regular expressions. Slashes, parentheses, braces, quotes and regex punctuation in an acceptance clause remain literal text rather than becoming Cucumber alternatives, optional text or parameters.

Normal regeneration preserves filled method bodies and upgrades recognized legacy attributes in their standard generated filenames. Do **not** use `--force` to migrate: it deliberately resets bodies to Pending.

For existing projects with renamed or split partial binding classes:

```sh
node packages/product/lib/reqnroll-cli.js migrate-bindings docs/PRD/example.md \
  --steps-dir tests/acceptance/Steps --dry-run --json
node packages/product/lib/reqnroll-cli.js migrate-bindings docs/PRD/example.md \
  --steps-dir tests/acceptance/Steps --json
node packages/product/lib/reqnroll-cli.js check-binding-drift docs/PRD/example.md \
  --steps-dir tests/acceptance/Steps --json
```

The migration scans nested `.cs` files, changes only recognized generated verbatim attributes and preserves every other byte, including method bodies and line endings. Attribute-shaped comments, strings and collection expressions are not bindings. Unknown custom expressions remain untouched. Symlink traversal, unterminated literals and ambiguous old/current expressions fail closed; inspect such input rather than guessing its meaning. Logical step text and fingerprints remain the drift identity, not the regex encoding.
Supply a physical directory path: symbolic links at the directory root, in its ancestors, or among its entries are refused before migration writes any files.

Without `--steps-dir`, migration and drift checking use `<out>/<PRD-slug>/Steps`, with `tests` as the default output root. A second migration is a no-op.

## Documentation

See the [main ensemble repository](https://github.com/Sunstone-Partners/ensemble) for complete documentation.

## License

MIT
