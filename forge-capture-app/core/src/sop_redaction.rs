//! FORGE Capture Phase 2 — deterministic hard-positive detection,
//! candidate box binding, redaction, and verification (build slice
//! C2-P3).
//!
//! Plan: `results/chatgpt/capture-ai-caption-pipeline-implementation-brief-2026-10-26.md`
//! §3. Round 1 ([`detect_context_free`]) covers the **context-free** rule
//! families: ones a matcher can confirm from the matched text alone,
//! with no nearby label or UI evidence required (email, SSN/ITIN,
//! Luhn-valid payment card, JWT, PEM private-key blocks, AWS access-key
//! IDs, GitHub token families). Round 2 ([`join_tokens`],
//! [`bind_matches_to_candidates`], [`apply_candidate_redactions`],
//! [`verify_pixel_proof`]/[`verify_removal_proof`]/[`verify_coverage_proof`],
//! [`compute_frame_verification`]) maps those byte-offset matches onto
//! real [`crate::sop_session::OcrToken`] boxes, performs the destructive
//! solid-fill redaction, and verifies it. Round 3
//! ([`detect_context_dependent`]) adds the rule families that need a
//! nearby label: bearer/basic auth headers, Cookie/Set-Cookie header
//! values, sensitive key/value forms (which also covers URI query/
//! fragment values — same shape), OTP/PIN, ABA routing number, and
//! account number.
//!
//! Brief §3.3's structural/UI evidence pass has two halves. The
//! UI-Automation half ([`structural_candidates_from_uia`], a hard
//! positive for password-protected elements during live process
//! training) is a separate, independently-routed branch and is not
//! present in this file. This file's own structural pass is the
//! image-only half: [`structural_candidates_from_image_rects`] locates
//! input-like rectangles by bounded pixel-level contour/edge detection
//! over an RGBA buffer, for frames with no (trustworthy) UIA evidence at
//! all. It is pure geometry, so its candidates default to
//! [`crate::sop_session::Disposition::Pending`]/`STRUCTURAL_UNKNOWN`,
//! never an auto-`Redact` hard positive — see that function's own doc
//! comment for the full reasoning.
//!
//! Still outstanding, separate follow-up rounds of this same slice:
//! phone/address (review-candidate-only, needs the review-candidate
//! disposition machinery and NER agreement this slice doesn't have
//! yet); combining the image-rect/UIA structural signals with
//! OCR/masked-glyph evidence and nearby labels and resolving
//! disagreement (brief §3.3's full requirement — this needs the same
//! kind of agreement machinery phone/address escalation is waiting on);
//! and merging overlapping/adjacent *painted* regions that span both the
//! context-free and context-dependent detector lists together (today's
//! [`redaction_regions_for_frame`] takes whichever candidate list a
//! caller gives it, so this already works once a caller combines both
//! lists — nothing left to build there). See the C2-P3 filings in
//! `forge-ai-drop/results/claude/`.
//!
//! **Bounded, linear-time, no caller-provided regex** (brief §3.2's lead
//! sentence): every matcher here is a single hand-rolled forward scan
//! over the normalized text, O(n) in its length. This crate adds no
//! pattern-matching dependency for this slice — the brief's dependency/
//! supply-chain gate (§9) lists only C2-P2/P4/P5, not C2-P3.
//!
//! **Unicode normalization retains exact source offsets** (brief §3.2):
//! [`normalize`] builds a parallel table from each kept normalized
//! character back to its exact original byte range, so every match
//! reported by a detector — however many Unicode variant characters it
//! absorbed — maps back to real source-text byte offsets a caller can
//! bind to OCR token boxes. Zero-width characters are dropped outright
//! (not merely folded) so an adversarial zero-width-space insertion
//! cannot split a hard-positive shape into two innocuous-looking halves.

/// One kept character of normalized text, plus the exact byte range in the
/// original source string it came from.
#[derive(Debug, Clone, Copy)]
struct NormalizedChar {
    ch: char,
    source_start: usize,
    source_end: usize,
}

/// Folds one source character for matching purposes. `None` means the
/// character is dropped entirely (zero-width characters) rather than kept
/// as a normalized stand-in — dropping, not translating, is what defeats
/// zero-width-insertion evasion between the two halves of a hard-positive
/// shape.
fn fold_char(ch: char) -> Option<char> {
    match ch {
        // Zero-width characters: dropped, never kept as a character.
        '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{FEFF}' | '\u{2060}' => None,
        // Unicode dash/hyphen/minus variants -> ascii hyphen.
        '\u{2010}'..='\u{2015}' | '\u{2212}' | '\u{FE63}' | '\u{FF0D}' => Some('-'),
        // Unicode space variants -> ascii space.
        '\u{00A0}' | '\u{2000}'..='\u{200A}' | '\u{202F}' | '\u{205F}' | '\u{3000}' => Some(' '),
        // Full-width digits -> ascii digits.
        '\u{FF10}'..='\u{FF19}' => char::from_u32(ch as u32 - 0xFF10 + '0' as u32),
        // Smart quotes -> ascii quotes (for later key/value-form matching).
        '\u{2018}' | '\u{2019}' => Some('\''),
        '\u{201C}' | '\u{201D}' => Some('"'),
        other => Some(other),
    }
}

fn normalize(text: &str) -> Vec<NormalizedChar> {
    let mut out = Vec::with_capacity(text.len());
    for (start, ch) in text.char_indices() {
        let end = start + ch.len_utf8();
        if let Some(folded) = fold_char(ch) {
            out.push(NormalizedChar { ch: folded, source_start: start, source_end: end });
        }
    }
    out
}

/// A single detector hit, reported in original source-text byte offsets
/// (half-open: `[start_byte, end_byte)`), ready for a caller to bind to
/// the OCR tokens whose boxes fall inside that byte range and construct a
/// `RedactionCandidate` (brief §4) — that binding is a follow-up round of
/// this slice, not this module's job.
#[derive(Debug, Clone, PartialEq)]
pub struct DeterministicMatch {
    pub start_byte: usize,
    pub end_byte: usize,
    /// Stable detector identity, brief §3.1 `detector_id`.
    pub rule_id: &'static str,
    /// Stable machine-readable reason code, brief §3.2 "every matcher has
    /// ... a reason code."
    pub reason_code: &'static str,
    /// `None` for every rule in this module: each is a deterministic
    /// shape/checksum hard positive, never a probabilistic score. Brief
    /// §4 `RedactionCandidate.score` is `Option<f32>` precisely so a
    /// deterministic hit can omit one.
    pub score: Option<f32>,
}

fn is_ascii_digit(c: char) -> bool {
    c.is_ascii_digit()
}

/// Runs every context-free rule in this module over `text` and returns
/// every hit, in source-byte order. Overlapping hits from different rules
/// are both reported — union/merge into [`crate::sop_session::RedactionCandidate`]
/// boxes is a follow-up round's job, not this scan's.
pub fn detect_context_free(text: &str) -> Vec<DeterministicMatch> {
    let norm = normalize(text);
    let mut out = Vec::new();
    detect_email(&norm, &mut out);
    detect_ssn_itin(&norm, &mut out);
    detect_payment_card(&norm, &mut out);
    detect_jwt(&norm, &mut out);
    detect_pem_private_key(&norm, &mut out);
    detect_aws_access_key_id(&norm, &mut out);
    detect_github_token(&norm, &mut out);
    out.sort_by_key(|m| m.start_byte);
    out
}

fn bytes_of(norm: &[NormalizedChar], start_idx: usize, end_idx: usize) -> (usize, usize) {
    (norm[start_idx].source_start, norm[end_idx - 1].source_end)
}

// ---------------------------------------------------------------------
// Email: local-part/domain syntax, bounded lengths, dotted or allowlisted
// local domain (brief §3.2).
// ---------------------------------------------------------------------

const EMAIL_ALLOWLISTED_SINGLE_LABEL_DOMAINS: &[&str] = &["localhost"];
const EMAIL_LOCAL_MAX: usize = 64;
const EMAIL_DOMAIN_MAX: usize = 255;
const EMAIL_LABEL_MAX: usize = 63;

fn is_email_local_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '%' | '+' | '-')
}

fn detect_email(norm: &[NormalizedChar], out: &mut Vec<DeterministicMatch>) {
    let n = norm.len();
    let mut i = 0;
    while i < n {
        if norm[i].ch == '@' && i > 0 {
            // Walk the local part backward from just before '@'.
            let mut local_start = i;
            while local_start > 0 && is_email_local_char(norm[local_start - 1].ch) {
                local_start -= 1;
            }
            let local_len = i - local_start;
            if local_len == 0 || local_len > EMAIL_LOCAL_MAX {
                i += 1;
                continue;
            }
            // local part may not start or end with '.'
            if norm[local_start].ch == '.' || norm[i - 1].ch == '.' {
                i += 1;
                continue;
            }
            // Walk the domain part forward from just after '@'.
            let domain_start = i + 1;
            let mut j = domain_start;
            let mut labels: Vec<(usize, usize)> = Vec::new();
            let mut label_start = domain_start;
            while j < n {
                let c = norm[j].ch;
                if c.is_ascii_alphanumeric() || c == '-' {
                    j += 1;
                } else if c == '.' {
                    labels.push((label_start, j));
                    j += 1;
                    label_start = j;
                } else {
                    break;
                }
            }
            if label_start < j {
                labels.push((label_start, j));
            }
            let domain_end = j;
            let domain_len = domain_end - domain_start;
            let valid_labels = !labels.is_empty()
                && labels.iter().all(|&(s, e)| {
                    let len = e - s;
                    len > 0
                        && len <= EMAIL_LABEL_MAX
                        && norm[s].ch != '-'
                        && norm[e - 1].ch != '-'
                });
            let dotted = labels.len() >= 2;
            let allowlisted_single_label = labels.len() == 1 && {
                let (s, e) = labels[0];
                let text: String = norm[s..e].iter().map(|c| c.ch).collect();
                EMAIL_ALLOWLISTED_SINGLE_LABEL_DOMAINS.contains(&text.to_ascii_lowercase().as_str())
            };
            if valid_labels && domain_len > 0 && domain_len <= EMAIL_DOMAIN_MAX && (dotted || allowlisted_single_label) {
                let (start_byte, end_byte) = bytes_of(norm, local_start, domain_end);
                out.push(DeterministicMatch {
                    start_byte,
                    end_byte,
                    rule_id: "det.email",
                    reason_code: "EMAIL_ADDRESS",
                    score: None,
                });
                i = domain_end;
                continue;
            }
        }
        i += 1;
    }
}

// ---------------------------------------------------------------------
// SSN / ITIN: nine digits, optionally grouped 3-2-4 by a consistent
// separator, excluding known-invalid area/group/serial patterns (brief
// §3.2).
// ---------------------------------------------------------------------

fn detect_ssn_itin(norm: &[NormalizedChar], out: &mut Vec<DeterministicMatch>) {
    let n = norm.len();
    let mut i = 0;
    while i < n {
        if is_ascii_digit(norm[i].ch) {
            if let Some((end_idx, digits)) = read_nine_digit_shape(norm, i) {
                let area: u32 = digits[0..3].parse().unwrap();
                let group: u32 = digits[3..5].parse().unwrap();
                let serial: u32 = digits[5..9].parse().unwrap();
                let shape_valid = ssn_shape_is_valid(area, group, serial) || itin_shape_is_valid(area, group);
                if shape_valid {
                    let (start_byte, end_byte) = bytes_of(norm, i, end_idx);
                    let is_itin = area >= 900;
                    out.push(DeterministicMatch {
                        start_byte,
                        end_byte,
                        rule_id: if is_itin { "det.itin" } else { "det.ssn" },
                        reason_code: if is_itin { "ITIN_SHAPE" } else { "SSN_SHAPE" },
                        score: None,
                    });
                    i = end_idx;
                    continue;
                }
            }
        }
        i += 1;
    }
}

/// Reads a `DDD-DD-DDDD`, `DDD DD DDDD`, or `DDDDDDDDD` shape starting at
/// `start` (one consistent separator — either `-`, ` `, or none — used at
/// both internal boundaries, never mixed). Returns the index just past
/// the shape and the nine digits as a string, or `None`.
fn read_nine_digit_shape(norm: &[NormalizedChar], start: usize) -> Option<(usize, String)> {
    let n = norm.len();
    let mut digits = String::with_capacity(9);
    let mut idx = start;
    let groups = [3usize, 2, 4];
    let mut separator: Option<char> = None;
    for (gi, &glen) in groups.iter().enumerate() {
        for _ in 0..glen {
            if idx >= n || !is_ascii_digit(norm[idx].ch) {
                return None;
            }
            digits.push(norm[idx].ch);
            idx += 1;
        }
        if gi < groups.len() - 1 {
            if idx >= n {
                return None;
            }
            let c = norm[idx].ch;
            match separator {
                None if c == '-' || c == ' ' => {
                    separator = Some(c);
                    idx += 1;
                }
                None if is_ascii_digit(c) => {
                    separator = Some('\0'); // no separator variant
                }
                Some('\0') => { /* no separator consumed, digits continue directly */ }
                Some(sep) if sep == c => idx += 1,
                _ => return None,
            }
        }
    }
    // Reject if immediately followed or preceded by another digit (not a
    // bounded 9-digit shape but a longer run of digits).
    if idx < n && is_ascii_digit(norm[idx].ch) {
        return None;
    }
    if start > 0 && is_ascii_digit(norm[start - 1].ch) {
        return None;
    }
    Some((idx, digits))
}

fn ssn_shape_is_valid(area: u32, group: u32, serial: u32) -> bool {
    area != 0 && area != 666 && !(900..=999).contains(&area) && group != 0 && serial != 0
}

/// ITIN: area in 900-999, and the "group" (digits 4-5) in one of the
/// IRS-documented ranges 70-88, 90-92, or 94-99 (excludes 89 and 93, which
/// are not issued).
fn itin_shape_is_valid(area: u32, group: u32) -> bool {
    (900..=999).contains(&area)
        && ((70..=88).contains(&group) || (90..=92).contains(&group) || (94..=99).contains(&group))
}

// ---------------------------------------------------------------------
// Payment card: 13-19 digits allowing spaces/hyphens between digits, only
// when Luhn-valid (brief §3.2).
// ---------------------------------------------------------------------

fn detect_payment_card(norm: &[NormalizedChar], out: &mut Vec<DeterministicMatch>) {
    let n = norm.len();
    let mut i = 0;
    while i < n {
        if is_ascii_digit(norm[i].ch) && (i == 0 || !is_ascii_digit(norm[i - 1].ch)) {
            // Greedily consume the longest run of digits/spaces/hyphens
            // that starts and ends on a digit.
            let mut j = i;
            let mut last_digit_idx = i;
            let mut digit_count = 0usize;
            while j < n {
                let c = norm[j].ch;
                if is_ascii_digit(c) {
                    digit_count += 1;
                    last_digit_idx = j;
                    j += 1;
                } else if (c == ' ' || c == '-') && digit_count > 0 {
                    j += 1;
                } else {
                    break;
                }
                if digit_count > 19 {
                    break;
                }
            }
            let end_idx = last_digit_idx + 1;
            let digits: String = norm[i..end_idx].iter().map(|c| c.ch).filter(|c| c.is_ascii_digit()).collect();
            if (13..=19).contains(&digits.len()) && luhn_is_valid(&digits) {
                let (start_byte, end_byte) = bytes_of(norm, i, end_idx);
                out.push(DeterministicMatch {
                    start_byte,
                    end_byte,
                    rule_id: "det.payment_card",
                    reason_code: "PAYMENT_CARD_LUHN_VALID",
                    score: None,
                });
                i = end_idx;
                continue;
            }
        }
        i += 1;
    }
}

fn luhn_is_valid(digits: &str) -> bool {
    let mut sum = 0u32;
    let mut double = false;
    for c in digits.chars().rev() {
        let mut d = c.to_digit(10).unwrap();
        if double {
            d *= 2;
            if d > 9 {
                d -= 9;
            }
        }
        sum += d;
        double = !double;
    }
    sum.is_multiple_of(10)
}

// ---------------------------------------------------------------------
// JWT: three base64url segments with decodable header/payload bounds
// (brief §3.2).
// ---------------------------------------------------------------------

fn is_base64url_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '-' || c == '_'
}

fn base64url_decode(segment: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut rank = [255u8; 256];
    for (i, &b) in TABLE.iter().enumerate() {
        rank[b as usize] = i as u8;
    }
    let bytes = segment.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4 + 3);
    let mut buf: u32 = 0;
    let mut bits = 0u32;
    for &b in bytes {
        let r = rank[b as usize];
        if r == 255 {
            return None;
        }
        buf = (buf << 6) | r as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
        }
    }
    Some(out)
}

/// A JWT has exactly 3 segments; once a scan has already found this many
/// it can never become a valid JWT, so [`detect_jwt`] stops consuming
/// further segments immediately rather than scanning the rest of a long
/// dot-chain (C2P3-006: a prior version kept consuming unboundedly, and
/// since every base64url run's start position independently re-triggers
/// this scan — each one re-reading the *same* remaining dot-chain the
/// previous start position already read — that made the whole function
/// quadratic in the number of segments on an adversarial input like many
/// repeated `"aaaa."` runs).
const JWT_MAX_SEGMENTS_BEFORE_BAILOUT: usize = 3;

fn detect_jwt(norm: &[NormalizedChar], out: &mut Vec<DeterministicMatch>) {
    let n = norm.len();
    let mut i = 0;
    while i < n {
        if is_base64url_char(norm[i].ch) && (i == 0 || !is_base64url_char(norm[i - 1].ch)) {
            let mut j = i;
            let mut dot_positions: Vec<(usize, usize)> = Vec::with_capacity(JWT_MAX_SEGMENTS_BEFORE_BAILOUT);
            let mut too_many_segments = false;
            loop {
                let seg_start = j;
                while j < n && is_base64url_char(norm[j].ch) {
                    j += 1;
                }
                if j == seg_start {
                    break;
                }
                if dot_positions.len() == JWT_MAX_SEGMENTS_BEFORE_BAILOUT {
                    // A 4th segment exists: this starting position
                    // cannot be a 3-segment JWT. Stop scanning now
                    // rather than consuming the rest of a potentially
                    // very long dot-chain.
                    too_many_segments = true;
                    break;
                }
                let has_more = j < n && norm[j].ch == '.';
                dot_positions.push((seg_start, j));
                if has_more {
                    j += 1;
                } else {
                    break;
                }
            }
            if !too_many_segments && dot_positions.len() == JWT_MAX_SEGMENTS_BEFORE_BAILOUT {
                let header: String = norm[dot_positions[0].0..dot_positions[0].1].iter().map(|c| c.ch).collect();
                let payload: String = norm[dot_positions[1].0..dot_positions[1].1].iter().map(|c| c.ch).collect();
                let signature_len = dot_positions[2].1 - dot_positions[2].0;
                let header_ok = (4..=1024).contains(&header.len())
                    && base64url_decode(&header).map(|b| !b.is_empty() && b[0] == b'{').unwrap_or(false);
                let payload_ok = (4..=8192).contains(&payload.len()) && base64url_decode(&payload).is_some();
                let signature_ok = signature_len >= 4;
                if header_ok && payload_ok && signature_ok {
                    let (start_byte, end_byte) = bytes_of(norm, i, dot_positions[2].1);
                    out.push(DeterministicMatch {
                        start_byte,
                        end_byte,
                        rule_id: "det.jwt",
                        reason_code: "JWT_SHAPE",
                        score: None,
                    });
                    i = dot_positions[2].1;
                    continue;
                }
            }
        }
        i += 1;
    }
}

// ---------------------------------------------------------------------
// PEM private-key headers through matching footers (brief §3.2).
// ---------------------------------------------------------------------

const PEM_BEGIN: &str = "-----BEGIN ";
const PEM_END: &str = "-----END ";
const PEM_MARKER_CLOSE: &str = "-----";
const PEM_MAX_LABEL_LEN: usize = 64;
const PEM_MAX_BODY_CHARS: usize = 64 * 1024;

fn normalized_starts_with(norm: &[NormalizedChar], idx: usize, needle: &str) -> bool {
    let chars: Vec<char> = needle.chars().collect();
    if idx + chars.len() > norm.len() {
        return false;
    }
    norm[idx..idx + chars.len()].iter().map(|c| c.ch).eq(chars)
}

fn detect_pem_private_key(norm: &[NormalizedChar], out: &mut Vec<DeterministicMatch>) {
    let n = norm.len();
    let mut i = 0;
    while i < n {
        if normalized_starts_with(norm, i, PEM_BEGIN) {
            let label_start = i + PEM_BEGIN.chars().count();
            let mut label_end = label_start;
            while label_end < n && label_end - label_start <= PEM_MAX_LABEL_LEN && !normalized_starts_with(norm, label_end, PEM_MARKER_CLOSE)
            {
                label_end += 1;
            }
            if label_end < n && normalized_starts_with(norm, label_end, PEM_MARKER_CLOSE) {
                let label: String = norm[label_start..label_end].iter().map(|c| c.ch).collect();
                if label.ends_with("PRIVATE KEY") && !label.is_empty() {
                    let header_marker_end = label_end + PEM_MARKER_CLOSE.chars().count();
                    let footer_needle = format!("{PEM_END}{label}{PEM_MARKER_CLOSE}");
                    let search_limit = (header_marker_end + PEM_MAX_BODY_CHARS).min(n);
                    let mut k = header_marker_end;
                    let mut found_footer_end = None;
                    while k < search_limit {
                        if normalized_starts_with(norm, k, &footer_needle) {
                            found_footer_end = Some(k + footer_needle.chars().count());
                            break;
                        }
                        k += 1;
                    }
                    if let Some(end_idx) = found_footer_end {
                        let (start_byte, end_byte) = bytes_of(norm, i, end_idx);
                        out.push(DeterministicMatch {
                            start_byte,
                            end_byte,
                            rule_id: "det.pem_private_key",
                            reason_code: "PEM_PRIVATE_KEY_BLOCK",
                            score: None,
                        });
                        i = end_idx;
                        continue;
                    }
                }
            }
        }
        i += 1;
    }
}

// ---------------------------------------------------------------------
// AWS access-key IDs: AKIA/ASIA plus 16 uppercase/digit chars (brief
// §3.2).
// ---------------------------------------------------------------------

fn detect_aws_access_key_id(norm: &[NormalizedChar], out: &mut Vec<DeterministicMatch>) {
    let n = norm.len();
    const PREFIXES: &[&str] = &["AKIA", "ASIA"];
    let mut i = 0;
    while i < n {
        let mut matched_prefix = false;
        for prefix in PREFIXES {
            if normalized_starts_with(norm, i, prefix) {
                matched_prefix = true;
                break;
            }
        }
        if matched_prefix && (i == 0 || !is_identifier_char(norm[i - 1].ch)) {
            let body_start = i + 4;
            let mut j = body_start;
            while j < n && j - body_start < 16 && (norm[j].ch.is_ascii_uppercase() || norm[j].ch.is_ascii_digit()) {
                j += 1;
            }
            let body_len = j - body_start;
            let boundary_ok = j >= n || !is_identifier_char(norm[j].ch);
            if body_len == 16 && boundary_ok {
                let (start_byte, end_byte) = bytes_of(norm, i, j);
                out.push(DeterministicMatch {
                    start_byte,
                    end_byte,
                    rule_id: "det.aws_access_key_id",
                    reason_code: "AWS_ACCESS_KEY_ID",
                    score: None,
                });
                i = j;
                continue;
            }
        }
        i += 1;
    }
}

