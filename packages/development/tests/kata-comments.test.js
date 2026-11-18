'use strict';

/**
 * TRD-008 -- comment append and listing (TRD-2026-6995dc96 TRD-008; PRD AC-008-3). A stateful stub
 * `kata` on PATH appends comments and replays them in `show --json`, so ordering is observed
 * end to end through runCapability.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { runCapability } = require('../lib/toolchain/runner');

// KATA_MANIFEST_OVERRIDE lets a RED run point at a scratch copy instead of mutating the shared file.
const MANIFEST = yaml.load(
  fs.readFileSync(
    process.env.KATA_MANIFEST_OVERRIDE ||
      path.join(__dirname, '..', 'skills', 'adapter-tracker-kata', 'adapter.yaml'),
    'utf8'
  )
);

const STUB = (dir) => `#!/bin/sh
echo "$@" >> "${dir}/args.log"
C="${dir}/comments"; touch "$C"
case "$1" in
  comment)
    # kata comment <ref> -m <text> --json
    echo "$4" >> "$C"
    echo '{"kata_api_version":1,"issue":{"short_id":"'"$2"'"},"comment":{"body":"'"$4"'"},"changed":true}' ;;
  show)
    out=""; n=0
    while IFS= read -r line; do n=$((n+1)); out="$out{\\"id\\":$n,\\"author\\":\\"a\\",\\"body\\":\\"$line\\"},"; done < "$C"
    echo "{\\"kata_api_version\\":1,\\"issue\\":{\\"short_id\\":\\"$2\\",\\"title\\":\\"t\\",\\"body\\":\\"\\",\\"status\\":\\"open\\"},\\"comments\\":[\${out%,}],\\"comments_truncated\\":false,\\"labels\\":[],\\"links\\":[]}" ;;
esac
`;

describe('kata comments', () => {
  let dir;
  let opts;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kata-comments-'));
    fs.writeFileSync(path.join(dir, 'args.log'), '');
    fs.writeFileSync(path.join(dir, 'kata'), STUB(dir), { mode: 0o755 });
    opts = { parentEnv: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` } };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('tracker.comment appends through `kata comment <id> -m <text>`', async () => {
    const res = await runCapability(MANIFEST, 'tracker.comment', { id: 'ab12', text: 'hello world' }, opts);
    expect(res.ok).toBe(true);
    const log = fs.readFileSync(path.join(dir, 'args.log'), 'utf8').trim();
    expect(log).toBe('comment ab12 -m hello world --json');
    expect(fs.readFileSync(path.join(dir, 'comments'), 'utf8')).toBe('hello world\n');
  });

  test('tracker.comments returns comments in the order written, as a comments array', async () => {
    await runCapability(MANIFEST, 'tracker.comment', { id: 'ab12', text: 'first' }, opts);
    await runCapability(MANIFEST, 'tracker.comment', { id: 'ab12', text: 'second' }, opts);
    const res = await runCapability(MANIFEST, 'tracker.comments', { id: 'ab12' }, opts);
    expect(res.ok).toBe(true);
    const data = res.data;
    expect(Array.isArray(data.comments)).toBe(true);
    expect(data.comments.map((c) => c.body)).toEqual(['first', 'second']);
  });

  test('an item with no comments yields an empty array', async () => {
    const res = await runCapability(MANIFEST, 'tracker.comments', { id: 'ab12' }, opts);
    expect(res.ok).toBe(true);
    expect(res.data.comments).toEqual([]);
  });

  test('carries the truncation flag so a cut-off history is not mistaken for complete', async () => {
    fs.writeFileSync(
      path.join(dir, 'kata'),
      `#!/bin/sh\necho '{"issue":{"short_id":"x"},"comments":[{"body":"a"}],"comments_truncated":true}'\n`,
      { mode: 0o755 }
    );
    const res = await runCapability(MANIFEST, 'tracker.comments', { id: 'x' }, opts);
    expect(res.ok).toBe(true);
    expect(res.data.comments_truncated).toBe(true);
  });
});
