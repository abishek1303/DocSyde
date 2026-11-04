import "server-only";
import ts from "typescript";
import { posix } from "node:path";
import { createHash } from "node:crypto";
import type { ProductBundle } from "../analysis/product-change-analysis";
import type { ProductRoute } from "./product-route-contract";

const concrete = (value: string) => value.length <= 300 && /^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/.test(value) && !value.split("/").some(part => part === "." || part === "..");
const label = (value: string) => value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_/]/g, " ").trim().slice(0, 100).replace(/^./, char => char.toUpperCase()) || "Home";
/** Only supplied pinned files are inspected. No navigation strings, API endpoints or model text establish a screen. */
export function discoverProductRoutes(bundle: ProductBundle): ProductRoute[] {
  if (bundle.mode !== "current-state" || bundle.base !== bundle.head) return [];
  const files = bundle.evidence.filter(file => file.side === "head" && file.commitId === bundle.head && file.status === "available" && file.text);
  const byPath = new Map(files.map(file => [file.path, file]));
  const parsed = new Map(files.filter(file => /\.[cm]?[jt]sx?$/.test(file.path)).map(file => [file.path, ts.createSourceFile(file.path, file.text!, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)]));
  const resolve = (from: string, spec: string) => {
    if (!spec.startsWith(".")) return undefined;
    const base = posix.normalize(posix.join(posix.dirname(from), spec));
    return [base, ...[".tsx", ".jsx", ".ts", ".js", "/index.tsx", "/index.jsx"].map(ext => base + ext)].find(path => byPath.has(path));
  };
  const imports = (path: string) => parsed.get(path)?.statements.flatMap(node => ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) ? [node] : []) ?? [];
  const routed = (path: string) => imports(path).some(node => /^(?:react-router|@tanstack\/react-router|next\/navigation)/.test((node.moduleSpecifier as ts.StringLiteral).text)) || /\blocation\.pathname\b|\bhistory\.(?:pushState|replaceState)\b/.test(byPath.get(path)?.text ?? "");
  const reachable = (start: string) => {
    const seen = new Set<string>(), todo = [start];
    while (todo.length && seen.size < 16) { const path = todo.shift()!; if (seen.has(path)) continue; seen.add(path);
      if (routed(path)) continue;
      for (const node of imports(path)) { const target = resolve(path, (node.moduleSpecifier as ts.StringLiteral).text); if (target && !seen.has(target)) todo.push(target); }
    }
    return [...seen];
  };
  const routes: ProductRoute[] = [];
  const add = (pathname: string, title: string, method: ProductRoute["evidence"]["method"], sources: ProductRoute["evidence"]["sources"], sourcePaths: string[]) => {
    if (!concrete(pathname) || routes.length >= 12) return;
    routes.push({ id: `screen-${createHash("sha256").update(`${pathname}:${sources[0].path}`).digest("hex").slice(0, 12)}`, pathname,
      evidence: { label: label(title), method, commitId: bundle.head, sources, requiresConfirmation: false }, sourcePaths });
  };
  for (const file of files) {
    const path = file.path;
    // Next-style file routing, only with a Next manifest in the same checkout.
    const manifest = files.find(file => file.path === "package.json");
    let next = false;
    if (manifest?.text) {
      const json = ts.parseJsonText(manifest.path, manifest.text), expression = json.statements[0]?.expression;
      if (expression && ts.isObjectLiteralExpression(expression)) next = expression.properties.some(property => {
        if (!ts.isPropertyAssignment(property) || !["dependencies", "devDependencies"].includes(property.name.getText(json).replace(/^"|"$/g, "")) || !ts.isObjectLiteralExpression(property.initializer)) return false;
        // A complete dependency object is sufficient even when later manifest fields are outside the source sample.
        return property.initializer.getText(json).trimEnd().endsWith("}") && property.initializer.properties.some(dependency => ts.isPropertyAssignment(dependency) && dependency.name.getText(json) === '"next"' && ts.isStringLiteral(dependency.initializer) && !!dependency.initializer.text);
      });
    }
    if (next) {
      const app = /^(?:src\/)?app\/(.*?)\/?page\.[jt]sx?$/.exec(path);
      const pages = /^(?:src\/)?pages\/(.*?)\.[jt]sx?$/.exec(path);
      let part = app?.[1] ?? pages?.[1];
      const declaration = parsed.get(path)?.statements.find(node => ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword) || ts.isExportAssignment(node));
      if (part !== undefined && declaration && !/(?:^|\/)(?:api|_|@)|\[|\]/.test(part)) {
        part = part.split("/").filter(piece => piece && !/^\([^)]*\)$/.test(piece)).join("/");
        if (pages) part = part.replace(/(?:^|\/)index$/, "");
        const line = parsed.get(path)!.getLineAndCharacterOfPosition(declaration.getStart()).line;
        const manifestLine = manifest!.text!.split("\n").findIndex(line => /"next"\s*:/.test(line));
        if (manifestLine < 0) continue;
        add(part ? `/${part}` : "/", part || "Home", "file-page", [{ path, line: line + 1, excerpt: file.text!.split("\n")[line] || " " }, { path: manifest!.path, line: manifestLine + 1, excerpt: manifest!.text!.split("\n")[manifestLine] }], reachable(path));
      }
    }
    const ast = parsed.get(path);
    if (!ast || !routed(path)) continue;
    const routeNames = new Set(imports(path).flatMap(node => /^(?:react-router|@tanstack\/react-router)/.test((node.moduleSpecifier as ts.StringLiteral).text) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) ? node.importClause.namedBindings.elements.filter(item => (item.propertyName?.text ?? item.name.text) === "Route").map(item => item.name.text) : []));
    const bindings = new Map(imports(path).flatMap(node => {
      const target = resolve(path, (node.moduleSpecifier as ts.StringLiteral).text);
      const names = [node.importClause?.name?.text, ...(node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) ? node.importClause.namedBindings.elements.map(item => item.name.text) : [])].filter((name): name is string => !!name);
      return target ? names.map(name => [name, target] as const) : [];
    }));
    const visit = (node: ts.Node) => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        if (routeNames.has(node.tagName.getText(ast))) {
          const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
          const attr = attributes.find(attr => attr.name.getText(ast) === "path")?.initializer;
          const element = attributes.find(attr => attr.name.getText(ast) === "element")?.initializer;
          const component = element?.getText(ast).match(/<([A-Za-z_$][\w$]*)\b/)?.[1];
          const target = component && bindings.get(component);
          // Nested/relative routes need router-aware resolution, never naive concatenation.
          let parent = node.parent; let nested = false;
          while (parent) { if (ts.isJsxElement(parent) && routeNames.has(parent.openingElement.tagName.getText(ast))) nested = true; parent = parent.parent; }
          if (attr && ts.isStringLiteral(attr) && target && !nested) add(attr.text, component!, "client-route", [{ path, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, excerpt: node.getText(ast).slice(0, 2000) }], reachable(target));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  for (const html of files.filter(file => file.path === "index.html")) {
    const text = html.text!.replace(/<!--[\s\S]*?-->/g, "");
    const entryPath = text.match(/<script\b[^>]*type=["']module["'][^>]*src=["']\/([^"']+)["'][^>]*>/)?.[1];
    const entry = entryPath && byPath.get(entryPath), ast = entryPath && parsed.get(entryPath);
    if (!entry || !ast || !imports(entry.path).some(node => /^(?:react-dom\/client|preact)$/.test((node.moduleSpecifier as ts.StringLiteral).text))) continue;
    const mountNames = new Set(imports(entry.path).flatMap(node => /^(?:react-dom\/client|preact)$/.test((node.moduleSpecifier as ts.StringLiteral).text) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) ? node.importClause.namedBindings.elements.filter(item => ["render", "createRoot"].includes(item.propertyName?.text ?? item.name.text)).map(item => item.name.text) : []));
    let mounted = false;
    const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && mountNames.has(node.expression.getText(ast))) mounted = true; ts.forEachChild(node, visit); }; visit(ast);
    if (mounted && !reachable(entry.path).some(routed)) add("/", text.match(/<title>([^<]+)<\/title>/)?.[1] ?? "Application", "spa-entry", [{ path: html.path, line: 1, excerpt: html.text! }, { path: entry.path, line: 1, excerpt: entry.text! }], reachable(entry.path));
  }
  return routes.filter((route, index) => routes.findIndex(other => other.pathname === route.pathname) === index);
}