fn is_identifier_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

// ---------------------------------------------------------------------
// GitHub token families: documented prefixes, bounded payload length
// (brief §3.2).
// ---------------------------------------------------------------------

const GITHUB_TOKEN_PREFIXES: &[(&str, &str)] = &[
    ("ghp_", "det.github_token_classic_pat"),
    ("gho_", "det.github_token_oauth"),
    ("ghu_", "det.github_token_user_to_server"),
    ("ghs_", "det.github_token_server_to_server"),
    ("ghr_", "det.github_token_refresh"),
    ("github_pat_", "det.github_token_fine_grained_pat"),
];
const GITHUB_TOKEN_PAYLOAD_MIN: usize = 20;
const GITHUB_TOKEN_PAYLOAD_MAX: usize = 255;

fn detect_github_token(norm: &[NormalizedChar], out: &mut Vec<DeterministicMatch>) {
    let n = norm.len();
    let mut i = 0;
    while i < n {
        let mut hit: Option<(usize, &'static str)> = None;
        for &(prefix, rule_id) in GITHUB_TOKEN_PREFIXES {
            if normalized_starts_with(norm, i, prefix) && (i == 0 || !is_identifier_char(norm[i - 1].ch)) {
                hit = Some((prefix.chars().count(), rule_id));
                break;
            }
        }
        if let Some((prefix_len, rule_id)) = hit {
            let body_start = i + prefix_len;
            let mut j = body_start;
            while j < n && j - body_start < GITHUB_TOKEN_PAYLOAD_MAX && is_identifier_char(norm[j].ch) {
                j += 1;
            }
            let body_len = j - body_start;
            let boundary_ok = j >= n || !is_identifier_char(norm[j].ch);
            if body_len >= GITHUB_TOKEN_PAYLOAD_MIN && boundary_ok {
                let (start_byte, end_byte) = bytes_of(norm, i, j);
                out.push(DeterministicMatch { start_byte, end_byte, rule_id, reason_code: "GITHUB_TOKEN_SHAPE", score: None });
                i = j;
                continue;
            }
        }
        i += 1;
    }
}

// ---------------------------------------------------------------------
// Context-dependent hard positives (brief §3.2, round 3 of this slice):
// rules that need a nearby label/key before a value counts as sensitive.
// Every rule here is still listed directly under §3.2's "Hard positives"
// heading (unlike phone/address, which the brief explicitly calls out as
// review-candidate-only until escalated by label/NER agreement — that
// pair needs the review-candidate disposition machinery this slice
// doesn't have yet, so it stays a separate follow-up round, not this
// one). Masked-credential runs need real geometry (an input-like
// rectangle) to mean anything and are part of the structural/UI evidence
// pass (§3.3), not this text-only layer.
// ---------------------------------------------------------------------

fn normalized_starts_with_ci(norm: &[NormalizedChar], idx: usize, needle_lower: &str) -> bool {
    let chars: Vec<char> = needle_lower.chars().collect();
    if idx + chars.len() > norm.len() {
        return false;
    }
    norm[idx..idx + chars.len()].iter().map(|c| c.ch.to_ascii_lowercase()).eq(chars)
}

/// True if the 40-char window immediately before `value_start`, cut
/// short at the nearest preceding newline (never crossing into a
/// different line), contains any of `labels` as a whole word
/// (case-insensitive, bounded by non-alphanumeric characters or the
/// window's own edges). Brief: "in the same field or within the
/// configured spatial neighborhood" — this pure text layer has no real
/// field/geometry concept, so a same-line character window is its
/// stand-in; the structural/UI evidence pass (§3.3) is where real
/// spatial neighborhood checks belong.
fn context_label_within(norm: &[NormalizedChar], value_start: usize, labels: &[&str], window: usize) -> bool {
    let search_start = value_start.saturating_sub(window);
    let mut effective_start = search_start;
    for (offset, c) in norm[search_start..value_start].iter().enumerate() {
        if c.ch == '\n' {
            effective_start = search_start + offset + 1;
        }
    }
    let slice: String = norm[effective_start..value_start].iter().map(|c| c.ch.to_ascii_lowercase()).collect();
    labels.iter().any(|label| word_boundary_contains(&slice, label))
}

fn word_boundary_contains(haystack: &str, needle: &str) -> bool {
    let bytes = haystack.as_bytes();
    let needle_bytes = needle.as_bytes();
    if needle_bytes.is_empty() || needle_bytes.len() > bytes.len() {
        return false;
    }
    for start in 0..=(bytes.len() - needle_bytes.len()) {
        if &bytes[start..start + needle_bytes.len()] == needle_bytes {
            let before_ok = start == 0 || !bytes[start - 1].is_ascii_alphanumeric();
            let end = start + needle_bytes.len();
            let after_ok = end == bytes.len() || !bytes[end].is_ascii_alphanumeric();
            if before_ok && after_ok {
                return true;
            }
        }
    }
    false
}

fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+' | '/' | '=')
}

// ---- bearer/basic authorization values ----

const BEARER_BASIC_VALUE_MIN: usize = 8;
const BEARER_BASIC_VALUE_MAX: usize = 4096;

fn detect_bearer_basic_auth(norm: &[NormalizedChar], out: &mut Vec<DeterministicMatch>) {
    let n = norm.len();
    let mut i = 0;
    while i < n {
        let mut matched: Option<(usize, &'static str)> = None;
        for (prefix, rule_id) in [("bearer ", "det.bearer_auth"), ("basic ", "det.basic_auth")] {
            if normalized_starts_with_ci(norm, i, prefix) && (i == 0 || !is_identifier_char(norm[i - 1].ch)) {
                matched = Some((prefix.chars().count(), rule_id));
                break;
            }
        }
        if let Some((prefix_len, rule_id)) = matched {
            let value_start = i + prefix_len;
            let mut j = value_start;
            while j < n && is_token_char(norm[j].ch) {
                j += 1;
            }
            let value_len = j - value_start;
            if (BEARER_BASIC_VALUE_MIN..=BEARER_BASIC_VALUE_MAX).contains(&value_len) {
                let (start_byte, end_byte) = bytes_of(norm, i, j);
                out.push(DeterministicMatch { start_byte, end_byte, rule_id, reason_code: "BEARER_BASIC_AUTH_VALUE", score: None });
                i = j;
                continue;
            }
        }
        i += 1;
    }
}

// ---- Cookie / Set-Cookie header values ----

const COOKIE_HEADER_VALUE_MAX: usize = 2048;

fn detect_cookie_header_value(norm: &[NormalizedChar], out: &mut Vec<DeterministicMatch>) {
    let n = norm.len();
    let mut i = 0;
    while i < n {
        let mut prefix_len = None;
        for prefix in ["set-cookie:", "cookie:"] {
            if normalized_starts_with_ci(norm, i, prefix) && (i == 0 || !is_identifier_char(norm[i - 1].ch)) {
                prefix_len = Some(prefix.chars().count());
                break;
            }
        }
        if let Some(prefix_len) = prefix_len {
            let mut k = i + prefix_len;
            while k < n && norm[k].ch == ' ' {
                k += 1;
            }
            let value_start = k;
            let mut j = value_start;
            while j < n && norm[j].ch != '\n' {
                j += 1;
            }
            let value_len = j - value_start;
            if (1..=COOKIE_HEADER_VALUE_MAX).contains(&value_len) {
                let (start_byte, end_byte) = bytes_of(norm, i, j);
                out.push(DeterministicMatch { start_byte, end_byte, rule_id: "det.cookie_header", reason_code: "COOKIE_HEADER_VALUE", score: None });
                i = j;
                continue;
            }
        }
        i += 1;
    }
}

// ---- Sensitive key/value forms (also covers URI query/fragment values:
// "?token=..."/"&key=..." has the identical "token=..." shape this
// matcher already finds regardless of what precedes the key) ----

const SENSITIVE_KV_LABELS: &[&str] =
    &["token", "key", "secret", "password", "passwd", "pwd", "otp", "pin", "code", "session", "auth"];
const SENSITIVE_KV_VALUE_MAX: usize = 512;

fn detect_sensitive_key_value(norm: &[NormalizedChar], out: &mut Vec<DeterministicMatch>) {
    let n = norm.len();
    let mut i = 0;
    while i < n {
        if is_identifier_char(norm[i].ch) && (i == 0 || !is_identifier_char(norm[i - 1].ch)) {
            let key_start = i;
            let mut j = i;
            while j < n && is_identifier_char(norm[j].ch) {
                j += 1;
            }
            let key: String = norm[key_start..j].iter().map(|c| c.ch.to_ascii_lowercase()).collect();
            if SENSITIVE_KV_LABELS.contains(&key.as_str()) {
                let mut k = j;
                // A JSON-style quoted key ("secret":) has a closing
                // quote directly after the key, before the separator.
                if k < n && (norm[k].ch == '"' || norm[k].ch == '\'') {
                    k += 1;
                }
                while k < n && (norm[k].ch == ' ' || norm[k].ch == '\t') {
                    k += 1;
                }
                if k < n && (norm[k].ch == ':' || norm[k].ch == '=') {
                    k += 1;
                    while k < n && (norm[k].ch == ' ' || norm[k].ch == '\t') {
                        k += 1;
                    }
                    let quote = if k < n && (norm[k].ch == '"' || norm[k].ch == '\'') { Some(norm[k].ch) } else { None };
                    if quote.is_some() {
                        k += 1;
                    }
                    let value_start = k;
                    let mut end = k;
                    while end < n {
                        let c = norm[end].ch;
                        let stop = match quote {
                            Some(q) => c == q,
                            None => matches!(c, ' ' | '\n' | '\t' | ',' | ';' | '&'),
                        };
                        if stop {
                            break;
                        }
                        end += 1;
                    }
                    let value_len = end - value_start;
                    if (1..=SENSITIVE_KV_VALUE_MAX).contains(&value_len) {
                        let match_end = if quote.is_some() && end < n { end + 1 } else { end };
                        let (start_byte, end_byte) = bytes_of(norm, key_start, match_end);
                        out.push(DeterministicMatch {
                            start_byte,
                            end_byte,
                            rule_id: "det.sensitive_key_value",
                            reason_code: "SENSITIVE_KEY_VALUE",
                            score: None,
                        });
                        i = match_end;
                        continue;
                    }
                }
            }
        }
        i += 1;
    }
}

// ---- OTP / PIN: 4-10 digits with a nearby label ----

const OTP_PIN_LABELS: &[&str] = &["otp", "pin", "verification", "passcode"];
const OTP_PIN_CONTEXT_WINDOW: usize = 40;

fn detect_otp_pin(norm: &[NormalizedChar], out: &mut Vec<DeterministicMatch>) {
    let n = norm.len();
    let mut i = 0;
    while i < n {
        if is_ascii_digit(norm[i].ch) && (i == 0 || !is_ascii_digit(norm[i - 1].ch)) {
            let mut j = i;
            while j < n && is_ascii_digit(norm[j].ch) {
                j += 1;
            }
            let len = j - i;
            if (4..=10).contains(&len) && context_label_within(norm, i, OTP_PIN_LABELS, OTP_PIN_CONTEXT_WINDOW) {
                let (start_byte, end_byte) = bytes_of(norm, i, j);
                out.push(DeterministicMatch { start_byte, end_byte, rule_id: "det.otp_pin", reason_code: "OTP_PIN_WITH_LABEL", score: None });
                i = j;
                continue;
            }
        }
        i += 1;
    }
}

// ---- US ABA routing number: exactly 9 digits, valid checksum, nearby
// routing/bank context ----

const ABA_CONTEXT_LABELS: &[&str] = &["routing", "bank"];
const ABA_CONTEXT_WINDOW: usize = 40;

fn aba_checksum_is_valid(digits: &[u32]) -> bool {
    if digits.len() != 9 {
        return false;
    }
    let sum = 3 * (digits[0] + digits[3] + digits[6]) + 7 * (digits[1] + digits[4] + digits[7]) + (digits[2] + digits[5] + digits[8]);
    sum.is_multiple_of(10)
}

fn detect_aba_routing_number(norm: &[NormalizedChar], out: &mut Vec<DeterministicMatch>) {
    let n = norm.len();
    let mut i = 0;
    while i < n {
        if is_ascii_digit(norm[i].ch) && (i == 0 || !is_ascii_digit(norm[i - 1].ch)) {
            let mut j = i;
            while j < n && is_ascii_digit(norm[j].ch) {
                j += 1;
            }
            let digits: Vec<u32> = norm[i..j].iter().map(|c| c.ch.to_digit(10).unwrap()).collect();
            if digits.len() == 9 && aba_checksum_is_valid(&digits) && context_label_within(norm, i, ABA_CONTEXT_LABELS, ABA_CONTEXT_WINDOW)
            {
                let (start_byte, end_byte) = bytes_of(norm, i, j);
                out.push(DeterministicMatch {
                    start_byte,
                    end_byte,
                    rule_id: "det.aba_routing_number",
                    reason_code: "ABA_ROUTING_NUMBER_WITH_CONTEXT",
                    score: None,
                });
                i = j;
                continue;
            }
        }
        i += 1;
    }
}

// ---- Account numbers: 6-20 alphanumeric characters (with at least one
// digit), nearby account/IBAN/bank/member context ----

const ACCOUNT_CONTEXT_LABELS: &[&str] = &["account", "iban", "bank", "member"];
const ACCOUNT_CONTEXT_WINDOW: usize = 40;

fn detect_account_number(norm: &[NormalizedChar], out: &mut Vec<DeterministicMatch>) {
    let n = norm.len();
    let mut i = 0;
    while i < n {
        if norm[i].ch.is_ascii_alphanumeric() && (i == 0 || !norm[i - 1].ch.is_ascii_alphanumeric()) {
            let mut j = i;
            while j < n && norm[j].ch.is_ascii_alphanumeric() {
                j += 1;
            }
            let len = j - i;
            let has_digit = norm[i..j].iter().any(|c| c.ch.is_ascii_digit());
            if (6..=20).contains(&len) && has_digit && context_label_within(norm, i, ACCOUNT_CONTEXT_LABELS, ACCOUNT_CONTEXT_WINDOW) {
                let (start_byte, end_byte) = bytes_of(norm, i, j);
                out.push(DeterministicMatch {
                    start_byte,
                    end_byte,
                    rule_id: "det.account_number",
                    reason_code: "ACCOUNT_NUMBER_WITH_CONTEXT",
                    score: None,
                });
                i = j;
                continue;
            }
        }
        i += 1;
    }
}

/// Runs every context-*dependent* rule in this module over `text` and
/// returns every hit, in source-byte order — the round-3 counterpart to
/// [`detect_context_free`]. Kept as a separate entry point rather than
/// folded into `detect_context_free` because that name and its existing
/// callers/tests specifically mean "needs no nearby label or UI
/// evidence"; a later consolidation round can offer one combined
/// function once both halves (and the structural pass) all exist.
pub fn detect_context_dependent(text: &str) -> Vec<DeterministicMatch> {
    let norm = normalize(text);
    let mut out = Vec::new();
    detect_bearer_basic_auth(&norm, &mut out);
    detect_cookie_header_value(&norm, &mut out);
    detect_sensitive_key_value(&norm, &mut out);
    detect_otp_pin(&norm, &mut out);
    detect_aba_routing_number(&norm, &mut out);
    detect_account_number(&norm, &mut out);
    out.sort_by_key(|m| m.start_byte);
    out
}

// ---------------------------------------------------------------------
// Candidate box binding (brief §3.1): map a [`DeterministicMatch`]'s
// byte range onto the [`OcrToken`]s it overlaps and build the actual
// [`RedactionCandidate`] shape brief §4 defines.
// ---------------------------------------------------------------------

use crate::sop_session::{Disposition, OcrToken, RedactionCandidate};

/// Minimum expansion in source pixels, brief §3.1: "expand by at least 4
/// source pixels."
const MIN_EXPAND_PX: i64 = 4;

/// Joins `tokens` (already in reading order) into one string the
/// detectors in this module can scan, plus each token's exact byte range
/// in that joined string. Tokens sharing a `line_id` are joined by a
/// single ascii space; a change of `line_id` joins by `\n` instead, so a
/// detector would see a real line break between lines rather than text
/// from two different lines running together.
pub fn join_tokens(tokens: &[OcrToken]) -> (String, Vec<(usize, usize)>) {
    let mut text = String::new();
    let mut spans = Vec::with_capacity(tokens.len());
    let mut prev_line: Option<&str> = None;
    for token in tokens {
        if let Some(prev) = prev_line {
            text.push(if prev == token.line_id { ' ' } else { '\n' });
        }
        let start = text.len();
        text.push_str(&token.text);
        let end = text.len();
        spans.push((start, end));
        prev_line = Some(&token.line_id);
    }
    (text, spans)
}

fn box_union(a: (i64, i64, u64, u64), b: (i64, i64, u64, u64)) -> (i64, i64, u64, u64) {
    let (ax, ay, aw, ah) = a;
    let (bx, by, bw, bh) = b;
    let right = (ax + aw as i64).max(bx + bw as i64);
    let bottom = (ay + ah as i64).max(by + bh as i64);
    let x = ax.min(bx);
    let y = ay.min(by);
    (x, y, (right - x) as u64, (bottom - y) as u64)
}

/// Estimated glyph stroke width for a token of the given box height — a
/// documented heuristic (typical stroke width is roughly 1/12th of glyph
/// height), not a font-metrics measurement; brief §3.1 requires at least
/// this much expansion on top of [`MIN_EXPAND_PX`], not an exact value.
fn estimate_glyph_stroke_px(token_height: u64) -> i64 {
    (token_height / 12).max(1) as i64
}

fn expand_box(b: (i64, i64, u64, u64), amount: i64) -> (i64, i64, u64, u64) {
    let (x, y, w, h) = b;
    let new_x = x - amount;
    let new_y = y - amount;
    let new_w = (w as i64 + 2 * amount).max(0) as u64;
    let new_h = (h as i64 + 2 * amount).max(0) as u64;
    (new_x, new_y, new_w, new_h)
}

/// Clips `b` to `[0, frame_width) x [0, frame_height)`. Only ever
/// truncates an *expansion*, never the original detection it was built
/// from — the original box is assumed already within the frame.
fn clip_box_to_frame(b: (i64, i64, u64, u64), frame_width: u32, frame_height: u32) -> (i64, i64, u64, u64) {
    let (x, y, w, h) = b;
    let clipped_x = x.max(0);
    let clipped_y = y.max(0);
    let right = (x + w as i64).min(frame_width as i64);
    let bottom = (y + h as i64).min(frame_height as i64);
    let clipped_w = (right - clipped_x).max(0) as u64;
    let clipped_h = (bottom - clipped_y).max(0) as u64;
    (clipped_x, clipped_y, clipped_w, clipped_h)
}

/// A box with nonzero area whose entirety falls within `[0, frame_width)
/// x [0, frame_height)` — C2P3-002's binding-side half: a token box this
/// function rejects must never be fed into [`clip_box_to_frame`], which
/// would otherwise silently clip an already-invalid box down to an
/// apparently-safe (possibly zero-area) one, letting painting and
/// verification quietly "agree" on redacting nothing.
fn token_box_is_valid_and_in_frame(b: (i64, i64, u64, u64), frame_width: u32, frame_height: u32) -> bool {
    let (x, y, w, h) = b;
    if w == 0 || h == 0 || x < 0 || y < 0 {
        return false;
    }
    let Some(right) = x.checked_add_unsigned(w) else { return false };
    let Some(bottom) = y.checked_add_unsigned(h) else { return false };
    right <= frame_width as i64 && bottom <= frame_height as i64
}

#[derive(Debug, Clone, PartialEq)]
pub enum BindMatchesError {
    /// `tokens` and `token_spans` must describe the same tokens, so they
    /// must have the same length — a mismatch here previously risked
    /// indexing `tokens[idx]` out of bounds and panicking.
    SpanTableLengthMismatch { tokens_len: usize, spans_len: usize },
    /// `token_spans` is not a well-formed, non-decreasing table of
    /// in-bounds `(start, end)` ranges over the joined text.
    InvalidSpanTable,
    /// A match's own byte range is malformed or falls outside the joined
    /// text it's claimed to be a match within.
    MatchOutOfBounds { start_byte: usize, end_byte: usize },
}

/// [`bind_matches_to_candidates`]'s result: candidates built from matches
/// that bound cleanly, *and* every match that could not be turned into
/// one — C2P3-001: a lost hard-positive detection must be represented as
/// data the caller can act on, never silently dropped.
#[derive(Debug, Clone, PartialEq)]
pub struct BindingResult {
    pub candidates: Vec<RedactionCandidate>,
    /// Matches that overlapped no token, or whose covered tokens
    /// included an invalid (zero-area or out-of-frame) box — a real
    /// detection that could not be safely bound to a region. The caller
    /// must treat a nonempty list here as blocking (see
    /// [`compute_frame_verification`]'s `unbound_match_count`), never as
    /// an absent detection.
    pub unbound_matches: Vec<DeterministicMatch>,
}

/// Binds every match to the tokens its byte range overlaps (via
/// `token_spans`, as returned by [`join_tokens`]) and builds the brief
/// §4 [`RedactionCandidate`] list: original box is the union of covered
/// token boxes, expanded box adds [`MIN_EXPAND_PX`] plus an estimated
/// glyph stroke and clips to the frame raster. `candidate_id_prefix`
/// scopes generated IDs (e.g. the frame ID) so candidates from different
/// frames never collide; IDs are otherwise a deterministic
/// `{prefix}-{index}` over `matches`' own indices (stable regardless of
/// how many matches end up unbound).
///
/// Validates the complete input before indexing anything (C2P3-001):
/// `tokens`/`token_spans` must have equal length and `token_spans` must
/// be a well-formed, non-decreasing, in-bounds table, or this returns
/// `Err` rather than risking an out-of-bounds index into `tokens`. A
/// match whose own byte range doesn't fit `joined_text_len` likewise
/// returns `Err`. A match that genuinely overlaps no token, or whose
/// covered tokens include an invalid box (C2P3-002), is never silently
/// dropped — it is collected into [`BindingResult::unbound_matches`]
/// instead, so a lost detection is always visible to the caller.
///
/// Every rule in [`detect_context_free`] is listed under brief §3.2's
/// "Hard positives" heading, so the disposition this function assigns is
/// always [`Disposition::Redact`], never [`Disposition::Pending`] — brief
/// §3.5's coverage proof requires "every hard positive is redacted"
/// outright, with no human-review step in between, and §3.5 separately:
/// "a rule or structural hard positive cannot be downgraded by the
/// model." `Pending` is reserved for review-candidate-only categories
/// (phone/address shapes, NER spans below the auto-redact threshold) that
/// a later round of this slice adds — none of which this function
/// produces today.
pub fn bind_matches_to_candidates(
    matches: &[DeterministicMatch],
    tokens: &[OcrToken],
    token_spans: &[(usize, usize)],
    joined_text_len: usize,
    frame_width: u32,
    frame_height: u32,
    candidate_id_prefix: &str,
) -> Result<BindingResult, BindMatchesError> {
    if tokens.len() != token_spans.len() {
        return Err(BindMatchesError::SpanTableLengthMismatch { tokens_len: tokens.len(), spans_len: token_spans.len() });
    }
    let mut prev_end = 0usize;
    for &(s, e) in token_spans {
        if s > e || e > joined_text_len || s < prev_end {
            return Err(BindMatchesError::InvalidSpanTable);
        }
        prev_end = e;
    }

    let mut candidates = Vec::with_capacity(matches.len());
    let mut unbound_matches = Vec::new();
    for (i, m) in matches.iter().enumerate() {
        if m.start_byte > m.end_byte || m.end_byte > joined_text_len {
            return Err(BindMatchesError::MatchOutOfBounds { start_byte: m.start_byte, end_byte: m.end_byte });
        }

        let covered: Vec<usize> =
            token_spans.iter().enumerate().filter(|(_, &(s, e))| s < m.end_byte && e > m.start_byte).map(|(idx, _)| idx).collect();

        if covered.is_empty() {
            unbound_matches.push(m.clone());
            continue;
        }

        let covered_boxes_valid = covered.iter().all(|&idx| {
            let b = (tokens[idx].box_x, tokens[idx].box_y, tokens[idx].box_w, tokens[idx].box_h);
            token_box_is_valid_and_in_frame(b, frame_width, frame_height)
        });
        if !covered_boxes_valid {
            unbound_matches.push(m.clone());
            continue;
        }

        let first = (tokens[covered[0]].box_x, tokens[covered[0]].box_y, tokens[covered[0]].box_w, tokens[covered[0]].box_h);
        let original_box = covered.iter().skip(1).fold(first, |acc, &idx| {
            let b = (tokens[idx].box_x, tokens[idx].box_y, tokens[idx].box_w, tokens[idx].box_h);
            box_union(acc, b)
        });
        let expand = MIN_EXPAND_PX + estimate_glyph_stroke_px(original_box.3);
        let expanded_box = clip_box_to_frame(expand_box(original_box, expand), frame_width, frame_height);
        let source_token_ids = covered.iter().map(|&idx| tokens[idx].token_id.clone()).collect();
        candidates.push(RedactionCandidate {
            candidate_id: format!("{candidate_id_prefix}-{i}"),
            detector_id: m.rule_id.to_string(),
            reason_code: m.reason_code.to_string(),
            source_token_ids,
            original_box,
            expanded_box,
            score: m.score,
            disposition: Disposition::Redact,
            disposition_event_id: None,
        });
    }
    Ok(BindingResult { candidates, unbound_matches })
}

// ---------------------------------------------------------------------
// Structural/UI evidence pass, image-only half (brief §3.3): "For
// image-only frames, locate input-like rectangles using bounded
// contour/edge heuristics." Pure pixel-level processing over an RGBA
// buffer — no OCR, no UI Automation, no caller-supplied evidence of any
// kind, since an image-only frame (an imported screenshot, or any frame
// with no live UIA evidence) has none of that by definition. This is a
// genuinely different kind of code from every other detector in this
// module: those scan normalized *text*; this scans raw *pixels* for the
// shape a flat-filled text-input box typically has — a border where a
// uniformly-colored region meets a differently-colored surrounding
// background.
//
// Brief §3.3's full image-only requirement also says to combine these
// rectangles with OCR/masked-glyph evidence and nearby labels, with any
// disagreement or unreadable field content becoming `STRUCTURAL_UNKNOWN`
// and requiring review. That combination/agreement step is a further
// follow-up round — it needs the same kind of review-candidate
// "agreement" machinery phone/address escalation is waiting on NER/C2-P4
// for — so this function produces only the geometry half: every detected
// rectangle becomes its own candidate with [`Disposition::Pending`] and
// reason code `STRUCTURAL_UNKNOWN` outright, never an auto-`Redact` hard
// positive. Disclosed judgment call: this routine cannot read a field's
// contents — it only sees a flat-filled rectangle shape — so
// `STRUCTURAL_UNKNOWN`/review is the honest disposition for what it
// alone can prove; brief §3.3's own words, "defense in depth, not proof
// that a field is safe," argue for flagging more rather than fewer
// candidates, but not for skipping straight to a confirmed hard
// positive on geometry alone. A later round's combination step reads
// these candidates alongside OCR/NER evidence and may re-disposition
// them; this function does not anticipate that logic.
// ---------------------------------------------------------------------

/// Minimum luminance difference (0-255 scale) between a pixel and its
/// predecessor (the pixel above, for a horizontal border; the pixel to
/// the left, for a vertical border) to count as a contour edge. A
/// documented heuristic threshold, not a calibrated value — real
/// screenshots vary in contrast and anti-aliasing; worth tuning against
/// real captures, not assumed correct by default.
const IMAGE_RECT_EDGE_LUMA_DIFF: u8 = 24;

/// Minimum contiguous run length, in pixels, for an edge run to count as
/// a border segment rather than noise/anti-aliasing speckle.
const IMAGE_RECT_MIN_EDGE_RUN_PX: u32 = 12;

/// Allowed misalignment, in pixels, between a horizontal segment's
/// endpoint and the vertical segment expected to meet it there —
/// real captures are not pixel-perfect (anti-aliasing, DPI scaling).
const IMAGE_RECT_ALIGN_TOLERANCE_PX: i64 = 2;

/// Plausible input-field size bounds, in pixels. Heuristic, not derived
/// from any real-world measurement study — flagged for review same as
/// every other bound in this module; the brief gives no exact numbers
/// for this pass.
const IMAGE_RECT_MIN_WIDTH_PX: u32 = 24;
const IMAGE_RECT_MAX_WIDTH_PX: u32 = 2000;
const IMAGE_RECT_MIN_HEIGHT_PX: u32 = 14;
const IMAGE_RECT_MAX_HEIGHT_PX: u32 = 120;

/// Caps the number of border segments this pass will try to pair up on
/// either axis. Rectangle pairing below is worst-case quadratic in the
/// segment count on one axis; a sufficiently visually busy image (a
/// photo, a detailed diagram — not necessarily adversarial) could
/// otherwise turn a bounded-size frame into an unbounded amount of
/// pairing work. Past this cap the frame is treated as too visually
/// busy for this heuristic to say anything useful about and contributes
/// no candidates at all — a conservative "no signal," not evidence the
/// frame contains no input fields; other evidence paths (UIA, OCR/NER)
/// are unaffected by this cap.
const IMAGE_RECT_MAX_SEGMENTS_PER_AXIS: usize = 4000;

/// [`structural_candidates_from_image_rects`] cannot analyze a frame
/// whose declared dimensions and pixel buffer disagree, or whose
/// dimensions are degenerate (zero width or height) — that is a
/// malformed-input failure, not "zero input rectangles found," so it is
/// a distinct, reported `Err` rather than a silently empty `Ok(vec![])`.
/// Same "never silently drop a real detection" discipline
/// [`BindMatchesError`]/[`BindingResult`] established, applied to the
/// one failure mode this geometry-only function can hit that has
/// nothing to do with caller-supplied evidence validity — unlike the
/// OCR-token and UIA paths, this function has no caller-supplied
/// evidence to validate at all; the only thing that can be wrong is the
/// pixel buffer itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImageRectError {
    ZeroDimension,
    /// `width * height * 4` itself overflows `usize` — C691-003: plain
    /// (unchecked) multiplication wrapped this to a small value for
    /// absurd dimensions, letting an empty/tiny buffer pass the length
    /// gate and then panic on the first pixel read.
    DimensionsOverflow { width: u32, height: u32 },
    BufferLengthMismatch { expected: usize, found: usize },
    /// C691-001: segment collection on one or both axes stopped at
    /// [`IMAGE_RECT_MAX_SEGMENTS_PER_AXIS`] before finishing the frame —
    /// the result is incomplete, not "zero rectangles found." A noisy
    /// frame that happens to contain a real input field must never be
    /// indistinguishable from a clean frame with none; this is reported
    /// as a distinct, review-requiring outcome rather than a silent
    /// `Ok(vec![])`.
    AnalysisExhausted { h_segments: usize, v_segments: usize },
    /// C691-003A: dimensions and buffer length can both check out exactly
    /// while still naming a decoded RGBA raster larger than the
    /// documented, shared 128 MiB decoded-bytes cap
    /// ([`crate::artifact::MAX_ARTIFACT_BYTES`]) — a segment cap bounds
    /// segment *count*, not the pixel work of scanning a uniform image of
    /// that size, so this must be refused before either scan runs, not
    /// discovered only after one hangs or runs long.
    DecodedSizeTooLarge { width: u32, height: u32, bytes: u64 },
}

