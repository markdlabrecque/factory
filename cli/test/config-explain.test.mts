// Fixture-only coverage of data-only config explanation and failure redaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, symlinkSync, readFileSync } from 'node:fs';
import childProcess from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dgram from 'node:dgram';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { paths } from '../src/paths.mts';
import { configExplain } from '../src/commands/config.mts';
import { MODEL_POLICY, ROLE_TIERS } from '../../orchestrator/model-policy.mts';
import { factoryToml } from './config-fixture.mts';
import { bindExecution } from './execution-fixture.mts';

// Patch both default and named builtin exports, restoring even if an assertion throws.
function guarded<T>(fn: () => T, unreadable?: string): T {
  const restore: (() => void)[] = []; let calls = 0; let denied = 0;
  const patch = (object: any, name: string, replacement: any) => {
    const original = object[name];
    object[name] = replacement;
    restore.push(() => { object[name] = original; });
  };
  const trap = () => { calls++; throw Error('forbidden boundary'); };
  const secret = (path: unknown) => /(?:^|\/)(?:\.env(?:\.[^/]*)?|auth\.json)$/.test(String(path));
  try {
    for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) patch(childProcess, name, trap);
    for (const [object, names] of [[http, ['request', 'get']], [https, ['request', 'get']], [net, ['connect', 'createConnection', 'createServer']], [dgram, ['createSocket']]] as const)
      for (const name of names) patch(object, name, trap);
    patch(globalThis, 'fetch', trap);
    for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'renameSync', 'rmSync', 'rmdirSync', 'unlinkSync', 'copyFileSync', 'cpSync', 'truncateSync', 'chmodSync', 'chownSync', 'symlinkSync', 'linkSync', 'createWriteStream']) patch(fs, name, trap);
    for (const name of ['writeFile', 'appendFile', 'mkdir', 'rename', 'rm', 'rmdir', 'unlink', 'copyFile', 'cp', 'truncate', 'chmod', 'chown', 'symlink', 'link']) patch(fs.promises, name, trap);
    for (const [object, name] of [[fs, 'readFileSync'], [fs, 'readFile'], [fs.promises, 'readFile']] as const) {
      const original = (object as any)[name];
      patch(object, name, (path: unknown, ...args: unknown[]) => {
        if (secret(path)) return trap();
        if (name === 'readFileSync' && path === unreadable) { denied++; throw Object.assign(new Error('SECRET_ERROR unreadable'), { code: 'EACCES' }); }
        return original.call(object, path, ...args);
      });
    }
    for (const [object, name] of [[fs, 'openSync'], [fs, 'open'], [fs.promises, 'open']] as const) {
      const original = (object as any)[name];
      patch(object, name, (path: unknown, flags: any, ...args: unknown[]) => {
        if (secret(path) || (typeof flags === 'string' ? /[wa+]/.test(flags) : typeof flags === 'number' && !!(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND)))) return trap();
        // Descriptor-based bounded readers must receive the same permission fault as whole-file readers.
        if (name === 'openSync' && path === unreadable) { denied++; throw Object.assign(new Error('SECRET_ERROR unreadable'), { code: 'EACCES' }); }
        return original.call(object, path, flags, ...args);
      });
    }
    syncBuiltinESMExports();
    const result = fn();
    assert.equal(calls, 0, 'no forbidden boundary, including caught calls');
    if (unreadable) assert.equal(denied, 1, 'instruction read was denied');
    return result;
  } finally { for (const undo of restore.reverse()) undo(); syncBuiltinESMExports(); }
}

function capture(p: ReturnType<typeof paths>, options: { project?: string; cwd?: string; json?: boolean }, unreadable?: string) {
  let out = ''; const log = console.log; console.log = (...args) => { out += args.join(' '); };
  try {
    const code = guarded(() => configExplain(p, 'explain', options), unreadable);
    assert.doesNotMatch(out, /SECRET_(?:SETUP|INSTRUCTION|SCRIPT|ENV|AUTH|ERROR)/);
    const value = JSON.parse(options.json ? out : out.slice(out.indexOf('\n') + 1));
    return { code, out, value };
  } finally { console.log = log; }
}

