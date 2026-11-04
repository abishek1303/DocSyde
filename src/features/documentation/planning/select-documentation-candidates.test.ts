import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { draftFixture } from "../../../../infra/local/documentation/draft-fixture";
import { transformationImpactFixture, transformationDecisionFixture } from "../../../../infra/local/documentation/transformation-fixtures";
import { v2CandidateFixture } from "../../../../infra/local/documentation/v2-fixture";
import type { DocumentationDocument } from "../documents/document";
import { CANDIDATE_POOL_SECTION_LIMIT } from "./candidate-selection";
const load=createRequire(join(process.cwd(),"package.json"));
const databasePath=load.resolve("./src/integrations/database/documentation-drafts.ts");
const database:typeof import("@/integrations/database/documentation-drafts")=load(databasePath);
const invocationPath=load.resolve("./src/integrations/database/ai-model-invocations.ts");
const invocationQueries:typeof import("@/integrations/database/ai-model-invocations")=load(invocationPath);
function document(path="unrelated.ts") {
 const d=draftFixture();d.title="Request title guide";d.provenance.evidence[0].path=path;
 d.sections.forEach(s=>{s.title="Details";s.content.forEach(b=>{b.markdown="Review request title details.";});});return d;
}
function setup(t:TestContext,documents:DocumentationDocument[],response?:unknown,rawHits?:unknown[]) {
 const original=load.cache[databasePath]!.exports,originalInvocations=load.cache[invocationPath]!.exports;
 const search=t.mock.fn(async(_repository:string,_query:unknown,limit:number,publishedOnly:boolean)=>{
  assert.equal(limit,CANDIDATE_POOL_SECTION_LIMIT+1);assert.equal(publishedOnly,true);
  return (rawHits??documents.flatMap(d=>d.sections.map(s=>({documentId:d.id,sectionId:s.id})))).slice(0,limit);
 });
 const get=t.mock.fn(async(id:string)=>{const d=documents.find(d=>d.id===id);return d?{id,document:d,savedAt:new Date("2026-11-04T00:00:00Z")}:null;});
 const list=t.mock.fn(async()=>{throw new Error("Ranked selection must not broad-load the corpus");});
 load.cache[databasePath]!.exports={...database,searchDocumentationSections:search,findDocumentationDraft:get,selectDocumentationDrafts:list,insertDocumentationDraft:()=>{throw new Error("Selection/planning must never write documents");}};
 load.cache[invocationPath]!.exports={...invocationQueries,insertAiModelInvocation:async()=>{},updateAiModelInvocation:async()=>{}};
 const paths=["./src/features/documentation/documents/operations.ts","./src/features/documentation/planning/documentation-impact-input.ts","./src/features/documentation/planning/select-documentation-candidates.ts","./src/features/documentation/planning/plan-documentation-impact.ts","./src/integrations/ai/invocation-log.ts","./src/integrations/ai/generate-structured.ts"].map(p=>load.resolve(p));
 const cached=paths.map(p=>[p,load.cache[p]] as const);paths.forEach(p=>{delete load.cache[p];});
 const prior={mode:process.env.DEMO_RELIABILITY_MODE,key:process.env.BASETEN_API_KEY};process.env.DEMO_RELIABILITY_MODE="false";process.env.BASETEN_API_KEY="fixture";
 t.after(()=>{load.cache[databasePath]!.exports=original;load.cache[invocationPath]!.exports=originalInvocations;for(const[p,m]of cached){if(m)load.cache[p]=m;else delete load.cache[p];}for(const[k,v]of Object.entries({DEMO_RELIABILITY_MODE:prior.mode,BASETEN_API_KEY:prior.key})){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
 let payload: {documents:{id:string;sections:{id:string}[]}[];candidateSelection:unknown}|undefined;
 const fetch=t.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
  if(!response)throw new Error("No inference expected");payload=JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
  return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(response)}}]});
 });
 const selector:typeof import("./select-documentation-candidates")=load("./src/features/documentation/planning/select-documentation-candidates.ts");
 const planner:typeof import("./plan-documentation-impact")=load("./src/features/documentation/planning/plan-documentation-impact.ts");
 return {...selector,...planner,search,get,list,fetch,payload:()=>payload};
}

