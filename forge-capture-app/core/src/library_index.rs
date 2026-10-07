//! Rebuildable local library index — Slice 4 of 4.
//!
//! `library-index.json` is a **derived cache only**: rebuildable from disk
//! at any time, never the source of truth for anything a user typed. The
//! one thing that is NOT rebuilt-from-nothing is tags, because they are
//! user-authored: this module only *projects* tags that already live in
//! each capture's durable [`crate::capture_meta`] sidecar into the index.
//! Losing or deleting `library-index.json` never loses a tag -- rebuilding
//! reads every capture's own `.meta.json` again.
//!
//! Window-title indexing is **opt-in, off by default** (privacy). The
//! index -- and search over it -- works fully with titles entirely absent;
//! this module makes no assumption that `title` is ever present.
//!
//! Pure logic only; the Tauri shell scans the captures directory and reads
//! each capture's sidecars, then hands the results here to be shaped into
//! one deterministic index.

use serde::{Deserialize, Serialize};

pub const LIBRARY_INDEX_SCHEMA_VERSION: u32 = 1;

/// One capture's projection into the index. `title` is `None` whenever
/// title indexing is disabled OR the capture has no window title (a region
/// or fullscreen capture) -- the two cases are indistinguishable here by
/// design, since a caller with titles off must never learn anything about
/// whether a title *would* have existed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndexEntry {
    pub stem: String,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIndex {
    pub schema_version: u32,
    /// Whether this build of the index has titles at all -- read by the UI to explain an absent
    /// `title` field accurately ("title indexing is off", not "this capture has no title").
    pub title_indexing_enabled: bool,
    pub entries: Vec<LibraryIndexEntry>,
}

impl LibraryIndex {
    /// Builds a fresh, deterministic index from already-gathered entries: sorted by `stem`, so
    /// the same captures always produce the same bytes regardless of directory listing order.
    pub fn build(mut entries: Vec<LibraryIndexEntry>, title_indexing_enabled: bool) -> Self {
        entries.sort_by(|a, b| a.stem.cmp(&b.stem));
        LibraryIndex {
            schema_version: LIBRARY_INDEX_SCHEMA_VERSION,
            title_indexing_enabled,
            entries,
        }
    }

    pub fn to_json(&self) -> Result<String, String> {
        serde_json::to_string(self).map_err(|e| format!("library index JSON error: {e}"))
    }

    /// Every stem whose tags or title contain `query`, case-insensitively. A pure, read-only
    /// search over an already-built index -- callers needing fresher results rebuild first.
    pub fn search(&self, query: &str) -> Vec<&str> {
        let q = query.to_lowercase();
        if q.is_empty() {
            return self.entries.iter().map(|e| e.stem.as_str()).collect();
        }
        self.entries
            .iter()
            .filter(|e| {
                e.tags.iter().any(|t| t.to_lowercase().contains(&q))
                    || e.title
                        .as_ref()
                        .is_some_and(|t| t.to_lowercase().contains(&q))
            })
            .map(|e| e.stem.as_str())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(stem: &str, tags: &[&str], title: Option<&str>) -> LibraryIndexEntry {
        LibraryIndexEntry {
            stem: stem.to_string(),
            tags: tags.iter().map(|t| t.to_string()).collect(),
            title: title.map(|t| t.to_string()),
        }
    }

    #[test]
    fn build_sorts_entries_by_stem_regardless_of_input_order() {
        let index = LibraryIndex::build(
            vec![
                entry("c", &[], None),
                entry("a", &[], None),
                entry("b", &[], None),
            ],
            false,
        );
        assert_eq!(
            index
                .entries
                .iter()
                .map(|e| e.stem.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b", "c"]
        );
    }

    #[test]
    fn to_json_is_deterministic_for_the_same_input_regardless_of_order() {
        let a = LibraryIndex::build(vec![entry("b", &[], None), entry("a", &[], None)], false);
        let b = LibraryIndex::build(vec![entry("a", &[], None), entry("b", &[], None)], false);
        assert_eq!(a.to_json().unwrap(), b.to_json().unwrap());
    }

    #[test]
    fn title_is_omitted_from_json_when_absent() {
        let index = LibraryIndex::build(vec![entry("a", &[], None)], false);
        assert!(!index.to_json().unwrap().contains("\"title\""));
    }

    #[test]
    fn title_indexing_enabled_flag_round_trips() {
        let off = LibraryIndex::build(vec![], false);
        let on = LibraryIndex::build(vec![], true);
        assert!(!off
            .to_json()
            .unwrap()
            .contains("\"titleIndexingEnabled\":true"));
        assert!(on
            .to_json()
            .unwrap()
            .contains("\"titleIndexingEnabled\":true"));
    }

    #[test]
    fn search_matches_tags_case_insensitively() {
        let index = LibraryIndex::build(
            vec![
                entry("a", &["Safety", "pump"], None),
                entry("b", &["electrical"], None),
            ],
            false,
        );
        assert_eq!(index.search("safety"), vec!["a"]);
        assert_eq!(index.search("PUMP"), vec!["a"]);
        assert_eq!(index.search("electrical"), vec!["b"]);
        assert!(index.search("nothing-matches-this").is_empty());
    }

    #[test]
    fn search_matches_title_when_present() {
        let index = LibraryIndex::build(vec![entry("a", &[], Some("Save dialog"))], true);
        assert_eq!(index.search("save"), vec!["a"]);
    }

    #[test]
    fn an_empty_query_returns_every_entry() {
        let index = LibraryIndex::build(vec![entry("a", &[], None), entry("b", &[], None)], false);
        assert_eq!(index.search(""), vec!["a", "b"]);
    }

    #[test]
    fn search_works_fully_with_titles_entirely_absent() {
        // Privacy requirement: the library must be fully usable with title indexing off.
        let index = LibraryIndex::build(vec![entry("a", &["safety"], None)], false);
        assert_eq!(index.search("safety"), vec!["a"]);
    }
}
