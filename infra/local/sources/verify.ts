import "dotenv/config";
import { summarizeChanges } from "../../../src/features/sources/summarize-changes";
const [base = "40bd71f8adb0a8380f0de20ff65aa6915fb7654c", head = "78695f525dce698832c9ef9dbdb4109dd86fdd9c"] = process.argv.slice(2);
summarizeChanges({ owner: "abishek1303", repo: "DocSyde", base, head }).then(result => {
  console.log(JSON.stringify(result, null, 2)); if (result.error) process.exitCode = 1;
}).catch(() => { console.error("Live source analysis failed; check local provider configuration and access."); process.exitCode = 1; });
