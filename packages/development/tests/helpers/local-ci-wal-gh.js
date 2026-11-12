#!/usr/bin/env node
'use strict';

/**
 * A STATEFUL fake `gh` for tests that run the CLI as a real process (copied next to its data files by
 * helpers/local-ci-wal.js as `gh`, so `__dirname` is the fake's own directory). Files it reads or writes there:
 *   pr.json        the answer of `gh pr view`
 *   actions.json   { "<api path>": <json> }: the GET answers for the Actions lookups
 *   state.json     { next, statuses: [{id, state, context, description, sha}] } newest first; every accepted POST is stored
 *   refuse.json    [{state?, context?}]: a POST matching any rule exits 1 with "HTTP 403" and stores nothing
 *   argv.log       every invocation's argv, one per line, `---` between invocations
 * GET repos/<repo>/commits/<sha>/statuses?per_page=100 is answered from state.json, newest first, like GitHub.
 * Anything else exits 2.
 */

const fs = require('fs');
const path = require('path');

const dir = __dirname;
const argv = process.argv.slice(2);
const file = (name) => path.join(dir, name);
const read = (name) => JSON.parse(fs.readFileSync(file(name), 'utf8'));
const write = (name, value) => fs.writeFileSync(file(name), JSON.stringify(value));
const out = (value) => {
  fs.writeSync(1, typeof value === 'string' ? value : JSON.stringify(value));
  process.exit(0);
};
const die = (message, code) => {
  fs.writeSync(2, `${message}\n`);
  process.exit(code);
};

fs.appendFileSync(file('argv.log'), `${argv.join('\n')}\n---\n`);

if (argv[0] === 'pr' && argv[1] === 'view') out(read('pr.json'));

if (argv[0] === 'api' && argv[1] === '-X' && argv[2] === 'POST') {
  const target = /^repos\/([^/]+\/[^/]+)\/statuses\/([0-9a-f]{40})$/.exec(argv[3] || '');
  if (!target) die(`unexpected POST target: ${argv[3]}`, 2);
  const fields = {};
  for (let i = 4; i + 1 < argv.length; i += 2) {
    const kv = argv[i + 1];
    const eq = kv.indexOf('=');
    fields[kv.slice(0, eq)] = kv.slice(eq + 1);
  }
  const refused = read('refuse.json').some((r) => (r.state === undefined || r.state === fields.state) && (r.context === undefined || r.context === fields.context));
  if (refused) die('gh: HTTP 403: Resource not accessible by personal access token', 1);
  const state = read('state.json');
  state.next += 1;
  state.statuses.unshift({ id: state.next, state: fields.state, context: fields.context, description: fields.description, sha: target[2] });
  write('state.json', state);
  out({ id: state.next });
}

if (argv[0] === 'api' && argv.length === 2) {
  const apiPath = argv[1];
  const statuses = /^repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]{40})\/statuses\?per_page=100$/.exec(apiPath);
  if (statuses) {
    out(read('state.json').statuses.filter((s) => s.sha === statuses[1]).map(({ sha: _sha, ...rest }) => rest));
  }
  const answers = read('actions.json');
  if (Object.prototype.hasOwnProperty.call(answers, apiPath)) out(answers[apiPath]);
}

die(`unexpected gh call: ${argv.join(' ')}`, 2);
