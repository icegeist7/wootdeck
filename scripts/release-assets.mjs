// SPDX-License-Identifier: GPL-3.0-or-later
// Package already-built files; never changes a remote repository or publishes.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

const pkg=JSON.parse(await readFile('package.json','utf8'));
const out=path.resolve('tmp/dist');
await mkdir(out,{recursive:true});
const pluginName=`WootDeck-${pkg.version}-windows-x64.streamDeckPlugin`;
await copyFile(path.join(out,'com.firflabs.wootdeck.streamDeckPlugin'),path.join(out,pluginName));
const sourceName=`WootDeck-${pkg.version}-source.zip`;
execFileSync('git',['archive','--format=zip',`--prefix=WootDeck-${pkg.version}/`,`--output=${path.join(out,sourceName)}`,'HEAD'],{stdio:'inherit'});
const files=[pluginName,sourceName];
const checksums=[];
for(const file of files) checksums.push(`${createHash('sha256').update(await readFile(path.join(out,file))).digest('hex')}  ${file}`);
await writeFile(path.join(out,'SHA256SUMS.txt'),checksums.join('\n')+'\n');
await copyFile('LICENSE',path.join(out,'LICENSE.txt'));
await copyFile('NOTICE.md',path.join(out,'NOTICE.md'));
console.log(`Prepared ${pluginName}, ${sourceName}, SHA256SUMS.txt and license notices.`);
