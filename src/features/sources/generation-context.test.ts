import { test } from "node:test";
import assert from "node:assert/strict";
import { repositoryContextText, runContextText } from "./generation-context";
import { repositoryLocation } from "@/integrations/github/repository-identity";
test("optional context limits and exact whitespace preservation", () => {
  for (const schema of [repositoryContextText, runContextText]) {
    for (const empty of [null, undefined, "", " \n\t "]) assert.equal(schema.parse(empty), null);
    const exact = "  Keep  Case.\nSecond line!  "; assert.equal(schema.parse(exact), exact);
  }
  assert.equal(repositoryContextText.parse("x".repeat(500))?.length, 500);
  assert.throws(() => repositoryContextText.parse("x".repeat(501)));
  assert.equal(runContextText.parse("x".repeat(300))?.length, 300);
  assert.throws(() => runContextText.parse("x".repeat(301)));
});
test("repository identity shares coordinate validation and existing case equivalence", () => {
  assert.equal(repositoryLocation({owner:" Abishek1303 ",repo:" DocSyde "}), repositoryLocation({owner:"abishek1303",repo:"docsyde"}));
  assert.notEqual(repositoryLocation({owner:"abishek1303",repo:"other"}), repositoryLocation({owner:"abishek1303",repo:"docsyde"}));
  assert.throws(() => repositoryLocation({owner:"x/y",repo:"z"}));
});
