//! FORGE Capture local PP-OCR pure decode/mapping logic (build slice
//! C2-P2).
//!
//! Plan: `results/chatgpt/capture-ai-caption-pipeline-implementation-brief-2026-10-26.md`
//! §2.2: "Use pinned PP-OCRv4 mobile detection plus script-specific
//! mobile recognition models exported to ONNX... Unsupported or
//! unavailable recognition is not treated as 'no sensitive text'.
//! Detected-but-unrecognized text regions are UNKNOWN_TEXT, require human
//! review or whole-region redaction."
//!
//! This module is the pure half of the OCR pipeline — everything that is
//! plain arithmetic/array scanning over already-produced model tensors,
//! with no ONNX Runtime, no image codec, and no filesystem access, so it
//! is testable on any host the same way the rest of this crate is. The
//! sidecar (`ai-sidecar/src/ocr_engine.rs`) owns image decode and the
//! actual ONNX inference calls; it hands this module the raw
//! probability-map/softmax tensors the models produced and gets back
//! source-pixel boxes and decoded text.
//!
//! ## Detection postprocessing — a deliberate, documented simplification
//!
//! The real DB (Differentiable Binarization) algorithm PaddleOCR uses
//! produces rotated/irregular polygons via a Vatti-clipping unclip step.
//! This slice's model pack ships only the mobile detector + recognizer
//! (brief §2.2's "Initial qualified pack"), not the angle-classification
//! model, and FORGE Capture's own screenshots are themselves ordinary
//! upright raster frames — so [`extract_text_boxes`] intentionally
//! produces **axis-aligned bounding boxes** via connected-component
//! extraction over the thresholded probability mask, dilated by an
//! `unclip_ratio` applied to each side rather than a true polygon offset.
//! This is strictly a detection-geometry simplification: it never affects
//! the safety semantics in §3 (every detected region still gets a box,
//! still flows through recognition, still fails closed to
//! [`RecognitionOutcome::Unknown`] rather than being dropped).
//!
//! ## CTC decode and the English/Latin dictionary
//!
//! [`ctc_greedy_decode`] implements PaddleOCR's own `CTCLabelDecode`
//! convention for this exact model pack: class index `0` is the CTC
//! blank; the loaded `en_dict.txt` (95 lines) occupies indices `1..=95`;
//! index `96` is a second, redundant space slot PaddleOCR's own
//! `use_space_char` config appends even though the dictionary file
//! already ends in a space line — both decode to the same `' '`
//! character, which is why [`build_character_table`] maps both. Decoding
//! is greedy (arg-max per timestep) with the standard CTC collapse rule:
//! consecutive repeats of the same raw class index collapse to one
//! emission, and blanks never emit anything.

use std::collections::HashSet;

use crate::coords::RectI;

// --- detection postprocessing -----------------------------------------

/// Brief §2.2 default DB thresholds (PaddleOCR's own published mobile
/// defaults): a pixel is "text" once its sigmoid probability clears
/// `prob_thresh`; a connected blob of such pixels is only kept as a
/// detected region once its own mean probability clears the stricter
/// `box_thresh` (filters low-confidence speckle a bare pixel threshold
/// would otherwise keep).
pub const DEFAULT_PROB_THRESH: f32 = 0.3;
pub const DEFAULT_BOX_THRESH: f32 = 0.6;
/// A connected blob narrower or shorter than this (in det-model pixel
/// space) is discarded as noise rather than a real glyph.
pub const DEFAULT_MIN_BOX_SIDE: usize = 3;
/// How far each side of a kept box is dilated outward — brief §3.1's
/// general "candidate boxes expand" principle applied to detection
/// geometry itself (expanding a tight glyph mask toward the true text
/// region), not the separate redaction-candidate expansion §3.1 also
/// describes downstream.
pub const DEFAULT_UNCLIP_RATIO: f32 = 1.5;

/// A detected text region in det-model probability-map pixel space,
/// before any crop/scale/rotation mapping back to source pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DetectedRegion {
    pub rect: RectI,
    /// Mean probability of pixels inside the *undilated* connected
    /// component — the detector's own confidence that this region is
    /// text, independent of whatever the recognizer later decodes.
    pub detection_score_milli: u32,
}

