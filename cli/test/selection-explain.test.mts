// Selection explanation uses fixture-owned runtimes and tracker commands, never live services.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { paths } from '../src/paths.mts';
import { selectionExplain } from '../src/commands/selection.mts';
import { regenerateRuntimeManifest } from '../src/runtime-bundle.mts';
import { factoryToml } from './config-fixture.mts';
import { bindExecution } from './execution-fixture.mts';

test('native selection reads filters, validates opaque overrides and never writes project state', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'selection-')), root = join(tmp, 'project'), p = paths(join(tmp, 'home'));
  const bin = join(tmp, 'bin'), logPath = join(tmp, 'calls'), marker = join(tmp, 'hostile');
  const oldPath = process.env.PATH, oldLog = process.env.STUB_LOG;
  mkdirSync(join(root, '.sandcastle'), { recursive: true }); mkdirSync(bin); mkdirSync(p.config, { recursive: true });
  const config = join(root, '.sandcastle/factory.toml');
  const settings = factoryToml('owner/repo') + '\n[selection]\nmilestone = "M"\nassignee = "alice"\nauthor = "bob"\nsearch = "needle"\nexclude_assignees = ["eve"]\n[selection.labels]\nall = ["ready"]\nnone = ["blocked"]\n[work]\nunits = "issues"\n';
  writeFileSync(config, settings);
  const runtime = bindExecution(root, {}, { paths: p, overlays: false });
  writeFileSync(p.projects, JSON.stringify({ version: 1, projects: [{ name: 'fixture', root }] }));
  writeFileSync(join(bin, 'gh'), `#!${process.execPath}\nconst fs = require('node:fs'); const a = process.argv.slice(2); fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(a)+'\\n');\nconst issue = {number: 7, title:'fixture', body:'', state:'OPEN', labels:[{name:'ready'}], assignees:[{login:'alice'}], author:{login:'bob'}, milestone:{title:'M'}};\nif (a[0] === 'issue' && a[1] === 'view') console.log(JSON.stringify(issue));\nelse if (a[0] === 'issue' && a[1] === 'list') console.log(JSON.stringify(process.env.STUB_CAP ? Array(1000).fill(issue) : process.env.STUB_PARENT ? [{...issue, number: 8}] : [issue]));\nelse if (a[0] === 'api' && a[1] === 'graphql') console.log(JSON.stringify({data:{repository:{i7:{parent:{number:8},subIssues:{nodes:[]}}}}}));\nelse throw Error('unexpected command '+JSON.stringify(a));\n`, { mode: 0o755 });
  process.env.PATH = bin; process.env.STUB_LOG = logPath;
  const capture = async () => { let out = ''; const saved = console.log; console.log = (...a) => { out += a.join(' '); }; try { const code = await selectionExplain(p, 'explain', '7', { project: 'fixture', json: true }); return { code, value: JSON.parse(out) }; } finally { console.log = saved; } };
  try {
    let r = await capture(); assert.equal(r.code, 0, JSON.stringify(r.value)); assert.equal(r.value.eligibility, 'selected'); assert.equal(r.value.workflow.mode, 'factory');
    const calls = readFileSync(logPath, 'utf8').trim().split('\n').map(x => JSON.parse(x));
    assert.equal(calls.length, 2); assert.deepEqual(calls[1], ['issue','list','-R','owner/repo','--state','open','--json','number,title,body,state,labels,assignees,author,milestone','--search','-label:"blocked" sort:created-asc needle','--label','ready','--milestone','M','--assignee','alice','--author','bob','--limit','1000']);
    assert.equal(existsSync(p.state), false);
    process.env.STUB_CAP = '1'; r = await capture(); assert.equal(r.code, 1); assert.equal(r.value.eligibility, 'unknown'); delete process.env.STUB_CAP;
    writeFileSync(config, settings.replace('units = "issues"', 'units = "subtasks"')); process.env.STUB_PARENT = '1';
    r = await capture(); assert.equal(r.value.eligibility, 'selected'); assert.equal(r.value.inheritedFrom, 8); delete process.env.STUB_PARENT;
    writeFileSync(config, settings);
    const override = join(root, 'override'); cpSync(runtime.directory, override, { recursive: true });
    writeFileSync(join(override, 'tracker.mts'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'executed'); throw Error('hostile');`);
    writeFileSync(join(override, 'runtime-manifest.json'), JSON.stringify(regenerateRuntimeManifest(override)));
    writeFileSync(config, settings + '\n[workflow]\nmode = "project"\ndirectory = "override"\n');
    r = await capture(); assert.equal(r.code, 0); assert.equal(r.value.workflow.behavior, 'opaque'); assert.equal(r.value.workflow.actualSelection, 'unknown'); assert.equal(r.value.workflow.root, override); assert.match(r.value.workflow.identity, /^[a-f0-9]{64}$/); assert.equal(existsSync(marker), false);
    const before = readFileSync(logPath, 'utf8'); rmSync(join(override, 'tracker.mts'));
    await assert.rejects(capture(), /Invalid project workflow/); assert.equal(readFileSync(logPath, 'utf8'), before); assert.equal(existsSync(marker), false); assert.equal(existsSync(p.state), false);
  } finally { delete process.env.STUB_CAP; delete process.env.STUB_PARENT; if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath; if (oldLog === undefined) delete process.env.STUB_LOG; else process.env.STUB_LOG = oldLog; rmSync(tmp, { recursive: true, force: true }); }
});