fn luma_at(rgba: &[u8], width: u32, x: u32, y: u32) -> u8 {
    let idx = (y as u64 * width as u64 + x as u64) as usize * 4;
    let r = rgba[idx] as u32;
    let g = rgba[idx + 1] as u32;
    let b = rgba[idx + 2] as u32;
    ((r * 299 + g * 587 + b * 114) / 1000) as u8
}

fn luma_diff_is_edge(a: u8, b: u8) -> bool {
    (a as i16 - b as i16).unsigned_abs() >= IMAGE_RECT_EDGE_LUMA_DIFF as u16
}

#[derive(Debug, Clone, Copy)]
struct HSegment {
    y: u32,
    x_start: u32,
    /// Exclusive.
    x_end: u32,
}

#[derive(Debug, Clone, Copy)]
struct VSegment {
    x: u32,
    y_start: u32,
    /// Exclusive.
    y_end: u32,
}

/// Horizontal border segments: contiguous runs, within one pixel row,
/// where each pixel differs from the one directly above it by at least
/// [`IMAGE_RECT_EDGE_LUMA_DIFF`] — the signature of a horizontal
/// top/bottom field border.
/// Returns the collected segments plus whether collection stopped early
/// at [`IMAGE_RECT_MAX_SEGMENTS_PER_AXIS`] (C691-001) — scanning halts
/// the moment the cap is hit rather than finishing the whole frame
/// first, so a busy frame's cost is bounded by the cap, not by its
/// pixel count.
fn scan_horizontal_segments(rgba: &[u8], width: u32, height: u32) -> (Vec<HSegment>, bool) {
    let mut out = Vec::new();
    for y in 1..height {
        let mut x = 0u32;
        while x < width {
            if luma_diff_is_edge(luma_at(rgba, width, x, y), luma_at(rgba, width, x, y - 1)) {
                let start = x;
                while x < width && luma_diff_is_edge(luma_at(rgba, width, x, y), luma_at(rgba, width, x, y - 1)) {
                    x += 1;
                }
                if x - start >= IMAGE_RECT_MIN_EDGE_RUN_PX {
                    out.push(HSegment { y, x_start: start, x_end: x });
                    if out.len() > IMAGE_RECT_MAX_SEGMENTS_PER_AXIS {
                        return (out, true);
                    }
                }
            } else {
                x += 1;
            }
        }
    }
    (out, false)
}

/// Vertical border segments: contiguous runs, within one pixel column,
/// where each pixel differs from the one directly to its left by at
/// least [`IMAGE_RECT_EDGE_LUMA_DIFF`] — the signature of a vertical
/// left/right field border.
/// Returns the collected segments plus whether collection stopped early
/// at [`IMAGE_RECT_MAX_SEGMENTS_PER_AXIS`] (C691-001) — see
/// [`scan_horizontal_segments`]'s doc comment.
fn scan_vertical_segments(rgba: &[u8], width: u32, height: u32) -> (Vec<VSegment>, bool) {
    let mut out = Vec::new();
    for x in 1..width {
        let mut y = 0u32;
        while y < height {
            if luma_diff_is_edge(luma_at(rgba, width, x, y), luma_at(rgba, width, x - 1, y)) {
                let start = y;
                while y < height && luma_diff_is_edge(luma_at(rgba, width, x, y), luma_at(rgba, width, x - 1, y)) {
                    y += 1;
                }
                if y - start >= IMAGE_RECT_MIN_EDGE_RUN_PX {
                    out.push(VSegment { x, y_start: start, y_end: y });
                    if out.len() > IMAGE_RECT_MAX_SEGMENTS_PER_AXIS {
                        return (out, true);
                    }
                }
            } else {
                y += 1;
            }
        }
    }
    (out, false)
}

fn within_align_tolerance(a: u32, b: u32) -> bool {
    (a as i64 - b as i64).abs() <= IMAGE_RECT_ALIGN_TOLERANCE_PX
}

fn vsegment_spans(v: &VSegment, top_y: u32, bottom_y: u32) -> bool {
    let tol = IMAGE_RECT_ALIGN_TOLERANCE_PX;
    (v.y_start as i64) <= top_y as i64 + tol && (v.y_end as i64) + tol >= bottom_y as i64
}

/// Pairs up horizontal and vertical border segments into closed
/// rectangles: a top and a bottom horizontal segment sharing the same
/// (within [`IMAGE_RECT_ALIGN_TOLERANCE_PX`]) x-extent, with a vertical
/// segment at each of those x positions spanning (within the same
/// tolerance) from the top segment's row to the bottom segment's row.
/// Returns deduplicated boxes in a deterministic (sorted) order so
/// candidate IDs stay stable across repeated runs on the same input.
///
/// This checks only the four border edges — it never samples interior
/// pixels for fill uniformity. A stack of adjacent, differently-colored
/// bordered regions can therefore also satisfy the outer pairing and
/// produce an extra, redundant rectangle spanning both of them, on top
/// of the two real ones. Disclosed, deliberately not filtered out: an
/// extra flagged review candidate is the safe-biased direction of error
/// for a defense-in-depth signal; a missed one is not.
fn find_rectangles(h_segs: &[HSegment], v_segs: &[VSegment]) -> Vec<(i64, i64, u64, u64)> {
    let mut found: std::collections::BTreeSet<(i64, i64, u64, u64)> = std::collections::BTreeSet::new();
    if h_segs.len() > IMAGE_RECT_MAX_SEGMENTS_PER_AXIS || v_segs.len() > IMAGE_RECT_MAX_SEGMENTS_PER_AXIS {
        return Vec::new();
    }
    for (i, top) in h_segs.iter().enumerate() {
        for bottom in h_segs.iter().skip(i + 1) {
            if bottom.y <= top.y {
                continue;
            }
            let height = bottom.y - top.y;
            if !(IMAGE_RECT_MIN_HEIGHT_PX..=IMAGE_RECT_MAX_HEIGHT_PX).contains(&height) {
                continue;
            }
            if !within_align_tolerance(top.x_start, bottom.x_start) || !within_align_tolerance(top.x_end, bottom.x_end) {
                continue;
            }
            let width = top.x_end - top.x_start;
            if !(IMAGE_RECT_MIN_WIDTH_PX..=IMAGE_RECT_MAX_WIDTH_PX).contains(&width) {
                continue;
            }
            let left_ok = v_segs.iter().any(|v| within_align_tolerance(v.x, top.x_start) && vsegment_spans(v, top.y, bottom.y));
            let right_ok = v_segs.iter().any(|v| within_align_tolerance(v.x, top.x_end) && vsegment_spans(v, top.y, bottom.y));
            if left_ok && right_ok {
                found.insert((top.x_start as i64, top.y as i64, width as u64, height as u64));
            }
        }
    }
    found.into_iter().collect()
}

/// Locates input-like rectangles in an image-only frame by bounded
/// pixel-level contour/edge detection over `rgba` (brief §3.3's
/// image-only half) and produces one [`RedactionCandidate`] per detected
/// rectangle, dispositioned [`Disposition::Pending`] with reason code
/// `STRUCTURAL_UNKNOWN` (see this section's header comment for why: pure
/// geometry with no evidence about the field's actual contents cannot
/// honestly default to `Redact`). `candidate_id_prefix` scopes generated
/// IDs the same way [`bind_matches_to_candidates`]/
/// [`structural_candidates_from_uia`] do.
///
/// Boundary this function does not and cannot enforce on its own: brief
/// §3.3's "the app must not pretend UIA evidence exists for imported
/// screenshots" has a geometry-side mirror here — this heuristic is
/// meant for frames where no (or no trustworthy) UIA evidence exists,
/// but this pure pixel function has no way to know whether the frame it
/// was handed is actually image-only or a live capture with UIA evidence
/// a caller simply chose not to pass; that choice is the caller's
/// contract, not something derivable from pixels alone.
///
/// Returns `Err` only for malformed input (zero dimension, or a buffer
/// whose length doesn't match `frame_width * frame_height * 4`) — never
/// for "no rectangles found," which is a legitimate `Ok(vec![])`.
/// C691-003A: separated from the function body so the exact-cap and
/// one-byte-over-cap boundary can be tested directly, without allocating
/// an actual 128 MiB (or larger) buffer.
fn check_decoded_size_admissible(width: u32, height: u32, decoded_bytes: u64) -> Result<(), ImageRectError> {
    if decoded_bytes > crate::artifact::MAX_ARTIFACT_BYTES as u64 {
        return Err(ImageRectError::DecodedSizeTooLarge { width, height, bytes: decoded_bytes });
    }
    Ok(())
}

pub fn structural_candidates_from_image_rects(
    rgba: &[u8],
    frame_width: u32,
    frame_height: u32,
    candidate_id_prefix: &str,
) -> Result<Vec<RedactionCandidate>, ImageRectError> {
    if frame_width == 0 || frame_height == 0 {
        return Err(ImageRectError::ZeroDimension);
    }
    let expected = (frame_width as usize)
        .checked_mul(frame_height as usize)
        .and_then(|area| area.checked_mul(4))
        .ok_or(ImageRectError::DimensionsOverflow { width: frame_width, height: frame_height })?;
    check_decoded_size_admissible(frame_width, frame_height, expected as u64)?;
    if rgba.len() != expected {
        return Err(ImageRectError::BufferLengthMismatch { expected, found: rgba.len() });
    }

    let (h_segs, h_exhausted) = scan_horizontal_segments(rgba, frame_width, frame_height);
    let (v_segs, v_exhausted) = scan_vertical_segments(rgba, frame_width, frame_height);
    if h_exhausted || v_exhausted {
        return Err(ImageRectError::AnalysisExhausted { h_segments: h_segs.len(), v_segments: v_segs.len() });
    }
    let boxes = find_rectangles(&h_segs, &v_segs);

    Ok(boxes
        .into_iter()
        .enumerate()
        .map(|(i, original_box)| {
            let expanded_box = clip_box_to_frame(expand_box(original_box, MIN_EXPAND_PX), frame_width, frame_height);
            RedactionCandidate {
                candidate_id: format!("{candidate_id_prefix}-imgrect-{i}"),
                detector_id: "det.image_rect_input_field".to_string(),
                reason_code: "STRUCTURAL_UNKNOWN".to_string(),
                source_token_ids: vec![],
                original_box,
                expanded_box,
                score: None,
                disposition: Disposition::Pending,
                disposition_event_id: None,
            }
        })
        .collect())
}

// ---------------------------------------------------------------------
// Destructive redaction operation (brief §3.4): merge overlapping/
// adjacent accepted-candidate boxes into the final paint-region list and
// apply the existing solid-fill primitive. Reuses
// [`crate::annotations::paint_redaction_rect`] unchanged — brief §3.4:
// "Use only the existing destructive opaque solid-fill semantics for the
// safety path" — rather than defining a second redaction primitive.
// Operates on an in-memory RGBA buffer only, same boundary as
// [`crate::annotations::apply_redactions`]: decode/re-encode/metadata-
// strip/digest-binding/file I/O is the app shell's job, not this pure
// core module's.
// ---------------------------------------------------------------------

fn boxes_touch_or_overlap(a: (i64, i64, u64, u64), b: (i64, i64, u64, u64)) -> bool {
    let (ax, ay, aw, ah) = a;
    let (bx, by, bw, bh) = b;
    let a_right = ax + aw as i64;
    let a_bottom = ay + ah as i64;
    let b_right = bx + bw as i64;
    let b_bottom = by + bh as i64;
    // `<=` on both axes covers true overlap and exact-edge adjacency
    // (brief §3.1: "merge when overlapping/adjacent"); a positive gap
    // between the two boxes on either axis means neither.
    ax <= b_right && bx <= a_right && ay <= b_bottom && by <= a_bottom
}

/// Merges every pair of overlapping-or-adjacent boxes until no pair
/// remains, so the final paint pass never leaves a readable sliver of
/// un-redacted pixels between two regions that should have been one.
/// Candidate counts per frame are small (bounded by the OCR-token and
/// detector-hit counts for one frame), so the simple repeated-pairwise-
/// merge approach is not a bottleneck here even though it is not the
/// asymptotically optimal sweep.
pub fn merge_overlapping_or_adjacent_boxes(mut boxes: Vec<(i64, i64, u64, u64)>) -> Vec<(i64, i64, u64, u64)> {
    loop {
        let mut merged_any = false;
        'outer: for i in 0..boxes.len() {
            for j in (i + 1)..boxes.len() {
                if boxes_touch_or_overlap(boxes[i], boxes[j]) {
                    boxes[i] = box_union(boxes[i], boxes[j]);
                    boxes.remove(j);
                    merged_any = true;
                    break 'outer;
                }
            }
        }
        if !merged_any {
            return boxes;
        }
    }
}

/// The final, merged paint-region list for one frame's candidates: only
/// candidates currently dispositioned [`Disposition::Redact`] contribute
/// — `Pending` and `MarkNonSensitive` candidates are never painted.
pub fn redaction_regions_for_frame(candidates: &[RedactionCandidate]) -> Vec<(i64, i64, u64, u64)> {
    let boxes: Vec<(i64, i64, u64, u64)> =
        candidates.iter().filter(|c| c.disposition == Disposition::Redact).map(|c| c.expanded_box).collect();
    merge_overlapping_or_adjacent_boxes(boxes)
}

/// Destructively paints every merged region from [`redaction_regions_for_frame`]
/// into `rgba` in place, via the existing [`crate::annotations::paint_redaction_rect`]
/// primitive — never a second, independently-written overwrite.
pub fn apply_candidate_redactions(rgba: &mut [u8], width: u32, height: u32, candidates: &[RedactionCandidate]) {
    for (x, y, w, h) in redaction_regions_for_frame(candidates) {
        crate::annotations::paint_redaction_rect(rgba, width, height, crate::coords::RectI { x, y, w, h });
    }
}

// ---------------------------------------------------------------------
// Verification (brief §3.5): pixel proof, removal proof (deterministic
// half only this round — the NER/structural half lands once those
// detectors exist), and coverage proof. [`compute_frame_verification`]
// folds all three into the brief's [`FrameVerification`] state machine.
// ---------------------------------------------------------------------

use crate::sop_session::{EditEvent, EditOperation, FrameVerification, SopSessionV1};

