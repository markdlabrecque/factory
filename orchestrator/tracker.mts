import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { TRACKER } from "./config.mts";
import type { Note } from "./graph.mts";

// Tracker adapter: every tracker call the ticket graph needs. GitLab via `glab` for now; a GitHub
// version would implement the same functions with `gh`.

export interface Ticket {
  iid: number;
  title: string;
  description: string;
  state?: string;
}

const HOST = TRACKER.gitlabHost;
const ID = TRACKER.projectId;
const enc = encodeURIComponent;

function glab(args: string[]): string {
  return execFileSync("glab", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 64 * 1024 * 1024 }).trim();
}
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
  return apiAll<Ticket>(`projects/${ID}/issues?state=opened${filter}`).map((t) => ({ iid: t.iid, title: t.title, description: t.description ?? "" }));
}

export function ticket(iid: number): Ticket {
  const t = api<Ticket>(`projects/${ID}/issues/${iid}`);
  return { iid: t.iid, title: t.title, description: t.description ?? "", state: t.state };
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

export function addLabel(iid: number, label: string): void {
  glab(["issue", "update", String(iid), "-R", TRACKER.project, "--label", label]);
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
    console.error(`Missing label(s) in ${TRACKER.project}: ${list}. Run this once from a terminal to create them, or change LABELS in config.mts.`);
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
