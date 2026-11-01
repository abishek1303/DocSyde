import { test } from "node:test";
import assert from "node:assert/strict";
import { COMMIT_PAGE_SIZE, parseChangePagination } from "./change-pagination";

test("commit pagination defaults and validated URL values", () => {
  assert.deepEqual(parseChangePagination({}), { page: 1 });
  assert.deepEqual(parseChangePagination({ page: "2", pageSize: "50", branch: "main" }), { page: 2 });
  for (const page of ["0", "-1", "1.5", "abc", "10001", ["1", "2"]]) assert.throws(() => parseChangePagination({ page }));
  assert.equal(COMMIT_PAGE_SIZE, 10);
  for (const pageSize of ["10", "50", "100", "abc"]) assert.deepEqual(parseChangePagination({ pageSize }), { page: 1 });
});
