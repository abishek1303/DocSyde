"use client";

import { useRef, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/** Preserve page state and scroll containers while animating navigation and streamed screens. */
export function PageMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const search = useSearchParams();
  const navigation = `${pathname}?${search.toString()}`;
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", context => {
      const enter = () => context.add(() => {
        gsap.fromTo(root.current, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out", overwrite: "auto", clearProps: "opacity" });

      });
      enter();
      let main = root.current?.querySelector("main");
      // Suspense may deliver the actual page after navigation has committed.
      const observer = new MutationObserver(() => {
        const next = root.current?.querySelector("main");
        if (next && next !== main) { main = next; enter(); }
      });
      if (root.current) observer.observe(root.current, { childList: true, subtree: true });
      return () => observer.disconnect();
    });
    return () => media.revert();
  }, { scope: root, dependencies: [navigation], revertOnUpdate: true });
  return <div ref={root} className="h-full min-h-0 min-w-0">{children}</div>;
}
