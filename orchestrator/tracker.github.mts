// Structured context reads use collector-owned deadlines/output bounds, independent of delivery state.
// #153: continuation never creates/posts/reruns; REST checks are bound to the recorded commit, reread before SHA merge.
// #137: TOML identity and labels are authoritative; legacy adapter exports are preserved.
import { execFileSync, spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { ciGate, missingChecks } from "./ci.mts";
import { commandContextSource } from './ticket-context-source.mts';
import type { Gate } from "./ci.mts";
import { LABELS, MERGE, TRACKER } from "./runtime-config.mts";
import type { Child, Note } from "./graph.mts";
import type { Delivered, Delivery, DeliveryIdentity, DeliveryObservation, MergedPr, ReadyTicket, Select, Ticket } from "./tracker.mts";

// GitHub adapter for tracker.mts, via `gh` on the host (TRACKER.kind "github", TRACKER.project
// "owner/repo"). Units of work can be sub-issues. Verification media is attached to one issue
// comment with native `gh --attach` support. Upload failure stops delivery; no evidence branch is pushed.
// Delivery: open a PR, and with MERGE.auto merge it only when ciGate (ci.mts) says "pass" for the
// pushed commit. Missing/pending CI is a durable wait; failure is an operator hold without draft mutation.
// mergedPr: the newest merged PR into the base from the run's branch, else one titled `#N: ...`.
// readyList rejects GitHub Search's 1000-result boundary rather than infer deselection from a partial list (#135).

const REPO = TRACKER.project;
const HOST = (TRACKER as { host?: string }).host ?? "github.com";
const [OWNER, NAME] = REPO.split("/");

/** Bounded structured ticket/notes/parentOf contract for ticket-context.mts. No human CLI rendering. */
export const contextSource = commandContextSource({ kind: 'github', host: HOST, project: REPO });

let deliveryDeadline: number | undefined;
export function setDeliveryDeadline(deadline: number | undefined): void { deliveryDeadline = deadline; }
function deliveryTimeout(): number | undefined {
  if (deliveryDeadline === undefined) return undefined;
  const left = deliveryDeadline - Date.now(); if (left <= 0) throw Error('delivery deadline');
  return Math.min(10000, left);
}
function gh(args: string[], input?: string): string {
  return execFileSync("gh", args, { encoding: "utf8", timeout: deliveryTimeout(), killSignal: 'SIGKILL', env: { ...process.env, GH_HOST: HOST }, input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 }).trim();
}
const json = <T,>(args: string[]): T => JSON.parse(gh(args));
const git = (args: string[], env?: NodeJS.ProcessEnv) => execFileSync("git", args, { encoding: "utf8", env, stdio: ["ignore", "pipe", "inherit"] }).trim();

type GhIssue = { number: number; title: string; body: string; state: string; labels?: { name: string }[]; assignees?: { login: string }[]; author?: { login: string }; milestone?: { title: string } | null };
const slim = (i: GhIssue): Ticket => ({ iid: i.number, title: i.title, description: i.body ?? "", state: i.state.toLowerCase(), labels: (i.labels ?? []).map((l) => l.name), assignees: i.assignees?.map(a => ({ username: a.login })), author: i.author ? { username: i.author.login } : undefined, milestone: i.milestone });
const FIELDS = "number,title,body,state,labels,assignees,author,milestone";

export const currentUsername = () => json<{ login: string }>(['api', 'user']).login;
export const ticketUrl = (iid: number | string) => `https://${HOST}/${REPO}/issues/${iid}`;

/** Open issues the graph can name as blockers: the milestone's, or the whole repo's when none is set. */
export function catalogue(milestone = TRACKER.milestone): Ticket[] {
  return json<GhIssue[]>(["issue", "list", "-R", REPO, "--state", "open", "--limit", "1000", "--json", FIELDS, ...(milestone ? ["--milestone", milestone] : [])]).map(slim);
}

/** GraphQL; a missing issue (NOT_FOUND, e.g. a PR number) comes back as null rather than an error. */
function gql<T>(query: string): T {
  const res = spawnSync("gh", ["api", "graphql", "-f", `query=${query}`], { encoding: "utf8", timeout: deliveryTimeout(), killSignal: 'SIGKILL', env: { ...process.env, GH_HOST: HOST }, maxBuffer: 64 * 1024 * 1024 });
  let out: { data?: T; errors?: { type?: string; message: string }[] };
  try {
    out = JSON.parse(res.stdout);
  } catch {
    throw new Error(`GitHub GraphQL failed: ${(res.stderr || res.stdout).slice(0, 500)}`);
  }
  const errors = (out.errors ?? []).filter((e) => e.type !== "NOT_FOUND");
  if (errors.length || !out.data) throw new Error(`GitHub GraphQL: ${errors.map((e) => e.message).join("; ") || res.stderr}`);
  return out.data;
}
/** One GraphQL query per 50 issues, each issue under an alias. */
function issuesQuery<T>(iids: number[], fields: string): Map<number, T> {
  const out = new Map<number, T>();
  for (let i = 0; i < iids.length; i += 50) {
    const chunk = iids.slice(i, i + 50);
    const data = gql<{ repository: Record<string, T | null> }>(
      `{ repository(owner: ${JSON.stringify(OWNER)}, name: ${JSON.stringify(NAME)}) { ${chunk.map((n) => `i${n}: issue(number: ${n}) { ${fields} }`).join(" ")} } }`,
    );
    for (const n of chunk) {
      const v = data.repository[`i${n}`];
      if (v) out.set(n, v);
    }
  }
  return out;
}

type Hierarchy = { parent: { number: number } | null; subIssues: { nodes: { number: number; state: string }[] } };
const HIERARCHY = "parent { number } subIssues(first: 100) { nodes { number state } }";

/** Each issue's sub-issues, in order. Issues without any are left out. */
export function children(iids: number[]): Map<number, Child[]> {
  const map = new Map<number, Child[]>();
  for (const [n, h] of issuesQuery<Hierarchy>(iids, HIERARCHY)) {
    if (h.subIssues.nodes.length) map.set(n, h.subIssues.nodes.map((k) => ({ iid: k.number, open: k.state === "OPEN" })));
  }
  return map;
}

/** The issue a sub-issue belongs to; undefined for a top-level issue. */
export function parentOf(iid: number): number | undefined {
  return issuesQuery<Hierarchy>([iid], HIERARCHY).get(iid)?.parent?.number;
}

/** Open issues by number, whatever their milestone. */
function openTickets(iids: number[]): Ticket[] {
  type Q = { number: number; title: string; body: string; state: string; labels: { nodes: { name: string }[] } };
  return [...issuesQuery<Q>(iids, "number title body state labels(first: 50) { nodes { name } }").values()]
    .filter((q) => q.state === "OPEN")
    .map((q) => slim({ ...q, labels: q.labels.nodes }));
}

/** Same contract as the GitLab adapter: issues with sub-issues are replaced by their open sub-issues. */
export function workCatalogue(subtasks: boolean): { tickets: Ticket[]; childrenOf: Map<number, Child[]> } {
  const open = catalogue();
  if (!subtasks) return { tickets: open, childrenOf: new Map() };
  const childrenOf = children(open.map((t) => t.iid));
  const byIid = new Map(open.map((t) => [t.iid, t]));
  const missing = [...childrenOf.values()].flat().filter((k) => k.open && !byIid.has(k.iid)).map((k) => k.iid);
  for (const t of openTickets(missing)) byIid.set(t.iid, t);
  for (const [p, kids] of childrenOf) {
    const parent = byIid.get(p)!;
    for (const k of kids) {
      const t = byIid.get(k.iid);
      if (t) t.parent = { iid: parent.iid, title: parent.title, description: parent.description };
    }
    byIid.delete(p);
  }
  return { tickets: [...byIid.values()], childrenOf };
}

export function ticket(iid: number): Ticket {
  return slim(json<GhIssue>(["issue", "view", String(iid), "-R", REPO, "--json", FIELDS]));
}

export function viewText(iid: number): string {
  return gh(["issue", "view", String(iid), "-R", REPO, "--comments"]);
}

/** Comments, oldest first. */
export function notes(iid: number): Note[] {
  const pages = json<{ body: string }[][]>(["api", "--paginate", "--slurp", `repos/${REPO}/issues/${iid}/comments?per_page=100`]);
  return pages.flat().map((c) => ({ body: c.body ?? "", system: false }));
}

const ORDER: Record<string, string> = { created_at: "created", updated_at: "updated", popularity: "comments" };

/** Open issues carrying every ready label and no exclude label, filtered by `select`.
 * Search returns at most 1000 results regardless of --limit. At that boundary completeness is unknown:
 * fail the read so refresh preserves last-good facts instead of marking omitted tickets deselected. */
export function readyList(select: Select = {}): ReadyTicket[] {
  const search = [
    ...LABELS.exclude.map((l) => `-label:${JSON.stringify(l)}`),
    `sort:${ORDER[select.order ?? ""] ?? "created"}-${select.sort === "desc" ? "desc" : "asc"}`,
    select.search ?? "",
  ].filter(Boolean).join(" ");
  const args = ["issue", "list", "-R", REPO, "--state", "open", "--json", FIELDS, "--search", search];
  for (const l of LABELS.ready) args.push("--label", l);
  if (TRACKER.milestone) args.push("--milestone", TRACKER.milestone);
  if (select.assignee) args.push("--assignee", select.assignee);
  if (select.author) args.push("--author", select.author);
  const issues = json<GhIssue[]>([...args, "--limit", "1000"]);
  if (issues.length >= 1000) {
    throw new Error("GitHub selection may be incomplete at the 1000-result search limit; narrow dispatch filters before retrying. Selection is unknown.");
  }
  return issues.map((i) => ({ ...slim(i), assignees: (i.assignees ?? []).map((a) => ({ username: a.login })) }));
}

export function comment(iid: number | string, body: string): void {
  gh(["issue", "comment", String(iid), "-R", REPO, "--body-file", "-"], body);
}

/** Post one verification comment. Standalone image references let gh render videos inline too.
 * Requires gh 2.99+ and repository push access. Never retry with Git hosting on upload failure. */
export function postVerification(iid: string, _tip: string, files: string[], body: (media: string[]) => string): void {
  const paths = files.map((f) => resolve(f));
  // Angle brackets preserve spaces and parentheses in local Markdown destinations.
  const markdown = paths.map((f) => `![${basename(f)}](<${f}>)`);
  gh(["issue", "comment", iid, "-R", REPO, "--body-file", "-", ...paths.flatMap((f) => ["--attach", f])], body(markdown));
}

/** Source branches of every open PR. */
export function openMrBranches(): Set<string> {
  return new Set(json<{ headRefName: string }[]>(["pr", "list", "-R", REPO, "--state", "open", "--limit", "1000", "--json", "headRefName"]).map((p) => p.headRefName));
}

export function mergedInto(branch: string, base: string): boolean {
  return json<unknown[]>(["pr", "list", "-R", REPO, "--state", "merged", "--head", branch, "--base", base, "--limit", "1", "--json", "number"]).length > 0;
}

/** The newest PR merged into `base` from the run's branch, else one whose title starts with `#N:`. */
export function mergedPr(iid: number, branch: string | undefined, base: string): MergedPr | undefined {
  type Pr = { number: number; title: string; url: string; mergedAt: string };
  const list = (filter: string[]) => json<Pr[]>(["pr", "list", "-R", REPO, "--state", "merged", "--base", base, ...filter, "--limit", "100", "--json", "number,title,url,mergedAt"]);
  const pick = (prs: Pr[], matchedBy: MergedPr["matchedBy"]) => prs.map((p): MergedPr => ({ number: p.number, title: p.title, url: p.url, mergedAt: p.mergedAt, matchedBy }))
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))[0];
  // Search is word-based, so the `#N:` prefix is checked here rather than trusted to the query.
  return (branch ? pick(list(["--head", branch]), "branch") : undefined)
    ?? pick(list(["--search", `${iid} in:title`]).filter((p) => p.title.startsWith(`#${iid}:`)), "title");
}

