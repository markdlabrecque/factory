// Fresh host for the offline budget fixture; no credentials, trackers, agents or Docker calls.
import { readFileSync } from 'node:fs';
import { runBatchAttempt } from '../batch-review.mts';
const input=JSON.parse(readFileSync(0,'utf8')); input.observeHead=async()=>({kind:'owned',head:input.expectedHead});
let processes=0;
try {
  const result=await runBatchAttempt(input,{test:async()=>{processes++;return {exit:0,stdout:'',stderr:''}},review:async role=>{
    processes++;return {exit:0,stdout:JSON.stringify(role==='test'?{context:['missing']}:{verdict:'reject',reason:'fresh process verdict'}),stderr:''}}});
  console.log(JSON.stringify({processes,result}));
} catch(e){console.log(JSON.stringify({processes,error:String(e)}))}
