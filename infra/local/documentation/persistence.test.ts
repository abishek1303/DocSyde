import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { eq, inArray, sql } from "drizzle-orm";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationDrafts, projects } from "@/integrations/database/schema";
import { saveDocumentationDraft, getDocumentationDraft, listDocumentationDrafts } from "@/features/documentation/operations";
import { signDraftPreview } from "@/features/documentation/draft-handoff";
import { saveDraftPreview } from "@/app/documentation/draft/save-actions";
import { draftFixture } from "./draft-fixture";

test("PostgreSQL: signed save → reconnect → list → repeated load/render, with zero external calls", async t => {
  const previous = { ai: process.env.BASETEN_API_KEY, github: process.env.GITHUB_TOKEN, signing: process.env.DOCSYDE_DRAFT_SIGNING_KEY };
  delete process.env.BASETEN_API_KEY; delete process.env.GITHUB_TOKEN;
  process.env.DOCSYDE_DRAFT_SIGNING_KEY = "isolated-persistence-test-signing-key";
  let externalCalls = 0;
  t.mock.method(globalThis, "fetch", () => { externalCalls++; throw new Error("Persistence must not call external services"); });
  const ids: string[] = [];
  const beforeProjects = await getDatabase().select().from(projects).orderBy(projects.id);
  t.after(async () => {
    try {
      if (ids.length) await getDatabase().delete(documentationDrafts).where(inArray(documentationDrafts.id, ids));
      assert.deepEqual(await getDatabase().select().from(projects).orderBy(projects.id), beforeProjects);
    } finally {
      await closeDatabase();
      for (const [name, value] of Object.entries({ BASETEN_API_KEY: previous.ai, GITHUB_TOKEN: previous.github, DOCSYDE_DRAFT_SIGNING_KEY: previous.signing })) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
  const document = draftFixture(); ids.push(document.id);
  const preview = signDraftPreview(document);
  const form = new FormData(); form.set("serialized", preview.serialized); form.set("signature", preview.signature);
  const tampered = new FormData(); tampered.set("serialized", preview.serialized + " "); tampered.set("signature", preview.signature);
  assert.equal((await saveDraftPreview({ status: "idle" }, tampered)).status, "error");
  const saved = await saveDraftPreview({ status: "idle" }, form);
  assert.equal(saved.status, "saved");
  assert.equal(saved.id, document.id);
  await closeDatabase();
  // A new connection and missing signing key cannot affect persisted reads.
  delete process.env.DOCSYDE_DRAFT_SIGNING_KEY;
  for (let i = 0; i < 3; i++) {
    const loaded = await getDocumentationDraft(document.id);
    assert.equal(loaded.status, "found");
    if (loaded.status !== "found") throw new Error("Missing saved fixture");
    assert.deepEqual(loaded.document, document);
    assert.equal(loaded.savedAt.toISOString(), saved.savedAt);
    const render = spawnSync(process.execPath, ["--import", "tsx", "-e", `global.React=require('react');global.fetch=()=>{throw Error('Unexpected HTTP')};const {renderToStaticMarkup}=require('react-dom/server');const {DraftInspector}=require('./src/features/documentation/components/draft-inspector.tsx');const document=JSON.parse(require('node:fs').readFileSync(0,'utf8'));process.stdout.write(renderToStaticMarkup(React.createElement(DraftInspector,{document,savedAt:'persisted'})));`], { input: JSON.stringify(loaded.document), encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
    assert.equal(render.status, 0, render.stderr);
    assert.ok(render.stdout.includes("<strong>may be required</strong>"));
    assert.ok(render.stdout.includes("Preserved qualifications"));
    assert.ok(render.stdout.includes("Block provenance"));
    assert.ok(render.stdout.includes(document.sections[0].id));
    assert.ok(!render.stdout.includes("not saved"));
  }
  const concurrent = await Promise.all(Array.from({ length: 4 }, () => saveDocumentationDraft(document)));
  for (const retry of concurrent) {
    assert.equal(retry.status, "saved");
    if (retry.status === "saved") assert.equal(retry.savedAt.toISOString(), saved.savedAt);
  }
  const reordered = Object.fromEntries(Object.entries(document).reverse());
  assert.equal((await saveDocumentationDraft(reordered)).status, "saved");
  assert.deepEqual(await saveDocumentationDraft({ ...document, title: "Conflict" }), { status: "conflict" });
  const afterConflict = await getDocumentationDraft(document.id);
  assert.equal(afterConflict.status, "found");
  if (afterConflict.status === "found") {
    assert.deepEqual(afterConflict.document, document);
    assert.equal(afterConflict.savedAt.toISOString(), saved.savedAt);
  }
  assert.deepEqual(await getDocumentationDraft(randomUUID()), { status: "missing" });
  await assert.rejects(() => getDocumentationDraft("invalid"));
  await assert.rejects(() => saveDocumentationDraft({ ...document, sections: [] }));

  // Test fixtures alone are assigned a future timestamp to isolate cursor pages
  // from existing local rows; cleanup touches only the UUIDs created by this test.
  const corruptId = randomUUID(); ids.push(corruptId);
  const second = draftFixture(); ids.push(second.id);
  const firstSaveRace = await Promise.all(Array.from({ length: 4 }, () => saveDocumentationDraft(second)));
  for (const result of firstSaveRace) assert.deepEqual(result, firstSaveRace[0]);
  await getDatabase().insert(documentationDrafts).values({ id: corruptId, document: { id: corruptId, schemaVersion: 1, status: "draft", title: "MUST NOT LEAK" } });
  await getDatabase().update(documentationDrafts).set({ savedAt: new Date("2200-01-01T00:00:00.000Z") }).where(inArray(documentationDrafts.id, ids));
  const observed: string[] = [];
  let cursor: { savedAt: string; id: string } | undefined;
  for (let i = 0; i < 3; i++) {
    const page = await listDocumentationDrafts({ limit: 1, before: cursor });
    assert.equal(page.entries.length, 1);
    const entry = page.entries[0]; observed.push(entry.id);
    if (entry.id === corruptId) assert.deepEqual(entry, { id: corruptId, savedAt: new Date("2200-01-01"), status: "unavailable" });
    else assert.equal(entry.status, "available");
    assert.ok(!JSON.stringify(page).includes("MUST NOT LEAK"));
    cursor = page.nextCursor ?? undefined;
  }
  assert.deepEqual(observed, [...ids].sort().reverse());
  assert.equal((await getDocumentationDraft(corruptId)).status, "invalid");
  await assert.rejects(() => listDocumentationDrafts({ limit: 0 }));
  await assert.rejects(() => listDocumentationDrafts({ before: { id: "invalid", savedAt: "invalid" } }));
  await assert.rejects(() => getDatabase().insert(documentationDrafts).values({ id: randomUUID(), document: {} }));
  assert.equal(externalCalls, 0);
  const loadedModules = Object.keys(createRequire(`${process.cwd()}/package.json`).cache);
  assert.deepEqual(loadedModules.filter(path => /\/(features\/sources|integrations\/(ai|github))\//.test(path)), [], "Persistence imported a source/model implementation");
  assert.equal(Number((await getDatabase().select({ count: sql<number>`count(*)` }).from(documentationDrafts).where(eq(documentationDrafts.id, document.id)))[0].count), 1);
});
