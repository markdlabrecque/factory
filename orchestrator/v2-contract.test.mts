// Offline tests for the v2 data contract and tier policy.
import { bindExecution } from '../cli/test/execution-fixture.mts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTomlConfig, resolveCheckoutPath, validateRelativePath } from './project-config.mts';
import { MODEL_POLICY, modelForRole } from './model-policy.mts';
import { resolveTicketModel, ticketTier } from './models.mts';
import { readAssessment, recordModelResolution } from '../board/assessment.mts';
import type { RunState } from '../board/board.mts';

test('comment transitions cannot conceal active declarations', () => {
  assert.equal(ticketTier('Model tier: small\n<!--\n<!-- -->\nModel: old').status, 'unsupported');
  assert.equal(ticketTier('<!--\n<!-- -->\nModel tier: large').tier, 'large');
});
test('mixed tab indentation is code, not ticket policy', () => {
  for (const indent of [' \t', '  \t', '   \t']) {
    assert.equal(ticketTier(`${indent}Model tier: large`).source, 'factory-default');
    assert.equal(ticketTier(`${indent}Pi model: old`).source, 'factory-default');
  }
});
test('each symlink component must stay within checkout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'components-'));
  try {
    const repo = join(dir, 'repo'), outside = join(dir, 'outside');
    mkdirSync(repo); mkdirSync(outside);
    writeFileSync(join(repo, 'a.md'), 'safe');
    symlinkSync(outside, join(repo, 'escape'));
    symlinkSync(join(repo, 'a.md'), join(outside, 'back.md'));
    assert.throws(() => resolveCheckoutPath(repo, 'escape/back.md', 'file'), /escapes checkout/);
    symlinkSync(join(repo, 'a.md'), join(repo, 'inside.md'));
    assert.equal(resolveCheckoutPath(repo, 'inside.md', 'file'), join(repo, 'a.md'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const base = 'version = 2\n[tracker]\nkind = "github"\nproject = "a/b"\n[labels]\nneeds_human = "needs-human"\ndone = "done"\n[sandbox]\nimage = "test"\n';
test('v2 defaults, sources and rejected old settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v2-'));
  try {
    assert.throws(() => loadTomlConfig(dir), /configuration/);
    const file = join(dir, 'factory.toml');
    writeFileSync(file, base); const c = loadTomlConfig(dir);
    assert.equal(c.AGENT.family, 'openai'); assert.equal(c.sources['agent.family'], 'default');
    assert.equal(c.GRAPH.analysisTimeoutMinutes, 10); assert.equal(c.dispatch.maxConcurrent, 3);
    assert.deepEqual(c.instructions.common, []);
    for (const key of ['tracker.host','tracker.project_id','selection.milestone','selection.issue_type','selection.confidential','selection.labels.all','selection.order.by','agent.family','workflow.mode','workflow.directory','instructions.common','instructions.implementation','instructions.verification','instructions.analysis','instructions.recovery','work.units','dispatch.max_concurrent','dispatch.stagger_seconds','merge.auto','merge.method','merge.required_checks','graph.max_analyses_per_pass','graph.analysis_timeout_minutes','graph.conflict_ignore','graph.prune_after_days','ci.wait_minutes','ci.no_pipeline_minutes','sandbox.setup']) assert.equal(c.sources[key], 'default', key);
    for (const key of ['version','tracker.kind','tracker.project','labels.needs_human','labels.done','sandbox.image']) assert.equal(c.sources[key], 'explicit', key);
    writeFileSync(file, base + '\n[agent]\nfamily = "anthropic"\n');
    assert.equal(loadTomlConfig(dir).sources['agent.family'], 'explicit');
    for (const extra of ['[agent]\nmodel = "x"', '[agent]\nprovider = "pi"', '[agent]\nthinking = "high"', '[agent.model_aliases]\nx = "y"', '[agent.implementation]\nfamily = "openai"', '[graph]\nmodel = "x"', '[dispatch]\nimplementation_timeout_minutes = 4', '[workflow]\nmode = "project"', '[workflow]\nmode = "factory"\ndirectory = "x"', '[instructions]\ncommon = ["../x.md"]', '[instructions]\nanalysis = ["notes.txt"]']) {
      writeFileSync(file, base + '\n' + extra); assert.throws(() => loadTomlConfig(dir));
    }
    writeFileSync(file, base.replace('version = 2', 'version = 1')); assert.throws(() => loadTomlConfig(dir), /configuration/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('explicit values report their sources including optional setup fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sources-'));
  try {
    const profile = readFileSync(new URL('./factory.client.toml', import.meta.url), 'utf8')
      .replace('[selection]', '[selection]\nmilestone = "M"\nassignee = "A"\nauthor = "B"\nsearch = "query"\nconfidential = false')
      .replace('setup = []', '[[sandbox.setup]]\ncommand = "echo ok"\ntimeout_ms = 10\nsudo = true') + '\n[workflow]\nmode = "project"\ndirectory = "workflow"\n[instructions]\ncommon = ["a.md"]\nimplementation = []\nverification = []\nanalysis = []\nrecovery = []\n';
    writeFileSync(join(dir, 'factory.toml'), profile);
    const c = loadTomlConfig(dir);
    for (const key of ['tracker.kind','tracker.project','tracker.host','tracker.project_id','agent.family','labels.needs_human','labels.done','selection.milestone','selection.assignee','selection.author','selection.search','selection.issue_type','selection.confidential','selection.exclude_assignees','selection.labels.all','selection.labels.none','selection.order.by','selection.order.direction','work.units','dispatch.max_concurrent','dispatch.stagger_seconds','merge.auto','merge.method','merge.required_checks','graph.max_analyses_per_pass','graph.analysis_timeout_minutes','graph.conflict_ignore','graph.prune_after_days','ci.wait_minutes','ci.no_pipeline_minutes','sandbox.image','sandbox.setup','sandbox.setup[0].command','sandbox.setup[0].timeout_ms','sandbox.setup[0].sudo','workflow.mode','workflow.directory','instructions.common','instructions.implementation','instructions.verification','instructions.analysis','instructions.recovery']) assert.equal(c.sources[key], 'explicit', key);
    assert.equal(c.selection.confidential, false); assert.equal(c.selection.assignee, 'A');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('canonical paths reject escape and missing files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'v2-path-'));
  try { writeFileSync(join(dir, 'a.md'), 'x'); symlinkSync('/tmp', join(dir, 'escape'));
    assert.equal(resolveCheckoutPath(dir, 'a.md', 'file'), join(dir, 'a.md'));
    for (const path of ['../x', '/tmp', 'escape', 'missing']) assert.throws(() => resolveCheckoutPath(dir, path, 'file'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('fixed policy for all roles and families', () => {
  for (const family of ['openai', 'anthropic'] as const) {
    for (const tier of ['small', 'mid', 'large'] as const) assert.equal(modelForRole(family, 'implementation', tier).model, MODEL_POLICY[family][tier]);
    for (const [role, tier] of [['analysis','mid'], ['verification','large'], ['recovery','large']] as const) {
      const result = modelForRole(family, role); assert.equal(result.model, MODEL_POLICY[family][tier]); assert.equal(result.thinking, 'high'); assert.equal(result.agent, 'pi');
    }
  }
});
test('tier parsing excludes examples and rejects legacy declarations', () => {
  assert.deepEqual([ticketTier('').status, (ticketTier('') as any).tier], ['resolved', 'mid']);
  assert.equal((ticketTier('Model tier: SMALL\n**Model tier:** small') as any).tier, 'small');
  assert.equal(ticketTier('Model tier: small\nModel tier: large').status, 'conflicting');
  assert.equal(ticketTier('Model tier: unknown').status, 'unsupported');
  assert.equal(ticketTier('Model tier: mid\n**Pi model:** old').status, 'unsupported');
  assert.equal(ticketTier('**MODEL TIER**: LaRgE').status, 'resolved');
  assert.equal((ticketTier('No model field') as any).source, 'factory-default');
  assert.equal((ticketTier('Model tier: MID') as any).source, 'ticket-tier');
  assert.equal(ticketTier('Model tier:').status, 'unsupported');
  assert.equal(ticketTier('Model tier: mid\nModel: openai/gpt-6.1-terra').status, 'unsupported');
  assert.equal((ticketTier('```\nModel tier: large\n```\n> Model tier: small\n<!-- Model tier: large -->\n    Model tier: large') as any).tier, 'mid');
});

test('policy maps every role and tier to fixed independent models', () => {
  const expected = { openai: ['openai/gpt-6-luna', 'openai/gpt-6.1-terra', 'openai/gpt-6.1-sol'], anthropic: ['pi-claude-subscription/claude-haiku-5-5', 'pi-claude-subscription/claude-sonnet-5-5', 'pi-claude-subscription/claude-opus-5-5'] };
  for (const family of ['openai', 'anthropic'] as const) for (const [i, tier] of (['small', 'mid', 'large'] as const).entries()) {
    for (const [role, index] of [['implementation', i], ['analysis', 1], ['verification', 2], ['recovery', 2]] as const) {
      const result = modelForRole(family, role, tier);
      assert.equal(result.model, expected[family][index]);
      assert.equal(result.provider, family === 'openai' ? 'openai' : 'pi-claude-subscription');
      assert.equal(result.agent, 'pi'); assert.equal(result.thinking, 'high');
    }
  }
  assert.ok(Object.isFrozen(MODEL_POLICY) && Object.isFrozen(MODEL_POLICY.openai));
});

test('path validators check lexical paths, type, dangling and escaping links', () => {
  const dir = mkdtempSync(join(tmpdir(), 'paths-'));
  try {
    mkdirSync(join(dir, 'inner')); writeFileSync(join(dir, 'inner', 'x.md'), 'x');
    symlinkSync('inner/x.md', join(dir, 'inside')); symlinkSync('absent', join(dir, 'dangling')); symlinkSync('/tmp', join(dir, 'outside'));
    assert.equal(resolveCheckoutPath(dir, 'inside', 'file'), join(dir, 'inner', 'x.md'));
    assert.equal(resolveCheckoutPath(dir, 'inner', 'directory'), join(dir, 'inner'));
    for (const p of ['', '../x', 'x/../y', '/x', 'C:/x', 'x\\\\y']) assert.throws(() => validateRelativePath(p));
    for (const p of ['dangling', 'outside', 'missing', 'inner']) assert.throws(() => resolveCheckoutPath(dir, p, 'file'));
    assert.throws(() => resolveCheckoutPath(dir, 'inner/x.md', 'directory'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scalar bridge derives fixed agent and provider without evaluating project code', () => {
  const root = mkdtempSync(join(tmpdir(), 'bridge-'));
  const dir = join(root, '.factory'); mkdirSync(dir);
  const runtime = bindExecution(root, process.env, { overlays: false });
  try {
    writeFileSync(join(dir, 'config.mts'), 'throw new Error("executed")');
    for (const [family, provider, subscription] of [['openai', 'openai', 'false'], ['anthropic', 'pi-claude-subscription', 'true']]) {
      writeFileSync(join(dir, 'factory.toml'), base + `\n[agent]\nfamily = "${family}"\n`);
      for (const [key, expected] of Object.entries({ agent: 'pi', provider, family, subscription, kind: 'github', image: 'test' })) {
        const p = spawnSync(process.execPath, [join(runtime.directory, 'config-read.mts'), dir, key], { cwd: root, env: runtime.env, encoding: 'utf8' });
        assert.equal(p.status, 0, p.stderr); assert.equal(p.stdout, expected);
      }
      const p = spawnSync(process.execPath, [join(runtime.directory, 'config-read.mts'), dir, 'config'], { cwd: root, env: runtime.env, encoding: 'utf8' });
      assert.notEqual(p.status, 0); assert.match(p.stderr, /Unsupported metadata field/);
    }
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(runtime.staging, { recursive: true, force: true }); }
});

test('resolution metadata snapshots survive assessment refresh and old records remain readable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'choice-'));
  try {
    const old = { iid: '7', project: 'p', stage: 'implementing', implementationModel: 'old/model' } as RunState;
    const runPath = join(dir, 'p--7.json'); writeFileSync(runPath, JSON.stringify(old));
    assert.deepEqual(JSON.parse(readFileSync(runPath, 'utf8')), old);
    const first = resolveTicketModel('Model tier: SMALL', 'anthropic');
    assert.equal(first.status, 'resolved'); if (first.status !== 'resolved') throw new Error();
    assert.deepEqual(first.choice, { family: 'anthropic', tier: 'small', source: 'ticket-tier', resolvedModel: 'pi-claude-subscription/claude-haiku-5-5', descriptionRevision: first.revision, policyIdentity: 'factory-model-policy-v2' });
    const frozen = { ...old, modelChoice: first.choice }; writeFileSync(runPath, JSON.stringify(frozen));
    recordModelResolution(dir, 'p--7', { iid: '7', project: 'p' }, () => first);
    const next = resolveTicketModel('', 'openai'); recordModelResolution(dir, 'p--7', { iid: '7', project: 'p' }, () => next);
    assert.deepEqual(readAssessment(dir, 'p--7')?.modelResolution, next);
    assert.deepEqual(JSON.parse(readFileSync(runPath, 'utf8')), frozen);
    assert.equal(resolveTicketModel('Model tier: mid\nModel: sonnet', 'openai').status, 'unsupported');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
