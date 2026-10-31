import { type ProductAnalysis, type ProductBundle, type ProductEvidence } from "./product-change-analysis";
import { isConcreteInspectionPath } from "./inspection-decision";

type RouteCandidate = { pathname: string; citation: ProductAnalysis["findings"][number]["citations"][number] };

function completeSource(evidence: ProductEvidence, bundle: ProductBundle): { text: string; lineOffset: number; patch: boolean } | null {
  if (evidence.text === null) return null;
  if (evidence.side === "head" && evidence.status === "available") return { text: evidence.text, lineOffset: 0, patch: false };
  // A partial modification hunk may begin inside a comment or template string.
  // Only a complete added-file hunk gives safe lexical context without more reads.
  if (evidence.side !== "patch" || !bundle.inventory.some(file => file.path === evidence.path && file.kind === "added")) return null;
  const lines = evidence.text.split("\n");
  const header = /^@@ -0,0 \+1(?:,(\d+))? @@$/.exec(lines[0]);
  if (!header) return null;
  const count = Number(header[1] ?? 1);
  const source = lines.slice(1, count + 1);
  if (source.length !== count || source.some(line => !line.startsWith("+"))
    || lines.slice(count + 1).some(line => line !== "" && line !== "\\ No newline at end of file")) return null;
  return { text: source.map(line => line.slice(1)).join("\n"), lineOffset: 1, patch: true };
}

export function inspectionRouteCandidates(bundle: ProductBundle): RouteCandidate[] {
  const candidates: RouteCandidate[] = [];
  for (const evidence of bundle.evidence) {
    if (!/\.(?:[cm]?[jt]sx?|json)$/.test(evidence.path)) continue;
    const source = completeSource(evidence, bundle);
    if (!source) continue;
    let blockComment = false, quote = "", escaped = false;
    source.text.split("\n").forEach((line, index) => {
      // Ignore comment/template/string continuation lines. This deliberately
      // recognizes only simple declarations, not arbitrary routing expressions.
      let ignored = blockComment || !!quote;
      for (let i = 0; i < line.length; i++) {
        const char = line[i], next = line[i + 1];
        if (blockComment) { if (char === "*" && next === "/") { blockComment = false; i++; } continue; }
        if (quote) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === quote) quote = "";
          continue;
        }
        if (char === "/" && next === "/") { ignored = true; break; }
        if (char === "/" && next === "*") { ignored = true; blockComment = true; i++; }
        else if (char === '"' || char === "'" || char === "`") { quote = char; if (char === "`") ignored = true; }
      }
      if (ignored) return;
      const patterns = [
        /^\s*<(?:a|Link)\s+href=(["'])(\/[^"']*)\1(?=\s|>|\/>)/,
        /^\s*(?:app|router)\.get\(\s*(["'])(\/[^"']*)\1\s*,/,
        /^\s*(?:["']?(?:path|pathname|route)["']?)\s*:\s*(["'])(\/[^"']*)\1\s*,?\s*$/,
      ];
      const pathname = patterns.map(pattern => pattern.exec(line)?.[2]).find(value => value !== undefined);
      if (pathname === undefined || !isConcreteInspectionPath(pathname)) return;
      const excerpt = `${source.patch ? "+" : ""}${line}`;
      if (!excerpt.length || excerpt.length > 600) return;
      const number = index + source.lineOffset + 1;
      candidates.push({ pathname, citation: { evidenceId: evidence.id, startLine: number, endLine: number, excerpt } });
    });
  }
  return candidates;
}
