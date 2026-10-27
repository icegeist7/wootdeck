// SPDX-License-Identifier: GPL-3.0-or-later
import streamDeck, { action, SingletonAction, type KeyAction, type WillAppearEvent, type WillDisappearEvent, type DidReceiveSettingsEvent, type KeyDownEvent, type KeyUpEvent, type SendToPluginEvent } from "@elgato/streamdeck";
import { Backend } from "./backend.js";
import { cycleDirection,longPressMs,configuredActuation, anyKeyDepth, cycleOrder, cycleTarget, toggleTarget, selectedDevice, validDepth, type Kind, type Settings, type Profile } from "./types.js";
import { anyKeyTile, tile } from "./render.js";
import {activeKeys,filterAnyKeys} from "./keyboard.js";
import {randomUUID} from "node:crypto";
import {applyDesign,captureDesign,loadDesigns,type SavedDesign} from "./presets.js";
import {formatDepth,updatePeak,needsActuation} from "./depth-display.js";
import {THEMES} from "./themes.js";
import {animationFrame,type AnimationState} from "./animation.js";

const backend = new Backend();
type Entry = { action: KeyAction<Settings>; settings: Settings; kind: Kind; peak: number; peakAt?:number; image: string; busy: boolean; error?: string; errorUntil: number; rendering: boolean; peakSession?: string; animationState?:AnimationState; pressVersion:number };
const entries = new Map<string, Entry>();
const pendingProfiles = new Map<string,{owner:string;generation:number;profile:Profile;direction?:number}>();
type CycleHold={timer:NodeJS.Timeout;started:number;duration:number;serial:string;generation:number;longFired:boolean;short:1|-1;long:1|-1};
const cycleHolds=new Map<string,CycleHold>();
function cancelCycleHold(context:string):void {const hold=cycleHolds.get(context);if(hold) clearTimeout(hold.timer);cycleHolds.delete(context);}
function sameHoldDevice(entry:Entry|undefined,hold:CycleHold):boolean {const device=entry?selectedDevice(backend.devices,entry.settings.serial):undefined;return !!device?.ready && device.serial===hold.serial && device.generation===hold.generation;}
let globalSettings:Record<string,any>={}, customThemes:SavedDesign[]=[], globalsLoaded=false;
let globalsReady:Promise<void>=Promise.resolve(), themeQueue:Promise<void>=Promise.resolve();

function subscriptions(): void {
  const keys = new Map<string, {keys:Set<number>;allKeys:boolean;actuation:boolean}>();
  for (const entry of entries.values()) {
    const device = selectedDevice(backend.devices, entry.settings.serial);
    if (entry.kind !== "depth" || !device) continue;
    const selected = keys.get(device.serial) || {keys:new Set<number>(),allKeys:false,actuation:false};
    if (entry.settings.keyMode === "any") selected.allKeys=true;
    else selected.keys.add(typeof entry.settings.key === "number" ? entry.settings.key : 26);
    selected.actuation ||= needsActuation(entry.settings);
    keys.set(device.serial, selected);
  }
  backend.subscribe([...keys].map(([serial, subscription]) => ({serial, keys: [...subscription.keys].sort((a,b)=>a-b),allKeys:subscription.allKeys,actuation:subscription.actuation})));
}

async function inventory(): Promise<void> {
  await streamDeck.ui.sendToPropertyInspector({type: "inventory", devices: backend.devices, status: backend.status, customThemes:customThemes.map(({id,name})=>({id,name})), profilePalettes:Object.fromEntries(Object.entries(THEMES).map(([id,theme])=>[id,{...theme.profileColors,background:theme.background,thresholdMarker:theme.thresholdMarker}]))});
}

