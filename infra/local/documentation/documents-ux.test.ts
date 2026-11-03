import "dotenv/config";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir } from "node:fs/promises";
import { eq, sql } from "drizzle-orm";
import { chromium } from "playwright";
import { getDatabase, closeDatabase } from "@/integrations/database/client";
import { documentationReviews, documentationDrafts, documentationPublications, documentationPublicationHistory } from "@/integrations/database/schema";
import { getDocumentationDraft, saveDocumentationDraft } from "@/features/documentation/documents/operations";
import { publishDocumentation, getPublication } from "@/features/documentation/publication/publication-operations";
import { retainDocumentationProposal, getDocumentationReview } from "@/features/documentation/review/review-proposal-operations";
import { draftFixture } from "./draft-fixture";
import { reviewProposalFixture } from "./review-fixtures";

// Model-free proof using a unique local repository, never the connected demo's publications.
test("Documents UI: rendered live → review choices → explicit publish → rendered archive", { timeout: 120_000 }, async t => {
  const owner = `documents-ux-${randomUUID()}`, name = `${owner}/product`, repository = `https://github.com/${name}`;
  const previousAllow = process.env.DOCSYDE_ANALYSIS_REPOSITORIES;
  process.env.DOCSYDE_ANALYSIS_REPOSITORIES = `${name},${owner}/empty`;
  t.after(async () => {
    try {
      await getDatabase().delete(documentationReviews).where(eq(documentationReviews.repository, repository));
      await getDatabase().delete(documentationPublications).where(eq(documentationPublications.repository, repository));
      await getDatabase().delete(documentationPublicationHistory).where(eq(documentationPublicationHistory.repository, repository));
      await getDatabase().delete(documentationDrafts).where(sql`${documentationDrafts.document}->'provenance'->>'repository' = ${repository}`);
    } finally { await closeDatabase(); if (previousAllow === undefined) delete process.env.DOCSYDE_ANALYSIS_REPOSITORIES; else process.env.DOCSYDE_ANALYSIS_REPOSITORIES = previousAllow; }
  });
  const makeDocument = (title: string) => { const document = draftFixture(); document.provenance.repository = repository; document.title = title; return document; };
  const old = makeDocument("Issue Management"), baseline = makeDocument("Issue Management"), other = makeDocument("Request setup");
  for (const document of [old, baseline, other]) assert.equal((await saveDocumentationDraft(document)).status, "saved");
  const first = await publishDocumentation({ owner, repo: "product", route: "/requests/new", draftId: old.id });
  assert.equal(first.status, "published");
  assert.equal((await publishDocumentation({ owner, repo: "product", route: "/requests/new", draftId: baseline.id, observedId: first.publication!.id })).status, "published");
  const proposal = reviewProposalFixture(baseline), second = reviewProposalFixture(other, false);
  await retainDocumentationProposal(second); await retainDocumentationProposal(proposal);
  const socket = createServer(); await new Promise<void>(resolve => socket.listen(0, "127.0.0.1", resolve));
  const address = socket.address(); assert.ok(address && typeof address === "object"); const port = address.port;
  await new Promise<void>(resolve => socket.close(() => resolve()));
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: process.cwd(), env: { ...process.env, BASETEN_API_KEY: "", META_API_KEY: "", META_COMPOSITION_MODEL: "" }, stdio: "ignore" });
  t.after(() => { server.kill("SIGTERM"); });
  const origin = `http://127.0.0.1:${port}`;
  let started = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fetch(`${origin}/docs?${new URLSearchParams({ repository: name })}`); started = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(started, "local production server started");
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const url = (tab = "live", extra: Record<string, string> = {}) => `${origin}/docs?${new URLSearchParams({ repository: name, tab, ...extra })}`;
  await mkdir(".artifacts/documents-ux", { recursive: true });
  // Real project switching and document eligibility; Full scan remains onboarding-only.
  await page.goto(`${origin}/runs/new?${new URLSearchParams({ repository: name, branch: "main" })}`, { waitUntil: "networkidle" });
  const fullScan = page.getByRole("link", { name: /Full scan/ });
  const latestChanges = page.getByRole("link", { name: /Latest Changes/ });
  assert.equal(await fullScan.isVisible(), true);
  assert.equal(await latestChanges.isVisible(), true);
  await fullScan.focus(); await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Understand this product", exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Product context (optional)" }).isVisible(), true);
  assert.equal(await page.getByRole("button", { name: /Generate documentation/ }).count(), 0);
  await page.goBack({ waitUntil: "networkidle" });
  await page.getByRole("combobox", { name: "Project", exact: true }).selectOption(`${owner}/empty`);
  const disabledLatest = page.getByRole("group", { name: "Latest Changes", exact: true });
  await disabledLatest.waitFor();
  assert.equal(await disabledLatest.getAttribute("aria-disabled"), "true");
  assert.equal(await page.getByText("No documentation is available to update yet.", { exact: true }).isVisible(), true);
  assert.equal(await fullScan.isVisible(), true);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.getByRole("combobox", { name: "Project", exact: true }).selectOption(name);
  await latestChanges.waitFor();
  await latestChanges.click();
  await page.getByRole("heading", { name: "Latest Changes", exact: true }).waitFor();
  await page.getByRole("link", { name: "← Run options", exact: true }).waitFor();
  await page.getByRole("link", { name: "← Run options", exact: true }).click();
  await fullScan.waitFor();
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(url(), { waitUntil: "networkidle" });
  assert.equal(await page.getByRole("heading", { name: "Issue Management", exact: true }).count(), 1);
  assert.equal(await page.getByText("Current live documentation", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("About this draft and its limitations").count(), 0);
  await page.screenshot({ path: ".artifacts/documents-ux/latest.png" });
  await page.getByRole("navigation", { name: "On this page" }).getByRole("link").last().click();
  assert.ok(page.url().includes("#section-"));
  await page.goto(`${origin}/documentation/proposals/${proposal.proposalId}`, { waitUntil: "networkidle" });
  assert.equal(await page.getByRole("heading", { name: "Review documentation changes", exact: true }).isVisible(), true);
  assert.equal((await page.locator("main").innerText()).includes(proposal.proposalId), false);
  await page.goto(url("pending", { proposal: proposal.proposalId }), { waitUntil: "networkidle" });
  assert.equal(await page.getByRole("navigation", { name: "Pending documentation changes" }).getByRole("link").count(), 2);
  await page.getByRole("radio", { name: "Approve", exact: true }).first().check();
  await page.getByRole("navigation", { name: "Pending documentation changes" }).locator(`a[href*="proposal=${second.proposalId}"]`).click();
  await page.getByRole("group", { name: /Review Request setup/ }).waitFor();
  assert.equal(await page.getByRole("radio", { name: "Approve", exact: true }).isChecked(), false, "choices never carry into another proposal");
  await page.getByRole("navigation", { name: "Pending documentation changes" }).locator(`a[href*="proposal=${proposal.proposalId}"]`).click();
  await page.getByRole("group", { name: "Review Issue Management / Field requirement", exact: true }).waitFor();
  assert.ok(await page.getByText("Updated documentation", { exact: true }).count() >= 2);
  await page.getByRole("radio", { name: "Approve", exact: true }).first().check();
  assert.equal(await page.getByText("Selected for approval", { exact: true }).count(), 1);
  const before = await getDocumentationReview(proposal.proposalId); assert.equal(before.status === "found" ? before.review : "missing", null);
  await page.getByRole("button", { name: "Approve all", exact: true }).click();
  assert.equal(await page.getByText("Selected for approval", { exact: true }).count(), 2);
  await page.getByRole("radio", { name: "Reject", exact: true }).nth(1).check();
  await page.screenshot({ path: ".artifacts/documents-ux/review.png" });
  await page.getByRole("button", { name: "Confirm review", exact: true }).click();
  await page.getByRole("button", { name: "Publish changes", exact: true }).waitFor();
  assert.equal((await getPublication({ owner, repo: "product", route: "/requests/new" }))?.draftId, baseline.id, "approval does not publish");
  const accepted = await getDocumentationReview(proposal.proposalId); assert.equal(accepted.status, "found");
  if (accepted.status === "found") {
    const receipt = accepted.review!.saves[0], saved = await getDocumentationDraft(receipt.documentId!);
    assert.equal(saved.status, "found");
    if (saved.status === "found") assert.equal(saved.document.sections.length, baseline.sections.length, "rejected section is not saved");
  }
  const approvedSummary = page.getByText("Read approved documentation: Issue Management", { exact: true });
  await approvedSummary.waitFor(); await approvedSummary.click();
  assert.equal(await page.locator("details").filter({ has: approvedSummary }).getByRole("article").getByRole("heading", { level: 3 }).count(), baseline.sections.length, "rendered approved preview excludes the rejected addition");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.getByText("Approved changes", { exact: true }).count(), 1, "saved approval remains discoverable until publication");
  await page.getByRole("button", { name: "Publish changes", exact: true }).click();
  await page.waitForURL(location => location.searchParams.get("published") === "1");
  await page.getByText("Your documentation changes are live.", { exact: false }).waitFor();
  const live = await getPublication({ owner, repo: "product", route: "/requests/new" }); assert.notEqual(live?.draftId, baseline.id);
  await page.goto(url("history"), { waitUntil: "networkidle" });
  const versions = page.getByRole("navigation", { name: "Archived document versions" }).getByRole("link");
  assert.equal(await versions.count(), 2);
  const links = await versions.evaluateAll(elements => elements.map(element => element.getAttribute("href")!));
  for (const link of links) {
    await page.goto(origin + link, { waitUntil: "networkidle" });
    assert.equal(await page.getByText("Archived version", { exact: false }).isVisible(), true);
    await page.getByText("Compare with current live documentation", { exact: true }).click();
    assert.equal(await page.getByText("Current live version", { exact: true }).isVisible(), true);
  }
  await page.screenshot({ path: ".artifacts/documents-ux/archive.png" });
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Documents", exact: true }).click();
  await page.getByText("Current live documentation", { exact: true }).waitFor();
  await page.goBack({ waitUntil: "networkidle" });
  assert.equal(await page.getByText("Archived version", { exact: false }).isVisible(), true);
  const later = makeDocument("Issue Management"); await saveDocumentationDraft(later);
  assert.equal((await publishDocumentation({ owner, repo: "product", route: "/requests/new", draftId: later.id, observedId: live!.id })).status, "published");
  await page.goto(url("pending"), { waitUntil: "networkidle" });
  assert.equal(await page.locator(`nav[aria-label="Pending documentation changes"] a[href*="proposal=${proposal.proposalId}"]`).count(), 0, "published then archived approvals must not return to Pending Changes");
  await page.goto(url("pending", { proposal: second.proposalId }), { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: "Reject", exact: true }).check();
  await page.getByRole("button", { name: "Confirm review", exact: true }).click();
  await page.getByText("Review complete. No changes were approved.", { exact: false }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Publish changes", exact: true }).count(), 0);
  for (const viewport of [{ width: 1366, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const tab of ["live", "pending", "history"]) {
      await page.goto(url(tab), { waitUntil: "networkidle" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${tab} horizontal overflow at ${viewport.width}`);
      assert.equal(await page.locator("main").evaluate(element => element.scrollWidth <= element.clientWidth), true);
      assert.ok(await page.locator("[data-scroll-viewport]").evaluateAll(elements => elements.filter(element => element.scrollHeight > element.clientHeight + 1).length) <= 1, "only one page region owns vertical scrolling");
      assert.ok(await page.getByRole("navigation", { name: "Breadcrumb" }).count() || await page.locator('nav[aria-label*="readcrumb"]').count());
      if (viewport.width === 390) await page.screenshot({ path: `.artifacts/documents-ux/mobile-${tab}.png` });
    }
  }
  for (const [tab, text] of [["live", "No live documentation yet"], ["pending", "No documentation changes waiting for review."], ["history", "No previous versions yet."]]) {
    await page.goto(`${origin}/docs?${new URLSearchParams({ repository: `${owner}/empty`, tab })}`, { waitUntil: "networkidle" });
    assert.equal(await page.getByText(text, { exact: true }).isVisible(), true);
  }
  assert.deepEqual(errors, []);
});
