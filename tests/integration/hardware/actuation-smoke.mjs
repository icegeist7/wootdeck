// SPDX-License-Identifier: GPL-3.0-or-later
// Read-only live hardware check. Stop WootDeck before running; leave Wootility
// and its Background Service running. Records configuration/counters, no key input.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

await mkdir('tmp/test-results',{recursive:true});

const child=spawn('com.firflabs.wootdeck.sdPlugin/bin/wootdeck-helper.exe',[],{windowsHide:true,stdio:'pipe'});
let devices=[], sequence=0, errors=0;
const pending=new Map();
createInterface({input:child.stdout}).on('line',line=>{
  const message=JSON.parse(line);
  if(message.event==='devices') devices=message.devices;
  if(message.event==='depthUnavailable') errors++;
  const item=pending.get(message.id);
  if(item) {pending.delete(message.id);clearTimeout(item.timer);message.ok?item.resolve(message.result):item.reject(new Error(message.error));}
});
child.stderr.on('data',()=>{});
function request(op,payload={}) {
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${op} timed out`));},8000);
    pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({v:1,id,op,...payload})+'\n');
  });
}
async function waitFor(predicate) {
  const deadline=Date.now()+10000;
  while(Date.now()<deadline) {if(predicate()) return;await delay(50);}
  throw new Error('Configuration discovery timed out');
}
const delta=(a,b)=>Object.fromEntries(Object.keys(b).map(key=>[key,b[key]-a[key]]));
try {
  await waitFor(()=>devices.some(d=>d.ready));
  const original=devices.find(d=>d.ready), serial=original.serial;
  const get=()=>devices.find(d=>d.serial===serial);
  const subscription={serial,keys:[],allKeys:true,actuation:true};
  const before=await request('stats');
  await request('subscribe',{subscriptions:[subscription]});
  await waitFor(()=>get()?.actuation);
  const config=get().actuation;
  assert.equal(config.error,null);assert.equal(config.profileSlot,original.activeSlot);
  assert.ok(Object.keys(config.ratios).length>=90,'Standard physical keys decoded');
  for(const code of [26,4,22,7,44,225]) assert.ok(config.ratios[code]>=0 && config.ratios[code]<=1,`Configured physical key ${code}`);
  const loaded=await request('stats');
  assert.equal((loaded.commands-before.commands)-(loaded.currentReads-before.currentReads),2,'Only base and per-key configuration reads added');
  await delay(15000);
  const steady=await request('stats'), steadyDelta=delta(loaded,steady);
  assert.equal(steadyDelta.commands,steadyDelta.currentReads,'No configuration polling in depth sample loop');
  assert.equal(steadyDelta.timeouts,0);assert.equal(errors,0);
  assert.ok(steadyDelta.currentReads>=12 && steadyDelta.currentReads<=16);
  await request('refreshActuation',{serial,generation:original.generation});
  await waitFor(()=>get()?.actuation?.observedAt>config.observedAt);
  const refreshed=await request('stats'), refreshTime=get().actuation.observedAt;
  await request('refreshActuation',{serial,generation:original.generation});
  await delay(1500);
  const coalesced=await request('stats');
  assert.equal(get().actuation.observedAt,refreshTime,'Repeated refresh coalesced');
  assert.equal(coalesced.commands-refreshed.commands,coalesced.currentReads-refreshed.currentReads);
  assert.equal(get().activeSlot,original.activeSlot,'Readout never switches profiles');
  await request('subscribe',{subscriptions:[{...subscription,actuation:false}]});
  const disabled=await request('stats');
  await delay(1500);
  const after=await request('stats');
  assert.equal(after.commands-disabled.commands,after.currentReads-disabled.currentReads,'Disabled markers add no configuration reads');
  assert.equal(get().actuation,null,'Disabled configuration omitted');
  const evidence={profileUnchanged:true,profileSlot:original.activeSlot,configuredKeys:Object.keys(config.ratios).length,exampleConfiguredRatios:Object.fromEntries([26,4,22,7,44,225].map(key=>[key,config.ratios[key]])),steadyDelta,refreshCoalesced:true,disabledConfigurationReads:0,depthErrors:errors};
  await writeFile('tmp/test-results/actuation-smoke.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
} finally {
  child.stdin.end();
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000).then(()=>child.kill())]);
}
