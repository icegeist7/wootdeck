// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {formatDepth,updatePeak,peakResetSeconds} from "../../src/depth-display.js";
import {THEMES} from "../../src/themes.js";
import {tile} from "../../src/render.js";

test("depth units preserve percent defaults and convert travel and peak consistently",()=>{
  assert.equal(formatDepth(0.5),"50%");
  assert.equal(formatDepth(0.5,{depthUnit:"unknown"}),"50%");
  assert.equal(formatDepth(0,{depthUnit:"mm"}),"0.0 mm");
  assert.equal(formatDepth(1,{depthUnit:"mm"}),"4.0 mm");
  assert.equal(formatDepth(0.5,{depthUnit:"mm",fullTravelMm:3.5}),"1.8 mm");
  for(const fullTravelMm of [NaN,Infinity,0,-1,11]) assert.equal(formatDepth(0.5,{depthUnit:"mm",fullTravelMm}),"2.0 mm");
  for(const theme of Object.keys(THEMES)) {
    const svg=tile("W","",false,undefined,0.5,0.75,{depthUnit:"mm",fullTravelMm:4,theme,showPeak:true});
    assert.ok(svg.includes("2.0 mm"));
    assert.ok(svg.toLowerCase().includes("peak 3.0 mm"));
    assert.ok(!svg.includes("%"));
    assert.ok(svg.includes('width="52"'),'Bar still shows half travel');
  }
});

test("peak hold expires from the latest maximum and preserves manual reset",()=>{
  let state=updatePeak({peak:0},0.8,{peakResetSeconds:2,showPeak:true},1000);
  assert.deepEqual(state,{peak:0.8,peakAt:1000});
  state=updatePeak(state,0.4,{peakResetSeconds:2,showPeak:true},2500);
  assert.equal(state.peak,0.8);
  state=updatePeak(state,0.9,{peakResetSeconds:2,showPeak:true},2800);
  assert.equal(state.peakAt,2800);
  state=updatePeak(state,0.9,{peakResetSeconds:2,showPeak:true},4000);
  assert.equal(state.peakAt,2800,'Equal readings do not restart the hold');
  state=updatePeak(state,0.2,{peakResetSeconds:2,showPeak:true},4800);
  assert.deepEqual(state,{peak:0.2,peakAt:4800});
  assert.equal(updatePeak(state,0,{showPeak:true},999999).peak,0.2);
  assert.deepEqual(updatePeak(state,1,{showPeak:false},5000),{peak:0});
  assert.equal(updatePeak({peak:0},0.1,{peakResetSeconds:0.1,showPeak:true},10).peakAt,10);
  for(const value of [NaN,Infinity,-1,3601]) assert.equal(peakResetSeconds({peakResetSeconds:value}),0);
});

test("hiding peak expands the bar and marker while preserving error space",()=>{
  const options={showPeak:false,showThreshold:true,configuredThreshold:0.5};
  const svg=tile("Space","",false,undefined,0.5,1,options);
  assert.ok(!svg.includes('Peak'));
  assert.ok(svg.includes('height="32"'));
  assert.ok(svg.includes('M 72 96 L 72 128'));
  const error=tile("Space","",false,"Unavailable",0.5,1,options);
  assert.ok(error.includes('Unavailable'));
  assert.ok(error.includes('height="13"'));
});
