// Structured context reads use collector-owned deadlines/output bounds, independent of delivery state.
// #153: existing MR continuation reads exact-head pipeline/jobs and performs no create/post/rerun/draft mutation.
// #137: validated TOML selection; confidential=false is explicitly non-confidential, not unrestricted.
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { LABELS, MERGE, TRACKER } from "./runtime-config.mts";
import { ciGate, missingChecks } from "./ci.mts";
import { commandContextSource } from './ticket-context-source.mts';
import type { Child, Note } from "./graph.mts";
import type { Delivered, Delivery, DeliveryIdentity, DeliveryObservation, MergedPr, ReadyTicket, Select, Ticket } from "./tracker.mts";

// GitLab adapter for tracker.mts, via `glab` on the host. Units of work can be GitLab Tasks (the
// "Child items" on an issue). Manual delivery waits for branch CI. Auto delivery opens an MR first,
// gates its head pipeline and required jobs on the pushed SHA, then merges with a SHA guard.
// mergedPr: the newest merged MR into the base from the run's branch, else one titled `#N: ...`.
// readyList reads every page of ready tickets (#135).
// postVerification preserves GitLab's upload-then-comment flow, shared by normal and recovery runs.

// Cast: the shipped config.personal.mts (GitHub) has no GitLab fields, and this module still loads there.
const { gitlabHost: HOST = "", projectId: ID = 0 } = TRACKER as { gitlabHost?: string; projectId?: number };
const enc = encodeURIComponent;

/** Bounded structured ticket/notes/parentOf contract for ticket-context.mts. Retains Task-only hierarchy. */
export const contextSource = commandContextSource({ kind: 'gitlab', host: HOST, project: TRACKER.project }, ID);

let deliveryDeadline: number | undefined;
export function setDeliveryDeadline(deadline: number | undefined): void { deliveryDeadline = deadline; }
function deliveryTimeout(): number | undefined {
  if (deliveryDeadline === undefined) return undefined;
  const left = deliveryDeadline - Date.now(); if (left <= 0) throw Error('delivery deadline');
  return Math.min(10000, left);
}
function glab(args: string[], input?: string): string {
  return execFileSync("glab", args, { encoding: "utf8", timeout: deliveryTimeout(), killSignal: 'SIGKILL', env: { ...process.env, GITLAB_HOST: HOST }, input, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 }).trim();
}

export const currentUsername = () => JSON.parse(glab(['api', 'user', '--hostname', HOST])).username as string;
export const ticketUrl = (iid: number | string) => `https://${HOST}/${TRACKER.project}/-/issues/${iid}`;
const api = <T,>(path: string): T => JSON.parse(glab(["api", path, "--hostname", HOST]));
/** GET every page of a list endpoint (100 per page). */
function apiAll<T>(path: string): T[] {
  const all: T[] = [];
  for (let page = 1; ; page++) {
    const batch = api<T[]>(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) return all;
  }
}

/** Open tickets the graph can name as blockers: the milestone's, or the whole project's when none is set. */
export function catalogue(milestone = TRACKER.milestone): Ticket[] {
  const filter = milestone ? `&milestone=${enc(milestone)}` : "";
  return apiAll<Ticket>(`projects/${ID}/issues?state=opened${filter}`).map(slim);
}
const slim = (t: Ticket): Ticket => ({ iid: t.iid, title: t.title, description: t.description ?? "", state: t.state, labels: t.labels ?? [], assignees: t.assignees, author: t.author, milestone: t.milestone, issue_type: t.issue_type, confidential: t.confidential });

/** Open tickets by iid, whatever their milestone. */
function openTickets(iids: number[]): Ticket[] {
  const out: Ticket[] = [];
  for (let i = 0; i < iids.length; i += 50) {
    const q = iids.slice(i, i + 50).map((n) => `iids[]=${n}`).join("&");
    out.push(...apiAll<Ticket>(`projects/${ID}/issues?state=opened&${q}`).map(slim));
  }
  return out;
}

function gql<T>(query: string): T {
  const out = JSON.parse(glab(["api", "graphql", "--hostname", HOST, "-f", `query=${query}`]));
  if (out.errors?.length) throw new Error(`GitLab GraphQL: ${out.errors.map((e: { message: string }) => e.message).join("; ")}`);
  return out.data;
}
type Hierarchy = { iid: string; workItemType: { name: string }; widgets: { parent?: { iid: string } | null; children?: { nodes: { iid: string; state: string; workItemType: { name: string } }[] } }[] };
function hierarchy(iids: number[]): Hierarchy[] {
  const out: Hierarchy[] = [];
  for (let i = 0; i < iids.length; i += 50) {
    const list = iids.slice(i, i + 50).map((n) => JSON.stringify(String(n))).join(",");
    const data = gql<{ project: { workItems: { nodes: Hierarchy[] } } }>(
      `{ project(fullPath: ${JSON.stringify(TRACKER.project)}) { workItems(iids: [${list}], first: 50) { nodes { iid workItemType { name } widgets { ... on WorkItemWidgetHierarchy { parent { iid } children(first: 100) { nodes { iid state workItemType { name } } } } } } } } }`,
    );
    out.push(...data.project.workItems.nodes);
  }
  return out;
}

