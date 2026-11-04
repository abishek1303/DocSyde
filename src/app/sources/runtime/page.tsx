import { PageLoader } from "@/components/application/page-loader";
import { Suspense } from "react";
import Link from "next/link";
import { AppShell } from "@/components/application/shell";
import { Breadcrumbs } from "@/components/application/breadcrumbs";
import { selectedRepository, configuredRepositories } from "@/features/sources/run-preparation";
import { RepositoryPicker } from "@/features/sources/components/repository-picker";
import { getRuntimeSettings } from "@/features/documentation/runs/runtime-settings";
import { RuntimeSettingsForm } from "@/features/documentation/components/runs/runtime-settings-form";
async function Settings({ searchParams }: { searchParams: Promise<{ repository?: string }> }) {
  const repository = selectedRepository(await searchParams);
  const saved = await getRuntimeSettings(repository.name).catch(() => null);
  return <AppShell repository={repository.name} active="Overview"><div className="max-w-2xl space-y-6">
    <Breadcrumbs items={[{ label: "Project", href: `/?${new URLSearchParams({ repository: repository.name })}` }, { label: "Runtime settings" }]} />
    <h1 className="text-3xl font-semibold">Application runtime</h1>
    <p className="text-sm leading-7 text-muted-foreground">Optionally let DocSyde start your application for its existing browser inspection. Healthy approved URLs are reused; only processes started by DocSyde are stopped. Full Scan can continue using source evidence when startup is unavailable.</p>
    <RepositoryPicker destination="/sources/runtime" selected={repository.name} repositories={configuredRepositories()} />
    <RuntimeSettingsForm key={`${repository.name}:${saved?.approvedAt ?? "new"}:${saved?.enabled}`} repository={repository.name} saved={saved} workflowPath={process.env.DOCSYDE_RUN_RUNTIME_CONFIG ?? ""} />
    <Link className="text-sm text-primary underline" href={`/runs/new?${new URLSearchParams({ repository: repository.name })}`}>Return to run setup</Link>
  </div></AppShell>;
}
export default function Page(props: { searchParams: Promise<{ repository?: string }> }) { return <Suspense fallback={<PageLoader />}><Settings {...props} /></Suspense>; }
