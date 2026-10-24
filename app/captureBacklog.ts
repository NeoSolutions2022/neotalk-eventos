// Session-local staging, separate from the bounded translation/playback window.
// No disk persistence, network writes, timers, speech inspection or eviction.
export class CaptureBacklog<T> {
  private entries: ({value:T;bytes:number;at:number}|undefined)[] = [];
  private head = 0;
  private used = 0;
  constructor(readonly budget:number, private now:()=>number=()=>Date.now()) {
    if (!Number.isSafeInteger(budget)||budget<1) throw new RangeError('Invalid backlog budget');
  }
  get length(){return this.entries.length-this.head;}
  canAccept(bytes:number){return Number.isSafeInteger(bytes)&&bytes>0&&bytes<=this.budget-this.used;}
  push(value:T,bytes:number){
    if(!this.canAccept(bytes))return false;
    this.entries.push({value,bytes,at:this.now()});this.used+=bytes;return true;
  }
  peek(){return this.entries[this.head]?.value;}
  shift(){
    const entry=this.entries[this.head];if(!entry)return undefined;
    this.entries[this.head++]=undefined;this.used-=entry.bytes;
    if(this.head===this.entries.length){this.entries=[];this.head=0;}
    else if(this.head>=512&&this.head*2>=this.entries.length){this.entries=this.entries.slice(this.head);this.head=0;}
    return entry.value;
  }
  clear(){this.entries=[];this.head=0;this.used=0;}
  snapshot(){return {items:this.length,estimatedBytes:this.used,budgetBytes:this.budget,
    oldestAgeMs:this.length?Math.max(0,this.now()-this.entries[this.head]!.at):0};}
}
