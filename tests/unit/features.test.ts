// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {configuredActuation,toggleTarget,type Keyboard} from "../../src/types.js";
import {parseKeyList,filterAnyKeys} from "../../src/keyboard.js";
import {thresholdRatio} from "../../src/depth-display.js";
import {tile,anyKeyTile} from "../../src/render.js";
import {captureDesign,applyDesign,loadDesigns} from "../../src/presets.js";

const keyboard:Keyboard={serial:"one",name:"Test",productId:0x1230,firmware:"2.14.2",generation:1,ready:true,writable:true,activeSlot:0,profiles:[{slot:0,name:"Typing"},{slot:1,name:"Gaming"},{slot:2,name:"Other"}],error:null,observedAt:1};
test("toggle honors observed profile and rejects ambiguous or renamed bindings",()=>{
  const settings={toggleSlotA:0,toggleSlotB:1,toggleNameA:"Typing",toggleNameB:"Gaming"};
  assert.equal(toggleTarget(keyboard,settings).slot,1);
  assert.equal(toggleTarget({...keyboard,activeSlot:1},settings).slot,0);
  assert.equal(toggleTarget({...keyboard,activeSlot:2},settings).slot,0);
  assert.throws(()=>toggleTarget(keyboard,{...settings,toggleSlotB:0}));
  assert.throws(()=>toggleTarget(keyboard,{...settings,toggleNameB:"Renamed"}));
  assert.ok(tile("Typing","P1 · Toggle",true).includes('data-icon="toggle"'));
});

test("Any Key filters names, HID codes and modifiers before rendering",()=>{
  assert.deepEqual(parseKeyList("W, a, Space, L Shift, HID 26, #7"),[26,4,44,225,7]);
  assert.throws(()=>parseKeyList(""));
  assert.throws(()=>parseKeyList("not a key"));
  const values={26:0.5,4:0.8,44:0.4,225:1,231:0.5};
  assert.deepEqual(filterAnyKeys(values,{anyKeyFilter:"wasd"}),{26:0.5,4:0.8});
  assert.deepEqual(filterAnyKeys(values,{anyKeyFilter:"no-modifiers"}),{26:0.5,4:0.8,44:0.4});
  assert.deepEqual(filterAnyKeys(values,{anyKeyFilter:"custom",anyKeyList:"Space, Shift"}),{44:0.4,225:1});
  assert.deepEqual(filterAnyKeys(values,{}),values);
});

test("threshold markers use only current device configuration per physical key",()=>{
  assert.equal(thresholdRatio({showThreshold:false},0.5),undefined);
  assert.equal(thresholdRatio({showThreshold:true}),undefined);
  assert.equal(thresholdRatio({showThreshold:true},NaN),undefined);
  assert.equal(thresholdRatio({showThreshold:true},1.1),undefined);
  const options={showPeak:true,showThreshold:true,configuredThreshold:0.25,configuredThresholds:{26:0.25,4:0.5},fullTravelMm:4,showAnyKeyPercent:false};
  assert.equal(thresholdRatio(options,options.configuredThreshold),0.25);
  const any=anyKeyTile("Key Pressure",{26:0.5,4:0.8,7:0.6},1,options);
  assert.equal((any.match(/data-marker="threshold"/g)||[]).length,2);
  assert.ok(any.includes('64.5'),'Marker follows the enlarged 86 px track');
  const single=tile("W","",false,undefined,0.5,1,options);
  assert.ok(single.includes('data-marker="threshold"') && single.includes('M 46 93 L 46 106'));
  const device={...keyboard,observedAt:1000,actuation:{profileSlot:0,observedAt:1000,ratios:{26:0.5}}};
  assert.deepEqual(configuredActuation(device,1500),{26:0.5});
  assert.equal(configuredActuation({...device,activeSlot:1},1500),undefined);
  assert.equal(configuredActuation({...device,ready:false},1500),undefined);
  assert.equal(configuredActuation({...device,observedAt:80000},80000),undefined);
  assert.equal(captureDesign({showThreshold:true,thresholdValue:50,thresholdUnit:"mm",configuredThreshold:0.7}).showThreshold,true);
  assert.deepEqual(captureDesign({thresholdValue:50,configuredThreshold:0.7}),{});
});

test("Custom Themes exclude bindings and clear previous design overrides on apply",()=>{
  const settings={serial:"private-serial",slot:1,profileName:"Gaming",key:26,anyKeyFilter:"wasd",label:"My key",fullTravelMm:3.5,fontFamily:"consolas",fontWeight:"normal",backgroundMode:"custom",backgroundColor:"#123456"};
  const design=captureDesign(settings);
  assert.deepEqual(design,{fontFamily:"consolas",fontWeight:"normal",backgroundMode:"custom",backgroundColor:"#123456"});
  const applied=applyDesign(settings,{theme:"ice",serial:"different",label:"overwrite",fullTravelMm:4});
  assert.equal(applied.serial,settings.serial); assert.equal(applied.label,settings.label);
  assert.equal(applied.fullTravelMm,3.5); assert.equal(applied.anyKeyFilter,"wasd");
  assert.equal(applied.fontFamily,undefined); assert.equal(applied.backgroundColor,undefined);
  assert.equal(applied.theme,"ice");
  const stored=loadDesigns([{id:"safe",name:" Test ",design:settings},{id:"safe",name:"duplicate"},{id:"../bad",name:"bad"}]);
  assert.equal(stored.length,1);assert.equal(stored[0]!.name,"Test");
  assert.ok(!JSON.stringify(stored).includes("private-serial"));
  assert.equal(captureDesign({activeBackgroundMode:"custom",activeBackgroundColor:"#ffffff"}).activeBackgroundColor,"#ffffff");
});