/** Each issue's Tasks, in board order. Issues without Tasks are left out. */
export function children(iids: number[]): Map<number, Child[]> {
  const map = new Map<number, Child[]>();
  for (const w of hierarchy(iids)) {
    const kids = w.widgets.flatMap((x) => x.children?.nodes ?? []).filter((k) => k.workItemType.name === "Task");
    if (kids.length) map.set(Number(w.iid), kids.map((k) => ({ iid: Number(k.iid), open: k.state === "OPEN" })));
  }
  return map;
}

/** The issue a Task belongs to; undefined for anything that isn't a Task with a parent. */
export function parentOf(iid: number): number | undefined {
  const w = hierarchy([iid])[0];
  if (w?.workItemType.name !== "Task") return undefined;
  const p = w.widgets.find((x) => x.parent)?.parent;
  return p ? Number(p.iid) : undefined;
}

/**
 * The tickets the graph and the implementer see. With subtasks, issues that have Tasks are replaced
 * by their open Tasks (which may sit outside the milestone), each carrying its parent's text.
 */
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
  const t = api<Ticket>(`projects/${ID}/issues/${iid}`);
  return slim(t);
}

/** The ticket with its comments, as text for the agents' prompts. */
export function viewText(iid: number): string {
  return glab(["issue", "view", String(iid), "-R", TRACKER.project, "--comments"]);
}

/** Open tickets carrying every ready label and no exclude label, filtered by `select`. Reads every page, so a
 * ticket past the first 100 is not mistaken for deselected and hidden from the board (#135). */
export function readyList(select: Select = {}): ReadyTicket[] {
  const args = ["issue", "list", "-R", TRACKER.project, "--per-page", "100", "--output", "json"];
  if (select.order) args.push("--order", select.order);
  if (select.sort) args.push("--sort", select.sort);
  if (LABELS.ready.length) args.push("--label", LABELS.ready.join(","));
  if (LABELS.exclude.length) args.push("--not-label", LABELS.exclude.join(","));
  if (TRACKER.milestone) args.push("--milestone", TRACKER.milestone);
  if (select.assignee) args.push("--assignee", select.assignee);
  if (select.author) args.push("--author", select.author);
  if (select.issueType) args.push("--issue-type", select.issueType);
  if (select.confidential === true) args.push('--confidential');
  if (select.search) args.push("--search", select.search);
  const all: ReadyTicket[] = [];
  for (let page = 1; ; page++) {
    const batch = JSON.parse(glab([...args, "--page", String(page)]) || "[]") as (ReadyTicket & { confidential?: boolean })[];
    // glab's boolean flag cannot express non-confidential-only reliably. Filter reliable API facts
    // after reading every page; missing facts fail closed rather than silently broaden eligibility.
    if (select.confidential === false && batch.some(t => typeof t.confidential !== 'boolean')) throw new Error('GitLab confidentiality facts missing; selection is unknown');
    all.push(...(select.confidential === false ? batch.filter(t => t.confidential === false) : batch));
    if (batch.length < 100) return all;
  }
}

export function comment(iid: number | string, body: string): void {
  glab(["issue", "note", String(iid), "-R", TRACKER.project, "-m", body]);
}

/** Upload media through GitLab's existing endpoint, then post the verification comment. */
export function postVerification(iid: string, tip: string, files: string[], body: (media: string[]) => string): void {
  comment(iid, body(uploadEvidence(iid, tip, files)));
}

/** Upload evidence files; returns the markdown for each, in order. */
function uploadEvidence(_iid: string, _tip: string, files: string[]): string[] {
  return files.map((f) => String(JSON.parse(glab(["api", `projects/${ID}/uploads`, "--hostname", HOST, "--form", `file=@${f}`])).markdown));
}

/**
 * Wait for the branch pipeline on the pushed tip, then open an MR into the base. A failed pipeline,
 * or one still running at the deadline, throws (pushed, no MR). If no pipeline appears within
 * `noCiMinutes`, the MR opens anyway and CI runs on it. Never merges.
 */
