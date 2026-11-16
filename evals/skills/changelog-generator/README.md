# changelog-generator eval

**Scope.** `packages/git/skills/changelog-generator`: turn conventional commits into a categorized changelog with breaking-change detection and a version-bump suggestion. Claude only, plain invocation (the skill has no command).

**Setup.** The fixture is a tiny repository (`README.md`, `package.json`) with no history. The prompt tells the agent to run `sh tools/seed-history.sh`, which tags `v1.0.0` and adds eight conventional commits (two features, two fixes of which one carries a `BREAKING CHANGE:` footer, a perf, a docs, a refactor with the `!` marker, a chore), then to write `CHANGELOG.md` and state the next version. The sandbox keeps only one fixture commit, so history cannot be shipped in the fixture; the seed script is the way to get real git history offline. The prompt is the same in both arms.

**What the checks cover** (`evals/checks/changelog-generator.js`): `history-seeded` (the `v1.0.0` tag file exists, so the changelog is not made up), `changelog-saved`, `breaking-section` (both breaking forms, no ordinary commit), `categories` (each commit under its own section only), `scopes`, `hashes` (7 to 40 hex characters on each commit line), `breaking-first` (category priority), `chore-excluded` (the skill's default), `version-bump` (2.0.0, a major bump). Commits are found by a keyword of the subject. Calibrated on the output of the skill's own `generate-changelog.js` run on the seeded history (everything passes except as noted below).

**Known limits.**

- Structure only, not wording or quality. No check runs git, so a fabricated but well-formed hash passes.
- `chore-excluded`, `breaking-first` and `version-bump` are convention-bound or presence checks (a changelog that says "not 2.0.0" passes; a baseline that lists chores fails by design).
- The prompt does not name categories, hashes or breaking-change handling, so the baseline arm is expected to measure the plugin's conventions, not skill versus a well-written prompt.
- The skill is mostly a script plus conventions. Whether its script path resolves inside the sandbox is unknown, so the with-skill arm may follow `SKILL.md` by hand.
- Calibration found two quirks of the shipped script on this history: a multi-line commit body (the footer commit) is printed under the subject, and the script splits `git log` output by line, so a commit body line is also read as a commit and produces an `Other Changes` entry of garbage (`- e ()`). The checks do not penalise an extra `Other Changes` section.
- Pi is not covered (the script needs a path the Pi loader does not provide).

**What a real trial must settle.** Whether agents run the seed script as told; whether the with-skill arm can load and run the script in the sandbox or hand-writes the changelog; whether the keywords still match real wording (for example a changelog that rewrites subjects); whether the chore exclusion and the `2.0.0` suggestion are what the skill's runs produce; any measured pass rate or uplift (none is stated here).