/// Extracts dilated axis-aligned text regions from a det model's
/// probability map (row-major, `width * height` floats, each already in
/// `[0,1]` — PP-OCRv3's own ONNX graph applies the sigmoid, see
/// `det_en_ppocrv3_mobile.onnx`'s `sigmoid_0.tmp_0` output). `map.len()`
/// must equal `width * height`; a mismatched length returns an empty
/// result rather than panicking or reading out of bounds, since a model
/// output shape is externally produced input this function must not
/// trust blindly.
pub fn extract_text_boxes(
    map: &[f32],
    width: usize,
    height: usize,
    prob_thresh: f32,
    box_thresh: f32,
    min_box_side: usize,
    unclip_ratio: f32,
) -> Vec<DetectedRegion> {
    if width == 0 || height == 0 || map.len() != width * height {
        return Vec::new();
    }

    let mut visited = vec![false; map.len()];
    let mut regions = Vec::new();

    for start in 0..map.len() {
        if visited[start] || map[start] < prob_thresh {
            continue;
        }
        // 4-connected flood fill (BFS) over pixels clearing `prob_thresh`.
        let mut stack = vec![start];
        visited[start] = true;
        let mut sum = 0.0f64;
        let mut count = 0usize;
        let (mut min_x, mut max_x) = (width, 0usize);
        let (mut min_y, mut max_y) = (height, 0usize);

        while let Some(idx) = stack.pop() {
            let x = idx % width;
            let y = idx / width;
            sum += map[idx] as f64;
            count += 1;
            min_x = min_x.min(x);
            max_x = max_x.max(x);
            min_y = min_y.min(y);
            max_y = max_y.max(y);

            let neighbors = [
                (x.checked_sub(1), Some(y)),
                (Some(x + 1).filter(|&v| v < width), Some(y)),
                (Some(x), y.checked_sub(1)),
                (Some(x), Some(y + 1).filter(|&v| v < height)),
            ];
            for (nx, ny) in neighbors {
                if let (Some(nx), Some(ny)) = (nx, ny) {
                    let nidx = ny * width + nx;
                    if !visited[nidx] && map[nidx] >= prob_thresh {
                        visited[nidx] = true;
                        stack.push(nidx);
                    }
                }
            }
        }

        let mean = (sum / count as f64) as f32;
        let box_w = max_x - min_x + 1;
        let box_h = max_y - min_y + 1;
        if mean < box_thresh || box_w < min_box_side || box_h < min_box_side {
            continue;
        }

        let dilate_x = (((unclip_ratio - 1.0) * box_w as f32) / 2.0).round().max(0.0) as i64;
        let dilate_y = (((unclip_ratio - 1.0) * box_h as f32) / 2.0).round().max(0.0) as i64;
        let dilated_x0 = (min_x as i64 - dilate_x).max(0);
        let dilated_y0 = (min_y as i64 - dilate_y).max(0);
        let dilated_x1 = ((max_x as i64 + 1) + dilate_x).min(width as i64);
        let dilated_y1 = ((max_y as i64 + 1) + dilate_y).min(height as i64);

        regions.push(DetectedRegion {
            rect: RectI {
                x: dilated_x0,
                y: dilated_y0,
                w: (dilated_x1 - dilated_x0).max(0) as u64,
                h: (dilated_y1 - dilated_y0).max(0) as u64,
            },
            detection_score_milli: (mean.clamp(0.0, 1.0) * 1000.0).round() as u32,
        });
    }

    regions
}

// --- CTC recognition decode --------------------------------------------

/// Builds the exact 97-entry character table this model pack's
/// recognizer uses: index 0 is the CTC blank (never emitted as text),
/// indices `1..=dict.len()` are `dict` in order, and one trailing
/// redundant space slot — see this module's doc comment for why the
/// dictionary file and this extra slot both map to `' '`.
pub fn build_character_table(dict: &[String]) -> Vec<Option<String>> {
    let mut table = Vec::with_capacity(dict.len() + 2);
    table.push(None); // index 0: blank
    for ch in dict {
        table.push(Some(ch.clone()));
    }
    table.push(Some(" ".to_string())); // trailing redundant space slot
    table
}

