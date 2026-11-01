"use client";

import { useRef, type ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

/** Content stays visible without JavaScript; only marked groups are staggered. */
export function MotionReveal({ children, className, stagger = false }: { children: ReactNode; className?: string; stagger?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const targets = stagger ? root.current?.querySelectorAll("[data-motion-item]") : root.current;
      if (!targets) return;
      gsap.from(targets, { opacity: 0, y: 6, duration: 0.28, stagger: stagger ? 0.055 : 0, ease: "power2.out", clearProps: "opacity,transform" });
    });
    return () => media.revert();
  }, { scope: root });
  return <div ref={root} className={className}>{children}</div>;
}
