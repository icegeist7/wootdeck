// SPDX-License-Identifier: GPL-3.0-or-later
import {activeKeys} from "./keyboard.js";
import {fontMetrics} from "./font-metrics.js";
import {depthForeground,depthTheme,anyKeyThresholdState} from "./depth-background.js";
import {formatDepth, thresholdRatio, type DepthDisplay, type ActuationDisplay} from "./depth-display.js";
import {appearance, textTheme, boxPixels, profileColors, type Appearance, type Theme} from "./themes.js";

export function xml(text: string): string {
  return text.replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[char]!));
}

function wrap(text: string, limit=10, maximum=2): string[] {
  const result:string[]=[];
  for(const word of text.replace(/[-_]/g," ").split(/\s+/).filter(Boolean)) {
    if(result.length && (result.at(-1)!.length+word.length+1)<=limit) result[result.length-1]+=" "+word;
    else result.push(word);
  }
  if(result.length>maximum) result.splice(maximum-1,result.length-maximum+1,result.slice(maximum-1).join(" "));
  return result.map(line=>line.length>15?line.slice(0,14)+"…":line);
}

function text(theme:Theme,value:string,x:number,y:number,size:number,color:string,anchor="middle",width=112,box?:{top:number;height:number}):string {
  // Fit the actual font size, preserving glyph proportions. Metrics cover the
  // theme font stacks; unknown glyphs use conservative bounds. Leave 16 px at
  // each side and 14 px vertically (8/7 px on a standard 72 px key).
  let advance=0, above=0, below=0;
  for(const char of value) {
    const metrics=fontMetrics(theme)[char.codePointAt(0)!] || [1.3,1,0.3];
    advance+=metrics[0]!; above=Math.max(above,metrics[1]!); below=Math.max(below,metrics[2]!);
  }
  const verticalLimit=box ? box.height/Math.max(above+below,0.01) : Math.min((y-14)/Math.max(above,0.01),(130-y)/Math.max(below,0.01));
  const fitted=Math.floor(Math.min(size,width/Math.max(advance*1.04,0.01),verticalLimit)*10)/10;
  if(box) y=box.top+box.height/2+(above-below)*fitted/2;
  return `<text x="${x}" y="${y}" font-size="${fitted}" fill="${color}" text-anchor="${anchor}" font-weight="${theme.fontWeight || 700}">${xml(value)}</text>`;
}

function frame(theme:Theme,body:string):string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" rx="18" fill="${theme.background}"/><g font-family="${theme.font}">${body}</g></svg>`;
}

function thresholdMark(theme:Theme,x1:number,y1:number,x2:number,y2:number,options:DepthDisplay,bounds:{x:number;y:number;width:number;height:number}):string {
  const path=`M ${x1} ${y1} L ${x2} ${y2}`;
  const color=options.thresholdColorMode==="custom" && typeof options.thresholdColor==="string" && /^#[0-9a-f]{6}$/i.test(options.thresholdColor)?options.thresholdColor:theme.thresholdMarker;
  const id=`threshold-${bounds.x}-${bounds.y}`;
  return `<g data-marker="threshold"><defs><clipPath id="${id}"><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="4"/></clipPath></defs><path d="${path}" stroke="${color}" stroke-width="2" stroke-linecap="butt" clip-path="url(#${id})"/></g>`;
}

function indicator(theme:Theme,value:number,y=93,color=theme.accent,threshold?:number,height=13,options:DepthDisplay={}):string {
  return `<rect x="20" y="${y}" width="104" height="${height}" rx="4" fill="${theme.track}"/><rect x="20" y="${y}" width="${104*value}" height="${height}" rx="4" fill="${color}"/>`+(threshold===undefined?"":thresholdMark(theme,20+104*threshold,y,20+104*threshold,y+height,options,{x:20,y,width:104,height}));
}

