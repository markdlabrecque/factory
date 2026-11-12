import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Run-state store + the Factory tracker board/evidence page (light/dark/system appearance).
// Stage visits persist for real timing, blockers and bounce stats; legacy history stays explicitly incomplete.
// Completed tickets appear in the template's latest-ten Shipped section; stopped runs remain unfinished.
// Writers (main.mts) call setStage(); each call writes <stateDir>/<key>.json and regenerates
// .sandcastle/board.html, a self-contained snapshot that opens from disk and does not poll. The always-on
// service (board-server.mts) serves the same page over HTTP, plus buildBoardData() as JSON at /api/runs,
// which the page polls to animate live changes.
// The dispatcher calls reserveRun() as it spawns each run, so the run counts against the shared cap (in this and
// every other project's pass) before main.mts writes its own record; a launch whose process dies before that is
// forgotten rather than stopped, so the next pass retries it.
// claimRun() makes that reservation atomic: under <stateDir>/claim.lock it counts in-flight runs across every project,
// refuses when the cap is reached or the ticket already has a run in flight, and only then writes the record. The
// dispatcher claims each ticket before spawning it; recovery (cli/src/recovery-claim.mts) claims the same way and also
// records its project's attempt under the lock, so capacity, ticket and project ownership are taken together or not at all.
// stateDir: $SANDCASTLE_STATE_DIR, else .sandcastle/state in the current repo. Set the variable to
// one shared folder (the service's) so a single board shows runs from every project and worktree.

export type Stage = "queued" | "waiting" | "setup" | "implementing" | "verifying" | "posting" | "pushing" | "ci" | "done" | "stopped";
export const TERMINAL: Stage[] = ["done", "stopped"];
// Not running and not finished: the dispatcher re-evaluates these every pass. "queued" = not started
// (the note says why), "waiting" = the implementer reported a blocker. Neither counts against capacity.
export const PARKED: Stage[] = ["queued", "waiting"];

export interface QueueReason { code: string; text: string }
export interface StageVisit { stage: Stage; at: string; note?: string; reasons?: QueueReason[] }

export interface RunState {
  iid: string;
  project?: string;
  title?: string;
  ticketUrl?: string;
  branch?: string;
  base?: string;
  stage: Stage;
  stageSince: string;
  startedAt: string;
  updatedAt: string;
  pid: number;
  verdict?: string;
  mr?: string;
  note?: string;
  queueReasons?: QueueReason[]; // optional structured blockers; older writers supply note instead
  stageHistory?: StageVisit[]; // each visit ends at the next visit's timestamp
  historyComplete?: boolean; // false for pre-upgrade records or truncated history
  evidenceDir?: string;
  ticketHash?: string; // content hash of the ticket the run was built from
  parentIid?: string; // set when the ticket is a GitLab Task; the Task is closed once its branch merges
  mergedAt?: string; // when the dispatcher saw the MR merged and closed the Task or moved the ticket on
  starting?: boolean; // reserved by the dispatcher at launch; main.mts clears it with its first write
  // Set while a recovery attempt owns the ticket: its attempt number and the record's stage/note before the claim.
  recovery?: { attempt: number; from?: { stage: Stage; note?: string; stageSince?: string } };
}

export interface BoardRun extends RunState {
  key: string;
  evidenceUrl?: string;
  activity?: string; // newest line of the agent's log, for a run that is in progress
  activityAt?: string; // when that log was last written
}

const expand = (p: string) => (p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : resolve(p));
export const stateDir = () => expand(process.env.SANDCASTLE_STATE_DIR || ".sandcastle/state");
const boardFile = () => resolve(".sandcastle/board.html");
const templateFile = resolve(dirname(fileURLToPath(import.meta.url)), "board.template.html");
const now = () => new Date().toISOString();

let project: string | undefined;
/** Name this process's runs by project so one shared board can tell repos apart. */
export function setProject(name: string): void {
  project = name;
}
export const keyFor = (iid: string, proj?: string) => (proj ? `${proj.replace(/[^A-Za-z0-9._-]+/g, "_")}--${iid}` : iid);

function write(file: string, text: string) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Record stage changes, not heartbeats. Parked reason changes start a new blocker episode.
 *  A reopened completed ticket starts a new lifecycle; retries from stopped retain their visits. */
