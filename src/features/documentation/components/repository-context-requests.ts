// Per-mounted repository form: late loads/saves/clears cannot replace newer state.
export function createRepositoryContextRequests() {
  let sequence = 0;
  return { begin: () => ++sequence, isCurrent: (ticket: number) => ticket === sequence, cancel: () => { sequence++; } };
}
