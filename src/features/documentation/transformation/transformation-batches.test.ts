import { test } from "node:test";
import assert from "node:assert/strict";
import { minimumTransformationBatches } from "./transformation-batches";
import { TRANSFORMATION_AGGREGATE_BYTES, TRANSFORMATION_REQUEST_BYTES } from "./documentation-change-proposal";

test("minimum batching combines all fitting work and deterministically finds the fewest fallback batches", () => {
  const one = minimumTransformationBatches([0, 1, 2, 3], batch => batch.length <= 4 ? 100 : null);
  assert.equal(one.batches?.length, 1);
  const fallback = () => minimumTransformationBatches([0, 1, 2, 3, 4], batch => batch.length <= 2 ? batch.length * 100 : null);
  assert.equal(fallback().batches?.length, 3); assert.deepEqual(fallback(), fallback());
  assert.deepEqual(fallback().batches?.flatMap(batch => batch.items).sort(), [0, 1, 2, 3, 4]);
});

test("subset feasibility handles shared context and avoids a greedy extra batch", () => {
  const allowed = new Set(["0", "1", "2", "3", "0,1", "0,2", "1,3"]);
  const result = minimumTransformationBatches([0, 1, 2, 3], batch => allowed.has(batch.join(",")) ? 100 : null);
  assert.deepEqual(result.batches?.map(batch => batch.items), [[0, 2], [1, 3]]);
});

test("individual infeasibility and aggregate boundaries fail before any generation", () => {
  const result = minimumTransformationBatches([0, 1], batch => batch.includes(1) ? null : TRANSFORMATION_REQUEST_BYTES);
  assert.deepEqual(result.individuallyInfeasible, [1]); assert.equal(result.batches?.length, 1);
  const bounded = (bytes: number) => minimumTransformationBatches([0, 1, 2, 3], batch => batch.length === 1 ? bytes : null);
  assert.equal(bounded(TRANSFORMATION_AGGREGATE_BYTES / 4).batches?.length, 4);
  assert.equal(bounded(TRANSFORMATION_AGGREGATE_BYTES / 4 + 1).batches, null);
});
