const fs = require("fs");
const path = require("path");

const WEIGHTS = { code_quality: 35, architecture: 30, test_quality: 25, error_handling: 10 };

function getDuration(meta) {
  if (!meta.start_time || !meta.end_time) return "N/A";
  const start = new Date(meta.start_time);
  const end = new Date(meta.end_time);
  const mins = Math.round((end - start) / 60000);
  return mins + "m";
}

const results = [];
const baseDir = path.join(__dirname, "results");

// Find all score files recursively
const findScores = (dir) => {
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      findScores(fullPath);
    } else if (item.name === "batched-absolute.json") {
      results.push(fullPath);
    }
  }
};

findScores(baseDir);

const rows = [];

for (const scorePath of results) {
  try {
    const scoreData = JSON.parse(fs.readFileSync(scorePath, "utf8"));
    const sessionDir = path.dirname(path.dirname(scorePath));
    const metaPath = path.join(sessionDir, "metadata.json");

    let meta = {};
    if (fs.existsSync(metaPath)) {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    }

    // Extract eval name from path
    const relPath = path.relative(baseDir, scorePath);
    const evalName = relPath.split(path.sep)[0];

    // Get scores - handle multiple formats
    // Format 1: scoreData.scores.code_quality.final
    // Format 2: scoreData.raw_response.code_quality.score
    // Format 3: scoreData.raw_response.code_quality.final_score
    const scores = scoreData.scores || {};
    const raw = scoreData.raw_response || {};

    const getScore = (dim) => {
      // Try scores first
      if (scores[dim]?.final) return scores[dim].final;
      if (scores[dim]?.score) return scores[dim].score;
      // Try raw_response
      if (raw[dim]?.final_score) return raw[dim].final_score;
      if (raw[dim]?.score) return raw[dim].score;
      if (raw[dim]?.final) return raw[dim].final;
      // Try overall_score from raw
      if (dim === 'overall' && raw.overall_score) return raw.overall_score;
      return 0;
    };

    const cq = getScore('code_quality');
    const arch = getScore('architecture');
    const test = getScore('test_quality');
    const err = getScore('error_handling');

    const cqPts = ((cq / 5) * 35).toFixed(1);
    const archPts = ((arch / 5) * 30).toFixed(1);
    const testPts = ((test / 5) * 25).toFixed(1);
    const errPts = ((err / 5) * 10).toFixed(1);
    const total = (parseFloat(cqPts) + parseFloat(archPts) + parseFloat(testPts) + parseFloat(errPts)).toFixed(1);

    rows.push({
      eval: evalName.replace(/_20260116.*|_2026-01-17.*/g, ""),
      variant: meta.variant || "unknown",
      session: (meta.session_id || scoreData.session_id || "").slice(0, 8),
      duration: getDuration(meta),
      cq: cq.toFixed(2),
      cqPts,
      arch: arch.toFixed(2),
      archPts,
      test: test.toFixed(2),
      testPts,
      err: err.toFixed(2),
      errPts,
      total
    });
  } catch (e) {
    console.error("Error processing", scorePath, e.message);
  }
}

// Sort by eval name, then variant
rows.sort((a, b) => {
  if (a.eval !== b.eval) return a.eval.localeCompare(b.eval);
  const order = { baseline: 0, framework: 1, "full-workflow": 2 };
  return (order[a.variant] || 99) - (order[b.variant] || 99);
});

// Print table
console.log("## All Eval Runs - Scoring Summary\n");
console.log("| Eval | Variant | Session | Duration | Code (35) | Arch (30) | Test (25) | Error (10) | TOTAL |");
console.log("|------|---------|---------|----------|-----------|-----------|-----------|------------|-------|");
for (const r of rows) {
  console.log(`| ${r.eval} | ${r.variant} | ${r.session} | ${r.duration} | ${r.cqPts} | ${r.archPts} | ${r.testPts} | ${r.errPts} | **${r.total}** |`);
}

// Summary by variant
console.log("\n## Summary by Variant\n");
const byVariant = {};
for (const r of rows) {
  if (!byVariant[r.variant]) byVariant[r.variant] = [];
  byVariant[r.variant].push(parseFloat(r.total));
}

console.log("| Variant | Count | Avg Score | Min | Max |");
console.log("|---------|-------|-----------|-----|-----|");
for (const [v, scores] of Object.entries(byVariant)) {
  const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
  const min = Math.min(...scores).toFixed(1);
  const max = Math.max(...scores).toFixed(1);
  console.log(`| ${v} | ${scores.length} | ${avg} | ${min} | ${max} |`);
}

// Summary by eval type
console.log("\n## Summary by Eval Type\n");
const byEval = {};
for (const r of rows) {
  if (!byEval[r.eval]) byEval[r.eval] = { baseline: [], framework: [], "full-workflow": [] };
  if (byEval[r.eval][r.variant]) {
    byEval[r.eval][r.variant].push(parseFloat(r.total));
  }
}

console.log("| Eval | Baseline Avg | Framework Avg | Full-Workflow Avg | Delta (FW-Base) |");
console.log("|------|--------------|---------------|-------------------|-----------------|");
for (const [evalName, variants] of Object.entries(byEval)) {
  const baseAvg = variants.baseline.length > 0
    ? (variants.baseline.reduce((a, b) => a + b, 0) / variants.baseline.length).toFixed(1)
    : "N/A";
  const fwAvg = variants.framework.length > 0
    ? (variants.framework.reduce((a, b) => a + b, 0) / variants.framework.length).toFixed(1)
    : "N/A";
  const fullAvg = variants["full-workflow"].length > 0
    ? (variants["full-workflow"].reduce((a, b) => a + b, 0) / variants["full-workflow"].length).toFixed(1)
    : "N/A";
  const delta = (baseAvg !== "N/A" && fwAvg !== "N/A")
    ? "+" + (parseFloat(fwAvg) - parseFloat(baseAvg)).toFixed(1)
    : "N/A";
  console.log(`| ${evalName} | ${baseAvg} | ${fwAvg} | ${fullAvg} | ${delta} |`);
}
