#!/usr/bin/env node
/**
 * deep-analysis.js - Raw data analysis without LLM
 *
 * Generates comprehensive raw score tables for manual inspection.
 * Unlike generate-analysis-report.js, this runs locally without Claude API calls.
 *
 * Usage: node deep-analysis.js <results-dir>
 *
 * Output sections:
 *   1. Raw scores by eval and variant
 *   2. Aggregate by variant (all evals combined)
 *   3. Aggregate by eval (all variants combined)
 *   4. Dimension-level scores (sampled)
 *   5. Variance analysis
 *   6. Eval × variant comparison tables
 */

const fs = require('fs');
const path = require('path');

const RUBRICS = ['code-quality', 'test-quality', 'architecture', 'error-handling'];

function showUsage() {
  console.log('Usage: node deep-analysis.js <results-dir>');
  console.log('');
  console.log('Generates raw score tables for analysis (no LLM required).');
  console.log('Requires detailed-scores.json files (run consolidate-scores.js first).');
  process.exit(1);
}

// Discover evals from directory structure
function discoverEvals(resultsDir) {
  const evals = [];
  const entries = fs.readdirSync(resultsDir);

  for (const entry of entries) {
    const fullPath = path.join(resultsDir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory() && !entry.startsWith('.') && !entry.endsWith('.log')) {
      // Check if this looks like an eval directory (has session subdirs)
      const subEntries = fs.readdirSync(fullPath);
      const hasSessionDirs = subEntries.some(sub => {
        const subPath = path.join(fullPath, sub);
        return fs.statSync(subPath).isDirectory() && sub.includes('-');
      });

      if (hasSessionDirs) {
        evals.push(entry);
      }
    }
  }

  return evals.sort();
}

// Collect all data
function collectData(resultsDir, evals) {
  const allData = [];

  for (const evalName of evals) {
    const evalDir = path.join(resultsDir, evalName);
    if (!fs.existsSync(evalDir)) continue;

    const sessions = fs.readdirSync(evalDir).filter(d => {
      const fullPath = path.join(evalDir, d);
      return fs.statSync(fullPath).isDirectory() && d.includes('-');
    });

    for (const sessionId of sessions) {
      const detailedPath = path.join(evalDir, sessionId, 'detailed-scores.json');
      if (fs.existsSync(detailedPath)) {
        const scores = JSON.parse(fs.readFileSync(detailedPath, 'utf8'));
        allData.push({
          eval: evalName,
          session: sessionId.substring(0, 8),
          variant: scores.variant,
          total: scores.total_score,
          max: scores.max_score,
          pct: scores.normalized_score,
          rubrics: scores.by_rubric
        });
      }
    }
  }

  return allData;
}

// Main
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  showUsage();
}

const resultsDir = path.resolve(args[0]);
if (!fs.existsSync(resultsDir)) {
  console.error(`Error: Directory not found: ${resultsDir}`);
  process.exit(1);
}

const evals = discoverEvals(resultsDir);
if (evals.length === 0) {
  console.error('Error: No eval directories found');
  process.exit(1);
}

const allData = collectData(resultsDir, evals);

console.log('='.repeat(100));
console.log('DEEP ANALYSIS - ENSEMBLE FRAMEWORK EVALUATION');
console.log('='.repeat(100));
console.log(`\nResults directory: ${resultsDir}`);
console.log(`Total sessions analyzed: ${allData.length}`);
console.log(`Evals: ${evals.join(', ')}`);
console.log(`Variants: baseline, framework, full-workflow`);

// ============================================
// SECTION 1: RAW SCORES BY EVAL
// ============================================
console.log('\n' + '='.repeat(100));
console.log('SECTION 1: RAW SCORES BY EVAL AND VARIANT (rubric_total values)');
console.log('='.repeat(100));

for (const evalName of evals) {
  const evalData = allData.filter(d => d.eval === evalName);

  console.log(`\n### ${evalName.toUpperCase()} (${evalData.length} sessions) ###\n`);
  console.log('Session  | Variant       | TOTAL  | CQ/21  | TQ/21  | ARCH/21 | ERR/26.25 | %');
  console.log('-'.repeat(90));

  // Sort by variant then session
  evalData.sort((a, b) => a.variant.localeCompare(b.variant) || a.session.localeCompare(b.session));

  for (const s of evalData) {
    const cq = s.rubrics?.['code-quality']?.rubric_total?.toFixed(2) || 'N/A';
    const tq = s.rubrics?.['test-quality']?.rubric_total?.toFixed(2) || 'N/A';
    const arch = s.rubrics?.architecture?.rubric_total?.toFixed(2) || 'N/A';
    const err = s.rubrics?.['error-handling']?.rubric_total?.toFixed(2) || 'N/A';

    console.log(
      `${s.session} | ${s.variant.padEnd(13)} | ${String(s.total).padStart(6)} | ${cq.padStart(6)} | ${tq.padStart(6)} | ${arch.padStart(7)} | ${err.padStart(9)} | ${s.pct}%`
    );
  }
}

