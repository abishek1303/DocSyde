// Collection and model projection share these deterministic rules. They do not
// detect prompt injection or guarantee removal of arbitrary application secrets.
export const runtimeCredentialPatterns = [
  /\b(?:Bearer\s+\S+|(?:sk|gh[pousr]|github_pat)[_-][A-Za-z0-9_-]+)\b/gi,
  /\b(?:password|secret|token|api[_-]?key|(?:access|refresh|auth|session)[_-]?token|client[_-]?secret|session(?:id)?|authorization|cookie)\b["']?\s*[:=]\s*["']?[^\s"'<>,;]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?\b/g,
];
export function redactRuntimeText(value: string, secrets: readonly string[] = [], limit = 500): string {
  let text = value;
  for (const pattern of runtimeCredentialPatterns) text = text.replace(pattern, "[redacted]");
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) text = text.split(secret).join("[redacted]");
  return text
    .replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function runtimePath(value: string, secrets: readonly string[] = []): string {
  const path = new URL(value, "http://localhost").pathname;
  return path.split("/").map(segment => {
    let decoded: string;
    try { decoded = decodeURIComponent(segment); } catch { return "[redacted]"; }
    const safe = redactRuntimeText(decoded, secrets, 1024);
    return safe !== decoded || /[?#\s]/.test(decoded) || /[A-Za-z0-9_-]{32,}/.test(decoded) ? "[redacted]" : segment;
  }).join("/").slice(0, 1024) || "/";
}
