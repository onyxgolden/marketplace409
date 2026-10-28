//! FORGE Capture Phase 2 — deterministic hard-positive detection and
//! candidate box binding (build slice C2-P3, rounds 1-2 of this slice).
//!
//! Plan: `results/chatgpt/capture-ai-caption-pipeline-implementation-brief-2026-10-26.md`
//! §3.1–3.2. Round 1 covers the **context-free** rule families: ones a
//! matcher can confirm from the matched text alone, with no nearby label
//! or UI evidence required (email, SSN/ITIN, Luhn-valid payment card, JWT,
//! PEM private-key blocks, AWS access-key IDs, GitHub token families).
//! Round 2 ([`join_tokens`], [`bind_matches_to_candidates`]) maps those
//! byte-offset matches onto real [`crate::sop_session::OcrToken`] boxes,
//! producing brief §4's actual [`crate::sop_session::RedactionCandidate`]
//! shape: token-box union, expansion, and clipping to the frame raster
//! (brief §3.1). Context-dependent rule families (bearer/auth headers,
//! sensitive query params, key/value sensitive-label forms, masked-
//! credential runs, OTP/PIN, ABA routing number, account number, phone/
//! address), the structural/UI evidence pass (§3.3), merging overlapping/
//! adjacent *painted* regions across candidates, the destructive
//! redaction operation (§3.4), and the three verification proofs (§3.5)
//! are separate follow-up rounds of this same slice — see the C2-P3
//! build-started filing in `forge-ai-drop/results/claude/`.
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

