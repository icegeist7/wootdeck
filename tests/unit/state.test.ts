// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {anyKeyDepth, cycleOrder, cycleTarget, selectedDevice, validDepth, type Keyboard} from "../../src/types.js";
import {anyKeyTile, tile} from "../../src/render.js";
import {activeKeys} from "../../src/keyboard.js";

const device: Keyboard = {serial: "chosen", name: "Wooting", productId: 0x1230, firmware: "2.14.2", generation: 2, ready: true, writable: true, activeSlot: 0, profiles: [], error: null, observedAt: 100};
test("never silently selects another keyboard when an identity is configured", () => {
  assert.equal(selectedDevice([device], "missing"), undefined);
  assert.equal(selectedDevice([device, {...device, serial: "other"}]), undefined);
});
test("depth from a previous session or expired sample is unavailable rather than zero", () => {
  assert.equal(validDepth({generation: 1, values: {26: 1}, sampledAt: 100}, device, 26, 101), undefined);
  assert.equal(validDepth({generation: 2, values: {26: 1}, sampledAt: 100}, device, 26, 2000), undefined);
  assert.equal(validDepth({generation: 2, values: {26: 0}, sampledAt: 100}, device, 26, 101), 0);
});
test("cycle configuration rejects invalid or ambiguous slots", () => {
  assert.deepEqual(cycleOrder("1, 3, 4"), [0,2,3]);
  assert.throws(() => cycleOrder("1,1"));
  assert.throws(() => cycleOrder("0,2"));
  const keyboard={...device,activeSlot:2,profiles:[{slot:0,name:"Typing"},{slot:2,name:"Gaming"},{slot:3,name:"Other"}]};
  assert.equal(cycleTarget(keyboard,[],1).slot,3);
  assert.equal(cycleTarget(keyboard,[],-1).slot,0);
  assert.equal(cycleTarget({...keyboard,activeSlot:3},[],1).slot,0);
  assert.equal(cycleTarget({...keyboard,activeSlot:3},[0,2],1).slot,0);
  assert.equal(cycleTarget({...keyboard,activeSlot:3},[0,2],-1).slot,2);
  assert.throws(()=>cycleTarget(keyboard,[7],1));
});
test("device-supplied names cannot inject SVG markup", () => {
  const svg = tile('<script>alert</script>', 'P1', false);
  assert.ok(!svg.includes('<script>'));
  assert.ok(svg.includes('&lt;script&gt;'));
});

test("Any Key distinguishes idle, single-key telemetry and stale sessions", () => {
  const idle={generation:2,values:{},sampledAt:100,allKeys:true};
  assert.deepEqual(anyKeyDepth(idle,device,101),{});
  assert.equal(anyKeyDepth({...idle,allKeys:false},device,101),undefined);
  assert.equal(anyKeyDepth({...idle,generation:1},device,101),undefined);
  assert.equal(anyKeyDepth(idle,device,2000),undefined);
  assert.deepEqual(anyKeyDepth({...idle,values:{26:0.5,4:0.8,22:0}},device,101),{26:0.5,4:0.8});
});

test("Any Key shows vertical bars with key above and percent below, omitting overflow", () => {
  const values={4:0.5,26:0.75,225:0.25,89:0.9};
  const pressed=activeKeys(values);
  assert.deepEqual(pressed.map(k=>k.label),["Num 1","W","A","L Shift"]);
  const svg=anyKeyTile("Any Key",values,0.9);
  assert.equal((svg.match(/data-key=/g)||[]).length,3);
  for(const code of [89,26,4]) assert.ok(svg.includes(`data-key="${code}"`));
  assert.ok(!svg.includes('data-key="225"'));
  for(const value of ["90%","75%","50%"]) assert.ok(svg.includes(value));
  assert.ok(!svg.includes("Peak") && !svg.includes("held"));
  const rows=[...svg.matchAll(/<g data-key="\d+"><text[^>]* y="(\d+)"[^>]*>[^<]*<\/text><rect[^>]* y="(\d+)"/g)];
  assert.equal(rows.length,3);
  assert.ok(rows.every(row=>Number(row[1])<Number(row[2])));
  assert.ok(svg.includes('height="46.5"'),'75% fills 75% of the vertical track');
  assert.equal((svg.match(/y="43"/g)||[]).length,6,'Tracks and fills start at the top');
  const percentages=[...svg.matchAll(/<text[^>]* y="([\d.]+)"[^>]*>\d+%<\/text>/g)];
  assert.equal(percentages.length,3);
  assert.ok(percentages.every(match=>Number(match[1])>=111 && Number(match[1])<=130),'Percentages sit in the reserved footer');
  const idle=anyKeyTile("Key Pressure",{},0);
  assert.ok(idle.includes('data-mode="any-key-idle"') && idle.includes('>Key Pressure</text>'));
  assert.ok(anyKeyTile("Custom Pressure",{},0).includes('>Custom Pressure</text>'));
  assert.ok(!svg.includes('data-mode="any-key-idle"'));
  const withoutPercent=anyKeyTile("Key Pressure",values,0.9,{showAnyKeyPercent:false});
  assert.ok(!withoutPercent.includes('%'));
  assert.ok(withoutPercent.includes('height="86"'));
  assert.ok(withoutPercent.includes('height="64.5"'),'75% scales against the enlarged track');
  assert.equal((withoutPercent.match(/data-key=/g)||[]).length,3);
});
