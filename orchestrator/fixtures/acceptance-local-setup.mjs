// Sandbox-only synthetic site/state recipe, committed into the disposable baseline by the runner test.
// This filesystem-backed state is deliberately NOT a CMS or SQL database installation.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const state=process.env.FACTORY_STATE_ROOT;
if(existsSync(`${state}/site`))throw Error('Unsupported reset: persistent dirty synthetic site');
assert.equal(process.env.GITHUB_TOKEN,undefined);
mkdirSync(`${state}/site/uploads`,{recursive:true});
const rows=JSON.parse(readFileSync(`${process.env.FACTORY_ACCEPTANCE_ROOT}/fixtures/rows.json`,'utf8'));
writeFileSync(`${state}/site/rows.json`,JSON.stringify(rows));
writeFileSync(`${state}/site/uploads/seed.txt`,'seed upload');
writeFileSync(`${state}/site/setup.txt`,'pinned setup executed');
