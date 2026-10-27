// SPDX-License-Identifier: GPL-3.0-or-later
// Remove generated scratch files only. Preserve tools, caches and evidence.
import {existsSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import path from 'node:path';
const root=realpathSync(process.cwd());
if(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).name!=='wootdeck') throw new Error('Run clean from the WootDeck project root');
const temporary=path.join(root,'tmp');
function inside(parent,target) {
  const relative=path.relative(parent,target);
  return relative!=='' && relative!=='..' && !relative.startsWith('..'+path.sep) && !path.isAbsolute(relative);
}
if(existsSync(temporary) && !inside(root,realpathSync(temporary))) throw new Error('Temporary folder points outside this workspace');
for(const name of ['build','test-runs','previews','dist']) {
  const target=path.resolve(temporary,name);
  if(!inside(temporary,target)) throw new Error('Unsafe cleanup path');
  if(!existsSync(target)) continue;
  if(!inside(realpathSync(temporary),realpathSync(target))) throw new Error('Cleanup target points outside the temporary folder');
  if(process.argv.includes('--dry-run')) console.log(`Would remove ${target}`);
  else {rmSync(target,{recursive:true,force:true});console.log(`Removed ${target}`);}
}
