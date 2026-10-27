// SPDX-License-Identifier: GPL-3.0-or-later
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod analog;
mod actuation;
mod protocol;

use hidapi::HidApi;
use protocol::{Keyboard, Profile, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{BTreeMap, HashMap}, io::{self, BufRead, Write}, sync::{Arc, Mutex, mpsc}, thread, time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use std::sync::atomic::{AtomicU64, Ordering};

const PROFILE_INTERVAL: Duration = Duration::from_secs(1);
const DISCOVERY_INTERVAL: Duration = Duration::from_secs(5);
const METADATA_INTERVAL: Duration = Duration::from_secs(60);
const DEPTH_INTERVAL: Duration = Duration::from_millis(50);
static DISCOVERIES: AtomicU64 = AtomicU64::new(0);
static DEPTH_SAMPLES: AtomicU64 = AtomicU64::new(0);

fn timestamp() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() }
fn output(value: Value) {
    let stdout = io::stdout();
    let mut out = stdout.lock();
    let _ = writeln!(out,"{value}");
    let _ = out.flush();
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all="camelCase")]
struct Device {
    serial: String,
    name: String,
    product_id: u16,
    firmware: String,
    generation: u64,
    ready: bool,
    writable: bool,
    active_slot: Option<u8>,
    profiles: Vec<Profile>,
    error: Option<String>,
    observed_at: u128,
    actuation: Option<Actuation>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all="camelCase")]
struct Actuation { profile_slot: u8, observed_at: u128, ratios: BTreeMap<u16,f32>, error: Option<String> }

