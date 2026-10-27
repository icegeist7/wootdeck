// SPDX-License-Identifier: GPL-3.0-or-later
export type ProfileColors = {profileActiveBackground:string; profileActiveText:string; profileInactiveBackground:string; profileInactiveText:string; profilePendingBackground:string; profilePendingText:string};
export type Appearance = Partial<ProfileColors> & {theme?: string; fontFamily?:string; fontWeight?:string; textColorMode?:string; textColor?:string; boxTheme?:string; boxPixels?:number; profileColorMode?: string; backgroundMode?:string; backgroundColor?:string; activeBackgroundMode?:string; activeBackgroundColor?:string};

export const FONTS: Record<string,string> = {
  segoe:"Segoe UI,Arial,sans-serif",bahnschrift:"Bahnschrift,Segoe UI,Arial,sans-serif",
  arial:"Arial,Segoe UI,sans-serif",verdana:"Verdana,Segoe UI,sans-serif",
  tahoma:"Tahoma,Segoe UI,sans-serif",consolas:"Consolas,monospace",
};

export function boxPixels(options: Appearance): number {
  const solid=!["corners","top-bottom","left-right"].includes(options.boxTheme || "");
  const value=options.boxPixels;
  return typeof value === "number" && Number.isFinite(value) ? Math.max(solid?0:0.5,Math.min(solid?10:6,value)) : solid?3.5:2;
}
export type Theme = {
  name: string; background: string; foreground: string; secondary: string;
  accent: string; track: string; thresholdMarker:string; panel: string; warning: string;
  font: string;
  fontId?: string; fontWeight?: 400 | 700;
  profileColors: ProfileColors;
};

export const THEMES: Record<string, Theme> = {
  amber: {name:"Amber Console",background:"#000000",foreground:"#fff1cf",secondary:"#e0c68d",accent:"#ffbd4a",track:"#3b2d17",thresholdMarker:"#625745",panel:"#241d10",warning:"#ff795a",font:"Bahnschrift,Segoe UI,Arial,sans-serif",profileColors:{profileActiveBackground:"#e4a537",profileActiveText:"#17120a",profileInactiveBackground:"#494033",profileInactiveText:"#f3e6cd",profilePendingBackground:"#2563eb",profilePendingText:"#ffffff"}},
  copper: {"name":"Copper","background":"#000000","foreground":"#ffe8e1","secondary":"#d5a297","accent":"#f17c57","track":"#3b2020","thresholdMarker":"#6a4440","panel":"#291616","warning":"#ffb084","font":"Bahnschrift,Segoe UI,Arial,sans-serif","profileColors":{"profileActiveBackground":"#a6422c","profileActiveText":"#fff3ed","profileInactiveBackground":"#4b3030","profileInactiveText":"#efd1c8","profilePendingBackground":"#2563eb","profilePendingText":"#ffffff"}},
  ice: {name:"Ice Blue",background:"#000000",foreground:"#f3fbff",secondary:"#b2d8f2",accent:"#5dd2ff",track:"#173a50",thresholdMarker:"#456173",panel:"#0c293d",warning:"#ffd17c",font:"Segoe UI,Arial,sans-serif",profileColors:{profileActiveBackground:"#08779b",profileActiveText:"#ffffff",profileInactiveBackground:"#304552",profileInactiveText:"#d9ebf3",profilePendingBackground:"#2563eb",profilePendingText:"#ffffff"}},
  icewhite: {"name":"Ice White","background":"#000000","foreground":"#ffffff","secondary":"#ccdae2","accent":"#f5fcff","track":"#3d455b","thresholdMarker":"#646b7c","panel":"#102a35","warning":"#ffc785","font":"Segoe UI,Arial,sans-serif","profileColors":{"profileActiveBackground":"#ecfaff","profileActiveText":"#12222c","profileInactiveBackground":"#3d455b","profileInactiveText":"#e0f6ff","profilePendingBackground":"#2563eb","profilePendingText":"#ffffff"}},
  mint: {name:"Mint",background:"#000000",foreground:"#f3f7fc",secondary:"#b1c1d8",accent:"#74e2bd",track:"#29364b",thresholdMarker:"#546679",panel:"#1b2b38",warning:"#ffbd72",font:"Segoe UI,Arial,sans-serif",profileColors:{profileActiveBackground:"#21854a",profileActiveText:"#ffffff",profileInactiveBackground:"#4b5058",profileInactiveText:"#ffffff",profilePendingBackground:"#2563eb",profilePendingText:"#ffffff"}},
  mono: {"name":"Monochrome","background":"#000000","foreground":"#f4f5f7","secondary":"#b8bec7","accent":"#d6dbe3","track":"#292c32","thresholdMarker":"#545861","panel":"#1c1f24","warning":"#ffb477","font":"Segoe UI,Arial,sans-serif","profileColors":{"profileActiveBackground":"#c6ccd4","profileActiveText":"#14171c","profileInactiveBackground":"#41454b","profileInactiveText":"#dfe3e8","profilePendingBackground":"#2563eb","profilePendingText":"#ffffff"}},
  rose: {"name":"Rose","background":"#000000","foreground":"#fff0f5","secondary":"#d7aebd","accent":"#ff83ad","track":"#3c2330","thresholdMarker":"#67505d","panel":"#291820","warning":"#ffc18b","font":"Segoe UI,Arial,sans-serif","profileColors":{"profileActiveBackground":"#ae345f","profileActiveText":"#ffffff","profileInactiveBackground":"#503640","profileInactiveText":"#f0d6e0","profilePendingBackground":"#2563eb","profilePendingText":"#ffffff"}},
  violet: {"name":"Violet","background":"#000000","foreground":"#f4efff","secondary":"#baa9d4","accent":"#bd90ff","track":"#30223f","thresholdMarker":"#59486b","panel":"#201729","warning":"#ffbf7b","font":"Segoe UI,Arial,sans-serif","profileColors":{"profileActiveBackground":"#7443b5","profileActiveText":"#ffffff","profileInactiveBackground":"#453a53","profileInactiveText":"#e0d6ef","profilePendingBackground":"#2563eb","profilePendingText":"#ffffff"}},
};

