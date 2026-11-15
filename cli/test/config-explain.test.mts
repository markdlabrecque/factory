// Fixture-only coverage of data-only config explanation and failure redaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import net from 'node:net';
import { paths } from '../src/paths.mts';
import { configExplain } from '../src/commands/config.mts';
import { factoryToml } from './config-fixture.mts';
import { bindExecution } from './execution-fixture.mts';

function capture(p: ReturnType<typeof paths>, project: string) {
  let out = ''; const log = console.log; console.log = (...args) => { out += args.join(' '); };
  try { const code = configExplain(p, 'explain', { project, json: true }); return { code, out, value: JSON.parse(out) }; }
  finally { console.log = log; }
}
test('explain validates fixture runtime, sources, instructions and explicit override without revealing bodies', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'explain-')); const root = join(tmp, 'project');
  const p = paths(join(tmp, 'home')); mkdirSync(join(root, '.sandcastle'), { recursive: true });
  const config = join(root, '.sandcastle/factory.toml');
  try {
    writeFileSync(config, factoryToml('owner/repo') + '\n[instructions]\ncommon = ["notes.md"]\n\n[[sandbox.setup]]\ncommand = "SECRET_SETUP_BODY"\n');
    writeFileSync(join(root, 'notes.md'), 'SECRET_INSTRUCTION_BODY');
    const runtime = bindExecution(root, {}, { paths: p, overlays: false });
    mkdirSync(p.config, { recursive: true }); writeFileSync(p.projects, JSON.stringify({ version: 1, projects: [{ name: 'fixture', root }] }));
    const original = { write: fs.writeFileSync, mkdir: fs.mkdirSync, rename: fs.renameSync, rm: fs.rmSync, read: fs.readFileSync,
      spawn: childProcess.spawn, spawnSync: childProcess.spawnSync, exec: childProcess.execFileSync, execSync: childProcess.execSync, connect: net.connect };
    let forbidden = 0;
    const trap = () => { forbidden++; throw Error('forbidden boundary'); };
    let r: ReturnType<typeof capture>;
    try {
      fs.writeFileSync = trap as typeof fs.writeFileSync; fs.mkdirSync = trap as typeof fs.mkdirSync;
      fs.renameSync = trap as typeof fs.renameSync; fs.rmSync = trap as typeof fs.rmSync;
      fs.readFileSync = ((path: any, ...args: any[]) => {
        if (typeof path === 'string' && /(?:^|\/)(?:\.env|auth\.json)$/.test(path)) return trap();
        return (original.read as any)(path, ...args);
      }) as typeof fs.readFileSync;
      childProcess.spawn = trap as typeof childProcess.spawn; childProcess.spawnSync = trap as typeof childProcess.spawnSync;
      childProcess.execFileSync = trap as typeof childProcess.execFileSync; childProcess.execSync = trap as typeof childProcess.execSync;
      net.connect = trap as typeof net.connect; syncBuiltinESMExports();
      r = capture(p, 'fixture');
      const failure = capture(p, join(tmp, 'missing')); assert.equal(failure.code, 1);
      assert.equal(forbidden, 0, 'no boundary may be called, including on failure');
    } finally {
      fs.writeFileSync = original.write; fs.mkdirSync = original.mkdir; fs.renameSync = original.rename; fs.rmSync = original.rm; fs.readFileSync = original.read;
      childProcess.spawn = original.spawn; childProcess.spawnSync = original.spawnSync;
      childProcess.execFileSync = original.exec; childProcess.execSync = original.execSync; net.connect = original.connect; syncBuiltinESMExports();
    }
    assert.equal(r.code, 0, r.out);
    const cli = fileURLToPath(new URL('../bin/factory.mts', import.meta.url));
    const stdout = execFileSync(process.execPath, [cli, 'config', 'explain', '--project', root, '--json'], { env: { ...process.env, FACTORY_HOME: p.home }, encoding: 'utf8' });
    assert.equal(JSON.parse(stdout).version, 1);
    assert.equal(r.value.sources['agent.family'], 'default'); assert.equal(r.value.policy.family, 'openai');
    assert.equal(r.value.settings.sandbox.setup.count, 1); assert.match(r.value.instructions.implementation['notes.md'], /^[a-f0-9]{64}$/);
    assert.equal(r.value.settings.work.units, 'subtasks');
    assert.deepEqual(r.value.settings.ci, { waitMinutes: 30, noPipelineMinutes: 5 });
    assert.equal(r.value.sources['ci.wait_minutes'], 'default');
    assert.match(r.value.config.sha256, /^[a-f0-9]{64}$/);
    assert.equal(r.value.config.path, config);
    assert.doesNotMatch(r.out, /SECRET_/);
    writeFileSync(config, factoryToml('owner/repo') + '\n[agent]\nfamily = "anthropic"\n');
    r = capture(p, root); assert.equal(r.code, 0, r.out); assert.equal(r.value.policy.family, 'anthropic'); assert.equal(r.value.sources['agent.family'], 'explicit');
    writeFileSync(config, factoryToml('owner/repo') + '\n[work]\nunits = "issues"\n[ci]\nwait_minutes = 12\nno_pipeline_minutes = 3\n');
    r = capture(p, root); assert.equal(r.code, 0, r.out);
    assert.equal(r.value.settings.work.units, 'issues'); assert.equal(r.value.sources['work.units'], 'explicit');
    assert.deepEqual(r.value.settings.ci, { waitMinutes: 12, noPipelineMinutes: 3 }); assert.equal(r.value.sources['ci.wait_minutes'], 'explicit');
    cpSync(runtime.directory, join(root, 'override'), { recursive: true });
    writeFileSync(config, factoryToml('owner/repo') + '\n[workflow]\nmode = "project"\ndirectory = "override"\n');
    r = capture(p, root); assert.equal(r.code, 0, r.out); assert.equal(r.value.policy.actual, 'unknown'); assert.equal(r.value.workflow.behavior, 'opaque');
    rmSync(join(root, 'override', 'main.mts'));
    r = capture(p, root); assert.equal(r.code, 1); assert.equal(r.value.errors[0].phase, 'workflow runtime');
    writeFileSync(config, factoryToml('owner/repo') + '\n[instructions]\ncommon = ["missing.md"]\n');
    r = capture(p, root); assert.equal(r.code, 1); assert.equal(r.value.errors[0].phase, 'instruction files');
    writeFileSync(config, factoryToml('owner/repo') + '\nSECRET_ERROR_KEY = "SECRET_ERROR_VALUE"\n');
    r = capture(p, root); assert.equal(r.code, 1); assert.doesNotMatch(r.out, /SECRET_/);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