// ============================================
// SECTION 2: AGGREGATE BY VARIANT (ALL EVALS)
// ============================================
console.log('\n' + '='.repeat(100));
console.log('SECTION 2: AGGREGATE BY VARIANT (ALL EVALS COMBINED)');
console.log('='.repeat(100));

const byVariant = { baseline: [], framework: [], 'full-workflow': [] };
for (const d of allData) {
  if (byVariant[d.variant]) byVariant[d.variant].push(d);
}

for (const [variant, sessions] of Object.entries(byVariant)) {
  console.log(`\n### ${variant.toUpperCase()} (n=${sessions.length}) ###\n`);

  // Calculate rubric totals
  const rubricSums = {};
  const rubricCounts = {};

  for (const s of sessions) {
    for (const rubric of RUBRICS) {
      const val = s.rubrics?.[rubric]?.rubric_total;
      if (typeof val === 'number') {
        rubricSums[rubric] = (rubricSums[rubric] || 0) + val;
        rubricCounts[rubric] = (rubricCounts[rubric] || 0) + 1;
      }
    }
  }

  const totalSum = sessions.reduce((a, s) => a + s.total, 0);
  const totalMax = sessions.reduce((a, s) => a + s.max, 0);

  console.log(`Overall Total: ${totalSum.toFixed(2)} / ${totalMax.toFixed(2)} (${((totalSum/totalMax)*100).toFixed(1)}%)`);
  console.log('');
  console.log('Rubric breakdown:');

  for (const rubric of RUBRICS) {
    const sum = rubricSums[rubric] || 0;
    const count = rubricCounts[rubric] || 0;
    const max = rubric === 'error-handling' ? 26.25 : 21;
    const maxTotal = count * max;
    const avg = count > 0 ? (sum / count).toFixed(2) : 'N/A';
    console.log(`  ${rubric.padEnd(16)}: ${sum.toFixed(2).padStart(8)} / ${maxTotal.toFixed(2).padStart(8)} (${((sum/maxTotal)*100).toFixed(1)}%) | avg per session: ${avg}/${max}`);
  }
}

// ============================================
// SECTION 3: AGGREGATE BY EVAL (ALL VARIANTS)
// ============================================
console.log('\n' + '='.repeat(100));
console.log('SECTION 3: AGGREGATE BY EVAL (ALL VARIANTS COMBINED)');
console.log('='.repeat(100));

for (const evalName of evals) {
  const evalData = allData.filter(d => d.eval === evalName);

  console.log(`\n### ${evalName.toUpperCase()} (n=${evalData.length}) ###\n`);

  // By variant within eval
  for (const variant of ['baseline', 'framework', 'full-workflow']) {
    const variantData = evalData.filter(d => d.variant === variant);
    if (variantData.length === 0) continue;

    const totalSum = variantData.reduce((a, s) => a + s.total, 0);
    const totalMax = variantData.reduce((a, s) => a + s.max, 0);

    const rubricAvgs = {};
    for (const rubric of RUBRICS) {
      const vals = variantData.map(s => s.rubrics?.[rubric]?.rubric_total).filter(v => typeof v === 'number');
      rubricAvgs[rubric] = vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : 'N/A';
    }

    console.log(`${variant.padEnd(14)}: ${totalSum.toFixed(1).padStart(6)}/${totalMax.toFixed(1).padStart(6)} (${((totalSum/totalMax)*100).toFixed(1)}%) | CQ:${rubricAvgs['code-quality']} TQ:${rubricAvgs['test-quality']} ARCH:${rubricAvgs.architecture} ERR:${rubricAvgs['error-handling']}`);
  }
}

// ============================================
// SECTION 4: DIMENSION-LEVEL ANALYSIS
// ============================================
console.log('\n' + '='.repeat(100));
console.log('SECTION 4: DIMENSION-LEVEL SCORES (sampled)');
console.log('='.repeat(100));

// Show full dimension breakdown for a few sessions
const sampleSessions = allData.slice(0, 6);

