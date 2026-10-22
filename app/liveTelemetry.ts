// Privacy-safe, bounded per-tab timings. Never store speech, glosses, URLs or device IDs.
export function summarize(values: number[]) {
  const data = values.filter(n => Number.isFinite(n) && n >= 0).sort((a,b) => a-b);
  const percentile = (q: number) => data.length ? data[Math.max(0, Math.ceil(data.length*q)-1)] : null;
  return { count: data.length, mean: data.length ? data.reduce((a,b)=>a+b,0)/data.length : null,
    p50: percentile(.5), p95: percentile(.95), max: data.at(-1) ?? null };
}
type Point = 'admitted' | 'translation_start' | 'translation_ready' | 'translation_failed' | 'dispatched' | 'first_frame' | 'last_frame';
type Stage = 'context_ms' | 'provider_ms' | 'validation_ms' | 'service_ms' | 'endpoint_ms';
type Execution = { output: 'primary'|'external'; loadId: string; first: number; last?: number };
type Batch = { id: number; traceId: string; points: Partial<Record<Point,number>>; attempts: number;
  outcome?: 'complete'|'error'|'skipped'|'cancelled'; server: Partial<Record<Stage,number>>; executions: Execution[];
  contextCacheHit?: boolean; catalogWordCount?: number };