function heading(label:string,theme:Theme,depth=false,bottom?:number,options:Appearance={}):string {
  const content=label;
  if(depth) {
    const keyTheme=textTheme({...theme,foreground:"#ffffff"},options);
    let advance=0,above=0,below=0;
    for(const char of content) {
      const glyph=fontMetrics(keyTheme)[char.codePointAt(0)!] || [1.3,1,0.3];
      advance+=glyph[0]!;above=Math.max(above,glyph[1]!);below=Math.max(below,glyph[2]!);
    }
    // Match text()'s fitted glyph size. Add 3 standard-key pixels per side
    // to the original 3 px inset (the SVG uses twice the key resolution).
    const size=Math.floor(Math.min(64,100/Math.max(advance*1.04,0.01),28/Math.max(above+below,0.01))*10)/10;
    const width=Math.min(124,Math.ceil(advance*size*1.04+24));
    return `<g data-mode="physical-key-cap"><rect x="${72-width/2}" y="14" width="${width}" height="40" rx="7" fill="#4b5058"/>`+
      text(keyTheme,content,72,0,64,keyTheme.foreground,"middle",100,{top:20,height:28})+`</g>`;
  }
  const parts=wrap(content,10);
  const size=25;
  if(bottom!==undefined) {
    const metrics=parts.map(part=>{
      let width=0, above=0, below=0;
      for(const char of part) {
        const glyph=fontMetrics(theme)[char.codePointAt(0)!] || [1.3,1,0.3];
        width+=glyph[0]!; above=Math.max(above,glyph[1]!); below=Math.max(below,glyph[2]!);
      }
      return {width,above,below};
    });
    const gap=6;
    const emHeight=metrics.reduce((sum,line)=>sum+line.above+line.below,0);
    const fitted=Math.floor(Math.min(size,...metrics.map(line=>112/Math.max(line.width*1.04,0.01)),(bottom-28-gap*(parts.length-1))/Math.max(emHeight,0.01))*10)/10;
    const blockHeight=emHeight*fitted+gap*(parts.length-1);
    let top=(bottom-blockHeight)/2;
    return parts.map((part,i)=>{
      const line=metrics[i]!;
      const baseline=top+line.above*fitted;
      top+=(line.above+line.below)*fitted+gap;
      return text(theme,part,72,baseline,fitted,theme.foreground);
    }).join("");
  }
  return parts.map((part,i)=>text(theme,part,72,(parts.length===1?49:34)+i*27,size,theme.foreground)).join("");
}

function statusText(value:string,theme:Theme,warning=false):string {
  const color=warning?theme.warning:theme.foreground;
  return `<rect x="12" y="92" width="120" height="40" rx="8" fill="${theme.panel}"/>`+wrap(value,13).map((line,i,all)=>text(theme,line,72,all.length===1?121:104+i*21,/^P\d+$/.test(line)?30:26,color)).join("");
}

const PROFILE_BADGE_HEIGHT=40;
const PROFILE_BADGE_TOP=90;

type ProfileFeedback = {pending?:boolean;spinnerFrame?:number;physicalKey?:boolean;cycleDirection?:number};

