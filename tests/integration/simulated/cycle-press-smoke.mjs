// SPDX-License-Identifier: GPL-3.0-or-later
// Simulated Stream Deck host and keyboard. Never opens real hardware.
import {build} from 'esbuild';
import {WebSocketServer} from 'ws';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdir,copyFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

await mkdir('tmp/test-results',{recursive:true});

const root=path.resolve('tmp/test-runs/cycle-press');
await mkdir(root,{recursive:true});
await copyFile('com.firflabs.wootdeck.sdPlugin/manifest.json',path.join(root,'manifest.json'));
await build({entryPoints:['src/plugin.ts'],bundle:true,platform:'node',target:'node24',format:'esm',outfile:path.join(root,'plugin.js'),banner:{js:'import {createRequire} from "node:module";const require=createRequire(import.meta.url);'},plugins:[{
  name:'fake-hardware',setup(builder){builder.onLoad({filter:/[\\/]src[\\/]backend\.ts$/},()=>({loader:'ts',contents:`
    import {EventEmitter} from 'node:events';
    export class Backend extends EventEmitter {
      devices=[{serial:'simulated',generation:1,name:'Simulated',ready:true,writable:true,activeSlot:0,profiles:[{slot:0,name:'One'},{slot:1,name:'Two'},{slot:2,name:'Three'}],observedAt:Date.now()}];depth=new Map();status='Connected';timer;
      tick(){this.devices[0].observedAt=Date.now();this.emit('change');}
      start(){this.timer=setInterval(()=>this.tick(),50);process.on('message',message=>{Object.assign(this.devices[0],message);this.tick();});this.tick();}
      subscribe(){}stop(){clearInterval(this.timer);}
      async request(op,payload){if(op!=='cycle')throw new Error('Unexpected operation');process.stdout.write(JSON.stringify({testRequest:payload})+'\\n');await new Promise(resolve=>setTimeout(resolve,40));const d=this.devices[0],slots=payload.slots?.length?payload.slots:[0,1,2];d.activeSlot=slots[(slots.indexOf(d.activeSlot)+payload.direction+slots.length)%slots.length];this.tick();return {slot:d.activeSlot,generation:d.generation};}
    }` }));}
}]});
const server=new WebSocketServer({host:'127.0.0.1',port:0});
await new Promise(resolve=>server.once('listening',resolve));
const info={application:{version:'7.6.0',platform:'windows',platformVersion:'10.0',language:'en'},devices:[{id:'simulation',type:0,name:'Simulation',size:{columns:5,rows:3}}],plugin:{version:'0.1.56.0',uuid:'com.firflabs.wootdeck'},devicePixelRatio:1,colors:{}};
let socket,image='',requests=[],errors=[];
const child=spawn(process.execPath,[path.join(root,'plugin.js'),'-port',String(server.address().port),'-pluginUUID',info.plugin.uuid,'-registerEvent','registerPlugin','-info',JSON.stringify(info)],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe','ipc']});
createInterface({input:child.stdout}).on('line',line=>{try{const value=JSON.parse(line);if(value.testRequest)requests.push(value.testRequest);}catch{}});
child.stderr.on('data',data=>errors.push(String(data)));
async function waitFor(predicate,label){const deadline=Date.now()+8000;while(Date.now()<deadline){if(predicate())return;await delay(10);}throw new Error(label+' timed out: '+errors.join(''));}
function send(event,settings,payload={}){socket.send(JSON.stringify({event,context:'cycle',action:info.plugin.uuid+'.cycle',device:'simulation',payload:{settings,coordinates:{column:0,row:0},controller:'Keypad',state:0,isInMultiAction:false,...payload}}));}
async function expectRequest(count,direction){await waitFor(()=>requests.length===count,'one cycle request');assert.equal(requests.at(-1).direction,direction);await delay(100);}
try {
  socket=await Promise.race([new Promise(resolve=>server.once('connection',resolve)),delay(8000).then(()=>{throw new Error('No host connection');})]);
  socket.on('message',data=>{const m=JSON.parse(data);if(m.event==='setImage')image=Buffer.from(m.payload.image.split(',')[1],'base64').toString();if(m.event==='getGlobalSettings')socket.send(JSON.stringify({event:'didReceiveGlobalSettings',context:m.context,id:m.id,payload:{settings:{}}}));});
  let settings={serial:'simulated',direction:1,longDirection:-1,longPressMs:250,animation:'none'};
  send('willAppear',settings);
  await waitFor(()=>image.includes('>P1</text>'),'initial image');
  assert.ok(image.includes('chevron-left') && image.includes('chevron-right'));
  send('keyDown',settings);await delay(80);assert.equal(requests.length,0);
  send('keyUp',settings);await expectRequest(1,1);assert.ok(image.includes('>P2</text>'));
  send('keyDown',settings);await expectRequest(2,-1);await delay(350);assert.equal(requests.length,2);
  send('keyUp',settings);await delay(100);assert.equal(requests.length,2);assert.ok(image.includes('>P1</text>'));
  settings={...settings,direction:-1,longDirection:1};send('didReceiveSettings',settings);await delay(60);
  send('keyDown',settings);await delay(60);send('keyUp',settings);await expectRequest(3,-1);
  send('keyDown',settings);send('keyDown',settings);await expectRequest(4,1);send('keyUp',settings);await delay(80);assert.equal(requests.length,4);
  send('keyDown',settings);await delay(60);send('didReceiveSettings',settings);await delay(300);send('keyUp',settings);await delay(60);assert.equal(requests.length,4);
  send('keyDown',settings);await delay(60);send('willDisappear',settings);await delay(300);send('keyUp',settings);await delay(60);assert.equal(requests.length,4);
  send('willAppear',settings);await delay(80);send('keyDown',settings);await delay(60);child.send({ready:false,generation:2});await delay(100);child.send({ready:true});await delay(300);send('keyUp',settings);await delay(60);assert.equal(requests.length,4);
  send('keyDown',settings,{isInMultiAction:true});await expectRequest(5,-1);
  send('sendToPlugin',settings,{type:'test'});await expectRequest(6,-1);
  const evidence={shortOnRelease:true,longAtThreshold:true,noExtraOnRelease:true,noRepeatWhileHeld:true,reversedDirections:true,duplicateDownIgnored:true,settingsCancel:true,pageCancel:true,reconnectCancel:true,multiActionShort:true,runActionShort:true,bothChevrons:true,hardwareAccess:false};
  await writeFile('tmp/test-results/cycle-press-smoke.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
} finally {child.kill();socket?.close();server.close();}