async function themeCommand(entry:Entry,payload:Record<string,any>):Promise<void> {
  await globalsReady;
  if(!globalsLoaded) throw new Error("Custom Themes are unavailable; restart WootDeck and try again");
  const selected=customThemes.find(theme=>theme.id===payload.id);
  let id=selected?.id;
  if(payload.type==="themeApply") {
    if(!selected) throw new Error("Choose a Custom Theme");
    entry.settings=applyDesign(entry.settings,selected.design);
    await entry.action.setSettings(entry.settings);
    subscriptions(); render(entry);
  } else if(payload.type==="themeSave") {
    const name=String(payload.name || '').trim().slice(0,40);
    if(!name) throw new Error("Enter a theme name");
    if(payload.id && !selected) throw new Error("Custom Theme no longer exists");
    if(!selected && customThemes.length>=32) throw new Error("Maximum 32 Custom Themes");
    if(customThemes.some(theme=>theme.name.toLowerCase()===name.toLowerCase() && theme.id!==selected?.id)) throw new Error("That name already exists; update the selected theme or choose another name");
    id=selected?.id || randomUUID();
    const theme={id,name,design:captureDesign(payload.design)};
    const next=selected?customThemes.map(item=>item.id===id?theme:item):[...customThemes,theme];
    await streamDeck.settings.setGlobalSettings({...globalSettings,customThemes:next});
    customThemes=next; globalSettings={...globalSettings,customThemes:next};
  } else if(payload.type==="themeDelete") {
    if(!selected) throw new Error("Choose a Custom Theme");
    const next=customThemes.filter(theme=>theme.id!==selected.id);
    await streamDeck.settings.setGlobalSettings({...globalSettings,customThemes:next});
    customThemes=next;globalSettings={...globalSettings,customThemes:next};id=undefined;
  }
  await streamDeck.ui.sendToPropertyInspector({type:"customThemes",themes:customThemes.map(({id,name})=>({id,name})),selectedId:id || "",message:payload.type==="themeApply"?"Design applied to this action":payload.type==="themeDelete"?"Custom Theme deleted":"Custom Theme saved"});
}

