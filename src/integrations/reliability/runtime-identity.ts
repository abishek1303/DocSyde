import "server-only";
import { isDeepStrictEqual } from "node:util";
import { ReliabilityIsolationError, runtimeIdentitySchema, type ReliabilityRuntimeIdentity } from "./execution-context";

export function assertRuntimeIdentity(expected: ReliabilityRuntimeIdentity, observed: unknown) {
  if (!isDeepStrictEqual(runtimeIdentitySchema.parse(observed), expected)) throw new ReliabilityIsolationError("runtime-identity-mismatch");
}
export async function verifyRuntimeIdentity(baseUrl: string, expected: ReliabilityRuntimeIdentity) {
  const base = new URL(baseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.protocol !== "http:" || base.username || base.password) throw new ReliabilityIsolationError("runtime-origin");
  const response = await fetch(new URL("/health", base), { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new ReliabilityIsolationError("runtime-health");
  assertRuntimeIdentity(expected, await response.json());
  return expected;
}
