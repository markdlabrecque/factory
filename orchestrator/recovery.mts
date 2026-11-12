import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

// The bounded part of a recovery attempt (slice four, #60), shared by main.mts's `--recover <attempt>` mode (in the
// project's copy) and Factory's launcher (cli/src/recovery-run.mts, on the host). No Sandcastle, tracker or config import.
// - repairWithin: the repair agent gets REPAIR_MINUTES once its container is ready and set up (setup, the verifier and
//   delivery keep their own limits). On the deadline, or on cancellation (SIGTERM), the agent's run is aborted, which
//   makes Sandcastle kill the in-flight agent process; commits and the worktree stay where they are.
// - containersGone: an attempt may end only once its own container is confirmed gone. Its container is a Sandcastle
//   container (named sandcastle-*) that bind-mounts the ticket's worktree (<root>/.sandcastle/worktrees/<branch>); the
//   claim owns that ticket, so no other run's container mounts it, and this finds it even when the attempt died during
//   setup, before Sandcastle returned the container's name. Each is removed with `docker rm -f` and the list is read
//   again; no other container is touched. Unconfirmed means the attempt stays recorded as running (fail closed).
// - The attempt's result file, `<evidence>/recovery-attempt-<n>.json`: main.mts writes it as the attempt ends; the
//   launcher reads it when it settles the attempt. No file from a dead process means the attempt was interrupted.

export const REPAIR_MINUTES = 15;
export const REPAIR_PROMPT = "./.sandcastle/prompt.recover.md";

export type RepairResult = "repaired" | "failed" | "timed-out" | "blocked" | "interrupted";
export type ResultFile = { attempt: number; result: RepairResult; reason?: string; at: string; report?: string };
const RESULTS: RepairResult[] = ["repaired", "failed", "timed-out", "blocked", "interrupted"];

export const resultPath = (evidenceHost: string, attempt: number) => resolve(evidenceHost, `recovery-attempt-${attempt}.json`);
export const reportPath = (evidenceHost: string) => resolve(evidenceHost, "recovery-report.md");

/** Record how attempt `attempt` ended, next to its evidence. Names the repair report when the agent wrote one. */
export function writeResult(evidenceHost: string, attempt: number, result: RepairResult, reason?: string, at = new Date().toISOString()): ResultFile {
  const report = existsSync(reportPath(evidenceHost)) ? reportPath(evidenceHost) : undefined;
  const r: ResultFile = { attempt, result, ...(reason ? { reason } : {}), at, ...(report ? { report } : {}) };
  const file = resultPath(evidenceHost, attempt);
  writeFileSync(`${file}.tmp`, JSON.stringify(r, null, 2) + "\n");
  renameSync(`${file}.tmp`, file);
  return r;
}

/** The attempt's result file, or undefined when it is missing or unreadable (the attempt did not finish). */
export function readResult(evidenceHost: string, attempt: number): ResultFile | undefined {
  try {
    const r = JSON.parse(readFileSync(resultPath(evidenceHost, attempt), "utf8"));
    return r?.attempt === attempt && RESULTS.includes(r.result) ? r : undefined;
  } catch {
    return undefined;
  }
}

export type Bounded<T> = { ok: true; value: T } | { ok: false; why: "timed-out" | "cancelled"; error: unknown };

/** Run `work` with a signal that aborts after `ms` or when `cancel` aborts, whichever comes first. A rejection caused by
 *  either is reported as `timed-out` or `cancelled`; any other rejection is rethrown. */
export async function repairWithin<T>(ms: number, cancel: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<Bounded<T>> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error(`repair agent exceeded ${Math.round(ms / 60_000)} minutes`)), ms);
  try {
    return { ok: true, value: await work(AbortSignal.any([deadline.signal, cancel])) };
  } catch (error) {
    if (cancel.aborted) return { ok: false, why: "cancelled", error };
    if (deadline.signal.aborted) return { ok: false, why: "timed-out", error };
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** `docker` with an argument list, returning its exit status (null when it could not run) and output. */
/** `docker` with an argument list: exit status (null when it could not run) and output. */
export type Docker = (args: string[]) => { status: number | null; stdout: string; stderr: string };
/** Runs the real docker CLI. */
export const realDocker: Docker = (args) => {
  const r = spawnSync("docker", args, { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr || r.error?.message || "" };
};

/** Sandcastle's worktree for `branch`: <root>/.sandcastle/worktrees/<branch with / as ->. */
export const worktreeFor = (root: string, branch: string) => resolve(root, ".sandcastle/worktrees", branch.replaceAll("/", "-"));
const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };

/** The Sandcastle containers (named sandcastle-*) that bind-mount `worktree`, or why docker could not say. */
export function worktreeContainers(worktree: string, docker: Docker): { ok: true; names: string[] } | { ok: false; reason: string } {
  const why = (what: string, r: { status: number | null; stderr: string }) =>
    `docker could not ${what} (exit ${r.status}${r.stderr.trim() ? `: ${r.stderr.trim().split("\n")[0]}` : ""})`;
  const list = docker(["ps", "-a", "--filter", "name=sandcastle-", "--format", "{{.Names}}"]);
  if (list.status !== 0) return { ok: false, reason: why("list containers", list) };
  const want = new Set([resolve(worktree), real(worktree)]);
  const names: string[] = [];
  for (const name of list.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const r = docker(["container", "inspect", "--format", "{{range .Mounts}}{{.Source}}\n{{end}}", name]);
    if (r.status === 1 && /no such (container|object)/i.test(r.stderr)) continue; // removed meanwhile
    if (r.status !== 0) return { ok: false, reason: why(`inspect container ${name}`, r) };
    if (r.stdout.split("\n").some((m) => m.trim() && want.has(m.trim()))) names.push(name);
  }
  return { ok: true, names };
}

/** Confirm no container of this attempt (one mounting the ticket's worktree, which the claim owns) is left, removing
 *  any with `docker rm -f`. Other containers are never touched. */
export function containersGone(worktree: string, docker: Docker): { ok: true; removed: string[] } | { ok: false; reason: string } {
  const first = worktreeContainers(worktree, docker);
  if (!first.ok) return first;
  for (const name of first.names) docker(["rm", "-f", name]);
  if (!first.names.length) return { ok: true, removed: [] };
  const after = worktreeContainers(worktree, docker);
  if (!after.ok) return after;
  if (after.names.length) return { ok: false, reason: `container(s) ${after.names.join(", ")} still present after docker rm -f` };
  return { ok: true, removed: first.names };
}
