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
    if (!changed) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const icon = root.current?.querySelector("[data-stage-icon]");
      if (!icon) return;
      const timeline = gsap.timeline({ defaults: { ease: "power2.out" } });
      const flow = root.current?.querySelector("[data-stage-flow]");
      if (flow) timeline.fromTo(flow, { scaleY: 0 }, { scaleY: 1, transformOrigin: "top", duration: 0.35 }, 0);
      if (status === "completed") {
        timeline.from(icon, { scale: 0.75, opacity: 0.5, duration: 0.24, clearProps: "transform,opacity" });
      } else if (status === "running") {
        timeline.from(root.current, { x: -4, duration: 0.24, clearProps: "transform" });
      }
    });
    return () => media.revert();
  }, { scope: root, dependencies: [status], revertOnUpdate: true });
  return <li ref={root} aria-current={status === "running" ? "step" : undefined} className="relative py-1"><span aria-hidden="true" data-stage-flow className={`absolute inset-y-0 left-0 w-px ${status === "running" || status === "completed" ? "bg-primary/40" : "bg-border/50"}`} />{children}</li>;
}
