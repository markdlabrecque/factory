// Strict offline gh/glab command transport. Only the named synthetic repository/member can be updated.
const fs=require('node:fs'), assert=require('node:assert/strict'), path=require('node:path');
const github=process.env.KIND==='github', a=process.argv.slice(2), facts=process.env.FACTS;
const f=JSON.parse(fs.readFileSync(facts)), host='fixture.invalid', repo='org/project', iid=7, base=github?'repos/org/project/issues':'projects/42/issues';
const print=x=>console.log(JSON.stringify(x));
if(a[1]==='graphql'){
  const query=a.find(s=>s.startsWith('query='));assert(query);assert(a.includes(host)||process.env.GH_HOST===host);
  if(query.includes('viewer {id}'))print({data:{viewer:{id:'fixture'},repository:{id:'repo_original',nameWithOwner:repo,issue:{number:iid,state:'OPEN',subIssues:{totalCount:0}}}}});
  else if(query.includes('currentUser {id}'))print({data:{currentUser:{id:'fixture'},project:{id:'gid://gitlab/Project/42',fullPath:repo,workItems:{nodes:[{iid:'7',state:'OPEN',workItemType:{name:'Task'}}]}}}});
  else if(github)print({data:{repository:{issue:{parent:null}}}});
  else print({data:{project:{workItems:{nodes:[{iid:'7',workItemType:{name:'Task'},widgets:[{parent:{iid:'8'}}]}]}}}});
} else if(a[0]==='api' && a[1].startsWith(base+'/')) {
  if(process.env.FAIL_OBSERVE && a[1]===base+'/7' && a[2]==='--hostname')process.exit(1);
  const n=Number(a[1].slice(base.length+1).split('/')[0]);assert([7,8].includes(n));
  if(a[1].includes('?'))print([]);
  else if(github)print({number:n,title:'Ticket',body:'Requirement',html_url:`https://${host}/${repo}/issues/${n}`,state:'open',labels:(f.done?['merged']:['ready-for-agent']).map(name=>({name}))});
  else print({iid:n,title:'Ticket',description:n===8?f.parent:'Requirement',web_url:`https://${host}/${repo}/-/issues/${n}`,state:f.done?'closed':'opened',labels:[]});
} else {
  assert.deepEqual(a,github?['issue','edit','7','-R','fixture.invalid/org/project','--add-label','merged','--remove-label','ready-for-agent']:['api','--hostname',host,'-X','PUT',base+'/7','-f','state_event=close']);
  fs.appendFileSync(process.env.UPDATES,JSON.stringify(a)+'\n');
  if(f.deny)process.exit(1);
  fs.writeFileSync(facts,JSON.stringify({...f,done:true}));
}