#[derive(Debug, Clone, PartialEq)]
pub struct DecodedText {
    pub text: String,
    /// Mean of the arg-max probability at each *emitted* (non-blank,
    /// non-repeat-collapsed) timestep. `0.0` for an empty decode (every
    /// timestep was blank or collapsed away).
    pub avg_confidence: f32,
}

/// Greedy CTC decode: for each timestep in `frames` (each a full
/// per-class probability vector, length `character_table.len()`),
/// arg-max to a class index, then collapse consecutive repeats and drop
/// blanks (class index `0`) per the standard CTC decode rule. A class
/// index at or beyond `character_table.len()`, or an empty/mismatched
/// frame, is treated as blank for that timestep rather than panicking —
/// model output is external input this function does not trust blindly.
pub fn ctc_greedy_decode(frames: &[Vec<f32>], character_table: &[Option<String>]) -> DecodedText {
    let mut text = String::new();
    let mut confidence_sum = 0.0f64;
    let mut emitted = 0usize;
    let mut prev_index: Option<usize> = None;

    for frame in frames {
        let (best_index, best_prob) = frame
            .iter()
            .enumerate()
            .fold((0usize, f32::MIN), |acc, (i, &p)| if p > acc.1 { (i, p) } else { acc });

        if prev_index == Some(best_index) {
            continue; // consecutive repeat of the same raw class: collapsed away
        }
        prev_index = Some(best_index);

        if best_index == 0 {
            continue; // CTC blank: never emits
        }
        if let Some(Some(ch)) = character_table.get(best_index) {
            text.push_str(ch);
            confidence_sum += best_prob as f64;
            emitted += 1;
        }
        // An out-of-range index (malformed model output) contributes no
        // character and no confidence, but does not abort the decode.
    }

    DecodedText { text, avg_confidence: if emitted == 0 { 0.0 } else { (confidence_sum / emitted as f64) as f32 } }
}

// --- fail-closed recognition classification ----------------------------

/// Below this mean per-character confidence, a decode is not trusted as
/// real recognized text — brief §2.2: "Unsupported or unavailable
/// recognition is not treated as 'no sensitive text'." A script this
/// English/Latin-only model pack cannot read at all (e.g. CJK, Arabic,
/// Cyrillic glyphs it was never trained on) characteristically produces
/// a diffuse, low-confidence class distribution rather than a clean
/// peak — this floor is how that shows up without this pack ever needing
/// to run its own separate script-identification model.
pub const UNSUPPORTED_RECOGNITION_CONFIDENCE_FLOOR: f32 = 0.25;

/// Sentinel text brief §2.2 requires for a detected-but-unrecognized
/// region: "Detected-but-unrecognized text regions are UNKNOWN_TEXT."
pub const UNKNOWN_TEXT_SENTINEL: &str = "UNKNOWN_TEXT";
/// BCP-47 "undetermined" — brief §2.3's own `language: "bcp-47-or-und"`.
pub const UNDETERMINED_LANGUAGE: &str = "und";
pub const SUPPORTED_LANGUAGE: &str = "en";

#[derive(Debug, Clone, PartialEq)]
pub enum RecognitionOutcome {
    Recognized { text: String, confidence: f32, language: String },
    Unknown { confidence: f32 },
}

/// Classifies a raw CTC decode into the fail-closed outcome brief §2.2
/// requires: an empty decode or one below
/// [`UNSUPPORTED_RECOGNITION_CONFIDENCE_FLOOR`] is never presented as "no
/// text here" — it becomes [`RecognitionOutcome::Unknown`], which the
/// sidecar maps to [`UNKNOWN_TEXT_SENTINEL`] rather than dropping the
/// region.
pub fn classify_recognition(decoded: &DecodedText) -> RecognitionOutcome {
    if decoded.text.is_empty() || decoded.avg_confidence < UNSUPPORTED_RECOGNITION_CONFIDENCE_FLOOR {
        RecognitionOutcome::Unknown { confidence: decoded.avg_confidence }
    } else {
        RecognitionOutcome::Recognized { text: decoded.text.clone(), confidence: decoded.avg_confidence, language: SUPPORTED_LANGUAGE.to_string() }
    }
}

