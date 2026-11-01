import "server-only";
import { z } from "zod";
import { reliabilityHash } from "@/integrations/reliability/execution-context";
import { documentationHash } from "../documents/document-identity";
import type { ReliabilityManifest } from "./reliability-baseline";

export const comparisonIdentitySchema = z.object({ specificationVersion: z.literal(2), docsydeSha: z.string(), requestDeskBase: z.string(),
  contractConfigSha256: reliabilityHash, runtimePolicySha256: reliabilityHash, corpusSha256: reliabilityHash, baselineSha256: reliabilityHash }).strict();
export function reliabilityComparisonIdentity(baseline: ReliabilityManifest["baseline"]) {
  const documents = [...baseline.documents].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const publications = baseline.publications.map(({ repository, route, documentId }) => ({ repository, route, documentId }))
    .sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0);
  const environment = Object.fromEntries(Object.entries(baseline.environment).filter(([key]) => key !== "DOCSYDE_STORAGE_DIRECTORY"));
  if (environment.DOCSYDE_HOST_ORIGIN) environment.DOCSYDE_HOST_ORIGIN = "$HOST";
  const endpoint = new URL(environment.DOCSYDE_DELIVERY_ENDPOINT ?? "http://127.0.0.1:3000/api/documentation/context");
  environment.DOCSYDE_DELIVERY_ENDPOINT = `${endpoint.pathname}${endpoint.search}`;
  const identity = { specificationVersion: baseline.specificationVersion, docsydeSha: baseline.docsydeSha, requestDeskBase: baseline.requestDeskBase,
    contractConfigSha256: documentationHash(baseline.inference), runtimePolicySha256: baseline.runtimePolicySha256,
    corpusSha256: documentationHash({ documents, publications, context: baseline.contextSha256 }) };
  return comparisonIdentitySchema.parse({ ...identity, baselineSha256: documentationHash({ ...identity, schemaFingerprintVersion: baseline.schemaFingerprintVersion, schemaSha256: baseline.schemaSha256, environment }) });
}
