// SPDX-License-Identifier: GPL-3.0-or-later
// Hardware integration test through a simulated Stream Deck WebSocket host.
import {WebSocketServer} from 'ws';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
await mkdir('tmp/test-results',{recursive:true});

const server=new WebSocketServer({host:'127.0.0.1',port:0});
await new Promise(resolve=>server.once('listening',resolve));
const port=server.address().port;
const messages=[], errors=[];
const pluginRoot=path.resolve('com.firflabs.wootdeck.sdPlugin');
const child=spawn(process.execPath,[path.join(pluginRoot,'bin/plugin.js'),'-port',String(port),'-pluginUUID','com.firflabs.wootdeck','-registerEvent','registerPlugin','-info',JSON.stringify({application:{version:'7.6.0',platform:'windows',platformVersion:'10.0',language:'en'},devices:[{id:'integration-deck',type:0,name:'Integration Deck',size:{columns:5,rows:3}}],plugin:{version:'0.1.0.0',uuid:'com.firflabs.wootdeck'},devicePixelRatio:1,colors:{}})],{windowsHide:true,stdio:'pipe',cwd:pluginRoot});
child.stderr.on('data',data=>errors.push(data.toString()));
child.stdout.on('data',data=>errors.push(data.toString()));
const socket=await Promise.race([new Promise(resolve=>server.once('connection',resolve)),delay(8000).then(()=>{throw new Error('Plugin failed to connect: '+errors.join(''));})]);
socket.on('message',raw=>messages.push(JSON.parse(raw)));
async function waitFor(predicate,label,timeout=9000) {
  const until=Date.now()+timeout;
  while(Date.now()<until) {const result=predicate();if(result)return result;await delay(40);}
  throw new Error(label+' timed out; stderr='+errors.join(''));
}
function send(event,context,kind,settings={}) {
  socket.send(JSON.stringify({event,context,action:'com.firflabs.wootdeck.'+kind,device:'integration-deck',payload:{settings,coordinates:{column:0,row:0},controller:'Keypad',state:0,isInMultiAction:false}}));
}
function inventory() {return messages.filter(m=>m.event==='sendToPropertyInspector'&&m.payload.type==='inventory').at(-1)?.payload.devices;}
let device, original, restoreSettings;
try {
  await waitFor(()=>messages.some(m=>m.event==='registerPlugin'),'registration');
  send('willAppear','current','current');
  send('propertyInspectorDidAppear','current','current');
  device=await waitFor(()=>inventory()?.find(d=>d.ready),'device inventory');
  original=device.activeSlot;
  const settings={serial:device.serial};
  send('didReceiveSettings','current','current',{...settings,theme:'ice'});
  await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='current'&&Buffer.from(m.payload.image.split(',')[1]||'','base64').toString().includes('data-mode="profile-badge"')),'themed profile badge');
  send('willAppear','depth','depth',{...settings,key:26,keyLabel:'W'});
  await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='depth'&&Buffer.from(m.payload.image.split(',')[1]||'','base64').toString().includes('Peak')),'native depth meter');
  send('didReceiveSettings','depth','depth',{...settings,key:26,keyLabel:'W',depthUnit:'mm',fullTravelMm:4});
  await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='depth'&&Buffer.from(m.payload.image.split(',')[1]||'','base64').toString().includes(' mm')),'millimeter depth meter');
  send('didReceiveSettings','depth','depth',{...settings,keyMode:'any'});
  await waitFor(()=>messages.some(m=>m.event==='setImage'&&m.context==='depth'&&Buffer.from(m.payload.image.split(',')[1]||'','base64').toString().includes('data-mode="any-key-bars"')),'native Any Key bar list');
  send('didReceiveSettings','depth','depth',{...settings,key:26,keyLabel:'W',keyMode:'single'});
  if(process.argv.includes('--depth-only')) {
    console.log(JSON.stringify({registration:true,themedStatus:true,nativeDepth:true,anyKeyOverview:true,profileWrites:0}));
  } else {
  const target=device.profiles.find(p=>p.slot!==original);
  restoreSettings={...settings,slot:original,profileName:device.profiles.find(p=>p.slot===original).name};
  const targetSettings={...settings,slot:target.slot,profileName:target.name};
  send('willAppear','select','select',targetSettings);
  send('keyDown','select','select',targetSettings);
  await waitFor(()=>inventory()?.find(d=>d.serial===device.serial)?.activeSlot===target.slot,'select profile readback');
  send('willAppear','restore','select',restoreSettings);
  send('keyDown','restore','select',restoreSettings);
  await waitFor(()=>inventory()?.find(d=>d.serial===device.serial)?.activeSlot===original,'original profile restore');
  send('willAppear','cycle','cycle',{...settings,direction:1});
  send('keyDown','cycle','cycle',{...settings,direction:1});
  send('keyUp','cycle','cycle',{...settings,direction:1});
  await waitFor(()=>inventory()?.find(d=>d.serial===device.serial)?.activeSlot!==original,'cycle profile');
  send('keyDown','restore','select',restoreSettings);
  await waitFor(()=>inventory()?.find(d=>d.serial===device.serial)?.activeSlot===original,'restore after cycle');
  // A stale profile name must reject a write and raise a Stream Deck alert.
  send('didReceiveSettings','select','select',{...targetSettings,profileName:'no-longer-the-same-profile'});
  await delay(100);
  send('keyDown','select','select',{...targetSettings,profileName:'no-longer-the-same-profile'});
  await waitFor(()=>messages.some(m=>m.event==='showAlert'&&m.context==='select'),'stale profile alert');
  if(inventory().find(d=>d.serial===device.serial).activeSlot!==original)throw new Error('Rejected stale settings changed profile');
  console.log(JSON.stringify({registration:true,nativeDepth:true,anyKeyOverview:true,select:true,cycle:true,restore:true,staleProfileRejected:true,images:messages.filter(m=>m.event==='setImage').length}));
  }
} finally {
  if(device && restoreSettings && inventory()?.find(d=>d.serial===device.serial)?.activeSlot!==original) {
    send('willAppear','emergency-restore','select',restoreSettings);
    send('keyDown','emergency-restore','select',restoreSettings);
    await delay(1500);
  }
  child.kill();
  await delay(400);
  socket.close();server.close();
  const safeMessages=messages.map(message=>message.event==='setImage'?{event:message.event,context:message.context,imageBytes:message.payload.image.length}:message);
  await writeFile('tmp/test-results/plugin-smoke.json',JSON.stringify({messages:safeMessages,errors},null,2));
}