export async function deliver(d: Delivery & { waitMinutes: number; noCiMinutes: number; autoMerge: boolean }): Promise<Delivered> {
  if (d.autoMerge) return autoDeliver(d);
  d.onStage("ci");
  let status = "none";
  const deadline = Date.now() + d.waitMinutes * 60_000;
  const noPipelineBy = Date.now() + d.noCiMinutes * 60_000;
  while (Date.now() < deadline) {
    status = api<{ status: string }[]>(`projects/${ID}/pipelines?sha=${d.sha}&per_page=1`)[0]?.status ?? "none";
    if (["success", "failed", "canceled", "skipped"].includes(status)) break;
    if (status === "none" && Date.now() > noPipelineBy) break;
    await new Promise((r) => setTimeout(r, 15_000));
  }
  if (status === "failed" || status === "canceled") throw new Error(`CI ${status} on ${d.branch}. Pushed, but no MR opened.`);
  if (!["success", "none", "skipped"].includes(status)) throw new Error(`CI still ${status} after ${d.waitMinutes} min on ${d.branch}. Pushed, no MR opened.`);
  const out = glab([
    "mr", "create", "-R", TRACKER.project, "--source-branch", d.branch, "--target-branch", d.base, "--title", d.title,
    "--description", d.body(status === "success" ? "Branch CI passed before this MR was opened." : "No branch pipeline appeared; CI will run on this MR."),
    "--yes", "--no-editor",
  ]);
  console.log(out);
  const url = out.split(/\s+/).find(w => w.startsWith('http')) ?? '';
  const number = Number(url.match(/\/merge_requests\/(\d+)$/)?.[1]);
  if (Number.isSafeInteger(number) && number > 0 && url === `https://${HOST}/${TRACKER.project}/-/merge_requests/${number}`) d.onOpened?.({ kind: 'gitlab', host: HOST, repository: TRACKER.project, projectId: ID, number, url, branch: d.branch, base: d.base, sha: d.sha });
  else if (d.onOpened) throw Error('Unresolved MR creation identity; do not replay creation');
  return { url, merged: false };
}

/** #150: open first; same-SHA CI and fresh host authorization precede the SHA-guarded merge. */
async function autoDeliver(d: Delivery & { waitMinutes: number; noCiMinutes: number }): Promise<Delivered> {
  const path = `projects/${ID}/merge_requests`;
  const mr = JSON.parse(glab(["api", "-X", "POST", path, "--hostname", HOST,
    "-f", `source_branch=${d.branch}`, "-f", `target_branch=${d.base}`, "-f", `title=${d.title}`,
    "-f", `description=${d.body("Sandcastle merges only after the head pipeline and required jobs pass on the pushed commit.")}`,
  ])) as { iid: number; web_url: string };
  const url = mr.web_url;
  console.log(url);
  const identity: DeliveryIdentity = { kind: 'gitlab', host: HOST, repository: TRACKER.project, projectId: ID, number: mr.iid, url, branch: d.branch, base: d.base, sha: d.sha };
  if (!Number.isSafeInteger(mr.iid) || mr.iid < 1 || url !== `https://${HOST}/${TRACKER.project}/-/merge_requests/${mr.iid}`) throw Error('Unresolved MR creation identity; do not replay creation');
  d.onOpened?.(identity);
  d.onStage("ci");
  const block = (blocked: string): Delivered => {
    glab(["api", "-X", "POST", `${path}/${mr.iid}/notes`, "--hostname", HOST,
      "-f", `body=Sandcastle did not merge this MR: ${blocked}. Waiting for a person.`]);
    return { url, merged: false, blocked };
  };
  const deadline = Date.now() + d.waitMinutes * 60_000;
  const noPipelineBy = Date.now() + d.noCiMinutes * 60_000;
  let reason = "no pipeline on the pushed commit";
  while (Date.now() < deadline) {
    const observed = await mergeExistingDelivery(identity, d.beforeMerge);
    reason = observed.reason;
    if (observed.state === 'merged') return { url, merged: true, mergedAt: observed.mergedAt, state: 'merged', reasonCode: 'merged' };
    if (observed.state === 'operator-required' || Date.now() >= noPipelineBy && observed.reasonCode === 'checks-missing') return { ...block(reason), state: observed.state, reasonCode: observed.reasonCode };
    await new Promise((r) => setTimeout(r, 15_000));
  }
  return { ...block(`CI deadline reached after ${d.waitMinutes} min: ${reason}`), state: 'ci-waiting', reasonCode: 'checks-pending' };
}

