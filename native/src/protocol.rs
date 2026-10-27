// SPDX-License-Identifier: GPL-3.0-or-later
use hidapi::HidDevice;
use serde::Serialize;
use std::time::{Duration, Instant};
use std::sync::atomic::{AtomicU64, Ordering};

// Aggregate traffic only; never record key codes or analog values.
pub static COMMANDS: AtomicU64 = AtomicU64::new(0);
pub static CURRENT_READS: AtomicU64 = AtomicU64::new(0);
pub static METADATA_READS: AtomicU64 = AtomicU64::new(0);
pub static TIMEOUTS: AtomicU64 = AtomicU64::new(0);

pub type Result<T> = std::result::Result<T, String>;

pub fn decode(bytes: &[u8], command: u8) -> Result<Vec<u8>> {
    let sizes = [0, 33, 63, 255, 511, 1023, 2047];
    if bytes.len() < 7 || !(1..=6).contains(&bytes[0]) {
        return Err("Invalid ARM report".into());
    }
    if bytes[1..4] != [0xd1, 0xda, command] {
        return Err("Mismatched command response".into());
    }
    if bytes[4] != 0x88 {
        return Err(format!("Command {command} returned status {:02x}", bytes[4]));
    }
    let length = u16::from_le_bytes([bytes[5], bytes[6]]) as usize;
    if 7 + length > bytes.len().min(sizes[bytes[0] as usize]) {
        return Err("Truncated ARM payload".into());
    }
    Ok(bytes[7..7 + length].to_vec())
}

#[derive(Clone, Debug, Serialize)]
pub struct Profile {
    pub slot: u8,
    pub name: String,
}

pub struct Keyboard {
    pub device: HidDevice,
    pub product_id: u16,
    pub firmware: Vec<u8>,
    pub profiles: Vec<Profile>,
}

impl Keyboard {
    pub fn command(&self, command: u8, slot: u8) -> Result<Vec<u8>> {
        if ![1, 11, 23, 33, 38, 39, 49, 55].contains(&command) || slot >= 8 {
            return Err("Command or slot outside allowed range".into());
        }
        self.exchange([1, 0xd1, 0xda, command, slot, 0, 0, 0])
    }

    pub fn runtime_configuration(&self, command: u8) -> Result<Vec<u8>> {
        if ![39,49].contains(&command) { return Err("Not a runtime configuration read".into()); }
        // Optional-profile sentinel selects live RAM, including Wootility edits
        // not yet saved to an onboard profile. Never use a stored-slot fallback.
        self.exchange([1,0xd1,0xda,command,0xff,0xff,0,0])
    }

    fn exchange(&self, packet: [u8;8]) -> Result<Vec<u8>> {
        let command=packet[3];
        COMMANDS.fetch_add(1, Ordering::Relaxed);
        if command == 11 { CURRENT_READS.fetch_add(1, Ordering::Relaxed); }
        if command == 55 { METADATA_READS.fetch_add(1, Ordering::Relaxed); }
        self.device.send_feature_report(&packet).map_err(|e| e.to_string())?;
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(1) {
            let remaining = Duration::from_secs(1).saturating_sub(started.elapsed());
            let mut buffer = [0; 2047];
            let count = self.device.read_timeout(&mut buffer, remaining.as_millis().max(1) as i32).map_err(|e| e.to_string())?;
            if count == 0 { break; }
            if count >= 4 && buffer[1..4] == packet[1..4] {
                return decode(&buffer[..count], command);
            }
        }
        TIMEOUTS.fetch_add(1, Ordering::Relaxed);
        Err(format!("HID command {command} timed out"))
    }

    pub fn current(&self) -> Result<u8> {
        self.command(11, 0)?.first().copied().ok_or("Missing active profile".into())
    }

    pub fn metadata(&self) -> Result<Vec<Profile>> {
        let mut profiles = Vec::new();
        for slot in 0..8 {
            let data = self.command(55, slot)?;
            if data.is_empty() { break; }
            if data.len() < 2 || data[0] != 0x0a || data[1] >= 128 || 2 + data[1] as usize > data.len() {
                return Err("Unsupported profile metadata".into());
            }
            profiles.push(Profile {slot, name: String::from_utf8(data[2..2+data[1] as usize].to_vec()).map_err(|e|e.to_string())?});
        }
        Ok(profiles)
    }

    pub fn activate(&self, slot: u8) -> Result<u8> {
        if self.product_id != 0x1230 || self.firmware != [2, 14, 2] {
            return Err("Profile writes are not validated for this model/firmware".into());
        }
        if !self.profiles.iter().any(|p| p.slot == slot) {
            return Err("Selected profile no longer exists".into());
        }
        self.command(33, 0)?;
        self.command(23, slot)?;
        std::thread::sleep(Duration::from_millis(100));
        self.command(38, slot)?;
        std::thread::sleep(Duration::from_millis(100));
        let observed = self.current()?;
        if observed != slot { return Err(format!("Profile changed: requested {slot}, observed {observed}")); }
        Ok(observed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn runtime_profile_follows_length_prefix() {
        assert_eq!(decode(&[1,0xd1,0xda,11,0x88,2,0,1,0],11).unwrap(),[1,0]);
    }
    #[test]
    fn accepts_metadata_report_id_and_rejects_bad_bounds() {
        assert_eq!(decode(&[2,0xd1,0xda,55,0x88,2,0,0x0a,0],55).unwrap(),[0x0a,0]);
        assert!(decode(&[1,0xd1,0xda,55,0x88,40,0],55).is_err());
        assert!(decode(&[1,0xd1,0xda,55,0x66,0,0],55).is_err());
        assert!(decode(&[1,0xd1,0xda,1,0x88,0,0],11).is_err());
    }
}
