// #149: import-safe dependency reads. Failed or unreadable evidence holds work until a later pass.
export type DependencyResult = { state: "satisfied" | "unsatisfied" | "unknown"; reason?: string };
export interface DependencyView {
  ticket(iid: number): { state?: string } | undefined;
  run(iid: number): { branch?: string; base?: string } | undefined;
  mergedInto(branch: string, base: string): boolean;
  base: string;
}
export function dependencyState(iid: number, view: DependencyView): DependencyResult {
  const unknown = (operation: string): DependencyResult => ({ state: "unknown", reason: `Dependency information unavailable for #${iid}: ${operation}` });
  let ticket: ReturnType<DependencyView["ticket"]>;
  try { ticket = view.ticket(iid); } catch { return unknown("ticket lookup failed"); }
  if (ticket?.state === "closed") return { state: "satisfied" };
  if (ticket?.state !== "open" && ticket?.state !== "opened") return unknown("unrecognized ticket state");
  try {
    const run = view.run(iid);
    if (run?.branch) {
      const merged = view.mergedInto(run.branch, run.base ?? view.base);
      if (merged === true) return { state: "satisfied" };
      if (merged !== false) return unknown("unreadable merge result");
    }
  } catch { return unknown("recorded run or merge lookup failed"); }
  return { state: "unsatisfied" };
}
