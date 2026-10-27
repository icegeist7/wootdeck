// SPDX-License-Identifier: GPL-3.0-or-later
export type DepthDisplay = {
  depthUnit?: string; fullTravelMm?: number;
  showAnyKeyPercent?: boolean;
  showPeak?: boolean; peakResetSeconds?: number;
  depthBackground?: string; depthColorLow?: string; depthColorMid?: string; depthColorHigh?: string;
  depthForeground?: string; depthForegroundLow?: string; depthForegroundMid?: string; depthForegroundHigh?: string;
  anyKeyFilter?:string; anyKeyList?:string;
  showThreshold?:boolean; thresholdColorMode?:string; thresholdColor?:string;
};

export function needsActuation(options:DepthDisplay):boolean {
  return options.showThreshold!==false || options.depthBackground==="threshold" || depthForegroundMode(options)==="threshold";
}

export function depthForegroundMode(options:DepthDisplay):string {
  return ["theme","two","three","threshold"].includes(options.depthForeground || "") ? options.depthForeground! : "threshold";
}

export type PeakState = {peak:number; peakAt?:number};
export function peakResetSeconds(options:DepthDisplay):number {
  const value=options.peakResetSeconds;
  return typeof value==="number" && Number.isFinite(value) && value>=0 && value<=3600 ? value : 0;
}

// Hold a new maximum for the configured duration, then resume from live depth.
// Zero preserves manual reset. No timer or additional hardware reads are needed.
export function updatePeak(state:PeakState,depth:number,options:DepthDisplay,now:number):PeakState {
  if(options.showPeak!==true) return {peak:0};
  const duration=peakResetSeconds(options)*1000;
  if(depth>state.peak || (duration>0 && state.peakAt!==undefined && now-state.peakAt>=duration)) return {peak:depth,peakAt:now};
  return state;
}

export function fullTravelMm(options: DepthDisplay): number {
  const value=options.fullTravelMm;
  return typeof value === "number" && Number.isFinite(value) && value>=0.1 && value<=10 ? value : 4;
}

// Device configuration is transient and never persisted in an action or theme.
export type ActuationDisplay = {configuredThreshold?:number; configuredThresholds?:Record<string,number>};
export function thresholdRatio(options:DepthDisplay, configured?:number):number | undefined {
  return options.showThreshold!==false && typeof configured==="number" && Number.isFinite(configured) && configured>=0 && configured<=1 ? configured : undefined;
}

// The SDK supplies normalized travel, not calibrated physical distance.
export function formatDepth(value: number, options: DepthDisplay = {}): string {
  return options.depthUnit === "mm" ? `${(value*fullTravelMm(options)).toFixed(1)} mm` : `${Math.round(value*100)}%`;
}
