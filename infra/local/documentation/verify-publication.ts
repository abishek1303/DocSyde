import "dotenv/config";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { closeDatabase } from "@/integrations/database/client";
import { getDocumentationDraft } from "@/features/documentation/operations";
import { getPublication, savedDocumentCoordinates, unpublishDocumentation } from "@/features/documentation/publication-operations";

// Uses an existing saved document only. Never generate, seed or substitute content.
async function main() {
  const id = process.argv[2];
  const docsyde = process.argv[3] ?? "http://127.0.0.1:3000";
  const host = "http://127.0.0.1:45873";
  const saved = await getDocumentationDraft(id);
  assert.equal(saved.status, "found", "A valid persisted create-request document is required; live proof stopped.");
  if (saved.status !== "found") return;
  assert.ok(saved.document.context.some(c => c.kind === "route" && c.value === "/requests/new"), "Saved document must explicitly cover /requests/new; live proof stopped.");
  assert.ok(saved.document.sections.some(s => /creat.*request/i.test(s.title) && s.content.some(b => b.markdown.includes("/requests/new"))), "Suitable saved create-request content required; live proof stopped.");
  const target = { ...savedDocumentCoordinates(saved.document.provenance.repository), route: "/requests/new" };
  assert.equal(await getPublication(target), null, "Target is already occupied; leave existing publication untouched.");
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const unexpected: string[] = [], errors: string[] = [];
  await context.route("**/*", route => {
    const origin = new URL(route.request().url()).origin;
    if (origin === host || origin === docsyde) return route.continue();
    unexpected.push(origin); return route.abort();
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  const help = page.locator("#documentation-content");
  let ownedPublicationId: string | undefined;
  try {
    await page.goto(`${host}/requests/new?from=proof#help`);
    await page.getByRole("button", { name: "Help for this page" }).click();
    await help.getByText("No documentation published for this page.", { exact: true }).waitFor();
    const author = await context.newPage();
    author.on("pageerror", error => errors.push(error.message));
    await author.goto(`${docsyde}/documentation/drafts/${id}`);
    const form = author.getByRole("form", { name: "Publish saved documentation" });
    await form.getByRole("button", { name: "Publish", exact: true }).click();
    await form.getByText("Published. Saved content is unchanged.", { exact: true }).waitFor();
    const publication = await getPublication(target);
    assert.ok(publication); ownedPublicationId = publication.id;
    await page.getByRole("button", { name: "Help for this page" }).click();
    await page.getByRole("button", { name: "Help for this page" }).click();
    await help.getByRole("heading", { name: saved.document.title, exact: true }).waitFor();
    await help.getByRole("heading", { name: "Create a request", exact: true }).waitFor();
    await mkdir(".artifacts/publication-proof", { recursive: true });
    await page.screenshot({ path: ".artifacts/publication-proof/matching.png", fullPage: true });
    await page.reload();
    await page.getByRole("button", { name: "Help for this page" }).click();
    await help.getByRole("heading", { name: saved.document.title, exact: true }).waitFor();
    await page.goto(`${host}/requests`);
    const detailRoute = await page.locator("#request-list a").first().getAttribute("href");
    assert.ok(detailRoute, "Existing Request Desk detail link required");
    for (const route of ["/requests", detailRoute]) {
      await page.goto(`${host}${route}`);
      await page.getByRole("button", { name: "Help for this page" }).click();
      await help.getByText("No documentation published for this page.", { exact: true }).waitFor();
    }
    await page.screenshot({ path: ".artifacts/publication-proof/nonmatching.png", fullPage: true });
    // A delayed response for the create page must not populate a detail page.
    await page.goto(`${host}/requests/new`);
    let received!: () => void;
    const intercepted = new Promise<void>(resolve => { received = resolve; });
    let release!: () => void;
    const released = new Promise<void>(resolve => { release = resolve; });
    let delivered!: () => void;
    const deliveryFinished = new Promise<void>(resolve => { delivered = resolve; });
    await page.route("**/api/documentation/context?**", async route => {
      const response = await route.fetch(); received(); await released;
      try { await route.fulfill({ response }); } catch { /* Navigation aborts this request. */ } finally { delivered(); }
    }, { times: 1 });
    await page.getByRole("button", { name: "Help for this page" }).click();
    await intercepted;
    await page.getByLabel("Title (required)").fill("Publication navigation proof");
    await page.getByRole("button", { name: "Create request", exact: true }).click();
    await help.getByText("No documentation published for this page.", { exact: true }).waitFor();
    release(); await deliveryFinished;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    assert.equal(await help.textContent(), "No documentation published for this page.");
    await form.getByRole("button", { name: "Unpublish target", exact: true }).click();
    await form.getByText("Unpublished. Saved documents are unchanged.", { exact: true }).waitFor();
    await page.goto(`${host}/requests/new`);
    await page.getByRole("button", { name: "Help for this page" }).click();
    await help.getByText("No documentation published for this page.", { exact: true }).waitFor();
    assert.equal(await getPublication(target), null);
    assert.deepEqual(await getDocumentationDraft(id), saved);
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    console.log(`PASS: saved ${id} → explicit UI publish → matching/nonmatching → refresh → cancellation → UI unpublish; saved JSON/time unchanged; no external browser requests.`);
  } finally {
    if (ownedPublicationId) {
      const current = await getPublication(target);
      if (current?.id === ownedPublicationId) await unpublishDocumentation({ ...target, observedId: ownedPublicationId });
    }
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(closeDatabase);