#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase")]
struct Subscription { serial: String, keys: Vec<u16>, #[serde(default)] all_keys: bool, #[serde(default)] actuation: bool }
#[derive(Default)]
struct Shared { devices: Vec<Device>, subscriptions: Vec<Subscription>, stopped: bool }

#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
struct Request {
    v: u8,
    id: u64,
    op: String,
    serial: Option<String>,
    slot: Option<u8>,
    generation: Option<u64>,
    expected_name: Option<String>,
    direction: Option<i8>,
    slots: Option<Vec<u8>>,
    subscriptions: Option<Vec<Subscription>>,
}
struct Queued { request: Request, received: Instant }
struct OpenDevice { keyboard: Keyboard, generation: u64, metadata_at: Instant, actuation: Option<Actuation>, actuation_at: Option<Instant> }

fn reply(id: u64, result: Result<Value>) {
    match result {
        Ok(value)=>output(json!({"v":1,"id":id,"ok":true,"result":value})),
        Err(error)=>output(json!({"v":1,"id":id,"ok":false,"error":error})),
    }
}

fn choose_cycle(current: u8, slots: &[u8], direction: i8) -> Result<u8> {
    if slots.is_empty() || slots.len()>8 || ![-1,1].contains(&direction) {
        return Err("Invalid cycle order or direction".into());
    }
    let index = slots.iter().position(|s|*s==current);
    Ok(match index {
        Some(i) => slots[(i as isize+direction as isize).rem_euclid(slots.len() as isize) as usize],
        None if direction>0 => slots[0],
        None => *slots.last().unwrap(),
    })
}

fn execute(request: &Request, sessions: &mut HashMap<String,OpenDevice>, shared: &Arc<Mutex<Shared>>) -> Result<Value> {
    match request.op.as_str() {
        "list" => Ok(json!(shared.lock().unwrap().devices)),
        "stats" => Ok(json!({
            "commands":protocol::COMMANDS.load(Ordering::Relaxed),
            "currentReads":protocol::CURRENT_READS.load(Ordering::Relaxed),
            "metadataReads":protocol::METADATA_READS.load(Ordering::Relaxed),
            "timeouts":protocol::TIMEOUTS.load(Ordering::Relaxed),
            "discoveries":DISCOVERIES.load(Ordering::Relaxed),
            "depthSamples":DEPTH_SAMPLES.load(Ordering::Relaxed),
        })),
        "subscribe" => {
            let subs = request.subscriptions.clone().unwrap_or_default();
            if subs.len()>8 || subs.iter().any(|s|s.serial.len()>128 || s.keys.len()>32) {
                return Err("Too many subscriptions".into());
            }
            shared.lock().unwrap().subscriptions=subs;
            Ok(json!({}))
        },
        "refreshActuation" => {
            let serial=request.serial.as_ref().ok_or("Keyboard must be selected")?;
            let session=sessions.get_mut(serial).ok_or("Keyboard disconnected")?;
            if request.generation != Some(session.generation) { return Err("Keyboard session changed".into()); }
            // Coalesce clicks; never permit a UI refresh to become a HID flood.
            if session.actuation_at.is_some_and(|at|at.elapsed()<Duration::from_secs(5)) { return Ok(json!({})); }
            session.actuation_at=None;
            session.actuation=None;
            Ok(json!({}))
        },
        "activate" | "cycle" => {
            let serial=request.serial.as_ref().ok_or("Keyboard must be selected")?;
            let session=sessions.get_mut(serial).ok_or("Keyboard disconnected")?;
            if request.generation != Some(session.generation) { return Err("Keyboard session changed; press again".into()); }
            // Metadata is re-read before a write so stale settings cannot select a
            // different named profile after a user reorders onboard slots.
            session.keyboard.profiles=session.keyboard.metadata()?;
            session.metadata_at=Instant::now();
            let slot=if request.op=="cycle" {
                let slots=request.slots.clone().filter(|s|!s.is_empty()).unwrap_or_else(||session.keyboard.profiles.iter().map(|p|p.slot).collect());
                if slots.iter().any(|s|!session.keyboard.profiles.iter().any(|p|p.slot==*s)) { return Err("Cycle order contains a missing profile".into()); }
                choose_cycle(session.keyboard.current()?,&slots,request.direction.unwrap_or(1))?
            } else {
                let slot=request.slot.ok_or("Choose a profile")?;
                if let Some(name)=&request.expected_name {
                    if !session.keyboard.profiles.iter().any(|p|p.slot==slot && p.name==*name) {
                        return Err("Profile moved or renamed; select it again".into());
                    }
                }
                slot
            };
            let observed=session.keyboard.activate(slot)?;
            session.actuation=None; session.actuation_at=None;
            let mut state=shared.lock().unwrap();
            if let Some(device)=state.devices.iter_mut().find(|d|d.serial==*serial) {
                device.active_slot=Some(observed);
                device.actuation=None;
                device.observed_at=timestamp();
                device.profiles=session.keyboard.profiles.clone();
            }
            output(json!({"v":1,"event":"devices","devices":state.devices}));
            Ok(json!({"slot":observed,"generation":session.generation}))
        },
        "shutdown" => { shared.lock().unwrap().stopped=true; Ok(json!({})) },
        _=>Err("Unknown request operation".into()),
    }
}

fn poll(api: &mut HidApi, sessions: &mut HashMap<String,OpenDevice>, counter: &mut u64, subscriptions: &[Subscription]) -> Result<Vec<Device>> {
    let mut result=Vec::new();
    let mut seen=Vec::new();
    let mut counts=HashMap::new();
    for info in api.device_list().filter(|i|i.vendor_id()==0x31e3 && i.usage_page()==0xff55) {
        *counts.entry(info.serial_number().unwrap_or("").to_string()).or_insert(0usize)+=1;
    }
    for info in api.device_list().filter(|i|i.vendor_id()==0x31e3 && i.usage_page()==0xff55).take(8) {
        let serial=info.serial_number().unwrap_or("").to_string();
        let mut device=Device {serial:serial.clone(),name:info.product_string().unwrap_or("Wooting Keyboard").to_string(),product_id:info.product_id(), ..Default::default()};
        if serial.is_empty() || counts.get(&serial)!=Some(&1) {
            device.error=Some("Keyboard identity is missing or ambiguous".into());
            result.push(device);
            continue;
        }
        seen.push(serial.clone());
        let observed=(|| -> Result<()> {
            if !sessions.contains_key(&serial) {
                let handle=info.open_device(api).map_err(|e|e.to_string())?;
                let mut keyboard=Keyboard {device:handle,product_id:info.product_id(),firmware:Vec::new(),profiles:Vec::new()};
                keyboard.firmware=keyboard.command(1,0)?;
                keyboard.profiles=keyboard.metadata()?;
                *counter+=1;
                sessions.insert(serial.clone(),OpenDevice {keyboard,generation:*counter,metadata_at:Instant::now(),actuation:None,actuation_at:None});
            }
            let session=sessions.get_mut(&serial).unwrap();
            if session.metadata_at.elapsed()>=METADATA_INTERVAL {
                session.keyboard.profiles=session.keyboard.metadata()?;
                session.metadata_at=Instant::now();
            }
            device.active_slot=Some(session.keyboard.current()?);
            if subscriptions.iter().any(|sub|sub.serial==serial && sub.actuation) {
                let slot=device.active_slot.unwrap();
                let changed=session.actuation.as_ref().is_some_and(|a|a.profile_slot!=slot);
                if changed || session.actuation_at.is_none_or(|at|at.elapsed()>=METADATA_INTERVAL) {
                    session.actuation_at=Some(Instant::now());
                    let values=(|| -> Result<BTreeMap<u16,f32>> {
                        if device.product_id!=0x1230 || session.keyboard.firmware!=[2,14,2] {
                            return Err("Actuation readout is not validated for this model/firmware".into());
                        }
                        let base=session.keyboard.runtime_configuration(39)?;
                        let overrides=session.keyboard.runtime_configuration(49)?;
                        if session.keyboard.current()?!=slot { return Err("Profile changed during actuation read; refresh again".into()); }
                        actuation::decode(&base,&overrides)
                    })();
                    let (ratios,error)=match values {Ok(values)=>(values,None),Err(error)=>(BTreeMap::new(),Some(error))};
                    session.actuation=Some(Actuation {profile_slot:slot,observed_at:timestamp(),ratios,error});
                }
                device.actuation=session.actuation.clone();
            }
            device.firmware=session.keyboard.firmware.iter().map(u8::to_string).collect::<Vec<_>>().join(".");
            device.generation=session.generation;
            device.writable=device.product_id==0x1230 && session.keyboard.firmware==[2,14,2];
            device.profiles=session.keyboard.profiles.clone();
            device.ready=true;
            device.observed_at=timestamp();
            Ok(())
        })();
        if let Err(error)=observed { device.error=Some(error); sessions.remove(&serial); }
        result.push(device);
    }
    sessions.retain(|serial,_|seen.contains(serial));
    Ok(result)
}

fn telemetry(shared: Arc<Mutex<Shared>>) {
    let path=std::env::current_exe().unwrap().parent().unwrap().join("wooting_analog_sdk.dll");
    let mut sdk=None;
    let mut bound=Vec::new();
    let mut next_retry=Instant::now();
    let mut previous=String::new();
    let mut last_emit=Instant::now()-Duration::from_secs(1);
    let mut active_keys: HashMap<String, BTreeMap<u16,f32>> = HashMap::new();
    let mut sdk_devices=HashMap::new();
    let mut next_device_check=Instant::now();
    loop {
        let (stopped, devices, subs)={let state=shared.lock().unwrap();(state.stopped,state.devices.clone(),state.subscriptions.clone())};
        if stopped { break; }
        let mut wanted=BTreeMap::<String,(u64,u16,Vec<u16>,bool)>::new();
        for sub in subs {
            if let Some(device)=devices.iter().find(|d|d.serial==sub.serial && d.ready) {
                // SDK 0.9.1 identifies devices by PID and an opaque ID, so reject
                // multiple identical PIDs instead of merging their telemetry.
                if devices.iter().filter(|d|d.product_id==device.product_id).count()!=1 { continue; }
                let item=wanted.entry(device.serial.clone()).or_insert((device.generation,device.product_id,Vec::new(),false));
                item.2.extend(sub.keys);
                item.2.sort_unstable(); item.2.dedup();
                item.3 |= sub.all_keys;
            }
        }
        wanted.retain(|_,(_,_,keys,all_keys)|!keys.is_empty() || *all_keys);
        let identity:Vec<_>=wanted.iter().map(|(s,(g,_,_,all))|(s.clone(),*g,*all)).collect();
        if identity!=bound { sdk=None; bound=identity; next_retry=Instant::now(); previous.clear(); active_keys.clear(); sdk_devices.clear(); }
        if wanted.is_empty() { sdk=None; thread::sleep(Duration::from_millis(50)); continue; }
        let sampled=(|| -> Result<Value> {
            if sdk.is_none() {
                if Instant::now()<next_retry { return Err("Telemetry reconnecting".into()); }
                next_retry=Instant::now()+Duration::from_secs(1);
                sdk=Some(analog::Analog::load(&path)?);
                sdk_devices.clear();
                next_device_check=Instant::now();
            }
            let sdk=sdk.as_ref().unwrap();
            // SDK reads consume its memory cache, not HID feature reports.
            // Revalidate opaque IDs once a second, rather than for every sample.
            if Instant::now()>=next_device_check {
                sdk_devices.clear();
                for (_,pid,_,_) in wanted.values() { sdk_devices.insert(*pid,sdk.device(*pid)?); }
                next_device_check=Instant::now()+Duration::from_secs(1);
            }
            DEPTH_SAMPLES.fetch_add(1,Ordering::Relaxed);
            let mut values=serde_json::Map::new();
            for (serial,(generation,pid,keys,all_keys)) in &wanted {
                let device=*sdk_devices.get(pid).ok_or("Analog device is unavailable")?;
                let mut key_values=BTreeMap::new();
                if *all_keys {
                    let active=active_keys.entry(serial.clone()).or_default();
                    sdk.read_all(device,active)?;
                    key_values.extend(active.iter().map(|(key,value)|(key.to_string(),*value)));
                }
                for key in keys { key_values.insert(key.to_string(),sdk.read(*key,device)?); }
                values.insert(serial.clone(),json!({"generation":generation,"values":key_values,"allKeys":all_keys}));
            }
            Ok(json!({"v":1,"event":"depth","devices":values,"sampledAt":timestamp()}))
        })();
        let value=match sampled {
            Ok(value)=>value,
            Err(error)=>{sdk=None; active_keys.clear(); json!({"v":1,"event":"depthUnavailable","error":error})},
        };
        let comparable=if value["event"]=="depth" {value["devices"].to_string()} else {value.to_string()};
        if (comparable!=previous && last_emit.elapsed()>=Duration::from_millis(50)) || last_emit.elapsed()>=Duration::from_millis(500) {
            output(value); previous=comparable; last_emit=Instant::now();
        }
        thread::sleep(DEPTH_INTERVAL);
    }
}

fn main() {
    std::panic::set_hook(Box::new(|info|eprintln!("Native helper failed: {info}")));
    let shared=Arc::new(Mutex::new(Shared::default()));
    let (tx,rx)=mpsc::sync_channel::<Queued>(32);
    let input_shared=shared.clone();
    thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            let Ok(line)=line else {break};
            if line.len()>65536 { break; }
            match serde_json::from_str::<Request>(&line) {
                Ok(request) if request.v==1 => {
                    let id=request.id;
                    if tx.try_send(Queued {request,received:Instant::now()}).is_err() {reply(id,Err("Helper queue is busy".into()));}
                },
                _=>output(json!({"v":1,"event":"protocolError","error":"Invalid request"})),
            }
        }
        input_shared.lock().unwrap().stopped=true;
    });
    let depth_shared=shared.clone();
    let depth=thread::spawn(move||telemetry(depth_shared));
    output(json!({"v":1,"event":"hello","version":env!("CARGO_PKG_VERSION"),"native":true}));
    HidApi::disable_device_discovery();
    let mut api=match HidApi::new() {Ok(api)=>api,Err(error)=>{output(json!({"v":1,"event":"fatal","error":error.to_string()}));return;}};
    let mut sessions=HashMap::new();
    let mut generation=0;
    let mut next_poll=Instant::now();
    let mut next_discovery=Instant::now();
    while !shared.lock().unwrap().stopped {
        if depth.is_finished() {
            output(json!({"v":1,"event":"fatal","error":"Native telemetry worker stopped unexpectedly"}));
            break;
        }
        if Instant::now()>=next_poll {
            if Instant::now()>=next_discovery {
                // Enumerate only Wooting hardware; leave unrelated HID devices alone.
                DISCOVERIES.fetch_add(1,Ordering::Relaxed);
                let discovery=api.reset_devices().and_then(|_|api.add_devices(0x31e3,0));
                if let Err(error)=discovery { eprintln!("Keyboard discovery: {error}"); }
                next_discovery=Instant::now()+DISCOVERY_INTERVAL;
            }
            let subscriptions=shared.lock().unwrap().subscriptions.clone();
            match poll(&mut api,&mut sessions,&mut generation,&subscriptions) {
                Ok(devices)=>{shared.lock().unwrap().devices=devices.clone();output(json!({"v":1,"event":"devices","devices":devices}));},
                Err(error)=>{sessions.clear();shared.lock().unwrap().devices.clear();output(json!({"v":1,"event":"devices","devices":[],"error":error}));},
            }
            next_poll=Instant::now()+PROFILE_INTERVAL;
        }
        if let Ok(queued)=rx.recv_timeout(Duration::from_millis(20)) {
            let result=if queued.received.elapsed()>Duration::from_millis(1500) {Err("Request expired; press again".into())} else {execute(&queued.request,&mut sessions,&shared)};
            reply(queued.request.id,result);
        }
    }
    shared.lock().unwrap().stopped=true;
    if depth.join().is_err() {eprintln!("Telemetry worker failed");}
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cycles_wrap_and_handle_external_profiles() {
        assert_eq!(choose_cycle(3,&[0,1,3],1).unwrap(),0);
        assert_eq!(choose_cycle(0,&[0,1,3],-1).unwrap(),3);
        assert_eq!(choose_cycle(7,&[0,1,3],1).unwrap(),0);
        assert!(choose_cycle(0,&[],1).is_err());
    }
}
