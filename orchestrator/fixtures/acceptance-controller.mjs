// Disposable initiating controller. The test kills this process after a detached worker owns execution.
const runner=await import(process.argv[2]);
const {acceptanceHash}=await import(process.argv[3]);
process.once('message',request=>{
  try {
    const handle=runner.reserveAcceptanceBaseline(request,{lookup:intent=>({id:'controller-grant',intentDigest:acceptanceHash(intent),expiresAt:Date.now()+request.bounds.totalMs+1000})});
    const worker=process.argv[4]==='reserve'?null:runner.startAcceptanceBaseline(handle);
    process.send({handle,pid:worker?.pid});
  } catch(error) { process.send({error:String(error)}); }
});
process.on('message',()=>{}); // Keep the initiating controller alive until the test injects its death.
process.send('ready');
