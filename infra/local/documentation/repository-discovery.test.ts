import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
test("discovery calls metadata fallback only for ambiguous structures", async t => {
 const load=createRequire(import.meta.url); let tree=["package.json","src/client/app.tsx"]; let calls=0; let invalid=false;
 const restore: (()=>void)[]=[];
 const overrides=[
  ["../../../src/integrations/github/source-reader.ts",{resolveRevision:async()=>({commitId:"a".repeat(40)})}],
  ["../../../src/integrations/github/repository-tree.ts",{readRepositoryTree:async()=>tree}],
  ["../../../src/features/sources/context/read-source-context.ts",{readPinnedSourceContext:async(input:{paths:string[]})=>({commitId:"a".repeat(40),files:input.paths.map(path=>({path,status:"available",text:"product"}))})}],
  ["../../../src/integrations/ai/generate-structured.ts",{generateStructured:async(options:{input:string})=>{calls++; const input=JSON.parse(options.input);assert.ok(Buffer.byteLength(options.input)<=32768);assert.equal(input.files,undefined);return {data:{projectTypes:["Unknown"],paths:[invalid?"../secret":"custom/product.xyz"],confidence:"high",reasoning:"metadata"}};}}],
 ] as const;
 for(const [path,replacement] of overrides){const resolved=load.resolve(path),original=load(resolved),cached=load.cache[resolved]!;cached.exports={...original,...replacement};restore.push(()=>{cached.exports=original;});}
 t.after(()=>restore.forEach(fn=>fn()));
 const {readDiscoveredContext}:typeof import("@/features/sources/context/read-discovered-context")=load("../../../src/features/sources/context/read-discovered-context.ts");
 await readDiscoveredContext({owner:"test",repo:"app",revision:"main"});assert.equal(calls,0);
 tree=["custom/product.xyz"];await readDiscoveredContext({owner:"test",repo:"app",revision:"main"});assert.equal(calls,1);
 invalid=true;await assert.rejects(()=>readDiscoveredContext({owner:"test",repo:"app",revision:"main"}));assert.equal(calls,2);
});
