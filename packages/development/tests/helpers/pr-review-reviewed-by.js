'use strict';

/**
 * What `results collect` answers as `reviewedBy` when reviewers of a plan arrived and read every path of their slice:
 * one `{ sliceId, lens, reviewer, paths }` per reviewer, `paths` being the paths of that reviewer's slice.
 *
 * `planSlices` / `slices` hand out `reviewerAssignments` (`{ reviewer, sliceId, lens }`: who is asked to read what), not
 * a record of what was read. `verifyCoverage` credits a lens to the paths a reviewer NAMED and to no others, so a test
 * that simulates "these reviewers reported back" over a plan builds its `reviewedBy` here instead of passing the
 * assignments themselves.
 *
 * @param {{slices:Array<{id:string, paths:string[]}>, reviewerAssignments:Array<{reviewer:string, sliceId:string, lens:string}>}} plan
 * @param {Array<{reviewer:string, sliceId:string, lens:string}>} [assignments]  The reviewers that arrived; defaults to
 *   every reviewer of the plan.
 */
function reviewedByOf(plan, assignments = plan.reviewerAssignments) {
  return assignments.map((assignment) => {
    const slice = plan.slices.find((candidate) => candidate.id === assignment.sliceId);
    if (slice === undefined) throw new Error(`the plan has no slice ${JSON.stringify(assignment.sliceId)}`);
    return { sliceId: assignment.sliceId, lens: assignment.lens, reviewer: assignment.reviewer, paths: slice.paths.slice() };
  });
}

module.exports = { reviewedByOf };
