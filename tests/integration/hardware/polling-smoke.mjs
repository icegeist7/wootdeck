// SPDX-License-Identifier: GPL-3.0-or-later
// Read-only hardware traffic budget check. Stop the live plugin before running.
// Evidence contains counters only, never key codes or analog readings.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

await mkdir('tmp/test-results',{recursive:true});

const child=spawn(fileURLToPath(new URL('../../../com.firflabs.wootdeck.sdPlugin/bin/wootdeck-helper.exe',import.meta.url)),[],{windowsHide:true,stdio:'pipe'});
let sequence=0, devices=[], depthErrors=0, frames=0;
const pending=new Map();
createInterface({input:child.stdout}).on('line',line=>{
  const value=JSON.parse(line);
  if(value.event==='devices') devices=value.devices;
  if(value.event==='depth') frames++;
  if(value.event==='depthUnavailable') depthErrors++;
  if(pending.has(value.id)) {
    const {resolve,reject,timer}=pending.get(value.id);
    pending.delete(value.id); clearTimeout(timer);
    value.ok?resolve(value.result):reject(new Error(value.error));
  }
});
child.stderr.on('data',data=>process.stderr.write(data));
function request(op,payload={}) {
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${op} timed out`));},8000);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({v:1,id,op,...payload})+'\n');
  });
}
try {
  const deadline=Date.now()+10000;
  while(!devices.some(d=>d.ready) && Date.now()<deadline) await delay(100);
  const device=devices.find(d=>d.ready);
  assert.ok(device,'Keyboard discovered');
  const original=device.activeSlot;
  await request('subscribe',{subscriptions:[{serial:device.serial,keys:[],allKeys:true}]});
  await delay(1500);
  const before=await request('stats'), started=Date.now(), initialFrames=frames;
  await delay(15000);
  const after=await request('stats');
  const delta=Object.fromEntries(Object.keys(after).map(key=>[key,after[key]-before[key]]));
  assert.ok(delta.currentReads>=12 && delta.currentReads<=16,'Profile reads stay near 1 Hz');
  assert.ok(delta.discoveries>=2 && delta.discoveries<=4,'Discovery stays near 0.2 Hz');
  assert.equal(delta.metadataReads,0,'No recurring metadata burst during measurement');
  assert.equal(delta.commands,delta.currentReads,'No unsolicited configuration commands');
  assert.equal(delta.timeouts,0,'No HID command timeouts');
  assert.ok(delta.depthSamples>=150 && delta.depthSamples<=301,'Depth cache reads bounded at 20 Hz');
  assert.ok(frames>initialFrames,'Telemetry frames received');
  assert.equal(depthErrors,0,'No SDK errors');
  assert.equal(devices.find(d=>d.serial===device.serial)?.activeSlot,original,'Profile unchanged');
  await request('subscribe',{subscriptions:[]});
  await delay(1000);
  const idleBefore=await request('stats');
  await delay(1500);
  const idleAfter=await request('stats');
  assert.equal(idleAfter.depthSamples,idleBefore.depthSamples,'No samples without visible depth subscriptions');
  const evidence={durationMs:Date.now()-started-2500,delta,frames:frames-initialFrames,depthErrors,idleDepthSamples:idleAfter.depthSamples-idleBefore.depthSamples,profileUnchanged:true};
  await writeFile('tmp/test-results/polling-smoke.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
} finally {
  child.stdin.end();
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000).then(()=>child.kill())]);
}
