import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp=mkdtempSync(join(tmpdir(),'edgeguard-ts-'));
execFileSync('tsc',['src/index.ts','--target','ES2022','--module','ESNext',
  '--moduleResolution','Bundler','--skipLibCheck','--outDir',tmp]);
const {default:worker}=await import(pathToFileURL(join(tmp,'index.js')).href);
rmSync(tmp,{recursive:true,force:true});
const realFetch=globalThis.fetch;

test('landing page, health and disabled forwarding',async()=>{
  const env={ORIGIN_URLS:''};
  assert.equal((await worker.fetch(new Request('https://edge.test/healthz'),env)).status,200);
  assert.equal((await worker.fetch(new Request('https://edge.test/'),env)).status,200);
  assert.equal((await worker.fetch(new Request('https://edge.test/any'),env)).status,503);
});
test('rejects methods other than GET and HEAD',async()=>{
  assert.equal((await worker.fetch(new Request('https://edge.test/post',{method:'POST'}),{ORIGIN_URLS:''})).status,405);
});
test('configured origins require an API token',async()=>{
  const env={ORIGIN_URLS:'https://primary.test'};
  assert.equal((await worker.fetch(new Request('https://edge.test/private'),env)).status,401);
  assert.equal((await worker.fetch(new Request('https://edge.test/private'),{...env,API_TOKEN:'secret'})).status,401);
});
test('routes authorized requests and strips credentials',async()=>{
  const targets=[], auth=[];
  globalThis.fetch=async req=>{targets.push(req.url);auth.push(req.headers.get('authorization'));return new Response('ok')};
  try {
    const request=new Request('https://edge.test/public?q=1',{headers:{authorization:'Bearer secret',cookie:'secret=1'}});
    const response=await worker.fetch(request,{ORIGIN_URLS:'https://primary.test',API_TOKEN:'secret'});
    assert.equal(response.status,200);
    assert.deepEqual(targets,['https://primary.test/public?q=1']);
    assert.deepEqual(auth,[null]);
    assert.equal(response.headers.get('x-edgeguard-origin'),'primary.test');
  }finally{globalThis.fetch=realFetch}
});
test('GET retries other origin after a connection error',async()=>{
  const targets=[];
  globalThis.fetch=async req=>{targets.push(req.url);if(req.url.includes('fail.test'))throw Error('offline');return new Response('ok')};
  try {
    const response=await worker.fetch(new Request('https://edge.test/fallback',{headers:{authorization:'Bearer t'}}),
      {ORIGIN_URLS:'https://fail.test,https://healthy.test',API_TOKEN:'t'});
    assert.equal(response.status,200);
    assert.ok(targets.some(x=>x.includes('fail.test')));
    assert.ok(targets.some(x=>x.includes('healthy.test')));
  }finally{globalThis.fetch=realFetch}
});
test('single origin opens breaker and publishes event after three failures',async()=>{
  const events=[];
  globalThis.fetch=async()=>{throw Error('offline')};
  try {
    const env={ORIGIN_URLS:'https://unhealthy-only.test',API_TOKEN:'x',EVENT_QUEUE:{send:async e=>events.push(e)}};
    for(let n=0;n<3;n++){
      const response=await worker.fetch(new Request('https://edge.test/error/'+n,{headers:{authorization:'Bearer x'}}),env);
      assert.equal(response.status,503);
    }
    assert.equal(events.filter(x=>x.type==='origin_failure').length,1);
  }finally{globalThis.fetch=realFetch}
});
test('disallows configuration containing URL credentials or HTTP',async()=>{
  const auth={authorization:'Bearer x'};
  for(const origin of ['http://untrusted.test','https://user:pass@untrusted.test','https://untrusted.test/path']){
    const response=await worker.fetch(new Request('https://edge.test/x',{headers:auth}),
      {ORIGIN_URLS:origin,API_TOKEN:'x'});
    assert.equal(response.status,503);
  }
});
test('queue acknowledges valid events and poison messages',async()=>{
  const ack=[];
  const msg=(body,id)=>({body,ack(){ack.push(id)},retry(){throw Error('unexpected retry')}});
  await worker.queue({messages:[
    msg({version:1,eventId:'e',type:'origin_failure',origin:'a',requestId:'r',timestamp:'now'},'valid'),
    msg(null,'invalid')
  ]},{ORIGIN_URLS:''});
  assert.deepEqual(ack,['valid','invalid']);
});


test('private service bindings fail over from synthetic origin A to B',async()=>{
  const calls=[];
  const env={
    ORIGIN_URLS:'', API_TOKEN:'private-test-token',
    ORIGIN_A:{fetch:async req=>{calls.push(['a',req.url,req.headers.get('authorization')]);return new Response('unavailable',{status:503})}},
    ORIGIN_B:{fetch:async req=>{calls.push(['b',req.url,req.headers.get('authorization')]);return new Response('fallback-ok',{status:200})}}
  };
  const unauthorized=await worker.fetch(new Request('https://edge.test/demo/fail'),env);
  assert.equal(unauthorized.status,401);
  const authorized=await worker.fetch(new Request('https://edge.test/demo/fail',{headers:{authorization:'Bearer private-test-token',cookie:'x=1'}}),env);
  assert.equal(authorized.status,200);
  assert.equal(await authorized.text(),'fallback-ok');
  assert.deepEqual(calls.map(x=>x[0]),['a','b']);
  assert.deepEqual(calls.map(x=>x[2]),[null,null]);
  assert.equal(authorized.headers.get('x-edgeguard-origin'),'origin-b');
});
