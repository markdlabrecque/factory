// Persist failed managed admission as a pass observation, not a ticket transition or a claim.
import { randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { admissionConflict, claimManagedEntry, keyFor, writeDurable, type AdmissionIdentity, type AdmissionState } from '../../board/admission.mts';
import { readBoundedText } from '../../orchestrator/ownership.mts';
import type { BatchIdentity } from './batch.mts';

export function claimBatchEntry(dir:string, store:string, batch:BatchIdentity, project:AdmissionIdentity, publish:(iid:number,status:'held',reason:string)=>void):string {
  let recorded=false;
  function refused(reason:string,state?:Readonly<AdmissionState>) {
    // Unique evidence survives an unreadable ledger, competing publisher or terminal member. It grants no permission.
    writeDurable(join(store,`entry-refused-${randomUUID()}.json`),JSON.stringify({version:1,batch:batch.id,at:new Date().toISOString(),status:'admission-held',reason,members:batch.members,nextAction:'Resolve the host admission fence and repeat this batch pass'})+'\n');
    recorded=true;
    if(!state || Object.values(state.entries).some(e=>admissionConflict(e.project,project))) return;
    // The shared lock excludes new claims and managed publishers. Never replace a run's observation or unknown evidence.
    for(const iid of batch.members) {
      const key=keyFor(String(iid),project.tracker.project);
      if(state.claims[key] || lstatSync(join(dir,key+'.json'),{throwIfNoEntry:false})) continue;
      const file=join(store,`selection-${iid}.json`);
      if(lstatSync(file,{throwIfNoEntry:false})) {
        try {
          const prior=JSON.parse(readBoundedText(file,1<<20,'member observation'));
          if(!['held','queued','selected','eligible'].includes(prior.status) || prior.iid!==iid || prior.batch!==batch.id) continue;
        } catch { continue; }
      }
      publish(iid,'held',reason);
    }
  }
  try { return claimManagedEntry(dir,project,refused); }
  catch(error) {
    if(!recorded) refused((error as Error).message); // no validated lock snapshot: immutable evidence only
    throw error;
  }
}