fn detect_jwt(norm: &[NormalizedChar], out: &mut Vec<DeterministicMatch>) {
    let n = norm.len();
    let mut i = 0;
    while i < n {
        if is_base64url_char(norm[i].ch) && (i == 0 || !is_base64url_char(norm[i - 1].ch)) {
            let mut j = i;
            let mut dot_positions = Vec::new();
            loop {
                let seg_start = j;
                while j < n && is_base64url_char(norm[j].ch) {
                    j += 1;
                }
                if j == seg_start {
                    break;
                }
                if j < n && norm[j].ch == '.' {
                    dot_positions.push((seg_start, j));
                    j += 1;
                } else {
                    dot_positions.push((seg_start, j));
                    break;
                }
            }
            if dot_positions.len() == 3 {
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

/// Binds every match to the tokens its byte range overlaps (via
/// `token_spans`, as returned by [`join_tokens`]) and builds the brief
/// §4 [`RedactionCandidate`] list: original box is the union of covered
/// token boxes, expanded box adds [`MIN_EXPAND_PX`] plus an estimated
/// glyph stroke and clips to the frame raster. A match covering no token
/// (should not happen for matches produced from the same joined text, but
/// not assumed) is skipped rather than producing a malformed candidate.
/// `candidate_id_prefix` scopes generated IDs (e.g. the frame ID) so
/// candidates from different frames never collide; IDs are otherwise a
/// deterministic `{prefix}-{index}`.
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
    frame_width: u32,
    frame_height: u32,
    candidate_id_prefix: &str,
) -> Vec<RedactionCandidate> {
    let mut out = Vec::with_capacity(matches.len());
    for (i, m) in matches.iter().enumerate() {
        let covered: Vec<usize> =
            token_spans.iter().enumerate().filter(|(_, &(s, e))| s < m.end_byte && e > m.start_byte).map(|(idx, _)| idx).collect();
        let Some(original_box) = covered.iter().fold(None, |acc: Option<(i64, i64, u64, u64)>, &idx| {
            let b = (tokens[idx].box_x, tokens[idx].box_y, tokens[idx].box_w, tokens[idx].box_h);
            Some(match acc {
                None => b,
                Some(existing) => box_union(existing, b),
            })
        }) else {
            continue;
        };
        let expand = MIN_EXPAND_PX + estimate_glyph_stroke_px(original_box.3);
        let expanded_box = clip_box_to_frame(expand_box(original_box, expand), frame_width, frame_height);
        let source_token_ids = covered.iter().map(|&idx| tokens[idx].token_id.clone()).collect();
        out.push(RedactionCandidate {
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
    out
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

use crate::sop_session::FrameVerification;

/// Brief §3.5 check 1: "every declared redaction rectangle in the
/// decoded derivative consists entirely of the fixed opaque redaction
/// pixel." Checks `regions` (as produced by [`redaction_regions_for_frame`])
/// against the actual derivative buffer — never trusts that painting
/// happened just because it was requested.
pub fn verify_pixel_proof(rgba: &[u8], width: u32, height: u32, regions: &[(i64, i64, u64, u64)]) -> bool {
    for &(x, y, w, h) in regions {
        let x0 = x.clamp(0, width as i64) as u32;
        let y0 = y.clamp(0, height as i64) as u32;
        let x1 = (x + w as i64).clamp(0, width as i64) as u32;
        let y1 = (y + h as i64).clamp(0, height as i64) as u32;
        for yy in y0..y1 {
            for xx in x0..x1 {
                let idx = (yy as u64 * width as u64 + xx as u64) as usize * 4;
                if idx + 3 >= rgba.len() {
                    return false;
                }
                let pixel = (rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3]);
                if pixel != crate::annotations::REDACTION_PIXEL {
                    return false;
                }
            }
        }
    }
    true
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
    let residual_hard_positives = detect_context_free(rerun_text);
    let mut residual_fragments = Vec::new();
    for value in flagged_source_values {
        let chars: Vec<char> = value.chars().collect();
        if chars.len() < 4 {
            continue;
        }
        for window_start in 0..=(chars.len() - 4) {
            let fragment: String = chars[window_start..window_start + 4].iter().collect();
            if rerun_text.contains(&fragment) {
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
    )
}

/// Brief §3.5 check 3 in full: every candidate must have reached a real
/// disposition, and every categorically-unredactable hard positive must
/// specifically be `Redact`. Returns every failure found, not just the
/// first — the caller needs the complete list to show a reviewer.
pub fn verify_coverage_proof(candidates: &[RedactionCandidate]) -> Vec<CoverageProofFailure> {
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
    }
    failures
}

/// Folds all three proofs into the brief §3.5 state machine. A judgment
/// call, flagged for review: any coverage failure means a human decision
/// is still needed or was overridden incorrectly, so it maps to
/// `ReviewRequired`; a pixel or removal failure with full coverage
/// already satisfied means the redaction pass itself did not hold even
/// though every candidate was already dispositioned correctly — re-review
/// alone cannot fix that, it needs a new redaction pass, so it maps to
/// `Blocked`. Brief §3.5: "transitions the step to REVIEW_REQUIRED or
/// BLOCKED, never VERIFIED" either way.
pub fn compute_frame_verification(
    pixel_proof_passed: bool,
    removal_proof: &RemovalProofResult,
    coverage_failures: &[CoverageProofFailure],
) -> FrameVerification {
    if pixel_proof_passed && matches!(removal_proof, RemovalProofResult::Clean) && coverage_failures.is_empty() {
        FrameVerification::Verified
    } else if !coverage_failures.is_empty() {
        FrameVerification::ReviewRequired
    } else {
        FrameVerification::Blocked
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let candidates = bind_matches_to_candidates(&hits, &tokens, &spans, 1000, 1000, "frame-1");
        assert_eq!(candidates.len(), 1);
        let c = &candidates[0];
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
        let candidates = bind_matches_to_candidates(&[synthetic_match], &tokens, &spans, 1000, 1000, "frame-1");
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].source_token_ids, vec!["t1".to_string(), "t2".to_string()]);
        // Union of (10,10,50,20) and (65,10,20,20): right edges 60 and 85 -> union width 75.
        assert_eq!(candidates[0].original_box, (10, 10, 75, 20));
        let _ = hits;
    }

    #[test]
    fn expansion_clips_to_the_frame_raster_at_the_edge() {
        let tokens = vec![token("t1", "219-09-9999", "l1", (0, 0, 100, 20))];
        let (text, spans) = join_tokens(&tokens);
        let hits = detect_context_free(&text);
        let candidates = bind_matches_to_candidates(&hits, &tokens, &spans, 100, 20, "frame-1");
        assert_eq!(candidates.len(), 1);
        // Expansion would go to x=-5,y=-5,right=105,bottom=25; clipped to
        // the 100x20 frame.
        assert_eq!(candidates[0].expanded_box, (0, 0, 100, 20));
    }

    #[test]
    fn a_match_covering_no_token_produces_no_candidate() {
        let synthetic_match = DeterministicMatch { start_byte: 1000, end_byte: 1010, rule_id: "det.test", reason_code: "TEST", score: None };
        let tokens = vec![token("t1", "hello", "l1", (0, 0, 10, 10))];
        let (_, spans) = join_tokens(&tokens);
        let candidates = bind_matches_to_candidates(&[synthetic_match], &tokens, &spans, 1000, 1000, "frame-1");
        assert!(candidates.is_empty());
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
        let candidates = bind_matches_to_candidates(&hits, &tokens, &spans, 1000, 1000, "frame-1");
        assert!(!candidates.is_empty());
        for c in &candidates {
            assert_eq!(c.disposition, Disposition::Redact, "{c:?} must default to Redact");
        }
    }

    #[test]
    fn candidate_ids_are_stable_and_scoped_by_the_given_prefix() {
        let tokens = vec![token("t1", "a@example.com", "l1", (0, 0, 10, 10)), token("t2", "219-09-9999", "l2", (0, 20, 10, 10))];
        let (text, spans) = join_tokens(&tokens);
        let hits = detect_context_free(&text);
        assert_eq!(hits.len(), 2);
        let candidates = bind_matches_to_candidates(&hits, &tokens, &spans, 1000, 1000, "frame-xyz");
        let ids: Vec<&str> = candidates.iter().map(|c| c.candidate_id.as_str()).collect();
        assert_eq!(ids, vec!["frame-xyz-0", "frame-xyz-1"]);
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
        assert!(verify_pixel_proof(&rgba, width, height, &regions));
    }

    #[test]
    fn pixel_proof_fails_when_a_declared_region_has_an_unpainted_pixel() {
        let width = 10u32;
        let height = 10u32;
        let rgba = vec![255u8; (width as usize) * (height as usize) * 4]; // never actually painted
        let regions = vec![(0, 0, 5, 5)];
        assert!(!verify_pixel_proof(&rgba, width, height, &regions));
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
        assert!(!verify_pixel_proof(&rgba, width, height, &regions));
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

    // ---- verification: coverage proof ----

    #[test]
    fn coverage_proof_passes_when_every_candidate_has_a_real_disposition() {
        let candidates = vec![candidate("c1", (0, 0, 5, 5), Disposition::Redact), candidate("c2", (10, 10, 5, 5), Disposition::MarkNonSensitive)];
        assert!(verify_coverage_proof(&candidates).is_empty());
    }

    #[test]
    fn coverage_proof_flags_a_pending_candidate() {
        let candidates = vec![candidate("c1", (0, 0, 5, 5), Disposition::Pending)];
        let failures = verify_coverage_proof(&candidates);
        assert_eq!(failures, vec![CoverageProofFailure::UndispositionedCandidate { candidate_id: "c1".to_string() }]);
    }

    #[test]
    fn coverage_proof_flags_a_payment_card_marked_non_sensitive() {
        let mut c = candidate("c1", (0, 0, 5, 5), Disposition::MarkNonSensitive);
        c.detector_id = "det.payment_card".to_string();
        let failures = verify_coverage_proof(&[c]);
        assert_eq!(
            failures,
            vec![CoverageProofFailure::UnredactableHardPositiveNotRedacted {
                candidate_id: "c1".to_string(),
                detector_id: "det.payment_card".to_string()
            }]
        );
    }

    #[test]
    fn coverage_proof_allows_an_ssn_marked_non_sensitive() {
        // SSN is a hard positive that defaults to Redact, but is not in
        // the categorically-unredactable "credential/private-key/
        // payment-card" set, so a human override is allowed.
        let mut c = candidate("c1", (0, 0, 5, 5), Disposition::MarkNonSensitive);
        c.detector_id = "det.ssn".to_string();
        assert!(verify_coverage_proof(&[c]).is_empty());
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

    // ---- verification: frame state machine ----

    #[test]
    fn frame_verification_is_verified_when_all_three_proofs_pass() {
        let v = compute_frame_verification(true, &RemovalProofResult::Clean, &[]);
        assert_eq!(v, FrameVerification::Verified);
    }

    #[test]
    fn frame_verification_is_review_required_on_a_coverage_failure() {
        let failures = vec![CoverageProofFailure::UndispositionedCandidate { candidate_id: "c1".to_string() }];
        let v = compute_frame_verification(true, &RemovalProofResult::Clean, &failures);
        assert_eq!(v, FrameVerification::ReviewRequired);
    }

    #[test]
    fn frame_verification_is_blocked_on_a_pixel_proof_failure_with_full_coverage() {
        let v = compute_frame_verification(false, &RemovalProofResult::Clean, &[]);
        assert_eq!(v, FrameVerification::Blocked);
    }

    #[test]
    fn frame_verification_is_blocked_on_a_removal_proof_failure_with_full_coverage() {
        let residual = RemovalProofResult::Residual { hard_positives: vec![], fragments: vec!["9999".to_string()] };
        let v = compute_frame_verification(true, &residual, &[]);
        assert_eq!(v, FrameVerification::Blocked);
    }

    #[test]
    fn frame_verification_is_never_verified_when_any_proof_fails() {
        // Exhaustive-ish sweep: verified requires all three; any single
        // failure must move off Verified.
        let coverage_failure = vec![CoverageProofFailure::UndispositionedCandidate { candidate_id: "c1".to_string() }];
        let residual = RemovalProofResult::Residual { hard_positives: vec![], fragments: vec!["9999".to_string()] };
        assert_ne!(compute_frame_verification(false, &RemovalProofResult::Clean, &[]), FrameVerification::Verified);
        assert_ne!(compute_frame_verification(true, &residual, &[]), FrameVerification::Verified);
        assert_ne!(compute_frame_verification(true, &RemovalProofResult::Clean, &coverage_failure), FrameVerification::Verified);
    }
}
