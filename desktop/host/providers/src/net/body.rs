// قراءة جسم الاستجابة بتأطيره: طول معلن، أو مقاطع، أو حتى الإغلاق.
//
// كل قراءة محدودة بسقف يمرّره المستدعي. جسم أكبر من السقف خطأ، لا اقتطاع صامت:
// قائمة نماذج مقتطعة تبدو سليمة وهي ناقصة.

use std::io::{self, Read};

use super::http::{io_to_transport, TransportError, TransportErrorKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Framing {
    Length(u64),
    Chunked,
    UntilClose,
}

enum ChunkState {
    /// ينتظر سطر الحجم.
    Size,
    /// داخل مقطع، وبقي هذا العدد.
    Data(u64),
    /// بعد مقطع: CRLF.
    DataEnd,
    Done,
}

pub struct BodyReader {
    leftover: io::Cursor<Vec<u8>>,
    source: Box<dyn Read + Send>,
    framing: Framing,
    consumed: u64,
    chunk: ChunkState,
}

impl BodyReader {
    pub(crate) fn new(leftover: Vec<u8>, source: Box<dyn Read + Send>, framing: Framing) -> Self {
        Self { leftover: io::Cursor::new(leftover), source, framing, consumed: 0, chunk: ChunkState::Size }
    }

    /// جسم ثابت للاختبار.
    pub fn from_bytes(bytes: Vec<u8>) -> Self {
        let length = bytes.len() as u64;
        Self::new(bytes, Box::new(io::empty()), Framing::Length(length))
    }

    fn raw_read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.leftover.read(buf)?;
        if n > 0 {
            return Ok(n);
        }
        self.source.read(buf)
    }

    fn raw_byte(&mut self) -> io::Result<Option<u8>> {
        let mut one = [0u8; 1];
        match self.raw_read(&mut one)? {
            0 => Ok(None),
            _ => Ok(Some(one[0])),
        }
    }

    fn raw_line(&mut self) -> io::Result<String> {
        let mut line = Vec::new();
        loop {
            match self.raw_byte()? {
                None => return Err(io::Error::new(io::ErrorKind::InvalidData, "truncated chunk framing")),
                Some(b'\n') => break,
                Some(b) => {
                    if line.len() > 1024 {
                        return Err(io::Error::new(io::ErrorKind::InvalidData, "chunk line too long"));
                    }
                    line.push(b);
                }
            }
        }
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        String::from_utf8(line).map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "chunk line is not text"))
    }

    fn read_chunked(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            match self.chunk {
                ChunkState::Done => return Ok(0),
                ChunkState::Size => {
                    let line = self.raw_line()?;
                    let size_text = line.split(';').next().unwrap_or("").trim();
                    let size = u64::from_str_radix(size_text, 16)
                        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid chunk size"))?;
                    if size == 0 {
                        // المقاطع الختامية تُقرأ وتُهمل حتى السطر الفارغ.
                        loop {
                            if self.raw_line()?.is_empty() {
                                break;
                            }
                        }
                        self.chunk = ChunkState::Done;
                        return Ok(0);
                    }
                    self.chunk = ChunkState::Data(size);
                }
                ChunkState::Data(remaining) => {
                    let want = buf.len().min(remaining as usize);
                    let n = self.raw_read(&mut buf[..want])?;
                    if n == 0 {
                        return Err(io::Error::new(io::ErrorKind::InvalidData, "truncated chunk"));
                    }
                    let left = remaining - n as u64;
                    self.chunk = if left == 0 { ChunkState::DataEnd } else { ChunkState::Data(left) };
                    return Ok(n);
                }
                ChunkState::DataEnd => {
                    let line = self.raw_line()?;
                    if !line.is_empty() {
                        return Err(io::Error::new(io::ErrorKind::InvalidData, "missing chunk terminator"));
                    }
                    self.chunk = ChunkState::Size;
                }
            }
        }
    }

    /// يقرأ الجسم كله حتى سقف. تجاوز السقف خطأ.
    pub fn read_all(&mut self, max_bytes: usize) -> Result<Vec<u8>, TransportError> {
        let mut out = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            let n = self.read(&mut chunk).map_err(|e| io_to_transport(&e))?;
            if n == 0 {
                return Ok(out);
            }
            if out.len() + n > max_bytes {
                return Err(TransportError::new(TransportErrorKind::ResponseTooLarge, "response body exceeds the limit"));
            }
            out.extend_from_slice(&chunk[..n]);
        }
    }
}

impl Read for BodyReader {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        match self.framing {
            Framing::Length(total) => {
                if self.consumed >= total {
                    return Ok(0);
                }
                let want = buf.len().min((total - self.consumed) as usize);
                let n = self.raw_read(&mut buf[..want])?;
                if n == 0 {
                    return Err(io::Error::new(io::ErrorKind::InvalidData, "body shorter than content-length"));
                }
                self.consumed += n as u64;
                Ok(n)
            }
            Framing::UntilClose => self.raw_read(buf),
            Framing::Chunked => self.read_chunked(buf),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reader(bytes: &[u8], framing: Framing) -> BodyReader {
        BodyReader::new(bytes.to_vec(), Box::new(io::empty()), framing)
    }

    #[test]
    fn chunked_bodies_are_decoded() {
        let mut body = reader(b"4\r\nWiki\r\n5;ext=1\r\npedia\r\n0\r\nTrailer: x\r\n\r\n", Framing::Chunked);
        assert_eq!(body.read_all(100).unwrap(), b"Wikipedia");
    }

    #[test]
    fn truncated_chunks_fail_rather_than_pass_short() {
        let mut body = reader(b"a\r\nshort", Framing::Chunked);
        assert!(body.read_all(100).is_err());
    }

    #[test]
    fn content_length_is_enforced_both_ways() {
        let mut short = reader(b"abc", Framing::Length(5));
        assert!(short.read_all(100).is_err());
        let mut exact = reader(b"abcdef", Framing::Length(3));
        assert_eq!(exact.read_all(100).unwrap(), b"abc");
    }

    #[test]
    fn the_size_limit_is_an_error_not_a_truncation() {
        let mut body = reader(&[b'x'; 64], Framing::UntilClose);
        let error = body.read_all(10).unwrap_err();
        assert_eq!(error.kind, TransportErrorKind::ResponseTooLarge);
    }
}
