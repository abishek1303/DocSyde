import { z } from "zod";
export const discoveryFallback = z.object({ projectTypes: z.array(z.string().min(1).max(60)).max(8), paths: z.array(z.string().min(1).max(512)).max(6), confidence: z.enum(["high", "medium", "low"]), reasoning: z.string().min(1).max(400) }).strict();
const ignored = /(^|\/)(node_modules|vendor|target|dist|build|\.git|\.venv|__pycache__|tests?|__tests__)(\/|$)|(?:\.test|\.spec)\./;
// Domain-neutral roles: workflow surfaces and state/data operations outrank shared widgets.
export function productRelevance(path: string) {
 const parts = path.toLowerCase().split(/[\/._-]+/);
 const utility = parts.some(part => ["shared", "ui", "utils", "utilities", "icons", "error", "banner", "toast", "spinner", "theme"].includes(part));
 const workflow = parts.some(part => ["features", "workflows", "routes", "actions", "controllers", "endpoints", "handlers", "state", "store", "context", "api", "services", "list", "detail", "form", "editor", "checkout", "search"].includes(part));
 return (workflow ? 30 : 0) - (utility ? 40 : 0);
}
export function rankReferencedFiles(paths: string[], entries: string[]) {
 return [...new Set(paths)].sort((a,b) => {
  const proximity = (path: string) => Math.max(0, ...entries.map(entry => {
   const left = path.split("/").slice(0,-1), right = entry.split("/").slice(0,-1);
   let common=0; while (common < left.length && common < right.length && left[common] === right[common]) common++;
   return common;
  }));
  return productRelevance(b) - productRelevance(a) || proximity(b)-proximity(a) || a.localeCompare(b, "en");
 });
}
export function discoverRepository(tree: string[]) {
 const paths = [...new Set(tree)].filter(path => !ignored.test(path)).sort();
 const ecosystems = new Set<string>();
 const ranked: { path: string; score: number; reason: string }[] = [];
 for (const path of paths) {
  const name = path.split("/").at(-1)!;
  let score = 0, reason = "";
  if (/^README(?:\.md|\.rst|\.txt)?$/i.test(name)) { score = 85; reason = "Product overview"; }
  const type = name === "package.json" ? "JS/TS" : name === "Cargo.toml" ? "Rust" : /^(pyproject\.toml|requirements\.txt)$/.test(name) ? "Python" : /\.(csproj|sln)$/.test(name) ? ".NET" : name === "go.mod" ? "Go" : /^(pom\.xml|build\.gradle(?:\.kts)?)$/.test(name) ? "JVM" : null;
  if (type) { ecosystems.add(type); score = 90; reason = `${type} manifest`; }
  if (/(^|\/)(main|lib)\.rs$/.test(path)) { score = 100; reason = "Rust target entry"; }
  if (/(^|\/)(Program\.cs|.*Controller\.cs)$/.test(path)) { score = 100; reason = ".NET entry/controller"; }
  if (/(^|\/)(main|app|__main__|views|routes)\.py$/.test(path)) { score = 100; reason = "Python application entry/surface"; }
  if (/(^|\/)(main|routes|handlers)\.go$/.test(path)) { score = 100; reason = "Go application entry/handlers"; }
  if (/(Application|Controller)\.(java|kt)$/.test(path)) { score = 100; reason = "JVM application entry/controller"; }
  if (/(^|\/)(app|main|index|page|routes|router)\.[cm]?[jt]sx?$/.test(path)) { score = 100; reason = "JS/TS application entry/routes"; }
  if (/\.(?:cs|py|go|rs|java|kt|[cm]?[jt]sx?)$/.test(path) && productRelevance(path) > 0) { score = 105; reason = "Product workflow/state/data surface"; }
  if (score) ranked.push({ path, score: score + productRelevance(path) - path.split("/").length, reason });
 }
 ranked.sort((a,b) => b.score-a.score || a.path.localeCompare(b.path, "en"));
 // Reserve overview and distinct ecosystem manifests, then representative product files.
 const manifests = ranked.filter(file => file.reason.endsWith("manifest"));
 const overview = ranked.find(file => file.reason === "Product overview");
 const selected = [...(overview ? [overview] : []), ...manifests.slice(0, 2)];
 // Keep one application entry as the anchor for product data-flow sampling.
 const entry = ranked.find(file => /entry|target/.test(file.reason));
 if (entry) selected.push(entry);
 for (const file of ranked.filter(file => !file.reason.endsWith("manifest") && file.reason !== "Product overview")) if (selected.length < 5 && !selected.some(item => item.path === file.path)) selected.push(file);
 return { ecosystems: [...ecosystems].sort(), selected, needsFallback: ecosystems.size === 0 || !selected.some(file => file.score >= 91 && !file.reason.endsWith("manifest")), gaps: manifests.length > 2 ? ["Only two manifests fit the workspace sampling budget; additional projects were not read."] : [] };
}
export function validateFallbackPaths(raw: unknown, tree: string[]) {
 const result = discoveryFallback.parse(raw);
 const allowed = new Set(tree.filter(path => !ignored.test(path)));
 if (result.paths.some(path => !allowed.has(path) || path.split("/").some(part => part === ".." || part === ".") || path.startsWith("/"))) throw new Error("Discovery returned a path outside the pinned eligible tree.");
 return result.confidence === "high" ? result.paths : [];
}
/** One local import/module hop. Only existing tree files can enter selection. */
export function followLocalReferences(path: string, text: string, tree: string[]) {
 const found = new Set<string>(); const allowed = new Set(tree.filter(file => !ignored.test(file)));
 const directory = path.split("/").slice(0,-1);
 // Declared target paths complement conventional entries without executing scripts.
 const targets: string[] = [];
 if (path.endsWith("package.json")) {
  try {
   const data: unknown = JSON.parse(text);
   if (data && typeof data === "object") for (const key of ["main", "module", "source"]) {
    const value = Reflect.get(data, key); if (typeof value === "string" && value.length <= 512) targets.push(value);
   }
  } catch { /* Malformed manifest remains an explicit coverage limitation. */ }
 }
 if (path.endsWith("Cargo.toml")) for (const match of text.slice(0,12000).matchAll(/^\s*path\s*=\s*["']([^"']+)["']/gm)) targets.push(match[1]);
 for (const target of targets.slice(0,4)) {
  const candidate = [...directory, target.replace(/^\.\//, "")].join("/");
  if (!target.split("/").includes("..") && allowed.has(candidate)) found.add(candidate);
 }
 for (const match of text.slice(0, 12000).matchAll(/(?:from\s*["'](\.[^"']+)["']|mod\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;)/g)) {
  const parts = [...directory];
  for (const part of (match[1] ?? match[2]).split("/")) { if (part === "..") parts.pop(); else if (part !== ".") parts.push(part); }
  const base = parts.join("/");
  for (const candidate of [base, ...[".tsx", ".ts", ".jsx", ".js", ".rs", "/index.tsx", "/index.ts", "/mod.rs"].map(ext => base+ext)]) if (allowed.has(candidate)) found.add(candidate);
 }
 return rankReferencedFiles([...found], [path]).slice(0, 2);
}
