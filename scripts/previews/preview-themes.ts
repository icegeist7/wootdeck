// SPDX-License-Identifier: GPL-3.0-or-later
import {Resvg} from '@resvg/resvg-js';
import {mkdir,writeFile} from 'node:fs/promises';
import {tile,anyKeyTile} from '../../src/render.js';
import {THEMES} from '../../src/themes.js';

await mkdir('tmp/previews/themes',{recursive:true});
const variants = [
  ['active',(theme:string)=>tile('Typing Profile','P1',true,undefined,undefined,undefined,{theme})],
  ['inactive',(theme:string)=>tile('Gaming Normal','P1',false,undefined,undefined,undefined,{theme})],
  ['depth',(theme:string)=>tile('W','',false,undefined,0.64,0.91,{theme,configuredThreshold:0.5})],
  ['any',(theme:string)=>anyKeyTile('Any Key',{26:0.82,4:0.45,225:0.3},0.96,{theme,configuredThresholds:{26:0.5,4:0.4,225:0.2}})],
  ['warning',(theme:string)=>tile('Typing Profile','P1',false,'Disconnected',undefined,undefined,{theme})],
] as const;
for(const theme of Object.keys(THEMES)) {
  for(const [name,render] of variants) {
    const svg=render(theme);
    await writeFile(`tmp/previews/themes/${theme}-${name}.svg`,svg);
    for(const size of [72,144]) {
      const rendered=new Resvg(svg,{fitTo:{mode:'width',value:size},font:{loadSystemFonts:true}}).render();
      await writeFile(`tmp/previews/themes/${theme}-${name}-${size}.png`,rendered.asPng());
    }
  }
}
await writeFile('tmp/previews/themes/index.json',JSON.stringify(Object.entries(THEMES).map(([id,theme])=>[id,theme.name])));
console.log(`Rendered ${Object.keys(THEMES).length} themes, five states, at 72 and 144 pixels.`);
