import "server-only";

import { SourceReadError } from "@/integrations/github/errors";

export async function createGithubClient() {
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
    // Installed Octokit forwards signals but does not implement request.timeout.
    options.request.signal = AbortSignal.timeout(30_000);
    options.request.redirect = "error";
    options.headers["X-GitHub-Api-Version"] = "2026-03-10";
  });
  return client;
}

export async function withGithubErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof SourceReadError) throw error;
    if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name)) {
      throw new SourceReadError("timeout", "GitHub request timed out after 30 seconds.");
    }
    const { RequestError } = await import("octokit");
    if (error instanceof RequestError) {
      // Octokit wraps fetch TimeoutError as a 500 RequestError with its cause.
      if (error.cause instanceof Error && ["AbortError", "TimeoutError"].includes(error.cause.name)) {
        throw new SourceReadError("timeout", "GitHub request timed out after 30 seconds.");
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
