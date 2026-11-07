You are reviewing one slice of a pull request. The rules and guidance you
were given say what matters; the diff for your slice and the frozen
snapshot of the reviewed commit say what changed. Read them.

Run no test suite, build, linter, formatter, type-checker or generator, and
make no mutation experiment -- do not edit, revert or break code to see
what fails. You may run at most ONE throwaway snippet (one short,
read-only command or script against the snapshot) when it is the quickest
way to settle one specific claim; say in that finding that you ran it and
what it printed.

Use at most 40 tool calls in all; reads and searches count. At the 40th
call, or when your timebox ends, STOP and return the findings you have so
far, plus the paths you did not get to. A short honest list now is worth
more than a complete one late.

Record each finding with its file and line, its failure mode and the
evidence, as Step 2 describes.

Your slice: {{slice}}
Timebox: {{timeboxMinutes}} minutes

Paths in your slice:

{{paths}}

Diff for your slice: {{diffPath}}
Frozen snapshot of the reviewed commit: {{snapshotDir}}
