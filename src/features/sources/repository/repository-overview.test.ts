import { test } from "node:test";
import assert from "node:assert/strict";
import { configuredRepositories, selectedRepository } from "./repository-overview";

test("repository context uses the allowlist and validates URL branch selection", t => {
  const previous = process.env.DOCSYDE_ANALYSIS_REPOSITORIES;
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "Example/Product";
  t.after(() => { if (previous === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = previous; });
  assert.equal(selectedRepository({}).location, "https://github.com/example/product");
  assert.equal(selectedRepository({ repository: "EXAMPLE/product", branch: "release/v1" }).branch, "release/v1");
  assert.throws(() => selectedRepository({ repository: "other/product" }));
  assert.throws(() => selectedRepository({ branch: "bad..branch" }));
});


test("project picker lists one target and rejects multiple repositories", t => {
  const previous = process.env.DOCSYDE_ANALYSIS_REPOSITORIES;
  t.after(() => { if (previous === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = previous; });
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "abishek1303/DockSyde-demo-app-test-subject,Example/Product,example/product";
  assert.throws(() => configuredRepositories(), /exactly one/);
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "Example/Product,example/product";
  assert.deepEqual(configuredRepositories(), ["example/product"]);
});
