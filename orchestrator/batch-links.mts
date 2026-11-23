// GitHub paginates incoming blockers. GitLab's permission-filtered, all-state links need a separate incoming OPEN count.
export function batchLinks(iid:number, repo:{kind:'github';project:string;host:string}, read:(path:string)=>unknown):number[] {
  const blockers:number[]=[];
  for(let page=1;page<=32;page++) {
    const rows=read(`repos/${repo.project}/issues/${iid}/dependencies/blocked_by?per_page=100&page=${page}`);
    if(!Array.isArray(rows)||rows.length>100) throw Error('Invalid blocker page');
    for(const item of rows) {
      const id=item?.number;
      if(!Number.isSafeInteger(id)||id<=0 || item.html_url!==`https://${repo.host}/${repo.project}/issues/${id}`) throw Error('Foreign or unresolved blocker; inspect tracker links');
      blockers.push(id);
    }
    if(rows.length<100) return blockers;
  }
  throw Error('Incomplete blocker pagination');
}

/** blockedByCount excludes closed sources. Keep visible closed providers: tracker closure is not batch delivery. */
export function gitlabBlockerIds(rows:unknown,projectId:number,openCount:unknown):number[] {
  const incomplete=()=>Error('Unverifiable GitLab blocker inventory; check linked issue visibility and GraphQL blockedByCount support, then retry');
  if(!Number.isSafeInteger(openCount) || !Array.isArray(rows)) throw incomplete();
  const ids=new Set<number>(); let open=0;
  for(const r of rows) {
    if(['relates_to','blocks'].includes(r?.link_type)) continue;
    if(r?.link_type!=='is_blocked_by' || r.project_id!==projectId || !Number.isSafeInteger(r.iid) || r.iid<=0 || ids.has(r.iid) || !['opened','closed'].includes(r.state)) throw incomplete();
    ids.add(r.iid); if(r.state==='opened') open++;
  }
  if(open!==openCount) throw incomplete();
  return [...ids];
}
