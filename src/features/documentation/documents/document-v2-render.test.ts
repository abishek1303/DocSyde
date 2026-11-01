import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";
import { v2CandidateFixture } from "../../../../infra/local/documentation/v2-fixture";

test("existing renderer displays both evidence comparisons and revision wording in Chromium", async t => {
  const { document } = v2CandidateFixture();
  const render = spawnSync(process.execPath, ["--import", "tsx", "-e", `global.React=require('react');global.fetch=()=>{throw Error('No external calls')};const {renderToStaticMarkup}=require('react-dom/server');const {DraftInspector}=require('./src/features/documentation/components/reader/draft-inspector.tsx');const document=JSON.parse(require('node:fs').readFileSync(0,'utf8'));process.stdout.write(renderToStaticMarkup(React.createElement(DraftInspector,{document})));`],
    { input: JSON.stringify(document), encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } });
  assert.equal(render.status, 0, render.stderr);
  const browser = await chromium.launch(); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent(render.stdout);
  await page.locator("details").evaluateAll(elements => elements.forEach(element => element.setAttribute("open", "")));
  assert.equal(await page.getByText("Evidence comparison: cccccccc → dddddddd", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Evidence comparison: aaaaaaaa → bbbbbbbb", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Revision generated with fixture", { exact: true }).isVisible(), true);
  assert.equal(await page.getByText("Retained baseline content was preserved, not reverified by this revision.", { exact: true }).isVisible(), true);
});
