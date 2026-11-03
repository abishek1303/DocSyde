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
      assert.ok(!render.stdout.includes("About this draft and its limitations"));
      assert.ok(!render.stdout.includes("Generated with"));
      assert.ok(render.stdout.includes("On this page"));
    }
  }
});

test("document hub reads active publications separately from saves, reviews and history", async t => {
  const { documentationHub } = await import("@/features/documentation/library/library-operations");
  const previous = { DATABASE_URL: process.env.DATABASE_URL, DOCSYDE_ANALYSIS_REPOSITORIES: process.env.DOCSYDE_ANALYSIS_REPOSITORIES };
  process.env.DATABASE_URL = "postgres://fixture:fixture@localhost/fixture";
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "example/product";
  t.after(async () => { await closeDatabase(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const draft = draftFixture(); draft.provenance.repository = "https://github.com/example/product";
  const proposal = reviewProposalFixture(draft, false), now = new Date().toISOString();
  let queries = 0;
  t.mock.method(Pool.prototype, "query", async (query: { text: string }, params: unknown[]) => {
    queries++; assert.ok(params.includes(draft.provenance.repository));
    if (query.text.includes('left join')) return { rows: [[proposal.proposalId, draft.provenance.repository, documentationHash(proposal), proposal, [], now, new Date(Date.now() + 60000).toISOString(), null, "fixture-run", "Change title"]] };
    if (query.text.includes('inner join') && query.text.includes('documentation_publication_history')) return { rows: [[randomUUID(), draft.provenance.repository, "/page", draft.id, now, now, draft.id, draft, now]] };
    if (query.text.includes('inner join')) {
      assert.ok(query.text.includes('documentation_publications'));
      return { rows: [[randomUUID(), draft.provenance.repository, "/page", draft.id, now, draft.id, draft, now]] };
    }
    return { rows: [[draft.id, draft, now]] };
  });
  await assert.rejects(() => documentationHub({ owner: "other", repo: "product" }, "live"), /not allowed/);
  assert.equal(queries, 0);
  const live = await documentationHub({ owner: "example", repo: "product" }, "live");
  assert.equal(live.kind, "live"); if (live.kind === "live") assert.equal(live.entries[0].route, "/page");
  const history = await documentationHub({ owner: "example", repo: "product" }, "history");
  assert.equal(history.kind, "history"); if (history.kind === "history") assert.equal(history.entries[0].document.id, draft.id);
  const pending = await documentationHub({ owner: "example", repo: "product" }, "pending");
  assert.equal(pending.kind, "pending"); if (pending.kind === "pending") { assert.equal(pending.entries[0].runTitle, "Change title"); assert.equal(pending.entries[0].status, "Waiting for review"); assert.equal(pending.saves[0].document.id, draft.id); }
});


test("Latest Changes eligibility matches the saved candidate corpus, not unsaved proposals", async t => {
  const { hasExistingDocumentation } = await import("@/features/documentation/library/library-operations");
  const previous = { DATABASE_URL: process.env.DATABASE_URL, DOCSYDE_ANALYSIS_REPOSITORIES: process.env.DOCSYDE_ANALYSIS_REPOSITORIES };
  process.env.DATABASE_URL = "postgres://fixture:fixture@localhost/fixture";
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = "example/product,example/empty";
  t.after(async () => { await closeDatabase(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const draft = draftFixture(); draft.provenance.repository = "https://github.com/example/product";
  const now = new Date().toISOString();
  let mode: "empty" | "saved" | "pending-only" | "corrupt" | "older-saved" | "older-page" = "empty";
  let reads = 0;
  t.mock.method(globalThis, "fetch", () => { throw new Error("No inference or source reads"); });
  t.mock.method(Pool.prototype, "query", async (query: { text: string }, params: unknown[]) => {
    assert.ok(query.text.includes('"documentation_drafts"'), "Only saved snapshots participate in candidate selection");
    if (params.includes("https://github.com/example/empty")) return { rows: [] };
    assert.ok(params.includes(draft.provenance.repository));
    reads++;
    const valid = [draft.id, draft, now];
    const corrupt = [randomUUID(), {}, now];
    return { rows: mode === "saved" ? [valid] : mode === "corrupt" ? [corrupt] : mode === "older-saved" ? [corrupt, valid]
      : mode === "older-page" ? reads === 1 ? Array.from({ length: 51 }, () => [randomUUID(), {}, now]) : [valid] : [] };
  });
  for (const [value, expected] of [["empty", false], ["saved", true], ["pending-only", false], ["corrupt", false], ["older-saved", true], ["older-page", true]] as const) {
    mode = value; reads = 0;
    assert.equal(await hasExistingDocumentation({ owner: "example", repo: "product" }), expected);
    if (mode === "older-page") assert.equal(reads, 2, "An invalid first page must not hide an eligible older save");
    assert.equal(await hasExistingDocumentation({ owner: "example", repo: "empty" }), false);
  }
  await assert.rejects(() => hasExistingDocumentation({ owner: "unauthorized", repo: "product" }), /not allowed/);
});
