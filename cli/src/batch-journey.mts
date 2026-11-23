// Serialize foreground batch passes, distinguish observed effects from approval, and freeze the terminal operator handoff.
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { writeDurable } from '../../board/admission.mts';
import { readBoundedText } from '../../orchestrator/ownership.mts';
import { batchCommandStore, inspectBatchHead, readOwnedBatch, resumeBatch, type BatchIdentity } from './batch.mts';
import { batchDeliveryObserver, readBatchDelivery, readBatchGate } from './batch-delivery.mts';
import { dispatchBatch } from './batch-dispatch.mts';
import { batchRegistration } from './project-registry.mts';
import type { Paths } from './paths.mts';

function saved(file:string) {
  const st=lstatSync(file,{throwIfNoEntry:false});
  if(!st)return undefined;
  if(!st.isFile()||st.nlink!==1||st.uid!==process.getuid?.()||(st.mode&0o077))throw Error('Unsafe batch status file');
  const value=JSON.parse(readBoundedText(file,1<<20,'batch status'));
  if(!value || typeof value!=='object')throw Error('Invalid batch status');
  return value;
}
function summarize(p:Paths,project:string,dir:string,b:BatchIdentity,observedHead:string|null,error:string|null) {
  const observe=batchDeliveryObserver(p,project);
  const outcomes=b.members.map(iid=>{
    const key={project,batch:b.id,ticket:iid}, record=readBatchDelivery(p,key);
    const selection=saved(join(dir,`selection-${iid}.json`));
    if(selection && (selection.batch!==b.id || selection.iid!==iid))throw Error('Mismatched selection observation');
    const attempt=record?null:readBatchGate(p,key), fact=observe(b,iid);
    const status=fact.state==='landed'?'merged':fact.state==='unknown'?'held':record || selection?.status==='stopped' || selection?.status==='waiting' && attempt?.evidence?.status==='approved'?'stopped':'held';
    const reason=fact.state==='unknown'?`${fact.reason}; ${record?.reason??error??'inspect the host evidence'}`:record?.reason??selection?.reason??error??'Member has no dispatch observation';
    return {iid,status,gate:record?.gate??attempt?.evidence?.status??(attempt?'unconfirmed':'not-observed'),
      git:record?.git??'not-started',tracker:record?.tracker??'not-started',candidate:record?.binding.candidate??attempt?.binding.candidate??null,
      reason,prerequisites:(selection?.prerequisites??[]) as number[],nextAction:status==='merged'?null:status==='stopped'?'Inspect the saved gate and delivery evidence; do not replay publication':selection?.nextAction??'Resolve the hold and resume the batch'};
  });
  // A dependant of a terminal failure cannot become runnable in this batch, even through a chain of holds.
  const stopped=new Set(outcomes.filter(o=>o.status==='stopped').map(o=>o.iid));
  for(let n=0;n<outcomes.length;n++) {
    const size=stopped.size;
    for(const o of outcomes)if(o.status==='held' && o.prerequisites.some(i=>stopped.has(i)))stopped.add(o.iid);
    if(size===stopped.size)break;
  }
  const terminal=!error && observedHead===b.expectedHead && outcomes.every(o=>o.status==='merged'||stopped.has(o.iid));
  if(terminal)for(const o of outcomes)if(o.status==='held') {
    o.reason='Held behind stopped work: '+o.prerequisites.filter(i=>stopped.has(i)).map(i=>'#'+i).join(', ');
    o.nextAction='Inspect the stopped prerequisite; this batch will not restart';
  }
  return {...b,status:terminal?'handed-off':'held',observedHead,outcomes,...(error?{error}:{})};
}
export async function continueBatch(p:Paths,selector:string,id:string,singlePass=false) {
  const project=batchRegistration(p,selector).root,dir=batchCommandStore(p,project,id),file=join(dir,'handoff.json');
  function historical(){
    const result=saved(file);
    if(result && (result.id!==id || result.root!==project || result.status!=='handed-off'))throw Error('Invalid historical batch handoff');
    return result;
  }
  const previous=historical();if(previous)return previous;
  // Separate from short claim/ref mutexes. SQLite releases this private coordinator fence on process death.
  const dbFile=join(dir,'command.sqlite'),existing=lstatSync(dbFile,{throwIfNoEntry:false});
  if(existing && (!existing.isFile() || existing.nlink!==1 || existing.uid!==process.getuid?.()))throw Error('Unsafe batch command mutex');
  const mutex=new DatabaseSync(dbFile);
  try {
    chmodSync(dbFile,0o600);
    try {mutex.exec('BEGIN IMMEDIATE')} catch(e){
      if((e as {errcode?:number}).errcode===5)throw Error('Another batch command is active; resume when it finishes');
      throw e;
    }
    const concurrent=historical();if(concurrent)return concurrent;
    let progress=false;
    try {
      resumeBatch(p,project,id);
      do {
        progress=false;
        await dispatchBatch(p,project,id,batchDeliveryObserver(p,project),undefined,()=>{progress=true},singlePass?console.log:console.error);
        const b=readOwnedBatch(p,project,id), result=summarize(p,project,dir,b,b.expectedHead,null);
        if(result.status==='handed-off'){
          if(readOwnedBatch(p,project,id).expectedHead!==result.observedHead)throw Error('Batch moved before handoff; inspect the remote branch');
          writeDurable(file,JSON.stringify(result)+'\n');return result;
        }
        if(singlePass || !progress)return result;
      } while(progress);
    } catch(e){
      // Never substitute the last settled SHA for an unknown/drifted actual ref, nor retry a refused push.
      const {b,observedHead}=inspectBatchHead(p,project,id);
      return summarize(p,project,dir,b,observedHead,(e as Error).message);
    }
  } finally {mutex.close()}
}