const addLabels = (iid: number, labels: string[]) =>
  gh(["api", "-X", "POST", `repos/${REPO}/issues/${iid}/labels`, ...labels.flatMap((l) => ["-f", `labels[]=${l}`])]);

export function addLabel(iid: number, label: string): void {
  addLabels(iid, [label]);
}

export function close(iid: number): void {
  gh(["issue", "close", String(iid), "-R", REPO, "--reason", "completed"]);
}

/** Move a ticket to the next stage: `LABELS.done` on, the ready labels off. It stays open. */
export function advance(iid: number): void {
  addLabels(iid, [LABELS.done]);
  for (const l of LABELS.ready) {
    spawnSync("gh", ["api", "-X", "DELETE", `repos/${REPO}/issues/${iid}/labels/${encodeURIComponent(l)}`], { stdio: "ignore" }); // 404 if absent: fine
  }
}

/** Check every label exists in the repo; offer to create missing ones from a terminal, else exit. */
export async function ensureLabels(names: string[]): Promise<void> {
  const have = new Set(json<{ name: string }[]>(["label", "list", "-R", REPO, "--limit", "1000", "--json", "name"]).map((l) => l.name));
  const missing = names.filter((n) => !have.has(n));
  if (!missing.length) return;
  const list = missing.map((m) => `"${m}"`).join(", ");
  if (!process.stdin.isTTY) {
    console.error(`Missing label(s) in ${REPO}: ${list}. Run this once from a terminal to create them, or change labels in factory.toml (legacy: LABELS in config.mts).`);
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (const name of missing) {
    const answer = (await rl.question(`Label "${name}" doesn't exist in ${REPO}. Create it? [y/N] `)).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      rl.close();
      console.error(`Not creating "${name}". Sandcastle needs it; quitting.`);
      process.exit(1);
    }
    gh(["label", "create", name, "-R", REPO]);
    console.log(`Created label "${name}".`);
  }
  rl.close();
}