export function appearance(options: Appearance = {},active=false): {theme: Theme} {
  const preset=options.theme && Object.hasOwn(THEMES,options.theme) ? THEMES[options.theme]! : THEMES.icewhite!;
  const fontId=options.fontFamily && Object.hasOwn(FONTS,options.fontFamily) ? options.fontFamily : preset.font.startsWith("Bahnschrift")?"bahnschrift":"segoe";
  const theme:Theme={...preset,font:FONTS[fontId]!,fontId,fontWeight:options.fontWeight==="normal"?400:700};
  const valid=(color:unknown):color is string=>typeof color==="string" && /^#[0-9a-f]{6}$/i.test(color);
  const normal=options.backgroundMode==="custom" && valid(options.backgroundColor)?backgroundTheme(theme,options.backgroundColor):theme;
  return {theme:textTheme(active && options.activeBackgroundMode==="custom" && valid(options.activeBackgroundColor)?backgroundTheme(theme,options.activeBackgroundColor):normal,options)};
}

export function textTheme(theme:Theme,options:Appearance):Theme {
  const value=options.textColor;
  return options.textColorMode==="custom" && typeof value==="string" && /^#[0-9a-f]{6}$/i.test(value) ? {...theme,foreground:value,secondary:value} : theme;
}

export function backgroundTheme(theme: Theme, background: string): Theme {
  const linear=[1,3,5].map(index=>{
    const channel=parseInt(background.slice(index,index+2),16)/255;
    return channel<=0.04045 ? channel/12.92 : ((channel+0.055)/1.055)**2.4;
  });
  const luminance=0.2126*linear[0]!+0.7152*linear[1]!+0.0722*linear[2]!;
  const foreground=(luminance+0.05)/0.05 >= 1.05/(luminance+0.05) ? "#000000" : "#ffffff";
  return {...theme,background,foreground,secondary:foreground};
}

export function profileColors(theme: Theme, options: Appearance): ProfileColors {
  const colors={...theme.profileColors};
  if(options.profileColorMode === "custom") for(const key of Object.keys(colors) as (keyof ProfileColors)[]) {
    const value=options[key];
    if(typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) colors[key]=value;
  }
  return colors;
}
