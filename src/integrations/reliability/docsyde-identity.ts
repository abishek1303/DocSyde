import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { ReliabilityIsolationError, requireReliabilityContext, type ReliabilityContext } from "./execution-context";
import { readCleanCheckoutIdentity } from "../local-git/checkout-identity";
import { getDatabase } from "../database/client";
import { sql } from "drizzle-orm";

export const docsydeIdentitySchema = z.object({ version: z.literal(1), experimentId: z.string(), scenario: z.enum(["A", "B", "C"]),
  docsydeSha: z.string(), token: z.uuid(), pid: z.number().int().positive(), databaseName: z.string(), buildId: z.string().min(1) }).strict();
export async function currentDocsydeIdentity(token: string | null) {
  const context = requireReliabilityContext(["scenario"]);
  if (!token || token !== process.env.DOCSYDE_RELIABILITY_SERVER_TOKEN) throw new ReliabilityIsolationError("server-token");
  const checkout = await readCleanCheckoutIdentity(context.repositoryRoot);
  if (checkout.sha !== context.docsydeSha || process.cwd() !== context.repositoryRoot) throw new ReliabilityIsolationError("server-checkout");
  const database = await getDatabase().execute(sql`SELECT current_database() AS name`);
  return docsydeIdentitySchema.parse({ version: 1, experimentId: context.experimentId, scenario: context.scenario, docsydeSha: checkout.sha,
    token, pid: process.pid, databaseName: database.rows[0].name, buildId: (await readFile(join(context.repositoryRoot, ".next/BUILD_ID"), "utf8")).trim() });
}
export function assertDocsydeIdentity(actual: unknown, expected: z.infer<typeof docsydeIdentitySchema>) {
  if (!isDeepStrictEqual(docsydeIdentitySchema.parse(actual), expected)) throw new ReliabilityIsolationError("docsyde-server-identity");
}
export async function verifyDocsydeIdentity(context: ReliabilityContext, token: string, pid: number, server: { port: string; databaseName: string; buildId: string }) {
  const response = await fetch(`http://127.0.0.1:${server.port}/api/reliability/identity`, { headers: { "x-docsyde-reliability-token": token }, signal: AbortSignal.timeout(3000), cache: "no-store" });
  if (!response.ok) throw new ReliabilityIsolationError("docsyde-server-unavailable");
  assertDocsydeIdentity(await response.json(), { version: 1, experimentId: context.experimentId, scenario: context.scenario!, docsydeSha: context.docsydeSha, token, pid, databaseName: server.databaseName, buildId: server.buildId });
}