function render(entry: Entry): void {
  if (entry.rendering) return;
  const device = selectedDevice(backend.devices, entry.settings.serial);
  const peakSession = device?.ready ? `${device.serial}:${device.generation}` : undefined;
  if (entry.peakSession !== peakSession) { entry.peak = 0; entry.peakAt=undefined; entry.peakSession = peakSession; }
  const observedProfile = device?.profiles.find(p => p.slot === device.activeSlot);
  const transition=device?pendingProfiles.get(device.serial):undefined;
  const pending=device?.ready && transition?.generation===device.generation && transition.owner===entry.action.id ? transition : undefined;
  const profile = pending?.profile || observedProfile;
  const selected = device?.profiles.find(p => p.slot === entry.settings.slot);
  const missing = !device || !device.ready || Date.now()-device.observedAt>2000;
  const key = entry.settings.key ?? 26;
  const frame=backend.depth.get(device?.serial || "");
  const all=entry.kind === "depth" && entry.settings.keyMode === "any";
  let allValues=all?anyKeyDepth(frame,device):undefined, filterError:string|undefined;
  if(allValues) try {allValues=filterAnyKeys(allValues,entry.settings);} catch(error) {filterError=String((error as Error).message);allValues=undefined;}
  const depth = all ? (allValues?Math.max(0,...Object.values(allValues)):undefined) : validDepth(frame, device, key);
  let label = entry.settings.label || (entry.kind === "select" ? selected?.name || "Choose profile" : entry.kind === "depth" ? all?"Key Pressure":entry.settings.keyLabel || (key === 26 ? "W" : `Key ${key}`) : profile?.name || "Profile");
  let status = missing ? "Disconnected" : undefined;
  if(entry.kind==="toggle" && !missing) try {toggleTarget(device!,entry.settings);} catch(error) {status=(error as Error).message;}
  if (entry.error && Date.now() < entry.errorUntil) status = entry.error;
  if (entry.kind === "depth" && depth === undefined && !missing) status = "No analog data";
  if(filterError && !missing) status=filterError;
  const moved = entry.kind === "select" && !!entry.settings.profileName && selected?.name !== entry.settings.profileName;
  if (moved) status = "Re-select profile";
  if (!entry.settings.serial && backend.devices.length > 1) status = "Choose keyboard";
  if (entry.kind === "depth" && depth !== undefined) Object.assign(entry,updatePeak(entry,depth,entry.settings,Date.now()));
  const active = !missing && !moved && (entry.kind === "select" ? device.activeSlot === entry.settings.slot : entry.kind==="toggle" ? [entry.settings.toggleSlotA,entry.settings.toggleSlotB].includes(device.activeSlot ?? -1) : ["current","cycle"].includes(entry.kind) && !!profile);
  const displayedProfile = entry.kind === "select" ? selected : profile;
  const footer = displayedProfile ? `P${displayedProfile.slot+1}${entry.kind==="toggle"?" · Toggle":entry.kind==="cycle"?(entry.settings.direction===-1?" · Prev":" · Next"):""}` : "WootDeck";
  const ratios=configuredActuation(device);
  const display={...entry.settings,configuredThreshold:ratios?.[String(key)],configuredThresholds:ratios,physicalKey:entry.kind==="depth" && !all,cycleDirection:pending?.direction};
  const rawImage = all && allValues && !status ? anyKeyTile(label,allValues,entry.peak,display) : tile(label, footer, active, status, entry.kind === "depth" && depth !== undefined ? depth : undefined, entry.kind === "depth" && depth !== undefined ? entry.peak : undefined,{...display,pending:!!pending,spinnerFrame:Math.floor(Date.now()/80)%12});
  const signature=JSON.stringify([peakSession,entry.kind,label,status || '',entry.kind==='depth'?(all?Object.keys(allValues || {}).sort():depth===undefined?'unavailable':depth>0?'pressed':'idle'):[displayedProfile?.slot,active,!!pending]]);
  const animated=animationFrame(entry.animationState,rawImage,signature,entry.settings,entry.pressVersion,Date.now());
  entry.animationState=animated.state;
  const image=animated.image;
  if (image === entry.image) return;
  entry.image = image;
  entry.rendering = true;
  const dataUri = "data:image/svg+xml;base64,"+Buffer.from(image, "utf8").toString("base64");
  void entry.action.setImage(dataUri).catch(error => { entry.image = ""; streamDeck.logger.warn(String(error)); }).finally(() => { entry.rendering = false; });
}

