<invoke name="bash">
<parameter name="command">cd /Users/ldangelo/.foreman/worktrees/ensemble/br-bhj9/run-488ac083a99c847cd3cc780684deee95/workspace && grep -rn "65536\|writeSync\|exitCode" packages/development/lib/*.js | head -20; echo "--- similar truncation bug in siblings ---"; grep -rln "process.exit(" packages/*/lib/*.js | head -20</parameter>
</invoke>