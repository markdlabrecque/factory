// Offline issue inventory for the installed journey. Only updates to the explicitly selected top-level tickets are accepted.
const fs=require('node:fs'),assert=require('node:assert/strict'),a=process.argv.slice(2),out=v=>console.log(JSON.stringify(v)), facts=JSON.parse(fs.readFileSync(process.env.ISSUES));
const repo='org/project', host='fixture.invalid';
function issue(n){assert(Object.hasOwn(facts,n));return {number:n,title:`member-${n}`,body:`Make EDIT_${n}`+(n===2?'\nDepends on: #1':n===4?'\nDepends on: #3':n===1?'\nDepends on: #8':n===6?'\nDepends on: #2':''),state:'open',html_url:`https://${host}/${repo}/issues/${n}`,labels:facts[n].map(name=>({name})),issue_dependencies_summary:{total_blocked_by:0}}}
if(a[1]==='graphql'){
  const n=Number(/issue\(number:\s*(\d+)/.exec(a.at(-1))?.[1]);out({data:{viewer:{id:'V'},repository:{id:'R',nameWithOwner:repo,...(n?{issue:{...issue(n),state:'OPEN',parent:null,subIssues:{totalCount:0}}}:{})}}});
}else if(a[0]==='issue'&&a[1]==='view')out({...issue(Number(a[2])),state:a[2]==='8'&&process.env.UNBLOCK?'CLOSED':'OPEN'});
else if(a[0]==='api'&&a[1]==='user')out({login:'fixture'});
else if(a[0]==='api'&&a[1].startsWith(`repos/${repo}/issues/`)){
  const [,id,suffix]=/issues\/(\d+)(.*)$/.exec(a[1]);const i=issue(Number(id));if(!suffix)out(i);else {assert(/^\/(comments|dependencies\/blocked_by)\?/.test(suffix));out([])}
}else{const n=Number(a[2]);assert([1,2,5,6].includes(n));assert.deepEqual(a,['issue','edit',String(n),'-R',`${host}/${repo}`,'--add-label','merged']);if(n===6)process.exit(1);facts[n]=['merged'];fs.writeFileSync(process.env.ISSUES,JSON.stringify(facts))}
