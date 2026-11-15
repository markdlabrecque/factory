// Native explanation tracker reads use fake commands and fixture-owned configuration.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadTomlConfig } from '../../orchestrator/project-config.mts';
import { nativeGitlab } from '../../orchestrator/selection-tracker.gitlab.mts';
import { factoryToml } from './config-fixture.mts';

test('GitLab native read applies filters and refuses missing confidentiality facts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'native-tracker-')), bin = join(dir, 'bin'), old = { ...process.env };
  mkdirSync(bin); writeFileSync(join(dir, 'factory.toml'), factoryToml('group/project', { kind: 'gitlab' }) + '\n[selection]\nconfidential = false\nissue_type = "issue"\nsearch = "term"\nmilestone = "M"\n[selection.labels]\nall = ["ready"]\nnone = ["blocked"]\n');
  const log = join(dir, 'calls');
  writeFileSync(join(bin, 'glab'), `#!${process.execPath}\nconst fs = require('node:fs'); const a = process.argv.slice(2); fs.appendFileSync(process.env.STUB_LOG, JSON.stringify(a)+'\\n'); if (a[0] === 'issue' && a[1] === 'list') console.log(JSON.stringify([{iid:7,confidential:false},{iid:8,confidential:true}])); else if (a[0] === 'api' && a[1].includes('/issues/7')) console.log(JSON.stringify({iid:7,state:'opened',labels:[]})); else throw Error('unexpected command');\n`, { mode: 0o755 });
  process.env.PATH = bin; process.env.STUB_LOG = log;
  try {
    const c = loadTomlConfig(dir), tracker = nativeGitlab(c);
    assert.equal(tracker.ticket(7).iid, 7); assert.deepEqual(tracker.readyList(c.selection).map(x => x.iid), [7]);
    const calls = readFileSync(log, 'utf8').trim().split('\n').map(x => JSON.parse(x));
    assert.deepEqual(calls[1], ['issue','list','-R','group/project','--per-page','100','--output','json','--order','created_at','--sort','asc','--label','ready','--not-label','blocked','--milestone','M','--issue-type','issue','--search','term','--page','1']);
    writeFileSync(join(bin, 'glab'), `#!${process.execPath}\nconsole.log(JSON.stringify([{iid:7}]));\n`, { mode: 0o755 });
    assert.throws(() => tracker.readyList(c.selection), /selection is unknown/);
  } finally { process.env.PATH = old.PATH; if (old.STUB_LOG === undefined) delete process.env.STUB_LOG; else process.env.STUB_LOG = old.STUB_LOG; rmSync(dir, { recursive: true, force: true }); }
});