/** Checks on the PR's head right now. `gh pr checks` exits non-zero while pending or when there are none. */
function checks(pr: string): { name: string; bucket: string }[] {
  const res = spawnSync("gh", ["pr", "checks", pr, "--json", "name,bucket"], { encoding: "utf8" });
  try {
    return JSON.parse(res.stdout);
  } catch {
    return []; // "no checks reported"
  }
}

/**
 * Open a PR into the base. Without `autoMerge`, stop there (you merge it). With it, poll the checks
 * until ciGate decides: "pass" merges (only while the head is still the pushed commit); "fail", no
 * checks within `noCiMinutes`, or still pending at `waitMinutes` parks it for a person. Failed CI
 * becomes an operator hold, without reruns or draft mutation. Required checks must pass, not skip.
 */
// #150: fresh host authorization after CI, immediately before the SHA-guarded merge.
export async function deliver(d: Delivery & { waitMinutes: number; noCiMinutes: number; autoMerge: boolean }): Promise<Delivered> {
  const note = d.autoMerge
    ? "Sandcastle merges this PR once every CI check on this commit has passed. It is never merged without CI."
    : "CI runs on this PR.";
  const url = gh(["pr", "create", "-R", REPO, "--base", d.base, "--head", d.branch, "--title", d.title, "--body-file", "-"], d.body(note)).split(/\s+/).find((w) => w.startsWith("http")) ?? "";
  console.log(url);
  const opened = openedIdentity(url, d);
  if (opened) d.onOpened?.(opened);
  else if (d.onOpened) throw new Error('PR creation returned an unresolved identity; do not replay creation');
  if (!d.autoMerge) return { url, merged: false };

  d.onStage("ci");
  let gate: Gate = "none";
  let observed: { name: string; bucket: string }[] = [];
  const required = MERGE.requiredChecks ?? [];
  const deadline = Date.now() + d.waitMinutes * 60_000;
  const noChecksBy = Date.now() + d.noCiMinutes * 60_000;
  while (Date.now() < deadline) {
    observed = checks(url);
    gate = ciGate(observed, required);
    if (gate === "pass" || gate === "fail") break;
    if (gate === "none" && Date.now() > noChecksBy) break;
    await new Promise((r) => setTimeout(r, 15_000));
  }
  if (gate !== "pass") {
    const why = { fail: "CI failed", none: `no CI checks ran within ${d.noCiMinutes} min`, pending: `CI still running after ${d.waitMinutes} min` }[gate];
    if (gate !== "fail") {
      const missing = missingChecks(observed, required);
      const blocked = `${why}${missing.length ? `; required checks not passed: ${missing.join(", ")}` : ""}`;
      gh(["pr", "comment", url, "--body", `Sandcastle did not merge this PR: ${blocked}. Waiting for a person.`]);
      return { url, merged: false, blocked, state: 'ci-waiting', reasonCode: gate === 'none' ? 'checks-missing' : 'checks-pending' };
    }
    return { url, merged: false, blocked: why, state: 'operator-required', reasonCode: 'checks-failed' };
  }
  if (!opened) return { url, merged: false, blocked: 'Unknown PR identity', state: 'operator-required', reasonCode: 'identity-changed' };
  const result = await mergeExistingDelivery(opened, d.beforeMerge);
  return { url, merged: result.state === 'merged', mergedAt: result.mergedAt, blocked: result.state === 'merged' ? undefined : result.reason, state: result.state, reasonCode: result.reasonCode };
}

