import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverRepository, validateFallbackPaths, followLocalReferences } from "./discover-repository";
test("conventional JS and Preact layouts succeed without fallback", () => {
 for (const entry of ["src/app/page.tsx", "src/client/app.tsx"]) {
 const tree = ["README.md", "package.json", entry, "src/client/components/issue-list.tsx"];
 const result = discoverRepository(tree);
 assert.equal(result.needsFallback, false); assert.ok(result.selected.some(file => file.path === entry));
 assert.deepEqual(discoverRepository([...tree].reverse()), result);
 }
});
test("Cargo, multiple ecosystems, and language entry heuristics", () => {
 for (const [manifest,entry] of [["Cargo.toml","src/main.rs"],["pyproject.toml","app/main.py"],["go.mod","cmd/web/main.go"],["app.csproj","Program.cs"],["pom.xml","src/Application.java"]]) {
 const result = discoverRepository([manifest,entry]); assert.equal(result.needsFallback,false); assert.ok(result.selected.some(file => file.path === entry));
 }
 assert.equal(discoverRepository(["Cargo.toml","src/main.rs","ui/package.json","ui/src/app.tsx"]).ecosystems.length,2);
 assert.deepEqual(followLocalReferences("src/main.rs", "mod web;", ["src/web.rs"]),["src/web.rs"]);
});
test("ambiguous metadata triggers fallback and rejects invalid or uncertain paths", () => {
 const tree=["README.md","custom/widget.xyz"];
 assert.equal(discoverRepository(tree).needsFallback,true);
 const output={projectTypes:["Unknown"],paths:["custom/widget.xyz"],confidence:"high",reasoning:"Candidate"};
 assert.deepEqual(validateFallbackPaths(output,tree),output.paths);
 assert.throws(()=>validateFallbackPaths({...output,paths:["../secret"]},tree));
 assert.throws(()=>validateFallbackPaths({...output,paths:["missing.ts"]},tree));
 assert.deepEqual(validateFallbackPaths({...output,confidence:"low"},tree),[]);
});
test("large trees retain bounded selection and exclude dependencies/tests", () => {
 const result=discoverRepository(["package.json",...Array.from({length:1000},(_,i)=>`packages/${i}/src/app.tsx`),"node_modules/main.ts","tests/main.ts"]);
 assert.ok(result.selected.length<=6); assert.ok(result.selected.every(file=>!file.path.startsWith("node_modules/")));
});
test("generic workflow/state files outrank shared widgets and import order", () => {
 const tree=["package.json","src/app.tsx","src/components/error-banner.tsx","src/components/invoice-editor.tsx","src/state/cart.ts","src/shared/toast.tsx"];
 const selected=discoverRepository(tree).selected.map(file=>file.path);
 assert.ok(selected.includes("src/components/invoice-editor.tsx"));
 assert.ok(selected.includes("src/state/cart.ts"));
 assert.ok(!selected.includes("src/components/error-banner.tsx"));
 const imports="import { Error } from './components/error-banner'; import { Invoice } from './components/invoice-editor'; import { Cart } from './state/cart';";
 assert.deepEqual(followLocalReferences("src/app.tsx",imports,tree),["src/components/invoice-editor.tsx","src/state/cart.ts"]);
});
