import "dotenv/config";
import { createDraftFromChanges } from "../../../src/features/documentation/generate-documentation-draft";
const [base = "cb08108", head = "e321954", ...paths] = process.argv.slice(2);
createDraftFromChanges({ owner: "abishek1303", repo: "DocSyde", base, head, paths: paths.length ? paths : ["src/app/sources/context/page.tsx", "src/features/sources/components/source-context-form.tsx"] }).then(result => {
  console.log(JSON.stringify(result, null, 2)); if (result.status === "error") process.exitCode = 1;
}).catch(() => { console.error("Draft verification failed; check inputs, provider access and budgets."); process.exitCode = 1; });
