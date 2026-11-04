"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export function RunStageMotion({ status, children }: { status: string; children: ReactNode }) {
  const root = useRef<HTMLLIElement>(null);
  const previous = useRef(status);
  useGSAP(() => {
    const changed = previous.current !== status;
    previous.current = status;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const icon = root.current?.querySelector("[data-stage-icon]");
      if (changed && icon) {
        const flow = root.current?.querySelector("[data-stage-flow]");
        if (flow) gsap.fromTo(flow, { scaleY: 0 }, { scaleY: 1, transformOrigin: "top", duration: 0.35, ease: "power2.out" });
        if (status === "completed") gsap.from(icon, { scale: 0.75, opacity: 0.5, duration: 0.24, clearProps: "transform,opacity" });
      }
      if (status !== "running") return;
      // Animate whole words so the title continues to wrap naturally at every width.
      gsap.to("[data-stage-word]", { y: -2, opacity: 0.65, duration: 0.65, stagger: 0.09, repeat: -1, yoyo: true, repeatDelay: 0.6, ease: "sine.inOut" });
      gsap.to("[data-stage-title]", { color: "var(--foreground)", duration: 1.5, repeat: -1, yoyo: true, ease: "sine.inOut" });
    });
    if (status === "running") {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      // Only move the activity viewport; the page header and resources stay in place.
      const reveal = gsap.delayedCall(reduced ? 0 : 0.35, () => {
        const node = root.current;
        const viewport = node?.closest<HTMLOListElement>("[data-run-timeline]");
        if (!node || !viewport) return;
        const top = node.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
        if (top < 0 || top + node.offsetHeight > viewport.clientHeight) viewport.scrollTo({ top: Math.max(0, viewport.scrollTop + top - 8), behavior: reduced ? "instant" : "smooth" });
      });
      return () => { reveal.kill(); media.revert(); };
    }
    return () => media.revert();
  }, { scope: root, dependencies: [status], revertOnUpdate: true });
  return <li ref={root} aria-current={status === "running" ? "step" : undefined} className="relative py-1 pl-9"><span aria-hidden="true" data-stage-flow className={`absolute inset-y-0 left-3.5 w-px ${status === "running" || status === "completed" ? "bg-primary/40" : "bg-border/50"}`} />{children}</li>;
}
