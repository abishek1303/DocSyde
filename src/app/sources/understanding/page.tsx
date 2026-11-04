import { PageLoader } from "@/components/application/page-loader";
import { Breadcrumbs } from "@/components/application/breadcrumbs";
import { Suspense } from "react";
import { AppShell } from "@/components/application/shell";
import { selectedRepository, defaultBranch, repositoryBranches } from "@/features/sources/repository/repository-overview";
import { getRepositoryContext } from "@/features/sources/context/repository-context";
import { getUnderstanding } from "@/features/sources/context/understanding-operations";
import { RepositoryUnderstandingWorkspace } from "@/features/sources/components/repository-understanding-workspace";

async function Understanding({ searchParams }: { searchParams: Promise<{ repository?: string; branch?: string }> }) {
 const selected = selectedRepository(await searchParams);
 const [saved, productContext, revision, branches] = await Promise.all([
  getUnderstanding(selected.name), getRepositoryContext(selected),
  selected.branch ?? defaultBranch(selected), repositoryBranches(selected).catch(() => null),
 ]);
 return <AppShell repository={selected.name} active="Overview"><Breadcrumbs items={[{ label: "Product" }, { label: "Product understanding" }]} />
  <RepositoryUnderstandingWorkspace key={selected.name} repository={selected.name} revision={revision} branches={branches?.names ?? []} saved={saved} savedProductContext={productContext ?? ""} />
 </AppShell>;
}
export default function Page(props: { searchParams: Promise<{ repository?: string; branch?: string }> }) { return <Suspense fallback={<PageLoader />}><Understanding {...props} /></Suspense>; }
