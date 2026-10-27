// SPDX-License-Identifier: GPL-3.0-or-later
export type KeyboardKey = {code: number; label: string; x: number; y: number; width: number; height: number};
export const keyboardKeys: KeyboardKey[] = [];
function key(code: number, label: string, x: number, y: number, width=1, height=1): void {
  keyboardKeys.push({code,label,x,y,width,height});
}
function row(y: number, items: [number,string,number?][]): void {
  let x=0;
  for (const [code,label,width=1] of items) {key(code,label,x,y,width); x+=width;}
}
key(41,"Esc",0,0);
for(let i=0;i<12;i++) key(58+i,`F${i+1}`,2+i+Math.floor(i/4)*0.5,0);
for(const [code,label,x] of [[70,"Print",16],[71,"Scroll",17],[72,"Pause",18]] as const) key(code,label,x,0);
row(1,[[53,"`"],...Array.from({length:10},(_,i):[number,string]=>[30+i,i===9?"0":String(i+1)]),[45,"-"],[46,"="],[42,"Backspace",2]]);
row(2,[[43,"Tab",1.5],...[..."QWERTYUIOP"].map((label):[number,string]=>[label.charCodeAt(0)-61,label]),[47,"["],[48,"]"],[49,"\\",1.5]]);
row(3,[[57,"Caps",1.75],...[..."ASDFGHJKL"].map((label):[number,string]=>[label.charCodeAt(0)-61,label]),[51,";"],[52,"'"],[40,"Enter",2.25]]);
row(4,[[225,"L Shift",1.25],[100,"ISO"],...[..."ZXCVBNM"].map((label):[number,string]=>[label.charCodeAt(0)-61,label]),[54,","],[55,"."],[56,"/"],[229,"R Shift",2.75]]);
row(5,[[224,"L Ctrl",1.25],[227,"L Win",1.25],[226,"L Alt",1.25],[44,"Space",6.25],[230,"R Alt",1.25],[231,"R Win",1.25],[101,"Menu",1.25],[228,"R Ctrl",1.25]]);
for(const [code,label,x,y] of [[73,"Insert",16,1],[74,"Home",17,1],[75,"Page Up",18,1],[76,"Delete",16,2],[77,"End",17,2],[78,"Page Down",18,2],[82,"Up",17,4],[80,"Left",16,5],[81,"Down",17,5],[79,"Right",18,5]] as const) key(code,label,x,y);
for(const [code,label,x] of [[83,"Num Lock",20],[84,"Num /",21],[85,"Num *",22],[86,"Num -",23]] as const) key(code,label,x,1);
for(const [y,start] of [[2,95],[3,92],[4,89]]) for(let i=0;i<3;i++) key(start!+i,`Num ${start!-88+i}`,20+i,y!);
key(87,"Num +",23,2,1,2); key(88,"Num Enter",23,4,1,2);
key(98,"Num 0",20,5,2);key(99,"Num .",22,5);

const labels = new Map(keyboardKeys.map(key=>[key.code,key.label]));
export function keyName(code: number): string {return labels.get(code) || `HID ${code}`;}

export function activeKeys(values: Record<string,number>): {code:number;label:string;value:number}[] {
  return Object.entries(values).filter(([,value])=>value>0).map(([code,value])=>({code:Number(code),label:keyName(Number(code)),value})).sort((a,b)=>b.value-a.value || a.code-b.code);
}

export function parseKeyList(value:string):number[] {
  const parts=value.split(',').map(part=>part.trim()).filter(Boolean);
  if(!parts.length || parts.length>64) throw new Error("Enter 1–64 keys separated by commas");
  return [...new Set(parts.map(part=>{
    const hid=/^(?:HID\s*|#)(\d+)$/i.exec(part);
    if(hid) {
      const code=Number(hid[1]);
      if(code>=4 && code<=65535) return code;
    }
    const normalize=(text:string)=>text.toLowerCase().replace(/\s/g,'');
    const alias:Record<string,string>={shift:'lshift',ctrl:'lctrl',control:'lctrl',alt:'lalt',escape:'esc',spacebar:'space'};
    const name=alias[normalize(part)] || normalize(part);
    const found=keyboardKeys.find(key=>normalize(key.label)===name);
    if(!found) throw new Error(`Unknown key: ${part.slice(0,24)}`);
    return found.code;
  }))];
}

export function filterAnyKeys(values:Record<string,number>,options:{anyKeyFilter?:string;anyKeyList?:string}):Record<string,number> {
  const mode=options.anyKeyFilter;
  const keys=mode==='wasd'?[26,4,22,7]:mode==='custom'?parseKeyList(options.anyKeyList || ''):undefined;
  return Object.fromEntries(Object.entries(values).filter(([code])=>keys?keys.includes(Number(code)):mode==='no-modifiers'?Number(code)<224 || Number(code)>231:true));
}
