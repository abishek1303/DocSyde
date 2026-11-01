import { Breadcrumbs } from "@/components/application/breadcrumbs";

export function RunBreadcrumbs({ repository, branch, runId, current, comparison = false }: {
  repository?: string; branch?: string; runId?: string; current: string; comparison?: boolean;
}) {
  const query = new URLSearchParams({ ...(repository ? { repository } : {}), ...(branch ? { branch } : {}) });
  const items: { label: string; href?: string }[] = [{ label: "Your runs", href: `/runs?${query}` }];
  if (comparison && runId) items.push({ label: "Comparison", href: `/runs/new?${query}&rerun=${runId}` });
  if (runId && current !== "Run") items.push({ label: `Run ${runId.slice(0, 8)}`, href: `/runs/${runId}?${query}` });
  items.push({ label: current });
  return <Breadcrumbs items={items} />;
}
