import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { projectLayoutPaths } from './project-layout.mts';

// Shared bounded canonical regular-file reads protect project config/instructions and saved-layout JSON/receipts before project filtering.
// Receipt read errors never masquerade as an absent receipt; only ENOENT permits legacy adoption.
// #150: preserve the host-recorded implementation baseline with ownership identity.
// Ownership receipts (slice four, #75): what Factory itself created for a ticket, written before it creates anything, so
// a later repair can tell its own branch and worktree apart from anyone else's after a crash. One file per ticket,
// `<stateDir>/ownership/<projectId>/<iid>.json` (folders 0700, file 0600, temp file + fsync + rename), where
//   projectId = sha256(realpath(projectRoot) + "\0" + trackerKind + "\0" + trackerHost + "\0" + trackerProject)
// so two checkouts, or two trackers, never share receipts. A receipt holds the project root, its Git common directory,
// the ticket, branch, base, the canonical worktree path (`<root>/.factory/worktrees/<branch with / as ->`), the run
// that wrote it (a claim token or recovery attempt UUID) and `creationIntent`: which of the branch and worktree that run
// was about to create. The created identities are filled in as each step completes (`branchSha`, `worktreeAt`), so a
// receipt with an intent and no identity marks a crash between the two; the next reader reconciles it against Git
// (cli/src/recovery-workspace.mts) rather than guessing. main.mts writes one before a normal run creates its branch and
// worktree; the recovery launcher (cli/src/recovery-run.mts) writes one before it adds a missing worktree or creates a
// local branch from origin, and adopts a pre-upgrade run's exact branch. Receipts are never deleted by `factory retry`.
// Import-safe Node helpers ship beside main.mts in the complete immutable runtime, never in project scaffolds.

export type TrackerIdentity = { kind: string; host: string; project: string };
export interface Receipt {
  version: 1;
  projectId: string;
  projectRoot: string;
  gitCommonDir: string;
  ticket: string;
  branch: string;
  base?: string;
  worktreePath: string;
  runId: string;
  creationIntent: { branch: boolean; worktree: boolean; at: string };
  branchSha?: string;
  implementationBaseSha?: string;
  worktreeAt?: string;
  createdAt: string;
  updatedAt: string;
}

const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
export const projectId = (root: string, t: TrackerIdentity) =>
  createHash("sha256").update(`${real(root)}\0${t.kind}\0${t.host}\0${t.project}`).digest("hex");
export const receiptFile = (stateDir: string, id: string, iid: string) => join(stateDir, "ownership", id, `${iid}.json`);
/** Sandcastle's worktree for `branch`: <root>/.factory/worktrees/<branch with / as ->. */
export const canonicalWorktree = (root: string, branch: string) => join(projectLayoutPaths(real(root)).worktrees, branch.replaceAll("/", "-"));
/** Bounded canonical regular-file read for saved layout authority, including unrelated records and receipts.
 * Reject special files before opening; NOFOLLOW/NONBLOCK and descriptor checks also close substitution races. */