test("50 excess section hits rank down to an evidenced winner and enter the existing validated planner once",async t=>{
 const target=document("form-0.ts"),corpus=[...Array.from({length:24},()=>document()),target];
 const impact=transformationImpactFixture();const s=setup(t,corpus,{decisions:[transformationDecisionFixture(target.id,target.sections[0].id)],uncertainties:[]});
 const result=await s.planDocumentationImpact({impact,publishedOnly:true});
 assert.deepEqual(result.selection?.selectedDocumentIds,[target.id]);assert.equal(result.selection?.diagnostics?.scannedSections,50);assert.equal(result.selection?.diagnostics?.outcome,"evidence-narrowed");
 assert.equal(s.fetch.mock.callCount(),1);assert.equal(s.list.mock.callCount(),0);
 assert.deepEqual(s.payload()?.documents.map(d=>d.id),[target.id]);assert.equal(s.payload()?.documents[0].sections.length,target.sections.length,"Full selected target outline is retained");
 assert.equal(result.plan.decisions[0].documentId,target.id);
});
test("multiple source-supported targets remain distinct after excess candidates are removed",async t=>{
 const first=document("form-0.ts"),second=document("form-1.ts"),impact=transformationImpactFixture(2);
 const s=setup(t,[...Array.from({length:20},()=>document()),first,second]);
 const result=await s.selectDocumentationCandidates(impact,{publishedOnly:true});
 assert.deepEqual(result.selection.selectedDocumentIds,[first.id,second.id].sort());assert.equal(result.selection.coverage,"search-selected");assert.equal(s.fetch.mock.callCount(),0);
});
test("equally supported oversized targets retain incomplete and precise safe diagnostics before inference",async t=>{
 const s=setup(t,Array.from({length:11},()=>document("form-0.ts")));const impact=transformationImpactFixture();
 const result=await s.selectDocumentationCandidates(impact,{publishedOnly:true});
 assert.equal(result.selection.coverage,"incomplete");assert.equal(result.selection.diagnostics?.outcome,"ambiguous");assert.equal(result.selection.selectedDocumentIds.length,0);
 await assert.rejects(s.planDocumentationImpact({impact,publishedOnly:true}),error=>{assert.ok(error instanceof s.CandidateSelectionIncompleteError);assert.equal(error.selection.diagnostics?.scannedDocuments,11);assert.match(error.message,/indistinguishable-matches|supported-targets/);return true;});
 assert.equal(s.fetch.mock.callCount(),0);
});
test("retrieval sentinel reports pool-limit instead of treating an unexamined tail as irrelevant",async t=>{
 const corpus=Array.from({length:101},()=>document()),s=setup(t,corpus);
 const result=await s.selectDocumentationCandidates(transformationImpactFixture(),{publishedOnly:true});
 assert.equal(result.selection.diagnostics?.outcome,"pool-limit");assert.equal(result.selection.diagnostics?.scannedSections,201);assert.equal(s.get.mock.callCount(),0);assert.equal(s.fetch.mock.callCount(),0);
});
test("corrupt or unsupported search projections still fail validation, never invent a matching association",async t=>{
 const d=document();d.title="Billing";d.sections.forEach(s=>{s.title="Invoice";s.content.forEach(b=>{b.markdown="Payment details.";});});
 const s=setup(t,[d]);await assert.rejects(s.selectDocumentationCandidates(transformationImpactFixture(),{publishedOnly:true}),/projection disagrees/);
 assert.equal(s.fetch.mock.callCount(),0);
});
test("Full Scan still bypasses all candidate/history reads",async t=>{
 const impact=transformationImpactFixture();impact.provenance.source.base=impact.provenance.source.head;
 impact.provenance.sourceReferences.forEach(s=>{s.finding.before=null;s.finding.after=null;});impact.claims.forEach(c=>{c.before=null;c.after=null;});
 const s=setup(t,Array.from({length:30},()=>document()),{decisions:[transformationDecisionFixture(null,null,"add")],uncertainties:[]});
 await s.planDocumentationImpact({impact,objective:"fresh"});
 assert.equal(s.search.mock.callCount(),0);assert.equal(s.get.mock.callCount(),0);assert.equal(s.list.mock.callCount(),0);assert.equal(s.fetch.mock.callCount(),1);
});

test("saved v2 discovery document projects through candidate selection without inventing finding support",async t=>{
 const d=v2CandidateFixture(document("form-0.ts")).document;
 const route=d.context.find(a=>a.id==="route-form")!;
 route.origin="discovery";
 route.routeEvidence={label:"Request desk",method:"file-page",commitId:d.provenance.contexts[0].head,sources:[{path:"src/app/page.tsx",line:1,excerpt:"export default function Page() {}"}],requiresConfirmation:false};
 const saved=JSON.stringify(d),s=setup(t,[JSON.parse(saved)]);
 const result=await s.selectDocumentationCandidates(transformationImpactFixture(),{publishedOnly:true});
 assert.deepEqual(result.selection.selectedDocumentIds,[d.id]);
 assert.ok(result.documents[0].routes.includes(route.value));
 const {projectSectionContexts}=load("./src/features/documentation/documents/section-context.ts") as typeof import("../documents/section-context");
 assert.ok(projectSectionContexts(JSON.parse(saved)).every(section=>section.associations.some(a=>a.kind==="route"&&a.provenance.origin==="discovery"&&a.value===route.value)));
 assert.equal(JSON.stringify(d),saved);assert.equal(s.fetch.mock.callCount(),0);
});
