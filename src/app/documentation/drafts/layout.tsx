import { Suspense, type ReactNode } from "react";
import { ReaderWorkspace } from "@/features/documentation/components/reader-workspace";
import { ArticleSkeleton } from "@/features/documentation/components/article-skeleton";

export default function DraftReaderLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<ArticleSkeleton />}><ReaderWorkspace>{children}</ReaderWorkspace></Suspense>;
}
