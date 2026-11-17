#!/usr/bin/env node
'use strict';

// Dependency-free test runner. Every .cases.js file in tests/ exports { 'test name': fn } and all files run in ONE process, in a shuffled order.
//   node scripts/run-tests.js                      random seed (printed on the first line)
//   node scripts/run-tests.js --seed 1234          replay the order that seed produced
//   node scripts/run-tests.js --order a.cases.js,b.cases.js   run exactly these files, in this order
//   node scripts/run-tests.js --shard 2/3          run only shard 2 of 3 (files dealt out after the shuffle)
//   node scripts/run-tests.js --retries N          re-run each failing test up to N more times
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const dir = path.join(__dirname, '..', 'tests');
let files = fs.readdirSync(dir).filter((f) => f.endsWith('.cases.js')).sort();
const seed = opt('seed') !== undefined ? Number(opt('seed')) : Math.floor(Math.random() * 1e7);
if (opt('order')) {
  files = opt('order').split(',').map((f) => f.trim());
} else {
  const rand = mulberry32(seed);
  for (let i = files.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [files[i], files[j]] = [files[j], files[i]];
  }
}
if (opt('shard')) {
  const [n, of] = opt('shard').split('/').map(Number);
  files = files.filter((_, i) => i % of === n - 1);
}
const retries = Number(opt('retries') || 0);

console.log(`runner: seed=${seed}`);
console.log(`runner: order=${files.join(',')}`);
let failed = 0;
for (const file of files) {
  const tests = require(path.join(dir, file));
  for (const [name, fn] of Object.entries(tests)) {
    let error = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try { fn(); error = null; break; } catch (e) { error = e; }
    }
    if (error) {
      failed += 1;
      console.log(`not ok - ${file.replace('.cases.js', '')}: ${name}`);
      console.log(`  ${error.name}: ${String(error.message).split('\n')[0]}`);
    } else {
      console.log(`ok - ${file.replace('.cases.js', '')}: ${name}`);
    }
  }
}
console.log(`runner: ${failed} failed`);
process.exit(failed ? 1 : 0);
