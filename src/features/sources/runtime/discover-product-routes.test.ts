import { test } from "node:test";
import assert from "node:assert/strict";
import { discoverProductRoutes } from "./discover-product-routes";
import { selectCurrentStatePaths } from "../analysis/current-state-selection";
import type { ProductBundle } from "../analysis/product-change-analysis";
// Bounded excerpts from the connected OpenTodo demo at 696c37b (no runtime or inference).
import opentodo from "./fixtures/opentodo-routes.json";
const head = "d".repeat(40);
export function routeBundle(files: Record<string, string>): ProductBundle {
  return { mode: "current-state", repository: "https://github.com/example/product", base: head, head, limited: true, notice: "Fixture bounded source sample",
    inventory: Object.keys(files).map(path => ({ path, kind: "current-file", previousPath: null })), evidence: Object.entries(files).map(([path, text], i) => ({ id: `snapshot-${i + 1}`, path, side: "head", commitId: head, text, changed: false, status: "available" })) };
}
test("OpenTodo's actual client entry and state-switched workflows share the root screen", () => {
  const routes = discoverProductRoutes(routeBundle(opentodo));
  assert.deepEqual(routes.map(route => route.pathname), ["/"]);
  assert.equal(routes[0].evidence.label, "Issue Tracker");
  assert.ok(routes[0].sourcePaths.includes("src/client/components/issue-list.tsx"));
  assert.ok(routes[0].sourcePaths.includes("src/client/components/project-list.tsx"));
  const selected = selectCurrentStatePaths([...Object.keys(opentodo), "package.json", ...Array.from({ length: 30 }, (_, i) => `src/features/flow-${i}/actions.ts`)]);
  assert.ok(selected.includes("index.html")); assert.ok(selected.includes("src/client/main.tsx")); assert.equal(selected.length, 16);
});
test("conventional file routing is bounded to real concrete pages, excluding API/private/dynamic routes", () => {
  const routes = discoverProductRoutes(routeBundle({ "package.json": '{\n"dependencies":{"next":"16"},\n"devDependencies": {', "app/page.tsx": "export default function Home() { return <h1>Home</h1> }", "app/settings/page.tsx": "export default function Settings() { return <h1>Settings</h1> }", "app/api/items/route.ts": "export function GET() {}", "app/items/[id]/page.tsx": "export default function Item() {}", "pages/_app.tsx": "export default function App() {}" }));
  assert.deepEqual(routes.map(route => route.pathname), ["/", "/settings"]);
});
test("static client Route elements bind screens to imported modules, never links or API handlers", () => {
  const routes = discoverProductRoutes(routeBundle({ "src/router.tsx": 'import { Route } from "react-router-dom";\nimport Settings from "./settings";\nexport const views = <Routes><Route path="/settings" element={<Settings />} /></Routes>;', "src/settings.tsx": "export default function Settings() {return <h1>Settings</h1>}", "src/server.ts": 'app.get("/api/items", handler);', "src/example.tsx": 'const text = `<Route path="/fake" />`; // example' }));
  assert.deepEqual(routes.map(route => route.pathname), ["/settings"]); assert.deepEqual(routes[0].sourcePaths, ["src/settings.tsx"]);
});
test("backend-only projects and unmounted HTML never invent a root screen", () => {
  assert.deepEqual(discoverProductRoutes(routeBundle({ "src/api.ts": 'router.get("/", handler); router.get("/items", handler)', "package.json": '{"dependencies":{"express":"5"}}' })), []);
  assert.deepEqual(discoverProductRoutes(routeBundle({ "index.html": '<script type="module" src="/src/main.tsx"></script>', "src/main.tsx": 'import { useState } from "preact"; function render(){} render();' })), []);
  assert.deepEqual(discoverProductRoutes({ ...routeBundle(opentodo), base: "a".repeat(40) }), []);
});
