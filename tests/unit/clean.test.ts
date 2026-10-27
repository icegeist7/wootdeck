// SPDX-License-Identifier: GPL-3.0-or-later
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';

test('clean removes only generated outputs and preserves private data and local tools',()=>{
  const temporary=path.resolve('tmp/test-runs');mkdirSync(temporary,{recursive:true});
  const fixture=mkdtempSync(path.join(temporary,'clean-'));
  const script=path.resolve('scripts/clean.mjs');
  const removable=['build','test-runs','previews','dist'];
  const preserved=['toolchains','venv','cache','test-results','diagnostics','logs'];
  try {
    writeFileSync(path.join(fixture,'package.json'),JSON.stringify({name:'wootdeck'}));
    for(const name of [...removable,...preserved]) {
      const directory=path.join(fixture,'tmp',name);mkdirSync(directory,{recursive:true});writeFileSync(path.join(directory,'fixture.txt'),'data');
    }
    mkdirSync(path.join(fixture,'internal'));writeFileSync(path.join(fixture,'internal/private.md'),'private');
    execFileSync(process.execPath,[script,'--dry-run'],{cwd:fixture,stdio:'pipe'});
    assert.ok(removable.every(name=>existsSync(path.join(fixture,'tmp',name))));
    execFileSync(process.execPath,[script],{cwd:fixture,stdio:'pipe'});
    assert.ok(removable.every(name=>!existsSync(path.join(fixture,'tmp',name))));
    assert.ok(preserved.every(name=>existsSync(path.join(fixture,'tmp',name,'fixture.txt'))));
    assert.ok(existsSync(path.join(fixture,'internal/private.md')));
  } finally {
    assert.equal(path.dirname(path.resolve(fixture)),temporary);
    assert.ok(path.basename(fixture).startsWith('clean-'));
    rmSync(fixture,{recursive:true,force:true});
  }
});
