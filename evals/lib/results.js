'use strict';

/**
 * Run outcome from grader results. Deterministic checks alone decide the verdict; judged checks
 * (`judged: true`) are reported separately as a score and never change it.
 */

/** `{ pass, verdict, judgedScore, judgeModel }` for a list of grader results. */
function summarizeRun(graders) {
  const deterministic = graders.filter((g) => !g.judged);
  const judged = graders.filter((g) => g.judged);
  const scores = judged.filter((g) => typeof g.score === 'number').map((g) => g.score);
  const pass = deterministic.length > 0 && deterministic.every((g) => g.pass);
  const judgeModel = (judged.find((g) => g.judgeModel) || {}).judgeModel || null;
  return {
    pass,
    verdict: pass ? 'pass' : 'fail',
    judgedScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    judgeModel,
  };
}

module.exports = { summarizeRun };
