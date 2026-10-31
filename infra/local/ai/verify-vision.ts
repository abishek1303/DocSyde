import "dotenv/config";
import { analyzeScreenshot } from "@/integrations/ai/analyze-screenshot";
import { ModelError } from "@/integrations/ai/structured-output";
import { getArtifactStorage } from "@/integrations/storage/storage";

async function main() {
  const [artifactKey, context, ...extra] = process.argv.slice(2);
  if (!artifactKey || !context || extra.length) {
    throw new Error("Usage: npm run ai:vision:verify -- <artifact-key> '<analysis context>'");
  }
  console.log(JSON.stringify(await analyzeScreenshot({ artifactKey, context }, getArtifactStorage()), null, 2));
}
main().catch((error: unknown) => {
  console.error(error instanceof ModelError ? error.message : "Vision verification failed; check input and artifact storage.");
  process.exitCode = 1;
});