class WootAction extends SingletonAction<Settings> {
  constructor(private kind: Kind) { super(); }
  override onWillAppear(ev: WillAppearEvent<Settings>): void {
    if (!ev.action.isKey()) return;
    cancelCycleHold(ev.action.id);
    entries.set(ev.action.id, {action: ev.action, settings: ev.payload.settings, kind: this.kind, peak: 0, image: "", busy: false, errorUntil: 0, rendering: false,pressVersion:0});
    void ev.action.setTitle("");
    subscriptions();
    render(entries.get(ev.action.id)!);
  }
  override onWillDisappear(ev: WillDisappearEvent<Settings>): void { cancelCycleHold(ev.action.id); entries.delete(ev.action.id); subscriptions(); }
  override onDidReceiveSettings(ev: DidReceiveSettingsEvent<Settings>): void {
    cancelCycleHold(ev.action.id);
    const entry = entries.get(ev.action.id);
    if (entry) { entry.settings = ev.payload.settings; entry.peak = 0; entry.peakAt=undefined; entry.error = undefined; entry.animationState=undefined; subscriptions(); render(entry); }
  }
  override async onKeyDown(ev: KeyDownEvent<Settings>): Promise<void> {
    if(this.kind!=="cycle" || ev.payload.isInMultiAction) {await this.press(ev.action.id);return;}
    const entry=entries.get(ev.action.id);
    if(!entry || entry.busy || cycleHolds.has(ev.action.id)) return;
    const device=selectedDevice(backend.devices,entry.settings.serial);
    if(!device?.ready) {await this.press(ev.action.id);return;}
    if(pendingProfiles.has(device.serial)) return;
    const hold:CycleHold={started:performance.now(),duration:longPressMs(entry.settings),serial:device.serial,generation:device.generation,longFired:false,short:cycleDirection(entry.settings),long:cycleDirection(entry.settings,true),timer:setTimeout(()=>{
      if(cycleHolds.get(ev.action.id)!==hold) return;
      if(!sameHoldDevice(entries.get(ev.action.id),hold)) {cancelCycleHold(ev.action.id);return;}
      hold.longFired=true;
      void this.press(ev.action.id,hold.long);
    },longPressMs(entry.settings))};
    hold.timer.unref();cycleHolds.set(ev.action.id,hold);
  }
  override async onKeyUp(ev:KeyUpEvent<Settings>):Promise<void> {
    if(this.kind!=="cycle") return;
    const hold=cycleHolds.get(ev.action.id);
    if(!hold) return;
    cancelCycleHold(ev.action.id);
    if(!hold.longFired && sameHoldDevice(entries.get(ev.action.id),hold)) await this.press(ev.action.id,performance.now()-hold.started>=hold.duration?hold.long:hold.short);
  }
  override async onSendToPlugin(ev: SendToPluginEvent<any, Settings>): Promise<void> {
    if(ev.payload?.type === "refreshActuation") {
      const entry=entries.get(ev.action.id), device=selectedDevice(backend.devices,entry?.settings.serial);
      if(entry?.kind==="depth" && device?.ready && needsActuation(entry.settings)) {
        try {await backend.request("refreshActuation",{serial:device.serial,generation:device.generation});}
        catch(error) {await streamDeck.ui.sendToPropertyInspector({type:"error",message:(error as Error).message});}
      }
    }
    if (ev.payload?.type === "test") await this.press(ev.action.id);
    if(["themeSave","themeApply","themeDelete"].includes(ev.payload?.type)) {
      const entry=entries.get(ev.action.id);
      if(!entry) return;
      const job=themeQueue.then(()=>themeCommand(entry,ev.payload));
      themeQueue=job.catch(()=>{});
      try {await job;} catch(error) {await streamDeck.ui.sendToPropertyInspector({type:"error",message:(error as Error).message});}
    }
  }
  private async press(context: string,directionOverride?:1|-1): Promise<void> {
    const entry = entries.get(context);
    if (!entry || entry.busy) return;
    if (this.kind === "depth") { entry.peak = 0; entry.peakAt=undefined; entry.pressVersion++; render(entry); return; }
    if (this.kind === "current") { entry.pressVersion++;render(entry);await inventory(); return; }
    const device = selectedDevice(backend.devices, entry.settings.serial);
    if(device && pendingProfiles.has(device.serial)) return;
    try {
      if (!entry.settings.serial) throw new Error("Choose a keyboard in settings");
      if (!device?.ready || Date.now()-device.observedAt>2000) throw new Error("Keyboard disconnected");
      if (!device.writable) throw new Error("Firmware not validated");
      const direction=directionOverride ?? cycleDirection(entry.settings);
      const slots=this.kind === "cycle" ? cycleOrder(entry.settings.order) : [];
      const target=this.kind === "toggle" ? toggleTarget(device,entry.settings) : this.kind === "cycle" ? cycleTarget(device,slots,direction) : device.profiles.find(profile=>profile.slot===entry.settings.slot);
      if(!target) throw new Error("Choose a profile");
      if(this.kind === "select" && entry.settings.profileName && target.name!==entry.settings.profileName) throw new Error("Profile moved or renamed; select it again");
      pendingProfiles.set(device.serial,{owner:context,generation:device.generation,profile:target,direction});
      entry.pressVersion++;
      entry.busy = true; entry.error = undefined;
      for(const visible of entries.values()) {
        if(visible===entry) visible.error=undefined;
        render(visible);
      }
      if (this.kind === "select" || this.kind==="toggle") {
        await backend.request("activate", {serial: device.serial, generation: device.generation, slot: target.slot, expectedName: this.kind==="toggle"?target.name:entry.settings.profileName});
      } else {
        await backend.request("cycle", {serial: device.serial, generation: device.generation, direction, slots});
      }
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      entry.errorUntil = Date.now()+5000;
      await entry.action.showAlert();
      await streamDeck.ui.sendToPropertyInspector({type: "error", message: entry.error});
    } finally {
      entry.busy = false;
      if(device && pendingProfiles.get(device.serial)?.owner===context) pendingProfiles.delete(device.serial);
      for(const visible of entries.values()) render(visible);
    }
  }
}

