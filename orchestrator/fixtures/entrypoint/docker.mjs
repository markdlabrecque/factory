// Test-only `docker` for the recovery entrypoint smoke test (#74). Containers are JSON files in $FAKE_STATE/containers.
// `run -d --name N ... IMAGE` records the exact arguments and mounts; `exec ... N sh -c CMD` runs CMD on the host the way
// the container sees its mounts (cwd = the worktree mount, GIT_DIR = the private Git mount, $EVIDENCE = the writable
// evidence mount), forwarding SIGTERM; the browser preflight is explicitly faked as provisioned. `container inspect N`
// and `rm -f N` use the exact name. Everything else exits 2.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const dir = join(process.env.FAKE_STATE, "containers");
mkdirSync(dir, { recursive: true });
appendFileSync(join(process.env.FAKE_STATE, "docker.jsonl"), JSON.stringify(args) + "\n");
const file = (n) => join(dir, `${n}.json`);
const fail = (msg, code = 2) => { process.stderr.write(msg + "\n"); process.exit(code); };
if (args[0] === "run") {
  const name = args[args.indexOf("--name") + 1];
  const mounts = args.flatMap((x, i) => (args[i - 1] === "-v" ? [x] : [])).map((v) => { const [host, box, mode] = v.split(":"); return { host, box, ro: mode.split(",").includes("ro") }; });
  if (existsSync(file(name))) fail(`Conflict. The container name "/${name}" is already in use`, 125);
  writeFileSync(file(name), JSON.stringify({ name, args, mounts }));
  process.stdout.write(`${name}\n`);
} else if (args[0] === "exec") {
  const sh = args.lastIndexOf("sh");
  const name = args[sh - 1];
  if (!existsSync(file(name))) fail(`Error: No such container: ${name}`, 1);
  if (args[sh + 2].startsWith("timeout --signal=KILL ")) { process.stdout.write("browser preflight OK\n"); process.exit(0); }
  const { mounts } = JSON.parse(readFileSync(file(name), "utf8"));
  const at = (box) => mounts.find((m) => m.box === box).host;
  const evidence = mounts.find((m) => m.box.startsWith("/home/agent/evidence/") && !m.ro).host;
  const child = spawn("sh", ["-c", args[sh + 2]], { cwd: at("/home/agent/workspace"), stdio: [args.includes("-i") ? "pipe" : "ignore", "inherit", "inherit"],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, GIT_DIR: at("/home/agent/.factory-git"), GIT_WORK_TREE: at("/home/agent/workspace"), GIT_CONFIG_NOSYSTEM: "1", EVIDENCE: evidence } });
  if (args.includes("-i")) process.stdin.pipe(child.stdin);
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  child.on("close", (code) => process.exit(code ?? 1));
} else if (args[0] === "container" && args[1] === "inspect") {
  const name = args.at(-1);
  if (!existsSync(file(name))) fail(`Error: No such container: ${name}`, 1);
  process.stdout.write(`/${name}\n`);
} else if (args[0] === "rm" && args[1] === "-f") {
  rmSync(file(args.at(-1)), { force: true });
} else fail(`fake docker: unexpected call: ${args.join(" ")}`);
