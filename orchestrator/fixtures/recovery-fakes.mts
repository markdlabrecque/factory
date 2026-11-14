// Test-only fakes for the recovery attempt (#74): a clock whose timers fire only when advanced, and a fake Docker world
// for recovery-sandbox.mts. The world models one daemon shared by the async Proc boundary (`docker run`/`docker exec`)
// and the sync Docker boundary (`container inspect`/`rm -f`). `docker run` records the exact arguments and mounts and
// adds the named container; `docker exec ... <name> sh -c <cmd>` runs <cmd> on the host as the container would see its
// mounts: in the worktree, with GIT_DIR set to the private Git metadata mounted at /home/agent/.factory-git (so the
// project's other refs are invisible, as in the container) and $EVIDENCE set to the evidence mount. Commands named in
// `hooks` are answered by the test instead. Aborting an exec kills that process and rejects only after it has exited.
// The browser preflight is explicitly provisioned by the fake; probe behavior has separate fixture tests.
// Any other command throws. Not part of the scaffold; imported only by tests.
import { realProc } from "../recovery-sandbox.mts";
import type { Proc } from "../recovery-sandbox.mts";
import type { Clock, Docker } from "../recovery.mts";

export function fakeClock(start = Date.UTC(2026, 10, 12)) {
  let now = start;
  let next = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id as number); },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (t.at <= now) { timers.delete(id); t.fn(); }
  };
  return { clock, advance, pending: () => timers.size };
}

export type Hook = (o: { signal?: AbortSignal; env?: NodeJS.ProcessEnv }) => Promise<{ status: number; stdout?: string; stderr?: string }>;

export function dockerWorld(o: { existing?: string[]; stuck?: Set<string>; down?: () => boolean; runFails?: boolean; hooks?: Record<string, Hook> } = {}) {
  const live = new Set(o.existing ?? []);
  const runs: { name: string; args: string[]; mounts: { host: string; box: string; ro: boolean }[] }[] = [];
  const execs: { name: string; command: string; user?: string }[] = [];
  const syncCalls: string[][] = [];
  const hooks = o.hooks ?? {};

  const proc: Proc = async (cmd, args, po = {}) => {
    if (cmd !== "docker") throw new Error(`unexpected command: ${cmd} ${args.join(" ")}`);
    if (args[0] === "run") {
      const name = args[args.indexOf("--name") + 1];
      const mounts = args.flatMap((a, i) => (args[i - 1] === "-v" ? [a] : [])).map((v) => {
        const [host, box, mode] = v.split(":");
        return { host, box, ro: mode.split(",").includes("ro") };
      });
      runs.push({ name, args, mounts });
      if (o.runFails) return { status: 125, stdout: "", stderr: "image not found" };
      live.add(name);
      return { status: 0, stdout: `${name}\n`, stderr: "" };
    }
    if (args[0] === "exec") {
      const sh = args.lastIndexOf("sh");
      const name = args[sh - 1];
      const command = args[sh + 2];
      execs.push({ name, command, ...(args.includes("--user") ? { user: args[args.indexOf("--user") + 1] } : {}) });
      if (!live.has(name)) return { status: 1, stdout: "", stderr: `Error: No such container: ${name}` };
      if (hooks[command]) return { stdout: "", stderr: "", ...(await hooks[command]({ signal: po.signal, env: po.env })) };
      if (command.startsWith("timeout --signal=KILL ")) return { stdout: "browser preflight OK\n", stderr: "", status: 0 };
      const run = runs.find((r) => r.name === name)!;
      const at = (box: string) => run.mounts.find((m) => m.box === box)!.host;
      const evidence = run.mounts.find((m) => m.box.startsWith("/home/agent/evidence/") && !m.ro)!.host;
      return realProc("sh", ["-c", command], {
        cwd: at("/home/agent/workspace"), stdin: po.stdin, signal: po.signal, onLine: po.onLine,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_DIR: at("/home/agent/.factory-git"), GIT_WORK_TREE: at("/home/agent/workspace"),
          GIT_CONFIG_NOSYSTEM: "1", EVIDENCE: evidence, ...Object.fromEntries(Object.entries(po.env ?? {}).filter(([k]) => k.startsWith("FAKE_"))) },
      });
    }
    throw new Error(`unexpected docker call: ${args.join(" ")}`);
  };

  const docker: Docker = (args) => {
    syncCalls.push(args);
    if (o.down?.()) return { status: 1, stdout: "", stderr: "Cannot connect to the Docker daemon" };
    const name = args.at(-1)!;
    if (args[0] === "rm" && args[1] === "-f") { if (!o.stuck?.has(name)) live.delete(name); return { status: 0, stdout: "", stderr: "" }; }
    if (args[0] === "container" && args[1] === "inspect") {
      return live.has(name) ? { status: 0, stdout: `/${name}\n`, stderr: "" } : { status: 1, stdout: "", stderr: `Error: No such container: ${name}` };
    }
    throw new Error(`unexpected docker call: ${args.join(" ")}`);
  };
  return { proc, docker, live, runs, execs, syncCalls };
}
