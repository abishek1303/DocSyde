// Adapt historical canonical fixtures into the v3 provider reply. Production does
// not accept the old wire format; canonical graph/grounding fixtures stay readable.
export function compactImpactReply(value: unknown, findings: { id: string; before: string | null; after: string | null }[]): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const root = { ...value } as Record<string, unknown>;
  for (const wrapper of ["result", "impact"]) if (Object.hasOwn(root, wrapper)) root[wrapper] = compactImpactReply(root[wrapper], findings);
  if (Array.isArray(root.claims)) root.claims = root.claims.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const claim = { ...value } as Record<string, unknown>;
    for (const field of ["before", "after"] as const) if (Object.hasOwn(claim, field)) {
      claim[`${field}Ref`] = claim[field] === null ? null : findings.find(finding => finding[field] === claim[field])?.id ?? "source-4";
      delete claim[field];
    }
    return claim;
  });
  return root;
}