/// Brief §3.5 check 1: "every declared redaction rectangle in the
/// decoded derivative consists entirely of the fixed opaque redaction
/// pixel." Checks `regions` (as produced by [`redaction_regions_for_frame`])
/// against the actual derivative buffer — never trusts that painting
/// happened just because it was requested.
#[derive(Debug, Clone, PartialEq)]
pub enum PixelProofFailure {
    /// `rgba` is not exactly `width * height * 4` bytes — C2P3-002: a
    /// shorter-than-declared buffer must never be treated as "no pixels
    /// to check," which a naive clipped loop over it would do silently.
    InvalidRasterBufferLength { expected: usize, actual: usize },
    /// A declared region has zero width or height.
    ZeroAreaRegion { region: (i64, i64, u64, u64) },
    /// A declared region is not *entirely* within `[0, width) x [0,
    /// height)` — C2P3-002: silently clipping an out-of-bounds region
    /// down to whatever fits (or to nothing at all) lets a region that
    /// was never actually painted vacuously "pass" by having no pixels
    /// left to inspect.
    RegionOutsideRaster { region: (i64, i64, u64, u64) },
    /// A pixel inside a declared region is not the fixed redaction
    /// pixel.
    UnpaintedPixel { region: (i64, i64, u64, u64) },
    /// `width * height * 4` itself overflows `usize` — panel fix round
    /// 2's finding: a prior version computed this with plain (unchecked)
    /// multiplication, so absurd dimensions could wrap the expected
    /// length down to something small enough to pass the buffer-length
    /// check against an empty/tiny buffer, after which indexing into it
    /// panicked instead of failing closed.
    RasterDimensionsOverflow { width: u32, height: u32 },
}

/// Brief §3.5 check 1: "every declared redaction rectangle in the
/// decoded derivative consists entirely of the fixed opaque redaction
/// pixel." Every region must be admitted as-is — nonzero area, fully
/// within the raster — never silently clipped into apparent safety; a
/// region or buffer this function cannot trust is a failure, not a
/// vacuous pass over zero remaining pixels (C2P3-002).
pub fn verify_pixel_proof(rgba: &[u8], width: u32, height: u32, regions: &[(i64, i64, u64, u64)]) -> Result<(), PixelProofFailure> {
    let expected_len = (width as usize)
        .checked_mul(height as usize)
        .and_then(|area| area.checked_mul(4))
        .ok_or(PixelProofFailure::RasterDimensionsOverflow { width, height })?;
    if rgba.len() != expected_len {
        return Err(PixelProofFailure::InvalidRasterBufferLength { expected: expected_len, actual: rgba.len() });
    }
    for &region in regions {
        let (x, y, w, h) = region;
        if w == 0 || h == 0 {
            return Err(PixelProofFailure::ZeroAreaRegion { region });
        }
        if x < 0 || y < 0 {
            return Err(PixelProofFailure::RegionOutsideRaster { region });
        }
        let (Some(right), Some(bottom)) = (x.checked_add_unsigned(w), y.checked_add_unsigned(h)) else {
            return Err(PixelProofFailure::RegionOutsideRaster { region });
        };
        if right > width as i64 || bottom > height as i64 {
            return Err(PixelProofFailure::RegionOutsideRaster { region });
        }
        for yy in (y as u32)..(bottom as u32) {
            for xx in (x as u32)..(right as u32) {
                let idx = (yy as u64 * width as u64 + xx as u64) as usize * 4;
                // Defense in depth (panel fix round 2): the checks above
                // already guarantee this never trips given a correctly
                // checked `expected_len`, but a safety-critical proof
                // never relies on exactly one guard holding - verify the
                // index actually fits the real buffer before touching it.
                let Some(last_byte) = idx.checked_add(3) else {
                    return Err(PixelProofFailure::RegionOutsideRaster { region });
                };
                if last_byte >= rgba.len() {
                    return Err(PixelProofFailure::RegionOutsideRaster { region });
                }
                let pixel = (rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3]);
                if pixel != crate::annotations::REDACTION_PIXEL {
                    return Err(PixelProofFailure::UnpaintedPixel { region });
                }
            }
        }
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq)]
pub enum RemovalProofResult {
    Clean,
    Residual { hard_positives: Vec<DeterministicMatch>, fragments: Vec<String> },
}

