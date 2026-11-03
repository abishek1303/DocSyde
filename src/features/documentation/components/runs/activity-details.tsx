"use client";
import { useRef, useState, type ReactNode } from "react";
import gsap from "gsap";
/** Native details stays keyboard accessible; GSAP only reinforces disclosure. */
export function ActivityDetails({ label = "Technical details", children }: { label?: string; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  return <details className="border-t border-border/60 pt-3" onToggle={event => {
    setOpened(event.currentTarget.open);
    if (event.currentTarget.open && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.fromTo(content.current, { opacity: 0, y: -3 }, { opacity: 1, y: 0, duration: 0.18, clearProps: "opacity,transform" });
    }
  }}><summary className="cursor-pointer rounded text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">{label}</summary><div ref={content} className="mt-3 min-w-0">{opened && children}</div></details>;
}
