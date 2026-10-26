// Controlled synthetic microphone only. Never records the user's hardware.
// Optional one-request provider probe uses the existing ignored local key.
const { chromium }=require(process.env.QA_PLAYWRIGHT_MODULE||'C:/Users/felip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const root=path.resolve(__dirname,'..'),output=path.join(root,'outputs','recorder-empty-'+Date.now());
let server,browser;
const report={kind:'synthetic-recorder-boundary-diagnostic',result:'INCOMPLETE',limitations:['Not physical speech or platform end-to-end QA. No human audio captured.']};
(async()=>{
 await fs.mkdir(output,{recursive:true});
 try{
  server=http.createServer((_,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>Synthetic recorder diagnostic</title>');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  report.browser=browser.version();const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);
  const sample=await page.evaluate(async()=>{
   const stream=await navigator.mediaDevices.getUserMedia({audio:true});
   try{
    const collect=async(ms)=>{
     const recorder=new MediaRecorder(stream,{mimeType:'audio/webm;codecs=opus'}),parts=[];
     const ended=new Promise(resolve=>{recorder.ondataavailable=e=>parts.push(e.data);recorder.onstop=resolve;});
     recorder.start();if(ms)await new Promise(resolve=>setTimeout(resolve,ms));recorder.stop();await ended;
     const blob=new Blob(parts,{type:recorder.mimeType}),bytes=await blob.arrayBuffer();let decodedFrames=null,decodeError=null;
     const audio=new AudioContext();try{decodedFrames=(await audio.decodeAudioData(bytes.slice(0))).length;}catch(e){decodeError=e.name;}finally{await audio.close();}
     return {size:blob.size,type:blob.type,decodedFrames,decodeError,tinyBytes:blob.size<=512?Array.from(new Uint8Array(bytes)):undefined};
    };
    return {immediate:await collect(0),normal:await collect(4200)};
   }finally{stream.getTracks().forEach(track=>track.stop());}
  });
  const bytes=sample.immediate.tinyBytes;delete sample.immediate.tinyBytes;delete sample.normal.tinyBytes;report.samples=sample;
  if(bytes) await fs.writeFile(path.join(output,'synthetic-empty-header.hex'),Buffer.from(bytes).toString('hex')+'\n');
  if(process.env.QA_PROVIDER_PROBE==='1'&&bytes){
   const config=await fs.readFile(path.join(root,'.env.homolog.local'),'utf8');
   const key=config.match(/^OPENAI_API_KEY=(.+)$/m)?.[1].trim();if(!key)throw Error('Local key absent');
   const form=new FormData();form.set('model','gpt-4o-mini-transcribe');form.set('language','pt');form.set('response_format','json');form.set('file',new Blob([new Uint8Array(bytes)],{type:'audio/webm'}),'synthetic-empty.webm');
   const response=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+key},body:form,signal:AbortSignal.timeout(30000)});
   const payload=await response.json().catch(()=>({}));const safe=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(v)?v:null;
   report.provider={status:response.status,code:safe(payload.error?.code),type:safe(payload.error?.type),param:safe(payload.error?.param)};
  }
  report.result='DIAGNOSTIC_COMPLETE';
 }catch{report.result='INCOMPLETE';process.exitCode=1;}
 finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,output}));}
})();