function existing(path: string, deadline: number, fields?: string[]): any {
  const left = deadline - Date.now(); if (left <= 0) throw Error('delivery deadline');
  return JSON.parse(execFileSync('glab', ['api', ...(fields ? ['-X', 'PUT'] : []), path, '--hostname', HOST, ...(fields ?? [])], {
    encoding: 'utf8', env: { ...process.env, GITLAB_HOST: HOST }, timeout: Math.min(10000, left), killSignal: 'SIGKILL', maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'pipe'],
  }));
}
const hold = (reasonCode: DeliveryObservation['reasonCode'], reason: string): DeliveryObservation => ({ state: 'operator-required', reasonCode, reason });
export function observeDelivery(d: DeliveryIdentity, deadline = Date.now() + 30000): DeliveryObservation {
  if (!/^[0-9a-f]{40,64}$/.test(d.sha) || !d.branch || !d.base || d.kind !== 'gitlab' || d.host !== HOST || d.repository !== TRACKER.project || d.projectId !== ID || !Number.isSafeInteger(d.number) || d.number < 1 || d.url !== `https://${HOST}/${TRACKER.project}/-/merge_requests/${d.number}`) return hold('identity-changed', 'Unknown tracker identity');
  const mr = existing(`projects/${ID}/merge_requests/${d.number}`, deadline);
  if (mr.iid !== d.number || mr.project_id !== ID || mr.source_project_id !== ID || mr.target_project_id !== ID || mr.source_branch !== d.branch || mr.target_branch !== d.base || mr.sha !== d.sha) return hold('identity-changed', 'MR repository, branch, base or head changed');
  if (mr.state === 'merged' && typeof mr.merged_at === 'string' && Number.isFinite(Date.parse(mr.merged_at))) return { state: 'merged', reasonCode: 'merged', reason: 'Confirmed exact-head merge', mergedAt: mr.merged_at };
  if (mr.state === 'closed') return hold('closed', 'MR closed without merge');
  if (mr.state !== 'opened' || typeof mr.draft !== 'boolean') return hold('identity-changed', 'Unknown MR status');
  if (mr.draft) return hold('draft', 'MR is draft');
  if (mr.has_conflicts === true || ['conflict', 'not_approved', 'discussions_not_resolved', 'blocked_status', 'merge_request_blocked', 'need_rebase', 'external_status_checks'].includes(mr.detailed_merge_status)) return hold('merge-restricted', 'MR conflict, approval or repository restriction');
  const pipeline = mr.head_pipeline;
  if (!pipeline || pipeline.sha !== d.sha) return { state: 'ci-waiting', reasonCode: 'checks-missing', reason: 'No pipeline on exact head' };
  if (!Number.isSafeInteger(pipeline.id) || typeof pipeline.status !== 'string') return hold('identity-changed', 'Malformed pipeline identity');
  const jobs: any[] = [];
  for (let page = 1; ; page++) {
    const batch = existing(`projects/${ID}/pipelines/${pipeline.id}/jobs?include_retried=false&per_page=100&page=${page}`, deadline);
    if (!Array.isArray(batch)) throw Error('Malformed job response');
    if (batch.some(j => typeof j.name !== 'string' || typeof j.status !== 'string' || j.commit?.id !== d.sha)) return hold('identity-changed', 'Unknown job identity/head');
    jobs.push(...batch); if (batch.length < 100) break;
  }
  const checks = jobs.map(j => ({ name: j.name, bucket: j.status === 'success' ? 'pass' : j.status === 'skipped' ? 'skipping' : ['failed', 'canceled'].includes(j.status) ? 'fail' : 'pending' }));
  const gate = ciGate(checks, MERGE.requiredChecks ?? []);
  if (gate === 'fail' || ['failed', 'canceled', 'manual'].includes(pipeline.status)) return hold('checks-failed', 'Pipeline or job failed/cancelled/manual');
  if (pipeline.status === 'success' && gate === 'pass') {
    if (mr.detailed_merge_status !== 'mergeable') return hold('merge-restricted', 'MR merge permission unknown or restricted');
    return { state: 'ready', reasonCode: 'checks-pending', reason: 'Exact-head pipeline/jobs passed' };
  }
  return { state: 'ci-waiting', reasonCode: gate === 'none' ? 'checks-missing' : 'checks-pending', reason: `CI ${pipeline.status}; required jobs: ${missingChecks(checks, MERGE.requiredChecks ?? []).join(', ')}` };
}
export async function mergeExistingDelivery(d: DeliveryIdentity, beforeMerge: Delivery['beforeMerge'], deadline = Date.now() + 30000): Promise<DeliveryObservation> {
  const observed = observeDelivery(d, deadline);
  if (observed.state !== 'ready') return observed;
  if (!MERGE.auto) return hold('authorization', 'Manual merge policy');
  let refused: string | undefined;
  try { refused = typeof beforeMerge === 'function' ? await beforeMerge() : 'Host authorization missing'; }
  catch (e) {
    if ((e as any).code === 'DELIVERY_READ_UNKNOWN') return { state: 'ci-waiting', reasonCode: 'transport-unknown', reason: (e as Error).message };
    refused = `Host authorization unknown: ${(e as Error).message}`;
  }
  if (refused !== undefined) return hold('authorization', refused);
  const result = existing(`projects/${ID}/merge_requests/${d.number}/merge`, deadline, ['-f', `sha=${d.sha}`, '-F', `squash=${MERGE.method === 'squash'}`]);
  if (result.state !== 'merged') return hold('merge-restricted', 'GitLab did not confirm merge');
  return observeDelivery(d, deadline);
}