test('config explain: fixture-only lookup, policy, redaction and refusals', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'explain-')); const root = join(tmp, 'project');
  const p = paths(join(tmp, 'home')); mkdirSync(join(root, '.factory'), { recursive: true });
  const config = join(root, '.factory/factory.toml');
  const base = factoryToml('owner/repo');
  try {
    writeFileSync(config, base + '\n[instructions]\ncommon = ["notes.md"]\n\n[[sandbox.setup]]\ncommand = "SECRET_SETUP_BODY"\n');
    writeFileSync(join(root, 'notes.md'), 'SECRET_INSTRUCTION_BODY');
    writeFileSync(join(root, '.env'), 'SECRET_ENV_BODY');
    writeFileSync(join(root, 'auth.json'), 'SECRET_AUTH_BODY');
    const runtime = bindExecution(root, {}, { paths: p, overlays: false });
    mkdirSync(p.config, { recursive: true }); writeFileSync(p.projects, JSON.stringify({ version: 1, projects: [{ name: 'fixture', root }] }));
    mkdirSync(join(root, 'nested'));
    const results = [ { project: 'fixture' }, { project: root }, { cwd: join(root, 'nested') } ].map(options => capture(p, { ...options, json: true }));
    for (const r of results) {
      assert.equal(r.code, 0, r.out); assert.deepEqual(r.value, results[0].value);
      assert.equal(r.value.config.path, config); assert.match(r.value.config.sha256, /^[a-f0-9]{64}$/);
      assert.equal(r.value.settings.sandbox.setup.count, 1);
      assert.equal(r.value.settings.work.units, 'subtasks');
      assert.deepEqual(r.value.settings.ci, { waitMinutes: 30, noPipelineMinutes: 5 });
      assert.equal(r.value.sources['ci.wait_minutes'], 'default');
      assert.match(r.value.instructions.implementation['notes.md'], /^[a-f0-9]{64}$/);
      assert.equal(r.value.sources['agent.family'], 'default');
      assert.equal(r.value.policy.family, 'openai'); assert.deepEqual(r.value.policy.tiers, MODEL_POLICY.openai);
      assert.deepEqual(r.value.policy.roles, ROLE_TIERS); assert.equal(r.value.policy.implementationDefault, 'mid');
    }
    // The CLI child is a local fixture; in-process calls above trap all boundaries.
    const cli = fileURLToPath(new URL('../bin/factory.mts', import.meta.url));
    const stdout = childProcess.execFileSync(process.execPath, [cli, 'config', 'explain', '--project', root, '--json'], { env: { ...process.env, FACTORY_HOME: p.home }, encoding: 'utf8' });
    assert.equal(JSON.parse(stdout).version, 1); assert.doesNotMatch(stdout, /SECRET_/);
    const human = capture(p, { project: root });
    assert.equal(human.code, 0);
    // Snapshot a stable projection of the actual formatted lines, excluding runtime content hashes.
    const humanProjection = human.out.replaceAll(tmp, '<TMP>').split('\n').filter(line => /^(Factory configuration|  "version":|  "projectRoot":|    "path":|    "schema":|      "project":|      "family":|      "units":|      "waitMinutes":|      "noPipelineMinutes":|    "implementationDefault":)/.test(line)).join('\n');
    assert.equal(humanProjection, `Factory configuration
  "version": 1,
  "projectRoot": "<TMP>/project",
    "path": "<TMP>/project/.factory/factory.toml",
    "schema": 2,
      "project": "owner/repo",
      "family": "openai"
      "units": "subtasks"
      "waitMinutes": 30,
      "noPipelineMinutes": 5
    "implementationDefault": "mid",`);
    const unreadable = capture(p, { project: root, json: true }, join(root, 'notes.md'));
    assert.equal(unreadable.code, 1); assert.equal(unreadable.value.errors[0].phase, 'instruction files');
    assert.match(unreadable.value.errors[0].message, /permissions/i);
    for (const target of ['.env', 'auth.json']) {
      rmSync(join(root, 'notes.md'));
      symlinkSync(target, join(root, 'notes.md'));
      const alias = capture(p, { project: root, json: true });
      assert.equal(alias.code, 1); assert.equal(alias.value.errors[0].phase, 'instruction files');
    }
    rmSync(join(root, 'notes.md')); writeFileSync(join(root, 'notes.md'), 'SECRET_INSTRUCTION_BODY');
    rmSync(config); symlinkSync(join(root, '.env'), config);
    const configAlias = capture(p, { project: root, json: true });
    assert.equal(configAlias.code, 1); assert.equal(configAlias.value.errors[0].phase, 'configuration');
    rmSync(config);
    writeFileSync(config, base + '\n[agent]\nfamily = "anthropic"\n');
    const explicit = capture(p, { project: root, json: true });
    assert.equal(explicit.code, 0); assert.equal(explicit.value.sources['agent.family'], 'explicit');
    assert.equal(explicit.value.policy.family, 'anthropic'); assert.deepEqual(explicit.value.policy.tiers, MODEL_POLICY.anthropic);
    assert.deepEqual(explicit.value.policy.roles, ROLE_TIERS);
    writeFileSync(config, base + '\n[work]\nunits = "issues"\n[ci]\nwait_minutes = 12\nno_pipeline_minutes = 3\n');
    const settings = capture(p, { project: root, json: true });
    assert.equal(settings.code, 0); assert.equal(settings.value.settings.work.units, 'issues');
    assert.equal(settings.value.sources['work.units'], 'explicit');
    assert.deepEqual(settings.value.settings.ci, { waitMinutes: 12, noPipelineMinutes: 3 });
    assert.equal(settings.value.sources['ci.wait_minutes'], 'explicit');
    cpSync(runtime.directory, join(root, 'override'), { recursive: true });
    writeFileSync(config, base + '\n[workflow]\nmode = "project"\ndirectory = "override"\n');
    const custom = capture(p, { project: root, json: true });
    assert.equal(custom.code, 0, custom.out); assert.equal(custom.value.workflow.behavior, 'opaque');
    assert.deepEqual(custom.value.policy, { configuredFamily: 'openai', actual: 'unknown', behavior: 'opaque' });
    rmSync(join(root, 'override/main.mts'));
    const invalidOverride = capture(p, { project: root, json: true });
    assert.equal(invalidOverride.code, 1); assert.equal(invalidOverride.value.errors[0].phase, 'workflow runtime'); assert.equal(invalidOverride.value.workflow, undefined);
    const cases = [
      ['missing project', base, join(tmp, 'missing'), 'project resolution'],
      ['invalid TOML', 'SECRET_ERROR_KEY = "SECRET_ERROR_VALUE', root, 'configuration'],
      ['version one', base.replace('version = 2', 'version = 1'), root, 'configuration'],
      ['unknown key', base + '\nSECRET_ERROR_KEY = "SECRET_ERROR_VALUE"\n', root, 'configuration'],
      ['missing instruction', base + '\n[instructions]\ncommon = ["missing.md"]\n', root, 'instruction files'],
      ['escaping instruction', base + '\n[instructions]\ncommon = ["../SECRET_INSTRUCTION_BODY.md"]\n', root, 'configuration'],
    ] as const;
    for (const [name, text, project, phase] of cases) {
      writeFileSync(config, text);
      const r = capture(p, { project, json: true }); assert.equal(r.code, 1, name); assert.equal(r.value.errors[0].phase, phase, name);
      assert.match(r.value.errors[0].message, /check/i, name);
    }
    rmSync(config); const missing = capture(p, { project: root, json: true }); assert.equal(missing.code, 1); assert.equal(missing.value.errors[0].phase, 'configuration');
    writeFileSync(config, base);
    const policyOverlay = join(root, '.factory/model-policy.mts');
    writeFileSync(policyOverlay, readFileSync(join(runtime.directory, 'model-policy.mts'), 'utf8').replaceAll('gpt-6.1-terra', 'fixture-selected-model'));
    const changed = bindExecution(root, {}, { paths: p });
    rmSync(policyOverlay);
    const differentPolicy = capture(p, { project: root, json: true });
    assert.equal(differentPolicy.code, 0, differentPolicy.out);
    assert.equal(differentPolicy.value.workflow.identity, changed.id);
    assert.deepEqual(differentPolicy.value.policy, { configuredFamily: 'openai', actual: 'unknown', behavior: 'unknown' });
    assert.match(differentPolicy.value.warnings.join(' '), /policy.*unknown/);
    writeFileSync(p.runtimeDescriptor, 'SECRET_SCRIPT_BODY');
    const invalidRuntime = capture(p, { project: root, json: true });
    assert.equal(invalidRuntime.code, 1); assert.equal(invalidRuntime.value.errors[0].phase, 'workflow runtime');
    rmSync(p.runtimeDescriptor);
    const descriptor = capture(p, { project: root, json: true }); assert.equal(descriptor.code, 1); assert.equal(descriptor.value.errors[0].phase, 'workflow runtime');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
