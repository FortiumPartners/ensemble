#!/usr/bin/env node
/**
 * consolidate-scores.js - Combine individual rubric scores into detailed-scores.json
 *
 * This utility consolidates existing judge.js outputs into the format expected
 * by generate-analysis-report.js and deep-analysis.js.
 *
 * Usage: node consolidate-scores.js <results-dir>
 *
 * Example:
 *   node consolidate-scores.js test/evals/results/overnight-20260115
 */

const fs = require('fs');
const path = require('path');

const RUBRICS = ['code-quality', 'test-quality', 'architecture', 'error-handling'];

function showUsage() {
  console.log('Usage: node consolidate-scores.js <results-dir>');
  console.log('');
  console.log('Consolidates individual rubric scores (scores/*.json) into detailed-scores.json');
  console.log('for each session directory.');
  process.exit(1);
}

// Find all session directories
function findSessions(dir) {
  const sessions = [];

  if (!fs.existsSync(dir)) {
    console.error(`Error: Directory not found: ${dir}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      // Check if this looks like a session directory (has scores/ subdirectory)
      const scoresDir = path.join(fullPath, 'scores');
      if (fs.existsSync(scoresDir)) {
        sessions.push({
          path: fullPath,
          evalName: path.basename(dir),
          session_id: entry
        });
      } else {
        // Recurse into subdirectory (eval/fixture directories)
        sessions.push(...findSessions(fullPath));
      }
    }
  }

  return sessions;
}

// Consolidate scores for a single session
function consolidateSession(sessionPath, evalName) {
  const scoresDir = path.join(sessionPath, 'scores');
  if (!fs.existsSync(scoresDir)) {
    return null;
  }

  // Read variant from metadata
  let variant = 'unknown';
  const metadataPath = path.join(sessionPath, 'metadata.json');
  if (fs.existsSync(metadataPath)) {
    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      variant = metadata.variant || 'unknown';
    } catch (err) {
      // ignore
    }
  }

  const consolidated = {
    session_id: path.basename(sessionPath),
    eval: evalName,
    variant: variant,
    scored_at: new Date().toISOString(),
    by_rubric: {}
  };

  let totalScore = 0;
  let maxScore = 0;
  let rubricCount = 0;

  for (const rubric of RUBRICS) {
    const scorePath = path.join(scoresDir, `${rubric}.json`);
    if (fs.existsSync(scorePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(scorePath, 'utf8'));
        consolidated.by_rubric[rubric] = {
          score: data.scores?.overall || data.scores?.score,
          rubric_total: data.scores?.rubric_total,
          rubric_max: data.scores?.rubric_max,
          base_score: data.scores?.base_score,
          modifier: data.scores?.modifier,
          dimensions: data.scores?.dimensions,
          justification: data.justification,
          strengths: data.strengths,
          weaknesses: data.weaknesses,
          metrics: data.metrics
        };

        if (data.scores?.rubric_total) {
          totalScore += data.scores.rubric_total;
          maxScore += data.scores.rubric_max || 21;
          rubricCount++;
        }
      } catch (err) {
        console.error(`  Error reading ${scorePath}: ${err.message}`);
      }
    }
  }

  consolidated.total_score = parseFloat(totalScore.toFixed(2));
  consolidated.max_score = parseFloat(maxScore.toFixed(2));
  consolidated.rubrics_scored = rubricCount;
  consolidated.normalized_score = maxScore > 0
    ? parseFloat(((totalScore / maxScore) * 100).toFixed(1))
    : 0;

  return consolidated;
}

// Main
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  showUsage();
}

const resultsDir = path.resolve(args[0]);
console.log(`Scanning: ${resultsDir}`);

const sessions = findSessions(resultsDir);
console.log(`Found ${sessions.length} sessions with scores`);

let consolidated = 0;
for (const session of sessions) {
  const result = consolidateSession(session.path, session.evalName);
  if (result && result.rubrics_scored > 0) {
    const outputPath = path.join(session.path, 'detailed-scores.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`  ${session.evalName}/${session.session_id.substring(0,8)} (${result.variant}): ${result.rubrics_scored} rubrics, ${result.total_score}/${result.max_score} (${result.normalized_score}%)`);
    consolidated++;
  }
}

console.log(`\nConsolidated ${consolidated} sessions`);
