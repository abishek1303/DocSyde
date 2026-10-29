import "dotenv/config";
import { readSourceContext } from "../../../src/features/sources/read-source-context";
const [revision = "cb08108", ...paths] = process.argv.slice(2);
readSourceContext({ owner: "abishek1303", repo: "DocSyde", revision, paths: paths.length ? paths : [
  "src/features/sources/change-summary.ts", "src/features/sources/summarize-changes.ts",
  "src/features/sources/summary-evidence.ts", "src/app/actions.ts",
] }).then(result => {
  // Report provenance and coverage, never source bodies or credentials.
  console.log(JSON.stringify({ ...result, files: result.files.map(file => {
    if (file.status === "available") { const { text, ...metadata } = file; return { ...metadata, bytes: Buffer.byteLength(text, "utf8") }; }
    return file;
  }) }, null, 2));
  if (!result.complete) process.exitCode = 1;
}).catch(() => { console.error("Source context verification failed; check inputs, repository access, and GitHub configuration."); process.exitCode = 1; });
