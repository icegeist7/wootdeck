// SPDX-License-Identifier: GPL-3.0-or-later
use libloading::Library;
use std::{collections::BTreeMap, ffi::c_char, path::Path};
use crate::protocol::Result;

#[repr(C)]
struct DeviceInfo {
    vendor_id: u16,
    product_id: u16,
    manufacturer_name: *const c_char,
    device_name: *const c_char,
    device_id: u64,
    device_type: i32,
}

pub struct Analog {
    _library: Library,
    enumerate: unsafe extern "C" fn(*mut *mut DeviceInfo, u32) -> i32,
    read: unsafe extern "C" fn(u16, u64) -> f32,
    read_buffer: unsafe extern "C" fn(*mut u16, *mut f32, u32, u64) -> i32,
    uninitialize: unsafe extern "C" fn() -> i32,
}

impl Analog {
    pub fn load(path: &Path) -> Result<Self> {
        // Load only the DLL supplied beside the executable, never a search-path name.
        unsafe {
            let library = Library::new(path).map_err(|e|e.to_string())?;
            let version = *library.get::<unsafe extern "C" fn()->i32>(b"wooting_analog_version\0").map_err(|e|e.to_string())?;
            if version() != 0 { return Err("Unsupported Analog SDK ABI".into()); }
            let initialize = *library.get::<unsafe extern "C" fn()->i32>(b"wooting_analog_initialise\0").map_err(|e|e.to_string())?;
            let enumerate = *library.get(b"wooting_analog_get_connected_devices_info\0").map_err(|e|e.to_string())?;
            let read = *library.get(b"wooting_analog_read_analog_device\0").map_err(|e|e.to_string())?;
            let read_buffer = *library.get(b"wooting_analog_read_full_buffer_device\0").map_err(|e|e.to_string())?;
            let uninitialize = *library.get(b"wooting_analog_uninitialise\0").map_err(|e|e.to_string())?;
            let result = initialize();
            if result < 0 { return Err(format!("Analog SDK initialization: {result}")); }
            Ok(Self {_library: library, enumerate, read, read_buffer, uninitialize})
        }
    }

    pub fn device(&self, pid: u16) -> Result<u64> {
        unsafe {
            let mut pointers = [std::ptr::null_mut(); 16];
            let count = (self.enumerate)(pointers.as_mut_ptr(),16);
            if !(0..=16).contains(&count) { return Err(format!("SDK device enumeration: {count}")); }
            let matches: Vec<_> = pointers[..count as usize].iter().filter_map(|p| {
                let info = p.as_ref()?;
                (info.vendor_id==0x31e3 && info.product_id==pid).then_some(info.device_id)
            }).collect();
            if matches.len()!=1 { return Err("Analog device is missing or ambiguous".into()); }
            Ok(matches[0])
        }
    }

    pub fn read(&self, key: u16, device: u64) -> Result<f32> {
        let value = unsafe {(self.read)(key,device)};
        if !value.is_finite() || !(0.0..=1.0).contains(&value) { return Err(format!("Analog read error: {value}")); }
        Ok(value)
    }

    pub fn read_all(&self, device: u64, active: &mut BTreeMap<u16, f32>) -> Result<()> {
        let mut codes = [0u16; 512];
        let mut values = [0f32; 512];
        let count = unsafe {(self.read_buffer)(codes.as_mut_ptr(), values.as_mut_ptr(), codes.len() as u32, device)};
        if count < 0 { return Err(format!("Analog buffer error: {count}")); }
        if count as usize >= codes.len() { return Err("Analog buffer capacity exceeded".into()); }
        let updates: Vec<_> = codes[..count as usize].iter().copied().zip(values[..count as usize].iter().copied()).collect();
        merge_readings(active, &updates)
    }
}

// The SDK returns a zero-valued release once. An omitted code in a later
// incremental buffer must not erase another key that is still held.
fn merge_readings(active: &mut BTreeMap<u16, f32>, updates: &[(u16,f32)]) -> Result<()> {
    if updates.iter().any(|(_,value)|!value.is_finite() || !(0.0..=1.0).contains(value)) {
        return Err("Invalid analog buffer value".into());
    }
    for &(code,value) in updates {
        if value == 0.0 { active.remove(&code); } else { active.insert(code,value); }
    }
    if active.len() > 512 { return Err("Active key capacity exceeded".into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn simultaneous_keys_and_one_shot_releases_are_preserved() {
        let mut active=BTreeMap::new();
        merge_readings(&mut active,&[(26,0.5),(4,0.8)]).unwrap();
        merge_readings(&mut active,&[(26,0.6)]).unwrap();
        assert_eq!(active.get(&4),Some(&0.8));
        merge_readings(&mut active,&[(26,0.0)]).unwrap();
        merge_readings(&mut active,&[]).unwrap();
        assert!(!active.contains_key(&26));
        assert_eq!(active.get(&4),Some(&0.8));
    }
    #[test]
    fn invalid_buffer_does_not_publish_partial_updates() {
        let mut active=BTreeMap::from([(26,0.5)]);
        assert!(merge_readings(&mut active,&[(26,0.0),(4,f32::NAN)]).is_err());
        assert_eq!(active.get(&26),Some(&0.5));
    }
}

impl Drop for Analog {
    fn drop(&mut self) { unsafe { (self.uninitialize)(); } }
}
