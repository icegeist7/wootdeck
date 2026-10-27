// SPDX-License-Identifier: GPL-3.0-or-later
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

await mkdir('tmp/test-results',{recursive:true});

const executable = new URL('../../../com.firflabs.wootdeck.sdPlugin/bin/wootdeck-helper.exe',import.meta.url);
const child=spawn(fileURLToPath(executable),[],{windowsHide:true,stdio:'pipe'});
const any=process.argv.includes('--any');
let sequence=0, devices=[], depthFrames=0, depthErrors=0, started=false, allKeyFrames=0;
const pending=new Map(), evidence=[];
createInterface({input:child.stdout}).on('line',line=>{
  const value=JSON.parse(line);
  if(value.event==='hello') started=true;
  if(value.event==='devices') devices=value.devices;
  if(value.event==='depth') {
    depthFrames++;
    if(Object.values(value.devices).some(d=>d.allKeys===true)) allKeyFrames++;
    if(depthFrames<=2)evidence.push({event:'depth',sampledAt:value.sampledAt,allKeys:any,deviceCount:Object.keys(value.devices).length});
  }
  else if(value.event==='depthUnavailable') depthErrors++;
  else evidence.push(value);
  if(value.id && pending.has(value.id)) {
    const {resolve,reject,timer}=pending.get(value.id); pending.delete(value.id);clearTimeout(timer);
    value.ok ? resolve(value.result):reject(new Error(value.error));
  }
});
child.stderr.on('data',data=>process.stderr.write(data));
function request(op,payload={}) {
  const id=++sequence;
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Native request timeout'));},8000);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({v:1,id,op,...payload})+'\n');
  });
}
const limit=Date.now()+10000;
while((!started || !devices.some(d=>d.ready)) && Date.now()<limit) await delay(100);
let original, serial, generation;
try {
  const device=devices.find(d=>d.ready);
  if(!device)throw new Error('Native helper did not discover keyboard');
  ({serial,generation}=device); original=device.activeSlot;
  console.log(`Native device: ${device.name}, firmware ${device.firmware}, active slot ${original}`);
  await request('subscribe',{subscriptions:[{serial,keys:[26,4,22,7],allKeys:any}]});
  await delay(1500);
  if(process.argv.includes('--switch')) {
    const target=device.profiles.find(p=>p.slot!==original);
    if(!target)throw new Error('No alternative profile');
    try {
      await request('activate',{serial,generation,slot:target.slot,expectedName:target.name});
      await delay(800);
      console.log(`Native profile switch confirmed: ${target.name}`);
    } finally {
      await request('activate',{serial,generation,slot:original});
      console.log(`Original slot restored: ${original}`);
    }
  }
  await delay(1000);
  if(!depthFrames)throw new Error('Native SDK produced no telemetry');
  if(depthErrors)throw new Error(`Native SDK reported ${depthErrors} telemetry errors`);
  if(any && !allKeyFrames)throw new Error('Native all-key buffer produced no frames');
  const final=await request('list');
  if(final.find(d=>d.serial===serial)?.activeSlot!==original)throw new Error('Original profile not active');
  console.log(JSON.stringify({depthFrames,allKeyFrames,depthErrors,original,finalSlot:original}));
} finally {
  child.stdin.end();
  await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000).then(()=>child.kill())]);
  await writeFile(any?'tmp/test-results/native-any-key-smoke.json':'tmp/test-results/native-smoke.json',JSON.stringify(evidence,null,2));
}
