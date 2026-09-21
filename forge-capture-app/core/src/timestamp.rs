//! ISO-8601 UTC timestamps from `std::time::SystemTime` — no dependencies.
//!
//! The native shell stamps every artifact with `captured_at`; keeping the
//! formatter in core (pure std) means the contract is testable on any host.

use std::time::{SystemTime, UNIX_EPOCH};

/// Format a `SystemTime` as `YYYY-MM-DDTHH:MM:SSZ` (UTC).
pub fn to_iso8601_utc(t: SystemTime) -> String {
    let secs = t
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = civil_from_days(secs.div_euclid(86400));
    let sod = secs.rem_euclid(86400);
    let _ = (h, mi, s);
    let (hh, mm, ss) = (sod / 3600, (sod % 3600) / 60, sod % 60);
    format!("{y:04}-{mo:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

/// Current UTC time as ISO-8601.
pub fn now_utc_iso8601() -> String {
    to_iso8601_utc(SystemTime::now())
}

/// Days since the Unix epoch → (year, month, day). Howard Hinnant's civil
/// algorithm; valid for the full i64 day range.
fn civil_from_days(z: i64) -> (i64, u32, u32, u32, u32, u32) {
    let z = z + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32, 0, 0, 0)
}

/// `YYYYMMDD` date stamp, used for capture file names.
pub fn date_stamp_utc(t: SystemTime) -> String {
    let secs = t
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, mo, d, _, _, _) = civil_from_days(secs.div_euclid(86400));
    format!("{y:04}{mo:02}{d:02}")
}

/// `HHMMSS` time stamp, used for capture file names.
pub fn time_stamp_utc(t: SystemTime) -> String {
    let secs = t
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let sod = secs.rem_euclid(86400);
    format!("{:02}{:02}{:02}", sod / 3600, (sod % 3600) / 60, sod % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn epoch_formats_correctly() {
        assert_eq!(to_iso8601_utc(UNIX_EPOCH), "1970-01-01T00:00:00Z");
    }

    #[test]
    fn known_timestamp() {
        // 2026-09-21T08:30:00Z
        let t = UNIX_EPOCH + Duration::from_secs(1789979400);
        assert_eq!(to_iso8601_utc(t), "2026-09-21T08:30:00Z");
    }

    #[test]
    fn leap_day() {
        // 2024-02-29T12:00:00Z
        let t = UNIX_EPOCH + Duration::from_secs(1709208000);
        assert_eq!(to_iso8601_utc(t), "2024-02-29T12:00:00Z");
    }

    #[test]
    fn stamps_have_fixed_width() {
        let t = UNIX_EPOCH + Duration::from_secs(1789979400);
        assert_eq!(date_stamp_utc(t), "20260921");
        assert_eq!(time_stamp_utc(t), "083000");
        assert_eq!(to_iso8601_utc(t).len(), 20);
        assert!(to_iso8601_utc(t).ends_with('Z'));
    }

    #[test]
    fn now_is_sane_shape() {
        let s = now_utc_iso8601();
        assert_eq!(s.len(), 20);
        assert_eq!(&s[10..11], "T");
        assert!(s.ends_with('Z'));
    }
}
