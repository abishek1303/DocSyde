import "dotenv/config";
import { readFile } from "node:fs/promises";
import { captureRuntimeContext } from "@/integrations/browser/capture";
import { getArtifactStorage } from "@/integrations/storage/storage";
async function main() {
  const input = JSON.parse(await readFile(process.argv[2], "utf8"));
  const storage = getArtifactStorage();
  console.log(JSON.stringify(await captureRuntimeContext(input, storage), null, 2));
}
main().catch(() => { console.error("Capture verification failed; check config, storage, Chromium, and local application."); process.exitCode = 1; });
