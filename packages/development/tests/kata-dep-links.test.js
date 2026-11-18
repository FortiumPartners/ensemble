'use strict';

/**
 * TRD-013 -- dependency links through kata's blocked-by edge (TRD-2026-6995dc96 TRD-013;
 * AC-005-1, AC-005-2, AC-005-3). A stateful stub `kata` on PATH models the readiness contract
 * (an open item with an open blocker leaves `ready`), so no real kata daemon is needed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const yaml = require('js-yaml');

const { runCapability } = require('../lib/toolchain/runner');

// KATA_MANIFEST_OVERRIDE lets a RED run point at a scratch copy of the manifest instead of mutating
// the shared file.
const MANIFEST = yaml.load(
  fs.readFileSync(
    process.env.KATA_MANIFEST_OVERRIDE ||
      path.join(__dirname, '..', 'skills', 'adapter-tracker-kata', 'adapter.yaml'),
    'utf8'
  )
);

// State: one `edges` file of "A B" lines (A blocked by B). Items A and B are open.
const STUB = (dir) => `#!/bin/sh
echo "$@" >> "${dir}/args.log"
E="${dir}/edges"; touch "$E"
case "$1" in
  edit)
    id="$2"; flag="$3"; ref="$4"
    if [ "$flag" = "--blocked-by" ]; then echo "$id $ref" >> "$E"
    elif [ "$flag" = "--remove-blocked-by" ]; then grep -v "^$id $ref\\$" "$E" > "$E.n"; mv "$E.n" "$E"; fi
    echo '{"kata_api_version":1,"issue":{"short_id":"'"$id"'"}}' ;;
  ready)
    out=""
    for i in A B; do
      grep -q "^$i " "$E" || out="$out{\\"short_id\\":\\"$i\\",\\"title\\":\\"t\\",\\"status\\":\\"open\\"},"
    done
    echo "{\\"issues\\":[\${out%,}]}" ;;
esac
`;

describe('kata dependency links', () => {
  let dir;
  let opts;
  const ready = async () => {
    const res = await runCapability(MANIFEST, 'work-graph.ready', {}, opts);
    expect(res.ok).toBe(true);
    return (res.data || res.result || res).items.map((i) => i.id);
  };
  const argLog = () => fs.readFileSync(path.join(dir, 'args.log'), 'utf8').trim().split('\n');

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kata-deps-'));
    fs.writeFileSync(path.join(dir, 'args.log'), '');
    fs.writeFileSync(path.join(dir, 'kata'), STUB(dir), { mode: 0o755 });
    opts = { parentEnv: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` } };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test('AC-005-1: dep-add runs kata edit A --blocked-by B and A leaves the ready listing', async () => {
    expect(await ready()).toEqual(['A', 'B']);
    const res = await runCapability(MANIFEST, 'tracker.dep-add', { id: 'A', dependsOnId: 'B', type: 'blocks' }, opts);
    expect(res.ok).toBe(true);
    expect(argLog()).toContain('edit A --blocked-by B --json');
    expect(await ready()).toEqual(['B']);
  });

  test('AC-005-2: dep-remove runs kata edit A --remove-blocked-by B and A reappears', async () => {
    await runCapability(MANIFEST, 'tracker.dep-add', { id: 'A', dependsOnId: 'B', type: 'blocks' }, opts);
    expect(await ready()).toEqual(['B']);
    const res = await runCapability(MANIFEST, 'tracker.dep-remove', { id: 'A', dependsOnId: 'B' }, opts);
    expect(res.ok).toBe(true);
    expect(argLog()).toContain('edit A --remove-blocked-by B --json');
    expect(await ready()).toEqual(['A', 'B']);
  });

  test.each(['related', 'parent', 'parent-child', 'discovered-from'])(
    'AC-005-3: kind %s is refused with a reason and no kata edit runs',
    async (type) => {
      const res = await runCapability(MANIFEST, 'tracker.dep-add', { id: 'A', dependsOnId: 'B', type }, opts);
      expect(res.ok).toBe(false);
      expect(res.error.code).toBe('NOT_ALLOWED');
      expect(res.error.message).toMatch(new RegExp(`'${type}'`));
      expect(res.error.message).toMatch(/blocks/);
      expect(argLog().filter((l) => l.startsWith('edit'))).toEqual([]);
      expect(await ready()).toEqual(['A', 'B']);
    }
  );

  test('omitted type is a plain blocking edge (base run)', async () => {
    const res = await runCapability(MANIFEST, 'tracker.dep-add', { id: 'A', dependsOnId: 'B' }, opts);
    expect(res.ok).toBe(true);
    expect(argLog()).toContain('edit A --blocked-by B --json');
  });

  test('manifest: blocks is the only dep-add kind', () => {
    expect(Object.keys(MANIFEST.capabilities['tracker.dep-add'].variants.type)).toEqual(['blocks']);
  });

  test('mutation witness: mapping related to --blocked-by makes the call succeed and withholds A (what the refusal tests forbid)', async () => {
    const mutated = JSON.parse(JSON.stringify(MANIFEST));
    mutated.capabilities['tracker.dep-add'].variants.type.related = ['kata', 'edit', '${id}', '--blocked-by', '${dependsOnId}', '--json'];
    const res = await runCapability(mutated, 'tracker.dep-add', { id: 'A', dependsOnId: 'B', type: 'related' }, opts);
    expect(res.ok).toBe(true);
    expect(await ready()).toEqual(['B']);
  });
});
