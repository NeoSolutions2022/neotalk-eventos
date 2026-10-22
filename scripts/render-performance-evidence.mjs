// Static evidence charts, generated from versioned aggregates, never user recordings.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const sharp=require(process.env.NEOTALK_SHARP_MODULE || 'sharp');
const dir=path.resolve('docs/performance/2026-10-22');
const http=JSON.parse(await fs.readFile(path.join(dir,'http-loopback.json'),'utf8'));
const lab=JSON.parse(await fs.readFile(path.join(dir,'lab-aggregates.json'),'utf8'));
const colors={ink:'#14243c',muted:'#5d6c80',blue:'#008eb8',teal:'#069c80',amber:'#bd7713',gray:'#dce5ee'};
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const txt=(x,y,s,size=20,fill=colors.ink,weight=400)=>`<text x="${x}" y="${y}" fill="${fill}" font-size="${size}" font-weight="${weight}">${esc(s)}</text>`;
const rect=(x,y,w,h,fill,r=6)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
const line=(x1,y1,x2,y2,c=colors.gray)=>`<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${c}" stroke-width="2"/>`;
const fmt=(v,d=1)=>v.toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
function canvas(title,sub,body,footer){return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="820" viewBox="0 0 1400 820"><style>text{font-family:'Segoe UI',Arial,sans-serif}</style>${rect(0,0,1400,820,'#f3f7fb',0)}${rect(24,24,1352,772,'#ffffff',18)}${txt(64,76,'NEOTALK  /  EVIDÊNCIAS DO ROADMAP  /  22 OUT 2026',16,colors.blue,700)}${txt(64,128,title,34,colors.ink,700)}${txt(64,169,sub,19,colors.muted)}${body}${line(64,704,1336,704)}${footer.map((s,i)=>txt(64,741+i*27,s,17,colors.muted)).join('')}</svg>`;}
async function save(name,svg){await fs.writeFile(path.join(dir,name+'.svg'),svg);await sharp(Buffer.from(svg)).png().toFile(path.join(dir,name+'.png'));}

let b=txt(72,225,'Conexões TCP por rodada de 12 chamadas',23,colors.ink,600);
for(const [i,v] of [12,1].entries()){const x=140+i*220,h=v/12*300;b+=rect(x,590-h,130,h,i?colors.teal:colors.blue)+txt(x+45,570-h,String(v),32,colors.ink,700)+txt(x-17,632,i?'Com pool':'Sem pool',23);}
b+=txt(690,225,'Tempo total por rodada · ms',23,colors.ink,600);
for(let v=0;v<=800;v+=200)b+=line(750,590-v/800*300,1250,590-v/800*300)+txt(692,596-v/800*300,String(v),16,colors.muted);
for(const [i,key] of ['temporary','pooled'].entries()){const s=http.summary[key],x=830+i*230,h=s.mean_ms/800*300;b+=rect(x,590-h,130,h,i?colors.teal:colors.blue)+txt(x+3,568-h,fmt(s.mean_ms)+' ms',23,colors.ink,700)+txt(x-12,632,i?'Com pool':'Sem pool',23);const y1=590-s.max_ms/800*300,y2=590-s.min_ms/800*300;b+=line(x+65,y1,x+65,y2,colors.ink)+line(x+50,y1,x+80,y1,colors.ink)+line(x+50,y2,x+80,y2,colors.ink);}
b+=txt(758,676,'Barras: média; traço: mínimo–máximo das 6 rodadas.',16,colors.muted);
await save('http-pool',canvas('Menos conexões; ganho local isolado','PERF-03a · HTTP/1.1 em loopback · 6 rodadas por variante · ordem alternada',b,[
 '20 ms por nova TCP + 5 ms por resposta foram impostos pelo teste. Sem TLS, GPT, WAN, Unity ou microfone.',
 'Não representa ganho de produção. Fonte: http-loopback.json; código medido: 02dc83e (inclui 1f1b260).']));

b=txt(64,222,'Tempo virtual até escoar toda a fala recebida',23,colors.ink,600);
for(let m=0;m<=110;m+=10){const x=240+m/110*1000;b+=line(x,267,x,550)+txt(x-8,583,String(m),16,colors.muted);}
for(const [i,s] of lab.virtual_pitch.entries()){const y=285+i*96,total=s.drain_finished_ms/60000,tail=total-60;b+=txt(64,y+30,`${s.wpm} palavras/min`,20,colors.ink,600)+rect(240,y,60/110*1000,46,colors.blue,0)+rect(240+60/110*1000,y,tail/110*1000,46,colors.amber,0)+txt(255+total/110*1000,y+29,fmt(total)+' min',19,colors.ink,600)+txt(242,y+70,`${s.words.toLocaleString('pt-BR')} palavras preservadas · cauda de ${fmt(tail)} min`,17,colors.muted);}
b+=txt(1140,619,'minutos',17,colors.muted)+rect(245,629,18,18,colors.blue,0)+txt(274,646,'60 min de fala',19)+rect(520,629,18,18,colors.amber,0)+txt(549,646,'Atraso restante após a fala',19);
await save('queue-pressure',canvas('Continuidade não significa baixa latência','QUEUE-06b · 60 minutos VIRTUAIS por cenário · API, ASR e reprodução simulados',b,[
 'Nos três cenários: sem mute automático, reset solicitado ou perda de texto aceito. Não é teste real de uma hora.',
 'Hipóteses: 0,65 glosa/palavra; 650 ms/glosa; 80 ms/transição. Aos 220 ppm, sobra uma cauda de 41,8 min.']));

const origin=lab.native_batches[0].admitted,scale=17.5,startX=170;
b=txt(64,222,'Linha do tempo da saída principal · segundos desde a primeira admissão',23,colors.ink,600);
for(let s=0;s<=60;s+=10){const x=startX+s*scale;b+=line(x,265,x,555)+txt(x-6,585,String(s),16,colors.muted);}
const stages=[['admitted','translation_ready',colors.blue],['translation_ready','dispatched',colors.gray],['dispatched','first_frame',colors.amber],['first_frame','last_frame',colors.teal]];
for(const [i,row] of lab.native_batches.entries()){const y=290+i*95;b+=txt(64,y+29,`Lote ${i+1}`,21,colors.ink,600);for(const [from,to,c] of stages)b+=rect(startX+(row[from]-origin)/1000*scale,y,(row[to]-row[from])/1000*scale,42,c,0);b+=txt(startX+(row.last_frame-origin)/1000*scale+10,y+29,fmt((row.last_frame-row.admitted)/1000)+' s',18);}
for(const [i,[label,c]] of [['Tradução simulada',colors.blue],['Espera para despacho',colors.gray],['Despacho → frame',colors.amber],['Reprodução nativa',colors.teal]].entries()){const x=70+i*325;b+=rect(x,634,18,18,c,0)+txt(x+27,650,label,17);}
await save('native-timeline',canvas('Onde o pequeno ensaio mostrou espera','OBS-01 · histórico de laboratório · 3 lotes / 18 palavras · NÃO é comparação antes/depois',b,[
 'Unity real com SwiftShader; API/ASR simulados. Despacho→frame mistura etapas: não atribuir tudo ao Unity.',
 'Amostra de 22/10 às 11:26 (Fortaleza). Sem baseline de produção; n=3 não sustenta p95 representativo.']));
console.log('Generated three SVG/PNG charts in '+dir);
