// Self-contained browser ESM entry; no initialization or browser globals on import.
export type HostContext = { version: 1; applicationId: string; route: string; featureIds: string[] };
export function parseHostContext(value: unknown): HostContext {
  if (!value || typeof value !== "object") throw new Error("Invalid host context");
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || typeof v.applicationId !== "string" || !v.applicationId.trim() || typeof v.route !== "string" || !v.route.startsWith("/") || v.route.startsWith("//") || /[?#\x00-\x1f]/.test(v.route) || !Array.isArray(v.featureIds) || !v.featureIds.every((id) => typeof id === "string" && id.trim())) throw new Error("Invalid host context");
  return { version: 1, applicationId: v.applicationId, route: v.route, featureIds: [...v.featureIds] };
}
export function createDocsydeClient({ applicationId }: { applicationId: string }) {
  if (typeof document === "undefined") throw new Error("Host client requires a browser");
  parseHostContext({ version: 1, applicationId, route: "/", featureIds: [] });
  if (document.getElementById("docsyde-context")) throw new Error("Host client already initialized");
  const marker = document.createElement("script"); marker.id = "docsyde-context"; marker.type = "application/json";
  document.head.appendChild(marker);
  let current: HostContext | null = null, destroyed = false;
  const listeners = new Set<(context: HostContext) => void>();
  return {
    setContext(input: { route: string; featureIds?: string[] }) {
      if (destroyed) throw new Error("Host client destroyed");
      const next = parseHostContext({ version: 1, applicationId, route: input.route, featureIds: input.featureIds ?? [] });
      current = next; marker.textContent = JSON.stringify(next);
      for (const listener of listeners) listener(parseHostContext(next));
    },
    getContext: () => current ? parseHostContext(current) : null,
    subscribe(listener: (context: HostContext) => void) {
      if (destroyed) throw new Error("Host client destroyed");
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    destroy() { destroyed = true; current = null; listeners.clear(); marker.remove(); },
  };
}
