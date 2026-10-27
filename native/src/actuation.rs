// SPDX-License-Identifier: GPL-3.0-or-later
//! Read-only profile decoding. SDK HID identifiers refer to the standard physical
//! layout, not the user's remapped output bindings.
use crate::protocol::Result;
use std::collections::{BTreeMap, BTreeSet};

fn varint(data: &[u8], offset: &mut usize) -> Result<u32> {
    let mut value = 0u32;
    for shift in (0..35).step_by(7) {
        let byte = *data.get(*offset).ok_or("Truncated profile varint")?;
        *offset += 1;
        if shift == 28 && byte > 15 { return Err("Profile varint overflow".into()); }
        value |= ((byte & 127) as u32) << shift;
        if byte & 128 == 0 { return Ok(value); }
    }
    Err("Invalid profile varint".into())
}

enum Value<'a> { Number(u32), Bytes(&'a [u8]), Ignored }
fn fields(data: &[u8]) -> Result<Vec<(u32, Value<'_>)>> {
    let mut offset = 0;
    let mut result = Vec::new();
    while offset < data.len() {
        let tag = varint(data, &mut offset)?;
        if tag >> 3 == 0 { return Err("Invalid profile field".into()); }
        let value = match tag & 7 {
            0 => Value::Number(varint(data, &mut offset)?),
            wire @ (1 | 2 | 5) => {
                let size = if wire == 2 { varint(data, &mut offset)? as usize } else if wire == 1 { 8 } else { 4 };
                let end = offset.checked_add(size).filter(|end| *end <= data.len()).ok_or("Truncated profile field")?;
                let bytes = &data[offset..end]; offset = end;
                if wire == 2 { Value::Bytes(bytes) } else { Value::Ignored }
            },
            _ => return Err("Unsupported profile wire type".into()),
        };
        result.push((tag >> 3, value));
    }
    Ok(result)
}
fn numbers(data: &[u8]) -> Result<Vec<u32>> {
    let mut result = Vec::new();
    for (field, value) in fields(data)? {
        if field != 1 { continue; }
        match value {
            Value::Number(value) => result.push(value),
            Value::Bytes(bytes) => {
                let mut offset = 0;
                while offset < bytes.len() { result.push(varint(bytes, &mut offset)?); }
            },
            _ => return Err("Invalid profile values".into()),
        }
    }
    Ok(result)
}
fn normalized(raw: u32) -> Option<f32> {
    if raw <= 255 { Some(raw as f32 / 255.0) }
    else if raw <= 65535 && raw >> 14 == 1 { Some((raw & 0x3fff) as f32 / 16383.0) }
    else { None } // Includes the unset sentinel; inherit the base actuation point.
}
fn point(raw: u32, default: f32) -> Result<f32> {
    if raw == 0xffff { return Ok(default); }
    normalized(raw).ok_or("Unsupported encoded actuation point".into())
}

// Two HE ARM standard physical matrix (six rows, 21 columns). Internal key
// identifiers 1..98 map to HID 4..101, 99..106 to HID modifiers 224..231.
// Never read the user's remap layer to identify a physical SDK key.
const TWO_HE: [&str; 6] = [
    "26ff3738393a3b3c3d3e3f404142434544e5e2e3e4",
    "321b1c1d1e1f20212223242a2b2746474850515354",
    "2811170512141915090f102c2d2e494a4b5d5e5f55",
    "360113040607080a0b0c30312e25ffffff5a5b5cff",
    "64611a180316020e0d333435ff68ff4fff57585956",
    "636665ff29ff29ff29ff696ae7674d4e4cff6052ff",
];

