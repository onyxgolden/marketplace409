//! Minimal dependency-free PNG encoder (8-bit RGBA).
//!
//! Rationale: the 2a shell must save captures as PNG with zero native
//! dependencies (no libpng, no FFmpeg — both banned/undesired for this
//! program). The encoder emits **stored (uncompressed) deflate blocks**,
//! which is valid PNG that every decoder accepts; files are larger than with
//! a compressing encoder, which is a documented 2a tradeoff, not a
//! correctness issue. A compressing encoder is a future optimization that
//! changes no contract.
//!
//! Layout: signature, IHDR, IDAT (zlib wrapper around stored blocks),
//! IEND. CRC-32 (ISO HDLC) per chunk, Adler-32 for the zlib stream.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PngError {
    EmptyImage,
    DimensionTooLarge { width: u32, height: u32 },
    ByteLengthMismatch { expected: usize, actual: usize },
    AdlerMismatch { expected: u32, actual: u32 },
}

impl std::fmt::Display for PngError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PngError::EmptyImage => write!(f, "image has zero width or height"),
            PngError::DimensionTooLarge { width, height } => {
                write!(f, "dimensions {width}x{height} exceed the 16384px cap")
            }
            PngError::ByteLengthMismatch { expected, actual } => {
                write!(f, "expected {expected} RGBA bytes, got {actual}")
            }
            PngError::AdlerMismatch { expected, actual } => {
                write!(
                    f,
                    "zlib Adler-32 mismatch: stream says {expected:08x}, computed {actual:08x}"
                )
            }
        }
    }
}

impl std::error::Error for PngError {}

/// Mirrors the Rung 1 editor's `MAX_SOURCE_DIMENSION` (limits.js).
pub const MAX_PNG_DIMENSION: u32 = 16384;

/// Encode RGBA bytes (row-major, top-left first) as a PNG.
pub fn encode_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, PngError> {
    if width == 0 || height == 0 {
        return Err(PngError::EmptyImage);
    }
    if width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION {
        return Err(PngError::DimensionTooLarge { width, height });
    }
    let expected = width as usize * height as usize * 4;
    if rgba.len() != expected {
        return Err(PngError::ByteLengthMismatch {
            expected,
            actual: rgba.len(),
        });
    }

    let mut out = Vec::with_capacity(expected + 128);
    // Signature.
    out.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);
    // IHDR: width, height, bit depth 8, color type 6 (RGBA), compression 0,
    // filter 0, interlace 0.
    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&width.to_be_bytes());
    ihdr[4..8].copy_from_slice(&height.to_be_bytes());
    ihdr[8] = 8;
    ihdr[9] = 6;
    write_chunk(&mut out, b"IHDR", &ihdr);

    // IDAT payload: zlib( stored deflate blocks of filter-0 scanlines ).
    let stride = width as usize * 4;
    let mut raw = Vec::with_capacity(height as usize * (stride + 1));
    for row in 0..height as usize {
        raw.push(0); // filter type 0: None
        raw.extend_from_slice(&rgba[row * stride..(row + 1) * stride]);
    }
    let zlib = zlib_store(&raw);
    write_chunk(&mut out, b"IDAT", &zlib);
    write_chunk(&mut out, b"IEND", &[]);
    Ok(out)
}