@action({UUID: "com.firflabs.wootdeck.select"}) class SelectProfile extends WootAction { constructor() {super("select");} }
@action({UUID: "com.firflabs.wootdeck.cycle"}) class CycleProfiles extends WootAction { constructor() {super("cycle");} }
@action({UUID: "com.firflabs.wootdeck.toggle"}) class ToggleProfiles extends WootAction { constructor() {super("toggle");} }
@action({UUID: "com.firflabs.wootdeck.current"}) class CurrentProfile extends WootAction { constructor() {super("current");} }
@action({UUID: "com.firflabs.wootdeck.depth"}) class KeyDepth extends WootAction { constructor() {super("depth");} }

for (const instance of [new SelectProfile(), new CycleProfiles(), new ToggleProfiles(), new CurrentProfile(), new KeyDepth()]) streamDeck.actions.registerAction(instance);
let inventoryAt = 0;
let inspectorDepthSignature = "";
function updateDepthInspector(): void {
  const context=streamDeck.ui.action?.id;
  const entry=context?entries.get(context):undefined;
  if (!entry || entry.kind!=="depth" || entry.settings.keyMode!=="any") return;
  const device=selectedDevice(backend.devices,entry.settings.serial);
  let values=anyKeyDepth(backend.depth.get(device?.serial||""),device);
  if(values) try {values=filterAnyKeys(values,entry.settings);} catch {values=undefined;}
  const payload={type:"anyDepth",available:values!==undefined,keys:values?activeKeys(values).map(key=>({...key,display:formatDepth(key.value,entry.settings)})):[]};
  const signature=JSON.stringify([context,payload]);
  if (signature===inspectorDepthSignature) return;
  inspectorDepthSignature=signature;
  void streamDeck.ui.sendToPropertyInspector(payload).catch(()=>{});
}
backend.on("change", () => {
  for(const [context,hold] of cycleHolds) if(!sameHoldDevice(entries.get(context),hold)) cancelCycleHold(context);
  subscriptions();
  if (Date.now()-inventoryAt>500) { inventoryAt = Date.now(); void inventory().catch(() => {}); }
});
backend.on("diagnostic", message => streamDeck.logger.warn(message));
streamDeck.ui.onSendToPlugin(ev => {if((ev.payload as {type?:string})?.type==="refresh") void inventory().catch(() => {});});
streamDeck.settings.onDidReceiveGlobalSettings(ev=>{globalSettings=ev.settings;customThemes=loadDesigns(globalSettings.customThemes);globalsLoaded=true;void inventory().catch(()=>{});});
streamDeck.ui.onDidAppear(() => { inspectorDepthSignature=""; void inventory().catch(() => {}); });
setInterval(() => { for (const entry of entries.values()) render(entry); updateDepthInspector(); }, 1000/30).unref();
process.on("beforeExit", () => backend.stop());
process.on("SIGTERM", () => { backend.stop(); process.exit(0); });
process.on("SIGINT", () => { backend.stop(); process.exit(0); });
await streamDeck.connect();
globalsReady=Promise.race([streamDeck.settings.getGlobalSettings(),new Promise<never>((_,reject)=>{const timer=setTimeout(()=>reject(new Error("Global settings did not respond")),5000);timer.unref();})]).then(value=>{globalSettings=value;customThemes=loadDesigns(value.customThemes);globalsLoaded=true;void inventory().catch(()=>{});}).catch(error=>{streamDeck.logger.warn(`Custom Theme loading failed: ${String(error)}`);});
backend.start();
