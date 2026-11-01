import { draftFixture } from "../../../../infra/local/documentation/draft-fixture";
import { validateDocumentationDocument } from "../documents/document-validation";
import assert from "node:assert/strict";
import { test } from "node:test";
import { draftProposal, draftGenerationProposal, DRAFT_GENERATION_BLOCK_CHARACTERS } from "../documents/document";
import { draftInstructions } from "./draft-prompt";

test("draft generation enforces prompt's 800-character blocks while retaining the 1500-character historical contract", () => {
  const section={title:"Guide",kind:"workflow",associations:[],content:Array.from({length:2},()=>({markdown:"x".repeat(800),factRefs:["finding-1-after"]}))};
  const output={title:"Guide",associations:[],sections:Array.from({length:4},()=>section)};
  assert.ok(draftGenerationProposal.safeParse(output).success);
  const historical={...output,sections:[{...section,content:[{...section.content[0],markdown:"x".repeat(1500)}]}]};
  assert.ok(draftProposal.safeParse(historical).success); assert.equal(draftGenerationProposal.safeParse(historical).success,false);
  const canonical = draftFixture(); canonical.sections[0].content[0].markdown = "x".repeat(1500);
  assert.equal(validateDocumentationDocument(canonical).sections[0].content[0].markdown.length, 1500);
  assert.ok(draftInstructions.includes(`<=${DRAFT_GENERATION_BLOCK_CHARACTERS} characters per block`));
});
