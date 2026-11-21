// Complete frozen original ticket and instruction inputs across refresh.
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

test('dispatch incomplete parent input creates no run or analysis; the next complete pass can launch', t => {
  const f = fixture(t);
  f.data.parents[7] = 90;
  f.data.tickets.push(ticket(90, {description:'Parent plan',contextOnly:true}));
  f.data.errors = [90];
  const held = f.pass();
  assert.match(held.stdout,/Ticket-input hold: parent #90 ticket: read-failed/);
  assert.equal(f.bytes(join(f.fake,'analysis.jsonl')),'absent');
  assert.equal(f.bytes(join(f.fake,'launches')),'absent');
  assert.equal(f.bytes(join(f.dir,`${f.key(7)}.json`)),'absent','no stopped or queued run is manufactured');
  f.data.errors = [];
  f.data.tickets[0].description = 'Model tier: mid\nSelf-contained requirement';
  f.baseline();
  f.pass();
  assert.match(f.bytes(join(f.fake,'launches')),/--issue 7/);
});

test('unknown stopped-ticket input cannot count a jam, renew budgets or block an unrelated launch', t => {
  const f = fixture(t); f.record(7, 'stopped');
  f.data.parents[7] = 90;
  f.data.tickets.push(ticket(90, {description:'Parent plan',contextOnly:true}), ticket(8, {description:'Model tier: mid\nSelf-contained work'}));
  f.data.ready = [7,8]; f.data.errors = [90];
  f.baseline(8);
  const report = join(f.home,'jam.json');
  const result = f.pass([], {FACTORY_JAM_REPORT:report,FACTORY_PASS_ID:'fixture-pass'});
  assert.match(result.stdout,/jam observation not counted/);
  assert.equal(existsSync(report),false,'no partial recovery fingerprint is published');
  assert.match(f.bytes(join(f.fake,'launches')),/--issue 8/);
  assert.doesNotMatch(f.bytes(join(f.fake,'launches')),/--issue 7/);
});

test('analysis includes frozen complete child/parent plan bytes and parent edits revoke cache, generated notes do not', t => {
  const f = fixture(t); f.record(7, 'stopped');
  f.data.parents[7] = 90;
  f.data.tickets.push(ticket(90, { title: 'Parent specification', description: 'Complete packaging specification', contextOnly: true }));
  f.data.notes[90] = [{ body: '<details>Agreed decisions and implementation plan</details>' }];
  f.data.notes[7] = [{ body: 'Complete child acceptance details' }];
  const calls = () => f.bytes(join(f.fake, 'analysis.jsonl')).trim().split('\n').map(line => JSON.parse(line));
  f.pass(['--refresh-only', '--ticket', '7']);
  const first = calls()[0].input;
  for (const text of ['Complete packaging specification', 'Agreed decisions and implementation plan', 'Complete child acceptance details']) assert.ok(first.includes(text));
  const inputs = join(f.dir, 'ticket-inputs', f.key(7), 'analysis');
  const inputDir = join(inputs, readdirSync(inputs)[0]);
  assert.ok(first.includes(f.bytes(join(inputDir, 'ticket-context.txt'))));
  assert.equal(JSON.parse(f.bytes(join(inputDir, 'ticket-context.json'))).contentHash, f.assessment().analysis?.hash);
  f.pass(['--refresh-only', '--ticket', '7']); assert.equal(calls().length, 1);
  f.data.notes[90].push({body:'## Sandcastle: verification\nGenerated proof\n<!-- sandcastle -->'});
  f.pass(['--refresh-only', '--ticket', '7']); assert.equal(calls().length, 1);
  f.data.notes[90][0].body = '<details>Changed parent plan</details>';
  f.pass(['--refresh-only', '--ticket', '7']); assert.equal(calls().length, 2);
  assert.match(calls()[1].input, /Changed parent plan/);
  assert.ok(first.includes('Agreed decisions and implementation plan'), 'active prompt stays frozen');
});

test('refresh analyzes with frozen analysis instructions and invalidates the cache when bytes change', t => {
  const f = fixture(t); f.record(7, 'stopped');
  for (const [name, text] of Object.entries({ common: 'COMMON {{TICKET}} !`literal`', analysis: 'ANALYSIS ONLY', implementation: 'IMPLEMENTATION ONLY', verification: 'VERIFICATION ONLY', recovery: 'RECOVERY ONLY' })) writeFileSync(join(f.root, `${name}.md`), text);
  const config = join(f.root, '.factory/factory.toml');
  writeFileSync(config, f.bytes(config) + '\n[instructions]\ncommon = ["common.md"]\nanalysis = ["analysis.md"]\nimplementation = ["implementation.md"]\nverification = ["verification.md"]\nrecovery = ["recovery.md"]\n');
  const calls = () => f.bytes(join(f.fake, 'analysis.jsonl')).trim().split('\n').map(line => JSON.parse(line));
  f.pass(['--refresh-only', '--ticket', '7']);
  assert.equal(f.assessment().analysisState, 'current', f.assessment().analysisError);
  const first = calls()[0].input;
  assert.match(first, /COMMON \{\{TICKET\}\} !`literal`/); assert.match(first, /ANALYSIS ONLY/);
  for (const role of ['IMPLEMENTATION', 'VERIFICATION', 'RECOVERY']) assert.ok(!first.includes(`${role} ONLY`));
  assert.match(first, /Reply with one JSON object/);
  f.pass(['--refresh-only', '--ticket', '7']);
  assert.equal(calls().length, 1, 'unchanged cache is reused');
  writeFileSync(join(f.root, 'analysis.md'), 'ANALYSIS CHANGED');
  f.pass(['--refresh-only', '--ticket', '7']);
  assert.equal(calls().length, 2, 'changed bytes require another real analysis');
  assert.match(calls()[1].input, /ANALYSIS CHANGED/);
  assert.match(first, /ANALYSIS ONLY/, 'captured invocation retains frozen text');
});

test("refresh fixtures override a missing inherited Pi extension with their own stub boundary", (t) => {
  const old = process.env.FACTORY_PI_SUBSCRIPTION_EXTENSION;
  process.env.FACTORY_PI_SUBSCRIPTION_EXTENSION = "/fixture-missing-provider/index.ts";
  t.after(() => {
    if (old === undefined) delete process.env.FACTORY_PI_SUBSCRIPTION_EXTENSION;
    else process.env.FACTORY_PI_SUBSCRIPTION_EXTENSION = old;
  });
  const f = fixture(t); f.record(7, "stopped");
  assert.equal(f.env.FACTORY_PI_SUBSCRIPTION_EXTENSION, join(f.fake, "subscription-extension.ts"));
  f.pass(["--refresh-only", "--ticket", "7"]);
  assert.equal(f.assessment().analysisState, "current", f.assessment().analysisError);
  const calls = f.bytes(join(f.fake, "analysis.jsonl")).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args[calls[0].args.indexOf("-e") + 1], f.env.FACTORY_PI_SUBSCRIPTION_EXTENSION);
});

