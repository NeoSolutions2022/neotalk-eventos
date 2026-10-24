import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../app/captureBacklog.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {CaptureBacklog}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
test('budget never evicts accepted entries or admits invalid sizes',()=>{
 const q=new CaptureBacklog(10);assert.equal(q.push('a',6),true);assert.equal(q.push('b',5),false);
 for(const n of [0,-1,NaN,Infinity,1.5])assert.equal(q.push('bad',n),false);
 assert.equal(q.peek(),'a');assert.equal(q.shift(),'a');assert.equal(q.push('b',10),true);assert.equal(q.shift(),'b');
 assert.equal(q.snapshot().estimatedBytes,0);assert.equal(q.shift(),undefined);
});
test('compaction preserves all 20,000 accepted items in FIFO order',()=>{
 const q=new CaptureBacklog(100000);for(let i=0;i<10000;i++)assert.equal(q.push(i,1),true);
 for(let i=0;i<7000;i++)assert.equal(q.shift(),i);
 for(let i=10000;i<20000;i++)assert.equal(q.push(i,1),true);
 for(let i=7000;i<20000;i++)assert.equal(q.shift(),i);
 assert.equal(q.length,0);assert.equal(q.snapshot().estimatedBytes,0);
});
test('age is measured from staging; clearing releases old session data',()=>{
 let now=0;const q=new CaptureBacklog(100,()=>now);q.push({text:'private'},10);now=500;
 assert.equal(q.snapshot().oldestAgeMs,500);assert.ok(!JSON.stringify(q.snapshot()).includes('private'));
 q.clear();assert.equal(q.length,0);assert.equal(q.snapshot().oldestAgeMs,0);assert.equal(q.peek(),undefined);
 assert.throws(()=>new CaptureBacklog(0));
});