/// True if every character in `text` is in `allowed` — a defense-in-depth
/// check: even a confident decode should never be able to contain a
/// character outside the loaded dictionary's own charset (the model's
/// softmax is closed over the dictionary table, so in practice this can
/// only fail on a caller-constructed [`DecodedText`], e.g. in a test —
/// but a real invariant is worth checking explicitly rather than only
/// ever holding by construction).
pub fn text_within_charset(text: &str, allowed: &HashSet<char>) -> bool {
    text.chars().all(|c| allowed.contains(&c))
}

// --- box coordinate mapping (scale / crop / rotation) ------------------

/// How the image region the det/rec models actually ran on relates to
/// the source frame's own pixel space. `resize_ratio_x`/`resize_ratio_y`
/// are independent (PP-OCR's own det preprocessing rounds each resized
/// dimension to the nearest multiple of 32 *after* applying one scalar
/// ratio, which recomputes to two slightly different per-axis ratios —
/// an isotropic single ratio would misplace boxes by a few pixels on
/// exactly the frame sizes this program captures most often). The
/// pre-resize pixel dimensions of the region (`region_w`/`region_h` — the
/// crop's or, in full-frame mode, the whole frame's own dimensions,
/// needed to invert a rotation), the region's own top-left offset within
/// the source frame (`(0,0)` for full-frame mode), and a 0/90/180/270
/// clockwise rotation needed to bring the region's own orientation into
/// the source frame's orientation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RegionMapping {
    pub resize_ratio_x: f64,
    pub resize_ratio_y: f64,
    pub region_w: f64,
    pub region_h: f64,
    pub region_origin_x: i64,
    pub region_origin_y: i64,
    pub rotation_deg: u16,
}

/// Rotates a point clockwise by `rotation_deg` (must be one of 0/90/180/
/// 270 — any other value is treated as 0, i.e. no rotation, rather than
/// panicking) around a region of size `w`×`h`, returning the point in the
/// *rotated* region's own coordinate space.
fn rotate_point_cw(x: f64, y: f64, w: f64, h: f64, rotation_deg: u16) -> (f64, f64) {
    match rotation_deg {
        90 => (h - y, x),
        180 => (w - x, h - y),
        270 => (y, w - x),
        _ => (x, y),
    }
}

