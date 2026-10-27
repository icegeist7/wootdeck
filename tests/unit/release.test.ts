// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

test('release tags must match versions; downloads include verified package/source and exclude research',()=>{
  const temporaryRoot=path.resolve('tmp/test-runs');mkdirSync(temporaryRoot,{recursive:true});
  const root=mkdtempSync(path.join(temporaryRoot,'wootdeck-release-'));
  const check=path.resolve('scripts/check-release.mjs'),assets=path.resolve('scripts/release-assets.mjs');
  const audit=path.resolve('scripts/check-release-files.ps1');
  const auditFiles=(args:string[])=>execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',audit,...args],{cwd:root,stdio:'pipe'});
  const write=(name:string,value:string)=>{mkdirSync(path.dirname(path.join(root,name)),{recursive:true});writeFileSync(path.join(root,name),value);};
  const version='0.1.61';
  try {
    write('package.json',JSON.stringify({version,license:'GPL-3.0-or-later'}));
    write('package-lock.json',JSON.stringify({version,packages:{'':{version}}}));
    write('com.firflabs.wootdeck.sdPlugin/manifest.json',JSON.stringify({Version:version+'.0'}));
    copyFileSync('LICENSE',path.join(root,'LICENSE'));copyFileSync('NOTICE.md',path.join(root,'NOTICE.md'));
    copyFileSync('.gitattributes',path.join(root,'.gitattributes'));
    copyFileSync('.gitignore',path.join(root,'.gitignore'));
    write('README.md','Source build instructions fixture');write('src/plugin.ts','// Original source fixture');
    write('tmp/research/private.txt','Must not appear in released source');
    write('internal/concept.md','Private planning must not appear in released source');
    write('tmp/dist/com.firflabs.wootdeck.streamDeckPlugin','Packaged plugin fixture');
    const env={...process.env,GITHUB_REF_TYPE:'tag',GITHUB_REF_NAME:'v'+version};
    execFileSync(process.execPath,[check],{cwd:root,env,stdio:'pipe'});
    assert.throws(()=>execFileSync(process.execPath,[check],{cwd:root,env:{...env,GITHUB_REF_NAME:'v9.9.9'},stdio:'pipe'}));
    const git=(args:string[])=>execFileSync('git',['-c','core.autocrlf=false','-c','core.hooksPath=','-c','commit.gpgsign=false',...args],{cwd:root,stdio:'pipe'});
    git(['init','--initial-branch=main']);
    const ignored=git(['check-ignore','internal/concept.md','tmp/research/private.txt']).toString();
    assert.ok(ignored.includes('internal/concept.md') && ignored.includes('tmp/research/private.txt'));
    git(['add','.']);
    auditFiles(['-CheckIndex']);
    // Archive rules also protect against accidental tracking of private files.
    git(['add','--force','internal/concept.md','tmp/research/private.txt','tmp/dist/com.firflabs.wootdeck.streamDeckPlugin']);
    assert.throws(()=>auditFiles(['-CheckIndex']), 'Tracked private files must stop CI even when ignored for source archives');
    git(['-c','user.name=WootDeck Tests','-c','user.email=tests@example.invalid','commit','-m','Release fixture']);
    execFileSync(process.execPath,[assets],{cwd:root,stdio:'pipe'});
    auditFiles(['-SourceArchive',path.join(root,'tmp/dist',`WootDeck-${version}-source.zip`)]);
    const archive=readFileSync(path.join(root,'tmp/dist',`WootDeck-${version}-source.zip`));
    assert.ok(archive.includes(Buffer.from(`WootDeck-${version}/src/plugin.ts`)));
    assert.ok(archive.includes(Buffer.from(`WootDeck-${version}/LICENSE`)));
    assert.ok(!archive.includes(Buffer.from('tmp/research/private.txt')));
    assert.ok(!archive.includes(Buffer.from('internal/concept.md')));
    assert.ok(!archive.includes(Buffer.from('tmp/dist/com.firflabs.wootdeck.streamDeckPlugin')));
    const sums=readFileSync(path.join(root,'tmp/dist/SHA256SUMS.txt'),'utf8').trim().split('\n');
    assert.equal(sums.length,2);
    for(const line of sums) {
      const [hash,file]=line.split('  ');
      assert.equal(hash,createHash('sha256').update(readFileSync(path.join(root,'tmp/dist',file!))).digest('hex'));
    }
    assert.equal(readFileSync(path.join(root,'tmp/dist',`WootDeck-${version}-windows-x64.streamDeckPlugin`),'utf8'),'Packaged plugin fixture');
  } finally {
    assert.equal(path.dirname(path.resolve(root)),path.resolve(temporaryRoot));
    assert.ok(path.basename(root).startsWith('wootdeck-release-'));
    rmSync(root,{recursive:true,force:true});
  }
});