function profileBadge(value:string,active:boolean,theme:Theme,options:Appearance & ProfileFeedback):string {
  const colors=profileColors(theme,options);
  const y=PROFILE_BADGE_TOP;
  const height=PROFILE_BADGE_HEIGHT;
  const [slot,direction]=value.split(" · ");
  const boxTheme=["corners","top-bottom","left-right"].includes(options.boxTheme || "")?options.boxTheme!:"solid";
  const textField=options.pending?"profilePendingText":active?"profileActiveText":"profileInactiveText";
  const customText=options[textField];
  const color=boxTheme==="solid"?colors[textField]:options.profileColorMode==="custom" && typeof customText==="string" && /^#[0-9a-f]{6}$/i.test(customText)?customText:theme.foreground;
  const background=options.pending?colors.profilePendingBackground:active?colors.profileActiveBackground:colors.profileInactiveBackground;
  // UI pixels refer to a standard 72 px key; the SVG is rendered at 2x.
  const pixels=boxPixels(options), stroke=pixels*2;
  const left=16+pixels, right=128-pixels, top=y+pixels, bottom=y+height-pixels;
  const box=boxTheme==="solid"?`<rect x="16" y="${y}" width="112" height="${height}" rx="${pixels*2}" fill="${background}"/>`:
    `<path d="${boxTheme==="corners"?`M ${left} ${top+12} V ${top} H ${left+12} M ${right-12} ${top} H ${right} V ${top+12} M ${left} ${bottom-12} V ${bottom} H ${left+12} M ${right-12} ${bottom} H ${right} V ${bottom-12}`:boxTheme==="left-right"?`M ${left} ${top} V ${bottom} M ${right} ${top} V ${bottom}`:`M ${left} ${top} H ${right} M ${left} ${bottom} H ${right}` }" fill="none" stroke="${background}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const textPadding=boxTheme==="top-bottom"?Math.max(6,stroke+3):6;
  // Lucide chevron-left/right; ISC/MIT notice shipped in licenses/lucide-LICENSE.
  // https://github.com/lucide-icons/lucide/tree/main/icons
  // Emit directly in the root coordinate system: Stream Deck renderers may
  // omit nested SVG viewports even when desktop SVG previews render them.
  const center=y+height/2;
  const radius=Math.min(8,(height-textPadding*2-3)/2);
  let icon=direction?`<path data-icon="chevron-${direction==="Prev"?"left":"right"}" d="${direction==="Prev"?`M ${99+radius/2} ${center-radius} L ${99-radius/2} ${center} L ${99+radius/2} ${center+radius}`:`M ${99-radius/2} ${center-radius} L ${99+radius/2} ${center} L ${99-radius/2} ${center+radius}`}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`:"";
  if(direction==="Toggle") icon=`<path data-icon="toggle" d="M 91 ${center-4} H 107 L 103 ${center-8} M 107 ${center+4} H 91 L 95 ${center+8}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const dual=direction==="Next" || direction==="Prev";
  const chevron=(x:number,left:boolean)=>`<path data-icon="chevron-${left?"left":"right"}" d="M ${x+(left?4:-4)} ${center-7} L ${x+(left?-4:4)} ${center} L ${x+(left?4:-4)} ${center+7}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  if(dual) icon=chevron(37,true)+chevron(107,false);
  if(options.pending) {
    // Generate each animation frame as an absolute path; no nested SVG or SMIL.
    const angle=(options.spinnerFrame || 0)*Math.PI/6;
    const reverse=options.cycleDirection===-1 || (options.cycleDirection===undefined && direction==="Prev");
    const spinnerX=dual?(reverse?37:107):99;
    const spinnerRadius=dual?Math.min(7,radius):radius;
    const point=(phase:number)=>`${(spinnerX+spinnerRadius*Math.cos(phase)).toFixed(2)} ${(center+spinnerRadius*Math.sin(phase)).toFixed(2)}`;
    icon=`<path data-icon="spinner" d="M ${point(angle)} A ${spinnerRadius} ${spinnerRadius} 0 1 1 ${point(angle+Math.PI*1.5)}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`+(dual?chevron(reverse?107:37,!reverse):"");
  }
  return `<g data-mode="profile-badge" data-box-theme="${boxTheme}">${box}`+
    text(theme,slot!,dual?72:direction || options.pending?59:72,0,30,color,"middle",dual?46:direction || options.pending?54:100,{top:y+textPadding,height:height-textPadding*2})+icon+`</g>`;
}

