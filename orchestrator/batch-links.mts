// Bounded project-local native blocker reads. Missing pages, foreign identities and malformed facts are not empty lists.
export function batchLinks(iid:number, repo:{kind:'github'|'gitlab';project:string;projectId?:number;host:string}, read:(path:string)=>unknown):number[] {
  const gh=repo.kind==='github', root=gh?`repos/${repo.project}/issues/${iid}/dependencies/blocked_by`:`projects/${repo.projectId}/issues/${iid}/links`;
  const blockers:number[]=[];
  for(let page=1;page<=32;page++) {
    const rows=read(`${root}?per_page=100&page=${page}`);
    if(!Array.isArray(rows)||rows.length>100) throw Error('Invalid blocker page');
    for(const item of rows) {
      if(!gh && ['blocks','relates_to'].includes(item?.link_type)) continue;
      const id=gh?item?.number:item?.iid;
      if(!Number.isSafeInteger(id)||id<=0 || (gh?item.html_url!==`https://${repo.host}/${repo.project}/issues/${id}`:item.link_type!=='is_blocked_by'||item.project_id!==repo.projectId)) throw Error('Foreign or unresolved blocker; inspect tracker links');
      blockers.push(id);
    }
    if(rows.length<100) return blockers;
  }
  throw Error('Incomplete blocker pagination');
}
