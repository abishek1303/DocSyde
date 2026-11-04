"use client";

import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(useGSAP);

export function PageLoader({ label = "Gathering your pages…" }: { label?: string }) {
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.to("[data-loader-book]", { y: -5, rotation: 3, transformOrigin: "50% 70%", duration: 1.2, repeat: -1, yoyo: true, ease: "sine.inOut" });
      gsap.to("[data-loader-page]", { y: -7, rotation: -5, transformOrigin: "50% 70%", duration: 1.1, repeat: -1, yoyo: true, ease: "sine.inOut" });
      gsap.to("[data-loader-spark]", { scale: 0.5, opacity: 0.35, transformOrigin: "50% 50%", duration: 0.8, stagger: 0.25, repeat: -1, yoyo: true, ease: "sine.inOut" });
      gsap.to("[data-loader-eyes]", { scaleY: 0.12, transformOrigin: "50% 50%", duration: 0.12, repeat: -1, repeatDelay: 2.2, yoyo: true });
    });
    return () => media.revert();
  }, { scope: root });
  return <div ref={root} role="status" aria-live="polite" className="flex min-h-56 w-full flex-col items-center justify-center gap-3 px-6 py-10">
    <svg aria-hidden="true" viewBox="0 0 180 128" fill="none" className="h-32 w-44 overflow-visible">
      <ellipse cx="90" cy="112" rx="49" ry="5" fill="var(--primary)" opacity="0.08" />
      <g data-loader-page><rect x="44" y="24" width="56" height="70" rx="9" transform="rotate(-12 44 24)" fill="var(--card)" stroke="#a78bfa" strokeWidth="2" /><path d="m62 46-7 7 7 7m17-18 7 7-7 7m-9-14-3 19" stroke="#a78bfa" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></g>
      <g data-loader-book><path d="M59 53c14-5 25-3 35 3 10-6 21-8 35-3v51c-14-5-25-3-35 3-10-6-21-8-35-3V53Z" fill="var(--card)" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" /><path d="M94 57v47M69 65l15 1m20 0 15-1" stroke="var(--primary)" strokeWidth="2" opacity="0.45" strokeLinecap="round" /><g data-loader-eyes fill="var(--primary)"><ellipse cx="80" cy="81" rx="2.5" ry="3.5" /><ellipse cx="108" cy="81" rx="2.5" ry="3.5" /></g><path d="M88 91q6 5 12 0" stroke="var(--primary)" strokeWidth="2" strokeLinecap="round" /></g>
      <path data-loader-spark d="m133 21 2 7 7 2-7 2-2 7-2-7-7-2 7-2 2-7Z" fill="var(--primary)" /><path data-loader-spark d="m34 75 1.5 5 5 1.5-5 1.5-1.5 5-1.5-5-5-1.5 5-1.5 1.5-5Z" fill="#a78bfa" /><circle data-loader-spark cx="147" cy="76" r="3" fill="var(--primary)" opacity="0.65" />
    </svg>
    <span className="text-sm font-medium text-muted-foreground">{label}</span>
  </div>;
}
