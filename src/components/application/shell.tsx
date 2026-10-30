import { Suspense, type ReactNode } from "react";
export function AppShell({ children, repository, branch, branchContext }: { children: ReactNode; repository: string; branch?: string; branchContext?: ReactNode; active: "Overview" | "Changes" | "Documentation" }) {
  return <div className="min-h-screen bg-background text-foreground">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:p-3">Skip to content</a>
    <main id="main-content" className="mx-auto w-full max-w-6xl space-y-8 px-5 py-9 sm:px-8 sm:py-12"><div className="min-w-0 space-y-2"><p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">Repository</p><p className="break-all text-lg font-medium">{repository}</p><p className="break-words text-sm text-muted-foreground">GitHub branch · <Suspense fallback="Loading…">{branchContext ?? branch ?? "Default branch"}</Suspense></p></div>{children}</main>
  </div>;
}
