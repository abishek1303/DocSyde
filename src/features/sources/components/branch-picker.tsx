import Form from "next/form";
import { Button } from "@/components/ui/button";
import { repositoryBranches, type selectedRepository } from "../repository/repository-overview";

export async function BranchPicker({ repository, selected, action = "/changes" }: {
  repository: ReturnType<typeof selectedRepository>; selected?: string; action?: "/changes" | "/runs" | "/runs/new";
}) {
  const branches = await repositoryBranches(repository).catch(() => null);
  const names = [...new Set([...(selected ? [selected] : []), ...(branches?.names ?? [])])];
  const id = action === "/changes" ? "changes-branch" : action === "/runs" ? "runs-branch" : "new-run-branch";
  return <Form action={action} className="flex max-w-full flex-wrap items-center gap-2">
    <input type="hidden" name="repository" value={repository.name} />
    <label htmlFor={id} className="text-sm text-muted-foreground">Branch</label>
    {branches && names.length ? <select id={id} name="branch" defaultValue={selected ?? ""} required className="h-9 min-w-0 max-w-64 rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring">{!selected && <option value="" disabled>Choose a branch</option>}{names.map(name => <option key={name} value={name}>{name}</option>)}</select> : <input id={id} name="branch" defaultValue={selected ?? ""} required maxLength={1024} placeholder="Branch name" className="h-9 min-w-0 max-w-64 rounded-md border bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring" />}
    <Button variant="outline" size="sm" type="submit">{action === "/runs/new" ? "Preview branch" : "Switch"}</Button>
    {!branches && <span role="status" className="text-xs text-muted-foreground">Could not load branches. Enter a branch name.</span>}
    {branches?.limited && <span className="text-xs text-muted-foreground">First 100 branches</span>}
  </Form>;
}
