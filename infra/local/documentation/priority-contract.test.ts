import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFile, mkdir } from "node:fs/promises";
import fixture from "./fixtures/priority-run.json";
import { synthesizeProductImpact } from "@/features/sources/impact/synthesize-product-impact";
import { validateProductResult } from "@/features/sources/analysis/validate-product-result";
import { allowedImpactClaims } from "@/features/sources/impact/impact-claim-support";
import { validateProductImpact } from "@/features/sources/impact/validate-product-impact";
import { productImpactOutputSchema } from "@/features/sources/impact/product-impact";
import { runtimeVisualEvidenceList } from "@/features/sources/runtime/runtime-visual-evidence";
import { runtimeInspectionContextSchema } from "@/features/sources/runtime/runtime-inspection-context";
import { validateDocumentationDocument } from "@/features/documentation/document-validation";
import { validateDocumentationProposal } from "@/features/documentation/validate-documentation-proposal";
import { validateImpactDecisions } from "@/features/documentation/validate-documentation-impact-plan";
import { intrinsicReviewReady, materializeApprovedUnit } from "@/features/documentation/materialize-approved-changes";
import type { TransformationAuthorization } from "@/features/documentation/transformation-input";
import type { SupportUnit } from "@/features/documentation/transformation-validation";

test("retained priority inputs → corrected synthesis → planner → transformation → review materialization, entirely offline", async t => {
  for (const [kind, expected] of [
    ["capability-added", ["behavior-change", "ui-change"]],
    ["workflow-changed", ["behavior-change", "workflow-change", "ui-change"]],
    ["field-requirement-changed", ["behavior-change", "ui-change"]],
    ["behavior-modified", ["behavior-change", "ui-change"]],
    ["behavior-removed", ["behavior-change", "ui-change"]],
    ["internal-change", ["internal-change"]],
  ] as const) assert.deepEqual(allowedImpactClaims(kind), expected);
  const source = validateProductResult(fixture.source), runtime = runtimeVisualEvidenceList.parse(fixture.runtime);
  const runtimeInspection = runtimeInspectionContextSchema.parse(fixture.runtimeInspection);
  const baseline = validateDocumentationDocument(fixture.baseline);
  assert.equal(source.bundle.head, "45799b2fae07f1326296b8ba85fae51476fd153d");
  assert.equal(fixture.failure.diagnostic.issues[0].code, "unsupported-change-claim");
  const sourceRefs = source.analysis!.findings;
  const visionRef = `visual:${runtime[0].captureId}:elements:0`;
  const corrected = productImpactOutputSchema.parse({
    assessment: "product-change", summary: "Request Desk adds Normal and Urgent request priority.",
    claims: sourceRefs.map((finding, index) => ({ description: index === 0 ? "Request creation offers Normal and Urgent priority, defaulting to Normal." : index === 1 ? "Request lists and details display priority." : "Session data preserves priority; older entries default to Normal.",
      kind: ["ui-change", "workflow-change", "behavior-change"][index], confidence: finding.confidence, confidenceReason: finding.confidenceReason,
      before: finding.before, after: finding.after, references: [`source-${index + 1}`], uncertainties: finding.uncertainties,
    })).concat([{ description: "The captured request details display Priority: Urgent.", kind: "visual-observation", confidence: "high", confidenceReason: "Visible text in the single selected live image.", before: null, after: null, references: [visionRef], uncertainties: [] }]),
    contradictions: [], uncertainties: [...runtimeInspection.unresolvedQuestions, "Only the resulting request detail was observed; no prior state or persistence was visually verified."],
  });
  const key = process.env.BASETEN_API_KEY; process.env.BASETEN_API_KEY = "mock-only-no-network";
  t.after(() => { if (key === undefined) delete process.env.BASETEN_API_KEY; else process.env.BASETEN_API_KEY = key; });
  const outputs: unknown[] = [];
  const response = (data: unknown) => Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(data)}}]});
  const fetch = t.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    const input = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    if (input.source?.findings) {
      assert.deepEqual(input.source.findings[0].allowedClaimKinds, ["behavior-change", "ui-change"]);
      return response(outputs.length ? outputs.shift() : corrected);
    }
    if (input.candidateCoverage) return response({decisions:[{action:"revise",documentId:baseline.id,sectionId:baseline.sections[2].id,
      reason:"The Create a request section omits the new priority choice and how it appears in request views.",updateIntent:"Explain Normal/Urgent priority while preserving the existing request instructions.",claimRefs:["claim-1","claim-2","claim-3"]}],uncertainties:[]});
    if (input.units) return response({verdicts:input.units.map((unit: SupportUnit)=>({unitId:unit.id,verdict:"supported",reason:"Fixture wording stays within the supplied source facts; no visual persistence claim."}))});
    if (input.authorizations) return response({entries:input.authorizations.map((auth:TransformationAuthorization)=>({decisionId:auth.decisionId,target:auth.target,change:{kind:"replace-section",section:{title:"Create a request",kind:"workflow",associations:[],content:[{
      markdown:"Create a request with a required title and optional description. Choose Normal (the default) or Urgent priority. Request lists and details display priority. Priority is preserved across close/reopen and refresh; older session entries without priority default to Normal.",
      claimRefs:auth.claims.map(c=>c.id),factRefs:auth.claims.map(c=>auth.facts.find(f=>f.claimRefs.includes(c.id)&&f.field==="after")!.id),
    }]}}}))});
    throw new Error("Unexpected mocked request; network is forbidden");
  });
  const {impact} = await synthesizeProductImpact({source,runtime,runtimeInspection});
  validateProductImpact(impact);
  assert.equal(impact.claims[3].before,null); assert.equal(impact.claims[3].after,null);
  assert.ok(impact.uncertainties.some(u=>u.includes("prior state")));
  for (const mutate of [
    (o: typeof corrected) => {o.claims[0].kind="workflow-change";},
    (o: typeof corrected) => {o.claims[0].references=[visionRef];},
    (o: typeof corrected) => {o.claims[3].kind="behavior-change";},
    (o: typeof corrected) => {o.claims[3].before="Normal";},
    (o: typeof corrected) => {o.claims[0].after="Invented historical behavior";},
  ]) {
    const invalid=structuredClone(corrected);mutate(invalid);outputs.push(invalid);
    await assert.rejects(synthesizeProductImpact({source,runtime,runtimeInspection}));
  }
  const load = createRequire(join(process.cwd(),"package.json")), databasePath=load.resolve("./src/integrations/database/documentation-drafts.ts");
  const queries=load(databasePath), databaseModule=load.cache[databasePath]!, previous=databaseModule.exports;
  const writes=t.mock.fn(()=>{throw new Error("No persistence writes allowed");});
  const row={id:baseline.id,document:baseline,savedAt:new Date("2026-10-30T00:00:00Z")};
  databaseModule.exports={...queries,searchDocumentationSections:async()=>[],selectDocumentationDrafts:async()=>[row],findDocumentationDraft:async(id:string)=>id===baseline.id?row:null,insertDocumentationDraft:writes};
  const paths=["operations","documentation-impact-input","select-documentation-candidates","validate-documentation-impact-plan","plan-documentation-impact","transform-documentation"].map(name=>load.resolve(`./src/features/documentation/${name}.ts`));
  const cached=paths.map(p=>load.cache[p]);paths.forEach(p=>{delete load.cache[p];});
  t.after(()=>{databaseModule.exports=previous;paths.forEach((p,i)=>{if(cached[i])load.cache[p]=cached[i];else delete load.cache[p];});});
  const {planDocumentationImpact}:typeof import("@/features/documentation/plan-documentation-impact")=load(paths[4]);
  const {transformDocumentation}:typeof import("@/features/documentation/transform-documentation")=load(paths[5]);
  const {plan}=await planDocumentationImpact({impact});
  assert.throws(() => validateImpactDecisions(impact, [{ ...plan.decisions[0], claimRefs: ["claim-4"] }], [baseline]), /source-supported/);
  const proposal=validateDocumentationProposal(await transformDocumentation({impact,plan}));
  assert.equal(proposal.status,"complete",JSON.stringify(proposal.results));
  assert.equal(proposal.results[0].reviewReady,true,JSON.stringify(proposal.results));
  assert.equal(intrinsicReviewReady(proposal,proposal.results[0]),true);
  const saved=materializeApprovedUnit(proposal,randomUUID(),proposal.results);
  validateDocumentationDocument(saved);
  assert.equal(saved.schemaVersion,2);
  assert.match(saved.sections.find(s=>s.title==="Create a request")!.content[0].markdown,/Normal.*Urgent/);
  assert.ok(saved.provenance.limitations.some(l=>l.includes("prior state")));
  assert.equal(writes.mock.callCount(),0);
  assert.equal(fetch.mock.callCount(),9); // six synthesis fixtures + planner, generation, support
  const rendered = execFileSync(process.execPath, ["--import", "tsx", "infra/local/documentation/render-priority-review.ts", "-"], {
    cwd: process.cwd(), input: JSON.stringify({proposal,saved}), encoding: "utf8",
    env: { ...process.env, BASETEN_API_KEY: "", META_API_KEY: "", DATABASE_URL: "" },
  });
  assert.match(rendered, /Representative priority proposal renders/);
  if (process.env.DOCSYDE_PRIORITY_PROOF_DIRECTORY) {
    await mkdir(process.env.DOCSYDE_PRIORITY_PROOF_DIRECTORY,{recursive:true});
    await writeFile(join(process.env.DOCSYDE_PRIORITY_PROOF_DIRECTORY,"verified-priority-proposal.json"),JSON.stringify({proposal,saved},null,2));
  }
});
