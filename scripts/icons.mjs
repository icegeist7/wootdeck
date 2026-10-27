// SPDX-License-Identifier: GPL-3.0-or-later
// Render pinned Lucide SVG sources into white, borderless Stream Deck assets.
import {Resvg} from '@resvg/resvg-js';
import {mkdir,readFile,writeFile} from 'node:fs/promises';

const output='com.firflabs.wootdeck.sdPlugin/imgs';
await mkdir(output,{recursive:true});
await mkdir('tmp/previews',{recursive:true});
await mkdir('assets/brand',{recursive:true});
const symbols={plugin:'keyboard',category:'keyboard',select:'mouse-pointer-click',cycle:'repeat-2',toggle:'arrow-left-right',current:'list-checks',depth:'gauge'};
const sources=new Map();
for(const name of new Set(Object.values(symbols))) sources.set(name,(await readFile(`assets/lucide/${name}.svg`,'utf8')).replaceAll('currentColor','#ffffff'));
function glyph(name,size,inset=0) {
  return sources.get(name).replace('<svg',`<svg x="${inset}" y="${inset}"`).replace('width="24"',`width="${size-inset*2}"`).replace('height="24"',`height="${size-inset*2}"`);
}
const svg=(size,content)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${content}</svg>`;
const logo=svg(256,`<g transform="translate(40 22)">${glyph('keyboard',176)}</g><text x="128" y="222" font-family="Segoe UI,Arial,sans-serif" font-size="29" font-weight="700" text-anchor="middle" fill="#ffffff">WootDeck</text>`);
await writeFile('assets/brand/wootdeck.svg',logo);
function png(source,width) {return new Resvg(source,{fitTo:{mode:'width',value:width},font:{loadSystemFonts:true}}).render().asPng();}
for(const [name,symbol] of Object.entries(symbols)) {
  const size=name==='plugin'?256:name==='category'?28:20;
  const source=name==='plugin'?logo:svg(size,glyph(symbol,size));
  for(const scale of [1,2]) await writeFile(`${output}/${name}${scale===2?'@2x':''}.png`,png(source,size*scale));
  if(!['plugin','category'].includes(name)) {
    const state=svg(72,glyph(symbol,72,12));
    for(const scale of [1,2]) await writeFile(`${output}/${name}-state${scale===2?'@2x':''}.png`,png(state,72*scale));
  }
}
// Preview on black; delivered PNGs retain transparency.
const labels={plugin:'WootDeck',category:'Category',select:'Select',cycle:'Cycle',toggle:'Toggle',current:'Current',depth:'Pressure'};
const preview=`<svg xmlns="http://www.w3.org/2000/svg" width="896" height="160" viewBox="0 0 896 160"><rect width="896" height="160" fill="#111111"/>${Object.entries(symbols).map(([name,symbol],i)=>`<g transform="translate(${i*128+24} 12)">${name==='plugin'?`<svg width="80" height="100" viewBox="0 0 256 256">${logo.slice(logo.indexOf('>')+1,logo.lastIndexOf('</svg>'))}</svg>`:glyph(symbol,80)}<text x="40" y="125" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="14" fill="#ffffff">${labels[name]}</text></g>`).join('')}</svg>`;
await writeFile('tmp/previews/icons-preview.png',png(preview,896));
console.log('Generated white Lucide logo, category/action icons, and separate key-state assets.');
