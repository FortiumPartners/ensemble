/**
 * Builds the text of a dispatcher skill (SKILL.md) the way the shipped ones
 * are written: frontmatter, a `## Subcommands` section of one bullet per
 * keyword, then a `## Workflow` section that mentions bullets of its own.
 * Used by the fixture repos in the dispatcher tests; the format itself is
 * checked against the six real skills in lifecycle-resolve-command.test.ts.
 */
export interface SkillSubcommand {
  keyword: string;
  ref: string;
  description: string;
}

export function subcommandBullet(s: SkillSubcommand): string {
  return (
    `- **\`${s.keyword}\`** - ${s.description}. Invoke \`/ensemble:${s.ref}\` directly, ` +
    `or read and follow \`../ensemble-${s.ref}/SKILL.md\` (relative to this skill's directory), ` +
    `passing the remaining arguments through as its $ARGUMENTS.`
  );
}

export function dispatcherSkill(name: string, subcommands: SkillSubcommand[]): string {
  return [
    "---",
    `name: ensemble-${name}`,
    `description: Dispatch to a ${name} subcommand`,
    "---",
    "",
    `# ensemble:${name}`,
    "",
    "## Subcommands",
    "",
    ...subcommands.map(subcommandBullet),
    "",
    "## Workflow",
    "",
    "- **`not-a-subcommand`** - a bullet outside the Subcommands section. Invoke `/ensemble:nope` directly.",
    "",
  ].join("\n");
}
