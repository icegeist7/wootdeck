// SPDX-License-Identifier: GPL-3.0-or-later
import type {DepthDisplay,ActuationDisplay} from "./depth-display.js";
import {depthForegroundMode} from "./depth-display.js";
import type {Theme} from "./themes.js";
import {backgroundTheme} from "./themes.js";

export const DEPTH_COLORS = {low:"#14352b",mid:"#b77916",high:"#bf2942"};

function color(value: string | undefined, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function gradient(value:number,mode:string|undefined,low:string,mid:string,high:string):string | undefined {
  if (!["two","three"].includes(mode || "") || !Number.isFinite(value)) return;
  let amount=Math.max(0,Math.min(1,value));
  let start=low, end=high;
  if(mode === "three") {
    [start,end]=amount<=0.5 ? [low,mid] : [mid,high];
    amount=amount<=0.5 ? amount*2 : (amount-0.5)*2;
  }
  return "#"+[1,3,5].map(index=>{
    const a=parseInt(start.slice(index,index+2),16), b=parseInt(end.slice(index,index+2),16);
    return Math.round(a+(b-a)*amount).toString(16).padStart(2,"0");
  }).join("");
}

function thresholdState(value:number,threshold:number|undefined):boolean|undefined {
  return Number.isFinite(value) && typeof threshold==="number" && Number.isFinite(threshold) && threshold>=0 && threshold<=1 ? value>=threshold : undefined;
}
function thresholdColor(state:boolean|undefined,low:string,high:string):string|undefined {
  return state===undefined ? undefined : state ? high : low;
}

// A shared tile background switches once any pressed key reaches its own point.
// Ignore keys without known configuration; idle uses the before color when the
// configuration is available. Never substitute a manual or assumed threshold.
export function anyKeyThresholdState(values:Record<string,number>,thresholds:Record<string,number>|undefined):boolean|undefined {
  if(!thresholds || !Object.values(thresholds).some(value=>typeof value==="number" && Number.isFinite(value) && value>=0 && value<=1)) return;
  const keys=Object.entries(values).filter(([,value])=>value>0);
  if(!keys.length) return false;
  const states=keys.map(([key,value])=>thresholdState(value,thresholds[key]));
  return states.includes(true) ? true : states.includes(false) ? false : undefined;
}

export function depthBackground(value: number, options: DepthDisplay & ActuationDisplay, reached?:boolean): string | undefined {
  if(options.depthBackground==="threshold") return thresholdColor(reached ?? thresholdState(value,options.configuredThreshold),color(options.depthColorLow,DEPTH_COLORS.low),color(options.depthColorHigh,DEPTH_COLORS.high));
  return gradient(value,options.depthBackground,color(options.depthColorLow,DEPTH_COLORS.low),color(options.depthColorMid,DEPTH_COLORS.mid),color(options.depthColorHigh,DEPTH_COLORS.high));
}

export function depthForeground(value:number,options:DepthDisplay & ActuationDisplay):string | undefined {
  if(depthForegroundMode(options)==="threshold") return thresholdColor(thresholdState(value,options.configuredThreshold),color(options.depthForegroundLow,"#c5cbd3"),color(options.depthForegroundHigh,"#39d98a"));
  return gradient(value,options.depthForeground,color(options.depthForegroundLow,"#39d98a"),color(options.depthForegroundMid,"#ffbd4a"),color(options.depthForegroundHigh,"#ff4059"));
}

export function depthTheme(theme: Theme, value: number | undefined, options: DepthDisplay & ActuationDisplay, reached?:boolean): Theme {
  const background=value===undefined ? undefined : depthBackground(value,options,reached);
  if(!background) return theme;
  return backgroundTheme(theme,background);
}
