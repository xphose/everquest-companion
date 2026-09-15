//! One immutable app-selected wiki pack for every knowledge and fold consumer.
//! A requested pack that cannot be verified refuses startup; only an absent selection uses
//! the embedded fallback. The engine never guesses a cache directory or fetches the network.

use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::OnceLock;

const MAX_BYTES: u64 = 160 * 1024 * 1024;
static SELECTED: OnceLock<Result<Option<Value>, &'static str>> = OnceLock::new();

fn load() -> Result<Option<Value>, &'static str> {
    let path = std::env::var_os("EQC_WIKI_CATALOG_PATH");
    let generation = std::env::var("EQC_WIKI_CATALOG_GENERATION").ok();
    let digest = std::env::var("EQC_WIKI_CATALOG_SHA256").ok();
    if path.is_none() && generation.is_none() && digest.is_none() {
        return Ok(None);
    }
    let path = path.ok_or("wiki catalog selection has no path")?;
    let generation = generation.ok_or("wiki catalog selection has no generation")?;
    let digest = digest.ok_or("wiki catalog selection has no digest")?;
    if !Path::new(&path).is_absolute() {
        return Err("wiki catalog path must be absolute");
    }
    let file = File::open(path).map_err(|_| "selected wiki catalog is unavailable")?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "selected wiki catalog could not be read")?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("selected wiki catalog exceeds its size limit");
    }
    if format!("{:x}", Sha256::digest(&bytes)) != digest {
        return Err("selected wiki catalog digest does not match the app");
    }
    let pack: Value =
        serde_json::from_slice(&bytes).map_err(|_| "selected wiki catalog is not valid JSON")?;
    validate(&pack, &generation)?;
    Ok(Some(pack))
}

fn validate(pack: &Value, generation: &str) -> Result<(), &'static str> {
    if pack["schemaVersion"] != 1 || pack["generation"].as_str() != Some(generation) {
        return Err("selected wiki catalog version does not match the app");
    }
    let items = pack["items"]["items"]
        .as_object()
        .ok_or("wiki item catalog is invalid")?;
    let mobs = pack["mobs"]["mobs"]
        .as_array()
        .ok_or("wiki mob catalog is invalid")?;
    let quests = pack["quests"]["quests"]
        .as_array()
        .ok_or("wiki quest catalog is invalid")?;
    if !items.values().all(|item| item["page"].is_string()) {
        return Err("wiki item record is invalid");
    }
    if !mobs
        .iter()
        .chain(quests)
        .all(|row| row["page"].is_string() && row["name"].is_string())
    {
        return Err("wiki mob or quest record is invalid");
    }
    Ok(())
}

/// Verify the whole app-selected pack before announcing engine readiness.
pub fn initialize() -> Result<(), &'static str> {
    SELECTED
        .get_or_init(load)
        .as_ref()
        .map(|_| ())
        .map_err(|why| *why)
}

/// Read one section from the process-pinned pack, or its embedded bundled fallback.
/// All callers share the same selection, including catalogs initialized after a refresh.
pub fn json(section: &str, bundled: &str) -> Value {
    match SELECTED.get_or_init(load) {
        Ok(Some(pack)) => pack[section].clone(),
        Ok(None) => serde_json::from_str(bundled).expect("bundled wiki catalog is readable"),
        Err(why) => panic!("wiki catalog initialization failed: {why}"),
    }
}