export function trackStage(previous: Partial<RunState>, next: RunState, at: string): RunState {
  const reopened = previous.stage === "done" && next.stage !== "done";
  const stored = Array.isArray(previous.stageHistory) ? previous.stageHistory : [];
  const visits = reopened ? [] : stored.filter(v => v && typeof v.stage === "string" && Number.isFinite(Date.parse(v.at)));
  let complete = reopened || (!previous.stage ? true : previous.historyComplete === true && visits.length === stored.length);
  if (!visits.length && previous.stage && !reopened) {
    visits.push({ stage: previous.stage, at: previous.stageSince || at, note: previous.note, reasons: previous.queueReasons });
    complete = false;
  }
  // An older project writer can update stage without adding visits. Never call that history complete.
  if (previous.stage && visits.length && visits.at(-1)!.stage !== previous.stage) {
    visits.push({ stage: previous.stage, at: previous.stageSince || at, note: previous.note, reasons: previous.queueReasons });
    complete = false;
  }
  const last = visits.at(-1);
  if (last && previous.stage && !PARKED.includes(previous.stage) && previous.stageSince && last.at !== previous.stageSince) complete = false;
  const reasons = PARKED.includes(next.stage) ? next.queueReasons : undefined;
  const note = PARKED.includes(next.stage) || next.stage === "stopped" ? next.note : undefined;
  if (!last || last.stage !== next.stage || (PARKED.includes(next.stage) &&
      (last.note !== note || JSON.stringify(last.reasons) !== JSON.stringify(reasons)))) {
    visits.push({ stage: next.stage, at, note, reasons });
  }
  // Bound a pathological retry loop without claiming its retained totals are complete.
  if (visits.length > 1000) { visits.splice(0, visits.length - 1000); complete = false; }
  return { ...next, stageHistory: visits, historyComplete: complete };
}

export function setStage(iid: string, patch: Partial<RunState>): void {
  mkdirSync(stateDir(), { recursive: true });
  const file = resolve(stateDir(), `${keyFor(iid, project)}.json`);
  let cur: Partial<RunState> = {};
  if (existsSync(file)) {
    try {
      cur = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      /* corrupt or mid-write: start fresh */
    }
  }
  const stageChanged = patch.stage && patch.stage !== cur.stage;
  const at = now();
  const next = trackStage(cur, {
    startedAt: at,
    ...cur,
    ...patch,
    iid,
    project,
    pid: patch.pid ?? process.pid,
    updatedAt: at,
    stageSince: stageChanged || !cur.stageSince ? at : cur.stageSince,
    queueReasons: patch.queueReasons ?? (stageChanged || Object.prototype.hasOwnProperty.call(patch, "note") ? undefined : cur.queueReasons),
  } as RunState, at);
  write(file, JSON.stringify(next, null, 2));
  renderBoard();
}

/** Record a run the dispatcher has just spawned (process `pid`), before the run writes for itself. It counts as
 *  in flight while `pid` lives; if `pid` exits before main.mts clears `starting`, readRuns() drops the record. */
export function reserveRun(iid: string, pid: number, patch: Partial<RunState> = {}): void {
  setStage(iid, { ...patch, stage: "setup", note: "starting", starting: true, pid });
}

export type Claim = { ok: true; run: RunState } | { ok: false; reason: string };
const inFlight = (r: RunState) => !TERMINAL.includes(r.stage) && !PARKED.includes(r.stage);
const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Hold <dir>/claim.lock while `fn` runs. The lock names its holder's pid; a lock whose holder is gone is taken over. */
function withClaimLock<T>(dir: string, fn: () => T, waitMs = 10_000): T {
  mkdirSync(dir, { recursive: true });
  const lock = resolve(dir, "claim.lock");
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const fd = openSync(lock, "wx", 0o600);
      try {
        writeFileSync(fd, String(process.pid));
      } finally {
        closeSync(fd);
      }
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      let holder = NaN;
      let age = 0;
      try {
        holder = Number(readFileSync(lock, "utf8"));
        age = Date.now() - statSync(lock).mtimeMs;
      } catch {
        continue; // released meanwhile
      }
      // A holder that died, or a lock left empty by a crash between create and write, is stale.
      if ((Number.isInteger(holder) && holder > 0 && !alive(holder)) || (!holder && age > 5_000)) {
        rmSync(lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`Run claims are locked by process ${holder || "unknown"} (${lock}). Retry shortly.`);
      sleep(50);
    }
  }
  try {
    return fn();
  } finally {
    rmSync(lock, { force: true });
  }
}

/** Atomically claim a slot under the shared cap and ownership of ticket `iid` for process `pid`. Refused, writing
 *  nothing, when `cap` runs are already in flight across every project in the state folder, or when the ticket has a
 *  run in flight. `also` runs under the lock after those checks, with the ticket's current record; it may throw to
 *  refuse (its message is the reason, nothing is written) or return more fields for the record. The record is written
 *  as a reservation (stage `setup`, note `starting`, `starting: true`) over the ticket's existing record, keeping its
 *  other fields (branch, evidence). It does not render the board; reserveRun() or the run's own writes do. */
