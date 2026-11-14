// #137: data-only, fail-closed version 1 project configuration. No legacy imports, host evaluation,
// environment expansion or per-field fallback. All callers supply the project's scaffold directory.
import { lstatSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from './vendor/smol-toml/index.js';

export type Thinking = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type Selection = { assignee?: string; author?: string; search?: string; issueType?: string; confidential?: boolean;
  excludeAssignees: string[]; order: string; sort: string };
export type EffectiveConfig = {
  source: { mode: 'toml'; path: string }; sources: Record<string, 'explicit' | 'default'>; warnings: string[];
  TRACKER: { kind: 'github' | 'gitlab'; project: string; host?: string; gitlabHost?: string; projectId?: number; milestone?: string };
  AGENT: { provider: 'pi' | 'claude'; model: string; thinking?: Thinking; modelAliases: Record<string, string> };
  LABELS: { ready: string[]; exclude: string[]; needsHuman: string; done: string };
  MERGE: { auto: boolean; method: 'merge' | 'squash' | 'rebase'; requiredChecks: string[] };
  SUBTASKS: { enabled: boolean };
  GRAPH: { model: string; maxAnalysesPerPass: number; analysisTimeoutMinutes: number; conflictIgnore: string[]; pruneAfterDays: number };
  selection: Selection; dispatch: { maxConcurrent: number; staggerSeconds: number };
  config: { image: string; ciWaitMinutes: number; noPipelineMinutes: number; sandboxSetup: { command: string; timeoutMs?: number; sudo: boolean }[] };
};
type Table = Record<string, any>;
/** Undefined means ENOENT only. Present but malformed/unreadable files must never fall back. */
export function loadTomlConfig(scaffoldDir: string): EffectiveConfig | undefined {
  const path = resolve(scaffoldDir, 'factory.toml');
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      // A dangling symlink is a present but unreadable configuration, not legacy opt-out.
      let present = false;
      try { lstatSync(path); present = true; } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`${path}: cannot inspect configuration`);
      }
      if (!present) return;
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
  table(raw, '', ['version','tracker','agent','labels','graph','sandbox','selection','work','dispatch','merge','ci']);
  sources.version = 'explicit';
  if (raw.version !== 1) fail('version', 'required supported version = 1');
  const t = section('tracker', ['kind','project','host','project_id'], true);
  const kind = en(t, 'kind', 'tracker', ['github','gitlab']);
  const tracker: EffectiveConfig['TRACKER'] = { kind, project: str(t, 'project', 'tracker') };
  const host = str(t, 'host', 'tracker', kind === 'github' ? 'github.com' : undefined);
  if (!/^[A-Za-z0-9][A-Za-z0-9.:-]*$/.test(host)) fail('tracker.host', 'expected a hostname (no URL or path)');
  if (kind === 'gitlab') { tracker.gitlabHost = host; tracker.projectId = num(t, 'project_id', 'tracker', undefined, true); }
  else { tracker.host = host; if ('project_id' in t) fail('tracker.project_id', 'unsupported on GitHub'); }
  const a = section('agent', ['provider','model','thinking','model_aliases'], true);
  const provider = en(a, 'provider', 'agent', ['claude','pi']);
  sources['agent.model_aliases'] = 'explicit';
  sources['agent.thinking'] = Object.hasOwn(a, 'thinking') ? 'explicit' : 'default';
  const aliases = table(a.model_aliases, 'agent.model_aliases');
  if (!Object.keys(aliases).length) fail('agent.model_aliases', 'required nonempty alias map');
  const seen = new Map<string, string>();
  for (const [k,v] of Object.entries(aliases)) {
    if (!nonempty(k) || !nonempty(v)) fail('agent.model_aliases', 'aliases and model IDs must be nonempty strings');
    const normalized = k.trim().toLowerCase();
    if (seen.has(normalized) && seen.get(normalized) !== v) fail('agent.model_aliases', 'ambiguous case-insensitive aliases');
    seen.set(normalized, v);
  }
  const model = str(a, 'model', 'agent');
  let thinking: Thinking | undefined;
  if ('thinking' in a) {
    if (provider !== 'pi') fail('agent.thinking', 'supported only for Pi');
    thinking = en(a, 'thinking', 'agent', ['off','minimal','low','medium','high','xhigh']);
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
  const g = section('graph',['model','max_analyses_per_pass','analysis_timeout_minutes','conflict_ignore','prune_after_days'], true);
  const graphModel = str(g,'model','graph');
  const approved = new Set(Object.values(aliases));
  if (!approved.has(model)) fail('agent.model', 'must be an approved model ID in agent.model_aliases');
  if (!approved.has(graphModel)) fail('graph.model', 'must be an approved model ID in agent.model_aliases');
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
    TRACKER: tracker, AGENT: { provider, model, thinking, modelAliases: { ...aliases } }, LABELS: { ready, exclude, needsHuman, done },
    MERGE: { auto: bool(m,'auto','merge'), method: en(m,'method','merge',['merge','squash','rebase'],'squash'), requiredChecks: arr(m,'required_checks','merge') },
    SUBTASKS: { enabled: en(w,'units','work',['issues','subtasks'],'subtasks') === 'subtasks' },
    GRAPH: { model: graphModel, maxAnalysesPerPass: num(g,'max_analyses_per_pass','graph',5,true), analysisTimeoutMinutes: num(g,'analysis_timeout_minutes','graph',10), conflictIgnore: arr(g,'conflict_ignore','graph'), pruneAfterDays: num(g,'prune_after_days','graph',30) },
    selection, dispatch: { maxConcurrent: num(d,'max_concurrent','dispatch',3,true), staggerSeconds: value(d,'stagger_seconds','dispatch',v => typeof v === 'number' && Number.isFinite(v) && v >= 0,'expected a nonnegative finite number',20) },
    config: { image: str(sandbox,'image','sandbox'), sandboxSetup, ciWaitMinutes: num(ci,'wait_minutes','ci',30), noPipelineMinutes: num(ci,'no_pipeline_minutes','ci',5) } };
}
/** Identity lookup does not execute a project module; malformed TOML deliberately propagates. */
export function tomlIdentity(scaffoldDir: string) {
  const c = loadTomlConfig(scaffoldDir); if (!c) return;
  return { kind: c.TRACKER.kind, host: c.TRACKER.gitlabHost ?? c.TRACKER.host!, project: c.TRACKER.project };
}
