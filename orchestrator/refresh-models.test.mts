// Tracker dependency and model resolution integration with unchanged attempt preservation.
import { createProof } from './verification.mts';
import { bindExecution, executionSnapshot } from '../cli/test/execution-fixture.mts';
import { modelForRole } from './model-policy.mts';
import { prepareRuntimeBundle } from '../cli/src/runtime-bundle.mts';
import { installPackages } from '../cli/test/runtime-fixture.mts';
import { recordRuntimeOwnership, withRuntimeLock, writeRuntimeDescriptor } from '../cli/src/runtime-ownership.mts';
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildAssets } from "../cli/src/scaffold.mts";
import { readAssessment, requestRefresh } from "../board/assessment.mts";
import { fixtureTicketHash } from './fixtures/ticket-input.mts';

import { FIXTURES, git, ticket, fixture } from "./refresh-fixture.mts";

for (const kind of ["github", "gitlab"]) {
  test(`${kind}: unknown implementer dependencies hold dispatch and recover without ticket edits`, t => {
    const f = fixture(t, kind);
    f.data.tickets[0].description = "Model tier: mid\nRequirement DEP:20";
    f.record(7, "queued");
    // A provider outside the open catalogue must be read, never presumed satisfied.
    f.data.tickets[1].contextOnly = true;
    f.data.errors = [20];
    f.manifest(7);
    const path = join(f.dir, "graph", `${f.key(7)}.json`);
    const manifest = JSON.parse(f.bytes(path));
    manifest.implementerBlockers = [{ iid: 20, what: "provider", evidence: "implementer report" }];
    writeFileSync(path, JSON.stringify(manifest));
    const held = f.pass();
    assert.match(held.stdout, /#20.*information unavailable/);
    assert.equal(existsSync(join(f.fake, "launches")), false);
    assert.equal(JSON.parse(f.bytes(join(f.dir, `${f.key(7)}.json`))).stage, "queued");
    assert.equal(f.assessment().dependencies?.find(d => d.iid === 20)?.state, "unknown");
    f.data.errors = [];
    f.data.tickets[1].state = "closed";
    f.baseline();
    f.pass();
    assert.match(f.bytes(join(f.fake, "launches")), /--issue 7/);
    assert.equal(f.assessment().dependencies?.find(d => d.iid === 20)?.state, "satisfied");
    const calls = f.bytes(join(f.fake, "tracker.jsonl"));
    assert.doesNotMatch(calls, /"(?:edit|comment|close|create)"/);
  });

  test(`${kind}: failed merge reads hold an open dependency until a later qualifying merge`, t => {
    const f = fixture(t, kind);
    f.data.tickets[0].description = "Model tier: mid\nRequirement DEP:20";
    f.record(7, "queued"); f.record(20, "waiting"); f.manifest(7);
    const path = join(f.dir, "graph", `${f.key(7)}.json`), manifest = JSON.parse(f.bytes(path));
    manifest.implementerBlockers = [{ iid: 20, what: "provider", evidence: "missing" }];
    writeFileSync(path, JSON.stringify(manifest));
    f.data.mergeErrors = ["20-topic"];
    assert.match(f.pass().stdout, /#20.*information unavailable/);
    assert.equal(existsSync(join(f.fake, "launches")), false);
    assert.equal(f.assessment().dependencies?.find(d => d.iid === 20)?.state, "unknown");
    f.data.mergeErrors = []; f.data.merged = ["20-topic"];
    f.baseline();
    f.pass();
    assert.match(f.bytes(join(f.fake, "launches")), /--issue 7/);
  });

  test(`${kind}: implementer lookup errors persist waitable blockers without needs-human`, t => {
    const f = fixture(t, kind);
    f.data.tickets[0].description = "Model tier: mid\nRequirement DEP:20";
    f.data.tickets[1].contextOnly = true;
    f.data.errors = [20];
    f.save();
    writeFileSync(join(dirname(f.node), 'docker'), `#!${process.execPath}\nimport { existsSync } from 'node:fs'; import { join } from 'node:path'; import { capabilityDocker } from ${JSON.stringify(join(import.meta.dirname, 'fixtures/capability-docker.mjs'))}; const args = process.argv.slice(2); if (JSON.stringify(args) === JSON.stringify(['container','inspect','fixture-implementer']) && existsSync(join(process.env.FAKE_STATE,'implementer-closed'))) { console.error('No such container'); process.exit(1); } const out = capabilityDocker(args, process.env.FAKE_STATE); if (out === undefined) process.exit(90); console.log(out);`, { mode: 0o755 });
    const module = join(f.root, "node_modules/@ai-hero/sandcastle");
    mkdirSync(join(module, "sandboxes"), { recursive: true });
    writeFileSync(join(module, "package.json"), JSON.stringify({ type: "module", exports: { ".": "./index.mjs", "./sandboxes/docker": "./sandboxes/docker.mjs" } }));
    writeFileSync(join(module, "sandboxes/docker.mjs"), "export const docker = (options) => options;\n");
    writeFileSync(join(module, "index.mjs"), `
      import { execFileSync } from 'node:child_process';
      import { writeFileSync, rmSync } from 'node:fs';
      import { join } from 'node:path';
      export const pi = () => ({}), claudeCode = pi;
      export const createSandbox = async ({branch, baseBranch, sandbox}) => {
        execFileSync('git', ['branch', branch, baseBranch]);
        const closed = join(process.env.FAKE_STATE,'implementer-closed'); rmSync(closed, {force:true});
        return { sandboxId:'fixture-implementer', close: async () => {writeFileSync(closed, 'yes');}, exec: async command => ({stdout: command === 'git rev-parse --verify HEAD' ? execFileSync('git', ['rev-parse', branch], {encoding:'utf8'}) : command.includes('status --porcelain') ? '' : 'browser preflight OK', exitCode:0}), run: async () => {
          writeFileSync(sandbox.mounts[0].hostPath + '/blocked.json', JSON.stringify({blockers: [{iid:20, what:'provider', evidence:'missing API'}]}));
          return {commits: []};
        }};
      };
    `);
    const mainRuntime = bindExecution(f.root, f.env, { overlays: false });
    for (const errorMessage of ["authentication failed secret-token", "rate limit exceeded secret-token", "transport timeout secret-token"]) {
      f.data.errorMessage = errorMessage; f.save();
      const r = spawnSync(f.node, [join(mainRuntime.directory, 'main.mts'), "--issue", "7", "--base", "main"], { cwd: f.root, env: mainRuntime.env, encoding: "utf8", timeout: 20_000 });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const record = JSON.parse(f.bytes(join(f.dir, `${f.key(7)}.json`)));
      assert.equal(record.stage, "waiting");
      assert.match(record.note, /dependency information unavailable/);
      assert.doesNotMatch(record.note, /secret-token/);
      const manifest = JSON.parse(f.bytes(join(f.dir, "graph", `${f.key(7)}.json`)));
      assert.equal(manifest.implementerBlockers[0].iid, 20);
      assert.equal(git(f.root, "branch", "--list", "7-*"), "");
    }
    assert.doesNotMatch(f.bytes(join(f.fake, "tracker.jsonl")), /"(?:edit|comment|close|create)"/);
    f.data.errors = []; f.data.tickets[1].state = "closed";
    f.baseline();
    f.pass();
    assert.match(f.bytes(join(f.fake, "launches")), /--issue 7/);
  });

  test(`${kind}: TOML cap counts other projects and CLI cap/work overrides report their sources`, t => {
    const f = fixture(t, kind);
    f.data.tickets[0].description = 'Model tier: mid';
    const path = join(f.root, '.factory/factory.toml');
    writeFileSync(path, f.bytes(path).replace('max_concurrent = 3', 'max_concurrent = 1').replace('units = "subtasks"', 'units = "issues"'));
    writeFileSync(join(f.dir, 'another_project--99.json'), JSON.stringify({
      iid: '99', project: 'another/project', stage: 'implementing', pid: process.pid,
    }));
    f.manifest(7);
    const held = f.pass(['--dry-run']);
    assert.match(held.stdout, /1 active run\(s\), cap 1 \(source: factory\.toml dispatch\.max_concurrent\)/);
    assert.match(held.stdout, /work: issues \(source: factory\.toml work\.units\)/);
    assert.doesNotMatch(held.stdout, /would launch/);
    const overridden = f.pass(['--dry-run', '--max', '2', '--whole-issues']);
    assert.match(overridden.stdout, /cap 2 \(source: --max\)/);
    assert.match(overridden.stdout, /work: issues \(source: --whole-issues\)/);
    assert.match(overridden.stdout, /#7 .*would launch/);
    assert.equal(existsSync(join(f.fake, 'launches')), false);
  });

  test(`${kind}: description failures queue without model labels, edits refresh the choice but not the attempt`, (t) => {
    const f = fixture(t, kind);
    f.data.tickets = [ticket(7, { description: "Model tier: unknown" }), ticket(8, { description: "Model: sonnet" }),
      ticket(9, { description: "Model tier: small\nModel tier: large" })];
    f.data.ready = [7, 8, 9];
    f.pass();
    for (const [n, status] of [[7, "unsupported"], [8, "unsupported"], [9, "conflicting"]] as const) {
      assert.equal(JSON.parse(f.bytes(join(f.dir, `${f.key(n)}.json`))).stage, "queued");
      assert.equal(f.assessment(n).modelResolution?.status, status);
      assert.ok(f.assessment(n).modelResolution?.revision);
    }
    assert.equal(existsSync(join(f.fake, "launches")), false);
    // Prepare the later independent ticket before the fixture starts other project work.
    const oldDescription = f.data.tickets[1].description;
    f.data.tickets[1].description = 'No declaration defaults to mid'; f.baseline(8);
    f.data.tickets[1].description = oldDescription;
    const original = JSON.parse(f.record(7, "implementing"));
    original.implementationModel = "attempt-original-model";
    writeFileSync(join(f.dir, `${f.key(7)}.json`), JSON.stringify(original));
    f.data.tickets[0].description = "Model tier: mid\nNew requirements";
    f.pass(["--refresh-only", "--ticket", "7"]);
    const resolved = f.assessment().modelResolution!;
    assert.equal(resolved.status, "resolved");
    assert.deepEqual(resolved.declarations, ["mid"]);
    assert.notEqual(resolved.revision, undefined);
    assert.deepEqual(JSON.parse(f.bytes(join(f.dir, `${f.key(7)}.json`))), original);
    f.data.tickets[0].description = "Model tier: large";
    f.pass(["--refresh-only", "--ticket", "7"]);
    assert.notEqual(f.assessment().modelResolution!.revision, resolved.revision);
    assert.notDeepEqual(f.assessment().modelResolution, resolved);
    assert.deepEqual(JSON.parse(f.bytes(join(f.dir, `${f.key(7)}.json`))), original);
    f.data.tickets[1].description = 'No declaration defaults to mid';
    f.manifest(8);
    f.pass();
    assert.equal(f.assessment(8).modelResolution?.status, 'resolved');
    assert.equal(f.assessment(8).modelResolution?.choice?.tier, 'mid');
    assert.equal(f.assessment(8).modelResolution?.choice?.source, 'factory-default');
    assert.equal(JSON.parse(f.bytes(join(f.dir, `${f.key(8)}.json`))).stage, 'setup', 'an edited valid declaration becomes dispatchable without a model label');
  });
}

