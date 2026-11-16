import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const tmp=mkdtempSync(join(tmpdir(),'edgeguard-fixture-'));
execFileSync('tsc',['src/index.ts','--target','ES2022','--module','ESNext',
  '--moduleResolution','Bundler','--skipLibCheck','--outDir',tmp]);
const { default: fixture } = await import(pathToFileURL(join(tmp,'index.js')).href);
rmSync(tmp,{recursive:true,force:true});

test('fixture A deliberately fails while B stays healthy',async()=>{
  const req = new Request('https://private-origin.invalid/demo/fail');
  const a = await fixture.fetch(req,{ORIGIN_ID:'a'});
  const b = await fixture.fetch(req,{ORIGIN_ID:'b'});
  assert.equal(a.status,503);
  assert.equal(b.status,200);
  assert.equal((await b.json()).origin,'b');
});
test('fixture health and method restrictions',async()=>{
  assert.equal((await fixture.fetch(new Request('https://fixture.invalid/healthz'),{ORIGIN_ID:'a'})).status,200);
  assert.equal((await fixture.fetch(new Request('https://fixture.invalid/x',{method:'POST'}),{ORIGIN_ID:'a'})).status,405);
});
test('fixture has explicit allowlisted scenarios only',async()=>{
  assert.equal((await fixture.fetch(new Request('https://fixture.invalid/unknown'),{ORIGIN_ID:'b'})).status,404);
  assert.equal((await fixture.fetch(new Request('https://fixture.invalid/demo/ok'),{ORIGIN_ID:'a'})).status,200);
});
test('A slow scenario adds reproducible latency',async()=>{
  const start=performance.now();
  const resp=await fixture.fetch(new Request('https://fixture.invalid/demo/slow'),{ORIGIN_ID:'a'});
  const elapsed=performance.now()-start;
  assert.equal(resp.status,200);
  assert.ok(elapsed>=220, 'expected injected delay');
});
