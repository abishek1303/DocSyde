import { CircleAlert } from "lucide-react";

export function RepositorySetupAlert({ title = "Only one repository is supported for this demo.", message = "Please update your configuration to include only the repository you want DocSyde to analyze." }: { title?: string; message?: string }) {
  return <div role="alert" className="flex w-full max-w-4xl items-start gap-4 rounded-2xl border border-destructive/40 bg-destructive/10 p-5 sm:gap-5 sm:p-7">
    <CircleAlert aria-hidden="true" className="mt-0.5 size-9 shrink-0 fill-destructive text-background sm:size-11" />
    <div className="min-w-0 space-y-2"><h1 className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h1><p className="break-words text-sm leading-7 text-muted-foreground">{message}</p></div>
  </div>;
}
