import {build} from 'esbuild';
import {mkdir, copyFile, cp, readFile, readdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const plugin = path.join(root, 'com.firflabs.wootdeck.sdPlugin');
const bin = path.join(plugin, 'bin');
await mkdir(bin, {recursive:true});
const localCargo=path.join(root,'tmp/toolchains/cargo/bin/cargo.exe');
const cargo=process.env.WOOTDECK_CARGO || (existsSync(localCargo)?localCargo:'cargo');
const env={...process.env,CARGO_TARGET_DIR:process.env.CARGO_TARGET_DIR || path.join(root,'tmp/build/native'),RUSTFLAGS:[process.env.RUSTFLAGS,'-C target-feature=+crt-static'].filter(Boolean).join(' ')};
if(existsSync(localCargo)) {
  env.RUSTUP_HOME ??= path.join(root,'tmp/toolchains/rustup');
  env.CARGO_HOME ??= path.join(root,'tmp/toolchains/cargo');
}
if (!process.argv.includes('--plugin-only')) {
  execFileSync(cargo, ['build','--release','--locked','--manifest-path','native/Cargo.toml'], {stdio:'inherit',env});
  await copyFile(path.join(env.CARGO_TARGET_DIR,'release/wootdeck-helper.exe'),path.join(bin,'wootdeck-helper.exe'));
}
const sdk=process.env.WOOTING_SDK_DLL || path.join(root,'tmp/cache/sdk/wooting-0.9.1/wooting_analog_sdk.dll');
if(!existsSync(sdk) && !process.env.WOOTING_SDK_DLL) execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(root,'scripts/prepare-sdk.ps1')],{stdio:'inherit'});
if (createHash('sha256').update(await readFile(sdk)).digest('hex') !== 'cdbbe1183e248ac18979de4f8e71bd2e26cb369daef835c1c7e3e64ecc09c5fb') throw new Error('Review the installed SDK version before bundling a different DLL');
if (!process.argv.includes('--plugin-only')) await copyFile(sdk,path.join(bin,'wooting_analog_sdk.dll'));
const bundle=await build({entryPoints:['src/plugin.ts'],bundle:true,platform:'node',target:'node24',format:'esm',outfile:path.join(bin,'plugin.js'),packages:'bundle',metafile:true,banner:{js:'// SPDX-License-Identifier: GPL-3.0-or-later\nimport { createRequire } from "node:module"; const require = createRequire(import.meta.url);'}});
await copyFile('LICENSE',path.join(plugin,'LICENSE'));
await copyFile('NOTICE.md',path.join(plugin,'NOTICE.md'));
const repository=process.env.GITHUB_REPOSITORY, revision=process.env.GITHUB_SHA;
const source=repository && /^[\w.-]+\/[\w.-]+$/.test(repository) && /^[0-9a-f]{40}$/.test(revision || '') ?
  `Project source and build instructions: https://github.com/${repository}/tree/${revision}\nSource archive: https://github.com/${repository}/archive/${revision}.zip\n` :
  'This is a local development build. Distribute the matching WootDeck source and build scripts alongside any public binary release.\n';
await writeFile(path.join(plugin,'SOURCE.txt'),'WootDeck: GPL-3.0-or-later. See LICENSE and NOTICE.md.\n'+source+'Third-party source/license information: THIRD-PARTY-NOTICES.md and licenses/.\n');
execFileSync(process.execPath, ['scripts/icons.mjs'], {stdio:'inherit'});
// Follow the actual bundle, including nested packages and subpath exports.
// A hard-coded top-level list previously missed @elgato/schemas.
const bundledPackages=new Map();
for(const input of Object.keys(bundle.metafile.inputs)) {
  if(!input.replaceAll('\\','/').includes('node_modules/')) continue;
  let directory=path.dirname(path.resolve(root,input));
  while(directory!==path.dirname(directory)) {
    let metadata;
    try {metadata=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));}
    catch(error) {if(error.code!=='ENOENT') throw error;}
    if(metadata?.name) {bundledPackages.set(directory,metadata);break;}
    directory=path.dirname(directory);
  }
}
const nodeNotices=[];
for(const [directory,metadata] of bundledPackages) {
  const names=(await readdir(directory)).filter(name=>/^(licen[sc]e|copying|notice|copyright)/i.test(name));
  if(!names.length) throw new Error(`No license notice found for bundled package ${metadata.name}`);
  for(const name of names) await cp(path.join(directory,name),path.join(plugin,'licenses',metadata.name.replaceAll('/','-')+'-'+name),{recursive:true});
  nodeNotices.push({name:metadata.name,version:metadata.version,license:metadata.license});
}
await writeFile(path.join(plugin,'licenses','bundled-node-packages.json'),JSON.stringify(nodeNotices.sort((a,b)=>a.name.localeCompare(b.name)),null,2)+'\n');
const metadata=JSON.parse(execFileSync(cargo,['metadata','--locked','--format-version','1','--manifest-path','native/Cargo.toml','--filter-platform','x86_64-pc-windows-msvc'],{env,encoding:'utf8'}));
const rustNotices=[];
for(const crate of metadata.packages.filter(crate=>crate.source)) {
  const directory=path.dirname(crate.manifest_path);
  const names=(await readdir(directory)).filter(name=>/^(licen[sc]e|copying|notice|copyright)/i.test(name));
  if(crate.license_file && !names.includes(crate.license_file)) names.push(crate.license_file);
  if(!names.length) throw new Error(`No license notice found for Rust crate ${crate.name}`);
  const destination=path.join(plugin,'licenses','rust',`${crate.name}-${crate.version}`);
  await mkdir(destination,{recursive:true});
  for(const name of names) await cp(path.resolve(directory,name),path.join(destination,path.basename(name)),{recursive:true});
  rustNotices.push({name:crate.name,version:crate.version,license:crate.license});
  }
await writeFile(path.join(plugin,'licenses','bundled-rust-packages.json'),JSON.stringify(rustNotices.sort((a,b)=>a.name.localeCompare(b.name)),null,2)+'\n');
console.log('Built WootDeck with native Rust helper.');
