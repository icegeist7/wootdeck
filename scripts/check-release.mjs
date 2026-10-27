// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const pkg=JSON.parse(await readFile('package.json','utf8'));
const lock=JSON.parse(await readFile('package-lock.json','utf8'));
const manifest=JSON.parse(await readFile('com.firflabs.wootdeck.sdPlugin/manifest.json','utf8'));
assert.match(pkg.version,/^\d+\.\d+\.\d+$/,'Use a numeric three-part plugin version');
assert.equal(lock.version,pkg.version);
assert.equal(lock.packages[''].version,pkg.version);
assert.equal(manifest.Version,`${pkg.version}.0`);
assert.equal(pkg.license,'GPL-3.0-or-later');
if(process.env.GITHUB_REF_TYPE==='tag') assert.equal(process.env.GITHUB_REF_NAME,`v${pkg.version}`,'Release tag must match package and manifest versions');
assert.ok((await readFile('LICENSE','utf8')).includes('GNU GENERAL PUBLIC LICENSE'));
console.log(`Release metadata checked: ${pkg.version}, GPL-3.0-or-later`);
