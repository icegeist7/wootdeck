// SPDX-License-Identifier: GPL-3.0-or-later
export type AnimationOptions = {
  animation?:string; animationDuration?:number; animateState?:boolean; animatePress?:boolean;
};
export type AnimationState = {key:string;press:number;current:string;from?:string;started?:number};

export function animationDuration(options:AnimationOptions):number {
  const value=options.animationDuration;
  return typeof value==="number" && Number.isFinite(value)?Math.max(100,Math.min(1500,value)):200;
}

function body(svg:string):string {return svg.slice(svg.indexOf('>')+1,svg.lastIndexOf('</svg>'));}

export function animationFrame(previous:AnimationState|undefined,current:string,key:string,options:AnimationOptions,press:number,now:number):{state:AnimationState;image:string} {
  const state:AnimationState={key,press,current};
  const mode=["none","fade","crossfade"].includes(options.animation || "") ? options.animation! : "crossfade";
  const enabled=mode!=="none";
  if(!previous || !enabled) return {state,image:current};
  const duration=animationDuration(options);
  const running=previous.from!==undefined && previous.started!==undefined && now-previous.started<duration;
  const triggered=(key!==previous.key && options.animateState!==false) || (press!==previous.press && options.animatePress===true);
  if(running) {state.from=previous.from;state.started=previous.started;}
  else if(triggered) {state.from=previous.current;state.started=now;}
  if(state.from===undefined || state.started===undefined) return {state,image:current};
  // State updates during a transition replace its destination, not its clock.
  // This keeps rapid profile changes or key presses from restarting forever.
  const progress=Math.max(0,Math.min(1,(now-state.started)/duration));
  const layers=mode==="crossfade"?
    `<g>${body(state.from)}</g><g opacity="${progress.toFixed(3)}">${body(current)}</g>`:
    progress<0.5?`<g opacity="${(1-progress*2).toFixed(3)}">${body(state.from)}</g>`:`<g opacity="${(progress*2-1).toFixed(3)}">${body(current)}</g>`;
  return {state,image:`<svg xmlns="http://www.w3.org/2000/svg" data-animation="${mode}" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="#000000"/>${layers}</svg>`};
}
