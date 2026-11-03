import { Suspense, type ReactNode } from "react";
export function AppShell({ children, repository, branch, branchContext, showBranch = true, headerContent, contentLayout = "page" }: { children: ReactNode; contentLayout?: "page" | "workspace"; headerContent?: ReactNode; repository: string; branch?: string; branchContext?: ReactNode; showBranch?: boolean; active: "Overview" | "Changes" | "Documentation" | "Runs" | "AI" | "MCP" | "Logs" }) {
  return <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-card focus:p-3">Skip to content</a>
    <header className="relative z-20 flex min-h-16 shrink-0 flex-wrap items-center gap-3 py-3 sm:h-16 sm:flex-nowrap sm:py-0 border-b bg-card px-3 text-sm sm:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <span className="shrink-0 font-semibold">DocSyde</span>
        <span aria-hidden="true" className="hidden text-border sm:inline">/</span>
        <span className="truncate" title={repository}>{repository}</span>
        {showBranch && <span className="hidden max-w-32 truncate text-muted-foreground md:inline">
          <Suspense fallback="Loading branch…">{branchContext ?? branch ?? "Default branch"}</Suspense>
        </span>}
      </div>
      {headerContent && <div className="w-full shrink-0 sm:w-auto">{headerContent}</div>}
    </header>
    <main id="main-content" data-scroll-viewport tabIndex={0} aria-label="Page content" className={`min-h-0 min-w-0 flex-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${contentLayout === "workspace" ? "overflow-hidden" : "overflow-y-auto motion-safe:scroll-smooth"}`}>
      {contentLayout === "workspace" ? children : <div className="mx-auto w-full max-w-6xl space-y-8 px-5 py-9 sm:px-8 sm:py-12">{children}</div>}
    </main>
  </div>;
}
