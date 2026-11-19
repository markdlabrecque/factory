// Selected-runtime stopped-run diagnosis: bounded read-only evidence and Pi advice, host-owned cache and managed tracker escalation.
// Import-safe policy with injected I/O. Never prepares, admits, charges, verifies or repairs a run.
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, constants, existsSync, fstatSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, realpathSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { RunState } from '../board/board.mts';
import { SANDCASTLE_MARK, type Note } from './graph.mts';
import { piAnalysisArgs } from './models.mts';
import { sanitizeReply } from './no-commit.mts';
import { projectLayoutPaths } from './project-layout.mts';
import { freezeTicketInput, TicketInputHold, type FrozenTicketInput } from './ticket-input.mts';
import { hasFields, isStopKey, isTriageText, parseTriageAdvice, stopKey, TRIAGE_MODEL_LIMIT, unavailable, validTriageAdvice,
  type Delivery, type TriageAdvice, type TriageResult } from './recovery-triage-contract.mts';

export const BUNDLE_BYTES = 128 * 1024;
export const BUNDLE_FILES = 32;
const SECTION_BYTES = 32 * 1024;
const OMITTED_BYTES = 12 * 1024;
const SCAN_LIMIT = 256;
const TRACKER_TIMEOUT = 20_000;
const PROMPT_BYTES = 8 * 1024;
const branchName = (s: unknown, iid: string): s is string => typeof s === 'string' && s.startsWith(`${iid}-`) && /^[\w./-]+$/.test(s) && !s.includes('..');
const executionName = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(s);
const sha = (s: unknown): s is string => typeof s === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(s);
const markerFor = (key: string) => `<!-- factory-recovery-triage:${key} -->`;
class TriageTimeout extends Error {}

type Saved = { version: 1; key: string } & ({ state: 'unavailable'; reason: string } |
  { state: 'repair'; advice: TriageAdvice } | { state: 'human'; advice: TriageAdvice; delivery: Delivery });
function validSaved(value: unknown): value is Saved {
  const s = value as Record<string, unknown> | null | undefined;
  const fields = ['version', 'key', 'state'];
  if (s?.version !== 1 || !isStopKey(s.key)) return false;
  if (s.state === 'unavailable') return hasFields(s, [...fields, 'reason']) && isTriageText(s.reason);
  if (s.state === 'repair') return hasFields(s, [...fields, 'advice']) && validTriageAdvice(s.advice) && s.advice.action.kind === 'repair';
  return s.state === 'human' && hasFields(s, [...fields, 'advice', 'delivery']) && validTriageAdvice(s.advice) &&
    s.advice.action.kind !== 'repair' && (s.delivery === 'pending' || s.delivery === 'delivered');
}

