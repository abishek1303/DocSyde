import "dotenv/config";
import { requireReliabilityContext, assertScenarioContext } from "@/integrations/reliability/execution-context";
import { assertOwnedRoot, ownedPath, freshEvidence, reserveAttempt } from "@/integrations/reliability/owned-resources";
import { verifyRuntimeIdentity, assertRuntimeIdentity } from "@/integrations/reliability/runtime-identity";
import { reliabilityBrowserOptions } from "@/integrations/reliability/subprocess-environment";
import { readCleanCheckoutIdentity } from "@/integrations/local-git/checkout-identity";
import { closeBrowserWithin } from "@/integrations/reliability/process-ownership";
import { observePublicationMutation } from "./publication-evidence";
import assert from "node:assert/strict";
import { readFile, writeFile, appendFile, lstat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { z } from "zod";
import { chromium } from "playwright";
import { reliabilityManifestSchema, baselineInventory, databaseServerIdentity, bytesHash } from "@/features/documentation/runs/reliability-baseline";
import { findDocumentationRun } from "@/integrations/database/documentation-runs";
import { runRecordV2 } from "@/features/documentation/runs/run-record";
import { findDocumentationReview } from "@/integrations/database/documentation-reviews";
import { readRetainedReview } from "@/features/documentation/review/review-proposal-operations";
import { getDocumentationDraft } from "@/features/documentation/documents/operations";
import { documentationHash } from "@/features/documentation/documents/document-identity";
import { getPublication, getContextualDocumentation, publishDocumentation, unpublishDocumentation } from "@/features/documentation/publication/publication-operations";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { sql } from "drizzle-orm";
import { restorePublication } from "./restore-publication";
import { routes } from "./workflows";

/** Explicitly invoked only after review/save and separate publication authorization. Never calls models. */
async function main() {
  const [manifestPath, rawRunId, rawDocumentId, output, ...extra] = process.argv.slice(2);
  if (!manifestPath || !output || extra.length) throw new Error("Expected manifest run-id saved-document-id evidence.json");
  const runId = z.uuid().parse(rawRunId), documentId = z.uuid().parse(rawDocumentId);
  const context = requireReliabilityContext(["scenario"]);
  const manifest = reliabilityManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  assertScenarioContext(context, manifest.scenario, manifest.head);
  assert.equal(context.experimentId, manifest.experimentId);
  assert.equal(context.docsydeSha, manifest.baseline.docsydeSha);
  assert.equal((await readCleanCheckoutIdentity(context.repositoryRoot)).sha, context.docsydeSha);
  assert.equal(process.cwd(), context.repositoryRoot);
  assert.ok(context.runtimeIdentity); assertRuntimeIdentity(context.runtimeIdentity, manifest.runtimeIdentity);
  await assertOwnedRoot(context); await ownedPath(context, output);
  const attempt = JSON.parse(await readFile(join(context.outputRoot, "execution.attempt.json"), "utf8"));
  assert.equal(attempt.evidence.runId, runId); assert.equal(attempt.evidence.manifestSha256, bytesHash(await readFile(manifestPath)));
  try { await lstat(output); throw new Error("Publication proof output exists."); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  await verifyRuntimeIdentity("http://127.0.0.1:45873", manifest.runtimeIdentity);
  await reserveAttempt(context, "publication", { runId, documentId });
  const evidence = await freshEvidence(context, `${resolve(output)}.evidence`);
  const inventory = await baselineInventory(manifest.baseline.repository);
  assert.equal(inventory.databaseName, manifest.databaseName);
  assert.notEqual(inventory.databaseName, manifest.baseline.sourceDatabase);
  assert.equal(databaseServerIdentity(), manifest.baseline.serverIdentity);
  const run = await findDocumentationRun(runId);
  assert.ok(run);
  const record = runRecordV2.parse(run.payload);
  assert.ok(record.retainedProposal);
  assert.equal(record.input.base, manifest.baseline.requestDeskBase); assert.equal(record.input.head, manifest.head);
  assert.equal(record.input.owner.toLowerCase(), "abishek1303"); assert.equal(record.input.repo.toLowerCase(), "docsyde");
  const retained = record.retainedProposal!;
  const row = await findDocumentationReview(retained.proposalId); assert.ok(row);
  const review = readRetainedReview(row);
  assert.equal(review.proposalHash, retained.proposalHash); assert.ok(review.review);
  assert.equal(review.proposal.status, "complete", "Partial proposals cannot count as baseline success");
  assert.ok(review.review.selection.decisions.every(decision => decision.choice !== "reject"), "Human rejection means this scenario did not complete successfully");
  const receipt = review.review.saves.find(save => save.documentId === documentId && save.status === "saved"); assert.ok(receipt);
  const saved = await getDocumentationDraft(documentId, manifest.baseline.repository); assert.equal(saved.status, "found");
  if (saved.status !== "found") throw new Error("Saved document unavailable");
  assert.equal(documentationHash(saved.document), receipt.sha256);
  const target = { owner: "abishek1303", repo: "docsyde", route: routes[manifest.scenario] };
  const endpoint = new URL(process.env.DOCSYDE_DELIVERY_ENDPOINT ?? "http://127.0.0.1:3000/api/documentation/context");
  assert.equal(endpoint.protocol, "http:"); assert.equal(endpoint.hostname, "127.0.0.1");
  const deliveredDocument = async () => {
    const url = new URL(endpoint); url.searchParams.set("owner", target.owner); url.searchParams.set("repo", target.repo); url.searchParams.set("route", target.route);
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200);
    return z.object({ publication: z.object({ documentId: z.uuid() }).nullable() }).parse(await response.json()).publication?.documentId ?? null;
  };
  const original = await getPublication(target);
  const expected = manifest.baseline.publications.find(publication => publication.route === target.route);
  assert.equal(original?.id ?? null, expected?.id ?? null); assert.equal(original?.draftId ?? null, expected?.documentId ?? null);
  const events = join(evidence.path, "events.jsonl");
  await writeFile(events, "", { flag: "wx", mode: 0o600 });
  const event = (value: unknown) => appendFile(events, `${JSON.stringify({ experimentId: context.experimentId, scenario: context.scenario, runtimeIdentity: manifest.runtimeIdentity, route: target.route, event: value })}\n`);
  assert.equal(await deliveredDocument(), original?.draftId ?? null, "Delivery server must point at the scenario database");
  await event({ step: "inventory", repository: manifest.baseline.repository, route: target.route, originalPublicationId: original?.id ?? null, originalDocumentId: original?.draftId ?? null,
    runId, proposalId: retained.proposalId, proposalHash: retained.proposalHash, reviewSelections: review.review.selection,
    reviewReceipt: review.review, documentId });
  const invocationIds = async () => (await getDatabase().execute(sql`SELECT id FROM docsyde.ai_model_invocations WHERE run_id = ${runId} ORDER BY id`)).rows.map(row => z.object({ id: z.uuid() }).parse(row).id);
  const callsBefore = await invocationIds();
  let scenarioPublicationId: string | undefined, originalRemoved = false, completed = false;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    if (original) {
      await event({ step: "unpublish-intent", observedId: original.id });
      const result = await observePublicationMutation(async () => {
        const acknowledged = (await unpublishDocumentation({ ...target, observedId: original.id })).status === "unpublished";
        if (acknowledged) originalRemoved = true;
        return acknowledged;
      }, async () => {
        const publication = await getPublication(target);
        // Keep verified local state even if the following HTTP observation fails,
        // so finally can still attempt conflict-safe restoration after a lost ack.
        originalRemoved = publication?.id !== original.id;
        return { publication, deliveredDocumentId: await deliveredDocument() };
      });
      await event({ step: "unpublish-observed", ...result });
      assert.ok(originalRemoved && result.observed.deliveredDocumentId === null, "Unpublish state must be observed, including after uncertain acknowledgement");
    }
    assert.equal((await getContextualDocumentation(target)).publication, null); assert.equal(await deliveredDocument(), null); await event({ step: "empty-before-publish" });
    await event({ step: "publish-intent", documentId });
    const published = await observePublicationMutation(async () => {
      const publication = await publishDocumentation({ ...target, draftId: documentId });
      if (publication.status !== "published") return false;
      scenarioPublicationId = publication.publication.id; return true;
    }, async () => ({ publication: await getPublication(target), deliveredDocumentId: await deliveredDocument() }));
    await event({ step: "publish-observed", ...published });
    // Without the association ID acknowledgement, ownership is ambiguous. Preserve
    // the observed association for operator recovery rather than guessing at removal.
    assert.ok(published.acknowledged && scenarioPublicationId && published.observed.publication?.id === scenarioPublicationId && published.observed.deliveredDocumentId === documentId, "Publication acknowledgement/delivery requires inspection");
    await event({ step: "published", publicationId: scenarioPublicationId, documentId });
    assert.equal((await getContextualDocumentation(target)).publication?.documentId, documentId);
    await verifyRuntimeIdentity("http://127.0.0.1:45873", manifest.runtimeIdentity);
    browser = await chromium.launch({ headless: true, ...await reliabilityBrowserOptions(context) });
    const page = await browser.newPage();
    const response = () => page.waitForResponse(value => {
      const url = new URL(value.url()); return url.origin === endpoint.origin && url.pathname === endpoint.pathname && url.searchParams.get("route") === target.route;
    });
    const check = async (pending: ReturnType<typeof response>) => {
      const delivered = await pending; assert.equal(delivered.status(), 200);
      const data = z.object({ publication: z.object({ id: z.uuid(), documentId: z.uuid() }) }).parse(await delivered.json());
      assert.equal(data.publication.documentId, documentId); assert.equal(data.publication.id, scenarioPublicationId);
      await page.locator("#documentation-content h2").waitFor();
      const text = await page.locator("#documentation-content").innerText();
      assert.ok(text.includes(saved.document.title));
      const block = saved.document.sections.flatMap(section => section.content)[0]; assert.ok(block && text.includes(block.markdown));
      await event({ step: "host-delivery", publicationId: data.publication.id, documentId: data.publication.documentId });
    };
    await page.goto(`http://127.0.0.1:45873${target.route}`);
    let pending = response(); await page.locator("#documentation-help").click(); await check(pending);
    await page.screenshot({ path: join(evidence.path, "delivery.png"), fullPage: true });
    await page.reload(); pending = response(); await page.locator("#documentation-help").click(); await check(pending);
    await page.locator("#documentation-help").click(); pending = response(); await page.locator("#documentation-help").click(); await check(pending);
    assert.deepEqual(await invocationIds(), callsBefore);
    completed = true;
  } finally {
    if (browser) await closeBrowserWithin(browser).catch(() => { completed = false; });
    const cleanup = await restorePublication({ scenarioPublicationId, originalDocumentId: original?.draftId ?? null, originalRemoved }, {
      remove: async observedId => (await unpublishDocumentation({ ...target, observedId })).status === "unpublished",
      currentDocument: async () => (await getPublication(target))?.draftId ?? null,
      insert: async draftId => {
        const restored = await publishDocumentation({ ...target, draftId });
        if (restored.status === "published") await event({ step: "restored", originalDocumentId: draftId, publicationId: restored.publication.id });
        return restored.status === "published";
      }, deliveredDocument, event,
    });
    completed = completed && cleanup.verified;
    const evidenceFiles = [{ path: "events.jsonl", sha256: bytesHash(await readFile(events)) }];
    try { evidenceFiles.push({ path: "delivery.png", sha256: bytesHash(await readFile(join(evidence.path, "delivery.png"))) }); } catch { /* A failed observation may have no screenshot. */ }
    await writeFile(output, JSON.stringify({ version: 2, experimentId: context.experimentId, runtimeIdentity: manifest.runtimeIdentity, route: target.route, evidenceDirectory: evidence.path, evidenceFiles, scenario: manifest.scenario, runId, proposalId: retained.proposalId, proposalHash: retained.proposalHash,
      reviewOperationId: review.review.operationId, savedDocumentId: documentId, publicationId: scenarioPublicationId ?? null,
      deliveredDocumentId: completed ? documentId : null, completed, restored: cleanup.restored, cleanupIssues: cleanup.issues, originalDocumentId: original?.draftId ?? null }, null, 2), { flag: "wx", mode: 0o600 });
    if (!cleanup.verified) throw new Error("Cleanup/restoration requires operator inspection.");
  }
  console.log("Exact-document delivery and restoration verified; no inference.");
}
main().catch(() => { console.error("Publication proof stopped. Inspect its event journal and restore the recorded mapping before another scenario. No inference was performed."); process.exitCode = 1; }).finally(closeDatabase);