for (const s of sampleSessions) {
  console.log(`\n### ${s.eval}/${s.session} (${s.variant}) - Total: ${s.total}/${s.max} ###\n`);

  for (const [rubricName, rubricData] of Object.entries(s.rubrics || {})) {
    console.log(`  ${rubricName}: ${rubricData.rubric_total}/${rubricData.rubric_max}`);

    if (rubricData.dimensions) {
      for (const [dimName, dimData] of Object.entries(rubricData.dimensions)) {
        const base = dimData.base || '?';
        const mod = dimData.modifier || '?';
        const score = dimData.score || '?';
        console.log(`    - ${dimName.padEnd(25)}: base=${base}, mod=${mod}, score=${score}`);
      }
    }
  }
}

// ============================================
// SECTION 5: VARIANCE ANALYSIS
// ============================================
console.log('\n' + '='.repeat(100));
console.log('SECTION 5: VARIANCE ANALYSIS');
console.log('='.repeat(100));

// Check for suspicious patterns
console.log('\n### Code Quality Score Distribution ###');
const cqScores = allData.map(d => d.rubrics?.['code-quality']?.rubric_total).filter(v => typeof v === 'number');
const cqUnique = [...new Set(cqScores.map(v => v.toFixed(2)))];
console.log(`Unique values (${cqUnique.length}): ${cqUnique.sort().join(', ')}`);

console.log('\n### Test Quality Score Distribution ###');
const tqScores = allData.map(d => d.rubrics?.['test-quality']?.rubric_total).filter(v => typeof v === 'number');
const tqUnique = [...new Set(tqScores.map(v => v.toFixed(2)))];
console.log(`Unique values (${tqUnique.length}): ${tqUnique.sort().join(', ')}`);

console.log('\n### Architecture Score Distribution ###');
const archScores = allData.map(d => d.rubrics?.architecture?.rubric_total).filter(v => typeof v === 'number');
const archUnique = [...new Set(archScores.map(v => v.toFixed(2)))];
console.log(`Unique values (${archUnique.length}): ${archUnique.sort().join(', ')}`);

console.log('\n### Error Handling Score Distribution ###');
const errScores = allData.map(d => d.rubrics?.['error-handling']?.rubric_total).filter(v => typeof v === 'number');
const errUnique = [...new Set(errScores.map(v => v.toFixed(2)))];
console.log(`Unique values (${errUnique.length}): ${errUnique.sort().join(', ')}`);

// ============================================
// SECTION 6: COMPARISON TABLE
// ============================================
console.log('\n' + '='.repeat(100));
console.log('SECTION 6: EVAL x VARIANT COMPARISON (rubric_total averages)');
console.log('='.repeat(100));

console.log('\n### CODE-QUALITY (max 21 per session) ###');
console.log('Eval        | baseline | framework | full-workflow | best');
console.log('-'.repeat(60));

for (const evalName of evals) {
  const row = [evalName.padEnd(12)];
  const vals = [];

  for (const variant of ['baseline', 'framework', 'full-workflow']) {
    const sessions = allData.filter(d => d.eval === evalName && d.variant === variant);
    const scores = sessions.map(s => s.rubrics?.['code-quality']?.rubric_total).filter(v => typeof v === 'number');
    const avg = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    vals.push({ variant, avg });
    row.push(avg ? avg.toFixed(2).padStart(9) : '    N/A  ');
  }

  const best = vals.filter(v => v.avg !== null).sort((a, b) => b.avg - a.avg)[0];
  row.push(best ? best.variant : 'N/A');
  console.log(row.join(' | '));
}

console.log('\n### ERROR-HANDLING (max 26.25 per session) ###');
console.log('Eval        | baseline | framework | full-workflow | best');
console.log('-'.repeat(60));

for (const evalName of evals) {
  const row = [evalName.padEnd(12)];
  const vals = [];

  for (const variant of ['baseline', 'framework', 'full-workflow']) {
    const sessions = allData.filter(d => d.eval === evalName && d.variant === variant);
    const scores = sessions.map(s => s.rubrics?.['error-handling']?.rubric_total).filter(v => typeof v === 'number');
    const avg = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    vals.push({ variant, avg });
    row.push(avg ? avg.toFixed(2).padStart(9) : '    N/A  ');
  }

  const best = vals.filter(v => v.avg !== null).sort((a, b) => b.avg - a.avg)[0];
  row.push(best ? best.variant : 'N/A');
  console.log(row.join(' | '));
}

console.log('\n' + '='.repeat(100));
console.log('END OF DEEP ANALYSIS');
console.log('='.repeat(100));
