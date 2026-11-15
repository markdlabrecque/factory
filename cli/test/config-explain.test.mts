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
    const original = { write: fs.writeFileSync, mkdir: fs.mkdirSync, spawn: childProcess.spawn, exec: childProcess.execFileSync, connect: net.connect };
    const trap = () => { throw Error('forbidden boundary'); };
    let r: ReturnType<typeof capture>;
    try {
      fs.writeFileSync = trap as typeof fs.writeFileSync; fs.mkdirSync = trap as typeof fs.mkdirSync;
      childProcess.spawn = trap as typeof childProcess.spawn; childProcess.execFileSync = trap as typeof childProcess.execFileSync;
      net.connect = trap as typeof net.connect; syncBuiltinESMExports();
      r = capture(p, 'fixture');
    } finally {
      fs.writeFileSync = original.write; fs.mkdirSync = original.mkdir; childProcess.spawn = original.spawn;
      childProcess.execFileSync = original.exec; net.connect = original.connect; syncBuiltinESMExports();
    }
    assert.equal(r.code, 0, r.out);
    const cli = fileURLToPath(new URL('../bin/factory.mts', import.meta.url));
    const stdout = execFileSync(process.execPath, [cli, 'config', 'explain', '--project', root, '--json'], { env: { ...process.env, FACTORY_HOME: p.home }, encoding: 'utf8' });
    assert.equal(JSON.parse(stdout).version, 1);
    assert.equal(r.value.sources['agent.family'], 'default'); assert.equal(r.value.policy.family, 'openai');
    assert.equal(r.value.settings.sandbox.setup.count, 1); assert.match(r.value.instructions.implementation['notes.md'], /^[a-f0-9]{64}$/);
    assert.doesNotMatch(r.out, /SECRET_/);
    writeFileSync(config, factoryToml('owner/repo') + '\n[agent]\nfamily = "anthropic"\n');
    r = capture(p, root); assert.equal(r.code, 0, r.out); assert.equal(r.value.policy.family, 'anthropic'); assert.equal(r.value.sources['agent.family'], 'explicit');
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
