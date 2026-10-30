import Form from "next/form";
import { Button } from "@/components/ui/button";
import { repositoryBranches, type selectedRepository } from "../repository-overview";
export async function BranchPicker({ repository, selected }: { repository: ReturnType<typeof selectedRepository>; selected: string }) {
  const branches = await repositoryBranches(repository).catch(() => null);
  if (!branches) return <p className="text-xs text-muted-foreground">Branch selection unavailable.</p>;
  const names = [...new Set([selected, ...branches.names])];
  return <Form action="/changes" className="flex max-w-full flex-wrap items-center gap-2"><input type="hidden" name="repository" value={repository.name} /><label htmlFor="changes-branch" className="text-xs text-muted-foreground">Branch</label><select id="changes-branch" name="branch" defaultValue={selected} className="h-8 min-w-0 max-w-48 rounded-md border bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring">{names.map(name => <option key={name} value={name}>{name}</option>)}</select><Button variant="outline" size="sm" type="submit">Switch</Button>{branches.limited && <span className="text-xs text-muted-foreground">First 100 branches</span>}</Form>;
}
