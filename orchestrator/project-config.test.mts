// Isolated data-only configuration, supervisor ceilings, authority, strict validation and provenance fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTomlConfig } from './project-config.mts';

const personal = () => readFileSync(new URL('./factory.personal.toml', import.meta.url), 'utf8');
function fixture(text: string, check: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'factory-config-'));
  try { writeFileSync(join(dir, 'factory.toml'), text); check(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
test('profiles normalize independently of executable legacy settings', () => {
  for (const profile of ['personal', 'client']) fixture(readFileSync(new URL(`./factory.${profile}.toml`, import.meta.url), 'utf8'), dir => {
    writeFileSync(join(dir, 'config.mts'), 'throw new Error("must not execute");');
    const c = loadTomlConfig(dir)!;
    assert.equal(c.source.mode, 'toml');
    assert.equal(c.dispatch.maxConcurrent, 3);
    assert.deepEqual(c.config.sandboxSetup, []);
    assert.equal(c.selection.order, 'created_at');
    assert.equal(c.SUBTASKS.enabled, true);
    assert.equal(c.TRACKER.kind, profile === 'personal' ? 'github' : 'gitlab');
  });
});
test('configuration bytes and total instruction path count are bounded before consumers load files', () => {
  const text=personal();
  fixture(text+' '.repeat(256*1024-Buffer.byteLength(text)),dir=>assert.equal(loadTomlConfig(dir).source.mode,'toml'));
  fixture(text+' '.repeat(256*1024+1-Buffer.byteLength(text)),dir=>assert.throws(()=>loadTomlConfig(dir),/oversized/));
  const paths=Array(129).fill('"missing.md"').join(',');
  fixture(text+`\n[instructions]\ncommon = [${paths}]\n`,dir=>assert.throws(()=>loadTomlConfig(dir),/128 configured paths/));
});

test('absent and v1 configuration fail closed without conversion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'factory-config-'));
  try { assert.throws(() => loadTomlConfig(dir), /missing version 2/); } finally { rmSync(dir, { recursive: true }); }
  fixture('version = 1', dir => assert.throws(() => loadTomlConfig(dir), /version.*no conversion/));
});
test('present unreadable/dangling files fail rather than opting out', () => {
  const dir = mkdtempSync(join(tmpdir(),'factory-unreadable-'));
  try {
    mkdirSync(join(dir,'factory.toml'));
    assert.throws(()=>loadTomlConfig(dir),/cannot read configuration/);
    rmSync(join(dir,'factory.toml'),{recursive:true});
    symlinkSync(join(dir,'missing-target'),join(dir,'factory.toml'));
    assert.throws(()=>loadTomlConfig(dir),/cannot read configuration/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('GitLab requires identity fields; unsupported capabilities are never ignored', () => {
  const client = readFileSync(new URL('./factory.client.toml',import.meta.url),'utf8');
  for (const text of [client.replace(/^host = .*$/m,''),client.replace(/^project_id = .*$/m,''),client.replace('project_id = 699','project_id = 0'),
    personal().replace('[tracker]','[tracker]\nproject_id = 42'),personal().replace('[selection]','[selection]\nissue_type = "issue"'),
    client.replace('[agent]','[agent]\nthinking = "high"'),
    personal().replace('[agent]','[agent]\nmodel_aliases = {}')]) fixture(text,dir=>assert.throws(()=>loadTomlConfig(dir),/factory.toml/));
  fixture(client.replace('by = "created"','by = "weight"'),dir=>assert.equal(loadTomlConfig(dir)!.selection.order,'weight'));
});

test('strict schema errors never echo commands or config bodies', () => {
  const cases = [
    personal().replace('version = 2', 'version = 1'),
    personal().replace('version = 2', 'version = 2\nunknown = true'),
    personal().replace('max_concurrent = 3', 'max_concurrent = 0'),
    personal().replace('stagger_seconds = 20', 'stagger_seconds = inf'),
    personal().replace('direction = "asc"', 'direction = "sideways"'),
    personal().replace('[selection]', '[selection]\nconfidential = false'),
    personal().replace('by = "created"', 'by = "weight"'),
    personal().replace('[agent]', '[agent]\nmodel = "different"'),
    personal().replace(/^setup = .*$/m, '') + '\n[[sandbox.setup]]\ncommand = "PRIVATE_COMMAND"\ntimeout_ms = -1\n',
    personal() + '\n[tracker]\nkind = "github"\n',
  ];
  for (const text of cases) fixture(text, dir => assert.throws(() => loadTomlConfig(dir), e => {
    assert.match(String(e), /factory.toml/); assert.doesNotMatch(String(e), /PRIVATE_COMMAND/); return true;
  }));
});
test('omitted settings use complete schema defaults, never a per-field legacy fallback', () => {
  const minimal = `version = 2
[tracker]
kind = "github"
project = "a/b"
[labels]
needs_human = "needs-human"
done = "done"
[sandbox]
image = "image"
`;
  fixture(minimal, dir => {
    const c = loadTomlConfig(dir)!;
    assert.equal(c.TRACKER.host, 'github.com');
    assert.equal(c.TRACKER.milestone, undefined);
    assert.deepEqual(c.selection, {assignee:undefined,author:undefined,search:undefined,excludeAssignees:[],order:'created_at',sort:'asc'});
    assert.deepEqual(c.LABELS, { ready:['ready-for-agent'],exclude:['blocked','needs-human','wontfix'],needsHuman:'needs-human',done:'done' });
    assert.deepEqual(c.MERGE, {auto:false,method:'squash',requiredChecks:[]});
    assert.deepEqual(c.GRAPH, {maxAnalysesPerPass:5,analysisTimeoutMinutes:10,conflictIgnore:[],pruneAfterDays:30});
    assert.deepEqual(c.dispatch, {maxConcurrent:3,staggerSeconds:20});
    assert.deepEqual(c.config, {image:'image',sandboxSetup:[],ciWaitMinutes:30,noPipelineMinutes:5});
    assert.deepEqual(c.SUBTASKS,{enabled:true});
    assert.equal(c.sources['dispatch.max_concurrent'],'default');
    assert.equal(c.sources['selection.assignee'],'default');
    assert.equal(c.sources['agent.family'],'default');
    assert.equal(c.warnings.length,0);
  });
});

test('schema rejects wrong scalar/array/table types, empty filters and invalid nested values', () => {
  const cases: [string,string][] = [
    ['project = "owner/repo"','project = ""'],
    ['kind = "github"','kind = "other"'],
    ['family = "openai"','family = "other"'],
    ['[agent]','[agent]\nthinking = "invalid"'],
    ['[selection]','[selection]\nassignee = ""'],
    ['exclude_assignees = []','exclude_assignees = [""]'],
    ['[selection.labels]','[selection.labels]\nunknown = true'],
    ['direction = "asc"','direction = false'],
    ['units = "subtasks"','units = "tasks"'],
    ['max_concurrent = 3','max_concurrent = 1.5'],
    ['stagger_seconds = 20','stagger_seconds = nan'],
    ['auto = true','auto = 1'],
    ['method = "squash"','method = "fast-forward"'],
    ['required_checks = []','required_checks = "test"'],
    ['max_analyses_per_pass = 5','max_analyses_per_pass = -1'],
    ['analysis_timeout_minutes = 10','analysis_timeout_minutes = 0'],
    ['conflict_ignore = []','conflict_ignore = [false]'],
    ['prune_after_days = 30','prune_after_days = inf'],
    ['wait_minutes = 30','wait_minutes = -1'],
    ['no_pipeline_minutes = 5','no_pipeline_minutes = "5"'],
    ['setup = []','setup = false'],
  ];
  for (const [from,to] of cases) fixture(personal().replace(from,to),dir=>assert.throws(()=>loadTomlConfig(dir),/factory.toml/));
  for (const suffix of ['timeout_ms = 0', 'sudo = "yes"', 'unknown = true']) {
    fixture(personal().replace(/^setup = .*$/m,'') + '\n[[sandbox.setup]]\ncommand = "PRIVATE_COMMAND"\n' + suffix, dir => assert.throws(()=>loadTomlConfig(dir), e => !String(e).includes('PRIVATE_COMMAND')));
  }
  fixture('version = 1\nversion = 1',dir=>assert.throws(()=>loadTomlConfig(dir),/factory.toml:\d+:\d+: invalid TOML syntax/));
});

test('empty label axes and confidentiality false are preserved; setup is data', () => {
  const text = readFileSync(new URL('./factory.client.toml', import.meta.url), 'utf8')
    .replace(/^setup = .*$/m, '')
    .replace('[selection]', '[selection]\nconfidential = false')
    .replace('all = ["Ready to do", "ready-for-agent"]', 'all = []')
    .replace('none = ["blocked", "needs-human", "wontfix"]', 'none = []') +
    '\n[[sandbox.setup]]\ncommand = \'\'\'printf "hello"\nnext-command\'\'\'\nsudo = true\n';
  fixture(text, dir => { const c = loadTomlConfig(dir)!;
    assert.equal(c.selection.confidential, false); assert.deepEqual(c.LABELS.ready, []);
    assert.deepEqual(c.LABELS.exclude, []); assert.equal(c.warnings.length, 1);
    assert.equal(c.config.sandboxSetup[0].sudo, true); assert.equal(c.config.sandboxSetup[0].timeoutMs, undefined);
  });
});

test('recovery triage defaults off in both profiles and tracks explicit boolean settings', () => {
  for (const profile of ['personal', 'client']) fixture(readFileSync(new URL(`./factory.${profile}.toml`, import.meta.url), 'utf8'), dir => {
    const c = loadTomlConfig(dir);
    assert.equal(c.recovery.triage, false);
    assert.equal(c.sources['recovery.triage'], 'default');
  });
  for (const triage of [false, true]) fixture(personal() + `\n[recovery]\ntriage = ${triage}\n`, dir => {
    const c = loadTomlConfig(dir);
    assert.equal(c.recovery.triage, triage);
    assert.equal(c.sources['recovery.triage'], 'explicit');
  });
});

test('recovery triage rejects non-booleans and unknown keys', () => {
  fixture(personal() + '\n[recovery]\ntriage = "true"\n', dir => {
    assert.throws(() => loadTomlConfig(dir), /recovery\.triage: expected a boolean/);
  });
  fixture(personal() + '\n[recovery]\nunknown = true\n', dir => {
    assert.throws(() => loadTomlConfig(dir), /recovery\.unknown: unknown key/);
  });
});

const supervisorConfig = `
[supervisor]
enabled = true
max_tokens = 10000
max_cost_usd = 5
max_calls = 6
[supervisor.diagnosis]
max_tokens = 6000
max_cost_usd = 3
max_calls = 4
[supervisor.review]
max_tokens = 4000
max_cost_usd = 2
max_calls = 2
timeout_seconds = 300
`;
test('supervisor omission/disabled are inert; opt-in requires complete finite project and role limits', () => {
  fixture(personal(), dir => assert.deepEqual(loadTomlConfig(dir).supervisor, { enabled: false }));
  fixture(personal() + '\n[supervisor]\nenabled = false\n', dir => assert.deepEqual(loadTomlConfig(dir).supervisor, { enabled: false }));
  fixture(personal() + supervisorConfig, dir => {
    const c = loadTomlConfig(dir);
    assert.equal(c.supervisor.enabled, true);
    assert.deepEqual(c.supervisor.limits, { maxTokens: 10000, maxCostUsd: 5, maxCalls: 6,
      diagnosis: { maxTokens: 6000, maxCostUsd: 3, maxCalls: 4, timeoutSeconds: 600 },
      review: { maxTokens: 4000, maxCostUsd: 2, maxCalls: 2, timeoutSeconds: 300 } });
    assert.equal(c.sources['supervisor.enabled'], 'explicit');
    assert.equal(c.sources['supervisor.diagnosis.timeout_seconds'], 'default');
  });
  for (const suffix of ['\n[supervisor]\nenabled = true', '\n[supervisor]\nmax_calls = 2',
    ...['mode = "act"', 'model = "PRIVATE"', 'provider = "other"', 'max_active_decisions = 2'].map(s => supervisorConfig.replace('enabled = true', `enabled = true\n${s}`)),
    ...['0','-1','inf','nan','1.5','9007199254740992','"100"'].map(v => supervisorConfig.replace('max_tokens = 10000', `max_tokens = ${v}`)),
    ...['0','-1','inf','nan'].map(v => supervisorConfig.replace('max_cost_usd = 5', `max_cost_usd = ${v}`)),
    supervisorConfig.replace('max_calls = 6', 'max_calls = 0'), supervisorConfig.replace('max_tokens = 6000','max_tokens = 10001'),
    ...['0','601','1.5','inf'].map(v => supervisorConfig.replace('timeout_seconds = 300', `timeout_seconds = ${v}`))]) {
    fixture(personal() + suffix, dir => assert.throws(() => loadTomlConfig(dir), e => {
      assert.match(String(e), /supervisor|invalid TOML syntax/); assert.doesNotMatch(String(e), /PRIVATE/); return true;
    }));
  }
});
