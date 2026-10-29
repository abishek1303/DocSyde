import "dotenv/config";
import { analyzeProductChanges } from "../../../src/features/sources/analyze-product-changes";
const [base = "cb08108", head = "e321954", ...paths] = process.argv.slice(2);
analyzeProductChanges({ owner: "abishek1303", repo: "DocSyde", base, head, paths }).then(result => {
  console.log(JSON.stringify({ ...result, bundle: { ...result.bundle, evidence: result.bundle.evidence.map(({ text, ...e }) => ({ ...e, characters: text?.length ?? 0 })) } }, null, 2));
  if (result.status === "error") process.exitCode = 1;
}).catch(() => { console.error("Product analysis failed; check evidence selection and provider configuration."); process.exitCode = 1; });
