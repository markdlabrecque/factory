// Frozen sandbox-only probe of the disposable baseline's existing export API and synthetic site state.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { networkInterfaces } from 'node:os';
const root=process.env.FACTORY_BASELINE_ROOT,state=process.env.FACTORY_STATE_ROOT;
assert.equal(root,'/work');assert.equal(state,'/state');
assert.equal(process.env.FACTORY_ACCEPTANCE_ROOT,'/input/acceptance');
assert.equal(process.env.GITHUB_TOKEN,undefined);assert.equal(process.env.SSH_AUTH_SOCK,undefined);
assert.ok(process.argv[2],'fixture must name a known-existing host project');
assert.equal(existsSync(process.argv[2]),false,'host source and dirty site are not mounted');
assert.ok(Object.keys(networkInterfaces()).every(name=>name==='lo'),'no host network interface');
assert.equal(readFileSync(`${state}/site/setup.txt`,'utf8'),'pinned setup executed');
assert.equal(readFileSync(`${state}/site/uploads/seed.txt`,'utf8'),'seed upload');
assert.equal(existsSync(`${state}/site/uploads/dirty.txt`),false);
const rows=JSON.parse(readFileSync(`${state}/site/rows.json`,'utf8'));
assert.deepEqual(rows,[1,2]);
const sha=execFileSync('/usr/bin/git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.match(sha,/^[a-f0-9]{40}$/);
const api=await import(`${root}/export.mjs`);
const ordered=api.rows(rows);
const summary=typeof api.summary==='function'?api.summary(rows):null;
assert.deepEqual(ordered,[1,2]);
assert.throws(()=>writeFileSync('/input/acceptance/fixtures/rows.json','tampered'),{code:'EROFS'});
assert.throws(()=>writeFileSync('/input/plan.json','tampered'),{code:'EROFS'});
// Observe real writable, persistent dirt after checking the seed. A later fresh execution must not inherit it.
writeFileSync(`${state}/site/rows.json`,'[999]');
writeFileSync(`${state}/site/uploads/dirty.txt`,'prior-run dirt');
console.error(JSON.stringify({sha,seed:rows,upload:'seed upload',setup:'pinned setup executed',readOnlyInput:true,hostProjectVisible:false,syntheticOnly:true}));
process.stdout.write(JSON.stringify({version:1,assertions:[
  {assertionId:'A-summary',status:summary===3?'pass':'expected-behavioral-fail',failureId:summary===3?null:'summary-unavailable-or-wrong'},
  {assertionId:'A-order',status:'pass',failureId:null}
]}));
