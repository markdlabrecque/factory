// Data-only v2 project configuration. No project code, environment expansion or fallback.
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { ModelFamily } from './model-policy.mts';
import { parse } from './vendor/smol-toml/index.js';

export type Thinking = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type Selection = { assignee?: string; author?: string; search?: string; issueType?: string; confidential?: boolean;
  excludeAssignees: string[]; order: string; sort: string };
export type EffectiveConfig = {
  source: { mode: 'toml'; path: string }; sources: Record<string, 'explicit' | 'default'>; warnings: string[];
  TRACKER: { kind: 'github' | 'gitlab'; project: string; host?: string; gitlabHost?: string; projectId?: number; milestone?: string };
  AGENT: { family: ModelFamily };
  workflow: { mode: 'factory' | 'project'; directory?: string };
  instructions: Record<'common' | 'implementation' | 'verification' | 'analysis' | 'recovery', string[]>;
  LABELS: { ready: string[]; exclude: string[]; needsHuman: string; done: string };
  MERGE: { auto: boolean; method: 'merge' | 'squash' | 'rebase'; requiredChecks: string[] };
  SUBTASKS: { enabled: boolean };
  GRAPH: { maxAnalysesPerPass: number; analysisTimeoutMinutes: number; conflictIgnore: string[]; pruneAfterDays: number };
  selection: Selection; dispatch: { maxConcurrent: number; staggerSeconds: number };
  config: { image: string; ciWaitMinutes: number; noPipelineMinutes: number; sandboxSetup: { command: string; timeoutMs?: number; sudo: boolean }[] };
};
type Table = Record<string, any>;
/** Validate lexical repository-relative paths on both Unix and Windows. */
export function validateRelativePath(path: string): void {
  if (!path.trim() || path.includes('\0') || isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.includes('\\') || path.split('/').includes('..'))
    throw new Error('Expected a repository-relative path without parent traversal');
}
/** Resolve existing paths through symlinks and enforce containment in the canonical checkout. */
export function resolveCheckoutPath(checkout: string, path: string, kind: 'file' | 'directory'): string {
  validateRelativePath(path);
  const root = realpathSync(checkout);
  let target = root;
  for (const component of path.split('/')) {
    target = realpathSync(resolve(target, component));
    const rel = relative(root, target);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Path escapes checkout');
  }
  const stat = statSync(target);
  if (kind === 'file' ? !stat.isFile() : !stat.isDirectory()) throw new Error(`Expected ${kind}`);
  return target;
}
/** Missing, malformed and unreadable configurations fail closed. */
export function loadTomlConfig(scaffoldDir: string): EffectiveConfig {
  const path = resolve(scaffoldDir, 'factory.toml');
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      // A dangling symlink is a present but unreadable configuration, not legacy opt-out.
      let present = false;
      try { lstatSync(path); present = true; } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`${path}: cannot inspect configuration`);
      }
      if (!present) throw new Error(`${path}: missing version 2 configuration; manually migrate this project`);
    }
    throw new Error(`${path}: cannot read configuration (${(e as NodeJS.ErrnoException).code})`);
  }
  const fail = (key: string, why: string): never => { throw new Error(`${path}: ${key}: ${why}`); };
  let raw: Table;
  try { raw = parse(text); } catch (e) {
    // Parser errors contain source snippets. Retain location but never echo source/commands/secrets.
    const err = e as { line?: number; column?: number };
    throw new Error(`${path}:${err.line ?? '?'}:${err.column ?? '?'}: invalid TOML syntax (check duplicates, quoting and table definitions)`);
  }
  const sources: EffectiveConfig['sources'] = {};
  function table(v: any, key: string, allowed?: string[]): Table {
    if (!v || typeof v !== 'object' || Array.isArray(v) || Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) fail(key, 'expected a table');
    if (allowed) for (const k of Object.keys(v)) if (!allowed.includes(k)) fail(`${key ? key + '.' : ''}${k}`, 'unknown key');
    return v;
  }
  function section(key: string, allowed: string[], required = false) {
    if (raw[key] === undefined && required) fail(key, 'required table');
    return table(raw[key] ?? {}, key, allowed);
  }
  function value(t: Table, key: string, prefix: string, check: (v: any) => boolean, expected: string, fallback?: any): any {
    const p = `${prefix}.${key}`; const explicit = Object.hasOwn(t, key);
    sources[p] = explicit ? 'explicit' : 'default';
    const v = explicit ? t[key] : fallback;
    if (v === undefined || !check(v)) fail(p, expected);
    return v;
  }
  const nonempty = (v: any) => typeof v === 'string' && !!v.trim();
  const strings = (v: any) => Array.isArray(v) && v.every(nonempty);
  const pos = (v: any) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const integer = (v: any) => pos(v) && Number.isSafeInteger(v);
  const str = (t: Table, k: string, p: string, d?: string): string => value(t, k, p, nonempty, 'expected a nonempty string', d);
  const arr = (t: Table, k: string, p: string, d: string[] = []): string[] => value(t, k, p, strings, 'expected an array of nonempty strings', d);
  const num = (t: Table, k: string, p: string, d?: number, int = false): number => value(t, k, p, int ? integer : pos, int ? 'expected a positive safe integer' : 'expected a positive finite number', d);
  const bool = (t: Table, k: string, p: string, d = false): boolean => value(t, k, p, v => typeof v === 'boolean', 'expected a boolean', d);
  const en = (t: Table, k: string, p: string, choices: string[], d?: string): any => value(t, k, p, v => choices.includes(v), `expected one of ${choices.join(', ')}`, d);
  const optional = (t: Table, k: string, p: string) => {
    sources[`${p}.${k}`] = Object.hasOwn(t, k) ? 'explicit' : 'default';
    return t[k] === undefined ? undefined : str(t, k, p);
  };
  table(raw, '', ['version','tracker','agent','labels','graph','sandbox','selection','work','dispatch','merge','ci','workflow','instructions']);
  sources.version = Object.hasOwn(raw, 'version') ? 'explicit' : 'default';
  if (raw.version !== 2) fail('version', 'unsupported configuration; version = 2 required, manually migrate this project');
  const t = section('tracker', ['kind','project','host','project_id'], true);
  const kind = en(t, 'kind', 'tracker', ['github','gitlab']);
  const tracker: EffectiveConfig['TRACKER'] = { kind, project: str(t, 'project', 'tracker') };
  const host = str(t, 'host', 'tracker', kind === 'github' ? 'github.com' : undefined);
  if (!/^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(host)) fail('tracker.host', 'expected a hostname (no URL or path)');
  if (kind === 'gitlab') { tracker.gitlabHost = host; tracker.projectId = num(t, 'project_id', 'tracker', undefined, true); }
  else { sources['tracker.project_id'] = 'default'; tracker.host = host; if ('project_id' in t) fail('tracker.project_id', 'unsupported on GitHub'); }
  const a = section('agent', ['family']);
  const family = en(a, 'family', 'agent', ['openai','anthropic'], 'openai') as ModelFamily;
  const wf = section('workflow', ['mode','directory']);
  const mode = en(wf, 'mode', 'workflow', ['factory','project'], 'factory') as 'factory' | 'project';
  const directory = optional(wf, 'directory', 'workflow');
  if (mode === 'project' && !directory) fail('workflow.directory', 'required in project mode');
  if (mode === 'factory' && directory !== undefined) fail('workflow.directory', 'not allowed in factory mode');
  if (directory) { try { validateRelativePath(directory); } catch { fail('workflow.directory', 'expected a repository-relative path without parent traversal'); } }
  const inst = section('instructions', ['common','implementation','verification','analysis','recovery']);
  const instructions = {} as EffectiveConfig['instructions'];
  for (const role of ['common','implementation','verification','analysis','recovery'] as const) {
    instructions[role] = arr(inst, role, 'instructions');
    for (const p of instructions[role]) {
      try { validateRelativePath(p); if (!/\.md$/i.test(p)) throw new Error(); }
      catch { fail(`instructions.${role}`, 'expected repository-relative Markdown paths without parent traversal'); }
    }
  }
  const l = section('labels', ['needs_human','done'], true);
  const needsHuman = str(l, 'needs_human', 'labels'), done = str(l, 'done', 'labels');
  const s = section('selection', ['milestone','assignee','author','search','exclude_assignees','issue_type','confidential','labels','order']);
  const sl = table(s.labels ?? {}, 'selection.labels', ['all','none']);
  const ready = arr(sl, 'all', 'selection.labels', ['ready-for-agent']);
  const exclude = arr(sl, 'none', 'selection.labels', ['blocked','needs-human','wontfix']);
  tracker.milestone = optional(s, 'milestone', 'selection');
  const so = table(s.order ?? {}, 'selection.order', ['by','direction']);
  const orders = ['created','updated','popularity', ...(kind === 'gitlab' ? ['priority','due_date','relative_position','label_priority','milestone_due','weight'] : [])];
  const by = en(so, 'by', 'selection.order', orders, 'created');
  const selection: Selection = { assignee: optional(s,'assignee','selection'), author: optional(s,'author','selection'), search: optional(s,'search','selection'),
    excludeAssignees: arr(s,'exclude_assignees','selection'), order: ({ created: 'created_at', updated: 'updated_at' } as Table)[by] ?? by,
    sort: en(so,'direction','selection.order',['asc','desc'],'asc') };
  for (const k of ['issue_type','confidential']) if (k in s && kind !== 'gitlab') fail(`selection.${k}`, 'unsupported on GitHub');
  if ('issue_type' in s) selection.issueType = en(s,'issue_type','selection',['issue','incident','test_case']);
  if ('confidential' in s) selection.confidential = bool(s,'confidential','selection');
  const w = section('work',['units']);
  const d = section('dispatch',['max_concurrent','stagger_seconds']);
  const m = section('merge',['auto','method','required_checks']);
  const g = section('graph',['max_analyses_per_pass','analysis_timeout_minutes','conflict_ignore','prune_after_days']);
  const ci = section('ci',['wait_minutes','no_pipeline_minutes']);
  const sandbox = section('sandbox',['image','setup'],true);
  sources['sandbox.setup'] = Object.hasOwn(sandbox, 'setup') ? 'explicit' : 'default';
  sources['selection.issue_type'] = Object.hasOwn(s, 'issue_type') ? 'explicit' : 'default';
  sources['selection.confidential'] = Object.hasOwn(s, 'confidential') ? 'explicit' : 'default';
  const steps = sandbox.setup ?? [];
  if (!Array.isArray(steps)) fail('sandbox.setup','expected an array of step tables');
  const sandboxSetup = steps.map((step: any, i: number) => {
    const p = `sandbox.setup[${i}]`; const st = table(step,p,['command','timeout_ms','sudo']);
    sources[`${p}.timeout_ms`] = Object.hasOwn(st, 'timeout_ms') ? 'explicit' : 'default';
    return { command: str(st,'command',p), sudo: bool(st,'sudo',p), ...('timeout_ms' in st ? { timeoutMs: num(st,'timeout_ms',p,undefined,true) } : {}) };
  });
  return { source: { mode: 'toml', path }, sources, warnings: exclude.includes(needsHuman) ? [] : ['selection.labels.none does not contain labels.needs_human; add it to prevent human-held tickets from being selected.'],
    TRACKER: tracker, AGENT: { family }, workflow: { mode, ...(directory ? { directory } : {}) }, instructions, LABELS: { ready, exclude, needsHuman, done },
    MERGE: { auto: bool(m,'auto','merge'), method: en(m,'method','merge',['merge','squash','rebase'],'squash'), requiredChecks: arr(m,'required_checks','merge') },
    SUBTASKS: { enabled: en(w,'units','work',['issues','subtasks'],'subtasks') === 'subtasks' },
    GRAPH: { maxAnalysesPerPass: num(g,'max_analyses_per_pass','graph',5,true), analysisTimeoutMinutes: num(g,'analysis_timeout_minutes','graph',10), conflictIgnore: arr(g,'conflict_ignore','graph'), pruneAfterDays: num(g,'prune_after_days','graph',30) },
    selection, dispatch: { maxConcurrent: num(d,'max_concurrent','dispatch',3,true), staggerSeconds: value(d,'stagger_seconds','dispatch',v => typeof v === 'number' && Number.isFinite(v) && v >= 0,'expected a nonnegative finite number',20) },
    config: { image: str(sandbox,'image','sandbox'), sandboxSetup, ciWaitMinutes: num(ci,'wait_minutes','ci',30), noPipelineMinutes: num(ci,'no_pipeline_minutes','ci',5) } };
}
/** Identity lookup does not execute a project module; malformed TOML deliberately propagates. */
export function tomlIdentity(scaffoldDir: string) {
  const c = loadTomlConfig(scaffoldDir); if (!c) return;
  return { kind: c.TRACKER.kind, host: c.TRACKER.gitlabHost ?? c.TRACKER.host!, project: c.TRACKER.project };
}
