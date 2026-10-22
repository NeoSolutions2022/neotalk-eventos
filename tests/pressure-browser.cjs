// Actual built React UI; deterministic recognition/API/widget doubles.
// Does NOT certify Unity, physical microphone, native PiP or production timing.
const {chromium}=require('C:/Users/felip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../../..'),output=path.join(root,'outputs','capture-uninterrupted-20261022');
const widget='https://infra-avatar3d-oficial.k3p3ex.easypanel.host';
const frame=`<!doctype html><body>Widget double<script>
let id=0; const send=x=>parent.postMessage({avatar:'elia',...x},'*');
setTimeout(()=>send({type:'neotalk:ready',capabilities:['native-playback-progress']}),100);
window.addEventListener('message',e=>{const m=e.data;if(m.type!=='neotalk:sign')return;const loadId='qa-'+(++id);
send({type:'neotalk:playing',phrase:m.phrase,loadId});setTimeout(()=>send({type:'neotalk:playback-frame',loadId,status:'started',frame:0,frameCount:2}),5);
setTimeout(()=>send({type:'neotalk:playback-frame',loadId,status:'finished',frame:1,frameCount:2}),20);});
</script>`;
(async()=>{
 await fs.mkdir(output,{recursive:true});let browser;
 const report={scope:'Actual React UI with API, recognition and widget doubles; not native Unity or microphone QA',scenarios:[],errors:[],result:'RUNNING'};
 try{
  browser=await chromium.launch({channel:'msedge'});const context=await browser.newContext();
  await context.addInitScript(()=>{
   class Speech{start(){window.qaRecognition=this;}abort(){}stop(){}}
   window.SpeechRecognition=Speech;window.qaTracks=[];
   Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{
    const track={label:'Controlled microphone double',enabled:true,readyState:'live',stop(){this.readyState='ended';}};window.qaTracks.push(track);
    return {getTracks:()=>[track],getAudioTracks:()=>[track]};
   }}});
  });
  await context.route(widget+'/**',route=>route.fulfill({contentType:'text/html',body:frame}));
  let batchNumber=0,release,releaseAudio,audioCount=0;let hold,holdAudio;const batches=new Map();
  const gate=()=>{hold=new Promise(r=>{release=r;});};gate();
  await context.route('**/api/v1/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname,method=req.method();const data=req.postData()&&!p.endsWith('/agent/transcribe')?req.postDataJSON():{};
   if(p.endsWith('/auth/me'))return route.fulfill({json:{id:'qa',name:'QA',role:'admin',csrf_token:'qa',onboarding_version:1,password_set:true}});
   if(p.endsWith('/agent/translate')){await hold;return route.fulfill({json:{gloss_text:'TESTE',trace_id:data.trace_id}});}
   if(p.endsWith('/agent/transcribe')){const index=++audioCount;await holdAudio;return route.fulfill({json:{text:'trecho '+index+' um dois tres quatro'}});}
   if(p.endsWith('/batches')&&method==='POST'){const b={id:'batch-'+(++batchNumber),...data,status:'queued'};batches.set(b.id,b);return route.fulfill({json:b});}
   if(p.includes('/batches/')&&method==='PATCH'){const b=batches.get(p.split('/').pop());Object.assign(b,data);return route.fulfill({json:b});}
   if(p.endsWith('/heartbeat'))return route.fulfill({status:204,body:''});
   if(p.endsWith('/rooms')&&method==='GET')return route.fulfill({json:[]});
   return route.fulfill({json:{id:'qa-room',status:p.endsWith('/finish')?'finished':'live'}});
  });
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto('http://localhost:3110/salas/ao-vivo');await page.locator('.avatar-health.connected').waitFor();
  for(const cancel of [false,true]){
   gate();await page.evaluate(()=>{window.qaRecognition=null;});await page.getByRole('button',{name:'Iniciar sala ao vivo',exact:true}).click();await page.waitForFunction(()=>!!window.qaRecognition);
   const before=batches.size;
   await page.evaluate(()=>{for(let i=0;i<240;i++)window.qaRecognition.onresult({resultIndex:0,results:{length:1,0:{isFinal:true,0:{transcript:'trecho '+i+' um dois tres quatro cinco seis sete oito nove dez'}}}});});
   const mute=page.getByRole('button',{name:'Mutar microfone',exact:true});await mute.waitFor();
   const [stagedDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:/Baixar relatório de latência/}).click()]);
   const stagedFile=path.join(output,cancel?'staged-before-manual.json':'staged-continuous.json');await stagedDownload.saveAs(stagedFile);
   const staged=JSON.parse(await fs.readFile(stagedFile,'utf8'));
   assert.equal(staged.backlog.workingBatches,72);assert.equal(staged.backlog.text.items,168);assert.equal(staged.telemetry.pressure.capturePauses,0);assert.equal(staged.telemetry.input.sourceWords,2880);
   if(cancel)await mute.click();release();
   if(!cancel)await page.getByRole('button',{name:'Mutar microfone',exact:true}).waitFor({timeout:60000});
   await page.waitForFunction(()=>document.querySelector('.live-queue .block-title')?.textContent.includes('240 concluídos'),null,{timeout:60000});
   assert.equal(batches.size-before,240);assert.equal([...batches.values()].slice(before).filter(b=>b.status==='done').length,240);
   if(cancel){await page.getByRole('button',{name:'Ativar microfone',exact:true}).waitFor();await page.waitForTimeout(500);assert.equal(await page.getByRole('button',{name:'Mutar microfone',exact:true}).count(),0);}
   const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:/Baixar relatório de latência/}).click()]);
   const file=path.join(output,cancel?'manual-mute.json':'continuous-capture.json');await download.saveAs(file);
   const telemetry=JSON.parse(await fs.readFile(file,'utf8')).telemetry;
   assert.equal(telemetry.pressure.capturePauses,0);assert.equal(telemetry.pressure.automaticResumes,0);
   assert.equal(telemetry.outcomes.complete,240);assert.equal(telemetry.runtimeResets,0);
   report.scenarios.push({manualMute:cancel,completed:240,stagedWithoutMuting:168,capturePauses:0,runtimeResets:0});
   await page.getByRole('button',{name:'Encerrar sala',exact:true}).click();
  }
  hold=Promise.resolve();holdAudio=new Promise(r=>{releaseAudio=r;});
  await page.evaluate(()=>{
   window.qaRecognition=null;window.qaRecorderCount=0;
   window.MediaRecorder=class{
    static isTypeSupported(){return true;}
    constructor(){this.state='inactive';this.mimeType='audio/webm';this.id=++window.qaRecorderCount;}
    start(){this.state='recording';if(this.id<=20)setTimeout(()=>this.stop(),15);}
    stop(){if(this.state!=='recording')return;this.state='inactive';this.ondataavailable({data:new Blob(['audio-'+this.id])});this.onstop();}
   };
  });
  await page.getByRole('button',{name:'Iniciar sala ao vivo',exact:true}).click();await page.waitForFunction(()=>!!window.qaRecognition);
  await page.evaluate(()=>window.qaRecognition.onerror({error:'network'}));
  await page.waitForFunction(()=>window.qaRecorderCount>=21);
  await page.getByRole('button',{name:'Mutar microfone',exact:true}).waitFor();
  assert.equal(audioCount,2);
  releaseAudio();
  await page.waitForFunction(()=>document.body.textContent.includes('trecho 20 um dois tres quatro'));
  assert.equal(audioCount,20);
  const [audioDownload]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:/Baixar relatório de latência/}).click()]);
  const audioFile=path.join(output,'compatible-audio.json');await audioDownload.saveAs(audioFile);
  const audioReport=JSON.parse(await fs.readFile(audioFile,'utf8')).telemetry;
  assert.equal(audioReport.pressure.capturePauses,0);assert.equal(audioReport.pressure.automaticResumes,0);assert.equal(audioReport.pressure.rejectedAudioChunks,0);
  assert.equal(audioReport.asr_request_ms.count,20);assert.equal(audioReport.input.sourceWords,120);
  report.scenarios.push({compatibleAudio:true,acceptedChunks:20,sourceWords:120,capturePauses:0,rejectedAudioChunks:0});
  await page.getByRole('button',{name:'Mutar microfone',exact:true}).click();
  await page.getByRole('button',{name:'Ativar microfone',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.qaTracks.at(-1).enabled),false);
  await page.waitForFunction(()=>document.body.textContent.includes('trecho 21 um dois tres quatro'));
  assert.equal(audioCount,21,'manual mute preserves the already open recorder tail');
  await page.getByRole('button',{name:'Ativar microfone',exact:true}).click();
  await page.waitForFunction(()=>window.qaRecorderCount>=22);
  assert.equal(await page.evaluate(()=>window.qaTracks.at(-1).enabled),true);
  report.scenarios.push({manualCompatibleMute:true,tailTranscribed:true,trackDisabledUntilExplicitUnmute:true});
  await page.getByRole('button',{name:'Encerrar sala',exact:true}).click();
  assert.equal(report.errors.length,0);report.result='PASS';console.log(JSON.stringify(report));
 }catch(e){report.result='FAIL';report.failure=e.message;process.exitCode=1;console.error(e);}
 finally{await browser?.close();await fs.writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));}
})();