/* Host-only existing delivery API. All commands are bounded; no shell, create, comment or CI mutation. */
function openedIdentity(url: string, d: Pick<Delivery, 'branch' | 'base' | 'sha'>): DeliveryIdentity | undefined {
  const match = url.match(/\/pull\/(\d+)$/);
  if (!match || url !== `https://${HOST}/${REPO}/pull/${match[1]}`) return undefined;
  return { kind: 'github', host: HOST, repository: REPO, number: Number(match[1]), url, branch: d.branch, base: d.base, sha: d.sha };
}
function existing(args: string[], deadline: number): any {
  const left = deadline - Date.now(); if (left <= 0) throw Error('delivery deadline');
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', env: { ...process.env, GH_HOST: HOST }, timeout: Math.min(10000, left), killSignal: 'SIGKILL', maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'pipe'] }));
}
const hold = (reasonCode: DeliveryObservation['reasonCode'], reason: string): DeliveryObservation => ({ state: 'operator-required', reasonCode, reason });
export function observeDelivery(d: DeliveryIdentity, deadline = Date.now() + 30000): DeliveryObservation {
  if (!/^[0-9a-f]{40,64}$/.test(d.sha) || !d.branch || !d.base || d.kind !== 'github' || d.host !== HOST || d.repository !== REPO || !Number.isSafeInteger(d.number) || d.number < 1 || d.url !== `https://${HOST}/${REPO}/pull/${d.number}`) return hold('identity-changed', 'Unknown tracker identity');
  const pr = existing(['api', `repos/${REPO}/pulls/${d.number}`], deadline);
  if (pr.number !== d.number || pr.base?.repo?.full_name !== REPO || pr.head?.repo?.full_name !== REPO || pr.head?.ref !== d.branch || pr.base?.ref !== d.base || pr.head?.sha !== d.sha) return hold('identity-changed', 'PR repository, branch, base or head changed');
  if (pr.merged === true && typeof pr.merged_at === 'string' && Number.isFinite(Date.parse(pr.merged_at))) return { state: 'merged', reasonCode: 'merged', reason: 'Confirmed exact-head merge', mergedAt: pr.merged_at };
  if (pr.state === 'closed') return hold('closed', 'PR closed without merge');
  if (pr.state !== 'open' || typeof pr.draft !== 'boolean') return hold('identity-changed', 'Unknown PR status');
  if (pr.draft) return hold('draft', 'PR is draft');
  if (pr.mergeable === false || ['dirty', 'behind'].includes(pr.mergeable_state)) return hold('merge-restricted', 'PR conflicts or repository/approval restriction');
  if (pr.mergeable !== true || !['clean', 'unstable', 'has_hooks', 'blocked'].includes(pr.mergeable_state)) return { state: 'ci-waiting', reasonCode: 'transport-unknown', reason: 'PR mergeability unknown' };
  const pages = existing(['api', '--paginate', '--slurp', `repos/${REPO}/commits/${d.sha}/check-runs?per_page=100`], deadline);
  const statuses = existing(['api', '--paginate', '--slurp', `repos/${REPO}/commits/${d.sha}/statuses?per_page=100`], deadline);
  if (!Array.isArray(pages) || !Array.isArray(statuses) || pages.some(p => !Array.isArray(p.check_runs)) || statuses.some(p => !Array.isArray(p))) throw Error('Malformed checks');
  const runs = pages.flatMap(p => p.check_runs);
  if (runs.some(c => c.head_sha !== d.sha || typeof c.name !== 'string' || typeof c.status !== 'string')) return hold('identity-changed', 'Check head or identity unknown');
  // Statuses are newest first; only the latest result for each context is current.
  const latest = new Map<string, any>();
  for (const s of statuses.flat()) {
    if ((s.sha !== undefined && s.sha !== d.sha) || typeof s.context !== 'string') return hold('identity-changed', 'Status head unknown');
    if (!latest.has(s.context)) latest.set(s.context, s);
  }
  const checks = [...runs.map(c => ({ name: c.name, bucket: c.status !== 'completed' ? 'pending' : c.conclusion === 'success' ? 'pass' : ['skipped', 'neutral'].includes(c.conclusion) ? 'skipping' : 'fail' })),
    ...[...latest.values()].map(s => ({ name: s.context, bucket: s.state === 'success' ? 'pass' : ['failure', 'error'].includes(s.state) ? 'fail' : 'pending' }))];
  const gate = ciGate(checks, MERGE.requiredChecks ?? []);
  if (gate === 'pass' && pr.mergeable_state === 'blocked') return hold('merge-restricted', 'PR approval or repository restriction');
  return gate === 'pass' ? { state: 'ready', reasonCode: 'checks-pending', reason: 'Exact-head checks passed' }
    : gate === 'fail' ? hold('checks-failed', 'CI failed or cancelled')
    : { state: 'ci-waiting', reasonCode: gate === 'none' ? 'checks-missing' : 'checks-pending', reason: `CI ${gate}; required checks: ${missingChecks(checks, MERGE.requiredChecks ?? []).join(', ')}` };
}
export async function mergeExistingDelivery(d: DeliveryIdentity, beforeMerge: Delivery['beforeMerge'], deadline = Date.now() + 30000): Promise<DeliveryObservation> {
  const observed = observeDelivery(d, deadline);
  if (observed.state !== 'ready') return observed;
  if (!MERGE.auto) return hold('authorization', 'Manual merge policy');
  let blocked: string | undefined;
  try { blocked = typeof beforeMerge === 'function' ? await beforeMerge() : 'host authorization missing'; }
  catch (e) {
    if ((e as any).code === 'DELIVERY_READ_UNKNOWN') return { state: 'ci-waiting', reasonCode: 'transport-unknown', reason: (e as Error).message };
    blocked = `host authorization unknown: ${(e as Error).message}`;
  }
  if (blocked !== undefined) return hold('authorization', blocked);
  const head = existing(['api', `repos/${REPO}/pulls/${d.number}`], deadline);
  if (head.head?.sha !== d.sha || head.base?.ref !== d.base || head.head?.ref !== d.branch || head.state !== 'open' || head.draft !== false) return hold('identity-changed', 'PR changed immediately before merge');
  const result = existing(['api', '-X', 'PUT', `repos/${REPO}/pulls/${d.number}/merge`, '-f', `sha=${d.sha}`, '-f', `merge_method=${MERGE.method}`], deadline);
  if (result.merged !== true) return hold('merge-restricted', 'GitHub refused SHA-guarded merge');
  return observeDelivery(d, deadline);
}
