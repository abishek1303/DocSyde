"use client";

import { Check } from "lucide-react";

export function SetupStepper({ step }: { step: number }) {
  return <ol aria-label="Setup progress" className="mb-8 grid grid-cols-3 gap-3 border-b pb-6">{["Select branch", "Add context", "Review & start"].map((label, index) => <li key={label} aria-current={step === index ? "step" : undefined} className="flex items-center gap-2 text-xs sm:text-sm"><span className={`flex size-8 shrink-0 items-center justify-center rounded-full border font-medium transition-colors ${index <= step ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground"}`}>{index < step ? <Check className="size-4" aria-hidden="true" /> : index + 1}</span><span className={index === step ? "font-semibold" : "text-muted-foreground"}>{label}</span></li>)}</ol>;
}