export function claimRun(o: {
  iid: string;
  pid: number;
  cap: number;
  project?: string;
  dir?: string;
  patch?: Partial<RunState>;
  also?: (current: RunState | undefined) => Partial<RunState> | void;
}): Claim {
  const dir = o.dir ?? stateDir();
  const proj = o.project ?? project;
  const key = keyFor(o.iid, proj);
  return withClaimLock(dir, () => {
    const runs = readRuns(dir);
    const current = runs.find((r) => r.key === key);
    if (current && inFlight(current)) return { ok: false, reason: `#${o.iid} already has a run in flight (${current.stage}, process ${current.pid})` };
    const active = runs.filter(inFlight).length;
    if (active >= o.cap) return { ok: false, reason: `no capacity: ${active} run(s) in flight, cap ${o.cap}` };
    let extra: Partial<RunState> | void;
    try {
      extra = o.also?.(current);
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
    const { key: _key, evidenceUrl: _url, activity: _a, activityAt: _at, ...cur } = (current ?? {}) as Partial<BoardRun>;
    const at = now();
    const run = trackStage(cur, { startedAt: at, ...cur, stage: "setup", note: "starting", starting: true, ...o.patch, ...extra,
      queueReasons: undefined, iid: o.iid, project: proj, pid: o.pid, updatedAt: at, stageSince: at } as RunState, at);
    write(resolve(dir, `${key}.json`), JSON.stringify(run, null, 2));
    return { ok: true, run };
  });
}

/** Delete a run record (the dispatcher clears parked records for tickets that left the queue). */
export function removeRun(iid: string): void {
  rmSync(resolve(stateDir(), `${keyFor(iid, project)}.json`), { force: true });
  renderBoard();
}

/** Read every run. A run whose process is gone without a terminal stage crashed: mark it washed away. A reserved
 *  launch whose process died before the run started is removed instead, as if never launched. */
export function readRuns(dir = stateDir()): BoardRun[] {
  if (!existsSync(dir)) return [];
  const runs: BoardRun[] = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
    try {
      const file = resolve(dir, f);
      let s: RunState = JSON.parse(readFileSync(file, "utf8"));
      if (!TERMINAL.includes(s.stage) && !PARKED.includes(s.stage) && s.pid !== process.pid && !alive(s.pid)) {
        if (s.starting) {
          rmSync(file, { force: true });
          continue;
        }
        const at = now();
        s = trackStage(s, { ...s, note: `process ${s.pid} exited without finishing (last stage: ${s.stage})`,
          stage: "stopped", stageSince: at }, at);
        write(file, JSON.stringify(s, null, 2));
      }
      runs.push({ ...s, key: f.replace(/\.json$/, "") });
    } catch {
      /* skip unreadable file */
    }
  }
  return runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/** What an in-progress run is doing now: the last line of its newest agent log (`<branch>-*.log` in the project's
 *  `.sandcastle/logs`, found next to the evidence folder). Read-only, and only for runs that are neither parked nor finished. */
export function latestActivity(run: RunState): { activity: string; activityAt: string } | undefined {
  if (TERMINAL.includes(run.stage) || PARKED.includes(run.stage) || !run.branch || !run.evidenceDir) return undefined;
  const dir = resolve(run.evidenceDir, "..", "..", "logs");
  try {
    const newest = readdirSync(dir)
      .filter((n) => n.startsWith(`${run.branch}-`) && n.endsWith(".log"))
      .map((n) => ({ file: resolve(dir, n), at: statSync(resolve(dir, n)) }))
      .sort((a, b) => b.at.mtimeMs - a.at.mtimeMs)[0];
    if (!newest) return undefined;
    const size = Math.min(newest.at.size, 8192);
    const fd = openSync(newest.file, "r");
    let text: string;
    try {
      const buf = Buffer.alloc(size);
      readSync(fd, buf, 0, size, newest.at.size - size);
      text = buf.toString("utf8");
    } finally {
      closeSync(fd);
    }
    const last = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop();
    return last ? { activity: last.length > 200 ? last.slice(0, 199) + "…" : last, activityAt: newest.at.mtime.toISOString() } : undefined;
  } catch {
    return undefined; // no log yet, or an unreadable one
  }
}

/** Board snapshot shared by the embedded page data and GET /api/runs. mode "http" links evidence through the
 *  service's /evidence route; "file" links the folder directly. */
export function buildBoardData(mode: "file" | "http"): { runs: BoardRun[]; generatedAt: string } {
  const runs = readRuns().map((r) => ({
    ...r,
    evidenceUrl: !r.evidenceDir ? undefined : mode === "http" ? `/evidence/${encodeURIComponent(r.key)}/` : `file://${r.evidenceDir}/`,
    ...latestActivity(r),
  }));
  return { runs, generatedAt: now() };
}

const embed = (data: unknown) =>
  readFileSync(templateFile, "utf8").replace("/*__DATA__*/null", () => JSON.stringify(data).replace(/</g, "\\u003c"));

export function buildPage(mode: "file" | "http"): string {
  return embed(buildBoardData(mode));
}

/** Render evidence using the board's shell. Evidence pages never poll, so media keeps playing. */
export function buildEvidencePage(run: BoardRun, files: { name: string; kind: string; url: string; text?: string; truncated?: boolean }[]): string {
  return embed({ evidence: { run, files, url: `/evidence/${encodeURIComponent(run.key)}/` } });
}

export function renderBoard(): void {
  mkdirSync(dirname(boardFile()), { recursive: true });
  write(boardFile(), buildPage("file"));
}
