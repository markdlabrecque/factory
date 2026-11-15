// Fixture code stays closed while mutable project data changes independently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveWorkflow } from '../../orchestrator/workflow.mts';
import { paths } from '../src/paths.mts';
import { factoryToml } from './config-fixture.mts';
import { projectFixture, refreshManifest } from './workflow-fixture.mts';

function fixture(t: any) {
  const home = mkdtempSync(join(tmpdir(), 'factory-fixture-boundary-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const p = paths(home), root = join(home, 'project');
  const data = join(root, '.sandcastle'), code = join(root, '.factory-workflow');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'factory.toml'), factoryToml('owner/repo'));
  projectFixture(p, root);
  return { p, root, data, code, select: () => resolveWorkflow(root, p.runtimeDescriptor) };
}

test('mutable fixture data never enters the complete code override or its identity', t => {
  const f = fixture(t), selected = f.select();
  assert.equal(selected.mode, 'project');
  assert.equal(selected.root, f.code);
  const manifest = readFileSync(join(f.code, 'runtime-manifest.json'));
  mkdirSync(join(f.data, 'logs'));
  writeFileSync(join(f.data, 'logs/run-7.log'), 'new output');
  writeFileSync(join(f.data, '.env'), 'FIXTURE_ONLY=1');
  writeFileSync(join(f.data, 'unknown-helper.mts'), 'throw Error("must not execute")');
  refreshManifest(f.root);
  assert.deepEqual(readFileSync(join(f.code, 'runtime-manifest.json')), manifest);
  assert.equal(f.select().id, selected.id);
  for (const name of ['factory.toml', '.env', 'logs', 'unknown-helper.mts']) {
    assert.equal(existsSync(join(f.code, name)), false);
  }
  writeFileSync(join(f.code, 'unknown-helper.mts'), 'throw Error("must not execute")');
  assert.throws(f.select, /Unknown runtime source entry/);
  assert.throws(() => refreshManifest(f.root), /Unknown runtime source entry/);
});

test('re-publishing a fixture never restores a removed mandatory helper', t => {
  const f = fixture(t);
  rmSync(join(f.code, 'handoff.mts'));
  assert.throws(f.select, /handoff.mts/);
  assert.throws(() => refreshManifest(f.root), /handoff.mts/);
  assert.throws(() => projectFixture(f.p, f.root), /handoff.mts/);
  assert.equal(existsSync(join(f.code, 'handoff.mts')), false);
});