/// Decode a PNG produced by [`encode_rgba`] back to RGBA bytes.
///
/// This is deliberately *not* a general PNG decoder: it only accepts the
/// exact format our encoder emits (stored deflate blocks, filter type 0 on
/// every scanline). It exists so the shell can round-trip its own captures
/// (e.g. clipboard copy) without pulling in an image-decoding dependency.
/// Foreign PNGs continue to flow through the Rung 1 editor's decoder.
pub fn decode_own(png: &[u8]) -> Result<(u32, u32, Vec<u8>), PngError> {
    const SIG: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
    if png.len() < 8 || png[0..8] != SIG {
        return Err(PngError::ByteLengthMismatch {
            expected: 8,
            actual: png.len().min(8),
        });
    }
    let mut i = 8usize;
    let mut width = 0u32;
    let mut height = 0u32;
    let mut seen_ihdr = false;
    let mut idat: Vec<u8> = Vec::new();
    loop {
        if i + 12 > png.len() {
            return Err(PngError::EmptyImage);
        }
        let len = u32::from_be_bytes(png[i..i + 4].try_into().unwrap()) as usize;
        let kind: [u8; 4] = png[i + 4..i + 8].try_into().unwrap();
        if i + 12 + len > png.len() {
            return Err(PngError::EmptyImage);
        }
        let data = &png[i + 8..i + 8 + len];
        // Verify the chunk CRC — a corrupt file must not decode silently.
        let mut crc_input = Vec::with_capacity(4 + len);
        crc_input.extend_from_slice(&kind);
        crc_input.extend_from_slice(data);
        let want = u32::from_be_bytes(png[i + 8 + len..i + 12 + len].try_into().unwrap());
        if crc32(&crc_input) != want {
            return Err(PngError::ByteLengthMismatch {
                expected: want as usize,
                actual: crc32(&crc_input) as usize,
            });
        }
        match &kind {
            b"IHDR" => {
                if len != 13
                    || data[8] != 8
                    || data[9] != 6
                    || data[10] != 0
                    || data[11] != 0
                    || data[12] != 0
                {
                    return Err(PngError::EmptyImage);
                }
                width = u32::from_be_bytes(data[0..4].try_into().unwrap());
                height = u32::from_be_bytes(data[4..8].try_into().unwrap());
                check_dims(width, height)?;
                seen_ihdr = true;
            }
            b"IDAT" => idat.extend_from_slice(data),
            b"IEND" => break,
            _ => {}
        }
        i += 12 + len;
    }
    if !seen_ihdr || idat.len() < 6 {
        return Err(PngError::EmptyImage);
    }
    if idat[0] != 0x78 || idat[1] != 0x01 {
        return Err(PngError::EmptyImage);
    }
    // The zlib stream's final 4 bytes are the Adler-32 of the raw
    // scanlines: verify it instead of stripping it unchecked — a corrupt
    // stream must not decode silently.
    let stored_adler = u32::from_be_bytes(idat[idat.len() - 4..].try_into().unwrap());
    let raw = inflate_stored(&idat[2..idat.len() - 4]).ok_or(PngError::EmptyImage)?;
    let computed_adler = adler32(&raw);
    if computed_adler != stored_adler {
        return Err(PngError::AdlerMismatch {
            expected: stored_adler,
            actual: computed_adler,
        });
    }
    let stride = width as usize * 4;
    if raw.len() != height as usize * (stride + 1) {
        return Err(PngError::ByteLengthMismatch {
            expected: height as usize * (stride + 1),
            actual: raw.len(),
        });
    }
    let mut rgba = Vec::with_capacity(height as usize * stride);
    for row in 0..height as usize {
        let base = row * (stride + 1);
        if raw[base] != 0 {
            // Only filter type 0 is in our encoder's output repertoire.
            return Err(PngError::EmptyImage);
        }
        rgba.extend_from_slice(&raw[base + 1..base + 1 + stride]);
    }
    Ok((width, height, rgba))
}

fn check_dims(width: u32, height: u32) -> Result<(), PngError> {
    if width == 0 || height == 0 {
        return Err(PngError::EmptyImage);
    }
    if width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION {
        return Err(PngError::DimensionTooLarge { width, height });
    }
    Ok(())
}

/// Inflate stored-block-only deflate (shared by the encoder tests and
/// [`decode_own`]). Returns `None` on any malformed input.
fn inflate_stored(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut i = 0;
    loop {
        if i >= data.len() {
            return None;
        }
        let header = data[i];
        i += 1;
        let last = header & 1 == 1;
        if header & 0b110 != 0 {
            return None; // not a stored block
        }
        if i + 4 > data.len() {
            return None;
        }
        let len = u16::from_le_bytes([data[i], data[i + 1]]) as usize;
        let nlen = u16::from_le_bytes([data[i + 2], data[i + 3]]);
        if nlen != !len as u16 {
            return None;
        }
        i += 4;
        if i + len > data.len() {
            return None;
        }
        out.extend_from_slice(&data[i..i + len]);
        i += len;
        if last {
            break;
        }
    }
    Some(out)
}
/// IEEE CRC-32 over `data`.
pub fn crc32(data: &[u8]) -> u32 {
    // Table-driven; the table is generated on first use and cached in a
    // static to keep this module dependency-free without a build script.
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut t = [0u32; 256];
        for (n, slot) in t.iter_mut().enumerate() {
            let mut c = n as u32;
            for _ in 0..8 {
                c = if c & 1 == 1 {
                    0xedb88320 ^ (c >> 1)
                } else {
                    c >> 1
                };
            }
            *slot = c;
        }
        t
    });
    let mut crc = 0xffff_ffffu32;
    for &b in data {
        crc = table[((crc ^ b as u32) & 0xff) as usize] ^ (crc >> 8);
    }
    crc ^ 0xffff_ffff
}

