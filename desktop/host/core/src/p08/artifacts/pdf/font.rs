// قراءة خط TrueType بقدر ما يلزم لتضمينه في PDF: خريطة المحارف والعروض ومقاييس الرأس.
//
// الخط بيانات غير موثوقة من القرص، فكل قراءة محدودة وتفشل برمز بدل الذعر. وحقل
// أذونات التضمين (fsType في جدول OS/2) يُحترم: خطّ يمنع التضمين لا يُضمَّن، ويُعلن ذلك.

use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct TrueTypeFont {
    pub bytes: Vec<u8>,
    pub units_per_em: u16,
    pub ascent: i16,
    pub descent: i16,
    pub bbox: [i16; 4],
    pub cmap: BTreeMap<u32, u16>,
    pub advances: Vec<u16>,
    pub postscript_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FontError {
    Malformed(&'static str),
    NoUnicodeCmap,
    EmbeddingRestricted,
    TooLarge,
}

impl std::fmt::Display for FontError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Malformed(what) => write!(f, "the font is malformed ({what})"),
            Self::NoUnicodeCmap => write!(f, "the font has no Unicode character map"),
            Self::EmbeddingRestricted => write!(f, "the font's licence flags forbid embedding"),
            Self::TooLarge => write!(f, "the font file is larger than the embedding limit"),
        }
    }
}

const MAX_FONT_BYTES: usize = 32 * 1024 * 1024;

fn u16_at(b: &[u8], at: usize) -> Result<u16, FontError> {
    b.get(at..at + 2).map(|s| u16::from_be_bytes([s[0], s[1]])).ok_or(FontError::Malformed("short read"))
}
fn i16_at(b: &[u8], at: usize) -> Result<i16, FontError> {
    u16_at(b, at).map(|v| v as i16)
}
fn u32_at(b: &[u8], at: usize) -> Result<u32, FontError> {
    b.get(at..at + 4).map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]])).ok_or(FontError::Malformed("short read"))
}

fn table(b: &[u8], tag: &[u8; 4]) -> Result<Option<(usize, usize)>, FontError> {
    let count = u16_at(b, 4)? as usize;
    for i in 0..count {
        let rec = 12 + i * 16;
        if b.get(rec..rec + 4) == Some(tag.as_slice()) {
            let offset = u32_at(b, rec + 8)? as usize;
            let length = u32_at(b, rec + 12)? as usize;
            if offset.checked_add(length).is_none_or(|end| end > b.len()) {
                return Err(FontError::Malformed("table outside the file"));
            }
            return Ok(Some((offset, length)));
        }
    }
    Ok(None)
}

fn required(b: &[u8], tag: &[u8; 4], name: &'static str) -> Result<usize, FontError> {
    table(b, tag)?.map(|(o, _)| o).ok_or(FontError::Malformed(name))
}

fn parse_cmap(b: &[u8], cmap: usize) -> Result<BTreeMap<u32, u16>, FontError> {
    let count = u16_at(b, cmap + 2)? as usize;
    let mut best: Option<(u16, usize)> = None;
    for i in 0..count {
        let rec = cmap + 4 + i * 8;
        let platform = u16_at(b, rec)?;
        let encoding = u16_at(b, rec + 2)?;
        let offset = cmap + u32_at(b, rec + 4)? as usize;
        let format = u16_at(b, offset)?;
        // الأفضلية: جدول Unicode كامل (12) ثم BMP (4).
        let rank = match (platform, encoding, format) {
            (3, 10, 12) | (0, 4, 12) => 2,
            (3, 1, 4) | (0, 3, 4) => 1,
            _ => 0,
        };
        if rank > 0 && best.is_none_or(|(r, _)| rank > r) {
            best = Some((rank, offset));
        }
    }
    let (_, offset) = best.ok_or(FontError::NoUnicodeCmap)?;
    let mut map = BTreeMap::new();
    match u16_at(b, offset)? {
        4 => {
            let seg_x2 = u16_at(b, offset + 6)? as usize;
            let ends = offset + 14;
            let starts = ends + seg_x2 + 2;
            let deltas = starts + seg_x2;
            let ranges = deltas + seg_x2;
            for s in 0..seg_x2 / 2 {
                let end = u16_at(b, ends + s * 2)? as u32;
                let start = u16_at(b, starts + s * 2)? as u32;
                let delta = u16_at(b, deltas + s * 2)?;
                let range = u16_at(b, ranges + s * 2)? as usize;
                if start > end || start == 0xFFFF {
                    continue;
                }
                for c in start..=end {
                    let glyph = if range == 0 {
                        (c as u16).wrapping_add(delta)
                    } else {
                        let at = ranges + s * 2 + range + (c - start) as usize * 2;
                        let g = u16_at(b, at)?;
                        if g == 0 { 0 } else { g.wrapping_add(delta) }
                    };
                    if glyph != 0 {
                        map.insert(c, glyph);
                    }
                }
            }
        }
        12 => {
            let groups = u32_at(b, offset + 12)? as usize;
            if groups > 100_000 {
                return Err(FontError::Malformed("too many cmap groups"));
            }
            for g in 0..groups {
                let rec = offset + 16 + g * 12;
                let start = u32_at(b, rec)?;
                let end = u32_at(b, rec + 4)?;
                let glyph = u32_at(b, rec + 8)?;
                if end < start || end - start > 0x10000 {
                    continue;
                }
                for c in start..=end {
                    let id = glyph + (c - start);
                    if id <= u16::MAX as u32 && id != 0 {
                        map.insert(c, id as u16);
                    }
                }
            }
        }
        _ => return Err(FontError::NoUnicodeCmap),
    }
    Ok(map)
}

