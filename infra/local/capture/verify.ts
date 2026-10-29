import { readFile } from "node:fs/promises";
import { captureRuntimeContext } from "@/integrations/browser/capture";
async function main() { console.log(JSON.stringify(await captureRuntimeContext(JSON.parse(await readFile(process.argv[2], "utf8"))), null, 2)); }
main().catch(() => { console.error("Capture verification failed; check config, Chromium, and local application."); process.exitCode = 1; });
