import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { draftFixture } from "../../../../infra/local/documentation/draft-fixture";
import { transformationImpactFixture } from "../../../../infra/local/documentation/transformation-fixtures";
import { projectSectionContexts } from "../documents/section-context";
import { candidateQuery, matchSection, candidateSelectionSchema, type CandidateQuery, type CandidateMatch } from "./candidate-selection";
import { narrowDocumentationCandidates, sectionSourcePaths } from "./narrow-documentation-candidates";

const query: CandidateQuery = { tokens: ["request", "title", "validation", "invoice", "payment", "export"], associations: [], sourcePaths: ["src/request.ts", "src/billing.ts"], priorTexts: ["The request title is optional"], observedRoutes: [] };
function section(title = "Generic guide", text = "request title validation invoice payment export") {
 const d = draftFixture(); d.title = "Generic guide";d.sections[0].title = title;d.sections[0].content.forEach(b=>{b.markdown=text;});
 d.provenance.evidence[0].path="unrelated.ts";
 return d;
}
function matches(documents: ReturnType<typeof draftFixture>[], q=query) {
 return documents.flatMap(d=>projectSectionContexts(d).flatMap(context=>{
  const match=matchSection(context,q,sectionSourcePaths(d,context.sectionId));return match?[match]:[];
 }));
}
function parsedSelection(result:ReturnType<typeof narrowDocumentationCandidates>) {
 return candidateSelectionSchema.parse({selectedDocumentIds:result.ids,matches:result.matches,coverage:result.outcome==="ambiguous"?"incomplete":"search-selected",broadFallbackUsed:false,reason:result.outcome==="ambiguous"?"plausible-candidates-exceed-limit":"deterministic-matches"});
}

