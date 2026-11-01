/** Correlation only. Never contains persistence state or evidence. */
export type InvocationContext = { runId?: string; stage: string; operation: string };
