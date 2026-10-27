// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {appearance,boxPixels,profileColors,FONTS,THEMES} from "../../src/themes.js";
import {tile,anyKeyTile} from "../../src/render.js";

test("Ice White is default and removed themes fall back safely",()=>{
  assert.equal(appearance().theme.name,"Ice White");
  assert.equal(appearance({theme:"__proto__"}).theme.name,"Ice White");
  assert.equal(appearance({fontFamily:"__proto__",fontWeight:"unknown"}).theme.fontWeight,700);
  for(const fontFamily of Object.keys(FONTS)) for(const fontWeight of ["normal","bold"]) {
    const options={fontFamily,fontWeight};
    const svg=tile("Typing Profile","P1",true,undefined,undefined,undefined,options);
    assert.ok(svg.includes(`font-family="${FONTS[fontFamily]}"`));
    const weights=[...svg.matchAll(/font-weight="(\d+)"/g)].map(match=>match[1]);
    assert.ok(weights.length && weights.every(weight=>weight===(fontWeight==="normal"?"400":"700")));
    assert.ok(anyKeyTile("Key Pressure",{},0,options).includes(`font-weight="${fontWeight==="normal"?400:700}"`));
  }
  const legacy={theme:"cockpit",layout:"status",backgroundMode:"custom",backgroundColor:"#123456"};
  assert.equal(appearance(legacy).theme.name,"Ice White");
  assert.equal(appearance(legacy).theme.background,"#123456");
  const oldLayout={...legacy,theme:"mint",layout:"balanced"};
  assert.equal(tile("Typing Profile","P1",true,undefined,undefined,undefined,oldLayout),tile("Typing Profile","P1",true,undefined,undefined,undefined,{...legacy,theme:"mint"}));
  assert.equal(appearance({theme:"ice",backgroundColor:"#ffffff"}).theme.background,THEMES.ice!.background);
  assert.equal(appearance({theme:"ice",backgroundMode:"custom",backgroundColor:"#ffffff"}).theme.foreground,"#000000");
  assert.equal(appearance({theme:"ice",backgroundMode:"custom",backgroundColor:'"><script>'}).theme.background,THEMES.ice!.background);
  const options={theme:"ice",backgroundMode:"custom",backgroundColor:"#123456"};
  assert.ok(tile("Typing Profile","P1",true,undefined,undefined,undefined,options).includes('rx="18" fill="#123456"'));
  assert.ok(anyKeyTile("Any Key",{},0,options).includes('rx="18" fill="#123456"'));
  assert.ok(anyKeyTile("Any Key",{26:0.5},0,{...options,depthBackground:"two",depthColorLow:"#000000",depthColorHigh:"#ffffff"}).includes('rx="18" fill="#808080"'));
});

test("profile footer stays bold and readable within the padded width",()=>{
  const svg=tile("Typing Profile","P1",true);
  const footer=svg.match(/<text[^>]*font-size="([\d.]+)"[^>]*>P1<\/text>/);
  assert.ok(footer);
  assert.ok(Number(footer[1])>=20);
  assert.match(footer[0],/font-weight="700"/);
});

test("every palette preserves state, depth, and unavailable feedback",()=>{
  for(const theme of Object.keys(THEMES)) {
    const options={theme};
    const profile=tile("Typing Profile","P1",true,undefined,undefined,undefined,options);
    assert.ok(profile.includes(THEMES[theme]!.background));
    assert.ok(profile.includes("P1"));
    assert.ok(profile.includes(`fill="${THEMES[theme]!.profileColors.profileActiveBackground}"`));
    assert.ok(!profile.toLowerCase().includes("active"));
    const inactive=tile("Gaming Normal","P2",false,undefined,undefined,undefined,options);
    assert.ok(inactive.includes(`fill="${THEMES[theme]!.profileColors.profileInactiveBackground}"`));
    assert.ok(inactive.includes('>P2</text>'));
    for(const [direction,icon] of [["Next","right"],["Prev","left"]]) {
      const cycle=tile("Typing Profile",`P1 · ${direction}`,true,undefined,undefined,undefined,options);
      assert.ok(cycle.includes(`data-icon="chevron-${icon}"`));
      assert.equal((cycle.match(/<svg\b/g)||[]).length,1,'Icons must not use nested SVG viewports');
      assert.ok(cycle.includes(`<path data-icon="chevron-${icon}"`));
      assert.ok(!cycle.includes(direction!));
      assert.ok(cycle.includes('>P1</text>'));
    }
    const pending=tile("Gaming","P2 · Next",true,undefined,undefined,undefined,{...options,pending:true,spinnerFrame:0});
    assert.ok(pending.includes('fill="#2563eb"'));
    assert.ok(pending.includes('data-icon="spinner"') && pending.includes('chevron-left') && !pending.includes('chevron-right'));
    assert.notEqual(pending,tile("Gaming","P2 · Next",true,undefined,undefined,undefined,{...options,pending:true,spinnerFrame:1}));
    assert.ok(tile("Gaming","P2 · Next",true,undefined,undefined,undefined,{...options,pending:true,profileColorMode:"custom",profilePendingBackground:"#663399"}).includes('fill="#663399"'));
    const pendingSelect=tile("Gaming","P2",false,undefined,undefined,undefined,{...options,pending:true});
    assert.ok(pendingSelect.includes('data-icon="spinner"') && pendingSelect.includes('fill="#2563eb"'));
    assert.ok(!profile.includes("undefined") && !profile.includes("NaN"));
    const depth=tile("W","",false,undefined,0.64,0.91,{...options,configuredThreshold:0.5});
    assert.ok(depth.includes("64%"));
    assert.ok(!depth.toLowerCase().includes("peak 91%"));
    assert.ok(depth.includes('height="32"'));
    assert.ok(depth.includes('data-marker="threshold"'));
    assert.ok(tile("Typing Profile","P1",false,"Disconnected",undefined,undefined,options).toLowerCase().includes("disconnected"));
    assert.ok(anyKeyTile("Key Pressure",{},0,options).includes('data-mode="any-key-idle"'));
  }
});