test("excess lexical candidates narrow to a direct source winner, independently of input order",()=>{
 const winner=section();winner.provenance.evidence[0].path="src/request.ts";
 const corpus=[...Array.from({length:14},()=>section()),winner],original=JSON.stringify(corpus);
 const found=matches(corpus),result=narrowDocumentationCandidates(found,query);
 assert.equal(result.outcome,"evidence-narrowed");assert.deepEqual(result.ids,[winner.id]);assert.equal(result.matches[0].reasons.some(r=>r.kind==="source-path"),true);
 assert.deepEqual(result,narrowDocumentationCandidates([...found].reverse(),query));assert.ok(parsedSelection(result));assert.equal(JSON.stringify(corpus),original);
});
test("multiple independently supported documents and all their strong sections survive narrowing",()=>{
 const requests=section(),billing=section();requests.provenance.evidence[0].path="src/request.ts";billing.provenance.evidence[0].path="src/billing.ts";
 const result=narrowDocumentationCandidates(matches([...Array.from({length:14},()=>section()),requests,billing]),query);
 assert.deepEqual(result.ids,[requests.id,billing.id].sort());assert.equal(result.outcome,"evidence-narrowed");assert.ok(parsedSelection(result));
});
test("eleven equally strong distinct targets remain incomplete rather than selecting by score or UUID",()=>{
 const documents=Array.from({length:11},()=>section("Request title", "The request title is optional"));
 const result=narrowDocumentationCandidates(matches(documents),query);
 assert.equal(result.outcome,"ambiguous");assert.equal(result.ids.length,0);assert.equal(result.supportedDocuments,11);assert.ok(parsedSelection(result));
});
test("a shared application source file does not eclipse an existing-section mismatch winner",()=>{
 const documents=Array.from({length:12},()=>section());for(const d of documents)d.provenance.evidence[0].path="src/request.ts";
 const winner=documents[11];winner.sections[0].content[0].markdown="The request title is optional";
 const result=narrowDocumentationCandidates(matches(documents),query);assert.deepEqual(result.ids,[winner.id]);
});
test("observed routes, existing section text and explicit features support distinct targets without inventing labels",()=>{
 const q:CandidateQuery={...query,associations:[{kind:"route",value:"/billing"},{kind:"feature",value:"request-intake"}],observedRoutes:["/billing"]};
 const runtime=section("Invoice payment", "Details"),feature=section();
 runtime.context[0].value="/billing";
 feature.context.push({id:"feature",kind:"feature",value:"request-intake",origin:"operator"});feature.sections[0].associations.push("feature");
 const result=narrowDocumentationCandidates(matches([...Array.from({length:12},()=>section()),runtime,feature],q),q);
 assert.deepEqual(result.ids,[runtime.id,feature.id].sort());
 assert.ok(result.matches.every(m=>m.reasons.some(r=>r.kind==="association")));
 const unobserved={...q,observedRoutes:[]};const without=narrowDocumentationCandidates(matches([...Array.from({length:12},()=>section()),runtime,feature],unobserved),unobserved);
 assert.deepEqual(without.ids,[feature.id],"An unobserved requested route alone does not establish strong runtime relevance");
});
test("unsupported and generic matches do not manufacture a winner or a source/feature association",()=>{
 const unrelated=section("Billing manual","Renewal invoices only");
 assert.equal(matchSection(projectSectionContexts(unrelated)[0],{tokens:["request","title"],associations:[],sourcePaths:["invented.ts"]},sectionSourcePaths(unrelated,unrelated.sections[0].id)),null);
 const weak=matches(Array.from({length:15},()=>section()));const result=narrowDocumentationCandidates(weak,query);
 assert.equal(result.outcome,"ambiguous");assert.equal(result.supportedDocuments,0);
});
test("section provenance is scoped to cited findings and actual source paths, not filenames or document labels",()=>{
 const d=section();d.provenance.evidence.push({id:"uncited",path:"src/request.ts",side:"patch",commitId:null,contentId:null});
 assert.deepEqual(sectionSourcePaths(d,d.sections[0].id),["unrelated.ts"]);
 d.sections[1].findingRefs=[];assert.deepEqual(sectionSourcePaths(d,d.sections[1].id),[]);
 const impact=transformationImpactFixture();const q=candidateQuery(impact);
 assert.deepEqual(q.sourcePaths,impact.provenance.sourceEvidence.map(e=>e.path).sort());
 assert.ok(!q.associations.some(a=>a.kind==="feature"),"No feature names are inferred from source filenames");
});
test("more than forty matching sections can narrow without clipping strongly supported sections",()=>{
 const winner=section();winner.provenance.evidence[0].path="src/request.ts";
 const strong=matches([winner]);const weak=Array.from({length:50},()=>({...matches([section()])[0],sectionId:randomUUID()} satisfies CandidateMatch));
 const result=narrowDocumentationCandidates([...weak,...strong],query);assert.equal(result.outcome,"evidence-narrowed");assert.deepEqual(result.ids,[winner.id]);
});

test("a clear target for one claim cannot hide genuine ambiguity for another workflow",()=>{
 const q:CandidateQuery={tokens:["request","title","billing","refund"],associations:[],sourcePaths:["src/request.ts","src/refund.ts"],claimSignals:[{tokens:["request","title"],sourcePaths:["src/request.ts"]},{tokens:["billing","refund"],sourcePaths:["src/refund.ts"]}]};
 const winner=section("Request title","Request title details");winner.provenance.evidence[0].path="src/request.ts";
 const ambiguous=Array.from({length:12},()=>section("Billing refund","Billing refund details"));
 const result=narrowDocumentationCandidates(matches([winner,...ambiguous],q),q);
 assert.equal(result.outcome,"ambiguous");assert.equal(result.constraint,"uncovered-claim-targets");assert.equal(result.ids.length,0);
});

test("all supported documents sharing a source remain when the group fits the planner bound",()=>{
 const supported=Array.from({length:3},()=>section());supported.forEach(d=>{d.provenance.evidence[0].path="src/request.ts";});
 const result=narrowDocumentationCandidates(matches([...Array.from({length:8},()=>section()),...supported]),query);
 assert.deepEqual(result.ids,supported.map(d=>d.id).sort());assert.equal(result.outcome,"evidence-narrowed");
});
