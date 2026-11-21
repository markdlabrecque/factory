// External engine transport fixture only. It never executes setup/probe bytes or decides admission/cleanup.
import { connect } from 'node:net';
const socket=connect(process.argv[2]);
socket.on('connect',()=>socket.write(JSON.stringify({args:process.argv.slice(3),env:process.env})+'\n'));
let text=''; socket.on('data',b=>{text+=b; const i=text.indexOf('\n'); if(i<0)return; const result=JSON.parse(text.slice(0,i)); process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');socket.end();process.exitCode=result.status??0;});
socket.on('error',()=>{process.exitCode=2;});