export function readLayoutRecord(file: string): string {
  return readBoundedText(file, 8 * 1024 * 1024, 'saved layout record');
}
/** Shared project-original reader: canonical regular files only, bounded before allocation and descriptor checked. */
export function readBoundedText(file: string, max: number, label: string): string {
  const initial = lstatSync(file);
  if (resolve(file) !== file || realpathSync(file) !== file || !initial.isFile())
    throw Error(`Unsafe ${label}: ${file}`);
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd), named = lstatSync(file);
    if (!before.isFile() || !named.isFile() || before.size > max || before.ino !== initial.ino || before.dev !== initial.dev || before.ino !== named.ino || before.dev !== named.dev || realpathSync(file) !== file)
      throw Error(`Unsafe/oversized ${label}: ${file}`);
    const bytes = Buffer.alloc(before.size + 1); let n = 0, count = 0;
    while ((count = readSync(fd, bytes, n, bytes.length - n, null)) > 0) {
      n += count; if (n > before.size) throw Error(`${label} grew while reading: ${file}`);
    }
    const after = fstatSync(fd), current = lstatSync(file);
    if (n !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
      || current.ino !== before.ino || current.dev !== before.dev || realpathSync(file) !== file)
      throw Error(`${label} changed while reading: ${file}`);
    const text = bytes.subarray(0,n).toString('utf8');
    if (!Buffer.from(text).equals(bytes.subarray(0,n)) || text.includes('\0')) throw Error(`Invalid ${label} text: ${file}`);
    return text;
  } finally { closeSync(fd); }
}
/** Reject explicit cross-layout saved authority before starting new work. Never rewrites historical records. */
export function assertProjectRecordLayout(state: string, root: string, tracker: TrackerIdentity): void {
  const layout = projectLayoutPaths(real(root));
  let names: string[];
  try { names = readdirSync(state); } catch (error) {
    // No record can be adopted through a non-directory state root. The mandatory host filesystem gate
    // owns its ENOTDIR diagnostic and refusal, including failure to publish a report. Other uncertainty holds here.
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
    throw error;
  }
  for (const name of names.filter(n => n.endsWith('.json'))) {
    let record: any;
    const raw = readLayoutRecord(join(state, name)); // Safety applies BEFORE project filtering, even for unrelated JSON.
    try { record = JSON.parse(raw); } catch { continue; } // Normal record readers retain schema authority.
    if (record.project !== tracker.project || typeof record.iid !== 'string') continue;
    if (record.evidenceDir !== undefined && typeof record.evidenceDir !== 'string')
      throw new Error('Saved run has unknown evidence identity; preserve it without adoption');
    if (typeof record.evidenceDir === 'string' && (resolve(record.evidenceDir) !== record.evidenceDir || record.evidenceDir !== layout.evidence && !record.evidenceDir.startsWith(`${layout.evidence}/`)))
      throw new Error('Saved run has uncertain or cross-layout evidence identity; preserve it without adoption');
    if (record.branch && !record.evidenceDir && !record.starting && !existsSync(canonicalWorktree(root, record.branch))) {
      const saved = readReceipt(receiptFile(state, projectId(root, tracker), record.iid));
      if (!saved || saved.worktreePath !== canonicalWorktree(root, record.branch))
        throw new Error('Saved run has no supported layout provenance; preserve it without adoption');
    }
  }
  const receipts = join(state, 'ownership', projectId(root, tracker));
  let files: string[];
  try { files = readdirSync(receipts); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  for (const name of files.filter(n => n.endsWith('.json'))) {
    const receipt = readReceipt(join(receipts, name));
    if (receipt && (receipt.projectId !== projectId(root, tracker) || receipt.ticket !== name.slice(0, -5) || receipt.projectRoot !== real(root) || receipt.worktreePath !== canonicalWorktree(root, receipt.branch)))
      throw new Error('Saved ownership has uncertain or cross-layout identity; preserve it without adoption');
  }
}

/** The checkout's Git common directory, resolved. */
export const gitCommonDir = (cwd: string) =>
  real(resolve(cwd, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()));

const str = (x: unknown) => typeof x === "string" && x.length > 0;
/** The receipt, `null` when there is none, or an error for an unreadable one (never repaired or replaced). */
export function readReceipt(file: string): Receipt | null {
  let d: any;
  try {
    d = JSON.parse(readLayoutRecord(file));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Ownership receipt ${file} is not valid JSON; Factory will not overwrite it.`);
  }
  const ok = d?.version === 1 && [d.projectId, d.projectRoot, d.gitCommonDir, d.ticket, d.branch, d.worktreePath, d.runId, d.createdAt, d.updatedAt].every(str)
    && (d.base === undefined || typeof d.base === "string") && typeof d.creationIntent?.branch === "boolean"
    && typeof d.creationIntent.worktree === "boolean" && str(d.creationIntent.at)
    && (d.implementationBaseSha === undefined || /^[0-9a-f]{40,64}$/.test(d.implementationBaseSha))
    && (d.branchSha === undefined || str(d.branchSha)) && (d.worktreeAt === undefined || str(d.worktreeAt));
  if (!ok) throw new Error(`Ownership receipt ${file} has an unsupported shape or version; Factory will not overwrite it.`);
  return d;
}

export function writeReceipt(file: string, r: Receipt): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify(r, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  try {
    const dfd = openSync(dirname(file), "r");
    try { fsyncSync(dfd); } finally { closeSync(dfd); }
  } catch {
    /* folder fsync unsupported here */
  }
}

/** Write the receipt for a ticket's branch and worktree before creating either. */
export function recordIntent(stateDir: string, o: { root: string; tracker: TrackerIdentity; ticket: string; branch: string; base?: string;
  runId: string; branchToCreate: boolean; worktreeToCreate: boolean; at?: string; branchSha?: string; worktreeAt?: string; implementationBaseSha?: string }): string {
  const id = projectId(o.root, o.tracker);
  const file = receiptFile(stateDir, id, o.ticket);
  const prior = readReceipt(file);
  if (prior && (prior.projectId !== id || prior.projectRoot !== real(o.root) || prior.worktreePath !== canonicalWorktree(o.root, prior.branch)))
    throw new Error('Ownership receipt has uncertain or cross-layout identity; refusing adoption or rewrite');
  if (prior?.implementationBaseSha && o.implementationBaseSha && prior.implementationBaseSha !== o.implementationBaseSha)
    throw new Error('Historical implementation baseline changed; refusing ownership rewrite');
  const baseline = o.implementationBaseSha ?? prior?.implementationBaseSha;
  const at = o.at ?? new Date().toISOString();
  writeReceipt(file, {
    ...(baseline ? { implementationBaseSha: baseline } : {}),
    version: 1, projectId: id, projectRoot: real(o.root), gitCommonDir: gitCommonDir(o.root), ticket: o.ticket, branch: o.branch,
    ...(o.base ? { base: o.base } : {}), worktreePath: canonicalWorktree(o.root, o.branch), runId: o.runId,
    creationIntent: { branch: o.branchToCreate, worktree: o.worktreeToCreate, at }, ...(o.branchSha ? { branchSha: o.branchSha } : {}),
    ...(o.worktreeAt ? { worktreeAt: o.worktreeAt } : {}), createdAt: at, updatedAt: at,
  });
  return file;
}

/** Fill in identities that now exist. Throws when there is no receipt to fill. */
export function fillReceipt(file: string, patch: Partial<Pick<Receipt, "branchSha" | "worktreeAt">>): Receipt {
  const r = readReceipt(file);
  if (!r) throw new Error(`No ownership receipt ${file} to fill in`);
  const next = { ...r, ...patch, updatedAt: new Date().toISOString() };
  writeReceipt(file, next);
  return next;
}
