import { test } from "node:test";
import assert from "node:assert/strict";
import { selectedRepository } from "./repository-overview";

test("repository context uses the allowlist and validates URL branch selection", t => {
  const previous = process.env.DOCSYDE_ANALYSIS_REPOSITORIES;
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "Example/Product";
  t.after(() => { if (previous === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = previous; });
  assert.equal(selectedRepository({}).location, "https://github.com/example/product");
  assert.equal(selectedRepository({ repository: "EXAMPLE/product", branch: "release/v1" }).branch, "release/v1");
  assert.throws(() => selectedRepository({ repository: "other/product" }));
  assert.throws(() => selectedRepository({ branch: "bad..branch" }));
});
