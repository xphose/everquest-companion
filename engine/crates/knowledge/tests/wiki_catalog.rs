//! Separate processes test the once-per-engine catalog selection without global env races.
use fold::knowledge::{Knowledge, NoOwnLoot};
use knowledge::Corpus;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn cached_wiki_updates_items_mobs_quests_and_resist_together() {
    let bytes = serde_json::to_vec(&json!({
        "schemaVersion": 1, "generation": "synthetic-refresh",
        "items": {"items": {"synthetic charm": {"page": "Synthetic Charm", "summary": "Fresh catalog evidence"}}},
        "mobs": {"mobs": [{"page": "Synthetic Keeper", "name": "Synthetic Keeper", "level": "17", "drops": ["Synthetic Charm"]}]},
        "quests": {"quests": [{"page": "Synthetic Errand", "name": "Synthetic Errand", "requiredItems": ["Synthetic Charm"], "relatedNpcs": ["Synthetic Keeper"]}]}
    })).unwrap();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let directory =
        std::env::temp_dir().join(format!("eqc-wiki-rust-{}-{nonce}", std::process::id()));
    fs::create_dir(&directory).unwrap();
    let path = directory.join("pack.json");
    fs::write(&path, &bytes).unwrap();
    let digest = format!("{:x}", Sha256::digest(&bytes));
    for mode in ["valid", "mismatch", "corrupt", "missing"] {
        fs::write(
            &path,
            if mode == "corrupt" {
                b"invalid JSON".as_slice()
            } else {
                &bytes
            },
        )
        .unwrap();
        let selected_digest = if mode == "corrupt" {
            format!("{:x}", Sha256::digest(b"invalid JSON"))
        } else {
            digest.clone()
        };
        let output = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "selected_catalog_probe", "--nocapture"])
            .env("EQC_WIKI_TEST_PROBE", mode)
            .env(
                "EQC_WIKI_CATALOG_PATH",
                if mode == "missing" {
                    directory.join("missing.json")
                } else {
                    path.clone()
                },
            )
            .env(
                "EQC_WIKI_CATALOG_GENERATION",
                if mode == "mismatch" {
                    "other"
                } else {
                    "synthetic-refresh"
                },
            )
            .env("EQC_WIKI_CATALOG_SHA256", selected_digest)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{mode}: {} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn selected_catalog_probe() {
    let Ok(mode) = std::env::var("EQC_WIKI_TEST_PROBE") else {
        return;
    };
    if mode != "valid" {
        assert!(
            fold::reference_catalog::initialize().is_err(),
            "invalid selected pack must not fall back to embedded data"
        );
        return;
    }
    fold::reference_catalog::initialize().unwrap();
    // After initialization even a later disk change cannot switch lazily constructed indexes.
    fs::write(
        std::env::var_os("EQC_WIKI_CATALOG_PATH").unwrap(),
        b"changed after initialization",
    )
    .unwrap();
    let corpus = Corpus::new();
    let item = corpus.item("Synthetic Charm");
    assert!(item.found);
    assert_eq!(item.record["summary"], "Fresh catalog evidence");
    let mob = corpus.mob("Synthetic Keeper", &NoOwnLoot);
    assert!(mob.found);
    assert_eq!(mob.record["dropsWiki"][0]["item"], "Synthetic Charm");
    assert_eq!(
        corpus.search("Synthetic Errand", Some("quest"), None)["total"],
        1
    );
    assert_eq!(
        fold::modules::resist::catalog::local_mob_entry("Synthetic Keeper"),
        Some(Some("17"))
    );
    assert!(corpus.take_misses().is_empty());
}
