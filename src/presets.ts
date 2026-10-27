// SPDX-License-Identifier: GPL-3.0-or-later
import type {Settings} from "./types.js";

export const DESIGN_KEYS = ["theme","fontFamily","fontWeight","textColorMode","textColor","boxTheme","boxPixels","backgroundMode","backgroundColor","activeBackgroundMode","activeBackgroundColor","profileColorMode","profileActiveBackground","profileActiveText","profileInactiveBackground","profileInactiveText","profilePendingBackground","profilePendingText","depthBackground","depthColorLow","depthColorMid","depthColorHigh","depthForeground","depthForegroundLow","depthForegroundMid","depthForegroundHigh","depthUnit","showAnyKeyPercent","showPeak","showThreshold","thresholdColorMode","thresholdColor","animation","animationDuration","animateState","animatePress"] as const;
export type Design = Record<string,string|number|boolean>;
export type SavedDesign = {id:string;name:string;design:Design};

export function captureDesign(input:unknown):Design {
  if(!input || typeof input!=="object") return {};
  const result:Design={};
  for(const key of DESIGN_KEYS) {
    const value=(input as Record<string,unknown>)[key];
    if((typeof value==="string" && value.length<=128) || typeof value==="boolean" || (typeof value==="number" && Number.isFinite(value))) result[key]=value;
  }
  return result;
}

export function applyDesign(settings:Settings,design:unknown):Settings {
  const result={...settings};
  for(const key of DESIGN_KEYS) delete result[key];
  return {...result,...captureDesign(design)};
}

export function loadDesigns(value:unknown):SavedDesign[] {
  if(!Array.isArray(value)) return [];
  const result:SavedDesign[]=[];
  for(const item of value.slice(0,32)) {
    if(!item || typeof item!=="object" || typeof item.id!=="string" || !/^[\w-]{1,64}$/.test(item.id) || typeof item.name!=="string" || !item.name.trim() || result.some(theme=>theme.id===item.id)) continue;
    result.push({id:item.id,name:item.name.trim().slice(0,40),design:captureDesign(item.design)});
  }
  return result;
}
