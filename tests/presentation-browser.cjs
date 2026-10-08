// Actual React/widget/Unity .28. Controlled authenticated admin, catalog and
// ASR/API inputs; not a production/network/native Document PiP certification.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('C:/Users/felip/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const root=path.resolve(__dirname,'../../..'),platform=path.resolve(__dirname,'..'),widget=path.join(root,'tmp/avatar-latency');
const base='http://localhost:3110',host='https://infra-avatar3d-oficial.k3p3ex.easypanel.host';
const output=path.join(root,'outputs',`presentation-${Date.now()}`),sleep=ms=>new Promise(r=>setTimeout(r,ms));
const report={scope:'Actual .28 Unity WebGL and two players, controlled ASR/admin/catalog/API; not native Document PiP or production',checks:[],errors:[],result:'RUNNING'};
(async()=>{
  await fs.mkdir(output,{recursive:true});
  const {concatenatePoses}=await import(pathToFileURL(path.join(platform,'mobile-offline/src/engine.mjs')));
  const poses=new Map(),tasks=new Map(),sequences=new Map();
  for(const word of ['AMIGO','APRENDER','COMPRAR','COMPREENDER']) poses.set(word,await fs.readFile(path.join(widget,'webgl/elia/StreamingAssets',word.toLowerCase()+'.pose'),'utf8'));
  const check=(ok,text)=>{assert.ok(ok,text);report.checks.push(text);console.log('PASS',text);};
  let browser,page,popup,speechTimer,diagnosticTimer,translationCalls=0,batchCalls=0,finishes=0;
  try{
    browser=await chromium.launch({channel:'msedge',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
    const context=await browser.newContext({viewport:{width:1440,height:1000}});
    context.on('page',p=>p.on('pageerror',e=>report.errors.push(e.message)));
    await context.addInitScript(()=>{
      class Speech{start(){window.demoRecognition=this;}abort(){}stop(){}}
      window.SpeechRecognition=Speech;window.demoEvents=[];
      Object.defineProperty(window,'documentPictureInPicture',{configurable:true,value:{requestWindow:async()=>{const p=window.open('/__qa-window','_blank','width=560,height=420');return new Promise(r=>p.addEventListener('load',()=>r(p),{once:true}));}}});
      window.addEventListener('message',e=>{if(e.data?.type?.startsWith('neotalk:')&&e.source===document.querySelector('iframe.avatar-widget-frame')?.contentWindow) window.demoEvents.push({...e.data,at:Date.now()});});
    });
    await context.route('**/__qa-window',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head></head><body></body></html>'}));
    await context.route('**/external-player-relay.js*',async r=>r.fulfill({contentType:'text/javascript',body:await fs.readFile(path.join(platform,'public/external-player-relay.js'))}));
    await context.route(host+'/**',async r=>{
      const u=new URL(r.request().url());
      if(u.pathname==='/api/v1/widget/config')return r.fulfill({json:{allowed_origins:[base]}});
      if(u.pathname==='/api/v1/mvp/sign'){
        const phrase=r.request().postDataJSON().phrase,id=String(tasks.size+1);tasks.set(id,phrase);
        return r.fulfill({json:{task_id:id}});
      }
      if(u.pathname.startsWith('/api/v1/mvp/tasks/')){
        const id=u.pathname.split('/').pop(),words=tasks.get(id).split(' '),clip=concatenatePoses(words.map(w=>poses.get(w)));sequences.set(id,clip);
        return r.fulfill({json:{pose:{content_url:host+'/qa/'+id+'.pose',fps:30,frame_count:clip.frame_count},palavras_encontradas:words}});
      }
      if(u.pathname.startsWith('/qa/'))return r.fulfill({contentType:'text/plain',body:sequences.get(path.basename(u.pathname,'.pose')).content});
      const file=u.pathname==='/widget'?path.join(widget,'frontend/widget.html'):u.pathname.startsWith('/static/')?path.join(widget,'frontend',u.pathname.slice(8)):path.join(widget,u.pathname.slice(1));
      const types={'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.wasm':'application/wasm'};
      try{let body=await fs.readFile(file);if(u.pathname==='/static/widget.js')body=Buffer.from(body.toString()+`\nwindow.qaWidget=()=>({presentation:state.presentation?{id:state.presentation.id,ready:state.presentation.ready}:null,pending:state.pendingPoseLoad?.loadId,context:state.playbackContext});`);return r.fulfill({body,contentType:types[path.extname(file)]||'application/octet-stream'});}catch{return r.fulfill({status:404});}
    });
    await context.route('**/api/v1/**',async r=>{
      if(r.request().url().startsWith(host))return r.fallback();
      const p=new URL(r.request().url()).pathname;
      if(p.endsWith('/auth/me'))return r.fulfill({json:{id:'demo-admin',name:'QA Apresentação',role:'admin',csrf_token:'qa',onboarding_version:1,onboarding_status:'completed',password_set:true}});
      if(p.endsWith('/admin/pose-words'))return r.fulfill({json:{items:[...poses.keys()],has_next:false}});
      if(p.endsWith('/agent/translate')){translationCalls++;return r.fulfill({status:500});}
      if(p.includes('/batches')){batchCalls++;return r.fulfill({status:500});}
      if(p.endsWith('/heartbeat'))return r.fulfill({status:204});
      if(p.endsWith('/finish'))finishes++;
      return r.fulfill({json:{id:'demo-room',status:'live'}});
    });
    page=await context.newPage();await page.goto(base+'/salas/ao-vivo');
    diagnosticTimer=setInterval(async()=>{for(const [name,p] of [['primary',page],['external',popup]])if(p&&!p.isClosed()){const frame=p.frames().find(f=>f.url().includes('/widget?'));if(frame)console.log('RUNTIME',name,await frame.evaluate(()=>window.qaWidget?.()).catch(()=>null));}},15000);
    await page.waitForFunction(()=>window.demoEvents.some(e=>e.type==='neotalk:ready'),null,{timeout:120000});
    await page.getByRole('button',{name:/Preparar apresentação/}).click();
    await page.waitForFunction(()=>window.demoEvents.some(e=>e.type==='neotalk:presentation-ready'),null,{timeout:300000});
    check((await page.evaluate(()=>window.demoEvents)).filter(e=>e.type==='neotalk:playing').length===0,'Prepared 12 real compound clips without playing before microphone/speech');
    const opened=context.waitForEvent('page');await page.getByRole('button',{name:/Mini-player flutuante/}).click();popup=await opened;
    await popup.waitForFunction(()=>window.demoEvents.some(e=>e.type==='neotalk:ready'),null,{timeout:120000});
    await popup.waitForFunction(()=>window.demoEvents.some(e=>e.type==='neotalk:presentation-ready'),null,{timeout:300000});
    await page.waitForFunction(()=>!!window.demoRecognition);
    check(await popup.getByRole('button',{name:'Encerrar sala',exact:true}).isHidden(),'No end transmission control in floating stage');
    check(await popup.locator('.presentation-disclosure').isVisible()&&await page.locator('.presentation-disclosure').isVisible(),'Illustrative disclosure visible in both outputs');
    check((await page.evaluate(()=>window.demoEvents)).filter(e=>e.type==='neotalk:playing').length===0,'Opening mini-player and microphone alone does not start animation');
    const speak=()=>page.evaluate(()=>window.demoRecognition.onresult({resultIndex:0,results:{length:1,0:{isFinal:true,0:{transcript:'Nossa apresentação captura legendas de verdade.'}}}}));
    await speak();speechTimer=setInterval(()=>speak().catch(()=>{}),1500);
    await popup.waitForFunction(()=>window.demoEvents.some(e=>e.type==='neotalk:presentation-frame'&&e.frame>300),null,{timeout:90000});
    clearInterval(speechTimer);speechTimer=null;
    await page.getByRole('button',{name:'Mutar microfone',exact:true}).click();
    await sleep(2000);
    const before=(await popup.evaluate(()=>window.demoEvents)).filter(e=>e.type==='neotalk:presentation-frame').at(-1)?.frame;
    await sleep(7000);
    check((await popup.evaluate(()=>window.demoEvents)).filter(e=>e.type==='neotalk:presentation-frame').at(-1)?.frame===before,'Mute pauses at the current native frame');
    await page.getByRole('button',{name:'Ativar microfone',exact:true}).click();await speak();
    await popup.waitForFunction(frame=>window.demoEvents.filter(e=>e.type==='neotalk:presentation-frame').at(-1)?.frame>frame,before,{timeout:15000});
    check(true,'New speech resumes past the paused frame without restart');
    await sleep(9000);
    const silenceFrame=await popup.evaluate(()=>window.demoEvents.filter(e=>e.type==='neotalk:presentation-frame').at(-1)?.frame);
    await sleep(3000);
    check(await popup.evaluate(frame=>window.demoEvents.filter(e=>e.type==='neotalk:presentation-frame').at(-1)?.frame===frame,silenceFrame),'Silence automatically pauses without a new pose load');
    const primary=await page.evaluate(()=>window.demoEvents),external=await popup.evaluate(()=>window.demoEvents);
    const frames=external.filter(e=>e.type==='neotalk:presentation-frame');
    check(Math.max(...frames.map(e=>e.frame))>300,'Native playlist crossed more than 300 frames of different compound gestures');
    check(translationCalls===0&&batchCalls===0,'No fake translated history and no GPT calls');
    check(primary.filter(e=>e.type==='neotalk:ready').length===1&&external.filter(e=>e.type==='neotalk:ready').length===1,'Neither Unity runtime reinitialized');
    await page.screenshot({path:path.join(output,'platform.png')});await popup.screenshot({path:path.join(output,'mini-player.png')});
    report.primary=primary;report.external=external;
    report.progressIntervalsMs=frames.slice(1).filter((f,i)=>f.frame>frames[i].frame&&frames[i].frame>0).map(f=>f.at-frames[frames.indexOf(f)-1].at);
    check(primary.filter(e=>e.type==='neotalk:pose-stage'&&e.stage==='load_sent').length===2&&external.filter(e=>e.type==='neotalk:pose-stage'&&e.stage==='load_sent').length===2,'Only preview plus one prepared playlist loaded per runtime, never reloaded during speech');
    await popup.close();await page.getByRole('button',{name:'Iniciar sala ao vivo',exact:true}).waitFor();
    check(finishes===1,'Window close finishes the live room exactly once');
    check(report.errors.length===0,'No uncaught page exceptions');
    report.result='PASS';console.log('PROGRESS_INTERVALS_MS',report.progressIntervalsMs);
  }catch(e){report.result='FAIL';report.failure={message:e.message,stack:e.stack};console.error(e);process.exitCode=1;if(page&&!page.isClosed())report.primary=await page.evaluate(()=>window.demoEvents);if(popup&&!popup.isClosed()){report.external=await popup.evaluate(()=>window.demoEvents);await popup.screenshot({path:path.join(output,'external-failure.png')});}}
  finally{if(speechTimer)clearInterval(speechTimer);if(diagnosticTimer)clearInterval(diagnosticTimer);if(page&&!page.isClosed())await page.screenshot({path:path.join(output,'final.png')}).catch(()=>{});if(browser)await browser.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log('EVIDENCE',output);}
})();
