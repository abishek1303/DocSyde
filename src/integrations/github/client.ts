import "server-only";

import { demoRepository } from "./demo-repository";
import { branchSelectionQuery } from "./branch-query";
import { repositoryCoordinates } from "./repository-identity";
import { z } from "zod";
import { SourceReadError } from "@/integrations/github/errors";

export async function createGithubClient(signal?: AbortSignal) {
  const target = demoRepository();
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    throw new SourceReadError("missing-credentials", "Set GITHUB_TOKEN before reading GitHub repositories.");
  }

  // Native dynamic import also supports the existing tsx CLI's CommonJS context
  // with Octokit's ESM-only dependencies. No SDK load is needed without a token.
  const { Octokit } = await import("octokit");
  const client = new Octokit({
    auth: token,
    userAgent: "DocSyde/source-evidence",
    retry: { enabled: false },
    throttle: { enabled: false },
    // Avoid SDK logging of raw errors, which can retain request credentials.
    log: { debug() {}, info() {}, warn() {}, error() {} },
  });
  client.hook.before("request", (options) => {
    const request = client.request.endpoint(options);
    const url = new URL(request.url);
    const path = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(?:\/|$)/);
    let allowed = false;
    if (url.origin === "https://api.github.com" && path) {
      allowed = path[1].toLowerCase() === target.owner && path[2].toLowerCase() === target.repo;
    } else if (url.origin === "https://api.github.com" && url.pathname === "/graphql" && request.body !== undefined) {
      // Only DocSyde's fixed branch query is allowed; arbitrary GraphQL can hide other repositories in aliases or literals.
      try {
        const body = z.object({ query: z.literal(branchSelectionQuery), variables: repositoryCoordinates.extend({ after: z.string().nullable().optional() }).strict() }).strict().parse(typeof request.body === "string" ? JSON.parse(request.body) : request.body);
        allowed = body.variables.owner === target.owner && body.variables.repo === target.repo;
      } catch { /* Unknown requests fail closed without exposing provider/request details. */ }
    }
    if (!allowed) throw new SourceReadError("forbidden", "DocSyde only allows GitHub requests for the configured target repository.");
    // Installed Octokit forwards signals but does not implement request.timeout.
    options.request.signal = AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
    options.request.redirect = "error";
    options.headers["X-GitHub-Api-Version"] = "2026-03-10";
  });
  // A successful authenticated read establishes access, not exclusive token scope.
  await withGithubErrors(async () => {
    const { data } = await client.rest.repos.get(target);
    if (typeof data.full_name !== "string" || data.full_name.toLowerCase() !== `${target.owner}/${target.repo}`) {
      throw new SourceReadError("upstream", "GitHub could not confirm access to the configured repository.");
    }
  });
  return client;
}

export async function withGithubErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SourceReadError) throw error;
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) {
      throw new SourceReadError("timeout", "GitHub request was cancelled or exceeded its deadline.");
    }
    const { RequestError } = await import("octokit");
    if (error instanceof RequestError) {
      // Octokit wraps fetch TimeoutError as a 500 RequestError with its cause.
      if (error.cause instanceof Error && ["AbortError", "TimeoutError"].includes(error.cause.name)) {
        throw new SourceReadError("timeout", "GitHub request was cancelled or exceeded its deadline.");
      }
      const headers = error.response?.headers;
      const retry = headers?.["retry-after"];
      const reset = headers?.["x-ratelimit-reset"];
      if (error.status === 429 || (error.status === 403 && (
        headers?.["x-ratelimit-remaining"] === "0" || retry !== undefined || /rate limit/i.test(error.message)
      ))) {
        const seconds = retry !== undefined ? Number(retry)
          : reset !== undefined ? Math.max(0, Math.ceil(Number(reset) - Date.now() / 1000)) : undefined;
        throw new SourceReadError("rate-limited", "GitHub rate limit reached. Retry later.",
          seconds !== undefined && Number.isFinite(seconds) ? seconds : undefined);
      }
      if (error.status === 401) throw new SourceReadError("unauthorized", "GitHub rejected GITHUB_TOKEN.");
      if (error.status === 403) throw new SourceReadError("forbidden", "GitHub denied repository access. Check token permissions and organization policies.");
      if (error.status === 404) throw new SourceReadError("not-found", "Repository, revision, or file was not found or is inaccessible to this token.");
      if (error.status === 422) throw new SourceReadError("invalid-input", "GitHub could not resolve the requested repository revisions.");
    }
    throw new SourceReadError("upstream", "GitHub request failed or returned an unsupported response.");
  }
}
