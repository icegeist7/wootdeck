// SPDX-License-Identifier: GPL-3.0-or-later
import type {DepthDisplay} from "./depth-display.js";
import type {Appearance} from "./themes.js";
import type {AnimationOptions} from "./animation.js";

export type Profile = { slot: number; name: string };
export type Keyboard = {
  serial: string; name: string; productId: number; firmware: string;
  generation: number; ready: boolean; writable: boolean;
  actuation?: {profileSlot:number; observedAt:number; ratios:Record<string,number>; error?:string|null}|null;
  activeSlot: number | null; profiles: Profile[]; error: string | null; observedAt: number;
};
export type Depth = { generation: number; values: Record<string, number>; sampledAt: number; allKeys?: boolean };
export type Settings = DepthDisplay & Appearance & AnimationOptions & {
  schemaVersion?: number; serial?: string; slot?: number; profileName?: string;
  key?: number; keyMode?: "single" | "custom" | "any"; keyLabel?: string; direction?: number; order?: string; label?: string;
  toggleSlotA?:number; toggleSlotB?:number; toggleNameA?:string; toggleNameB?:string;
  longDirection?:number; longPressMs?:number;
};
export type Kind = "select" | "cycle" | "toggle" | "current" | "depth";

export function cycleDirection(settings:Settings,long=false):1|-1 {
  const short=settings.direction===-1?-1:1;
  return long ? settings.longDirection===1?1:settings.longDirection===-1?-1:short===1?-1:1 : short;
}
export function longPressMs(settings:Settings):number {
  const value=settings.longPressMs;
  return typeof value==="number" && Number.isFinite(value)?Math.max(200,Math.min(2000,value)):500;
}

export function selectedDevice(devices: Keyboard[], serial?: string): Keyboard | undefined {
  if (serial) return devices.find(d => d.serial === serial);
  return devices.length === 1 ? devices[0] : undefined;
}

export function cycleOrder(text: string | undefined): number[] {
  if (!text?.trim()) return [];
  const parts = text.split(",").map(part => part.trim());
  if (parts.length > 8 || parts.some(p => !/^[1-8]$/.test(p))) throw new Error("Cycle order must contain slots 1–8 separated by commas");
  const slots = parts.map(p => Number(p) - 1);
  if (new Set(slots).size !== slots.length) throw new Error("Cycle order contains duplicate slots");
  return slots;
}

export function cycleTarget(device: Keyboard, slots: number[], direction: number): Profile {
  const order=slots.length?slots:device.profiles.map(profile=>profile.slot);
  if(!order.length || order.some(slot=>!device.profiles.some(profile=>profile.slot===slot))) throw new Error("Cycle order contains a missing profile");
  const index=order.indexOf(device.activeSlot ?? -1);
  const step=direction===-1?-1:1;
  const slot=index<0 ? (step===1?order[0]:order.at(-1)) : order[(index+step+order.length)%order.length];
  return device.profiles.find(profile=>profile.slot===slot)!;
}

export function toggleTarget(device:Keyboard,settings:Settings):Profile {
  const a=device.profiles.find(profile=>profile.slot===settings.toggleSlotA);
  const b=device.profiles.find(profile=>profile.slot===settings.toggleSlotB);
  if(!a || !b || a.slot===b.slot) throw new Error("Choose two different profiles");
  if((settings.toggleNameA && a.name!==settings.toggleNameA) || (settings.toggleNameB && b.name!==settings.toggleNameB)) throw new Error("Profile moved or renamed; select it again");
  return device.activeSlot===a.slot?b:a;
}

export function validDepth(depth: Depth | undefined, device: Keyboard | undefined, key: number, now = Date.now()): number | undefined {
  if (!device?.ready || !depth || depth.generation !== device.generation || now-depth.sampledAt>1500) return undefined;
  const value = depth.values[String(key)];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

export function anyKeyDepth(depth: Depth | undefined, device: Keyboard | undefined, now = Date.now()): Record<string, number> | undefined {
  if (!device?.ready || !depth?.allKeys || depth.generation !== device.generation || now-depth.sampledAt>1500) return undefined;
  if (Object.values(depth.values).some(value => !Number.isFinite(value) || value<0 || value>1)) return undefined;
  return Object.fromEntries(Object.entries(depth.values).filter(([,value])=>value>0));
}

export function configuredActuation(device:Keyboard|undefined,now=Date.now()):Record<string,number>|undefined {
  const config=device?.actuation;
  if(!device?.ready || now-device.observedAt>2000 || !config || config.error || config.profileSlot!==device.activeSlot || now-config.observedAt>75000) return;
  return config.ratios;
}
