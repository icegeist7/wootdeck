// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {depthBackground,depthForeground,depthTheme} from "../../src/depth-background.js";
import {THEMES} from "../../src/themes.js";
import {tile,anyKeyTile} from "../../src/render.js";
import {needsActuation} from "../../src/depth-display.js";

test("depth background blends two or three stops, validates colors, and keeps old settings",()=>{
  const colors={depthColorLow:"#000000",depthColorMid:"#ff0000",depthColorHigh:"#ffffff"};
  assert.equal(depthBackground(0.5,{}),undefined);
  assert.equal(depthBackground(NaN,{depthBackground:"two"}),undefined);
  assert.equal(depthBackground(0.5,{...colors,depthBackground:"two"}),"#808080");
  const options={...colors,depthBackground:"three"};
  for(const [value,color] of [[0,"#000000"],[0.25,"#800000"],[0.5,"#ff0000"],[0.75,"#ff8080"],[1,"#ffffff"]] as const) {
    assert.equal(depthBackground(value,options),color);
    assert.ok(tile("W","",false,undefined,value,1,options).includes(`rx="18" fill="${color}"`));
  }
  assert.equal(depthBackground(-1,options),"#000000");
  assert.equal(depthBackground(2,options),"#ffffff");
  assert.match(depthBackground(0,{depthBackground:"two",depthColorLow:'"><script>'})!,/^#[0-9a-f]{6}$/);
  assert.equal(depthTheme(THEMES.mint!,0,options).foreground,"#ffffff");
  assert.equal(depthTheme(THEMES.mint!,1,options).foreground,"#000000");
  const unavailable=tile("W","",false,"No analog data",undefined,undefined,options);
  assert.ok(unavailable.includes(`rx="18" fill="${THEMES.mint!.background}"`));
  assert.ok(anyKeyTile("Any Key",{"26":0.25,"4":0.75},1,options).includes('rx="18" fill="#ff8080"'));
  assert.ok(anyKeyTile("Any Key",{},1,options).includes('rx="18" fill="#000000"'));
});

test("threshold colors use configured actuation even with markers hidden and fall back when unavailable",()=>{
  const options={showPeak:true,depthBackground:"threshold",depthForeground:"threshold",depthColorLow:"#001122",depthColorHigh:"#aabbcc",depthForegroundLow:"#112233",depthForegroundHigh:"#ddeeff",configuredThreshold:0.2,showThreshold:false};
  assert.equal(needsActuation(options),true);
  assert.equal(needsActuation({depthBackground:"two",depthForeground:"theme",showThreshold:false}),false);
  for(const [depth,background,foreground] of [[0.199,"#001122","#112233"],[0.2,"#aabbcc","#ddeeff"],[0.9,"#aabbcc","#ddeeff"]] as const) {
    assert.equal(depthBackground(depth,options),background);
    assert.equal(depthForeground(depth,options),foreground);
    const svg=tile("W","",false,undefined,depth,1,options);
    assert.ok(svg.includes(`rx="18" fill="${background}"`));
    assert.ok(svg.includes(`height="13" rx="4" fill="${foreground}"`));
    assert.ok(!svg.includes('data-marker="threshold"'));
  }
  for(const configuredThreshold of [undefined,NaN,-1,2]) {
    assert.equal(depthBackground(0.9,{...options,configuredThreshold}),undefined);
    assert.equal(depthForeground(0.9,{...options,configuredThreshold}),undefined);
  }
});

test("Any Key threshold foreground is per key and shared background includes filtered overflow",()=>{
  const options={showPeak:true,depthBackground:"threshold",depthForeground:"threshold",depthColorLow:"#001122",depthColorHigh:"#aabbcc",depthForegroundLow:"#112233",depthForegroundHigh:"#ddeeff",configuredThresholds:{26:0.2,4:0.9,7:0.1,22:0.9},showThreshold:false};
  const svg=anyKeyTile("Keys",{26:0.3,4:0.8},1,options);
  assert.ok(svg.includes('rx="18" fill="#aabbcc"'),'Shallower W reaches its own point before deeper A');
  assert.match(svg, /data-key="26"[\s\S]*?fill="#ddeeff"/);
  assert.match(svg, /data-key="4"[\s\S]*?fill="#112233"/);
  assert.ok(anyKeyTile("Keys",{},1,options).includes('rx="18" fill="#001122"'));
  const overflow=anyKeyTile("Keys",{26:0.19,4:0.8,22:0.8,7:0.1},1,options);
  assert.ok(overflow.includes('rx="18" fill="#aabbcc"'));
  assert.ok(!overflow.includes('data-key="7"'));
  const unknown=anyKeyTile("Keys",{44:0.9},1,{...options,configuredThreshold:0.1});
  assert.ok(unknown.includes(`rx="18" fill="${THEMES.mint!.background}"`),'No fallback to another key threshold');
});

test("foreground gradients color each bar without changing the background",()=>{
  const options={showPeak:true,depthForeground:"three",depthForegroundLow:"#000000",depthForegroundMid:"#ff0000",depthForegroundHigh:"#ffffff"};
  assert.equal(depthForeground(0.25,options),"#800000");
  assert.equal(depthForeground(0.5,options),"#ff0000");
  assert.equal(depthForeground(0.75,options),"#ff8080");
  assert.equal(depthForeground(0.5,{}),undefined);
  const single=tile("W","",false,undefined,0.5,0.5,options);
  assert.ok(single.includes('width="52" height="13" rx="4" fill="#ff0000"'));
  assert.ok(single.includes(`rx="18" fill="${THEMES.mint!.background}"`));
  const any=anyKeyTile("Key Pressure",{26:0.25,4:0.75},1,options);
  assert.ok(any.includes('fill="#800000"') && any.includes('fill="#ff8080"'));
  assert.ok(any.includes(`rx="18" fill="${THEMES.mint!.background}"`));
  const both=anyKeyTile("Key Pressure",{26:0.5},1,{...options,depthBackground:"two",depthColorLow:"#000000",depthColorHigh:"#ffffff"});
  assert.ok(both.includes('rx="18" fill="#808080"') && both.includes('fill="#ff0000"'));
  assert.match(depthForeground(1,{depthForeground:"two",depthForegroundHigh:'"><script>'})!,/^#[0-9a-f]{6}$/);
});