test("profile colors follow themes unless customized and reject invalid SVG colors",()=>{
  const theme=THEMES.ice!;
  assert.deepEqual(profileColors(theme,{profileActiveBackground:"#123456"}),theme.profileColors);
  const options={theme:"ice",profileColorMode:"custom",profileActiveBackground:"#123456",profileActiveText:"#abcdef",profileInactiveBackground:"#654321",profileInactiveText:"#fedcba"};
  const active=tile("Typing Profile","P1",true,undefined,undefined,undefined,options);
  assert.ok(active.includes('fill="#123456"') && active.includes('fill="#abcdef"'));
  const inactive=tile("Gaming","P2",false,undefined,undefined,undefined,options);
  assert.ok(inactive.includes('fill="#654321"') && inactive.includes('fill="#fedcba"'));
  assert.equal(profileColors(theme,{profileColorMode:"custom",profileActiveBackground:'"><script>'}).profileActiveBackground,theme.profileColors.profileActiveBackground);
});

test("normal and active tile backgrounds follow observed state and preserve old defaults",()=>{
  const options={backgroundMode:"custom",backgroundColor:"#123456",activeBackgroundMode:"custom",activeBackgroundColor:"#ffffff"};
  assert.equal(appearance(options).theme.background,"#123456");
  assert.equal(appearance(options,true).theme.background,"#ffffff");
  assert.equal(appearance({...options,activeBackgroundMode:"inherit"},true).theme.background,"#123456");
  assert.equal(appearance({...options,activeBackgroundColor:'"><script>'},true).theme.background,"#123456");
  assert.ok(tile("Typing","P1",true,undefined,undefined,undefined,options).includes('rx="18" fill="#ffffff"'));
  assert.ok(tile("Typing","P1",false,undefined,undefined,undefined,options).includes('rx="18" fill="#123456"'));
  assert.ok(tile("Typing","P1",true,undefined,undefined,undefined,{...options,pending:true}).includes('rx="18" fill="#123456"'));
  assert.ok(anyKeyTile("Key Pressure",{},0,options).includes('rx="18" fill="#123456"'));
  assert.ok(anyKeyTile("Key Pressure",{26:0.5},1,options).includes('rx="18" fill="#ffffff"'));
  assert.ok(tile("W","",false,undefined,0.5,1,options).includes('rx="18" fill="#ffffff"'));
});

test("profile box shapes preserve state colors and two-pixel outline strokes",()=>{
  for(const theme of Object.keys(THEMES)) for(const boxTheme of ["solid","corners","top-bottom","left-right"]) for(const active of [true,false]) {
    const options={theme,boxTheme};
    const svg=tile("Typing Profile","P1",active,undefined,undefined,undefined,options);
    assert.ok(svg.includes(`data-box-theme="${boxTheme}"`));
    const color=active?THEMES[theme]!.profileColors.profileActiveBackground:THEMES[theme]!.profileColors.profileInactiveBackground;
    assert.ok(svg.includes(`${boxTheme==="solid"?'fill':'stroke'}="${color}"`));
    if(boxTheme!=="solid") {
      assert.ok(svg.includes('stroke-width="4"'));
      assert.ok(!svg.includes('width="112" height="40"'));
      assert.ok(svg.includes(`fill="${THEMES[theme]!.foreground}"`));
    }
    const pending=tile("Gaming","P2 · Next",true,undefined,undefined,undefined,{...options,pending:true});
    assert.ok(pending.includes('data-icon="spinner"'));
    assert.ok(pending.includes(`${boxTheme==="solid"?'fill':'stroke'}="#2563eb"`));
  }
  assert.ok(tile("Typing","P1",true,undefined,undefined,undefined,{boxTheme:'"><script>'}).includes('data-box-theme="solid"'));
  assert.ok(tile("Typing","P1",true,undefined,undefined,undefined,{boxTheme:"solid",boxPixels:0}).includes('rx="0"'));
  assert.ok(tile("Typing","P1",true,undefined,undefined,undefined,{boxTheme:"solid",boxPixels:5}).includes('rx="10"'));
  for(const boxTheme of ["corners","top-bottom","left-right"]) for(const pixels of [0.5,1,3,6]) {
    const svg=tile("Typing","P1",true,undefined,undefined,undefined,{boxTheme,boxPixels:pixels});
    assert.ok(svg.includes(`stroke-width="${pixels*2}"`));
    assert.ok(!svg.includes('NaN'));
  }
  assert.equal(boxPixels({boxTheme:"corners",boxPixels:Infinity}),2);
  assert.equal(boxPixels({boxTheme:"corners",boxPixels:-1}),0.5);
  assert.equal(boxPixels({boxTheme:"solid",boxPixels:100}),10);
});