fn adler32(data: &[u8]) -> u32 {
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &byte in data {
        a = (a + byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

fn write_chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let mut crc_input = Vec::with_capacity(4 + data.len());
    crc_input.extend_from_slice(kind);
    crc_input.extend_from_slice(data);
    out.extend_from_slice(&crc32(&crc_input).to_be_bytes());
}

/// zlib wrapper (header 0x78 0x01) around stored deflate blocks.
fn zlib_store(raw: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw.len() + 16);
    out.push(0x78);
    out.push(0x01);
    let mut rest = raw;
    while !rest.is_empty() {
        let take = rest.len().min(65535);
        let (block, tail) = rest.split_at(take);
        rest = tail;
        let last = rest.is_empty();
        out.push(if last { 0x01 } else { 0x00 }); // BFINAL + BTYPE=00 (stored)
        out.extend_from_slice(&(block.len() as u16).to_le_bytes());
        out.extend_from_slice(&(!(block.len() as u16)).to_le_bytes());
        out.extend_from_slice(block);
    }
    out.extend_from_slice(&adler32(raw).to_be_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_rgba(w: u32, h: u32) -> Vec<u8> {
        // Deterministic pattern: R=x, G=y, B=(x+y)%256, A=255.
        let mut v = Vec::with_capacity((w * h * 4) as usize);
        for y in 0..h {
            for x in 0..w {
                v.push((x % 256) as u8);
                v.push((y % 256) as u8);
                v.push(((x + y) % 256) as u8);
                v.push(255);
            }
        }
        v
    }

    /// Inflate *stored-block-only* deflate (what our encoder emits) via the
    /// shared helper. Enough to prove the test decoder recovers exact pixels.
    fn inflate_test(data: &[u8]) -> Vec<u8> {
        inflate_stored(data).expect("test encoder must emit valid stored blocks")
    }

    fn parse_chunks(png: &[u8]) -> Vec<([u8; 4], Vec<u8>)> {
        assert_eq!(&png[0..8], &[137, 80, 78, 71, 13, 10, 26, 10]);
        let mut chunks = Vec::new();
        let mut i = 8;
        loop {
            let len = u32::from_be_bytes(png[i..i + 4].try_into().unwrap()) as usize;
            let kind: [u8; 4] = png[i + 4..i + 8].try_into().unwrap();
            let data = png[i + 8..i + 8 + len].to_vec();
            let want = u32::from_be_bytes(png[i + 8 + len..i + 12 + len].try_into().unwrap());
            let mut crc_input = Vec::new();
            crc_input.extend_from_slice(&kind);
            crc_input.extend_from_slice(&data);
            assert_eq!(crc32(&crc_input), want, "CRC mismatch on {kind:?}");
            i += 12 + len;
            let done = &kind == b"IEND";
            chunks.push((kind, data));
            if done {
                break;
            }
        }
        chunks
    }

    #[test]
    fn round_trip_pixels() {
        let w = 7u32;
        let h = 5u32;
        let rgba = make_rgba(w, h);
        let png = encode_rgba(w, h, &rgba).unwrap();
        let chunks = parse_chunks(&png);
        let kinds: Vec<String> = chunks
            .iter()
            .map(|(k, _)| String::from_utf8_lossy(k).into_owned())
            .collect();
        assert_eq!(kinds, vec!["IHDR", "IDAT", "IEND"]);

        let ihdr = &chunks[0].1;
        assert_eq!(u32::from_be_bytes(ihdr[0..4].try_into().unwrap()), w);
        assert_eq!(u32::from_be_bytes(ihdr[4..8].try_into().unwrap()), h);
        assert_eq!(ihdr[8], 8); // bit depth
        assert_eq!(ihdr[9], 6); // color type RGBA

        // Decompress IDAT and compare scanlines (filter byte 0 + row bytes).
        let idat = &chunks[1].1;
        assert_eq!(&idat[0..2], &[0x78, 0x01]);
        let raw = inflate_test(&idat[2..idat.len() - 4]);
        let adler = u32::from_be_bytes(idat[idat.len() - 4..].try_into().unwrap());
        assert_eq!(adler, adler32(&raw));
        let stride = w as usize * 4;
        assert_eq!(raw.len(), h as usize * (stride + 1));
        for row in 0..h as usize {
            assert_eq!(raw[row * (stride + 1)], 0, "filter byte must be 0");
            assert_eq!(
                &raw[row * (stride + 1) + 1..(row + 1) * (stride + 1)],
                &rgba[row * stride..(row + 1) * stride]
            );
        }
    }

    #[test]
    fn rejects_bad_inputs() {
        assert_eq!(encode_rgba(0, 10, &[]), Err(PngError::EmptyImage));
        assert_eq!(
            encode_rgba(16385, 10, &[]),
            Err(PngError::DimensionTooLarge {
                width: 16385,
                height: 10
            })
        );
        assert_eq!(
            encode_rgba(2, 2, &[0u8; 15]),
            Err(PngError::ByteLengthMismatch {
                expected: 16,
                actual: 15
            })
        );
    }

    #[test]
    fn large_image_uses_multiple_stored_blocks() {
        // 300×300 RGBA = 360_000 raw bytes > 65_535 → several stored blocks.
        let w = 300u32;
        let h = 300u32;
        let rgba = make_rgba(w, h);
        let png = encode_rgba(w, h, &rgba).unwrap();
        let chunks = parse_chunks(&png);
        let idat = &chunks.iter().find(|(k, _)| k == b"IDAT").unwrap().1;
        let raw = inflate_test(&idat[2..idat.len() - 4]);
        assert_eq!(raw.len(), h as usize * (w as usize * 4 + 1));
        assert_eq!(raw[0], 0);
    }

    #[test]
    fn crc32_matches_known_vector() {
        assert_eq!(crc32(b"123456789"), 0xcbf43926);
    }

    #[test]
    fn decode_own_round_trip() {
        let w = 9u32;
        let h = 6u32;
        let rgba = make_rgba(w, h);
        let png = encode_rgba(w, h, &rgba).unwrap();
        let (dw, dh, back) = decode_own(&png).unwrap();
        assert_eq!((dw, dh), (w, h));
        assert_eq!(back, rgba);
    }

    #[test]
    fn decode_own_rejects_foreign_or_corrupt() {
        let w = 4u32;
        let h = 4u32;
        let png = encode_rgba(w, h, &make_rgba(w, h)).unwrap();
        // Truncated.
        assert!(decode_own(&png[..png.len() - 8]).is_err());
        // Not a PNG at all.
        assert!(decode_own(b"definitely not a png").is_err());
        // Flipped byte breaks the chunk CRC.
        let mut bad = png.clone();
        bad[40] ^= 0xff;
        assert!(decode_own(&bad).is_err());
    }

    #[test]
    fn decode_own_rejects_corrupt_adler() {
        let w = 4u32;
        let h = 4u32;
        let png = encode_rgba(w, h, &make_rgba(w, h)).unwrap();
        // Corrupt the Adler-32 trailer inside the IDAT data, then repair
        // the IDAT chunk CRC so the failure is attributable to the Adler
        // check alone (a chunk-CRC failure would mask it).
        let mut bad = png.clone();
        let mut i = 8usize; // skip the PNG signature
        loop {
            let len = u32::from_be_bytes(bad[i..i + 4].try_into().unwrap()) as usize;
            let kind: [u8; 4] = bad[i + 4..i + 8].try_into().unwrap();
            if &kind == b"IDAT" {
                let adler_pos = i + 8 + len - 1; // last byte of the Adler trailer
                bad[adler_pos] ^= 0xff;
                let mut crc_input = Vec::with_capacity(4 + len);
                crc_input.extend_from_slice(b"IDAT");
                crc_input.extend_from_slice(&bad[i + 8..i + 8 + len]);
                let crc = crc32(&crc_input);
                bad[i + 8 + len..i + 12 + len].copy_from_slice(&crc.to_be_bytes());
                break;
            }
            i += 12 + len;
        }
        assert!(
            matches!(decode_own(&bad), Err(PngError::AdlerMismatch { .. })),
            "corrupt Adler-32 must be rejected, not decoded"
        );
    }
}