/// Maps a detected box from det-model pixel space (the padded/resized
/// tensor the model actually saw) back to source-frame pixel space,
/// composing the inverse resize, the region's own rotation, and the
/// region's offset within the source frame, in that order. Only the
/// box's two opposite corners are transformed and then re-sorted into an
/// axis-aligned rectangle — correct for 0/90/180/270 rotations (each
/// maps axis-aligned boxes to axis-aligned boxes exactly); an arbitrary
/// angle would not preserve that and is out of this slice's scope (see
/// this module's doc comment).
pub fn map_region_box_to_source(region_box: RectI, mapping: &RegionMapping) -> RectI {
    let ratio_x = if mapping.resize_ratio_x > 0.0 { mapping.resize_ratio_x } else { 1.0 };
    let ratio_y = if mapping.resize_ratio_y > 0.0 { mapping.resize_ratio_y } else { 1.0 };

    let x1 = region_box.x as f64 / ratio_x;
    let y1 = region_box.y as f64 / ratio_y;
    let x2 = (region_box.x + region_box.w as i64) as f64 / ratio_x;
    let y2 = (region_box.y + region_box.h as i64) as f64 / ratio_y;

    let p1 = rotate_point_cw(x1, y1, mapping.region_w, mapping.region_h, mapping.rotation_deg);
    let p2 = rotate_point_cw(x2, y2, mapping.region_w, mapping.region_h, mapping.rotation_deg);

    let min_x = p1.0.min(p2.0);
    let max_x = p1.0.max(p2.0);
    let min_y = p1.1.min(p2.1);
    let max_y = p1.1.max(p2.1);

    RectI {
        x: min_x.round() as i64 + mapping.region_origin_x,
        y: min_y.round() as i64 + mapping.region_origin_y,
        w: (max_x - min_x).round().max(0.0) as u64,
        h: (max_y - min_y).round().max(0.0) as u64,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- extract_text_boxes ---

    fn flat_map(width: usize, height: usize, on_pixels: &[(usize, usize)], value: f32) -> Vec<f32> {
        let mut map = vec![0.0f32; width * height];
        for &(x, y) in on_pixels {
            map[y * width + x] = value;
        }
        map
    }

    #[test]
    fn extract_text_boxes_finds_nothing_in_a_blank_map() {
        let map = vec![0.0f32; 100 * 100];
        let regions = extract_text_boxes(&map, 100, 100, DEFAULT_PROB_THRESH, DEFAULT_BOX_THRESH, DEFAULT_MIN_BOX_SIDE, DEFAULT_UNCLIP_RATIO);
        assert!(regions.is_empty());
    }

    #[test]
    fn extract_text_boxes_returns_empty_for_a_mismatched_map_length_rather_than_panicking() {
        let map = vec![1.0f32; 5];
        let regions = extract_text_boxes(&map, 100, 100, DEFAULT_PROB_THRESH, DEFAULT_BOX_THRESH, DEFAULT_MIN_BOX_SIDE, DEFAULT_UNCLIP_RATIO);
        assert!(regions.is_empty());
    }

    #[test]
    fn extract_text_boxes_returns_empty_for_zero_dimensions() {
        let map: Vec<f32> = vec![];
        assert!(extract_text_boxes(&map, 0, 0, 0.3, 0.6, 3, 1.5).is_empty());
    }

    #[test]
    fn extract_text_boxes_finds_one_solid_confident_block() {
        let width = 40;
        let height = 40;
        let mut pixels = Vec::new();
        for y in 10..20 {
            for x in 10..25 {
                pixels.push((x, y));
            }
        }
        let map = flat_map(width, height, &pixels, 0.9);
        // No dilation, so the returned box is the exact block.
        let regions = extract_text_boxes(&map, width, height, 0.3, 0.6, 3, 1.0);
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].rect, RectI { x: 10, y: 10, w: 15, h: 10 });
        assert_eq!(regions[0].detection_score_milli, 900);
    }

    #[test]
    fn extract_text_boxes_unclip_ratio_dilates_each_side() {
        let width = 40;
        let height = 40;
        let mut pixels = Vec::new();
        for y in 10..20 {
            for x in 10..20 {
                pixels.push((x, y));
            }
        }
        let map = flat_map(width, height, &pixels, 0.9);
        // 10x10 block, unclip_ratio 1.4 -> dilate (0.4*10)/2 = 2px each side.
        let regions = extract_text_boxes(&map, width, height, 0.3, 0.6, 3, 1.4);
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].rect, RectI { x: 8, y: 8, w: 14, h: 14 });
    }

    #[test]
    fn extract_text_boxes_dilation_clips_to_the_map_bounds() {
        let width = 20;
        let height = 20;
        let mut pixels = Vec::new();
        for y in 0..5 {
            for x in 0..5 {
                pixels.push((x, y));
            }
        }
        let map = flat_map(width, height, &pixels, 0.9);
        let regions = extract_text_boxes(&map, width, height, 0.3, 0.6, 3, 3.0);
        assert_eq!(regions.len(), 1);
        assert_eq!(regions[0].rect.x, 0);
        assert_eq!(regions[0].rect.y, 0);
    }

    #[test]
    fn extract_text_boxes_discards_a_block_below_box_thresh() {
        let width = 40;
        let height = 40;
        let mut pixels = Vec::new();
        for y in 10..20 {
            for x in 10..20 {
                pixels.push((x, y));
            }
        }
        // Every pixel clears prob_thresh (0.3) but not box_thresh (0.6).
        let map = flat_map(width, height, &pixels, 0.4);
        let regions = extract_text_boxes(&map, width, height, 0.3, 0.6, 3, 1.0);
        assert!(regions.is_empty());
    }

    #[test]
    fn extract_text_boxes_discards_a_block_smaller_than_min_box_side() {
        let width = 40;
        let height = 40;
        let pixels = vec![(10, 10), (11, 10)]; // 2px wide, min_box_side 3
        let map = flat_map(width, height, &pixels, 0.9);
        let regions = extract_text_boxes(&map, width, height, 0.3, 0.6, 3, 1.0);
        assert!(regions.is_empty());
    }

    #[test]
    fn extract_text_boxes_finds_two_disjoint_blocks_separately() {
        let width = 60;
        let height = 20;
        let mut pixels = Vec::new();
        for y in 5..10 {
            for x in 5..10 {
                pixels.push((x, y));
            }
        }
        for y in 5..10 {
            for x in 40..45 {
                pixels.push((x, y));
            }
        }
        let map = flat_map(width, height, &pixels, 0.9);
        let regions = extract_text_boxes(&map, width, height, 0.3, 0.6, 3, 1.0);
        assert_eq!(regions.len(), 2);
    }

    #[test]
    fn extract_text_boxes_never_panics_on_an_all_noise_speckled_map() {
        let width = 50;
        let height = 50;
        let mut map = vec![0.0f32; width * height];
        for (i, v) in map.iter_mut().enumerate() {
            *v = if i % 2 == 0 { 0.95 } else { 0.0 };
        }
        // Checkerboard: every "on" pixel is isolated (no 4-connected
        // neighbor also on), so every component is 1x1 and filtered by
        // min_box_side - this must terminate and return empty, not hang
        // or panic on a pathological many-tiny-components input.
        let regions = extract_text_boxes(&map, width, height, 0.3, 0.6, 3, 1.0);
        assert!(regions.is_empty());
    }

    // --- build_character_table / ctc_greedy_decode ---

    fn test_dict() -> Vec<String> {
        vec!["A".to_string(), "B".to_string(), "C".to_string(), " ".to_string()]
    }

    #[test]
    fn build_character_table_has_blank_dict_then_one_redundant_space() {
        let table = build_character_table(&test_dict());
        assert_eq!(table.len(), test_dict().len() + 2);
        assert_eq!(table[0], None);
        assert_eq!(table[1], Some("A".to_string()));
        assert_eq!(table[4], Some(" ".to_string())); // the dict's own trailing space
        assert_eq!(table[5], Some(" ".to_string())); // the redundant extra slot
    }

    fn one_hot(index: usize, len: usize, confidence: f32) -> Vec<f32> {
        let mut v = vec![(1.0 - confidence) / (len.max(1) - 1).max(1) as f32; len];
        v[index] = confidence;
        v
    }

    #[test]
    fn ctc_greedy_decode_decodes_a_simple_sequence_with_no_repeats_or_blanks() {
        let table = build_character_table(&test_dict());
        let frames = vec![one_hot(1, table.len(), 0.9), one_hot(2, table.len(), 0.9), one_hot(3, table.len(), 0.9)];
        let decoded = ctc_greedy_decode(&frames, &table);
        assert_eq!(decoded.text, "ABC");
        assert!((decoded.avg_confidence - 0.9).abs() < 1e-4);
    }

    #[test]
    fn ctc_greedy_decode_collapses_consecutive_repeats() {
        let table = build_character_table(&test_dict());
        let frames = vec![one_hot(1, table.len(), 0.9), one_hot(1, table.len(), 0.9), one_hot(2, table.len(), 0.9)];
        let decoded = ctc_greedy_decode(&frames, &table);
        assert_eq!(decoded.text, "AB");
    }

    #[test]
    fn ctc_greedy_decode_blank_between_repeats_allows_a_doubled_letter() {
        let table = build_character_table(&test_dict());
        // A, blank, A -> "AA" (blank resets the repeat-collapse, the
        // standard CTC mechanism for encoding a doubled letter).
        let frames = vec![one_hot(1, table.len(), 0.9), one_hot(0, table.len(), 0.9), one_hot(1, table.len(), 0.9)];
        let decoded = ctc_greedy_decode(&frames, &table);
        assert_eq!(decoded.text, "AA");
    }

    #[test]
    fn ctc_greedy_decode_an_all_blank_sequence_decodes_to_empty() {
        let table = build_character_table(&test_dict());
        let frames = vec![one_hot(0, table.len(), 0.99); 5];
        let decoded = ctc_greedy_decode(&frames, &table);
        assert_eq!(decoded.text, "");
        assert_eq!(decoded.avg_confidence, 0.0);
    }

    #[test]
    fn ctc_greedy_decode_an_empty_frame_list_decodes_to_empty() {
        let table = build_character_table(&test_dict());
        let decoded = ctc_greedy_decode(&[], &table);
        assert_eq!(decoded.text, "");
        assert_eq!(decoded.avg_confidence, 0.0);
    }

    #[test]
    fn ctc_greedy_decode_ignores_an_out_of_range_class_index_without_panicking() {
        let table = build_character_table(&test_dict()); // len 6
        let mut oversized_frame = vec![0.0f32; 6];
        oversized_frame.push(0.0);
        // Make index 6 (out of range for `table`) the arg-max.
        let mut frame = vec![0.01f32; 7];
        frame[6] = 0.99;
        let decoded = ctc_greedy_decode(&[frame], &table);
        assert_eq!(decoded.text, "");
    }

    #[test]
    fn ctc_greedy_decode_redundant_space_slot_decodes_the_same_as_the_dict_space() {
        let table = build_character_table(&test_dict());
        let via_dict_space = ctc_greedy_decode(&[one_hot(4, table.len(), 0.8)], &table);
        let via_redundant_space = ctc_greedy_decode(&[one_hot(5, table.len(), 0.8)], &table);
        assert_eq!(via_dict_space.text, " ");
        assert_eq!(via_redundant_space.text, " ");
    }

    // --- classify_recognition ---

    #[test]
    fn classify_recognition_accepts_a_confident_nonempty_decode() {
        let decoded = DecodedText { text: "Hello".to_string(), avg_confidence: 0.8 };
        assert_eq!(
            classify_recognition(&decoded),
            RecognitionOutcome::Recognized { text: "Hello".to_string(), confidence: 0.8, language: "en".to_string() }
        );
    }

    #[test]
    fn classify_recognition_treats_an_empty_decode_as_unknown() {
        let decoded = DecodedText { text: "".to_string(), avg_confidence: 0.9 };
        assert_eq!(classify_recognition(&decoded), RecognitionOutcome::Unknown { confidence: 0.9 });
    }

    #[test]
    fn classify_recognition_treats_a_low_confidence_decode_as_unknown_even_if_nonempty() {
        // Simulates an unsupported script: the English-only recognizer
        // forces *some* output, but with diffuse, low confidence.
        let decoded = DecodedText { text: "x".to_string(), avg_confidence: 0.1 };
        assert_eq!(classify_recognition(&decoded), RecognitionOutcome::Unknown { confidence: 0.1 });
    }

    #[test]
    fn classify_recognition_accepts_exactly_at_the_confidence_floor() {
        let decoded = DecodedText { text: "ok".to_string(), avg_confidence: UNSUPPORTED_RECOGNITION_CONFIDENCE_FLOOR };
        assert!(matches!(classify_recognition(&decoded), RecognitionOutcome::Recognized { .. }));
    }

    // --- text_within_charset ---

    #[test]
    fn text_within_charset_accepts_only_allowed_characters() {
        let allowed: HashSet<char> = "ABC ".chars().collect();
        assert!(text_within_charset("AB C", &allowed));
        assert!(!text_within_charset("AB\u{4e2d}", &allowed)); // a CJK character
    }

    // --- map_region_box_to_source ---

    fn identity_mapping() -> RegionMapping {
        RegionMapping {
            resize_ratio_x: 1.0,
            resize_ratio_y: 1.0,
            region_w: 1000.0,
            region_h: 1000.0,
            region_origin_x: 0,
            region_origin_y: 0,
            rotation_deg: 0,
        }
    }

    #[test]
    fn map_region_box_to_source_is_identity_for_ratio_one_no_crop_no_rotation() {
        let region_box = RectI { x: 10, y: 20, w: 30, h: 40 };
        let mapped = map_region_box_to_source(region_box, &identity_mapping());
        assert_eq!(mapped, region_box);
    }

    #[test]
    fn map_region_box_to_source_divides_out_the_resize_ratio() {
        let mut mapping = identity_mapping();
        mapping.resize_ratio_x = 2.0;
        mapping.resize_ratio_y = 2.0;
        // Detected at 2x scale (model saw a 2x-upscaled region); box in
        // model space (20,40,60,80) should map back to (10,20,30,40).
        let region_box = RectI { x: 20, y: 40, w: 60, h: 80 };
        let mapped = map_region_box_to_source(region_box, &mapping);
        assert_eq!(mapped, RectI { x: 10, y: 20, w: 30, h: 40 });
    }

    #[test]
    fn map_region_box_to_source_handles_independent_x_and_y_ratios() {
        // PP-OCR's own round-to-32 det preprocessing step produces
        // slightly different per-axis ratios in practice - this is the
        // case an isotropic single ratio would get wrong.
        let mut mapping = identity_mapping();
        mapping.resize_ratio_x = 0.96;
        mapping.resize_ratio_y = 1.0666666666666667;
        let region_box = RectI { x: 0, y: 49, w: 384, h: 22 };
        let mapped = map_region_box_to_source(region_box, &mapping);
        assert_eq!(mapped, RectI { x: 0, y: 46, w: 400, h: 21 });
    }

    #[test]
    fn map_region_box_to_source_applies_the_crop_origin_offset() {
        let mut mapping = identity_mapping();
        mapping.region_origin_x = 500;
        mapping.region_origin_y = 300;
        let region_box = RectI { x: 10, y: 20, w: 30, h: 40 };
        let mapped = map_region_box_to_source(region_box, &mapping);
        assert_eq!(mapped, RectI { x: 510, y: 320, w: 30, h: 40 });
    }

    #[test]
    fn map_region_box_to_source_composes_ratio_and_crop_origin_together() {
        let mut mapping = identity_mapping();
        mapping.resize_ratio_x = 2.0;
        mapping.resize_ratio_y = 2.0;
        mapping.region_origin_x = 100;
        mapping.region_origin_y = 50;
        let region_box = RectI { x: 20, y: 40, w: 60, h: 80 };
        let mapped = map_region_box_to_source(region_box, &mapping);
        assert_eq!(mapped, RectI { x: 110, y: 70, w: 30, h: 40 });
    }

    #[test]
    fn map_region_box_to_source_rotation_90_canary() {
        let mut mapping = identity_mapping();
        mapping.region_w = 200.0;
        mapping.region_h = 100.0;
        mapping.rotation_deg = 90;
        // A box at the region's top-left corner, after a 90deg CW
        // rotation of a 200x100 region, lands at the new top-right
        // corner of the resulting 100x200 rotated space.
        let region_box = RectI { x: 0, y: 0, w: 10, h: 5 };
        let mapped = map_region_box_to_source(region_box, &mapping);
        assert_eq!(mapped, RectI { x: 95, y: 0, w: 5, h: 10 });
    }

    #[test]
    fn map_region_box_to_source_rotation_180_canary() {
        let mut mapping = identity_mapping();
        mapping.region_w = 200.0;
        mapping.region_h = 100.0;
        mapping.rotation_deg = 180;
        let region_box = RectI { x: 0, y: 0, w: 10, h: 5 };
        let mapped = map_region_box_to_source(region_box, &mapping);
        assert_eq!(mapped, RectI { x: 190, y: 95, w: 10, h: 5 });
    }

    #[test]
    fn map_region_box_to_source_rotation_270_canary() {
        let mut mapping = identity_mapping();
        mapping.region_w = 200.0;
        mapping.region_h = 100.0;
        mapping.rotation_deg = 270;
        let region_box = RectI { x: 0, y: 0, w: 10, h: 5 };
        let mapped = map_region_box_to_source(region_box, &mapping);
        assert_eq!(mapped, RectI { x: 0, y: 190, w: 5, h: 10 });
    }

    #[test]
    fn map_region_box_to_source_an_unrecognized_rotation_value_is_treated_as_zero() {
        let mut mapping = identity_mapping();
        mapping.rotation_deg = 45;
        let region_box = RectI { x: 10, y: 20, w: 30, h: 40 };
        let mapped = map_region_box_to_source(region_box, &mapping);
        assert_eq!(mapped, region_box);
    }

    #[test]
    fn map_region_box_to_source_zero_resize_ratio_falls_back_to_one_rather_than_dividing_by_zero() {
        let mut mapping = identity_mapping();
        mapping.resize_ratio_x = 0.0;
        mapping.resize_ratio_y = 0.0;
        let region_box = RectI { x: 10, y: 20, w: 30, h: 40 };
        let mapped = map_region_box_to_source(region_box, &mapping);
        assert_eq!(mapped, region_box);
    }
}
