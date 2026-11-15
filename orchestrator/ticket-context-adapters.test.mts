// Exercise configured adapter subprocess limits with fixture-owned gh/glab, never real tracker/auth CLIs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyTestRuntime, factoryToml } from '../cli/test/config-fixture.mts';
const dir = mkdtempSync(join(tmpdir(), 'factory-context-adapters-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const script = join(dir, 'tracker.mjs'), log = join(dir, 'calls.jsonl');
writeFileSync(log, '');
writeFileSync(script, `
import { appendFileSync } from 'node:fs';
const [tool, ...args] = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({tool, args})+'\\n');
if (args[0] !== 'api') throw Error('unexpected human CLI operation');
if (process.env.CONTEXT_TEST_MODE === 'timeout') { setInterval(()=>{},1000); }
else if (process.env.CONTEXT_TEST_MODE === 'bytes') console.log('é'.repeat(100000));
else if (process.env.CONTEXT_TEST_MODE === 'fail') { console.error('private upstream error'); process.exit(7); }
else if (args[1] === 'graphql') console.log(JSON.stringify(tool === 'gh'
  ? {data:{repository:{issue:{parent:null}}}}
  : {data:{project:{workItems:{nodes:[{iid:'161',workItemType:{name:'Task'},widgets:[{parent:null}]}]}}}}));
else if (args[1].includes('?')) console.log('[]');
else if (/issues\\/161$/.test(args[1])) console.log(JSON.stringify(tool === 'gh'
  ? {number:161,title:'Full specification',body:'No truncation'}
  : {iid:161,title:'Full specification',description:'No truncation'}));
else throw Error('unexpected endpoint');
`);
for (const tool of ['gh', 'glab']) writeFileSync(join(dir, tool),
  `#!/bin/sh\nexec "${process.execPath}" "${script}" ${tool} "$@"\n`, { mode: 0o755 });
process.env.PATH = `${dir}:${process.env.PATH}`;
const moduleUrl = copyTestRuntime(join(dir, 'runtime'), factoryToml('owner/repo', { kind: 'gitlab', projectId: 42 }));
const github = await import(moduleUrl('tracker.github.mts')), gitlab = await import(moduleUrl('tracker.gitlab.mts'));
const { collectTicketContext } = await import(moduleUrl('ticket-context.mts'));
for (const [tool, adapter] of [['gh', github], ['glab', gitlab]] as const) {
  test(`${tool}: configured bounded contextSource uses structured API only`, () => {
    delete process.env.CONTEXT_TEST_MODE;
    const result = collectTicketContext(adapter.contextSource, 161);
    assert.equal(result.status, 'complete', JSON.stringify(result));
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(s => JSON.parse(s)).filter(c => c.tool === tool);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(c => c.args[0] === 'api'));
    if (tool === 'glab') assert.ok(calls.every(c => c.args.slice(-2).join(' ') === '--hostname git.example.com'));
  });
  test(`${tool}: subprocess timeout/output/exit failures are typed safe holds`, () => {
    for (const [mode, reason] of [['timeout', 'timeout'], ['bytes', 'byte-limit'], ['fail', 'read-failed']] as const) {
      process.env.CONTEXT_TEST_MODE = mode;
      try {
        const result = collectTicketContext(adapter.contextSource, 161, { limits: { timeoutMs: mode === 'timeout' ? 50 : 5000, maxBytes: 4096 } });
        assert.equal(result.status, 'hold');
        if (result.status === 'hold') { assert.equal(result.reason, reason); assert.equal(result.operation, 'ticket'); }
        assert.ok(!JSON.stringify(result).includes('private upstream error'));
      } finally { delete process.env.CONTEXT_TEST_MODE; }
    }
  });
}
