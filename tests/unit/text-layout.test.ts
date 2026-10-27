// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from "node:test";
import assert from "node:assert/strict";
import {appearance,FONTS,THEMES} from "../../src/themes.js";
import {tile,anyKeyTile} from "../../src/render.js";
import {fontMetrics} from "../../src/font-metrics.js";

test("text fits inside padded key bounds with proportional font sizing",()=>{
  for(const theme of Object.keys(THEMES)) for(const fontFamily of Object.keys(FONTS)) for(const fontWeight of ["normal","bold"]) {
    const options={theme,fontFamily,fontWeight};
    const glyphs=fontMetrics(appearance(options).theme);
    const samples=[
      tile("Space","",false,undefined,0,1,options),
      tile("WWWWWWWWWWWWWWWWWWWW","",false,undefined,1,1,{...options,depthUnit:"mm",fullTravelMm:10}),
      tile("Long Profile Name","P1",true,undefined,undefined,undefined,options),
      tile("Keyboard","",false,"Reconnecting",undefined,undefined,options),
      anyKeyTile("Any Key",{225:1,44:0.5,224:0.25},1,options),
      anyKeyTile("Any Key",{26:1},1,options),
    ];
    for(const svg of samples) {
      assert.ok(!svg.includes("textLength="),'Glyphs must not be stretched or squeezed');
      for(const match of svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
        const [,x,y,size,encoded]=match;
        const value=encoded!.replaceAll("&amp;","&").replaceAll("&lt;","<").replaceAll("&gt;",">").replaceAll("&quot;",'"').replaceAll("&apos;","'");
        let width=0, ascent=0, descent=0;
        for(const char of value) {
          const metrics=glyphs[char.codePointAt(0)!] || [1.3,1,0.3];
          width+=metrics[0]!; ascent=Math.max(ascent,metrics[1]!); descent=Math.max(descent,metrics[2]!);
        }
        assert.ok(Number(size)>0);
        assert.ok(Number(x)-width*Number(size)/2>=16-0.01,value);
        assert.ok(Number(x)+width*Number(size)/2<=128+0.01,value);
        assert.ok(Number(y)-ascent*Number(size)>=14-0.01,value);
        assert.ok(Number(y)+descent*Number(size)<=130+0.01,value);
      }
    }
  }
});