// Render model text as inert prose; it cannot add managed markers, raw HTML, images or mentions.
const prose = (s: string) => sanitizeReply(s).replace(/[<>&@]/g, c => ({ '<': '＜', '>': '＞', '&': '＆', '@': '＠' })[c]!)
  .replace(/[\\`*_\[\]~]/g, '\\$&');
export function escalationComment(advice: TriageAdvice, key: string, label: string): string {
  const { kind, ...detail } = advice.action;
  const related = advice.relatedTickets.map(n => `#${n}`).join(', ');
  return [`## Factory recovery triage`, `**Cause (${advice.classification}):** ${prose(advice.cause)}`, `**Rationale:** ${prose(advice.rationale)}`,
    `**Recommended next step:** ${kind}\n${Object.entries(detail).map(([name, value]) => `- **${name}:** ${prose(value)}`).join('\n')}`,
    ...(related ? [`**Related tickets:** ${related}`] : []), 'No repair attempt was started and no recovery budget was spent.',
    `Removing the **${prose(label)}** label lets Factory try a repair.`, markerFor(key), SANDCASTLE_MARK].join('\n\n');
}

export interface TriageDeps {
  project: string; ticket: number; base: string; model: string; prompt: string; needsHuman: string;
  run(): RunState | undefined;
  tip(branch: string): string;
  input(): Pick<FrozenTicketInput, 'text' | 'hash'>;
  saved(): unknown; // undefined only when absent; read errors must throw
  save(result: Saved): void;
  bundle(run: RunState, tip: string, input: string): string;
  modelCall(bundle: string): string;
  hasLabel(): boolean;
  addLabel(): void;
  notes(): Note[];
  comment(body: string): void;
}
function snapshot(d: TriageDeps) {
  const run = d.run();
  if (run?.stage !== 'stopped' || run.project !== d.project || run.iid !== String(d.ticket) || !executionName(run.executionId) ||
    !branchName(run.branch, run.iid) || run.base !== d.base || typeof run.stageSince !== 'string' || !run.stageSince ||
    (run.note !== undefined && typeof run.note !== 'string')) throw Error('No matching stopped run with a saved execution, branch and base');
  const input = d.input(), current = d.run();
  const material = (r: RunState) => JSON.stringify([r.project, r.iid, r.executionId, r.stage, r.stageSince, r.note, r.branch, r.base]);
  if (!current || material(current) !== material(run)) throw Error('Stopped run changed while collecting ticket input');
  const tip = d.tip(run.branch);
  if (!sha(tip)) throw Error('Saved branch tip is unavailable');
  return { run, input, tip, key: stopKey({ project: d.project, ticket: d.ticket, executionId: run.executionId,
    stage: run.stage, stageSince: run.stageSince, note: run.note, tip, inputHash: input.hash, prompt: d.prompt, model: d.model }) };
}

/** Caller holds a per-ticket lock across cache, model and delivery. A durable reservation survives interruption. */
export function triageRecovery(d: TriageDeps): TriageResult {
  let key: string | null = null, fresh = false, current: ReturnType<typeof snapshot>;
  try { current = snapshot(d); key = current.key; }
  catch (e) { return unavailable(e instanceof TicketInputHold ? 'Ticket input could not be frozen' : 'Stopped run or ticket input could not be confirmed'); }
  try {
    const saved = d.saved();
    if (saved !== undefined && !validSaved(saved)) return unavailable('Saved recovery triage result is malformed; preserved', key);
    let result = saved as Saved | undefined;
    if (result?.key !== key) {
      const bundle = d.bundle(current.run, current.tip, current.input.text);
      if (Buffer.byteLength(bundle) > BUNDLE_BYTES) return unavailable('Recovery triage evidence exceeds the byte limit', key);
      d.save({ version: 1, key, state: 'unavailable', reason: 'Recovery triage call was interrupted or its inputs changed' });
      let advice: TriageAdvice | undefined, reason = 'Recovery triage model call failed';
      fresh = true;
      try {
        const reply = d.modelCall(bundle);
        reason = 'Recovery triage model result was malformed';
        advice = parseTriageAdvice(reply);
      } catch (e) {
        // Cache the failure without copying untrusted model or process text into stdout.
        if (e instanceof TriageTimeout) reason = 'Recovery triage model call timed out';
      }
      try {
        if (snapshot(d).key !== key) return unavailable('Recovery triage inputs changed during the model call', key, fresh);
      } catch { return unavailable('Recovery triage inputs could not be reconfirmed after the model call', key, fresh); }
      result = !advice ? { version: 1, key, state: 'unavailable', reason } : advice.action.kind === 'repair' ?
        { version: 1, key, state: 'repair', advice } : { version: 1, key, state: 'human', advice, delivery: 'pending' };
      d.save(result);
    }
    const common = { version: 1 as const, fresh, key };
    if (result.state === 'unavailable') return unavailable(result.reason, key, fresh);
    if (result.state === 'repair') return { ...common, state: 'repair', reason: 'Triage recommends a repair' };
    const { advice } = result;
    if (advice.action.kind === 'repair') return unavailable('Invalid saved escalation', key, fresh);
    const human = { ...common, state: 'human' as const, action: advice.action.kind, cause: sanitizeReply(advice.cause) || 'Cause not available' };
    let delivery = result.delivery;
    if (delivery === 'delivered') {
      if (!d.hasLabel()) return { ...common, state: 'released', reason: 'The needs-human label was removed after escalation' };
    } else {
      try {
        d.addLabel();
        if (!d.notes().some(n => n.body.split(/\r?\n/).includes(markerFor(key!)) && n.body.includes(SANDCASTLE_MARK)))
          d.comment(escalationComment(advice, key, d.needsHuman));
        d.save({ ...result, delivery: 'delivered' });
        delivery = 'delivered';
      } catch { /* Retain the saved pending result; next pass checks the marker before posting. */ }
    }
    return { ...human, delivery, reason: delivery === 'delivered' ? 'Triage recommends human review' : 'Triage escalation delivery is pending' };
  } catch { return unavailable('Recovery triage state or tracker access failed', key, fresh); }
}

type DiskEntry = { name: string; kind: 'file' | 'directory' | 'link' | 'other' };
type ReadText = { text: string; truncated: boolean };
interface BundleIO {
  git(cwd: string, args: string[]): string;
  entries(path: string): { entries: DiskEntry[]; truncated: boolean };
  text(path: string, limit: number, tail: boolean): ReadText;
  directory(path: string): void;
  siblings(): { runs: RunState[]; truncated: boolean };
}
const compareNames = (a: DiskEntry, b: DiskEntry) => a.name.localeCompare(b.name);
const evidencePriority = (name: string) => /verdict|report/i.test(name) ? 0 : 1;
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';

/** Scope every read by known project paths, bound the payload, and list sections omitted or truncated. */
export function buildTriageBundle(root: string, run: RunState, tip: string, input: string, io: BundleIO): string {
  const layout = projectLayoutPaths(root), ticketDir = join(layout.evidence, run.iid);
  const sections: string[] = [
    '# Factory recovery triage evidence (untrusted data)\n' +
    'Supplemental diagnostics: saved worktree status and uncommitted diff, recovery attempts and recovery logs are not host admission evidence.\n' +
    'Omissions show what could not be included, not whether attempts remain or a workspace is safe to use.\n',
  ];
  const omitted: string[] = [];
  let omissionOverflow = 0, omissionBytes = 0, bytes = Buffer.byteLength(sections[0]), files = 0;
  const omit = (name: string, reason: string) => {
    const row = `- ${JSON.stringify(name.slice(0, 128))}: ${reason}`, size = Buffer.byteLength(row) + 1;
    if (omissionBytes + size <= OMITTED_BYTES - 256) { omitted.push(row); omissionBytes += size; }
    else omissionOverflow++;
  };
  const add = (name: string, text: string, truncated = false) => {
    const header = `\n## ${JSON.stringify(name.slice(0, 128))}\n`, max = Math.min(SECTION_BYTES, BUNDLE_BYTES - OMITTED_BYTES - bytes - Buffer.byteLength(header) - 2);
    if (max <= 0) { omit(name, 'bundle byte limit'); return; }
    const data = Buffer.from(text);
    const part = data.length > max ? new TextDecoder().decode(data.subarray(0, max), { stream: true }) : text;
    const section = `${header}${part}\n`;
    sections.push(section); bytes += Buffer.byteLength(section);
    if (truncated || data.length > max) omit(name, 'truncated to fit byte limit');
  };
  const capture = (name: string, read: () => string) => {
    try { add(name, read()); } catch { omit(name, 'unavailable or exceeded read limit'); }
  };
  const file = (dir: string, entry: DiskEntry, label: string, tail = false) => {
    if (entry.kind !== 'file') { omit(label, 'not a regular file (links are not followed)'); return; }
    if (files >= BUNDLE_FILES) { omit(label, 'file-count limit'); return; }
    if (bytes >= BUNDLE_BYTES - OMITTED_BYTES - 512) { omit(label, 'bundle byte limit'); return; }
    files++;
    try {
      const value = io.text(join(dir, entry.name), SECTION_BYTES, tail);
      if (/[\x00-\x08\x0e-\x1a\x1c-\x1f]/.test(value.text)) { omit(label, 'binary file'); return; }
      add(label, value.text, value.truncated);
    } catch { omit(label, 'missing, binary, unreadable or symlink'); }
  };
  const list = (dir: string, label: string): DiskEntry[] => {
    try {
      const listed = io.entries(dir);
      if (listed.truncated) omit(label, 'directory scan limit; additional entries not inspected');
      return listed.entries.filter(e => e.name === basename(e.name) && !['.', '..'].includes(e.name));
    } catch { omit(label, 'missing, unreadable or symlink directory'); return []; }
  };
  add('saved run record', JSON.stringify(run, null, 2));
  add('frozen ticket context', input);
  if (sha(run.implementationBaseSha)) {
    const base = run.implementationBaseSha;
    capture('commits from recorded base', () => io.git(root, ['log', '--format=%h %s', '--no-show-signature', `${base}..${tip}`, '--']));
    capture('diff from recorded base', () => io.git(root, ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', base, tip, '--']));
  } else omit('commits and diff from recorded base', 'historical base commit not recorded');
  if (branchName(run.branch, run.iid)) {
    const worktree = join(layout.worktrees, run.branch.replaceAll('/', '-'));
    try {
      io.directory(worktree);
      // Require Git's own registration of this exact, canonical Factory worktree before reading its working files.
      const records = io.git(root, ['worktree', 'list', '--porcelain', '-z']).split('\0\0').map(r => r.split('\0'));
      if (!records.some(r => r[0] === `worktree ${worktree}` && r.includes(`branch refs/heads/${run.branch}`) && r.includes(`HEAD ${tip}`))) throw Error('worktree identity');
      capture('saved worktree status', () => io.git(worktree, ['status', '--porcelain=v1', '--untracked-files=normal', '--ignore-submodules=all']));
      capture('saved worktree uncommitted diff', () => io.git(worktree, ['diff', '--no-ext-diff', '--no-textconv', '--ignore-submodules=all', tip, '--']));
    } catch { omit('saved worktree status and uncommitted diff', 'missing, unreadable, symlink or unconfirmed worktree'); }
    const logs = list(layout.logs, 'ticket logs').sort(compareNames);
    for (const name of [`run-${run.iid}.log`, `${run.branch}-implementer`, `${run.branch}-verifier`, `recover-${run.iid}.log`]) {
      const matches = logs.filter(e => e.name === name || (!name.endsWith('.log') && e.name.startsWith(name) && e.name.endsWith('.log')));
      if (!matches.length) omit(name, 'log not found');
      for (const entry of matches) file(layout.logs, entry, entry.name, true);
    }
  }
  if (executionName(run.executionId)) {
    const recoveryDir = join(ticketDir, 'recovery');
    const folders = [{ dir: join(ticketDir, run.executionId), label: 'saved execution' }];
    const attempts = list(recoveryDir, 'recovery attempts').sort(compareNames);
    if (attempts.length > BUNDLE_FILES) omit('recovery attempts', 'additional attempt directories exceeded the scan limit');
    for (const e of attempts.slice(0, BUNDLE_FILES)) {
      if (e.kind === 'directory' && executionName(e.name)) folders.push({ dir: join(recoveryDir, e.name), label: `recovery attempt ${e.name}` });
      else omit(`recovery attempt ${e.name}`, 'not an execution directory');
    }
    const entries = folders.flatMap(({ dir, label }) => list(dir, label).sort(compareNames)
      .map(entry => ({ dir, entry, label: `${label}/${entry.name}` })));
    for (const e of entries.sort((a, b) => evidencePriority(a.entry.name) - evidencePriority(b.entry.name))) file(e.dir, e.entry, e.label);
  }
  try {
    const siblings = io.siblings();
    const stopped = siblings.runs.filter(r => r?.project === run.project && r.iid !== run.iid && r.stage === 'stopped' && /^\d+$/.test(r.iid) && typeof r.note === 'string')
      .sort((a, b) => String(b.stageSince).localeCompare(String(a.stageSince)));
    if (siblings.truncated || stopped.length > 10) omit('other stopped runs', 'only up to ten notes from the bounded run scan');
    if (stopped.length) add('other stopped runs', stopped.slice(0, 10).map(r => `#${r.iid}: ${r.note!.slice(0, 512)}`).join('\n'));
    if (stopped.slice(0, 10).some(r => r.note!.length > 512)) omit('other stopped runs', 'long notes truncated');
  } catch { omit('other stopped runs', 'run notes could not be read'); }
  return sections.join('') + `\n## Omitted or truncated\n${omitted.join('\n') || 'None'}\n${omissionOverflow ? `- ${omissionOverflow} more omissions\n` : ''}`;
}

function noLinks(path: string): void {
  if (realpathSync(path) !== path) throw Error('Symlink path');
}
function ensureDirectory(path: string): void {
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  noLinks(path);
}
function diskEntries(path: string): ReturnType<BundleIO['entries']> {
  noLinks(path);
  const dir = opendirSync(path), entries: DiskEntry[] = [];
  try {
    for (let e; (e = dir.readSync());) {
      if (entries.length === SCAN_LIMIT) return { entries, truncated: true };
      entries.push({ name: e.name, kind: e.isSymbolicLink() ? 'link' : e.isFile() ? 'file' : e.isDirectory() ? 'directory' : 'other' });
    }
    return { entries, truncated: false };
  } finally { dir.closeSync(); }
}
function diskText(path: string, limit: number, tail: boolean): ReadText {
  noLinks(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw Error('Not a regular file');
    const bytes = Buffer.alloc(Math.min(st.size, limit));
    let count = 0, n: number;
    const offset = tail ? Math.max(0, st.size - limit) : 0;
    while (count < bytes.length && (n = readSync(fd, bytes, count, bytes.length - count, offset + count))) count += n;
    let start = 0;
    if (offset) while (start < Math.min(count, 3) && (bytes[start] & 0xc0) === 0x80) start++;
    const truncated = st.size > limit;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, count), { stream: truncated && !tail });
    return { text, truncated };
  } finally { closeSync(fd); }
}

function readGit(cwd: string, args: string[], config: string[] = []): string {
  return execFileSync('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', ...config, ...args], {
    cwd, encoding: 'utf8', timeout: 20_000, killSignal: 'SIGKILL', maxBuffer: 128 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' },
  });
}
function bundleGit(root: string, cwd: string, args: string[]): string {
  if (cwd === root) return readGit(cwd, args);
  // Worktree Git can otherwise execute a repository-configured clean/process filter while reading a file.
  const keys = readGit(cwd, ['config', '--name-only', '--null', '--list']).split('\0');
  const drivers = new Set(keys.flatMap(k => /^filter\.(.+)\.(clean|process|required)$/.exec(k)?.[1] ?? []));
  const config = [...drivers].flatMap(d => ['-c', `filter.${d}.clean=`, '-c', `filter.${d}.process=`, '-c', `filter.${d}.required=false`]);
  return readGit(cwd, args, config);
}
export function triagePiArgs(model: string, env: NodeJS.ProcessEnv, exists: (path: string) => boolean): string[] {
  const argv = piAnalysisArgs(model, env, exists);
  argv.splice(argv.indexOf('--tools'), 2, '--no-tools');
  return argv;
}

