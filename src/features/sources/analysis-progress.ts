export type SourceStep = "read-evidence" | "understand-impact";
export type SourceProgress = (event: { step: SourceStep; status: "running" | "completed" | "failed"; summary: string }) => Promise<void>;