const SERVER_STAGES: Stage[] = ['context_ms','provider_ms','validation_ms','service_ms','endpoint_ms'];
export class LiveTelemetry {
  private rows = new Map<number,Batch>();
  private session = '';
  private evicted = 0;
  private pressureCount = 0;
  private resumeCount = 0;
  private maxQueue = 0;
  private sequence = 0;
  private previous: Partial<Record<'primary'|'external',{at:number;nextTranslationReady?:boolean}>> = {};
  private gaps: {output:'primary'|'external';ms:number;nextTranslationReady?:boolean}[] = [];
  private asr: {ms:number;ok:boolean}[] = [];
  private firstInput: number | null = null;
  private sourceWords = 0;
  private lastInput: number | null = null;
  private resetCount = 0;
  private inputRejected = 0;
  private blockedAdmissions = 0;
  private rejectedAudioChunks = 0;
  constructor(private now:()=>number = ()=>performance.now(), private capacity=512) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a positive integer');
  }
  begin(session: string) {
    this.session = /^[a-zA-Z0-9_-]{1,80}$/.test(session) ? session : 'local';
    this.rows.clear(); this.evicted=0; this.pressureCount=0; this.resumeCount=0; this.maxQueue=0;this.sequence=0;
    this.previous={};this.gaps=[];this.asr=[];this.firstInput=null;this.lastInput=null;
    this.sourceWords=0;this.resetCount=0;this.inputRejected=0;this.blockedAdmissions=0;this.rejectedAudioChunks=0;
  }
  admit(id:number, queue:number) {
    if (!this.session) return;
    while(this.rows.size>=this.capacity){this.rows.delete(this.rows.keys().next().value!);this.evicted++;}
    const row:Batch={id,traceId:`${this.session}_${++this.sequence}`,points:{admitted:this.now()},attempts:0,server:{},executions:[]};
    this.rows.set(id,row);this.maxQueue=Math.max(this.maxQueue,queue);return row.traceId;
  }
  trace(id:number){return this.rows.get(id)?.traceId;}
  mark(id:number,point:Point){const row=this.rows.get(id);if(row&&row.points[point]===undefined)row.points[point]=this.now();}
  attempt(id:number){const row=this.rows.get(id);if(row)row.attempts++;}
  server(id:number,timing?:Record<string,unknown>){const row=this.rows.get(id);if(!row||!timing)return;
    for(const key of SERVER_STAGES){const v=timing[key];if(typeof v==='number'&&Number.isFinite(v)&&v>=0)row.server[key]=v;}}
  context(id:number,hit:unknown,words:unknown){const row=this.rows.get(id);if(!row)return;
    if(typeof hit==='boolean')row.contextCacheHit=hit;
    if(typeof words==='number'&&Number.isSafeInteger(words)&&words>=0)row.catalogWordCount=words;}
  outcome(id:number,value:Batch['outcome']){const row=this.rows.get(id);if(row)row.outcome=value;}
  pressure(){if(this.session)this.pressureCount++;}
  resumed(){if(this.session)this.resumeCount++;}
  blocked(){if(this.session)this.blockedAdmissions++;}
  rejectAudio(){if(this.session)this.rejectedAudioChunks++;}
  reset(){if(this.session)this.resetCount++;}
  rejected(words:number){if(this.session)this.inputRejected+=Math.max(0,words);}
  input(words:number){if(!this.session)return;const at=this.now();this.firstInput??=at;this.lastInput=at;this.sourceWords+=words;}
  transcription(ms:number,ok:boolean){if(!this.session||!Number.isFinite(ms)||ms<0)return;this.asr.push({ms,ok});if(this.asr.length>512)this.asr.shift();}
  frame(id:number,output:'primary'|'external',loadId:string,status:string,frame:number,frameCount:number,nextTranslationReady?:boolean) {
    const row=this.rows.get(id);
    if(!row||!loadId||!Number.isInteger(frame)||!Number.isInteger(frameCount)||frame<0||frame>=frameCount||frameCount<1)return;
    if(!['started','progress','finished'].includes(status)||status==='finished'&&frame!==frameCount-1)return;
    const at=this.now();let execution=row.executions.find(e=>e.output===output&&e.loadId===loadId);
    if(!execution){
      // A terminal event alone is not evidence of first-frame latency.
      if(status==='finished')return;
      const count=row.executions.filter(e=>e.output===output).length;if(count>=4)return;
      execution={output,loadId,first:at};row.executions.push(execution);
      if(output==='primary')this.mark(id,'first_frame');
      const last=this.previous[output];if(last!==undefined&&at>=last.at){this.gaps.push({output,ms:at-last.at,nextTranslationReady:last.nextTranslationReady});if(this.gaps.length>1024)this.gaps.shift();delete this.previous[output];}
    }
    if(status==='finished'&&execution.last===undefined){execution.last=at;this.previous[output]={at,nextTranslationReady};if(output==='primary')this.mark(id,'last_frame');}
  }
  cancelPending(){for(const row of this.rows.values())if(!row.outcome)row.outcome='cancelled';}
  snapshot() {
    const at=this.now(),rows=[...this.rows.values()];
    const diff=(a:Point,b:Point)=>summarize(rows.flatMap(r=>r.points[a]!==undefined&&r.points[b]!==undefined?[r.points[b]!-r.points[a]!]:[]));
    const metrics={admission_to_agent_ms:diff('admitted','translation_start'),translation_request_ms:diff('translation_start','translation_ready'),translation_failed_request_ms:diff('translation_start','translation_failed'),
      ready_to_dispatch_ms:diff('translation_ready','dispatched'),dispatch_to_first_frame_ms:diff('dispatched','first_frame'),
      admission_to_first_frame_ms:diff('admitted','first_frame'),native_playback_ms:diff('first_frame','last_frame')};
    return {schema:1,scope:'browser-received-native-frames; real service timings only when returned by backend',session:this.session,
      limits:{rows:this.capacity,evictedRows:this.evicted,asrSamples:512},metrics,
      server:Object.fromEntries(SERVER_STAGES.map(k=>[k,summarize(rows.flatMap(r=>r.server[k]===undefined?[]:[r.server[k]!]))])),
      translation_by_context_cache:Object.fromEntries(['hit','miss','unreported'].map(group=>[group,summarize(rows.filter(r=>
        group==='hit'?r.contextCacheHit===true:group==='miss'?r.contextCacheHit===false:r.contextCacheHit===undefined
      ).flatMap(r=>r.points.translation_start!==undefined&&r.points.translation_ready!==undefined?[r.points.translation_ready-r.points.translation_start]:[]))])),
      handoff_ms:{primary:summarize(this.gaps.filter(g=>g.output==='primary').map(g=>g.ms)),external:summarize(this.gaps.filter(g=>g.output==='external').map(g=>g.ms))},
      handoff_by_translation_readiness:Object.fromEntries(['primary','external'].map(output=>[output,{
        ready:summarize(this.gaps.filter(g=>g.output===output&&g.nextTranslationReady===true).map(g=>g.ms)),
        notReady:summarize(this.gaps.filter(g=>g.output===output&&g.nextTranslationReady===false).map(g=>g.ms)),
        unreported:summarize(this.gaps.filter(g=>g.output===output&&g.nextTranslationReady===undefined).map(g=>g.ms)),
      }])),
      asr_request_ms:summarize(this.asr.map(s=>s.ms)),asrFailures:this.asr.filter(s=>!s.ok).length,
      pressure:{capturePauses:this.pressureCount,automaticResumes:this.resumeCount,maxPendingBatches:this.maxQueue,rejectedSourceWords:this.inputRejected,blockedAdmissionAttempts:this.blockedAdmissions,rejectedAudioChunks:this.rejectedAudioChunks,
        oldestPendingMs:Math.max(0,...rows.filter(r=>!r.outcome).map(r=>at-r.points.admitted!))},
      input:{sourceWords:this.sourceWords,observedDurationMs:this.firstInput===null?null:this.lastInput!-this.firstInput},runtimeResets:this.resetCount,
      outcomes:{complete:rows.filter(r=>r.outcome==='complete').length,error:rows.filter(r=>r.outcome==='error').length,
        skipped:rows.filter(r=>r.outcome==='skipped').length,cancelled:rows.filter(r=>r.outcome==='cancelled').length,pending:rows.filter(r=>!r.outcome).length},
      missing:{firstFrame:rows.filter(r=>r.points.first_frame===undefined).length,lastFrame:rows.filter(r=>r.points.last_frame===undefined).length,serverTimings:rows.filter(r=>r.server.endpoint_ms===undefined).length},
      limitations:['No acoustic speech-end timestamp: admission-to-frame is NOT speech-to-frame.','Native event reception includes postMessage scheduling, not GPU frame time.',
        'No internal pose API/worker/download spans until that service is instrumented.','Browser Web Speech ASR cannot expose server processing time.','Handoff includes empty-queue/idle time; translation readiness is NOT proof of native pose preparation.',
        'Bounded sample window; evictions and missing timings must be reported.'],
      batches:rows.map(r=>({traceId:r.traceId,attempts:r.attempts,outcome:r.outcome||'pending',points:r.points,server:r.server,
        contextCacheHit:r.contextCacheHit,catalogWordCount:r.catalogWordCount,
        executions:r.executions.map(e=>({output:e.output,first:e.first,last:e.last}))}))};
  }
}
