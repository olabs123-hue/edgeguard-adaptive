import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp=mkdtempSync(join(tmpdir(),'edgeguard-d1-'));
execFileSync('tsc',['src/index.ts','--target','ES2022','--module','ESNext',
  '--moduleResolution','Bundler','--skipLibCheck','--outDir',tmp]);
const {default:consumer, validateEvent}=await import(pathToFileURL(join(tmp,'index.js')).href);
rmSync(tmp,{recursive:true,force:true});
const id='a1b2c3d4-1234-4123-8123-1234567890ab';
const req='b2b2c3d4-1234-4123-8123-1234567890ab';
const event={version:1,eventId:id,requestId:req,origin:'origin-a',type:'origin_attempt_failure',
  timestamp:'2026-11-17T00:00:00.000Z',status:503};
function message(body) {
  return {body, acknowledged:0,retried:0,ack(){this.acknowledged++;},
    retry(){this.retried++;}};
}
function database(opts={}) {
  const saved=new Map();
  const sql=[];
  return {saved,sql,prepare(query) {
    sql.push(query);
    return {bind(...args) {
      return {async run() {
        if(opts.throw) throw Error('temporary database outage');
        if(opts.fail) return {success:false};
        if (!saved.has(args[0])) saved.set(args[0],args);
        return {success:true};
      }};
    }};
  }};
}
test('accepts bounded structured events',()=>{
  assert.equal(validateEvent(event)?.type,'origin_attempt_failure');
  assert.equal(validateEvent({...event,origin:'https://private.example'}),null);
  assert.equal(validateEvent({...event,requestId:'not-a-uuid'}),null);
  assert.equal(validateEvent({...event,status:999}),null);
  assert.equal(validateEvent({...event,type:'exfiltrate'}),null);
  assert.equal(validateEvent(null),null);
});
test('ack only after D1 write and duplicate event is idempotent',async()=>{
  const db=database();
  const a=message(event),b=message(event);
  await consumer.queue({messages:[a,b]},{RELIABILITY_DB:db});
  assert.equal(db.saved.size,1);
  assert.equal(a.acknowledged,1);
  assert.equal(b.acknowledged,1);
  assert.equal(a.retried+b.retried,0);
  assert.match(db.sql[0],/ON CONFLICT\(event_id\) DO NOTHING/);
  assert.deepEqual(db.saved.get(id),[id,event.timestamp,event.type,event.origin,req,503]);
});
test('transient database failures request retry',async()=>{
  const msg=message(event);
  await consumer.queue({messages:[msg]},{RELIABILITY_DB:database({throw:true})});
  assert.equal(msg.retried,1);
  assert.equal(msg.acknowledged,0);
});
test('unsuccessful database run requests retry',async()=>{
  const msg=message(event);
  await consumer.queue({messages:[msg]},{RELIABILITY_DB:database({fail:true})});
  assert.equal(msg.retried,1);
});
test('poison message acknowledged without database write',async()=>{
  const db=database(),msg=message({...event,origin:'not-allowed'});
  await consumer.queue({messages:[msg]},{RELIABILITY_DB:db});
  assert.equal(msg.acknowledged,1);
  assert.equal(db.sql.length,0);
});
test('one failure does not prevent next message from completing',async()=>{
  const msg1=message(event),msg2=message({...event,eventId:'c1b2c3d4-1234-4123-8123-1234567890ab'});
  let calls=0;const db={prepare(){return {bind(){return {async run(){
    ++calls; if(calls===1)throw Error('temporary');return {success:true};
  }}}}}};
  await consumer.queue({messages:[msg1,msg2]},{RELIABILITY_DB:db});
  assert.equal(msg1.retried,1);assert.equal(msg2.acknowledged,1);
});