async function main(): Promise<TriageResult> {
  const [ticketText, base, ...rest] = process.argv.slice(2), ticket = Number(ticketText);
  if (rest.length || !/^[1-9]\d*$/.test(ticketText ?? '') || !Number.isSafeInteger(ticket) || !base ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(base) || base.includes('..')) return unavailable('Expected numeric ticket and recorded base');
  const runtime = await import('./runtime-config.mts');
  const { retainRuntime } = await import('./context.mts');
  const { claimManagedEntry, releaseManagedEntry, keyFor, withAdmissionLock, writeDurable } = await import('./admission.mts');
  const { context, TRACKER, GRAPH, LABELS } = runtime;
  const { sharedState, projectRoot: root } = context;
  const project = TRACKER.project, entry = claimManagedEntry(sharedState, { root,
    tracker: { kind: TRACKER.kind, host: TRACKER.gitlabHost ?? TRACKER.host!, project } });
  try {
    await retainRuntime(context);
    const tracker = await import('./tracker.mts');
    const deadline = <T,>(fn: () => T): T => {
      tracker.setDeliveryDeadline(Date.now() + TRACKER_TIMEOUT);
      try { return fn(); } finally { tracker.setDeliveryDeadline(undefined); }
    };
    const prompt = context.templates['prompt.triage.md'];
    if (!prompt || Buffer.byteLength(prompt) > PROMPT_BYTES) return unavailable('Selected recovery triage prompt is missing or oversized');
    const runKey = keyFor(String(ticket), project), triageDir = join(sharedState, 'recovery', 'triage'), file = join(triageDir, `${runKey}.json`);
    const parseDisk = (path: string, limit: number) => {
      const data = diskText(path, limit, false);
      if (data.truncated) throw Error('Oversize state');
      return JSON.parse(data.text);
    };
    // Scope the lock separately from admission so a long model call never holds the global admission lock.
    // Do not create or write triage state through an alias into project/evidence paths.
    const lockRoot = join(triageDir, runKey);
    for (const dir of [join(sharedState, 'recovery'), triageDir, lockRoot, join(lockRoot, 'admission')]) ensureDirectory(dir);
    return withAdmissionLock(lockRoot, () => triageRecovery({
      project, ticket, base, model: GRAPH.model, prompt, needsHuman: LABELS.needsHuman,
      run: () => { context.assertCurrent(); return parseDisk(join(sharedState, `${runKey}.json`), 256 * 1024); },
      tip: branch => readGit(root, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`]).trim(),
      input: () => {
        const source = tracker.contextSource;
        return freezeTicketInput({ ...source, ticket: (iid, b) => source.ticket(iid, { ...b, timeoutMs: Math.min(b.timeoutMs, TRACKER_TIMEOUT) }),
          notes: (iid, page, b) => source.notes(iid, page, { ...b, timeoutMs: Math.min(b.timeoutMs, TRACKER_TIMEOUT) }),
          parentOf: (iid, b) => source.parentOf(iid, { ...b, timeoutMs: Math.min(b.timeoutMs, TRACKER_TIMEOUT) }) }, ticket);
      },
      saved: () => {
        // lstat distinguishes a missing file from a dangling link and a file lost after discovery.
        try { lstatSync(file); } catch (e) { if (missing(e)) return undefined; throw e; }
        return parseDisk(file, 2 * TRIAGE_MODEL_LIMIT);
      },
      save: result => writeDurable(file, JSON.stringify(result) + '\n'),
      bundle: (run, tip, input) => buildTriageBundle(root, run, tip, input, {
        git: (cwd, args) => bundleGit(root, cwd, args), entries: diskEntries, directory: noLinks, text: diskText,
        siblings: () => {
          const listed = diskEntries(sharedState), runs: RunState[] = [];
          for (const sibling of listed.entries) {
            if (sibling.kind !== 'file' || !sibling.name.startsWith(keyFor('', project)) || !sibling.name.endsWith('.json') || sibling.name === `${runKey}.json`) continue;
            try { runs.push(parseDisk(join(sharedState, sibling.name), 256 * 1024)); } catch { listed.truncated = true; }
          }
          return { runs, truncated: listed.truncated };
        },
      }),
      modelCall: bundle => {
        const argv = triagePiArgs(GRAPH.model, process.env, existsSync);
        const p = spawnSync('pi', argv, { cwd: context.runtimeRoot, encoding: 'utf8', input: `${prompt}\n${bundle}`,
          timeout: GRAPH.analysisTimeoutMinutes * 60_000, maxBuffer: TRIAGE_MODEL_LIMIT, killSignal: 'SIGKILL' });
        if ((p.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') throw new TriageTimeout();
        if (p.error || p.status !== 0) throw Error('Pi triage failed');
        return p.stdout;
      },
      hasLabel: () => deadline(() => (tracker.ticket(ticket).labels ?? []).includes(LABELS.needsHuman)),
      addLabel: () => deadline(() => tracker.addLabel(ticket, LABELS.needsHuman)),
      notes: () => deadline(() => tracker.notes(ticket)),
      comment: body => deadline(() => tracker.comment(ticket, body)),
    }), 0);
  } finally { releaseManagedEntry(sharedState, entry); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log = (...args) => console.error(...args);
  main().catch(() => unavailable('Selected recovery triage runtime, admission or state is unavailable'))
    .then(result => process.stdout.write(JSON.stringify(result) + '\n'));
}
