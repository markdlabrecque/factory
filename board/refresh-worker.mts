// Board-triggered refresh (#78): find the project's copy without loading tracker adapters into the server, then run
// its --refresh-only command in a bounded process group. No scheduler, timer service, admission or ticket execution.
// One worker per card in this server. Missing projects, old copies and timeouts become recorded assessment failures.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { readRuns, stateDir } from "./board.mts";
import { assessed, clearRequest, pendingRequests, readAssessment, writeAssessment } from "./assessment.mts";

const workers = new Map<string, Promise<void>>();
export function executeRefresh(key: string, timeout = 120_000): Promise<void> {
  if (workers.has(key)) return workers.get(key)!;
  const started = new Set(pendingRequests(stateDir()).get(key));
  const job = perform(key, timeout).catch((e) => {
    console.error(`assessment refresh ${key}: ${(e as Error).message}`);
  }).finally(() => {
    workers.delete(key);
    // A click during this check is a new generation. Run it after this worker, not concurrently. Never loop on
    // an old generation whose removal failed, which would turn a broken store into an unbounded retry service.
    if (pendingRequests(stateDir()).get(key)?.some((g) => !started.has(g))) void executeRefresh(key, timeout);
  });
  workers.set(key, job);
  return job;
}
async function perform(key: string, timeout: number): Promise<void> {
  const dir = stateDir(), run = readRuns(stateDir(), false).find((r) => r.key === key);
  if (!run) return;
  const generations = pendingRequests(dir).get(key);
  try {
    const prev = readAssessment(dir, key);
    const roots = new Set<string>([process.cwd(), ...(prev?.projectRoot ? [prev.projectRoot] : [])]);
    try {
      const registry = JSON.parse(readFileSync(resolve(process.env.FACTORY_HOME || homedir(), ".config/factory/projects.json"), "utf8"));
      for (const p of registry.projects ?? []) if (typeof p.root === "string") roots.add(p.root);
    } catch { /* Standalone board/copy need not have a Factory registry. */ }
    const matches = [...roots].filter((root) => {
      try {
        const config = readFileSync(resolve(root, ".sandcastle/config.mts"), "utf8");
        return config.match(/^\s*project:\s*"([^"]+)"/m)?.[1] === run.project && existsSync(resolve(root, ".sandcastle/dispatch.mts"));
      } catch { return false; }
    });
    if (matches.length !== 1) throw new Error(matches.length ? "Several project roots match this card; cannot safely refresh" : "Project root not found. Register its checkout with factory project add, or run a dispatch pass from it.");
    const root = matches[0];
    await new Promise<void>((accept, reject) => {
      const child = spawn(process.execPath, [resolve(root, ".sandcastle/dispatch.mts"), "--refresh-only", "--ticket", run.iid, "--base", run.base ?? "main"], {
        cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SANDCASTLE_STATE_DIR: dir },
      });
      let output = "", expired = false;
      child.stdout.on("data", (s) => { output = (output + s).slice(-2000); });
      child.stderr.on("data", (s) => { output = (output + s).slice(-2000); });
      const timer = setTimeout(() => {
        expired = true;
        if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* exited */ } }
      }, timeout);
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (expired) reject(new Error(`Read-only refresh timed out after ${timeout}ms`));
        else if (code !== 0) reject(new Error(`Read-only refresh exited ${code}: ${output.slice(-300)}`));
        else accept();
      });
    });
    if (pendingRequests(dir).get(key)?.some((g) => generations?.includes(g))) {
      throw new Error("Read-only refresh exited without recording a result for this request. Check the project's workflow copy and assessment store.");
    }
  } catch (e) {
    try {
      const prev = readAssessment(dir, key), error = (e as Error).message.slice(0, 400);
      const next = assessed(prev, { iid: run.iid, project: run.project, at: new Date().toISOString(), error });
      if (next.analysisState === "pending") { next.analysisState = "error"; next.analysisError = error; }
      writeAssessment(dir, key, next);
      clearRequest(dir, key, generations);
    } catch (error) { console.error(`assessment store: ${(error as Error).message}`); }
  }
}
