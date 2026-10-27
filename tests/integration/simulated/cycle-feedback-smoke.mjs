// SPDX-License-Identifier: GPL-3.0-or-later
// Simulate delayed hardware success/failure without opening or writing a keyboard.
import {build} from 'esbuild';
import {WebSocketServer} from 'ws';
import {spawn} from 'node:child_process';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

await mkdir('tmp/test-results',{recursive:true});

const root=path.resolve('tmp/test-runs/cycle-feedback');
await mkdir(root,{recursive:true});
await copyFile('com.firflabs.wootdeck.sdPlugin/manifest.json',path.join(root,'manifest.json'));
await build({entryPoints:['src/plugin.ts'],bundle:true,platform:'node',target:'node24',format:'esm',outfile:path.join(root,'plugin.js'),banner:{js:'import {createRequire} from "node:module"; const require=createRequire(import.meta.url);'},plugins:[{
  name:'simulated-hardware',setup(builder){
    builder.onLoad({filter:/[\\/]src[\\/]backend\.ts$/},()=>({loader:'ts',contents:`
      import {EventEmitter} from 'node:events';
      export class Backend extends EventEmitter {
        devices=[{serial:'simulated',generation:1,name:'Simulated Wooting',firmware:'2.14.2',ready:true,writable:true,activeSlot:0,profiles:[{slot:0,name:'Typing Profile'},{slot:1,name:'Gaming Profile'}],observedAt:Date.now()}];
        depth=new Map(); status='Connected'; timer;
        start(){this.timer=setInterval(()=>{this.devices[0].observedAt=Date.now();this.emit('change');},100);this.emit('change');}
        stop(){clearInterval(this.timer);}
        subscribe(){}
        async request(op,payload){
          if(!['cycle','activate'].includes(op)) throw new Error('Unexpected operation');
          await new Promise(resolve=>setTimeout(resolve,650));
          if(payload.direction===-1 || (op==='activate' && payload.slot===1)) throw new Error('Simulated switch failure');
          this.devices[0].activeSlot=op==='activate'?payload.slot:1; this.emit('change'); return {slot:this.devices[0].activeSlot,generation:1};
        }
      }` }));
  }
}]});
const server=new WebSocketServer({host:'127.0.0.1',port:0});
await new Promise(resolve=>server.once('listening',resolve));
const port=server.address().port, messages=[], errors=[], lastImages=new Map();
const child=spawn(process.execPath,[path.join(root,'plugin.js'),'-port',String(port),'-pluginUUID','com.firflabs.wootdeck','-registerEvent','registerPlugin','-info',JSON.stringify({application:{version:'7.6.0',platform:'windows',platformVersion:'10.0',language:'en'},devices:[{id:'simulation',type:0,name:'Simulation',size:{columns:5,rows:3}}],plugin:{version:'0.1.21.0',uuid:'com.firflabs.wootdeck'},devicePixelRatio:1,colors:{}})],{cwd:root,windowsHide:true,stdio:'pipe'});
child.stderr.on('data',data=>errors.push(String(data)));
child.stdout.on('data',data=>errors.push(String(data)));
let socket;
async function waitFor(predicate,label){
  const deadline=Date.now()+8000;
  while(Date.now()<deadline){if(predicate())return;await delay(20);}
  throw new Error(label+' timed out: '+errors.join(''));
}
function send(event,settings,kind='cycle',context=kind){socket.send(JSON.stringify({event,context,action:'com.firflabs.wootdeck.'+kind,device:'simulation',payload:{settings,coordinates:{column:0,row:0},controller:'Keypad',state:0,isInMultiAction:false}}));}
const images=(context='cycle')=>messages.filter(m=>m.event==='setImage' && m.context===context).map(m=>Buffer.from(m.payload.image.split(',')[1],'base64').toString());
try {
  socket=await Promise.race([new Promise(resolve=>server.once('connection',resolve)),delay(8000).then(()=>{throw new Error('No plugin connection');})]);
  socket.on('message',data=>{const value=JSON.parse(data);messages.push(value);if(value.event==='setImage') lastImages.set(value.context,Buffer.from(value.payload.image.split(',')[1],'base64').toString());});
  const settings={serial:'simulated',direction:1};
  send('willAppear',settings);
  send('willAppear',settings,'current');
  send('willAppear',{serial:'simulated',slot:1,profileName:'Gaming Profile'},'select','target');
  await waitFor(()=>images().some(svg=>svg.includes('>P1</text>')),'initial observed slot');
  messages.length=0;
  send('keyDown',settings);send('keyUp',settings);
  await waitFor(()=>images().some(svg=>svg.includes('data-icon="spinner"')),'immediate spinner');
  const pending=images().find(svg=>svg.includes('data-icon="spinner"'));
  assert.ok(pending.includes('Gaming') && pending.includes('>P2</text>') && pending.includes('fill="#2563eb"'));
  assert.ok(!pending.includes('Switching'));
  await delay(100);
  assert.ok(lastImages.get('current')?.includes('>P1</text>'),'Current Profile retains observed slot while Cycle waits');
  assert.ok(!lastImages.get('current')?.includes('spinner'));
  assert.ok(!lastImages.get('target')?.includes('spinner'));
  await waitFor(()=>images().some(svg=>svg.includes('>P2</text>') && svg.includes('chevron-right') && !svg.includes('spinner')),'confirmed slot');
  assert.ok(new Set(images().filter(svg=>svg.includes('spinner'))).size>1,'Spinner animates while waiting');
  const failed={...settings,direction:-1,profileColorMode:'custom',profilePendingBackground:'#663399'};
  send('didReceiveSettings',failed);
  await delay(100); messages.length=0;
  send('keyDown',failed);send('keyUp',failed);
  await waitFor(()=>images().some(svg=>svg.includes('spinner') && svg.includes('>P1</text>') && svg.includes('fill="#663399"')),'custom pending color and reverse target');
  await waitFor(()=>messages.some(m=>m.event==='showAlert'),'failure surfaced');
  await waitFor(()=>images().some(svg=>svg.includes('Simulated') && svg.includes('Gaming')),'rollback to observed profile');
  assert.ok(images().every(svg=>!svg.includes('Switching')));
  const selected={serial:'simulated',slot:0,profileName:'Typing Profile'};
  send('willAppear',selected,'select');
  await delay(100); messages.length=0;
  send('keyDown',selected,'select');
  await waitFor(()=>images('select').some(svg=>svg.includes('spinner') && svg.includes('>P1</text>') && svg.includes('fill="#2563eb"')),'Select Profile immediate spinner');
  await delay(100);
  assert.ok(lastImages.get('current')?.includes('>P2</text>'),'Current Profile retains observed slot while Select waits');
  assert.ok(!lastImages.get('current')?.includes('spinner'));
  assert.ok(!lastImages.get('cycle')?.includes('spinner'));
  await waitFor(()=>images('select').some(svg=>!svg.includes('spinner') && svg.includes('fill="#ecfaff"')),'Select Profile confirmed');
  const failedSelect={serial:'simulated',slot:1,profileName:'Gaming Profile'};
  send('didReceiveSettings',failedSelect,'select');
  await delay(100); messages.length=0;
  send('keyDown',failedSelect,'select');
  await waitFor(()=>images('select').some(svg=>svg.includes('spinner') && svg.includes('>P2</text>')),'Select Profile pending failure target');
  await waitFor(()=>messages.some(m=>m.event==='showAlert' && m.context==='select'),'Select failure surfaced');
  assert.ok(lastImages.get('current')?.includes('Typing') && lastImages.get('current')?.includes('>P1</text>'),'Current Profile keeps actual state after Select failure');
  for(const context of ['current','target']) assert.ok(images(context).every(svg=>!svg.includes('spinner')),'Other buttons never animate');
  assert.ok(images('select').every(svg=>!svg.includes('Switching')));
  const evidence={optimisticTarget:true,animatedSpinner:true,blueUntilConfirmed:true,customPendingColor:true,failureRollback:true,selectSuccess:true,selectFailure:true,pressedButtonOnly:true,hardwareAccess:false};
  await writeFile('tmp/test-results/cycle-feedback-smoke.json',JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
} finally {
  child.kill(); socket?.close(); server.close();
}
