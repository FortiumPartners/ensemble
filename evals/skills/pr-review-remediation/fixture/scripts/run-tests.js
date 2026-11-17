#!/usr/bin/env node
'use strict';

// Dependency-free test runner. Every .cases.js file in tests/ exports { 'test name': fn }; files run in name order.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'tests');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.cases.js')).sort();
let failed = 0;
for (const file of files) {
  const tests = require(path.join(dir, file));
  for (const [name, fn] of Object.entries(tests)) {
    try {
      fn();
      console.log(`ok - ${file.replace('.cases.js', '')}: ${name}`);
    } catch (e) {
      failed += 1;
      console.log(`not ok - ${file.replace('.cases.js', '')}: ${name}`);
      console.log(`  ${e.name}: ${String(e.message).split('\n')[0]}`);
    }
  }
}
console.log(`runner: ${failed} failed`);
process.exit(failed ? 1 : 0);
