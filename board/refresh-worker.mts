// V2 TOML metadata identifies refresh targets; unrelated invalid registry entries cannot block discovery.
// Board-triggered refresh resolves one complete workflow from a trusted descriptor without importing project code,
// then runs --refresh-only in a bounded process group. No scheduler, timer service, admission or ticket execution.
// One worker per card in this server; assessment attempt tokens fence overlaps with other servers/scheduled passes.
// Kill this worker's group on exit, close, spawn error and timeout, even when descendants redirect their stdio.
// Missing/ambiguous projects, invalid runtimes and timeouts become fenced assessment failures without changing run records.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { realpathSync } from 'node:fs';
import { readRuns, stateDir } from "./board.mts";
import { assessed, beginAssessment, clearRequest, pendingRequests, publishAssessment, readAssessment, writeAssessment } from "./assessment.mts";

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
  let token: string | undefined;
  try {
    token = beginAssessment(dir, key);
    const prev = readAssessment(dir, key);
    const roots = new Set<string>([process.cwd(), ...(prev?.projectRoot ? [prev.projectRoot] : [])]);
    try {
      const registry = JSON.parse(readFileSync(resolve(process.env.FACTORY_HOME || homedir(), ".config/factory/projects.json"), "utf8"));
      for (const p of registry.projects ?? []) if (typeof p.root === "string") roots.add(p.root);
    } catch { /* Standalone board/copy need not have a Factory registry. */ }
    const helper = existsSync(new URL('./project-config.mts', import.meta.url)) ? './project-config.mts' : '../orchestrator/project-config.mts';
    const { tomlIdentity } = await import(helper);
    const configErrors: Error[] = [];
    const matches = [...roots].filter((root) => {
      // Discovery reads identity only. Complete workflow validation follows selection.
      try {
        const identity = tomlIdentity(resolve(root, '.sandcastle'));
        return identity.project === run.project;
      } catch (error) {
        configErrors.push(error as Error);
        return false;
      }
    });
    if (!matches.length && configErrors.length) throw configErrors[0];
    if (matches.length !== 1) throw new Error(matches.length ? "Several project roots match this card; cannot safely refresh" : "Project root not found. Register its checkout with factory project add, or run a dispatch pass from it.");
    const root = realpathSync(matches[0]);
    if (!process.env.FACTORY_RUNTIME_DESCRIPTOR) throw Error('Missing trusted Factory runtime descriptor; read-only refresh cannot select a workflow');
    const workflowHelper = existsSync(new URL('./workflow.mts', import.meta.url)) ? './workflow.mts' : '../orchestrator/workflow.mts';
    const { resolveWorkflow } = await import(workflowHelper);
    const workflow = resolveWorkflow(root, process.env.FACTORY_RUNTIME_DESCRIPTOR);
    await new Promise<void>((accept, reject) => {
      const child = spawn(process.execPath, [workflow.entrypoints.refresh, "--refresh-only", "--ticket", run.iid, "--base", run.base ?? "main"], {
        cwd: root, detached: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...workflow.env, SANDCASTLE_STATE_DIR: dir,
          FACTORY_REFRESH_KEY: key, FACTORY_REFRESH_ATTEMPT: token },
      });
      let output = "", expired = false;
      child.stdout.on("data", (s) => { output = (output + s).slice(-2000); });
      child.stderr.on("data", (s) => { output = (output + s).slice(-2000); });
      const cleanup = () => {
        if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* group already gone */ } }
      };
      const timer = setTimeout(() => { expired = true; cleanup(); }, timeout);
      // Do not wait for close: a descendant may still hold an inherited pipe after the leader exits.
      child.on("exit", cleanup);
      child.on("error", (e) => { clearTimeout(timer); cleanup(); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        cleanup();
        if (expired) reject(new Error(`Read-only refresh timed out after ${timeout}ms`));
        else if (code !== 0) reject(new Error(`Read-only refresh exited ${code}: ${output.slice(-300)}`));
        else accept();
      });
    });
    if (pendingRequests(dir).get(key)?.some((g) => generations?.includes(g))) {
      throw new Error("Read-only refresh exited without recording a result for this request. Check the selected workflow and assessment store.");
    }
  } catch (e) {
    try {
      if (!token) throw e;
      publishAssessment(dir, key, token, () => {
        const prev = readAssessment(dir, key), error = (e as Error).message.slice(0, 400);
        const next = assessed(prev, { iid: run.iid, project: run.project, at: new Date().toISOString(), error });
        if (next.analysisState === "pending") { next.analysisState = "error"; next.analysisError = error; }
        writeAssessment(dir, key, next);
        clearRequest(dir, key, generations);
      });
    } catch (error) { console.error(`assessment store: ${(error as Error).message}`); }
  }
}