impl TrueTypeFont {
    pub fn parse(bytes: Vec<u8>) -> Result<Self, FontError> {
        if bytes.len() > MAX_FONT_BYTES {
            return Err(FontError::TooLarge);
        }
        let b = &bytes;
        let version = u32_at(b, 0)?;
        if version != 0x0001_0000 && version != 0x7472_7565 {
            return Err(FontError::Malformed("not a TrueType outline font"));
        }
        let head = required(b, b"head", "head")?;
        let hhea = required(b, b"hhea", "hhea")?;
        let hmtx = required(b, b"hmtx", "hmtx")?;
        let maxp = required(b, b"maxp", "maxp")?;
        let cmap = required(b, b"cmap", "cmap")?;
        if let Some((os2, _)) = table(b, b"OS/2")? {
            let fs_type = u16_at(b, os2 + 8)?;
            // 0x0002: تضمين مقيّد (Restricted License). لا يُضمَّن.
            if fs_type & 0x000F == 0x0002 {
                return Err(FontError::EmbeddingRestricted);
            }
        }
        let units_per_em = u16_at(b, head + 18)?;
        let bbox = [i16_at(b, head + 36)?, i16_at(b, head + 38)?, i16_at(b, head + 40)?, i16_at(b, head + 42)?];
        let ascent = i16_at(b, hhea + 4)?;
        let descent = i16_at(b, hhea + 6)?;
        let metrics = u16_at(b, hhea + 34)? as usize;
        let glyphs = u16_at(b, maxp + 4)? as usize;
        if units_per_em == 0 || metrics == 0 || metrics > glyphs {
            return Err(FontError::Malformed("metrics"));
        }
        let mut advances = Vec::with_capacity(glyphs);
        for g in 0..glyphs {
            let at = hmtx + g.min(metrics - 1) * 4;
            advances.push(u16_at(b, at)?);
        }
        let map = parse_cmap(b, cmap)?;
        let postscript_name = postscript_name(b).unwrap_or_else(|| "POLARISEmbedded".into());
        Ok(Self { units_per_em, ascent, descent, bbox, cmap: map, advances, postscript_name, bytes })
    }

    pub fn glyph(&self, c: char) -> Option<u16> {
        self.cmap.get(&(c as u32)).copied()
    }

    /// عرض المحرف بوحدات 1/1000 من حجم الخط.
    pub fn width_1000(&self, glyph: u16) -> u32 {
        let adv = self.advances.get(glyph as usize).copied().unwrap_or(0) as u32;
        adv * 1000 / self.units_per_em as u32
    }

    pub fn scale(&self, v: i16) -> i32 {
        v as i32 * 1000 / self.units_per_em as i32
    }
}

/// اسم PostScript من جدول الأسماء (المعرّف 6)، مقتصرًا على محارف آمنة لاسم PDF.
fn postscript_name(b: &[u8]) -> Option<String> {
    let (name, _) = table(b, b"name").ok()??;
    let count = u16_at(b, name + 2).ok()? as usize;
    let storage = name + u16_at(b, name + 4).ok()? as usize;
    for i in 0..count {
        let rec = name + 6 + i * 12;
        let platform = u16_at(b, rec).ok()?;
        let id = u16_at(b, rec + 6).ok()?;
        if id != 6 {
            continue;
        }
        let len = u16_at(b, rec + 8).ok()? as usize;
        let off = storage + u16_at(b, rec + 10).ok()? as usize;
        let raw = b.get(off..off + len)?;
        let text: String = if platform == 3 || platform == 0 {
            raw.chunks(2).filter_map(|p| if p.len() == 2 { char::from_u32(u16::from_be_bytes([p[0], p[1]]) as u32) } else { None }).collect()
        } else {
            raw.iter().map(|&c| c as char).collect()
        };
        let clean: String = text.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(60).collect();
        if !clean.is_empty() {
            return Some(clean);
        }
    }
    None
}