pub fn decode(base: &[u8], overrides: &[u8]) -> Result<BTreeMap<u16, f32>> {
    let mut default = None;
    for (field, value) in fields(base)? {
        if let (1, Value::Bytes(bytes)) = (field, value) {
            for (field, value) in fields(bytes)? {
                if let (1, Value::Number(raw)) = (field, value) { default = normalized(raw); }
            }
        }
    }
    let default = default.ok_or("Missing or unsupported base actuation point")?;
    let mut matrix = BTreeMap::new();
    for (form, value) in fields(overrides)? {
        let Value::Bytes(bytes) = value else { return Err("Invalid actuation profile".into()); };
        match form {
            2 | 4 => {
                for entry in numbers(bytes)? {
                    let position = entry & 255;
                    let raw = if form == 4 { entry >> 16 } else { (entry >> 8) & 255 };
                    if position >> 5 >= 6 || position & 31 >= 21 { return Err("Actuation position outside Two HE matrix".into()); }
                    matrix.insert(position, point(raw,default)?);
                }
            },
            1 | 3 => {
                let mut row = 0u32;
                for (field, value) in fields(bytes)? {
                    if field != 1 { continue; }
                    let Value::Bytes(bytes) = value else { return Err("Invalid actuation row".into()); };
                    let values = if form == 3 { numbers(bytes)? } else {
                        let mut values = Vec::new();
                        for (field, value) in fields(bytes)? {
                            if let (1, Value::Bytes(bytes)) = (field, value) { values.extend(bytes.iter().map(|v| *v as u32)); }
                        }
                        values
                    };
                    if row >= 6 || values.len() > 21 { return Err("Actuation matrix outside supported layout".into()); }
                    for (column, raw) in values.into_iter().enumerate() { matrix.insert(row << 5 | column as u32, point(raw,default)?); }
                    row += 1;
                }
            },
            _ => return Err("Unsupported actuation profile format".into()),
        }
    }
    let mut result = BTreeMap::new();
    let mut ambiguous = BTreeSet::new();
    for (row, keys) in TWO_HE.iter().enumerate() {
        for column in 0..21 {
            // The Two HE has one centered spacebar, not split-space positions.
            if row == 5 && (column == 4 || column == 8) { continue; }
            let internal = u16::from_str_radix(&keys[column*2..column*2+2], 16).unwrap();
            let hid = match internal { 1..=98 => internal + 3, 99..=106 => internal + 125, _ => continue };
            let value = *matrix.get(&((row as u32) << 5 | column as u32)).unwrap_or(&default);
            if let Some(previous) = result.insert(hid, value) {
                if previous != value { ambiguous.insert(hid); }
            }
        }
    }
    for key in ambiguous { result.remove(&key); }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn hex(text: &str) -> Vec<u8> { (0..text.len()).step_by(2).map(|i|u8::from_str_radix(&text[i..i+2],16).unwrap()).collect() }
    #[test]
    fn captured_profile_uses_per_key_values_and_global_fallback() {
        let values = decode(&hex("0a140880a0011001180020e68c012801300238014802"), &hex("22200a1ec280808006e180808006e280808006e380808006a181fcff06a681808006")).unwrap();
        for hid in [26,4,22,7] { assert!((values[&hid]-0.5).abs()<0.001); }
        assert!((values[&44]-0.5).abs()<0.001);
        assert!((values[&225]-0.25).abs()<0.001); // Unset override inherits base.
    }
    #[test]
    fn rejects_truncation_and_unsupported_base() {
        assert!(decode(&[10,9], &[]).is_err());
        assert!(decode(&hex("0a0408808004"), &[]).is_err());
        assert!(decode(&hex("0a040880a001"), &[34,4,10]).is_err());
        assert_eq!(normalized(255),Some(1.0));
        assert_eq!(normalized(0x4000),Some(0.0));
        assert_eq!(normalized(0x7fff),Some(1.0));
        assert_eq!(normalized(0xffff),None);
    }
    #[test]
    fn supports_full_and_partial_legacy_and_encoded_matrices() {
        let base=hex("0a040880a001");
        // Row 0, column 0 is Escape. Packed and unpacked uint32 rows.
        for overrides in ["0a050a030a017f", "1a070a050a0380a001", "1a060a040880a001", "12050a0380fe01", "22070a058080808005"] {
            let values=decode(&base,&hex(overrides)).unwrap();
            assert!(values[&41]>0.24 && values[&41]<0.51);
        }
        assert!(decode(&base,&hex("22070a058080808008")).is_err());
        assert_eq!(point(0xffff,0.25).unwrap(),0.25);
        assert!(point(0x8000,0.25).is_err());
    }
}
