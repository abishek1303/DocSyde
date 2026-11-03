import { installOfflineNetworkBoundary } from "../reliability/offline-network";
// Test-only static rendering of the real review/preview components. No application writes.
import { createRequire, Module } from "node:module";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DocumentationChangeProposal } from "@/features/documentation/transformation/documentation-change-proposal";
import type { DocumentationDocument } from "@/features/documentation/documents/document";

if (process.env.DOCSYDE_RELIABILITY_CONTRACT_TEST === "1") installOfflineNetworkBoundary(process.cwd());
const load = createRequire(join(process.cwd(), "package.json"));
Object.assign(globalThis, { React });
globalThis.fetch = async () => { throw new Error("Rendering cannot call providers or application endpoints"); };
const navigationPath = load.resolve("next/navigation"), navigation = load(navigationPath);
load.cache[navigationPath]!.exports = { ...navigation, useRouter: () => ({ refresh() { throw new Error("Static render cannot mutate"); } }) };
const actionPath = load.resolve("./src/features/documentation/review/review-actions.ts");
const actionModule = new Module(actionPath);
actionModule.exports = { saveReviewedChanges: async () => { throw new Error("Static render cannot save"); } };
actionModule.loaded = true; load.cache[actionPath] = actionModule;
const publishActionPath = load.resolve("./src/features/documentation/review/publish-review-action.ts");
const publishActionModule = new Module(publishActionPath);
publishActionModule.exports = { publishReviewChanges: async () => { throw new Error("Static render cannot publish"); } };
publishActionModule.loaded = true; load.cache[publishActionPath] = publishActionModule;
const { ProposalReviewForm }: typeof import("@/features/documentation/components/review/proposal-review-form") = load("./src/features/documentation/components/review/proposal-review-form.tsx");
const { DraftInspector }: typeof import("@/features/documentation/components/reader/draft-inspector") = load("./src/features/documentation/components/reader/draft-inspector.tsx");
const { StageResponseContent }: typeof import("@/features/documentation/components/runs/stage-response-content") = load("./src/features/documentation/components/runs/stage-response-content.tsx");
const fixture: typeof import("./fixtures/priority-run.json") = load("./infra/local/documentation/fixtures/priority-run.json");
const data: { proposal: DocumentationChangeProposal; saved: DocumentationDocument } = JSON.parse(readFileSync(process.argv[2] === "-" ? 0 : process.argv[2], "utf8"));
const { proposal } = data;
const markup = renderToStaticMarkup(React.createElement("main", null,
  React.createElement("h1", null, "Proposed documentation"),
  React.createElement("p", null, "Offline representative priority proposal — mocked outputs, not a live generated result."),
  React.createElement(ProposalReviewForm, { proposalId: proposal.proposalId, repository: new URL(proposal.impact.provenance.source.repository).pathname.slice(1), proposalHash: "a".repeat(64), expired: false, accepted: null,
    items: proposal.results.map(result => ({ id: result.decisionId, action: result.decision.action, reason: result.decision.reason, ready: result.reviewReady, issues: [...result.issues, ...result.limitations] })) }),
  ...proposal.candidates.map(candidate => React.createElement(DraftInspector, { key: candidate.document.id, document: candidate.document, preview: true })),
  React.createElement("h2", null, "Captured evidence"),
  React.createElement(StageResponseContent, { stage: "runtime-inspection", label: "Runtime inspection", text: JSON.stringify({ observations: fixture.runtime.map(capture => ({response:capture.vision.data})) }) }),
));
assert.doesNotMatch(markup, /Developer details|canonical JSON|Not saved/);
assert.doesNotMatch(markup, /<details[^>]*open/);
assert.match(markup, /Observed in the app/);
assert.match(markup, /What this does not verify/);
assert.match(markup, /Viewport only/);
assert.match(markup, /Confirm review/);
assert.match(markup, /Normal.*Urgent/);
assert.match(markup, /type="radio"/);
assert.equal((markup.match(/checked=""/g) ?? []).length, proposal.results.filter(result => !["add", "revise"].includes(result.decision.action)).length); // Never preselect an approval.
assert.match(markup, /disabled=""/);
assert.match(markup, /Sources and confidence/);
assert.match(markup, /prior state|Runtime revision|runtime/i);
const planningMarkup = renderToStaticMarkup(React.createElement(StageResponseContent, { stage: "documentation-planning", label: "Documentation planning", text: JSON.stringify({decisions:[{updateIntent:"",reason:"Existing guidance remains accurate."}]}) }));
assert.match(planningMarkup, /Existing guidance remains accurate/);
const qualifiedMarkup = renderToStaticMarkup(React.createElement(StageResponseContent, {stage:"source-analysis",label:"Source analysis",text:JSON.stringify({findings:[{description:"Qualified finding",support:"inferred",confidence:"low",assumptions:["Reachability remains unverified"]}]})}));
assert.match(qualifiedMarkup, /Inferred from source/); assert.match(qualifiedMarkup, /Low confidence/); assert.match(qualifiedMarkup, /Reachability remains unverified/);
if (process.argv[3]) writeFileSync(process.argv[3], `<!doctype html><html lang="en"><meta charset="utf-8"><title>Offline priority review proof</title><style>body{font:16px/1.6 system-ui;max-width:900px;margin:32px auto;padding:16px}fieldset,article,details{border:1px solid #ccc;padding:16px;margin:16px 0}label{margin-right:24px}button{padding:8px 16px}p,pre{overflow-wrap:anywhere}svg{width:16px;height:16px}nav ol{padding-left:24px}</style>${markup}</html>`);
console.log("Representative priority proposal renders with explicit unselected review controls, disabled Save, previews and qualifications. No persistence or network.");
