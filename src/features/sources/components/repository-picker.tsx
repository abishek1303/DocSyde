"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { GitBranch } from "lucide-react";

export function RepositoryPicker({ repositories, selected, destination = "/runs/new" }: { repositories: string[]; selected: string; destination?: "/runs/new" | "/mcp" | "/sources/runtime" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <div className="max-w-2xl space-y-2">
    <label htmlFor="run-project" className="text-sm font-medium">Project</label>
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
      <GitBranch aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" />
      <select id="run-project" value={selected} disabled={pending} onChange={event => {
        const repository = event.target.value;
        startTransition(() => router.push(`${destination}?${new URLSearchParams({ repository })}`));
      }} className="min-w-0 flex-1 rounded bg-card py-1 text-sm focus-visible:outline-2 focus-visible:outline-ring">
        {repositories.map(repository => <option key={repository} value={repository.toLowerCase()}>{repository}</option>)}
      </select>
    </div>
    <p role="status" aria-live="polite" className="min-h-4 text-xs text-muted-foreground">{pending ? "Loading project…" : ""}</p>
  </div>;
}