/** Comments, oldest first. */
export function notes(iid: number): Note[] {
  return apiAll<Note>(`projects/${ID}/issues/${iid}/notes?sort=asc&order_by=created_at`).map((n) => ({ body: n.body, system: n.system }));
}

/** Source branches of every open MR in the project. */
export function openMrBranches(): Set<string> {
  return new Set(apiAll<{ source_branch: string }>(`projects/${ID}/merge_requests?state=opened`).map((m) => m.source_branch));
}

export function mergedInto(branch: string, base: string): boolean {
  return api<unknown[]>(`projects/${ID}/merge_requests?state=merged&source_branch=${enc(branch)}&target_branch=${enc(base)}&per_page=1`).length > 0;
}

/** The newest MR merged into `base` from the run's branch, else one whose title starts with `#N:`. */
export function mergedPr(iid: number, branch: string | undefined, base: string): MergedPr | undefined {
  type Mr = { iid: number; title: string; web_url: string; merged_at: string | null };
  const list = (filter: string) => api<Mr[]>(`projects/${ID}/merge_requests?state=merged&target_branch=${enc(base)}&${filter}&per_page=100`);
  const pick = (mrs: Mr[], matchedBy: MergedPr["matchedBy"]) => mrs.map((m): MergedPr => ({ number: m.iid, title: m.title, url: m.web_url, mergedAt: m.merged_at ?? "", matchedBy }))
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))[0];
  // Search matches anywhere in the title, so the `#N:` prefix is checked here.
  return (branch ? pick(list(`source_branch=${enc(branch)}`), "branch") : undefined)
    ?? pick(list(`in=title&search=${enc(`#${iid}:`)}`).filter((m) => m.title.startsWith(`#${iid}:`)), "title");
}

export function addLabel(iid: number, label: string): void {
  glab(["issue", "update", String(iid), "-R", TRACKER.project, "--label", label]);
}

// REST rather than `glab issue`, which may not accept Tasks.
const put = (iid: number, fields: Record<string, string>) =>
  glab(["api", "-X", "PUT", `projects/${ID}/issues/${iid}`, "--hostname", HOST, ...Object.entries(fields).flatMap(([k, v]) => ["-f", `${k}=${v}`])]);

export function close(iid: number): void {
  put(iid, { state_event: "close" });
}

/** Move a ticket to the next stage: `LABELS.done` on, the ready labels off. It stays open. */
export function advance(iid: number): void {
  put(iid, { add_labels: LABELS.done, remove_labels: LABELS.ready.join(",") });
}

/**
 * Check every label exists in the project (group labels count). Offer to create missing ones when a
 * person is at the terminal; without one, or if they decline, exit.
 */
export async function ensureLabels(names: string[]): Promise<void> {
  const have = new Set(apiAll<{ name: string }>(`projects/${ID}/labels?include_ancestor_groups=true`).map((l) => l.name));
  const missing = names.filter((n) => !have.has(n));
  if (!missing.length) return;
  const list = missing.map((m) => `"${m}"`).join(", ");
  if (!process.stdin.isTTY) {
    console.error(`Missing label(s) in ${TRACKER.project}: ${list}. Run this once from a terminal to create them, or change labels in factory.toml (legacy: LABELS in config.mts).`);
    process.exit(1);
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (const name of missing) {
    const answer = (await rl.question(`Label "${name}" doesn't exist in ${TRACKER.project}. Create it? [y/N] `)).trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      rl.close();
      console.error(`Not creating "${name}". Sandcastle needs it; quitting.`);
      process.exit(1);
    }
    glab(["label", "create", "--name", name, "-R", TRACKER.project]);
    console.log(`Created label "${name}".`);
  }
  rl.close();
}