export function tile(label:string,footer:string,active:boolean,status?:string,depth?:number,peak?:number,options:Appearance & DepthDisplay & ActuationDisplay & ProfileFeedback={}):string {
  const selected=appearance(options,!status && !options.pending && (depth!==undefined?depth>0:active));
  const theme=textTheme(depthTheme(selected.theme,status?undefined:depth,options),options);
  const badge=depth===undefined && !status && /^P\d+(?: · (?:Next|Prev|Toggle))?$/.test(footer);
  let body=heading(label,theme,depth!==undefined || options.physicalKey===true,badge?PROFILE_BADGE_TOP:undefined,options);
  if(depth!==undefined) {
    body+=text(theme,formatDepth(depth,options),72,86,40,theme.foreground);
    const showPeak=options.showPeak===true;
    const footer=showPeak || !!status;
    body+=indicator(theme,depth,footer?93:96,depthForeground(depth,options),thresholdRatio(options,options.configuredThreshold),footer?13:32,options);
    if(showPeak || status) body+=text(theme,status || `Peak ${formatDepth(peak||0,options)}`,72,126,24,status?theme.warning:theme.foreground);
  } else {
    body+=badge ? profileBadge(footer,active,theme,options) : statusText(status||footer,theme,!!status);
  }
  return frame(theme,body);
}

export function anyKeyTile(label:string,values:Record<string,number>,_peak:number,options:Appearance & DepthDisplay & ActuationDisplay={}):string {
  const selected=appearance(options,Object.values(values).some(value=>value>0));
  const theme=textTheme(depthTheme(selected.theme,Math.max(0,...Object.values(values)),{...options,configuredThreshold:undefined},anyKeyThresholdState(values,options.configuredThresholds)),options);
  const pressed=activeKeys(values);
  // At most three columns: key name, downward-filling bar, percentage.
  // Overflow is deliberately omitted; the inspector retains the complete list.
  const visible=pressed.slice(0,3);
  const body=`<g data-mode="any-key-bars">`+(visible.length?visible.map((key,i)=>{
    const columnWidth=112/visible.length;
    const x=16+columnWidth*(i+0.5);
    const barWidth=visible.length===1?24:18;
    const barHeight=options.showAnyKeyPercent===false?86:62;
    const barColor=depthForeground(key.value,{...options,configuredThreshold:options.configuredThresholds?.[String(key.code)]}) || theme.accent;
    const threshold=thresholdRatio(options,options.configuredThresholds?.[String(key.code)]);
    const marker=threshold===undefined?"":thresholdMark(theme,x-barWidth/2,43+barHeight*threshold,x+barWidth/2,43+barHeight*threshold,options,{x:x-barWidth/2,y:43,width:barWidth,height:barHeight});
    const name=key.label;
    // Reserve a separate footer below the track, including font ascenders and
    // descenders. A single column keeps the same readable size as multi-key bars.
    const percent=options.showAnyKeyPercent===false?"":text(theme,`${Math.round(key.value*100)}%`,x,0,20,theme.foreground,"middle",columnWidth-6,{top:111,height:19});
    return `<g data-key="${key.code}">${text(theme,name,x,31,24,theme.foreground,"middle",columnWidth-6)}<rect x="${x-barWidth/2}" y="43" width="${barWidth}" height="${barHeight}" rx="4" fill="${theme.track}"/><rect x="${x-barWidth/2}" y="43" width="${barWidth}" height="${barHeight*key.value}" rx="4" fill="${barColor}"/>${marker}${percent}</g>`;
  }).join(""):
    `<g data-mode="any-key-idle"><path d="M 72 19 V 34 M 65 27 L 72 34 L 79 27" fill="none" stroke="${theme.foreground}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><rect x="44" y="44" width="56" height="38" rx="7" fill="none" stroke="${theme.accent}" stroke-width="3"/><path d="M 56 55 H 88 V 69 H 56 Z M 41 88 Q 72 99 103 88" fill="none" stroke="${theme.accent}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${text(theme,label || "Key Pressure",72,122,24,theme.foreground)}</g>`)+`</g>`;
  return frame(theme,body);
}
