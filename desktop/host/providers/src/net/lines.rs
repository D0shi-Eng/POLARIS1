// تأطير البث: أسطر NDJSON وأحداث SSE فوق جسم محدود.
//
// لا نصّ خام بلا تأطير يصل إلى طبقة أعلى: كل حدث يُسلَّم مكتملًا، وكل سطر محدود
// الطول، ومجموع البث محدود.

use std::io::Read;

use super::body::BodyReader;
use super::http::{io_to_transport, TransportError, TransportErrorKind};

pub struct LineReader<'a> {
    body: &'a mut BodyReader,
    buffer: Vec<u8>,
    total: usize,
    max_line: usize,
    max_total: usize,
    eof: bool,
}

impl<'a> LineReader<'a> {
    pub fn new(body: &'a mut BodyReader, max_line: usize, max_total: usize) -> Self {
        Self { body, buffer: Vec::new(), total: 0, max_line, max_total, eof: false }
    }

    /// السطر التالي بلا فاصل الأسطر، أو None عند النهاية.
    pub fn next_line(&mut self) -> Result<Option<String>, TransportError> {
        loop {
            if let Some(position) = self.buffer.iter().position(|b| *b == b'\n') {
                let mut line: Vec<u8> = self.buffer.drain(..=position).collect();
                line.pop();
                if line.last() == Some(&b'\r') {
                    line.pop();
                }
                return String::from_utf8(line)
                    .map(Some)
                    .map_err(|_| TransportError::new(TransportErrorKind::MalformedResponse, "stream line is not UTF-8"));
            }
            if self.buffer.len() > self.max_line {
                return Err(TransportError::new(TransportErrorKind::ResponseTooLarge, "stream line too long"));
            }
            if self.eof {
                if self.buffer.is_empty() {
                    return Ok(None);
                }
                let rest = std::mem::take(&mut self.buffer);
                return String::from_utf8(rest)
                    .map(Some)
                    .map_err(|_| TransportError::new(TransportErrorKind::MalformedResponse, "stream line is not UTF-8"));
            }
            let mut chunk = [0u8; 4096];
            let n = self.body.read(&mut chunk).map_err(|e| io_to_transport(&e))?;
            if n == 0 {
                self.eof = true;
                continue;
            }
            self.total += n;
            if self.total > self.max_total {
                return Err(TransportError::new(TransportErrorKind::ResponseTooLarge, "stream exceeds the limit"));
            }
            self.buffer.extend_from_slice(&chunk[..n]);
        }
    }

    /// حدث SSE التالي: قيم `data:` مجموعة حتى سطر فارغ.
    pub fn next_event(&mut self) -> Result<Option<String>, TransportError> {
        let mut data: Vec<String> = Vec::new();
        loop {
            match self.next_line()? {
                None => return Ok(if data.is_empty() { None } else { Some(data.join("\n")) }),
                Some(line) if line.is_empty() => {
                    if !data.is_empty() {
                        return Ok(Some(data.join("\n")));
                    }
                }
                Some(line) => {
                    if let Some(value) = line.strip_prefix("data:") {
                        data.push(value.strip_prefix(' ').unwrap_or(value).to_string());
                    }
                    // `event:` و`id:` والتعليقات تُهمل؛ المحتوى في `data` وحده.
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_events_are_assembled() {
        let mut body = BodyReader::from_bytes(b": comment\ndata: {\"a\":1}\n\nevent: x\ndata: part1\ndata: part2\n\ndata: [DONE]\n\n".to_vec());
        let mut lines = LineReader::new(&mut body, 1024, 4096);
        assert_eq!(lines.next_event().unwrap().as_deref(), Some("{\"a\":1}"));
        assert_eq!(lines.next_event().unwrap().as_deref(), Some("part1\npart2"));
        assert_eq!(lines.next_event().unwrap().as_deref(), Some("[DONE]"));
        assert_eq!(lines.next_event().unwrap(), None);
    }

    #[test]
    fn ndjson_lines_are_split_and_bounded() {
        let mut body = BodyReader::from_bytes(b"{\"x\":1}\r\n{\"x\":2}".to_vec());
        let mut lines = LineReader::new(&mut body, 1024, 4096);
        assert_eq!(lines.next_line().unwrap().as_deref(), Some("{\"x\":1}"));
        assert_eq!(lines.next_line().unwrap().as_deref(), Some("{\"x\":2}"));
        assert_eq!(lines.next_line().unwrap(), None);

        let mut big = BodyReader::from_bytes(vec![b'x'; 5000]);
        let mut bounded = LineReader::new(&mut big, 100, 100_000);
        assert!(bounded.next_line().is_err());
    }
}
