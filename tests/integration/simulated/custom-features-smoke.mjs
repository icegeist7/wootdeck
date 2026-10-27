// SPDX-License-Identifier: GPL-3.0-or-later
// Integration against a simulated host and backend; never accesses real HID.
import {build} from 'esbuild';
import {WebSocketServer} from 'ws';
import {spawn} from 'node:child_process';
import {mkdir,copyFile,writeFile,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';
import path from 'node:path';
import assert from 'node:assert/strict';

await mkdir('tmp/test-results',{recursive:true});

const root=path.resolve('tmp/test-runs/custom-features');
await mkdir(root,{recursive:true});
const manifest=JSON.parse(await readFile('com.firflabs.wootdeck.sdPlugin/manifest.json','utf8'));
await copyFile('com.firflabs.wootdeck.sdPlugin/manifest.json',path.join(root,'manifest.json'));
await build({entryPoints:['src/plugin.ts'],bundle:true,platform:'node',target:'node24',format:'esm',outfile:path.join(root,'plugin.js'),banner:{js:'import {createRequire} from "node:module";const require=createRequire(import.meta.url);'},plugins:[{
  name:'fake-backend',setup(builder){builder.onLoad({filter:/[\\/]src[\\/]backend\.ts$/},()=>({loader:'ts',contents:`
    import {EventEmitter} from 'node:events';
    export class Backend extends EventEmitter {
      devices=[{serial:'simulated',generation:1,name:'Simulated Wooting',firmware:'2.14.2',ready:true,writable:true,activeSlot:0,profiles:[{slot:0,name:'Typing Profile'},{slot:1,name:'Gaming Profile'}],observedAt:Date.now(),actuation:{profileSlot:0,observedAt:Date.now(),ratios:{26:0.25,4:0.5}}}];
      depth=new Map();status='Connected';timer;subs=[];counter=0;
      tick(){this.counter++;this.devices[0].observedAt=Date.now();this.devices[0].actuation.profileSlot=this.devices[0].activeSlot;this.devices[0].actuation.observedAt=Date.now();for(const sub of this.subs)this.depth.set(sub.serial,{generation:1,allKeys:true,values:{26:0.25+(this.counter%3)*0.1,4:0.8,225:0.5},sampledAt:Date.now()});this.emit('change');}
      start(){this.timer=setInterval(()=>this.tick(),100);this.tick();}
      stop(){clearInterval(this.timer);}
      subscribe(subs){this.subs=subs;}
      async request(op,payload){if(op!=='activate')throw new Error('Unexpected operation');await new Promise(resolve=>setTimeout(resolve,300));const p=this.devices[0].profiles.find(p=>p.slot===payload.slot);if(!p || p.name!==payload.expectedName)throw new Error('Stale profile');this.devices[0].activeSlot=p.slot;this.tick();return {slot:p.slot,generation:1};}
    }` }));}
}]});
const server=new WebSocketServer({host:'127.0.0.1',port:0});
await once(server,'listening');
let child,socket,globals={unrelatedSetting:'preserved'},messages=[],lastImages=new Map();
const errors=[];
const info={application:{version:'7.6.0',platform:'windows',platformVersion:'10.0',language:'en'},devices:[{id:'simulation',type:0,name:'Simulation',size:{columns:5,rows:3}}],plugin:{version:manifest.Version,uuid:manifest.UUID},devicePixelRatio:1,colors:{}};
async function launch(){
  messages=[];lastImages=new Map();
  const connected=once(server,'connection');
  child=spawn(process.execPath,[path.join(root,'plugin.js'),'-port',String(server.address().port),'-pluginUUID',manifest.UUID,'-registerEvent','registerPlugin','-info',JSON.stringify(info)],{cwd:root,windowsHide:true,stdio:'pipe'});
  child.stderr.on('data',data=>errors.push(String(data)));
  [socket]=await connected;
  socket.on('message',data=>{
    const message=JSON.parse(data);messages.push(message);
    if(message.event==='getGlobalSettings')socket.send(JSON.stringify({event:'didReceiveGlobalSettings',context:message.context,id:message.id,payload:{settings:globals}}));
    if(message.event==='setGlobalSettings')globals=message.payload;
    if(message.event==='setImage')lastImages.set(message.context,Buffer.from(message.payload.image.split(',')[1],'base64').toString());
    if(message.event==='setSettings')socket.send(JSON.stringify({event:'didReceiveSettings',context:message.context,action:'com.firflabs.wootdeck.toggle',device:'simulation',payload:{settings:message.payload}}));
  });
  await waitFor(()=>messages.some(m=>m.event==='getGlobalSettings'),'load global themes');
}
async function waitFor(predicate,label){const deadline=Date.now()+8000;while(Date.now()<deadline){if(predicate())return;await delay(20);}throw new Error(label+' timed out: '+errors.join(''));}
function send(event,kind,context,settings={},payload={}){socket.send(JSON.stringify({event,context,action:'com.firflabs.wootdeck.'+kind,device:'simulation',payload:{settings,coordinates:{column:0,row:0},controller:'Keypad',state:0,isInMultiAction:false,...payload}}));}
async function stop(){const exited=once(child,'exit');child.kill();await exited;socket.close();}
const toggle={serial:'simulated',toggleSlotA:0,toggleSlotB:1,toggleNameA:'Typing Profile',toggleNameB:'Gaming Profile',label:'My Toggle'};
const pressure={serial:'simulated',keyMode:'any',anyKeyFilter:'wasd',showThreshold:true,fullTravelMm:4,showAnyKeyPercent:false};
try {
  await launch();
  send('willAppear','toggle','toggle',toggle);
  await waitFor(()=>lastImages.get('toggle')?.includes('data-icon="toggle"'),'toggle registration');
  send('keyDown','toggle','toggle',toggle);
  await waitFor(()=>lastImages.get('toggle')?.includes('spinner') && lastImages.get('toggle')?.includes('>P2</text>'),'toggle A to B pending');
  await waitFor(()=>lastImages.get('toggle')?.includes('data-icon="toggle"') && lastImages.get('toggle')?.includes('>P2</text>') && !lastImages.get('toggle')?.includes('data-animation=') && !lastImages.get('toggle')?.includes('spinner'),'toggle B confirmed');
  send('keyDown','toggle','toggle',toggle);
  await waitFor(()=>lastImages.get('toggle')?.includes('data-icon="toggle"') && lastImages.get('toggle')?.includes('>P1</text>') && !lastImages.get('toggle')?.includes('data-animation=') && !lastImages.get('toggle')?.includes('spinner'),'toggle B to A confirmed');
  send('willAppear','depth','depth',pressure);
  await waitFor(()=>lastImages.get('depth')?.includes('data-marker="threshold"'),'filtered depth and threshold');
  const depth=lastImages.get('depth');
  assert.ok(depth.includes('data-key="26"') && depth.includes('data-key="4"') && !depth.includes('data-key="225"'));
  assert.ok(depth.includes('64.5') && !depth.includes('%'));
  const animatedPressure={...pressure,animation:'crossfade',animationDuration:200,animateState:false,animatePress:true};
  send('didReceiveSettings','depth','depth',animatedPressure);
  await delay(100);
  send('keyDown','depth','depth',animatedPressure);
  await waitFor(()=>lastImages.get('depth')?.includes('data-animation="crossfade"'),'Any Key press animation');
  await waitFor(()=>!lastImages.get('depth')?.includes('data-animation='),'Any Key transition finishes');
  await delay(350);
  assert.ok(!lastImages.get('depth').includes('data-animation='),'Continuous depth values do not restart transitions');
  const animatedToggle={...toggle,animation:'fade',animationDuration:200,animateState:true};
  send('didReceiveSettings','toggle','toggle',animatedToggle);
  await delay(100);
  send('keyDown','toggle','toggle',animatedToggle);
  await waitFor(()=>lastImages.get('toggle')?.includes('data-animation="fade"'),'profile fade starts');
  await waitFor(()=>lastImages.get('toggle')?.includes('>P2</text>') && !lastImages.get('toggle')?.includes('data-animation=') && !lastImages.get('toggle')?.includes('spinner'),'profile fade finishes at confirmed state');
  send('sendToPlugin','depth','depth',pressure,{type:'themeSave',name:'My theme',design:{...pressure,theme:'ice',fontFamily:'consolas',fontWeight:'normal',boxTheme:'corners'}});
  await waitFor(()=>globals.customThemes?.length===1,'global preset saved');
  const saved=globals.customThemes[0];
  assert.equal(globals.unrelatedSetting,'preserved');
  assert.ok(!('serial' in saved.design) && !('anyKeyFilter' in saved.design) && !('fullTravelMm' in saved.design));
  send('sendToPlugin','toggle','toggle',toggle,{type:'themeApply',id:saved.id});
  await waitFor(()=>messages.some(m=>m.event==='setSettings' && m.context==='toggle'),'preset applied to another action');
  const applied=messages.find(m=>m.event==='setSettings' && m.context==='toggle').payload;
  assert.equal(applied.serial,toggle.serial);assert.equal(applied.toggleSlotA,0);assert.equal(applied.toggleSlotB,1);assert.equal(applied.label,'My Toggle');
  assert.equal(applied.fontFamily,'consolas');assert.equal(applied.theme,'ice');
  await waitFor(()=>lastImages.get('toggle')?.includes('font-family="Consolas,monospace"'),'applied font rendered');
  send('sendToPlugin','toggle','toggle',applied,{type:'themeSave',id:saved.id,name:'Updated theme',design:{...applied,backgroundMode:'custom',backgroundColor:'#123456'}});
  await waitFor(()=>globals.customThemes[0].name==='Updated theme','preset update');
  await stop();
  await launch();
  send('willAppear','toggle','toggle',applied);
  send('propertyInspectorDidAppear','toggle','toggle',applied);
  await waitFor(()=>messages.some(m=>m.event==='sendToPropertyInspector' && m.payload.customThemes?.some(theme=>theme.name==='Updated theme')),'presets survive plugin restart');
  send('sendToPlugin','toggle','toggle',applied,{type:'themeDelete',id:saved.id});
  await waitFor(()=>globals.customThemes?.length===0,'preset deletion');
  const evidence={toggleBothDirections:true,filteredTelemetry:true,configuredActuationMarkers:true,pressurePressAnimation:true,profileFade:true,liveValuesDoNotRestart:true,presetSaveApplyUpdateDelete:true,presetReloadAfterRestart:true,bindingsPreserved:true,hardwareAccess:false};
  await writeFile('tmp/test-results/custom-features-smoke.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
} finally {child?.kill();socket?.close();server.close();}
