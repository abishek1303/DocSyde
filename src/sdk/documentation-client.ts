import { parseHostContext, type HostContext } from "./context-client.js";

export type DeliveryQualification = {
  support: "directly-supported" | "inferred";
  confidence: "low" | "medium" | "high";
  confidenceReason: string;
  assumptions: string[];
  uncertainties: string[];
};
export type DeliveryPublication = {
  id: string;
  documentId: string;
  publishedAt: string;
  title: string;
  sections: { id: string; title: string; blocks: { markdown: string }[]; qualifications: DeliveryQualification[] }[];
  limitations: string[];
};
export type DeliveryResponse = { version: 1; publication: DeliveryPublication | null };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid documentation response.");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid documentation response.");
  return value;
}
function array<T>(value: unknown, parse: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) throw new Error("Invalid documentation response.");
  return value.map(parse);
}
function qualification(value: unknown): DeliveryQualification {
  const q = record(value);
  if ((q.support !== "directly-supported" && q.support !== "inferred") || (q.confidence !== "low" && q.confidence !== "medium" && q.confidence !== "high")) throw new Error("Invalid documentation response.");
  return { support: q.support, confidence: q.confidence, confidenceReason: string(q.confidenceReason), assumptions: array(q.assumptions, string), uncertainties: array(q.uncertainties, string) };
}
export function parseDeliveryResponse(value: unknown): DeliveryResponse {
  const response = record(value);
  if (response.version !== 1) throw new Error("Invalid documentation response.");
  if (response.publication === null) return { version: 1, publication: null };
  const p = record(response.publication);
  return { version: 1, publication: {
    id: string(p.id), documentId: string(p.documentId), publishedAt: string(p.publishedAt), title: string(p.title),
    sections: array(p.sections, value => {
      const s = record(value);
      return { id: string(s.id), title: string(s.title), blocks: array(s.blocks, b => ({ markdown: string(record(b).markdown) })), qualifications: array(s.qualifications, qualification) };
    }),
    limitations: array(p.limitations, string),
  } };
}

// Explicit one-shot retrieval. The host owns navigation, presentation and retries.
export async function retrieveDocumentation(input: {
  endpoint: string;
  repository: { owner: string; repo: string };
  context: HostContext;
  signal?: AbortSignal;
}): Promise<DeliveryResponse> {
  const context = parseHostContext(input.context);
  const url = new URL(input.endpoint);
  url.searchParams.set("owner", input.repository.owner);
  url.searchParams.set("repo", input.repository.repo);
  url.searchParams.set("route", context.route);
  const response = await fetch(url, { signal: input.signal, cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error("Could not load contextual documentation.");
  return parseDeliveryResponse(await response.json());
}
