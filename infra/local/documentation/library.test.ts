import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { closeDatabase } from "@/integrations/database/client";
import { documentationLibrary, latestDocumentationDraft, archivedDocumentationDraft } from "@/features/documentation/library/library-operations";
import { documentationHash } from "@/features/documentation/documents/document-identity";
import { draftFixture } from "./draft-fixture";
import { reviewProposalFixture } from "./review-fixtures";

test("library authorizes scope, validates canonical identities and separates publication/review projections", async t => {
  const previous = { DATABASE_URL: process.env.DATABASE_URL, DOCSYDE_ANALYSIS_REPOSITORIES: process.env.DOCSYDE_ANALYSIS_REPOSITORIES };
  process.env.DATABASE_URL = "postgres://fixture:fixture@localhost/fixture";
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "example/product";
  t.after(async () => { await closeDatabase(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const draft = draftFixture(); draft.provenance.repository = "https://github.com/example/product";
  const proposal = reviewProposalFixture(draft, false);
  const date = "2026-10-30T12:00:00.000Z";
  const version = randomUUID();
  let queries = 0, corrupt = false;
  t.mock.method(globalThis, "fetch", () => { throw new Error("No provider calls permitted"); });
  t.mock.method(Pool.prototype, "query", async (query: { text: string }, params: unknown[]) => {
    queries++;
    assert.ok(params.includes("https://github.com/example/product"));
    if (query.text.includes('inner join')) return { rows: [[version, draft.provenance.repository, "/page", draft.id, date, date, corrupt ? randomUUID() : draft.id, draft, date]] };
    if (query.text.includes('"documentation_proposal_reviews"')) {
      assert.ok(query.text.includes('IS NULL') && query.text.includes('EXISTS'));
      return { rows: [[proposal.proposalId, draft.provenance.repository, documentationHash(proposal), proposal, [], date, new Date(Date.now() + 60000).toISOString(), null]] };
    }
    assert.ok(query.text.includes('order by') && query.text.includes('limit'));
    return { rows: [[corrupt ? randomUUID() : draft.id, draft, date]] };
  });
  await assert.rejects(() => documentationLibrary({ owner: "other", repo: "product" }, "archive"), /not allowed/);
  await assert.rejects(() => documentationLibrary({ owner: "example", repo: "product", page: -1 }, "pending"));
  assert.equal(queries, 0);
  const latest = await latestDocumentationDraft({ owner: "example", repo: "product" });
  assert.equal(latest?.document.id, draft.id);
  const archive = await documentationLibrary({ owner: "example", repo: "product" }, "archive");
  assert.equal(archive.archive[0].title, draft.title);
  assert.equal(archive.archive[0].route, "/page");
  const archived = await archivedDocumentationDraft({ owner: "example", repo: "product" }, version);
  assert.equal(archived?.document.id, draft.id);
  const pending = await documentationLibrary({ owner: "example", repo: "product" }, "pending");
  assert.equal(pending.archive.length, 0);
  assert.equal(pending.proposals[0].id, proposal.proposalId);
  corrupt = true;
  await assert.rejects(() => documentationLibrary({ owner: "example", repo: "product" }, "archive"), /identity mismatch/);
  await assert.rejects(() => latestDocumentationDraft({ owner: "example", repo: "product" }), /identity mismatch/);
});


test("document reader distinguishes published documentation from saved content", () => {
  for (const [published, showMetadata] of [[false, true], [true, true], [false, false]]) {
    const render = spawnSync(process.execPath, ["--import", "tsx", "-e", `
      global.React = require("react");
      global.fetch = () => { throw Error("No provider calls permitted"); };
      const { renderToStaticMarkup } = require("react-dom/server");
      const { DraftInspector } = require("./src/features/documentation/components/reader/draft-inspector.tsx");
      const props = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      process.stdout.write(renderToStaticMarkup(React.createElement(DraftInspector, props)));
    `], { input: JSON.stringify({ document: draftFixture(), savedAt: "2026-10-30T12:00:00.000Z", published, showMetadata }), encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
    assert.equal(render.status, 0, render.stderr);
    if (showMetadata) assert.ok(render.stdout.includes(published ? ">Published</span>" : ">Saved document</span>"));
    assert.ok(!render.stdout.includes("Draft · review needed"));
    if (!showMetadata) {
      assert.ok(render.stdout.includes("<h1"));
      assert.ok(!render.stdout.includes("canonical JSON"));
      assert.ok(render.stdout.includes("About this draft and its limitations"));
    }
  }
});
