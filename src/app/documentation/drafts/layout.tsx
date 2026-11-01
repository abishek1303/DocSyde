import { Suspense, type ReactNode } from "react";
import { ReaderWorkspace } from "@/features/documentation/components/reader/reader-workspace";
import { ArticleSkeleton } from "@/features/documentation/components/reader/article-skeleton";

export default function DraftReaderLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<ArticleSkeleton />}><ReaderWorkspace>{children}</ReaderWorkspace></Suspense>;
}
