// First host in the offline resume journey. Only fixture Git and the caller's private Docker/Pi stubs.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runStandardBatchMember } from '../batch-review.mts';
import { loadTomlConfig } from '../project-config.mts';
const {member,configRoot,records,advanced}=JSON.parse(readFileSync(0,'utf8'));
member.observeHead=async()=>{
  if(!readFileSync(records,'utf8'))return {kind:'owned',head:member.expectedHead};
  execFileSync('git',['-c','core.hooksPath=/dev/null','update-ref',member.destination,advanced,member.expectedHead],{cwd:member.repo});
  return {kind:'unknown',head:advanced};
};
try {await runStandardBatchMember(member,loadTomlConfig(configRoot),'sha256:'+'a'.repeat(64),()=> 'fixture-only');throw Error('unexpected completion')}
catch(e){console.log(String(e))}
