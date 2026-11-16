#!/bin/sh
# Ignores trailing arguments (the package-runner adapter appends `-- ${args}`), runs the node test runner over test/ when it exists.
[ -d test ] || { echo "no tests yet"; exit 0; }
exec node --test test/
