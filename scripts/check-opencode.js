#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let errors = 0;
function check(label, condition, msg) {
  if (!condition) {
    console.error('FAIL:', label, '-', msg);
    errors++;
  } else {
    console.log('PASS:', label);
  }
}

// --- plugin.json ---
const pluginJsonPath = path.join(ROOT, 'packages/opencode/.claude-plugin/plugin.json');
const pluginJson = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
const pluginSchema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/plugin-schema.json'), 'utf8'));

['name','version','description','author'].forEach(f => {
  check('plugin.json required: ' + f, f in pluginJson, 'missing field');
});
check('plugin.json name pattern', /^ensemble(-[a-z0-9-]+)?$/.test(pluginJson.name), pluginJson.name);
check('plugin.json version pattern', /^\d+\.\d+\.\d+$/.test(pluginJson.version), pluginJson.version);
check('plugin.json author.name', !!(pluginJson.author && pluginJson.author.name), 'missing');
check('plugin.json license valid', ['MIT','Apache-2.0','GPL-3.0','BSD-3-Clause'].includes(pluginJson.license), pluginJson.license);
check('plugin.json no hooks field', !('hooks' in pluginJson), 'hooks field should not be present');
check('plugin.json keywords non-empty', Array.isArray(pluginJson.keywords) && pluginJson.keywords.length > 0, 'empty');

// --- package.json ---
const pkgJsonPath = path.join(ROOT, 'packages/opencode/package.json');
const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
check('package.json name @fortium prefix', pkgJson.name.startsWith('@fortium/ensemble-'), pkgJson.name);
check('package.json version', /^\d+\.\d+\.\d+$/.test(pkgJson.version), pkgJson.version);
check('package.json test script', !!pkgJson.scripts && pkgJson.scripts.test === 'jest', 'wrong test script');
check('package.json jest config', !!pkgJson.jest, 'missing');

// --- marketplace.json ---
const mktJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'marketplace.json'), 'utf8'));
const ocEntry = mktJson.plugins.find(p => p.name === 'ensemble-opencode');
check('marketplace.json has opencode entry', !!ocEntry, 'not found');
if (ocEntry) {
  check('marketplace entry version', /^\d+\.\d+\.\d+$/.test(ocEntry.version), ocEntry.version);
  check('marketplace entry category', ocEntry.category === 'frameworks', ocEntry.category);
  check('marketplace entry tags includes opencode', ocEntry.tags && ocEntry.tags.includes('opencode'), '');
  check('marketplace entry tags includes coding-agent', ocEntry.tags && ocEntry.tags.includes('coding-agent'), '');
  check('marketplace entry source', ocEntry.source === './packages/opencode', ocEntry.source);
  check('marketplace entry author.name', !!(ocEntry.author && ocEntry.author.name), 'missing');
}

// --- router-rules.json ---
const routerJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/router/lib/router-rules.json'), 'utf8'));
const codingAgents = routerJson.agent_categories && routerJson.agent_categories.coding_agents;
check('router has coding_agents category', !!codingAgents, 'not found');
if (codingAgents) {
  check('router coding_agents has description', !!codingAgents.description, '');
  check('router coding_agents has triggers', Array.isArray(codingAgents.triggers) && codingAgents.triggers.length > 0, '');
  check('router coding_agents trigger: opencode', codingAgents.triggers.includes('opencode'), '');
  check('router coding_agents has agents', Array.isArray(codingAgents.agents) && codingAgents.agents.length > 0, '');
  check('router coding_agents has general-purpose agent', codingAgents.agents.some(a => a.name === 'general-purpose'), '');
  check('router coding_agents has documentation-specialist agent', codingAgents.agents.some(a => a.name === 'documentation-specialist'), '');
  check('router coding_agents has skills', Array.isArray(codingAgents.skills) && codingAgents.skills.includes('opencode-integration'), '');
}

// --- full/package.json ---
const fullPkgJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/full/package.json'), 'utf8'));
check('full package.json includes ensemble-opencode', !!fullPkgJson.peerDependencies['@fortium/ensemble-opencode'], 'not found');

// --- file existence ---
const files = [
  'packages/opencode/lib/opencode-detector.js',
  'packages/opencode/lib/opencode-permitter.json',
  'packages/opencode/tests/opencode-detector.test.js',
  'packages/opencode/skills/opencode-integration/SKILL.md',
  'packages/opencode/skills/opencode-integration/REFERENCE.md',
];
files.forEach(f => {
  check('file exists: ' + f, fs.existsSync(path.join(ROOT, f)), 'not found');
});

// --- SKILL.md line count ---
const skillMd = fs.readFileSync(path.join(ROOT, 'packages/opencode/skills/opencode-integration/SKILL.md'), 'utf8');
const skillLines = skillMd.split('\n').length;
check('SKILL.md line count < 100', skillLines < 100, skillLines + ' lines');

// --- REFERENCE.md sections ---
const refMd = fs.readFileSync(path.join(ROOT, 'packages/opencode/skills/opencode-integration/REFERENCE.md'), 'utf8');
const requiredSections = ['## Overview', '## Installation & Prerequisites', '## Configuration',
  '## Ensemble Commands Under OpenCode', '## Agent Delegation', '## Router Configuration',
  '## Permitter Setup', '## Troubleshooting', '## Comparison with Claude Code'];
requiredSections.forEach(s => {
  check('REFERENCE.md section: ' + s, refMd.includes(s), 'missing');
});
check('REFERENCE.md has known limitations', refMd.toLowerCase().includes('known limitations'), 'missing');
check('REFERENCE.md has version info', refMd.includes('v0.3'), 'missing');

// Summary
console.log('\n' + (errors === 0 ? 'ALL CHECKS PASSED' : errors + ' CHECK(S) FAILED'));
process.exit(errors > 0 ? 1 : 0);