/// Brief §3.5 check 2, deterministic half: reruns this module's
/// detectors on `rerun_text` (the derivative's own re-OCR output — the
/// caller's job to produce, not this pure function's) for any surviving
/// hard positive, and separately checks that no >=4-character fragment
/// of any originally-flagged source value survives anywhere in it (brief:
/// "No hard-positive value or normalized fragment (length >=4) from a
/// flagged source span may remain"). The NER/structural half of this
/// proof is a later round, once those detectors exist.
pub fn verify_removal_proof(rerun_text: &str, flagged_source_values: &[String]) -> RemovalProofResult {
    // C688-008: this must rerun every required deterministic rule
    // family the release actually implements, not just the original
    // round-1 context-free subset — otherwise a derivative containing a
    // brand-new credential shape (e.g. a context-dependent
    // `password=...` form) that happens to share no fragment with the
    // original flagged values can report Clean while a real, detectable
    // hard positive is still sitting in the rerun text.
    let mut residual_hard_positives = detect_context_free(rerun_text);
    residual_hard_positives.extend(detect_context_dependent(rerun_text));
    residual_hard_positives.sort_by_key(|m| m.start_byte);

    // C2P3-003: the fragment check must apply the *same* offset-
    // preserving normalization the detectors themselves use to both
    // sides of the comparison - otherwise a flagged ASCII value and a
    // derivative that only re-OCR'd it as full-width digits (or with a
    // zero-width character spliced in) would never collide under a raw
    // `str::contains`, letting a genuinely residual-readable span pass
    // as "Clean."
    let normalized_rerun: String = normalize(rerun_text).into_iter().map(|c| c.ch).collect();
    let mut residual_fragments = Vec::new();
    for value in flagged_source_values {
        let normalized_value: Vec<char> = normalize(value).into_iter().map(|c| c.ch).collect();
        if normalized_value.len() < 4 {
            continue;
        }
        for window_start in 0..=(normalized_value.len() - 4) {
            let fragment: String = normalized_value[window_start..window_start + 4].iter().collect();
            if normalized_rerun.contains(&fragment) {
                residual_fragments.push(fragment);
                break;
            }
        }
    }
    if residual_hard_positives.is_empty() && residual_fragments.is_empty() {
        RemovalProofResult::Clean
    } else {
        RemovalProofResult::Residual { hard_positives: residual_hard_positives, fragments: residual_fragments }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum CoverageProofFailure {
    /// Brief §3.5 check 3: "every NER/unknown/review candidate has an
    /// explicit disposition" — this one never reached a final decision.
    UndispositionedCandidate { candidate_id: String },
    /// Brief §3.5: "deterministic credential/private-key/payment-card
    /// hard positives cannot be unredacted in Phase 2" — this one was
    /// marked non-sensitive (or otherwise left non-`Redact`) despite
    /// being in that categorically-unredactable set.
    UnredactableHardPositiveNotRedacted { candidate_id: String, detector_id: String },
    /// C2P3-005: a `MarkNonSensitive` disposition with no recorded
    /// `disposition_event_id` — the enum alone is never permission for
    /// an override; brief §3.5 requires "a reason and explicit
    /// confirmation," which only a real recorded edit event can carry.
    /// This function cannot see that event's reason/confirmation (that
    /// is `sop_session::validate_edit_chain`'s territory), but it can and
    /// does refuse to accept an override that isn't even backed by one.
    UnevidencedOverride { candidate_id: String },
    /// C688-005A: a `disposition_event_id` was present, but no event in
    /// the supplied edit log is actually the *current* `RedactionChange`
    /// for this candidate (matched by frame id *and* candidate id, per
    /// C688-005A.1 — candidate ids are only unique within a frame) with
    /// that exact id — the id names a nonexistent, stale/superseded, a
    /// different frame's same-named candidate, or otherwise non-matching
    /// event rather than the one that produced this candidate's current
    /// disposition.
    UnresolvedOverrideEvent { candidate_id: String, disposition_event_id: String },
    /// C688-005A (re-opened): even a cleanly resolved, current,
    /// correctly frame-scoped `RedactionChange` event cannot satisfy
    /// brief §3.5's "a reason and explicit confirmation" requirement
    /// today — `EditOperation::RedactionChange` (C2-P1's already-merged
    /// contract) has no field to carry either one. Until a separately
    /// reviewed schema change adds that evidence, no `MarkNonSensitive`
    /// override can be accepted as proven, no matter how cleanly its
    /// event resolves — resolving the event is necessary but not
    /// sufficient, and this failure is what reports the "not sufficient"
    /// half honestly rather than silently treating a resolved event as
    /// complete proof.
    OverrideAuthorityContentUnsupported { candidate_id: String, disposition_event_id: String },
}

/// The rule families brief §3.5 names as categorically unredactable in
/// Phase 2: "credential/private-key/payment-card." SSN/ITIN and email
/// are still hard positives that default to `Redact` (brief §3.2), but
/// — unlike this set — are not named as categorically blocked from a
/// human's `MarkNonSensitive` override, so they are deliberately not
/// included here.
pub fn is_unredactable_hard_positive(rule_id: &str) -> bool {
    matches!(
        rule_id,
        "det.payment_card"
            | "det.jwt"
            | "det.pem_private_key"
            | "det.aws_access_key_id"
            | "det.github_token_classic_pat"
            | "det.github_token_oauth"
            | "det.github_token_user_to_server"
            | "det.github_token_server_to_server"
            | "det.github_token_refresh"
            | "det.github_token_fine_grained_pat"
            // C688-007: the round-3 context-dependent detectors added
            // real credential families this list never caught up to -
            // a bearer/basic/session-cookie/sensitive-key-value/OTP
            // candidate marked MarkNonSensitive produced no coverage
            // failure at all, so Phase 2's "credential... cannot be
            // unredacted" rule silently didn't apply to half the
            // credential-shaped detectors in the module. Every rule
            // family here is a credential or a one-time authentication
            // secret, the same class as the context-free set above.
            | "det.bearer_auth"
            | "det.basic_auth"
            | "det.cookie_header"
            | "det.sensitive_key_value"
            | "det.otp_pin"
    )
}

/// GS-C6's closed, versioned review-action input: "both [reason and
/// confirmation] must bind to current source/frame/candidate, policy/
/// model, derivative/session revision." A bare reason string plus an
/// unbound boolean (this type's C6A-001 predecessor) cannot express
/// any of that binding — every field here names something
/// [`validate_review_action`] checks against the session/candidate
/// state actually supplied, not just against itself.
#[derive(Debug, Clone, PartialEq)]
pub struct ReviewActionRequest<'a> {
    pub frame_id: &'a str,
    pub candidate_id: &'a str,
    pub new_disposition: Disposition,
    pub reason: &'a str,
    /// C6A-001A: a bare `true`/`false` carries no binding to *what* is
    /// being confirmed — it could be replayed against any reason,
    /// candidate, or disposition as long as the session-level fields
    /// happened to match. This must be
    /// [`confirmation_digest`]`(frame_id, candidate_id, new_disposition,
    /// reason, source_raster_sha256, derivative_sha256, policy_version,
    /// model_manifest_sha256, session_revision)` computed over this
    /// exact request's own fields plus the frame's current source/
    /// derivative digests — [`validate_review_action`] recomputes the
    /// same digest from current state and rejects any mismatch, so a
    /// confirmation cannot be carried over onto a different reason,
    /// candidate, disposition, or state. `None` means "not confirmed,"
    /// the same as the old `confirmed: false`.
    pub confirmation_digest: Option<&'a str>,
    /// The session revision this review was performed against. Stale
    /// relative to the session's actual current revision means another
    /// edit landed first — refused, never silently applied on top.
    pub expected_session_revision: u64,
    /// The policy binding this review was performed against.
    pub expected_policy_version: &'a str,
    /// The model binding this review was performed against (`None` if
    /// the session itself carries none).
    pub expected_model_manifest_sha256: Option<&'a str>,
}

/// GS-C6's confirmation-must-bind-to-content requirement, made
/// concrete: every field the scope names as required binding (reason,
/// disposition, frame/candidate identity, source raster digest,
/// derivative digest, policy/model, session revision), hashed together.
/// [`validate_review_action`] recomputes this from the frame's actual
/// current `raster_sha256`/`redacted_derivative_sha256` and the
/// session's actual current `policy_version`/`model_manifest_sha256`/
/// `revision` — if a caller's supplied digest doesn't match what those
/// current values would produce, the confirmation is rejected,
/// regardless of whether it was a real confirmation for some *other*,
/// no-longer-current state. This does not prove a human actually
/// clicked confirm (that trust boundary is the caller's, same as the
/// old bare boolean) — it closes the narrower, concrete gap the review
/// named: a confirmation cannot be transplanted onto a different
/// reason, candidate, disposition, or session/source/derivative state
/// than the one it was actually computed against.
#[allow(clippy::too_many_arguments)]
pub fn confirmation_digest(
    frame_id: &str,
    candidate_id: &str,
    new_disposition: Disposition,
    reason: &str,
    source_raster_sha256: &str,
    derivative_sha256: Option<&str>,
    policy_version: &str,
    model_manifest_sha256: Option<&str>,
    session_revision: u64,
) -> String {
    let canonical = format!(
        "{frame_id}\u{0}{candidate_id}\u{0}{new_disposition:?}\u{0}{reason}\u{0}{source_raster_sha256}\u{0}{}\u{0}{policy_version}\u{0}{}\u{0}{session_revision}",
        derivative_sha256.unwrap_or(""),
        model_manifest_sha256.unwrap_or(""),
    );
    crate::sop_session::sha256_hex(canonical.as_bytes())
}

/// GS-C6 (C2-P6 review UI safety blocker): why a reviewer-facing
/// disposition change was refused, caught *before* an
/// [`crate::sop_session::EditOperation::RedactionChange`] is even
/// constructed — this is the review UI's own input gate, separate from
/// (and not a relaxation of) [`verify_coverage_proof`]'s own refusal of
/// any resolved-but-unsupported override downstream.
#[derive(Debug, Clone, PartialEq)]
pub enum DispositionChangeError {
    /// GS-C6: "Reason AND explicit confirmation" — a `MarkNonSensitive`
    /// override with an empty or whitespace-only reason is refused
    /// outright; "a nonempty string... is insufficient" cuts the other
    /// way too — an *empty* one is refused even more plainly.
    MissingReason,
    /// `confirmation_digest` was absent, or present but did not match
    /// [`confirmation_digest`] recomputed from the request's own
    /// fields plus the frame/session's actual current state (C6A-001A:
    /// a bare boolean carried no such binding and could be replayed
    /// against different content).
    MissingExplicitConfirmation,
    /// GS-C6: "Credential / private-key / payment-card hard positives
    /// remain NON-OVERRIDABLE even with both fields." Checked first, so
    /// a protected credential is refused the same way whether or not a
    /// reason/confirmation was ever supplied — this is not a reward for
    /// skipping the paperwork, it genuinely cannot be overridden.
    ProtectedCredentialNonOverridable { detector_id: String },
    /// GS-C6: "bind to... derivative/session revision" — the session
    /// has moved since this review action was formed.
    StaleSessionRevision { expected: u64, current: u64 },
    /// GS-C6: "bind to... policy/model" — the session's policy binding
    /// has changed since this review action was formed.
    PolicyVersionMismatch { expected: String, current: String },
    /// Same binding requirement, for the model manifest half of it.
    ModelManifestMismatch { expected: Option<String>, current: Option<String> },
    /// GS-C6: "bind to current source/frame" — names a frame this
    /// session does not actually have.
    UnknownFrame { frame_id: String },
    /// GS-C6: "bind to current... candidate" — names a candidate not
    /// present in the supplied current candidate list.
    UnknownCandidate { candidate_id: String },
}

/// GS-C6's review-action safety gate — the one authoritative check
/// every disposition-changing review action in a C2-P6 UI must pass,
/// validated against `session` itself (C6A-001: a reason string and a
/// bare boolean cannot be checked against anything; this function's
/// whole job is checking `request` against `session`'s actual current
/// state, never trusting `request`'s own claims). The frame and
/// candidate it names are looked up from `session.source_frames` and
/// that frame's own `redaction_candidates` — never a separately
/// supplied list that could be stale or mismatched against `session`.
/// Passing this check is necessary, not sufficient:
/// [`verify_coverage_proof`] separately still refuses any
/// `MarkNonSensitive` override outright today
/// (`CoverageProofFailure::OverrideAuthorityContentUnsupported`), since
/// `RedactionChange` has nowhere durable to store the reason/
/// confirmation this function requires — that refusal is deliberate
/// and this function does not relax it; a caller still has to treat a
/// passing result here as "the review UI's own input was well-formed
/// and current," not as "this override is now proven." Choosing
/// [`Disposition::Redact`] (the safe default direction) never needs
/// justification and is always allowed once identity/revision/binding
/// checks pass; only choosing to move a candidate *away* from Redact
/// (`MarkNonSensitive`) is gated on reason/confirmation/protection.
pub fn validate_review_action(session: &SopSessionV1, request: &ReviewActionRequest) -> Result<(), DispositionChangeError> {
    if session.revision != request.expected_session_revision {
        return Err(DispositionChangeError::StaleSessionRevision { expected: request.expected_session_revision, current: session.revision });
    }
    if session.policy_version != request.expected_policy_version {
        return Err(DispositionChangeError::PolicyVersionMismatch {
            expected: request.expected_policy_version.to_string(),
            current: session.policy_version.clone(),
        });
    }
    if session.model_manifest_sha256.as_deref() != request.expected_model_manifest_sha256 {
        return Err(DispositionChangeError::ModelManifestMismatch {
            expected: request.expected_model_manifest_sha256.map(|s| s.to_string()),
            current: session.model_manifest_sha256.clone(),
        });
    }
    let frame = session
        .source_frames
        .iter()
        .find(|f| f.frame_id == request.frame_id)
        .ok_or_else(|| DispositionChangeError::UnknownFrame { frame_id: request.frame_id.to_string() })?;
    let candidate = frame
        .redaction_candidates
        .iter()
        .find(|c| c.candidate_id == request.candidate_id)
        .ok_or_else(|| DispositionChangeError::UnknownCandidate { candidate_id: request.candidate_id.to_string() })?;

    if request.new_disposition != Disposition::MarkNonSensitive {
        return Ok(());
    }
    if is_unredactable_hard_positive(&candidate.detector_id) {
        return Err(DispositionChangeError::ProtectedCredentialNonOverridable { detector_id: candidate.detector_id.clone() });
    }
    if request.reason.trim().is_empty() {
        return Err(DispositionChangeError::MissingReason);
    }
    let expected_digest = confirmation_digest(
        request.frame_id,
        request.candidate_id,
        request.new_disposition,
        request.reason,
        &frame.raster_sha256,
        frame.redacted_derivative_sha256.as_deref(),
        &session.policy_version,
        session.model_manifest_sha256.as_deref(),
        session.revision,
    );
    if request.confirmation_digest != Some(expected_digest.as_str()) {
        return Err(DispositionChangeError::MissingExplicitConfirmation);
    }
    Ok(())
}

/// C6A-003: the real action path — validates `request` against
/// `session` (via [`validate_review_action`]) and constructs the
/// [`EditEvent`] in the same guarded operation, rather than leaving
/// validation and construction as two steps a caller could pull apart
/// (and skip the first of). The caller still owns appending the
/// returned event to `session.edit_events` and the atomic,
/// expected-revision-checked write — [`crate::sop_workspace`]'s
/// existing job, unchanged by this function.
pub fn build_redaction_change_event(
    session: &SopSessionV1,
    request: &ReviewActionRequest,
    event_id: String,
    local_timestamp: String,
) -> Result<EditEvent, DispositionChangeError> {
    validate_review_action(session, request)?;
    let sequence = session.edit_events.iter().map(|e| e.sequence).max().map_or(0, |s| s + 1);
    Ok(EditEvent {
        sequence,
        event_id,
        session_revision_before: session.revision,
        session_revision_after: session.revision + 1,
        operation: EditOperation::RedactionChange {
            frame_id: request.frame_id.to_string(),
            candidate_id: request.candidate_id.to_string(),
            disposition: request.new_disposition,
        },
        before_digest: None,
        after_digest: None,
        local_timestamp,
    })
}

/// GS-C6's "Delete/hide: cannot remove a hard positive or unresolved
/// region from coverage" rule. C6A-002: this previously reported
/// `MarkNonSensitive` as resolving a candidate on the enum value alone
/// — but at this same head, [`verify_coverage_proof`] still refuses
/// *every* `MarkNonSensitive` override outright
/// (`OverrideAuthorityContentUnsupported`), since the durable event
/// schema cannot yet carry the required reason/confirmation. Calling
/// that "resolved" here would assert two incompatible authorities: this
/// helper saying settled while the proof layer says unsupported. Until
/// the versioned authority-content schema and guarded write path exist,
/// only [`Disposition::Redact`] actually resolves a candidate. A C2-P6
/// UI action that wants a candidate's box to stop demanding attention
/// has to reach `Redact` through the normal, audited path — there is no
/// separate "hide" operation this crate exposes, and the complete
/// unfiltered candidate inventory must continue into coverage proof
/// regardless of what the UI chooses to display.
pub fn disposition_resolves_candidate(disposition: Disposition) -> bool {
    disposition == Disposition::Redact
}

/// Brief §3.5 check 3 in full: every candidate must have reached a real
/// disposition, every categorically-unredactable hard positive must
/// specifically be `Redact`, and any `MarkNonSensitive` override must be
/// backed by a recorded disposition event — never accepted on the enum
/// value alone (C2P3-005). Returns every failure found, not just the
/// first — the caller needs the complete list to show a reviewer.
/// `edit_events` lets this function resolve each `disposition_event_id`
/// against the append-only edit log (brief §4 `EditEvent`) rather than
/// accepting any syntactically present string: C688-005A closed the gap
/// where an arbitrary, nonexistent, or stale event id satisfied the
/// previous C2P3-005 check (which only tested `is_none()`). An id is
/// accepted only if it names the *current* (highest-sequence)
/// `RedactionChange` event recorded for that exact candidate, with a
/// `MarkNonSensitive` disposition — a superseded or unrelated event id
/// is rejected the same as a missing one.
///
/// **Disclosed boundary this still does not close**: brief §3.5 also
/// requires "a reason and explicit confirmation" for every override,
/// but `EditOperation::RedactionChange` (sop_session.rs, C2-P1's
/// already-merged contract) carries no reason/confirmation field at
/// all — there is nothing for this function to validate content-wise
/// even once it has resolved the correct, current event. Closing that
/// gap means changing an already-merged core session contract's wire
/// schema, which needs its own separately reviewed slice, not a change
/// bundled into this fix.
pub fn verify_coverage_proof(frame_id: &str, candidates: &[RedactionCandidate], edit_events: &[EditEvent]) -> Vec<CoverageProofFailure> {
    let mut failures = Vec::new();
    for c in candidates {
        if c.disposition == Disposition::Pending {
            failures.push(CoverageProofFailure::UndispositionedCandidate { candidate_id: c.candidate_id.clone() });
        }
        if is_unredactable_hard_positive(&c.detector_id) && c.disposition != Disposition::Redact {
            failures.push(CoverageProofFailure::UnredactableHardPositiveNotRedacted {
                candidate_id: c.candidate_id.clone(),
                detector_id: c.detector_id.clone(),
            });
        }
        if c.disposition == Disposition::MarkNonSensitive {
            match &c.disposition_event_id {
                None => {
                    failures.push(CoverageProofFailure::UnevidencedOverride { candidate_id: c.candidate_id.clone() });
                }
                Some(event_id) => {
                    // C688-005A.1: candidate ids are only unique *within*
                    // a frame (brief §4 / validate_frame), so resolution
                    // must match on frame id *and* candidate id — never
                    // candidate id alone across the whole session's edit
                    // log, which could resolve to (or be shadowed by) an
                    // unrelated frame's same-named candidate.
                    let current_for_candidate = edit_events
                        .iter()
                        .filter(|e| {
                            matches!(&e.operation, EditOperation::RedactionChange { frame_id: fid, candidate_id, .. } if fid == frame_id && candidate_id == &c.candidate_id)
                        })
                        .max_by_key(|e| e.sequence);
                    let resolved = match current_for_candidate {
                        Some(event) if &event.event_id == event_id => {
                            matches!(&event.operation, EditOperation::RedactionChange { disposition: Disposition::MarkNonSensitive, .. })
                        }
                        _ => false,
                    };
                    if !resolved {
                        failures.push(CoverageProofFailure::UnresolvedOverrideEvent {
                            candidate_id: c.candidate_id.clone(),
                            disposition_event_id: event_id.clone(),
                        });
                    } else {
                        // C688-005A re-opened: resolving to a real,
                        // current, correctly frame-scoped event is
                        // necessary but not sufficient — that event
                        // cannot carry the required reason/explicit
                        // confirmation at all today (see the failure's
                        // own doc comment), so every override still
                        // fails coverage until a separately reviewed
                        // schema change adds that evidence.
                        failures.push(CoverageProofFailure::OverrideAuthorityContentUnsupported {
                            candidate_id: c.candidate_id.clone(),
                            disposition_event_id: event_id.clone(),
                        });
                    }
                }
            }
        }
    }
    failures
}

/// Everything [`compute_frame_verification`] needs before it can even
/// consider `Verified` — C2P3-004: a partial detector module (this round
/// has no context-dependent rules, structural pass, or NER yet) must
/// never let its result quietly stand in for full coverage just because
/// the checks it *can* run all happened to pass on vacuous/empty input.
/// Every field here must be explicitly supplied by the caller; there is
/// no default that favors `Verified`.
#[derive(Debug, Clone, PartialEq)]
pub struct FrameVerificationEvidence {
    /// From [`verify_pixel_proof`]`.is_ok()`.
    pub pixel_proof_passed: bool,
    pub removal_proof: RemovalProofResult,
    /// From [`verify_coverage_proof`].
    pub coverage_failures: Vec<CoverageProofFailure>,
    /// OCR actually ran and produced tokens for this frame — not merely
    /// "never attempted" being indistinguishable from "ran and found
    /// nothing." An OCR failure must never be encoded as a successful
    /// empty result.
    pub ocr_succeeded: bool,
    /// From [`bind_matches_to_candidates`]'s `BindingResult::unbound_matches.len()`
    /// — a nonzero count means at least one detection could not be
    /// safely turned into a candidate at all, which no later proof over
    /// the surviving candidates can see or compensate for.
    pub unbound_match_count: usize,
    /// True only once every rule family this release requires has
    /// actually run on this frame — today that means every
    /// context-free *and* context-dependent deterministic rule plus the
    /// structural/UI evidence pass (brief §3.2/§3.3). NER (C2-P4) is
    /// explicitly not required here. No caller in this codebase can
    /// honestly pass `true` yet: the context-dependent rules and
    /// structural pass are still outstanding follow-up rounds of this
    /// same slice, so `Verified` stays genuinely unreachable until they
    /// land — that is this field's entire purpose.
    pub required_detectors_complete: bool,
    /// Source/derivative/policy/model-manifest digest bindings were
    /// checked and matched (`sop_session::check_source_binding` and
    /// this frame's own recorded `policy_version`/`model_manifest_sha256`
    /// — this function doesn't duplicate that check, only gates on its
    /// result).
    pub identities_verified: bool,
}

/// Folds all evidence into the brief §3.5 state machine. `Verified`
/// requires every field in `evidence` to affirmatively hold — an
/// incomplete detector pass, a failed identity check, or any unbound
/// match blocks it exactly like a failed proof would, never falling back
/// to treating missing evidence as passing evidence (C2P3-004).
///
/// Judgment call, flagged for review: any coverage failure means a human
/// decision is still needed or was overridden incorrectly, so it maps to
/// `ReviewRequired`; every other kind of incompleteness or failure here
/// — OCR failure, an unbound match, an incomplete detector pass, a
/// failed identity check, or a failed pixel/removal proof — means the
/// detection/redaction process itself did not hold or complete, which
/// re-review alone cannot fix, so it maps to `Blocked`. Brief §3.5:
/// "transitions the step to REVIEW_REQUIRED or BLOCKED, never VERIFIED"
/// either way.
pub fn compute_frame_verification(evidence: &FrameVerificationEvidence) -> FrameVerification {
    if !evidence.ocr_succeeded
        || evidence.unbound_match_count > 0
        || !evidence.required_detectors_complete
        || !evidence.identities_verified
        || !evidence.pixel_proof_passed
        || !matches!(evidence.removal_proof, RemovalProofResult::Clean)
    {
        return FrameVerification::Blocked;
    }
    if !evidence.coverage_failures.is_empty() {
        return FrameVerification::ReviewRequired;
    }
    FrameVerification::Verified
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sop_session::{ReviewState, SourceFrame, SourceStorage, SOP_SESSION_KIND, SOP_SESSION_SCHEMA_VERSION};

    fn matches_for(text: &str) -> Vec<DeterministicMatch> {
        detect_context_free(text)
    }

    fn matched_text<'a>(text: &'a str, m: &DeterministicMatch) -> &'a str {
        &text[m.start_byte..m.end_byte]
    }

    // ---- email ----

    #[test]
    fn email_simple_dotted_domain_is_matched() {
        let text = "contact jane.doe@example.com for details";
        let hits = matches_for(text);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].rule_id, "det.email");
        assert_eq!(matched_text(text, &hits[0]), "jane.doe@example.com");
    }

    #[test]
    fn email_allowlisted_single_label_domain_is_matched() {
        let text = "admin@localhost is the sender";
        let hits = matches_for(text);
        assert_eq!(hits.len(), 1);
        assert_eq!(matched_text(text, &hits[0]), "admin@localhost");
    }

    #[test]
    fn email_non_allowlisted_single_label_domain_is_not_matched() {
        let text = "user@internalhost";
        assert!(matches_for(text).is_empty());
    }

    #[test]
    fn email_local_part_starting_with_dot_is_not_matched() {
        let text = ".bad@example.com";
        assert!(matches_for(text).is_empty());
    }

    #[test]
    fn email_oversized_local_part_is_not_matched() {
        let local = "a".repeat(EMAIL_LOCAL_MAX + 1);
        let text = format!("{local}@example.com");
        assert!(matches_for(&text).is_empty());
    }

    #[test]
    fn email_label_starting_with_hyphen_is_not_matched() {
        let text = "user@-example.com";
        assert!(matches_for(text).is_empty());
    }

    // ---- SSN / ITIN ----

    #[test]
    fn ssn_hyphenated_valid_shape_is_matched() {
        let text = "SSN: 219-09-9999 on file";
        let hits = matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.ssn").count(), 1);
        let m = hits.iter().find(|m| m.rule_id == "det.ssn").unwrap();
        assert_eq!(matched_text(text, m), "219-09-9999");
    }

    #[test]
    fn ssn_space_separated_valid_shape_is_matched() {
        let text = "219 09 9999";
        let hits = matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.ssn").count(), 1);
    }

    #[test]
    fn ssn_unseparated_valid_shape_is_matched() {
        let text = "219099999";
        let hits = matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.ssn").count(), 1);
    }

    #[test]
    fn ssn_area_000_is_rejected() {
        assert!(matches_for("000-12-3456").iter().all(|m| m.rule_id != "det.ssn"));
    }

    #[test]
    fn ssn_area_666_is_rejected() {
        assert!(matches_for("666-12-3456").iter().all(|m| m.rule_id != "det.ssn"));
    }

    #[test]
    fn ssn_group_00_is_rejected() {
        assert!(matches_for("219-00-3456").iter().all(|m| m.rule_id != "det.ssn"));
    }

    #[test]
    fn ssn_serial_0000_is_rejected() {
        assert!(matches_for("219-12-0000").iter().all(|m| m.rule_id != "det.ssn"));
    }

    #[test]
    fn ssn_mixed_separators_is_rejected() {
        assert!(matches_for("219-12 3456").iter().all(|m| m.rule_id != "det.ssn"));
    }

    #[test]
    fn ssn_embedded_in_longer_digit_run_is_rejected() {
        // Ten digits is not a bounded nine-digit shape.
        assert!(matches_for("2190099999").iter().all(|m| m.rule_id != "det.ssn"));
    }

    #[test]
    fn itin_valid_shape_is_matched_as_itin_not_ssn() {
        let text = "ITIN 912-70-1234 on form";
        let hits = matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.itin").count(), 1);
        assert!(hits.iter().all(|m| m.rule_id != "det.ssn"));
    }

    #[test]
    fn itin_disallowed_group_89_is_rejected() {
        assert!(matches_for("912-89-1234").iter().all(|m| m.rule_id != "det.itin"));
    }

    #[test]
    fn ssn_with_unicode_dash_separator_is_matched() {
        // U+2010 HYPHEN folds to ascii '-'.
        let text = "219\u{2010}09\u{2010}9999";
        let hits = matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.ssn").count(), 1);
        let m = hits.iter().find(|m| m.rule_id == "det.ssn").unwrap();
        // Source offsets must span the full original (multi-byte) string.
        assert_eq!(m.start_byte, 0);
        assert_eq!(m.end_byte, text.len());
    }

    // ---- payment card (Luhn) ----

    #[test]
    fn luhn_valid_card_is_matched() {
        // A well-known Luhn-valid test number.
        let text = "card 4111 1111 1111 1111 on file";
        let hits = matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.payment_card").count(), 1);
    }

    #[test]
    fn luhn_invalid_card_shape_is_not_matched() {
        let text = "card 4111 1111 1111 1112 on file";
        assert!(matches_for(text).iter().all(|m| m.rule_id != "det.payment_card"));
    }

    #[test]
    fn card_shorter_than_13_digits_is_not_matched() {
        assert!(matches_for("123456789012").iter().all(|m| m.rule_id != "det.payment_card"));
    }

    #[test]
    fn card_longer_than_19_digits_is_not_matched() {
        let digits = "1".repeat(20);
        assert!(matches_for(&digits).iter().all(|m| m.rule_id != "det.payment_card"));
    }

    #[test]
    fn card_with_hyphen_separators_is_matched_when_luhn_valid() {
        let text = "4111-1111-1111-1111";
        let hits = matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.payment_card").count(), 1);
    }

    // ---- JWT ----

    #[test]
    fn well_formed_jwt_is_matched() {
        // header: {"alg":"none"} -> base64url (no padding)
        let header = base64url_encode_for_test(br#"{"alg":"none"}"#);
        let payload = base64url_encode_for_test(br#"{"sub":"1234567890","name":"Jane"}"#);
        let text = format!("token={header}.{payload}.abcdEFGH1234");
        let hits = matches_for(&text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.jwt").count(), 1);
    }

    #[test]
    fn jwt_with_non_json_header_is_not_matched() {
        let header = base64url_encode_for_test(b"not-json-at-all");
        let payload = base64url_encode_for_test(b"also not json but long enough");
        let text = format!("{header}.{payload}.abcdEFGH1234");
        assert!(matches_for(&text).iter().all(|m| m.rule_id != "det.jwt"));
    }

    #[test]
    fn jwt_with_too_short_signature_is_not_matched() {
        let header = base64url_encode_for_test(br#"{"alg":"none"}"#);
        let payload = base64url_encode_for_test(br#"{"sub":"1"}"#);
        let text = format!("{header}.{payload}.ab");
        assert!(matches_for(&text).iter().all(|m| m.rule_id != "det.jwt"));
    }

    #[test]
    fn jwt_with_only_two_segments_is_not_matched() {
        let header = base64url_encode_for_test(br#"{"alg":"none"}"#);
        let text = format!("{header}.onlyoneseg");
        assert!(matches_for(&text).iter().all(|m| m.rule_id != "det.jwt"));
    }

    #[test]
    fn jwt_with_a_fourth_segment_is_not_matched_and_does_not_rescan_the_rest() {
        let header = base64url_encode_for_test(br#"{"alg":"none"}"#);
        let text = format!("{header}.payload.signature.fourthsegment");
        assert!(matches_for(&text).iter().all(|m| m.rule_id != "det.jwt"));
    }

    #[test]
    fn a_long_repeated_dot_chain_does_not_scan_quadratically() {
        // C2P3-006: a prior version re-scanned the entire remaining
        // dot-chain from *every* segment's own start position, making
        // this O(segments^2). 20,000 short dot-separated segments is
        // cheap if the scan is properly bounded (each start position
        // gives up after at most 4 segments) and would be unworkably
        // slow if it regressed back to quadratic.
        let text = "aaaa.".repeat(20_000);
        let started = std::time::Instant::now();
        let hits = matches_for(&text);
        let elapsed = started.elapsed();
        assert!(hits.iter().all(|m| m.rule_id != "det.jwt"));
        assert!(elapsed < std::time::Duration::from_secs(2), "took {elapsed:?} - detect_jwt must stay bounded, not quadratic");
    }

    fn base64url_encode_for_test(bytes: &[u8]) -> String {
        const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut out = String::new();
        let mut buf = 0u32;
        let mut bits = 0u32;
        for &b in bytes {
            buf = (buf << 8) | b as u32;
            bits += 8;
            while bits >= 6 {
                bits -= 6;
                out.push(TABLE[((buf >> bits) & 0x3F) as usize] as char);
            }
        }
        if bits > 0 {
            out.push(TABLE[((buf << (6 - bits)) & 0x3F) as usize] as char);
        }
        out
    }

    // ---- PEM private key ----

    #[test]
    fn rsa_pem_private_key_block_is_matched() {
        let text = "-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJB\n-----END RSA PRIVATE KEY-----";
        let hits = matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.pem_private_key").count(), 1);
        let m = hits.iter().find(|m| m.rule_id == "det.pem_private_key").unwrap();
        assert_eq!(m.start_byte, 0);
        assert_eq!(m.end_byte, text.len());
    }

    #[test]
    fn plain_pem_private_key_label_is_matched() {
        let text = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----";
        let hits = matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.pem_private_key").count(), 1);
    }

    #[test]
    fn pem_public_key_is_not_matched_by_private_key_rule() {
        let text = "-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----";
        assert!(matches_for(text).iter().all(|m| m.rule_id != "det.pem_private_key"));
    }

    #[test]
    fn pem_header_without_matching_footer_is_not_matched() {
        let text = "-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END EC PRIVATE KEY-----";
        assert!(matches_for(text).iter().all(|m| m.rule_id != "det.pem_private_key"));
    }

    #[test]
    fn pem_header_with_no_footer_at_all_is_not_matched() {
        let text = "-----BEGIN RSA PRIVATE KEY-----\nabc more text, no footer here";
        assert!(matches_for(text).iter().all(|m| m.rule_id != "det.pem_private_key"));
    }

    // ---- AWS access key id ----

    #[test]
    fn aws_akia_key_is_matched() {
        let text = "key=AKIAIOSFODNN7EXAMPLE in config";
        let hits = matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.aws_access_key_id").count(), 1);
        let m = hits.iter().find(|m| m.rule_id == "det.aws_access_key_id").unwrap();
        assert_eq!(matched_text(text, m), "AKIAIOSFODNN7EXAMPLE");
    }

    #[test]
    fn aws_asia_key_is_matched() {
        let text = "ASIAIOSFODNN7EXAMPLE";
        let hits = matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.aws_access_key_id").count(), 1);
    }

    #[test]
    fn aws_key_with_wrong_body_length_is_not_matched() {
        let text = "AKIASHORT";
        assert!(matches_for(text).iter().all(|m| m.rule_id != "det.aws_access_key_id"));
    }

    #[test]
    fn aws_key_embedded_in_a_longer_identifier_is_not_matched() {
        let text = "XAKIAIOSFODNN7EXAMPLE";
        assert!(matches_for(text).iter().all(|m| m.rule_id != "det.aws_access_key_id"));
    }

    #[test]
    fn aws_key_followed_by_more_identifier_chars_is_not_matched() {
        let text = "AKIAIOSFODNN7EXAMPLEX";
        assert!(matches_for(text).iter().all(|m| m.rule_id != "det.aws_access_key_id"));
    }

    // ---- GitHub token ----

    #[test]
    fn github_classic_pat_is_matched() {
        let text = format!("token ghp_{} end", "a".repeat(36));
        let hits = matches_for(&text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.github_token_classic_pat").count(), 1);
    }

    #[test]
    fn github_fine_grained_pat_is_matched() {
        let text = format!("github_pat_{}", "b".repeat(40));
        let hits = matches_for(&text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.github_token_fine_grained_pat").count(), 1);
    }

    #[test]
    fn github_token_payload_too_short_is_not_matched() {
        let text = "ghp_short";
        assert!(matches_for(text).iter().all(|m| !m.rule_id.starts_with("det.github_token")));
    }

    #[test]
    fn github_token_embedded_in_longer_identifier_is_not_matched() {
        let text = format!("xghp_{}", "a".repeat(36));
        assert!(matches_for(&text).iter().all(|m| !m.rule_id.starts_with("det.github_token")));
    }

    // ---- context-dependent rules (round 3) ----

    fn dep_matches_for(text: &str) -> Vec<DeterministicMatch> {
        detect_context_dependent(text)
    }

    #[test]
    fn bearer_token_is_matched() {
        let text = "Authorization: Bearer abc123XYZ.def456";
        let hits = dep_matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.bearer_auth").count(), 1);
        let m = hits.iter().find(|m| m.rule_id == "det.bearer_auth").unwrap();
        assert_eq!(&text[m.start_byte..m.end_byte], "Bearer abc123XYZ.def456");
    }

    #[test]
    fn basic_auth_value_is_matched() {
        let text = "Authorization: Basic dXNlcjpwYXNz";
        let hits = dep_matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.basic_auth").count(), 1);
    }

    #[test]
    fn bearer_with_too_short_a_value_is_not_matched() {
        let text = "Bearer abc";
        assert!(dep_matches_for(text).iter().all(|m| m.rule_id != "det.bearer_auth"));
    }

    #[test]
    fn cookie_header_value_is_matched() {
        let text = "Cookie: sessionid=abc123; other=xyz";
        let hits = dep_matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.cookie_header").count(), 1);
        let m = hits.iter().find(|m| m.rule_id == "det.cookie_header").unwrap();
        // Matches the whole header line, consistent with how
        // bearer/basic also include their own label in the match.
        assert_eq!(&text[m.start_byte..m.end_byte], "Cookie: sessionid=abc123; other=xyz");
    }

    #[test]
    fn set_cookie_header_value_is_matched() {
        let text = "Set-Cookie: token=xyz789";
        let hits = dep_matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.cookie_header").count(), 1);
    }

    #[test]
    fn sensitive_key_value_password_form_is_matched() {
        let text = "password: s3cr3tValue";
        let hits = dep_matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.sensitive_key_value").count(), 1);
        let m = hits.iter().find(|m| m.rule_id == "det.sensitive_key_value").unwrap();
        assert_eq!(&text[m.start_byte..m.end_byte], "password: s3cr3tValue");
    }

    #[test]
    fn sensitive_key_value_url_query_param_form_is_matched() {
        // Brief's "URI query/fragment values" shape is the same
        // key=value this matcher already finds, regardless of the
        // leading '?'/'&'.
        let text = "https://example.com/reset?token=abcDEF123&other=1";
        let hits = dep_matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.sensitive_key_value").count(), 1);
        let m = hits.iter().find(|m| m.rule_id == "det.sensitive_key_value").unwrap();
        assert_eq!(&text[m.start_byte..m.end_byte], "token=abcDEF123");
    }

    #[test]
    fn sensitive_key_value_quoted_json_form_is_matched() {
        let text = r#"{"secret": "abc123"}"#;
        let hits = dep_matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.sensitive_key_value").count(), 1);
        let m = hits.iter().find(|m| m.rule_id == "det.sensitive_key_value").unwrap();
        assert_eq!(&text[m.start_byte..m.end_byte], r#"secret": "abc123""#);
    }

    #[test]
    fn a_compound_identifier_containing_a_sensitive_word_is_not_matched() {
        // Brief: "a normalized key IS one of the above sensitive
        // labels" - an exact match, not a substring of a longer
        // identifier like "session_token".
        let text = "session_token: abc123";
        assert!(dep_matches_for(text).iter().all(|m| m.rule_id != "det.sensitive_key_value"));
    }

    #[test]
    fn a_non_sensitive_key_value_form_is_not_matched() {
        let text = "username: bob";
        assert!(dep_matches_for(text).iter().all(|m| m.rule_id != "det.sensitive_key_value"));
    }

    #[test]
    fn otp_with_nearby_label_is_matched() {
        let text = "Your OTP is 482913, do not share it";
        let hits = dep_matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.otp_pin").count(), 1);
    }

    #[test]
    fn a_bare_six_digit_number_with_no_label_is_not_matched_as_otp() {
        let text = "order number 482913 shipped today";
        assert!(dep_matches_for(text).iter().all(|m| m.rule_id != "det.otp_pin"));
    }

    #[test]
    fn otp_label_on_a_different_line_does_not_count_as_context() {
        let text = "OTP sent separately\n482913 is unrelated";
        assert!(dep_matches_for(text).iter().all(|m| m.rule_id != "det.otp_pin"));
    }

    #[test]
    fn aba_routing_number_with_context_is_matched() {
        // 021000021 is a real, valid ABA checksum (Chase's published
        // routing number), used here purely as a checksum fixture.
        let text = "routing number 021000021 on file";
        let hits = dep_matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.aba_routing_number").count(), 1);
    }

    #[test]
    fn nine_digits_with_valid_checksum_but_no_context_is_not_matched_as_routing() {
        let text = "021000021";
        assert!(dep_matches_for(text).iter().all(|m| m.rule_id != "det.aba_routing_number"));
    }

    #[test]
    fn nine_digits_with_context_but_invalid_checksum_is_not_matched_as_routing() {
        let text = "routing number 021000029 on file"; // bad checksum
        assert!(dep_matches_for(text).iter().all(|m| m.rule_id != "det.aba_routing_number"));
    }

    #[test]
    fn account_number_with_context_is_matched() {
        let text = "account number AB123456 on the statement";
        let hits = dep_matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.account_number").count(), 1);
    }

    #[test]
    fn account_number_shape_with_no_context_is_not_matched() {
        let text = "AB123456 appears on the page";
        assert!(dep_matches_for(text).iter().all(|m| m.rule_id != "det.account_number"));
    }

    #[test]
    fn a_pure_alpha_run_with_account_context_is_not_matched() {
        // Must contain at least one digit - "arbitrary long number"
        // guard equivalent for alphanumeric account shapes.
        let text = "account holder JOHNDOESMITH on file";
        assert!(dep_matches_for(text).iter().all(|m| m.rule_id != "det.account_number"));
    }

    // ---- cross-cutting / bounded-adversarial-input ----

    #[test]
    fn zero_width_space_inserted_mid_shape_defeats_the_match() {
        // An adversary splits a card number with a zero-width space to
        // evade a naive regex; this must NOT produce a false negative by
        // accident becoming a false *positive* of some other shape, but
        // it also must not crash or hang on bounded adversarial input.
        let text = format!("4111 1111\u{200B} 1111 1111");
        let hits = matches_for(&text);
        // Zero-width is dropped, so the digits rejoin and Luhn still
        // matches - proving the dropped-not-folded design defeats this
        // specific evasion rather than letting it slip through unnoticed.
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.payment_card").count(), 1);
    }

    #[test]
    fn long_adversarial_digit_run_does_not_hang_or_panic() {
        let text = "9".repeat(50_000);
        let hits = matches_for(&text);
        // No assertion on content - this is a bounded-time/no-panic check.
        let _ = hits;
    }

    #[test]
    fn empty_text_produces_no_matches() {
        assert!(matches_for("").is_empty());
    }

    #[test]
    fn full_width_digits_in_an_ssn_shape_are_matched() {
        // U+FF12 U+FF11 U+FF19 etc. (full-width "219099999") fold to ascii.
        let text = "\u{FF12}\u{FF11}\u{FF19}\u{FF10}\u{FF19}\u{FF19}\u{FF19}\u{FF19}\u{FF19}";
        let hits = matches_for(text);
        assert_eq!(hits.iter().filter(|m| m.rule_id == "det.ssn").count(), 1);
    }

    #[test]
    fn multiple_distinct_hits_in_one_text_are_all_reported_in_order() {
        let text = "email a@example.com and ssn 219-09-9999 together";
        let hits = matches_for(text);
        assert_eq!(hits.len(), 2);
        assert!(hits[0].start_byte < hits[1].start_byte);
    }

    // ---- candidate box binding ----

    fn token(id: &str, text: &str, line_id: &str, box_: (i64, i64, u64, u64)) -> OcrToken {
        OcrToken {
            token_id: id.to_string(),
            text: text.to_string(),
            box_x: box_.0,
            box_y: box_.1,
            box_w: box_.2,
            box_h: box_.3,
            line_id: line_id.to_string(),
            language: "en".to_string(),
            confidence: 0.99,
            engine_identity: "test-engine".to_string(),
        }
    }

    #[test]
    fn join_tokens_same_line_joins_with_a_space_and_reports_exact_spans() {
        let tokens = vec![token("t1", "ssn", "l1", (0, 0, 10, 10)), token("t2", "219-09-9999", "l1", (12, 0, 40, 10))];
        let (text, spans) = join_tokens(&tokens);
        assert_eq!(text, "ssn 219-09-9999");
        assert_eq!(&text[spans[0].0..spans[0].1], "ssn");
        assert_eq!(&text[spans[1].0..spans[1].1], "219-09-9999");
    }

    #[test]
    fn join_tokens_different_lines_joins_with_a_newline() {
        let tokens = vec![token("t1", "first", "l1", (0, 0, 10, 10)), token("t2", "second", "l2", (0, 20, 10, 10))];
        let (text, _) = join_tokens(&tokens);
        assert_eq!(text, "first\nsecond");
    }

    #[test]
    fn single_token_candidate_binds_to_that_tokens_box_expanded_and_clipped() {
        let tokens = vec![token("t1", "219-09-9999", "l1", (10, 10, 100, 20))];
        let (text, spans) = join_tokens(&tokens);
        let hits = detect_context_free(&text);
        assert_eq!(hits.len(), 1);
        let result = bind_matches_to_candidates(&hits, &tokens, &spans, text.len(), 1000, 1000, "frame-1").unwrap();
        assert!(result.unbound_matches.is_empty());
        assert_eq!(result.candidates.len(), 1);
        let c = &result.candidates[0];
        assert_eq!(c.candidate_id, "frame-1-0");
        assert_eq!(c.detector_id, "det.ssn");
        assert_eq!(c.source_token_ids, vec!["t1".to_string()]);
        assert_eq!(c.original_box, (10, 10, 100, 20));
        // Expansion: MIN_EXPAND_PX=4 + glyph stroke estimate(20/12=1) = 5.
        assert_eq!(c.expanded_box, (5, 5, 110, 30));
        // Every rule in this module is a hard positive (brief §3.2), so
        // the default disposition is Redact outright, not Pending.
        assert_eq!(c.disposition, Disposition::Redact);
        assert!(c.disposition_event_id.is_none());
    }

    #[test]
    fn multi_token_match_unions_both_token_boxes() {
        // Two tokens side by side on the same line whose concatenated
        // text forms one SSN shape (tokenization split across tokens is
        // realistic - OCR often tokenizes by whitespace-delimited runs,
        // and a hyphenated shape could still land as separate tokens
        // depending on the engine).
        let tokens = vec![token("t1", "219-09-", "l1", (10, 10, 50, 20)), token("t2", "9999", "l1", (65, 10, 20, 20))];
        let (text, spans) = join_tokens(&tokens);
        assert_eq!(text, "219-09- 9999");
        let hits = detect_context_free(&text);
        // The joining space breaks the shape unless the matcher tolerates
        // it; our SSN matcher requires a consistent separator with no
        // extra space, so assert on whatever the matcher actually finds
        // instead of assuming a specific outcome - this test's real
        // purpose is proving the union math when two tokens *do* get
        // bound to one candidate, using a match that deliberately spans
        // both tokens' byte ranges regardless of rule outcome.
        let synthetic_match = DeterministicMatch { start_byte: 0, end_byte: text.len(), rule_id: "det.test", reason_code: "TEST", score: None };
        let result = bind_matches_to_candidates(&[synthetic_match], &tokens, &spans, text.len(), 1000, 1000, "frame-1").unwrap();
        assert!(result.unbound_matches.is_empty());
        assert_eq!(result.candidates.len(), 1);
        assert_eq!(result.candidates[0].source_token_ids, vec!["t1".to_string(), "t2".to_string()]);
        // Union of (10,10,50,20) and (65,10,20,20): right edges 60 and 85 -> union width 75.
        assert_eq!(result.candidates[0].original_box, (10, 10, 75, 20));
        let _ = hits;
    }

    #[test]
    fn expansion_clips_to_the_frame_raster_at_the_edge() {
        let tokens = vec![token("t1", "219-09-9999", "l1", (0, 0, 100, 20))];
        let (text, spans) = join_tokens(&tokens);
        let hits = detect_context_free(&text);
        let result = bind_matches_to_candidates(&hits, &tokens, &spans, text.len(), 100, 20, "frame-1").unwrap();
        assert_eq!(result.candidates.len(), 1);
        // Expansion would go to x=-5,y=-5,right=105,bottom=25; clipped to
        // the 100x20 frame.
        assert_eq!(result.candidates[0].expanded_box, (0, 0, 100, 20));
    }

    #[test]
    fn a_match_covering_no_token_is_reported_as_unbound_not_silently_dropped() {
        // C2P3-001: a lost hard-positive detection must be visible data,
        // never an absent one.
        // "ab cd": token spans are (0,2) and (3,5); byte range 2..3 is the
        // separating space itself, overlapping neither token's span.
        let tokens = vec![token("t1", "ab", "l1", (0, 0, 10, 10)), token("t2", "cd", "l1", (20, 0, 10, 10))];
        let (text, spans) = join_tokens(&tokens);
        assert_eq!(text, "ab cd");
        let synthetic_match = DeterministicMatch { start_byte: 2, end_byte: 3, rule_id: "det.test", reason_code: "TEST", score: None };
        let result = bind_matches_to_candidates(&[synthetic_match.clone()], &tokens, &spans, text.len(), 1000, 1000, "frame-1").unwrap();
        assert!(result.candidates.is_empty());
        assert_eq!(result.unbound_matches, vec![synthetic_match]);
    }

    #[test]
    fn a_covered_token_with_an_invalid_box_is_reported_as_unbound() {
        // C2P3-002's binding-side half: an out-of-frame token box must
        // never be silently clipped into an apparently-safe candidate -
        // it has to surface as an unbound match instead.
        let tokens = vec![token("t1", "219-09-9999", "l1", (-5, 0, 10, 10))]; // negative x: invalid
        let (text, spans) = join_tokens(&tokens);
        let hits = detect_context_free(&text);
        assert_eq!(hits.len(), 1);
        let result = bind_matches_to_candidates(&hits, &tokens, &spans, text.len(), 1000, 1000, "frame-1").unwrap();
        assert!(result.candidates.is_empty());
        assert_eq!(result.unbound_matches.len(), 1);
    }

    #[test]
    fn mismatched_tokens_and_spans_length_is_rejected_not_indexed() {
        let tokens = vec![token("t1", "hello", "l1", (0, 0, 10, 10))];
        let spans: Vec<(usize, usize)> = vec![]; // deliberately mismatched length
        let err = bind_matches_to_candidates(&[], &tokens, &spans, 5, 1000, 1000, "frame-1").unwrap_err();
        assert_eq!(err, BindMatchesError::SpanTableLengthMismatch { tokens_len: 1, spans_len: 0 });
    }

    #[test]
    fn a_span_table_entry_out_of_order_is_rejected() {
        let tokens = vec![token("t1", "a", "l1", (0, 0, 10, 10)), token("t2", "b", "l1", (0, 0, 10, 10))];
        let spans = vec![(5, 6), (0, 1)]; // decreasing, not a real join_tokens output
        let err = bind_matches_to_candidates(&[], &tokens, &spans, 10, 1000, 1000, "frame-1").unwrap_err();
        assert_eq!(err, BindMatchesError::InvalidSpanTable);
    }

    #[test]
    fn a_span_table_entry_past_the_joined_text_length_is_rejected() {
        let tokens = vec![token("t1", "a", "l1", (0, 0, 10, 10))];
        let spans = vec![(0, 100)]; // past the real joined-text length
        let err = bind_matches_to_candidates(&[], &tokens, &spans, 5, 1000, 1000, "frame-1").unwrap_err();
        assert_eq!(err, BindMatchesError::InvalidSpanTable);
    }

    #[test]
    fn a_match_past_the_joined_text_length_is_rejected() {
        let tokens = vec![token("t1", "hello", "l1", (0, 0, 10, 10))];
        let (text, spans) = join_tokens(&tokens);
        let bad_match = DeterministicMatch { start_byte: 0, end_byte: text.len() + 50, rule_id: "det.test", reason_code: "TEST", score: None };
        let err = bind_matches_to_candidates(&[bad_match], &tokens, &spans, text.len(), 1000, 1000, "frame-1").unwrap_err();
        assert!(matches!(err, BindMatchesError::MatchOutOfBounds { .. }));
    }

    #[test]
    fn every_context_free_rule_defaults_to_redact_not_pending() {
        // Brief §3.5: "a rule or structural hard positive cannot be
        // downgraded by the model" and the coverage proof requires every
        // hard positive is redacted outright - every rule in this module
        // is listed under §3.2's "Hard positives" heading, so none of
        // them should ever default to Pending awaiting a human decision.
        let tokens = vec![
            token("t1", "a@example.com", "l1", (0, 0, 10, 10)),
            token("t2", "219-09-9999", "l2", (0, 20, 10, 10)),
            token("t3", "4111-1111-1111-1111", "l3", (0, 40, 10, 10)),
            token("t4", "AKIAIOSFODNN7EXAMPLE", "l4", (0, 60, 10, 10)),
        ];
        let (text, spans) = join_tokens(&tokens);
        let hits = detect_context_free(&text);
        assert!(hits.len() >= 4, "expected at least 4 hard-positive hits, got {hits:?}");
        let result = bind_matches_to_candidates(&hits, &tokens, &spans, text.len(), 1000, 1000, "frame-1").unwrap();
        assert!(result.unbound_matches.is_empty());
        assert!(!result.candidates.is_empty());
        for c in &result.candidates {
            assert_eq!(c.disposition, Disposition::Redact, "{c:?} must default to Redact");
        }
    }

    #[test]
    fn candidate_ids_are_stable_and_scoped_by_the_given_prefix() {
        let tokens = vec![token("t1", "a@example.com", "l1", (0, 0, 10, 10)), token("t2", "219-09-9999", "l2", (0, 20, 10, 10))];
        let (text, spans) = join_tokens(&tokens);
        let hits = detect_context_free(&text);
        assert_eq!(hits.len(), 2);
        let result = bind_matches_to_candidates(&hits, &tokens, &spans, text.len(), 1000, 1000, "frame-xyz").unwrap();
        let ids: Vec<&str> = result.candidates.iter().map(|c| c.candidate_id.as_str()).collect();
        assert_eq!(ids, vec!["frame-xyz-0", "frame-xyz-1"]);
    }

    // ---- structural/UI evidence: image-only input-rectangle heuristic ----

    fn solid_rgba(width: u32, height: u32, color: (u8, u8, u8)) -> Vec<u8> {
        let mut buf = vec![0u8; width as usize * height as usize * 4];
        for px in buf.chunks_mut(4) {
            px[0] = color.0;
            px[1] = color.1;
            px[2] = color.2;
            px[3] = 255;
        }
        buf
    }

    fn fill_rect(buf: &mut [u8], width: u32, rect: (u32, u32, u32, u32), color: (u8, u8, u8)) {
        let (x, y, w, h) = rect;
        for row in y..y + h {
            for col in x..x + w {
                let idx = (row as usize * width as usize + col as usize) * 4;
                buf[idx] = color.0;
                buf[idx + 1] = color.1;
                buf[idx + 2] = color.2;
                buf[idx + 3] = 255;
            }
        }
    }

    #[test]
    fn a_clean_filled_rectangle_against_a_contrasting_background_is_detected() {
        let (width, height) = (100, 60);
        let mut buf = solid_rgba(width, height, (20, 20, 20));
        fill_rect(&mut buf, width, (10, 10, 60, 20), (220, 220, 220));
        let result = structural_candidates_from_image_rects(&buf, width, height, "frame-1").unwrap();
        assert_eq!(result.len(), 1, "{result:?}");
        let c = &result[0];
        assert_eq!(c.candidate_id, "frame-1-imgrect-0");
        assert_eq!(c.detector_id, "det.image_rect_input_field");
        assert_eq!(c.reason_code, "STRUCTURAL_UNKNOWN");
        assert_eq!(c.disposition, Disposition::Pending);
        assert!(c.source_token_ids.is_empty());
        assert_eq!(c.original_box, (10, 10, 60, 20));
        // MIN_EXPAND_PX (4) on each side, well within the frame so no clipping.
        assert_eq!(c.expanded_box, (6, 6, 68, 28));
    }

    #[test]
    fn two_adjacent_rectangles_sharing_a_border_are_both_detected() {
        // A realistic stacked-fields layout: two differently-shaded input
        // boxes directly touching, no gap between them.
        let (width, height) = (100, 80);
        let mut buf = solid_rgba(width, height, (0, 0, 0));
        fill_rect(&mut buf, width, (10, 10, 60, 20), (120, 120, 120));
        fill_rect(&mut buf, width, (10, 30, 60, 20), (200, 200, 200));
        let result = structural_candidates_from_image_rects(&buf, width, height, "frame-1").unwrap();
        let boxes: Vec<(i64, i64, u64, u64)> = result.iter().map(|c| c.original_box).collect();
        assert!(boxes.contains(&(10, 10, 60, 20)), "missing first field: {boxes:?}");
        assert!(boxes.contains(&(10, 30, 60, 20)), "missing second field: {boxes:?}");
        // Every candidate from this detector must come out STRUCTURAL_UNKNOWN/Pending,
        // never silently auto-redacted — including the one real-but-extra
        // combined box this border-only heuristic also matches here.
        for c in &result {
            assert_eq!(c.reason_code, "STRUCTURAL_UNKNOWN");
            assert_eq!(c.disposition, Disposition::Pending);
        }
    }

    #[test]
    fn low_amplitude_pixel_jitter_with_no_real_borders_produces_no_candidates() {
        // Deterministic xorshift32 jitter around one base gray value - no
        // rectangle shape anywhere, just per-pixel noise, same way sensor
        // noise or compression artifacts would look. Non-rectangle noise
        // must be rejected, not turned into phantom candidates.
        let (width, height) = (64, 64);
        let mut buf = vec![0u8; width as usize * height as usize * 4];
        let mut state: u32 = 0x1234_5678;
        for px in buf.chunks_mut(4) {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            let jitter = (state % 81) as i32 - 40; // -40..=40
            let v = (128 + jitter).clamp(0, 255) as u8;
            px[0] = v;
            px[1] = v;
            px[2] = v;
            px[3] = 255;
        }
        let result = structural_candidates_from_image_rects(&buf, width, height, "frame-1").unwrap();
        assert!(result.is_empty(), "{result:?}");
    }

    #[test]
    fn zero_dimension_is_reported_as_an_error_not_an_empty_success() {
        let buf = vec![0u8; 4];
        assert_eq!(structural_candidates_from_image_rects(&buf, 0, 10, "frame-1"), Err(ImageRectError::ZeroDimension));
        assert_eq!(structural_candidates_from_image_rects(&buf, 10, 0, "frame-1"), Err(ImageRectError::ZeroDimension));
    }

    #[test]
    fn mismatched_buffer_length_is_reported_as_an_error_not_an_empty_success() {
        let buf = vec![0u8; 10]; // too short for a declared 10x10 RGBA frame (400 bytes)
        assert_eq!(
            structural_candidates_from_image_rects(&buf, 10, 10, "frame-1"),
            Err(ImageRectError::BufferLengthMismatch { expected: 400, found: 10 })
        );
    }

    #[test]
    fn a_rectangle_too_small_to_plausibly_be_an_input_field_is_rejected() {
        let (width, height) = (60, 40);
        let mut buf = solid_rgba(width, height, (0, 0, 0));
        // 6x6: well under both IMAGE_RECT_MIN_WIDTH_PX and IMAGE_RECT_MIN_HEIGHT_PX.
        fill_rect(&mut buf, width, (10, 10, 6, 6), (220, 220, 220));
        let result = structural_candidates_from_image_rects(&buf, width, height, "frame-1").unwrap();
        assert!(result.is_empty(), "{result:?}");
    }

    #[test]
    fn overflowing_dimensions_are_rejected_instead_of_panicking() {
        // C691-003: the fail-before case - plain unchecked multiplication
        // of width*height*4 wraps to a small value for absurd
        // dimensions, letting an empty buffer pass the length gate and
        // then panic on the first pixel read.
        let huge = 1u32 << 31;
        let buf: Vec<u8> = vec![];
        assert_eq!(
            structural_candidates_from_image_rects(&buf, huge, huge, "frame-1"),
            Err(ImageRectError::DimensionsOverflow { width: huge, height: huge })
        );
    }

    #[test]
    fn decoded_size_exactly_at_the_128_mib_cap_is_admissible() {
        // C691-003A: 8192 x 4096 x 4 == 128 MiB exactly - the shared
        // artifact::MAX_ARTIFACT_BYTES cap. Tested against the
        // extracted admission helper, not the full entrypoint, so this
        // doesn't need to allocate a 128 MiB buffer.
        let (width, height): (u32, u32) = (8192, 4096);
        let decoded_bytes = width as u64 * height as u64 * 4;
        assert_eq!(decoded_bytes, crate::artifact::MAX_ARTIFACT_BYTES as u64);
        assert_eq!(check_decoded_size_admissible(width, height, decoded_bytes), Ok(()));
    }

    #[test]
    fn decoded_size_one_block_over_the_128_mib_cap_is_rejected() {
        // C691-003A exact counterexample: dimensions and buffer length
        // can both check out while still naming a decoded raster larger
        // than the documented 128 MiB decoded-RGBA cap - 8193 x 4096 x 4
        // is exactly 128 MiB + 16 KiB. Before this fix, no admission
        // check existed at all, so this buffer size would have reached
        // both pixel scans.
        let (width, height): (u32, u32) = (8193, 4096);
        let decoded_bytes = width as u64 * height as u64 * 4;
        assert_eq!(decoded_bytes, crate::artifact::MAX_ARTIFACT_BYTES as u64 + 16 * 1024);
        assert_eq!(
            check_decoded_size_admissible(width, height, decoded_bytes),
            Err(ImageRectError::DecodedSizeTooLarge { width, height, bytes: decoded_bytes })
        );
    }

    #[test]
    fn an_oversized_frame_is_refused_by_the_public_entrypoint_before_either_scan() {
        // Same oversized partner as above, exercised through the public
        // function this time, with a short/empty buffer standing in for
        // the (never allocated) 128 MiB+ raster - the size check must
        // run, and fail, before the buffer-length check that would
        // otherwise also reject this input for a different reason.
        let (width, height): (u32, u32) = (8193, 4096);
        let buf: Vec<u8> = vec![];
        let decoded_bytes = width as u64 * height as u64 * 4;
        assert_eq!(
            structural_candidates_from_image_rects(&buf, width, height, "frame-1"),
            Err(ImageRectError::DecodedSizeTooLarge { width, height, bytes: decoded_bytes })
        );
    }

    #[test]
    fn segment_exhaustion_is_reported_as_a_distinct_error_not_empty_success() {
        // C691-001: a frame busy enough to exceed
        // IMAGE_RECT_MAX_SEGMENTS_PER_AXIS, plus a real, well-formed
        // input field drawn into it, so a non-exhausted run on a
        // similar clean frame would NOT be empty - proving the
        // exhausted outcome is specifically about analysis
        // incompleteness, not an absence of real content. The result
        // must be a distinct error, never a clean-looking `Ok(vec![])`.
        let width = 20_000u32;
        let height = 20u32;
        let cell = IMAGE_RECT_MIN_EDGE_RUN_PX; // exactly the minimum qualifying run length
        let mut buf = vec![0u8; width as usize * height as usize * 4]; // starts solid black
        for y in 0..height {
            if y % 2 == 1 {
                // Odd rows: alternating cell-wide black/white blocks.
                // Compared against an even (solid black) row directly
                // above, each white block forms its own separate
                // qualifying run of exactly `cell` pixels - comparing
                // against the even row *below* it does the same, so
                // every row transition contributes roughly
                // width/(2*cell) new segments.
                let mut x = 0u32;
                let mut white = false;
                while x < width {
                    let block_end = (x + cell).min(width);
                    if white {
                        fill_rect(&mut buf, width, (x, y, block_end - x, 1), (255, 255, 255));
                    }
                    white = !white;
                    x = block_end;
                }
            }
        }
        fill_rect(&mut buf, width, (10, 2, 60, 10), (128, 128, 128));
        let result = structural_candidates_from_image_rects(&buf, width, height, "frame-1");
        assert!(matches!(result, Err(ImageRectError::AnalysisExhausted { .. })), "{result:?}");
    }

    #[test]
    fn a_clean_rectangle_with_no_noise_at_all_does_not_exhaust_analysis() {
        // Positive control alongside the exhaustion case above: an
        // ordinary clean frame must not spuriously report exhaustion.
        let (width, height) = (100, 60);
        let mut buf = solid_rgba(width, height, (20, 20, 20));
        fill_rect(&mut buf, width, (10, 10, 60, 20), (220, 220, 220));
        let result = structural_candidates_from_image_rects(&buf, width, height, "frame-1");
        assert!(result.is_ok(), "{result:?}");
    }

    // ---- merge + destructive redaction operation ----

    fn candidate(id: &str, box_: (i64, i64, u64, u64), disposition: Disposition) -> RedactionCandidate {
        RedactionCandidate {
            candidate_id: id.to_string(),
            detector_id: "det.test".to_string(),
            reason_code: "TEST".to_string(),
            source_token_ids: vec![],
            original_box: box_,
            expanded_box: box_,
            score: None,
            disposition,
            disposition_event_id: None,
        }
    }

    #[test]
    fn non_overlapping_boxes_are_not_merged() {
        let boxes = vec![(0, 0, 10, 10), (100, 100, 10, 10)];
        let merged = merge_overlapping_or_adjacent_boxes(boxes);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn overlapping_boxes_merge_into_one() {
        let boxes = vec![(0, 0, 10, 10), (5, 5, 10, 10)];
        let merged = merge_overlapping_or_adjacent_boxes(boxes);
        assert_eq!(merged, vec![(0, 0, 15, 15)]);
    }

    #[test]
    fn exactly_adjacent_boxes_merge_into_one() {
        // Second box starts exactly where the first ends on the x axis -
        // touching, not overlapping, and still must merge (brief §3.1:
        // "merge when overlapping/adjacent").
        let boxes = vec![(0, 0, 10, 10), (10, 0, 10, 10)];
        let merged = merge_overlapping_or_adjacent_boxes(boxes);
        assert_eq!(merged, vec![(0, 0, 20, 10)]);
    }

    #[test]
    fn a_small_gap_between_boxes_prevents_merging() {
        let boxes = vec![(0, 0, 10, 10), (11, 0, 10, 10)];
        let merged = merge_overlapping_or_adjacent_boxes(boxes);
        assert_eq!(merged.len(), 2);
    }

    #[test]
    fn a_chain_of_three_overlapping_boxes_merges_into_one() {
        let boxes = vec![(0, 0, 10, 10), (8, 0, 10, 10), (16, 0, 10, 10)];
        let merged = merge_overlapping_or_adjacent_boxes(boxes);
        assert_eq!(merged, vec![(0, 0, 26, 10)]);
    }

    #[test]
    fn redaction_regions_only_include_redact_dispositioned_candidates() {
        let candidates = vec![
            candidate("c1", (0, 0, 10, 10), Disposition::Redact),
            candidate("c2", (50, 50, 10, 10), Disposition::Pending),
            candidate("c3", (100, 100, 10, 10), Disposition::MarkNonSensitive),
        ];
        let regions = redaction_regions_for_frame(&candidates);
        assert_eq!(regions, vec![(0, 0, 10, 10)]);
    }

    #[test]
    fn apply_candidate_redactions_paints_only_the_redact_regions() {
        let width = 20u32;
        let height = 20u32;
        let mut rgba = vec![255u8; (width as usize) * (height as usize) * 4];
        let candidates = vec![
            candidate("c1", (0, 0, 5, 5), Disposition::Redact),
            candidate("c2", (10, 10, 5, 5), Disposition::MarkNonSensitive),
        ];
        apply_candidate_redactions(&mut rgba, width, height, &candidates);
        let pixel_at = |x: u32, y: u32| -> (u8, u8, u8, u8) {
            let idx = (y as usize * width as usize + x as usize) * 4;
            (rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3])
        };
        assert_eq!(pixel_at(2, 2), crate::annotations::REDACTION_PIXEL);
        // The MarkNonSensitive candidate's region must remain untouched.
        assert_eq!(pixel_at(12, 12), (255, 255, 255, 255));
    }

    #[test]
    fn apply_candidate_redactions_with_overlapping_candidates_paints_the_full_union_with_no_gap() {
        let width = 30u32;
        let height = 10u32;
        let mut rgba = vec![255u8; (width as usize) * (height as usize) * 4];
        let candidates =
            vec![candidate("c1", (0, 0, 10, 10), Disposition::Redact), candidate("c2", (10, 0, 10, 10), Disposition::Redact)];
        apply_candidate_redactions(&mut rgba, width, height, &candidates);
        let pixel_at = |x: u32, y: u32| -> (u8, u8, u8, u8) {
            let idx = (y as usize * width as usize + x as usize) * 4;
            (rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3])
        };
        // The seam at x=9,10,11 (straddling the two adjacent candidate
        // boxes) must be fully painted, proving the merge closed the
        // boundary rather than leaving a readable gap.
        for x in [0u32, 9, 10, 11, 19] {
            assert_eq!(pixel_at(x, 5), crate::annotations::REDACTION_PIXEL, "gap at x={x}");
        }
        // Outside both boxes stays untouched.
        assert_eq!(pixel_at(25, 5), (255, 255, 255, 255));
    }

    // ---- verification: pixel proof ----

    #[test]
    fn pixel_proof_passes_when_every_region_is_fully_the_redaction_pixel() {
        let width = 10u32;
        let height = 10u32;
        let mut rgba = vec![255u8; (width as usize) * (height as usize) * 4];
        let candidates = vec![candidate("c1", (0, 0, 5, 5), Disposition::Redact)];
        apply_candidate_redactions(&mut rgba, width, height, &candidates);
        let regions = redaction_regions_for_frame(&candidates);
        assert_eq!(verify_pixel_proof(&rgba, width, height, &regions), Ok(()));
    }

    #[test]
    fn pixel_proof_fails_when_a_declared_region_has_an_unpainted_pixel() {
        let width = 10u32;
        let height = 10u32;
        let rgba = vec![255u8; (width as usize) * (height as usize) * 4]; // never actually painted
        let regions = vec![(0, 0, 5, 5)];
        assert_eq!(verify_pixel_proof(&rgba, width, height, &regions), Err(PixelProofFailure::UnpaintedPixel { region: (0, 0, 5, 5) }));
    }

    #[test]
    fn pixel_proof_fails_on_a_partial_fill_canary() {
        // Paint only half of a declared region, simulating a partial-fill
        // bug - the canary this slice's acceptance floor names explicitly.
        let width = 10u32;
        let height = 10u32;
        let mut rgba = vec![255u8; (width as usize) * (height as usize) * 4];
        crate::annotations::paint_redaction_rect(&mut rgba, width, height, crate::coords::RectI { x: 0, y: 0, w: 5, h: 2 });
        let regions = vec![(0, 0, 5, 5)]; // declared taller than what was actually painted
        assert_eq!(verify_pixel_proof(&rgba, width, height, &regions), Err(PixelProofFailure::UnpaintedPixel { region: (0, 0, 5, 5) }));
    }

    #[test]
    fn pixel_proof_rejects_a_buffer_shorter_than_the_declared_raster() {
        // C2P3-002: a truncated/invalid buffer must be a hard failure,
        // never silently treated as "no pixels to check."
        let width = 10u32;
        let height = 10u32;
        let rgba = vec![255u8; 4]; // far shorter than width*height*4
        let regions: Vec<(i64, i64, u64, u64)> = vec![];
        assert_eq!(
            verify_pixel_proof(&rgba, width, height, &regions),
            Err(PixelProofFailure::InvalidRasterBufferLength { expected: 400, actual: 4 })
        );
    }

    #[test]
    fn pixel_proof_rejects_a_zero_area_declared_region() {
        let width = 10u32;
        let height = 10u32;
        let rgba = vec![255u8; (width as usize) * (height as usize) * 4];
        let regions = vec![(0, 0, 0, 5)];
        assert_eq!(verify_pixel_proof(&rgba, width, height, &regions), Err(PixelProofFailure::ZeroAreaRegion { region: (0, 0, 0, 5) }));
    }

    #[test]
    fn pixel_proof_rejects_a_region_wholly_outside_the_raster_instead_of_vacuously_passing() {
        // C2P3-002's exact named defect: clipping a wholly-outside region
        // down to nothing previously made this vacuously return success.
        let width = 10u32;
        let height = 10u32;
        let rgba = vec![255u8; (width as usize) * (height as usize) * 4];
        let regions = vec![(20, 20, 1, 1)];
        assert_eq!(
            verify_pixel_proof(&rgba, width, height, &regions),
            Err(PixelProofFailure::RegionOutsideRaster { region: (20, 20, 1, 1) })
        );
    }

    #[test]
    fn pixel_proof_rejects_a_region_partially_outside_the_raster() {
        let width = 10u32;
        let height = 10u32;
        let mut rgba = vec![255u8; (width as usize) * (height as usize) * 4];
        crate::annotations::paint_redaction_rect(&mut rgba, width, height, crate::coords::RectI { x: 5, y: 5, w: 5, h: 5 });
        let regions = vec![(5, 5, 10, 10)]; // extends 5px past both edges
        assert_eq!(
            verify_pixel_proof(&rgba, width, height, &regions),
            Err(PixelProofFailure::RegionOutsideRaster { region: (5, 5, 10, 10) })
        );
    }

    #[test]
    fn pixel_proof_accepts_a_region_exactly_clipped_to_the_frame_edge() {
        // The valid counterpart to the rejection cases above: a region
        // that is already *exactly* within bounds (post-expansion
        // clipping already happened upstream in bind_matches_to_candidates)
        // must still pass normally.
        let width = 10u32;
        let height = 10u32;
        let mut rgba = vec![255u8; (width as usize) * (height as usize) * 4];
        crate::annotations::paint_redaction_rect(&mut rgba, width, height, crate::coords::RectI { x: 0, y: 0, w: 10, h: 10 });
        let regions = vec![(0, 0, 10, 10)];
        assert_eq!(verify_pixel_proof(&rgba, width, height, &regions), Ok(()));
    }

    #[test]
    fn pixel_proof_rejects_overflowing_dimensions_instead_of_panicking() {
        // Panel fix round 2's exact demonstrable panic: width*height*4
        // computed with plain multiplication wraps to a small number for
        // absurd dimensions, letting an empty buffer pass the length
        // check and then panic on the first indexed pixel. Must fail
        // closed with a typed error instead - this is the fail-before
        // case (it panicked before this fix, in release mode where
        // overflow checks are off).
        let huge = 1u32 << 31;
        let rgba: Vec<u8> = vec![];
        assert_eq!(
            verify_pixel_proof(&rgba, huge, huge, &[(0, 0, 1, 1)]),
            Err(PixelProofFailure::RasterDimensionsOverflow { width: huge, height: huge })
        );
    }

    #[test]
    fn pixel_proof_accepts_the_maximal_in_bounds_region_on_a_small_frame() {
        // Positive control alongside the overflow-rejection case above:
        // ordinary dimensions with a region exactly filling the frame
        // (right == width, bottom == height) must still be accepted.
        let width = 10u32;
        let height = 10u32;
        let mut rgba = vec![255u8; (width as usize) * (height as usize) * 4];
        crate::annotations::paint_redaction_rect(&mut rgba, width, height, crate::coords::RectI { x: 0, y: 0, w: 10, h: 10 });
        assert_eq!(verify_pixel_proof(&rgba, width, height, &[(0, 0, 10, 10)]), Ok(()));
    }

    // ---- verification: removal proof ----

    #[test]
    fn removal_proof_is_clean_when_the_rerun_text_has_no_residual() {
        let result = verify_removal_proof("nothing sensitive here", &["219-09-9999".to_string()]);
        assert_eq!(result, RemovalProofResult::Clean);
    }

    #[test]
    fn removal_proof_catches_a_new_hard_positive_in_the_rerun_text() {
        let result = verify_removal_proof("still has 219-09-9999 visible", &[]);
        assert!(matches!(result, RemovalProofResult::Residual { .. }));
    }

    #[test]
    fn removal_proof_catches_a_context_dependent_credential_absent_from_the_flagged_inventory() {
        // C688-008: verify_removal_proof must rerun every required
        // deterministic family the release implements, not just the
        // original round-1 context-free subset. A brand-new
        // context-dependent credential shape in the rerun text, sharing
        // no fragment with any originally flagged value, must still be
        // caught - not reported Clean just because it postdates the
        // flagged-value inventory.
        let result = verify_removal_proof("password: brandNewLeak123", &[]);
        assert!(matches!(result, RemovalProofResult::Residual { .. }), "{result:?}");
    }

    #[test]
    fn removal_proof_catches_a_four_character_residual_fragment() {
        // The original flagged value's shape no longer matches any rule
        // post-redaction, but a readable fragment of it (>=4 chars) is
        // still sitting in the rerun text - a residual-readable-span, the
        // exact failure mode brief §8 names as the release target-zero
        // metric.
        let result = verify_removal_proof("account ending in 9999 remains visible", &["219-09-9999".to_string()]);
        assert!(matches!(result, RemovalProofResult::Residual { .. }));
    }

    #[test]
    fn removal_proof_does_not_flag_fragments_under_four_characters() {
        let result = verify_removal_proof("the number 99 appears", &["219-09-9999".to_string()]);
        // "99" (2 chars) is too short to count as a residual fragment on
        // its own, and no 4+ char window of "219-09-9999" appears in the
        // rerun text.
        assert_eq!(result, RemovalProofResult::Clean);
    }

    #[test]
    fn removal_proof_catches_a_full_width_residual_fragment_of_an_ascii_value() {
        // C2P3-003: an ASCII source value's tail re-OCR'd as full-width
        // digits must still collide under normalization - a raw
        // `str::contains` would never match "9999" against "９９９９".
        let result = verify_removal_proof("account ending in \u{FF19}\u{FF19}\u{FF19}\u{FF19} remains", &["219-09-9999".to_string()]);
        assert!(matches!(result, RemovalProofResult::Residual { .. }));
    }

    #[test]
    fn removal_proof_catches_a_residual_fragment_with_a_zero_width_character_spliced_in() {
        // C2P3-003: a zero-width character spliced into the middle of an
        // otherwise-matching residual run must not defeat the fragment
        // check - normalize() drops it on both sides before comparing.
        let result = verify_removal_proof("account ending in 99\u{200B}99 remains", &["219-09-9999".to_string()]);
        assert!(matches!(result, RemovalProofResult::Residual { .. }));
    }

    #[test]
    fn removal_proof_catches_a_residual_fragment_through_a_folded_unicode_dash_separator() {
        // C2P3-003: a value containing a Unicode dash variant must still
        // collide with rerun text using a plain ASCII hyphen (or vice
        // versa) once both sides are folded to the same separator.
        let result = verify_removal_proof("ssn 219-09 leaked", &["219\u{2010}09\u{2010}9999".to_string()]);
        assert!(matches!(result, RemovalProofResult::Residual { .. }));
    }

    #[test]
    fn removal_proof_is_clean_when_a_full_width_rerun_value_does_not_actually_overlap() {
        // Positive control: normalization must not make the check
        // over-eager - an unrelated full-width run that shares no 4+
        // char window with the flagged value stays Clean.
        let result = verify_removal_proof("unrelated \u{FF11}\u{FF12}\u{FF13}\u{FF14} here", &["219-09-9999".to_string()]);
        assert_eq!(result, RemovalProofResult::Clean);
    }

    // ---- verification: coverage proof ----

    fn redaction_change_event(sequence: u64, event_id: &str, candidate_id: &str, disposition: Disposition) -> EditEvent {
        EditEvent {
            sequence,
            event_id: event_id.to_string(),
            session_revision_before: sequence,
            session_revision_after: sequence + 1,
            operation: EditOperation::RedactionChange { frame_id: "f1".to_string(), candidate_id: candidate_id.to_string(), disposition },
            before_digest: None,
            after_digest: None,
            local_timestamp: "2026-10-28T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn coverage_proof_still_flags_an_override_even_when_its_event_resolves_cleanly() {
        // C688-005A re-opened: resolving to a real, current,
        // correctly-scoped event is necessary but not sufficient - that
        // event cannot carry the required reason/explicit confirmation
        // at all today, so every MarkNonSensitive override still fails
        // coverage until a separately reviewed schema change adds that
        // evidence.
        let mut c2 = candidate("c2", (10, 10, 5, 5), Disposition::MarkNonSensitive);
        c2.disposition_event_id = Some("evt-1".to_string());
        let candidates = vec![candidate("c1", (0, 0, 5, 5), Disposition::Redact), c2];
        let events = vec![redaction_change_event(1, "evt-1", "c2", Disposition::MarkNonSensitive)];
        let failures = verify_coverage_proof("f1", &candidates, &events);
        assert_eq!(
            failures,
            vec![CoverageProofFailure::OverrideAuthorityContentUnsupported {
                candidate_id: "c2".to_string(),
                disposition_event_id: "evt-1".to_string()
            }]
        );
    }

    #[test]
    fn coverage_proof_flags_a_pending_candidate() {
        let candidates = vec![candidate("c1", (0, 0, 5, 5), Disposition::Pending)];
        let failures = verify_coverage_proof("f1", &candidates, &[]);
        assert_eq!(failures, vec![CoverageProofFailure::UndispositionedCandidate { candidate_id: "c1".to_string() }]);
    }

    #[test]
    fn coverage_proof_flags_a_payment_card_marked_non_sensitive_even_with_a_real_evidenced_event() {
        // Evidenced or not, credential/private-key/payment-card hard
        // positives are categorically unredactable in Phase 2 - a real,
        // current, resolvable event does not grant an exception this
        // policy refuses outright. Both the categorical block and the
        // (now-always-firing) content-unsupported failure apply.
        let mut c = candidate("c1", (0, 0, 5, 5), Disposition::MarkNonSensitive);
        c.detector_id = "det.payment_card".to_string();
        c.disposition_event_id = Some("evt-1".to_string());
        let events = vec![redaction_change_event(1, "evt-1", "c1", Disposition::MarkNonSensitive)];
        let failures = verify_coverage_proof("f1", &[c], &events);
        assert_eq!(
            failures,
            vec![
                CoverageProofFailure::UnredactableHardPositiveNotRedacted {
                    candidate_id: "c1".to_string(),
                    detector_id: "det.payment_card".to_string()
                },
                CoverageProofFailure::OverrideAuthorityContentUnsupported {
                    candidate_id: "c1".to_string(),
                    disposition_event_id: "evt-1".to_string()
                }
            ]
        );
    }

    #[test]
    fn coverage_proof_flags_an_enum_only_override_with_no_event_id() {
        // C2P3-005: the disposition enum alone is never permission for
        // an override, even for a rule family that isn't categorically
        // unredactable - here an SSN candidate was flipped to
        // MarkNonSensitive with no recorded disposition event at all.
        let mut c = candidate("c1", (0, 0, 5, 5), Disposition::MarkNonSensitive);
        c.detector_id = "det.ssn".to_string();
        let failures = verify_coverage_proof("f1", &[c], &[]);
        assert_eq!(failures, vec![CoverageProofFailure::UnevidencedOverride { candidate_id: "c1".to_string() }]);
    }

    #[test]
    fn coverage_proof_still_flags_a_resolved_ssn_override_pending_the_reason_confirmation_schema() {
        // SSN is a hard positive that defaults to Redact and is not in
        // the categorically-unredactable "credential/private-key/
        // payment-card" set, but a resolved event still cannot satisfy
        // the reason/confirmation requirement today - see the re-opened
        // test above.
        let mut c = candidate("c1", (0, 0, 5, 5), Disposition::MarkNonSensitive);
        c.detector_id = "det.ssn".to_string();
        c.disposition_event_id = Some("evt-1".to_string());
        let events = vec![redaction_change_event(1, "evt-1", "c1", Disposition::MarkNonSensitive)];
        let failures = verify_coverage_proof("f1", &[c], &events);
        assert_eq!(
            failures,
            vec![CoverageProofFailure::OverrideAuthorityContentUnsupported {
                candidate_id: "c1".to_string(),
                disposition_event_id: "evt-1".to_string()
            }]
        );
    }

    #[test]
    fn coverage_proof_rejects_a_nonexistent_event_id() {
        // C688-005A: a syntactically present but entirely fabricated id
        // must not satisfy the check - nothing in the edit log names it.
        let mut c = candidate("c1", (0, 0, 5, 5), Disposition::MarkNonSensitive);
        c.detector_id = "det.ssn".to_string();
        c.disposition_event_id = Some("evt-does-not-exist".to_string());
        let failures = verify_coverage_proof("f1", &[c], &[]);
        assert_eq!(
            failures,
            vec![CoverageProofFailure::UnresolvedOverrideEvent {
                candidate_id: "c1".to_string(),
                disposition_event_id: "evt-does-not-exist".to_string()
            }]
        );
    }

    #[test]
    fn coverage_proof_rejects_an_event_recorded_for_a_different_candidate() {
        // C688-005A's "foreign candidate" case: the event is real and
        // current, but it belongs to a different candidate entirely.
        let mut c = candidate("c1", (0, 0, 5, 5), Disposition::MarkNonSensitive);
        c.detector_id = "det.ssn".to_string();
        c.disposition_event_id = Some("evt-1".to_string());
        let events = vec![redaction_change_event(1, "evt-1", "some-other-candidate", Disposition::MarkNonSensitive)];
        let failures = verify_coverage_proof("f1", &[c], &events);
        assert_eq!(
            failures,
            vec![CoverageProofFailure::UnresolvedOverrideEvent { candidate_id: "c1".to_string(), disposition_event_id: "evt-1".to_string() }]
        );
    }

    #[test]
    fn coverage_proof_rejects_a_stale_event_superseded_by_a_later_one() {
        // C688-005A: the candidate's recorded id names a real event for
        // the right candidate, but a *later* RedactionChange for that
        // same candidate exists - the recorded id is stale, not current.
        let mut c = candidate("c1", (0, 0, 5, 5), Disposition::MarkNonSensitive);
        c.detector_id = "det.ssn".to_string();
        c.disposition_event_id = Some("evt-1".to_string());
        let events = vec![
            redaction_change_event(1, "evt-1", "c1", Disposition::MarkNonSensitive),
            redaction_change_event(2, "evt-2", "c1", Disposition::Redact),
        ];
        let failures = verify_coverage_proof("f1", &[c], &events);
        assert_eq!(
            failures,
            vec![CoverageProofFailure::UnresolvedOverrideEvent { candidate_id: "c1".to_string(), disposition_event_id: "evt-1".to_string() }]
        );
    }

    #[test]
    fn coverage_proof_rejects_a_same_candidate_id_event_from_a_different_frame_as_current() {
        // C688-005A.1 exact counterexample #1: candidate c1's own frame
        // f1 has a real, legitimate current event "a", but a later
        // sequence number belongs to an unrelated frame f2's own
        // candidate that happens to share the literal id "c1" too
        // (candidate ids are only unique *within* a frame). The frame-
        // blind resolver used to pick "b" (higher sequence, wrong frame)
        // as "current" and reject "a" as stale; the frame-aware
        // resolver must not let a different frame's event shadow this
        // one.
        let mut event_a = redaction_change_event(1, "a", "c1", Disposition::MarkNonSensitive);
        if let EditOperation::RedactionChange { frame_id, .. } = &mut event_a.operation {
            *frame_id = "f1".to_string();
        }
        let mut event_b = redaction_change_event(2, "b", "c1", Disposition::Redact);
        if let EditOperation::RedactionChange { frame_id, .. } = &mut event_b.operation {
            *frame_id = "f2".to_string();
        }
        let mut c = candidate("c1", (0, 0, 5, 5), Disposition::MarkNonSensitive);
        c.detector_id = "det.ssn".to_string();
        c.disposition_event_id = Some("a".to_string());
        let failures = verify_coverage_proof("f1", &[c], &[event_a, event_b]);
        // Resolves cleanly to "a" (the real f1/c1 event) - the only
        // failure left is the always-on content-unsupported one, not a
        // wrongly-stale UnresolvedOverrideEvent.
        assert_eq!(
            failures,
            vec![CoverageProofFailure::OverrideAuthorityContentUnsupported {
                candidate_id: "c1".to_string(),
                disposition_event_id: "a".to_string()
            }]
        );
    }

    #[test]
    fn coverage_proof_rejects_a_same_candidate_id_event_from_a_different_frame_as_a_match() {
        // C688-005A.1 exact counterexample #2: the candidate's own
        // frame f1 has no event of its own at all, but a different
        // frame f2 has a same-named candidate's event "b". A frame-
        // blind resolver would incorrectly accept "b" as evidence for
        // f1/c1; the frame-aware resolver must reject it as unresolved,
        // not silently accept a foreign frame's event.
        let mut event_b = redaction_change_event(1, "b", "c1", Disposition::MarkNonSensitive);
        if let EditOperation::RedactionChange { frame_id, .. } = &mut event_b.operation {
            *frame_id = "f2".to_string();
        }
        let mut c = candidate("c1", (0, 0, 5, 5), Disposition::MarkNonSensitive);
        c.detector_id = "det.ssn".to_string();
        c.disposition_event_id = Some("b".to_string());
        let failures = verify_coverage_proof("f1", &[c], &[event_b]);
        assert_eq!(
            failures,
            vec![CoverageProofFailure::UnresolvedOverrideEvent { candidate_id: "c1".to_string(), disposition_event_id: "b".to_string() }]
        );
    }

    #[test]
    fn is_unredactable_hard_positive_covers_every_github_token_family() {
        for rule_id in [
            "det.github_token_classic_pat",
            "det.github_token_oauth",
            "det.github_token_user_to_server",
            "det.github_token_server_to_server",
            "det.github_token_refresh",
            "det.github_token_fine_grained_pat",
        ] {
            assert!(is_unredactable_hard_positive(rule_id), "{rule_id} must be unredactable");
        }
    }

    #[test]
    fn is_unredactable_hard_positive_covers_every_context_dependent_credential_family() {
        // C688-007: round 3's context-dependent detectors added real
        // credential families this categorical set never caught up to.
        for rule_id in ["det.bearer_auth", "det.basic_auth", "det.cookie_header", "det.sensitive_key_value", "det.otp_pin"] {
            assert!(is_unredactable_hard_positive(rule_id), "{rule_id} must be unredactable");
        }
    }

    // ---------------------------------------------------------------------
    // GS-C6 (C2-P6 review UI safety blocker): validate_review_action,
    // build_redaction_change_event, and disposition_resolves_candidate.
    // ---------------------------------------------------------------------

    fn gs_c6_candidate(id: &str, detector_id: &str, disposition: Disposition) -> RedactionCandidate {
        RedactionCandidate {
            candidate_id: id.to_string(),
            detector_id: detector_id.to_string(),
            reason_code: "TEST".to_string(),
            source_token_ids: vec![],
            original_box: (0, 0, 5, 5),
            expanded_box: (0, 0, 5, 5),
            score: None,
            disposition,
            disposition_event_id: None,
        }
    }

    fn gs_c6_frame(frame_id: &str, candidates: Vec<RedactionCandidate>) -> SourceFrame {
        SourceFrame {
            frame_id: frame_id.to_string(),
            order: 0,
            source_relative_path: format!("frames/{frame_id}.png"),
            raster_sha256: "a".repeat(64),
            provenance_sidecar_relative_path: None,
            provenance_sidecar_blob_sha256: None,
            width: 100,
            height: 100,
            captured_at: "2026-10-29T12:00:00Z".to_string(),
            action_kind: "click".to_string(),
            click_box: None,
            process_basename: None,
            window_title: None,
            original_storage: SourceStorage::SessionEncrypted,
            ocr_status: None,
            redacted_derivative_relative_path: None,
            redacted_derivative_sha256: None,
            redaction_candidates: candidates,
            verification: FrameVerification::Pending,
        }
    }

    fn gs_c6_session(frames: Vec<SourceFrame>) -> SopSessionV1 {
        SopSessionV1 {
            schema_version: SOP_SESSION_SCHEMA_VERSION,
            kind: SOP_SESSION_KIND.to_string(),
            session_id: "sess-1".to_string(),
            created_at: "2026-10-29T12:00:00Z".to_string(),
            updated_at: "2026-10-29T12:00:00Z".to_string(),
            revision: 0,
            policy_version: "policy-v1".to_string(),
            model_manifest_sha256: Some("model-manifest-v1".to_string()),
            sidecar_protocol_version: 1,
            source_frames: frames,
            captions: vec![],
            edit_events: vec![],
            review_state: ReviewState::InProgress,
            review_receipt: None,
            export_eligible: false,
        }
    }

    fn gs_c6_request<'a>(frame_id: &'a str, candidate_id: &'a str, new_disposition: Disposition, reason: &'a str, confirmed: bool) -> ReviewActionRequest<'a> {
        // Matches gs_c6_frame/gs_c6_session's own defaults exactly, so a
        // `confirmed: true` request computes the digest
        // validate_review_action will actually expect against the
        // default-shaped fixtures.
        let confirmation_digest = confirmed.then(|| {
            let digest = confirmation_digest(
                frame_id,
                candidate_id,
                new_disposition,
                reason,
                &"a".repeat(64),
                None,
                "policy-v1",
                Some("model-manifest-v1"),
                0,
            );
            &*Box::leak(digest.into_boxed_str())
        });
        ReviewActionRequest {
            frame_id,
            candidate_id,
            new_disposition,
            reason,
            confirmation_digest,
            expected_session_revision: 0,
            expected_policy_version: "policy-v1",
            expected_model_manifest_sha256: Some("model-manifest-v1"),
        }
    }

    #[test]
    fn redact_never_needs_a_reason_or_confirmation() {
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        let request = gs_c6_request("f1", "c1", Disposition::Redact, "", false);
        assert_eq!(validate_review_action(&session, &request), Ok(()));
    }

    #[test]
    fn pending_never_needs_a_reason_or_confirmation() {
        // Setting a candidate back to Pending (e.g. undoing a prior
        // disposition) is not an override either - only MarkNonSensitive is gated.
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Redact)])]);
        let request = gs_c6_request("f1", "c1", Disposition::Pending, "", false);
        assert_eq!(validate_review_action(&session, &request), Ok(()));
    }

    #[test]
    fn mark_non_sensitive_with_empty_reason_is_rejected() {
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        let request = gs_c6_request("f1", "c1", Disposition::MarkNonSensitive, "", true);
        assert_eq!(validate_review_action(&session, &request), Err(DispositionChangeError::MissingReason));
    }

    #[test]
    fn mark_non_sensitive_with_whitespace_only_reason_is_rejected() {
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        let request = gs_c6_request("f1", "c1", Disposition::MarkNonSensitive, "   \t\n  ", true);
        assert_eq!(validate_review_action(&session, &request), Err(DispositionChangeError::MissingReason));
    }

    #[test]
    fn mark_non_sensitive_without_explicit_confirmation_is_rejected() {
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        let request = gs_c6_request("f1", "c1", Disposition::MarkNonSensitive, "verified with the customer by phone", false);
        assert_eq!(validate_review_action(&session, &request), Err(DispositionChangeError::MissingExplicitConfirmation));
    }

    #[test]
    fn mark_non_sensitive_with_reason_and_confirmation_on_a_non_protected_detector_is_allowed() {
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        let request = gs_c6_request("f1", "c1", Disposition::MarkNonSensitive, "verified with the customer by phone", true);
        assert_eq!(validate_review_action(&session, &request), Ok(()));
    }

    #[test]
    fn mark_non_sensitive_on_a_protected_credential_is_rejected_even_with_reason_and_confirmation() {
        // GS-C6: "remain NON-OVERRIDABLE even with both fields" - a
        // complete, well-formed reason/confirmation does not change the
        // outcome for a categorically unredactable detector.
        for rule_id in ["det.payment_card", "det.pem_private_key", "det.bearer_auth", "det.otp_pin"] {
            let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", rule_id, Disposition::Pending)])]);
            let request = gs_c6_request("f1", "c1", Disposition::MarkNonSensitive, "a perfectly good reason", true);
            assert_eq!(
                validate_review_action(&session, &request),
                Err(DispositionChangeError::ProtectedCredentialNonOverridable { detector_id: rule_id.to_string() }),
                "{rule_id} must stay non-overridable"
            );
        }
    }

    #[test]
    fn protected_credential_check_runs_before_the_reason_check() {
        // Even an empty reason on a protected credential reports the
        // protected-credential error, not MissingReason - the rule that
        // can never be satisfied takes precedence over one that could be
        // fixed by typing something in.
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.payment_card", Disposition::Pending)])]);
        let request = gs_c6_request("f1", "c1", Disposition::MarkNonSensitive, "", false);
        assert_eq!(
            validate_review_action(&session, &request),
            Err(DispositionChangeError::ProtectedCredentialNonOverridable { detector_id: "det.payment_card".to_string() })
        );
    }

    #[test]
    fn a_stale_session_revision_is_rejected_before_anything_else() {
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        let mut request = gs_c6_request("f1", "c1", Disposition::Redact, "", false);
        request.expected_session_revision = 7;
        assert_eq!(validate_review_action(&session, &request), Err(DispositionChangeError::StaleSessionRevision { expected: 7, current: 0 }));
    }

    #[test]
    fn a_mismatched_policy_version_is_rejected() {
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        let mut request = gs_c6_request("f1", "c1", Disposition::Redact, "", false);
        request.expected_policy_version = "policy-v0-stale";
        assert_eq!(
            validate_review_action(&session, &request),
            Err(DispositionChangeError::PolicyVersionMismatch { expected: "policy-v0-stale".to_string(), current: "policy-v1".to_string() })
        );
    }

    #[test]
    fn a_mismatched_model_manifest_is_rejected() {
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        let mut request = gs_c6_request("f1", "c1", Disposition::Redact, "", false);
        request.expected_model_manifest_sha256 = Some("model-manifest-v0-stale");
        assert!(matches!(validate_review_action(&session, &request), Err(DispositionChangeError::ModelManifestMismatch { .. })));
    }

    #[test]
    fn an_unknown_frame_is_rejected() {
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        let request = gs_c6_request("ghost-frame", "c1", Disposition::Redact, "", false);
        assert_eq!(validate_review_action(&session, &request), Err(DispositionChangeError::UnknownFrame { frame_id: "ghost-frame".to_string() }));
    }

    #[test]
    fn an_unknown_candidate_on_a_real_frame_is_rejected() {
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        let request = gs_c6_request("f1", "ghost-candidate", Disposition::Redact, "", false);
        assert_eq!(
            validate_review_action(&session, &request),
            Err(DispositionChangeError::UnknownCandidate { candidate_id: "ghost-candidate".to_string() })
        );
    }

    #[test]
    fn a_candidate_id_bound_to_a_different_frame_is_not_found() {
        // Candidate IDs are only unique within a frame - a request that
        // mismatches frame_id/candidate_id must not accidentally resolve
        // against the wrong frame's same-named candidate.
        let session = gs_c6_session(vec![
            gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)]),
            gs_c6_frame("f2", vec![gs_c6_candidate("c1", "det.payment_card", Disposition::Pending)]),
        ]);
        // Naming f1 but the candidate that actually only exists under f2.
        let request = gs_c6_request("f1", "c1", Disposition::Redact, "", false);
        // c1 DOES exist under f1 too, so this should resolve to f1's c1
        // (det.ssn), not f2's - prove it by checking a MarkNonSensitive
        // override is allowed (det.ssn isn't protected), which would be
        // refused if it had resolved to f2's protected det.payment_card.
        let override_request = gs_c6_request("f1", "c1", Disposition::MarkNonSensitive, "verified", true);
        assert_eq!(validate_review_action(&session, &request), Ok(()));
        assert_eq!(validate_review_action(&session, &override_request), Ok(()));
    }

    #[test]
    fn build_redaction_change_event_constructs_a_well_formed_event_on_a_valid_request() {
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        let request = gs_c6_request("f1", "c1", Disposition::Redact, "", false);
        let event = build_redaction_change_event(&session, &request, "evt-1".to_string(), "2026-10-29T12:05:00Z".to_string()).unwrap();
        assert_eq!(event.sequence, 0);
        assert_eq!(event.session_revision_before, 0);
        assert_eq!(event.session_revision_after, 1);
        assert_eq!(event.operation, EditOperation::RedactionChange { frame_id: "f1".to_string(), candidate_id: "c1".to_string(), disposition: Disposition::Redact });
    }

    #[test]
    fn build_redaction_change_event_picks_the_next_sequence_after_existing_events() {
        let mut session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        session.edit_events.push(EditEvent {
            sequence: 5,
            event_id: "evt-0".to_string(),
            session_revision_before: 0,
            session_revision_after: 0,
            operation: EditOperation::Revert { step_id: "s1".to_string() },
            before_digest: None,
            after_digest: None,
            local_timestamp: "2026-10-29T12:00:00Z".to_string(),
        });
        let request = gs_c6_request("f1", "c1", Disposition::Redact, "", false);
        let event = build_redaction_change_event(&session, &request, "evt-1".to_string(), "2026-10-29T12:05:00Z".to_string()).unwrap();
        assert_eq!(event.sequence, 6);
    }

    #[test]
    fn build_redaction_change_event_refuses_on_the_same_validation_failures() {
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.payment_card", Disposition::Pending)])]);
        let request = gs_c6_request("f1", "c1", Disposition::MarkNonSensitive, "a reason", true);
        assert_eq!(
            build_redaction_change_event(&session, &request, "evt-1".to_string(), "2026-10-29T12:05:00Z".to_string()),
            Err(DispositionChangeError::ProtectedCredentialNonOverridable { detector_id: "det.payment_card".to_string() })
        );
    }

    // ---- C6A-001A: confirmation_digest cannot be transplanted ----

    #[test]
    fn a_confirmation_digest_computed_for_a_different_reason_does_not_validate() {
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        let mut request = gs_c6_request("f1", "c1", Disposition::MarkNonSensitive, "the real reason", true);
        // Swap in a digest that was actually computed for a different
        // reason string - same session/frame/candidate/disposition
        // otherwise.
        let wrong_digest = confirmation_digest("f1", "c1", Disposition::MarkNonSensitive, "a completely different reason", &"a".repeat(64), None, "policy-v1", Some("model-manifest-v1"), 0);
        request.confirmation_digest = Some(&wrong_digest);
        assert_eq!(validate_review_action(&session, &request), Err(DispositionChangeError::MissingExplicitConfirmation));
    }

    #[test]
    fn a_confirmation_digest_computed_for_a_different_candidate_does_not_validate() {
        let session = gs_c6_session(vec![gs_c6_frame(
            "f1",
            vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending), gs_c6_candidate("c2", "det.ssn", Disposition::Pending)],
        )]);
        let digest_for_c2 = confirmation_digest("f1", "c2", Disposition::MarkNonSensitive, "verified", &"a".repeat(64), None, "policy-v1", Some("model-manifest-v1"), 0);
        let request = ReviewActionRequest {
            frame_id: "f1",
            candidate_id: "c1",
            new_disposition: Disposition::MarkNonSensitive,
            reason: "verified",
            confirmation_digest: Some(&digest_for_c2),
            expected_session_revision: 0,
            expected_policy_version: "policy-v1",
            expected_model_manifest_sha256: Some("model-manifest-v1"),
        };
        assert_eq!(validate_review_action(&session, &request), Err(DispositionChangeError::MissingExplicitConfirmation));
    }

    #[test]
    fn a_confirmation_digest_computed_against_a_stale_session_revision_does_not_validate_once_current() {
        // The digest was computed when the session was at revision 0;
        // the session has since moved to revision 1 (some other edit
        // landed). The old digest must not still validate just because
        // the caller also updated expected_session_revision to match.
        let mut session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        let stale_digest = confirmation_digest("f1", "c1", Disposition::MarkNonSensitive, "verified", &"a".repeat(64), None, "policy-v1", Some("model-manifest-v1"), 0);
        session.revision = 1;
        let request = ReviewActionRequest {
            frame_id: "f1",
            candidate_id: "c1",
            new_disposition: Disposition::MarkNonSensitive,
            reason: "verified",
            confirmation_digest: Some(&stale_digest),
            expected_session_revision: 1, // caller updated this, but not the digest itself
            expected_policy_version: "policy-v1",
            expected_model_manifest_sha256: Some("model-manifest-v1"),
        };
        assert_eq!(validate_review_action(&session, &request), Err(DispositionChangeError::MissingExplicitConfirmation));
    }

    #[test]
    fn a_correctly_computed_confirmation_digest_validates() {
        let session = gs_c6_session(vec![gs_c6_frame("f1", vec![gs_c6_candidate("c1", "det.ssn", Disposition::Pending)])]);
        let request = gs_c6_request("f1", "c1", Disposition::MarkNonSensitive, "verified with the customer", true);
        assert_eq!(validate_review_action(&session, &request), Ok(()));
    }

    #[test]
    fn disposition_resolves_candidate_is_true_only_for_redact() {
        // C6A-002: MarkNonSensitive does NOT resolve a candidate today -
        // verify_coverage_proof still refuses it outright
        // (OverrideAuthorityContentUnsupported) until the authority-
        // content schema exists.
        assert!(!disposition_resolves_candidate(Disposition::Pending));
        assert!(disposition_resolves_candidate(Disposition::Redact));
        assert!(!disposition_resolves_candidate(Disposition::MarkNonSensitive));
    }

    #[test]
    fn coverage_proof_flags_a_bearer_credential_marked_non_sensitive_even_with_a_real_evidenced_event() {
        let mut c = candidate("c1", (0, 0, 5, 5), Disposition::MarkNonSensitive);
        c.detector_id = "det.bearer_auth".to_string();
        c.disposition_event_id = Some("evt-1".to_string());
        let events = vec![redaction_change_event(1, "evt-1", "c1", Disposition::MarkNonSensitive)];
        let failures = verify_coverage_proof("f1", &[c], &events);
        assert_eq!(
            failures,
            vec![
                CoverageProofFailure::UnredactableHardPositiveNotRedacted {
                    candidate_id: "c1".to_string(),
                    detector_id: "det.bearer_auth".to_string()
                },
                CoverageProofFailure::OverrideAuthorityContentUnsupported {
                    candidate_id: "c1".to_string(),
                    disposition_event_id: "evt-1".to_string()
                }
            ]
        );
    }

    // ---- verification: frame state machine ----

    /// The baseline "everything that can pass has passed" evidence - the
    /// only starting point from which [`compute_frame_verification`]
    /// returns `Verified`. Every other test below flips exactly one
    /// field off this baseline, per C2P3-004's exact concern: no single
    /// missing piece of evidence may be compensated for by the rest.
    fn complete_evidence() -> FrameVerificationEvidence {
        FrameVerificationEvidence {
            pixel_proof_passed: true,
            removal_proof: RemovalProofResult::Clean,
            coverage_failures: vec![],
            ocr_succeeded: true,
            unbound_match_count: 0,
            required_detectors_complete: true,
            identities_verified: true,
        }
    }

    #[test]
    fn frame_verification_is_verified_when_all_evidence_is_complete() {
        assert_eq!(compute_frame_verification(&complete_evidence()), FrameVerification::Verified);
    }

    #[test]
    fn frame_verification_is_review_required_on_a_coverage_failure_alone() {
        let mut evidence = complete_evidence();
        evidence.coverage_failures = vec![CoverageProofFailure::UndispositionedCandidate { candidate_id: "c1".to_string() }];
        assert_eq!(compute_frame_verification(&evidence), FrameVerification::ReviewRequired);
    }

    #[test]
    fn frame_verification_is_blocked_on_a_pixel_proof_failure_with_full_coverage() {
        let mut evidence = complete_evidence();
        evidence.pixel_proof_passed = false;
        assert_eq!(compute_frame_verification(&evidence), FrameVerification::Blocked);
    }

    #[test]
    fn frame_verification_is_blocked_on_a_removal_proof_failure_with_full_coverage() {
        let mut evidence = complete_evidence();
        evidence.removal_proof = RemovalProofResult::Residual { hard_positives: vec![], fragments: vec!["9999".to_string()] };
        assert_eq!(compute_frame_verification(&evidence), FrameVerification::Blocked);
    }

    #[test]
    fn frame_verification_is_blocked_when_ocr_did_not_succeed_even_with_every_proof_otherwise_passing() {
        // C2P3-004's exact named defect: an OCR failure (or "never
        // attempted") must never be indistinguishable from "ran and
        // found nothing," which would otherwise vacuously satisfy every
        // other proof on empty input.
        let mut evidence = complete_evidence();
        evidence.ocr_succeeded = false;
        assert_eq!(compute_frame_verification(&evidence), FrameVerification::Blocked);
    }

    #[test]
    fn frame_verification_is_blocked_when_any_match_is_unbound_even_with_every_proof_otherwise_passing() {
        let mut evidence = complete_evidence();
        evidence.unbound_match_count = 1;
        assert_eq!(compute_frame_verification(&evidence), FrameVerification::Blocked);
    }

    #[test]
    fn frame_verification_is_blocked_when_required_detectors_have_not_all_run_even_with_every_proof_otherwise_passing() {
        // This is the field that keeps Verified genuinely unreachable
        // today: round 1 has no context-dependent rules or structural
        // pass yet, so no honest caller in this codebase can pass `true`
        // here - a partial detector module must not mint the final
        // safety state.
        let mut evidence = complete_evidence();
        evidence.required_detectors_complete = false;
        assert_eq!(compute_frame_verification(&evidence), FrameVerification::Blocked);
    }

    #[test]
    fn frame_verification_is_blocked_when_identities_are_not_verified_even_with_every_proof_otherwise_passing() {
        let mut evidence = complete_evidence();
        evidence.identities_verified = false;
        assert_eq!(compute_frame_verification(&evidence), FrameVerification::Blocked);
    }

    #[test]
    fn frame_verification_is_never_verified_when_any_single_piece_of_evidence_is_missing() {
        // Exhaustive sweep over every field: flipping exactly one away
        // from `complete_evidence()` must always move off `Verified`.
        let variants: Vec<FrameVerificationEvidence> = vec![
            FrameVerificationEvidence { pixel_proof_passed: false, ..complete_evidence() },
            FrameVerificationEvidence {
                removal_proof: RemovalProofResult::Residual { hard_positives: vec![], fragments: vec!["9999".to_string()] },
                ..complete_evidence()
            },
            FrameVerificationEvidence {
                coverage_failures: vec![CoverageProofFailure::UndispositionedCandidate { candidate_id: "c1".to_string() }],
                ..complete_evidence()
            },
            FrameVerificationEvidence { ocr_succeeded: false, ..complete_evidence() },
            FrameVerificationEvidence { unbound_match_count: 1, ..complete_evidence() },
            FrameVerificationEvidence { required_detectors_complete: false, ..complete_evidence() },
            FrameVerificationEvidence { identities_verified: false, ..complete_evidence() },
        ];
        for evidence in variants {
            assert_ne!(compute_frame_verification(&evidence), FrameVerification::Verified, "{evidence:?}");
        }
    }
}
