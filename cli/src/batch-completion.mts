// Batch tracker completion uses only the selected issue. Never create/merge a PR/MR or advance its parent.
import { execFileSync } from 'node:child_process';
import type { EffectiveConfig } from '../../orchestrator/project-config.mts';
export function batchCompletion(config:EffectiveConfig, iid:number, labels:{child:boolean;done:string;ready:string[]}) {
  const t=config.TRACKER, github=t.kind==='github', host=t.host??t.gitlabHost!, {child}=labels;
  if(!child && ([labels.done,...labels.ready].some(l=>!l.trim() || l.includes(',')) || labels.ready.includes(labels.done)))throw Error('Ambiguous completion labels');
  const path=github?`repos/${t.project}/issues/${iid}`:`projects/${t.projectId}/issues/${iid}`;
  const run=(args:string[])=>execFileSync(github?'gh':'glab',args,{encoding:'utf8',timeout:15000,maxBuffer:1<<20,stdio:['ignore','pipe','pipe'],env:{...process.env,GH_HOST:host,GITLAB_HOST:host}});
  function observe() {
    const issue=JSON.parse(run(['api',path,'--hostname',host]));
    if((github?issue.number:issue.iid)!==iid || (github?issue.html_url:issue.web_url)!==`https://${host}/${t.project}/${github?'':'-/'}issues/${iid}` || issue.pull_request || !Array.isArray(issue.labels)) throw Error('Unconfirmed tracker issue identity');
    const names=issue.labels.map((l:any)=>github?l.name:l);
    if(names.some((n:unknown)=>typeof n!=='string')) throw Error('Unknown tracker labels');
    if(child && issue.state==='closed' && (!github||issue.state_reason==='completed')) return {complete:true,remove:[]};
    if(issue.state!==(github?'open':'opened')) throw Error('Unexpected tracker issue state');
    const remove=labels.ready.filter(l=>names.includes(l));
    return {complete:!child && names.includes(labels.done) && !remove.length,remove};
  }
  function update(remove:string[]) {
    if(github) {
      const repo=['-R',`${host}/${t.project}`];
      run(child?['issue','close',String(iid),...repo,'--reason','completed']:['issue','edit',String(iid),...repo,'--add-label',labels.done,...remove.flatMap(l=>['--remove-label',l])]);
    } else run(['api','--hostname',host,'-X','PUT',path,...(child?['-f','state_event=close']:['-f',`add_labels=${labels.done}`,...(remove.length?['-f',`remove_labels=${remove.join(',')}`]:[])])]);
  }
  return {observe,update};
}
