// مقابس الحلقة المحلية وحدها (Phase-08): مستمع ردّ OAuth، وعميل WebSocket لبروتوكول DevTools.
//
// لماذا هنا: طبقة الشبكة هي الموضع المُعلن الوحيد الذي يفتح مقبسًا. هذا الملف لا يعرف
// إلا العنوان 127.0.0.1 — لا اسم يُحلّ ولا عنوان يُمرَّر: المنفذ وحده يأتي من المستدعي،
// والعنوان ثابت في الشيفرة. كل قراءة بمهلة، وكل رسالة بسقف حجم.

use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpListener, TcpStream};
use std::time::{Duration, Instant};

use super::cancel::CancelToken;

const LOOPBACK: Ipv4Addr = Ipv4Addr::LOCALHOST;
/// أقصى حجم رسالة WebSocket واحدة: لقطة شاشة PNG بترميز base64 مع هامش.
pub const MAX_WS_MESSAGE: usize = 48 * 1024 * 1024;
const MAX_REQUEST_HEAD: usize = 16 * 1024;

/// مستمع ردّ OAuth: طلب GET واحد على 127.0.0.1، ثم يُغلق.
pub struct CallbackListener {
    listener: TcpListener,
    port: u16,
}

impl CallbackListener {
    pub fn bind() -> io::Result<Self> {
        let listener = TcpListener::bind(SocketAddrV4::new(LOOPBACK, 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        Ok(Self { listener, port })
    }

    pub fn port(&self) -> u16 {
        self.port
    }

    /// ينتظر طلبًا واحدًا حتى المهلة أو الإلغاء، ويعيد مسار الطلب مع استعلامه، ويردّ بالصفحة.
    /// الطلب غير GET أو المسار الذي لا يبدأ بالمسار المتوقَّع يُردّ عليه 404 ويُنتظر غيره.
    pub fn accept_one(&self, expected_path: &str, deadline: Instant, cancel: &CancelToken, reply_html: &str) -> io::Result<String> {
        loop {
            if cancel.is_cancelled() {
                return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
            }
            if Instant::now() >= deadline {
                return Err(io::Error::new(io::ErrorKind::TimedOut, "no callback arrived before the deadline"));
            }
            match self.listener.accept() {
                Ok((mut stream, peer)) => {
                    if !peer.ip().is_loopback() {
                        continue;
                    }
                    stream.set_nonblocking(false)?;
                    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
                    let head = read_head(&mut stream)?;
                    let first = head.lines().next().unwrap_or("");
                    let mut parts = first.split(' ');
                    let (method, target) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
                    if method != "GET" || !target.starts_with(expected_path) {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        continue;
                    }
                    let body = reply_html.as_bytes();
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    stream.write_all(response.as_bytes())?;
                    stream.write_all(body)?;
                    return Ok(target.to_string());
                }
                Err(e) if e.kind() == io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(40)),
                Err(e) => return Err(e),
            }
        }
    }
}

fn read_head(stream: &mut TcpStream) -> io::Result<String> {
    let mut buf = Vec::new();
    let mut byte = [0u8; 1];
    while !buf.ends_with(b"\r\n\r\n") {
        if stream.read(&mut byte)? == 0 {
            break;
        }
        buf.push(byte[0]);
        if buf.len() > MAX_REQUEST_HEAD {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "request head too large"));
        }
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// SHA-1 لتحقّق مصافحة WebSocket وحده (RFC 6455). ليس لأي استعمال أمني آخر.
fn sha1(data: &[u8]) -> [u8; 20] {
    let mut h: [u32; 5] = [0x6745_2301, 0xEFCD_AB89, 0x98BA_DCFE, 0x1032_5476, 0xC3D2_E1F0];
    let mut msg = data.to_vec();
    let bit_len = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());
    for chunk in msg.chunks(64) {
        let mut w = [0u32; 80];
        for i in 0..16 {
            w[i] = u32::from_be_bytes([chunk[4 * i], chunk[4 * i + 1], chunk[4 * i + 2], chunk[4 * i + 3]]);
        }
        for i in 16..80 {
            w[i] = (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]).rotate_left(1);
        }
        let (mut a, mut b, mut c, mut d, mut e) = (h[0], h[1], h[2], h[3], h[4]);
        for (i, wi) in w.iter().enumerate() {
            let (f, k) = match i {
                0..=19 => ((b & c) | (!b & d), 0x5A82_7999),
                20..=39 => (b ^ c ^ d, 0x6ED9_EBA1),
                40..=59 => ((b & c) | (b & d) | (c & d), 0x8F1B_BCDC),
                _ => (b ^ c ^ d, 0xCA62_C1D6),
            };
            let temp = a.rotate_left(5).wrapping_add(f).wrapping_add(e).wrapping_add(k).wrapping_add(*wi);
            e = d;
            d = c;
            c = b.rotate_left(30);
            b = a;
            a = temp;
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
    }
    let mut out = [0u8; 20];
    for (i, v) in h.iter().enumerate() {
        out[4 * i..4 * i + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64(data: &[u8]) -> String {
    let mut out = String::new();
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(B64[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// بذرة غير متوقّعة لمفتاح المصافحة وأقنعة الإطارات (حماية الوسطاء، لا سرّية).
fn nonce() -> u64 {
    use std::hash::{BuildHasher, Hasher};
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u128(Instant::now().elapsed().as_nanos());
    h.finish()
}

/// عميل WebSocket على الحلقة المحلية (نصوص فقط، كما يحتاجه بروتوكول DevTools).
pub struct LoopbackWebSocket {
    stream: TcpStream,
}

impl LoopbackWebSocket {
    /// يتصل بـ127.0.0.1:port ويصافح على المسار المعطى.
    pub fn connect(port: u16, path: &str, timeout: Duration) -> io::Result<Self> {
        if !path.starts_with('/') || path.contains(['\r', '\n', ' ']) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid WebSocket path"));
        }
        let addr = SocketAddr::V4(SocketAddrV4::new(LOOPBACK, port));
        let mut stream = TcpStream::connect_timeout(&addr, timeout)?;
        stream.set_nodelay(true)?;
        stream.set_read_timeout(Some(timeout))?;
        let mut key_bytes = [0u8; 16];
        key_bytes[..8].copy_from_slice(&nonce().to_le_bytes());
        key_bytes[8..].copy_from_slice(&nonce().to_le_bytes());
        let key = base64(&key_bytes);
        // لا ترويسة Origin: العميل ليس صفحة ويب، ومتصفّحات Chromium الحديثة ترفض أصلًا غير مسموح.
        let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n");
        stream.write_all(request.as_bytes())?;
        let head = read_head(&mut stream)?;
        let expected = base64(&sha1(format!("{key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11").as_bytes()));
        let status_ok = head.starts_with("HTTP/1.1 101");
        let accept_ok = head.lines().any(|l| l.to_ascii_lowercase().starts_with("sec-websocket-accept:") && l.split_once(':').map(|(_, v)| v.trim() == expected).unwrap_or(false));
        if !status_ok || !accept_ok {
            return Err(io::Error::new(io::ErrorKind::ConnectionRefused, "the WebSocket handshake was not accepted"));
        }
        Ok(Self { stream })
    }

    pub fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
        self.stream.set_read_timeout(timeout)
    }

    /// نسخة ثانية من المقبس نفسه: قارئ في خيط وكاتب في آخر.
    pub fn try_clone(&self) -> io::Result<Self> {
        Ok(Self { stream: self.stream.try_clone()? })
    }

    fn write_frame(&mut self, opcode: u8, payload: &[u8]) -> io::Result<()> {
        let mut frame = vec![0x80 | opcode];
        let len = payload.len();
        if len < 126 {
            frame.push(0x80 | len as u8);
        } else if len <= u16::MAX as usize {
            frame.push(0x80 | 126);
            frame.extend_from_slice(&(len as u16).to_be_bytes());
        } else {
            frame.push(0x80 | 127);
            frame.extend_from_slice(&(len as u64).to_be_bytes());
        }
        let mask = (nonce() as u32).to_be_bytes();
        frame.extend_from_slice(&mask);
        frame.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
        self.stream.write_all(&frame)
    }

    pub fn send_text(&mut self, text: &str) -> io::Result<()> {
        self.write_frame(0x1, text.as_bytes())
    }

    pub fn close(&mut self) {
        let _ = self.write_frame(0x8, &[0x03, 0xE8]);
        let _ = self.stream.shutdown(std::net::Shutdown::Both);
    }

    fn read_exact(&mut self, n: usize) -> io::Result<Vec<u8>> {
        let mut buf = vec![0u8; n];
        self.stream.read_exact(&mut buf)?;
        Ok(buf)
    }

    /// يقرأ رسالة نصّية كاملة (يجمع الأجزاء، ويردّ على ping). `None` عند الإغلاق.
    pub fn read_message(&mut self) -> io::Result<Option<String>> {
        let mut message = Vec::new();
        loop {
            let head = self.read_exact(2)?;
            let fin = head[0] & 0x80 != 0;
            let opcode = head[0] & 0x0F;
            let masked = head[1] & 0x80 != 0;
            let mut len = (head[1] & 0x7F) as u64;
            if len == 126 {
                let b = self.read_exact(2)?;
                len = u16::from_be_bytes([b[0], b[1]]) as u64;
            } else if len == 127 {
                let b = self.read_exact(8)?;
                len = u64::from_be_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]);
            }
            if len as usize > MAX_WS_MESSAGE || message.len() + len as usize > MAX_WS_MESSAGE {
                return Err(io::Error::new(io::ErrorKind::InvalidData, "WebSocket message too large"));
            }
            let mask = if masked { Some(self.read_exact(4)?) } else { None };
            let mut payload = self.read_exact(len as usize)?;
            if let Some(m) = mask {
                for (i, b) in payload.iter_mut().enumerate() {
                    *b ^= m[i % 4];
                }
            }
            match opcode {
                0x8 => return Ok(None),
                0x9 => {
                    self.write_frame(0xA, &payload)?;
                    continue;
                }
                0xA => continue,
                0x0..=0x2 => {
                    message.extend_from_slice(&payload);
                    if fin {
                        return Ok(Some(String::from_utf8_lossy(&message).into_owned()));
                    }
                }
                _ => return Err(io::Error::new(io::ErrorKind::InvalidData, "unknown WebSocket opcode")),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha1_and_base64_match_the_rfc_6455_example() {
        let accept = base64(&sha1(b"dGhlIHNhbXBsZSBub25jZQ==258EAFA5-E914-47DA-95CA-C5AB0DC85B11"));
        assert_eq!(accept, "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
    }

    #[test]
    fn the_callback_listener_answers_only_the_expected_path_on_loopback() {
        let listener = CallbackListener::bind().unwrap();
        let port = listener.port();
        let client = std::thread::spawn(move || {
            let mut wrong = TcpStream::connect(("127.0.0.1", port)).unwrap();
            wrong.write_all(b"GET /other HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
            let mut s = String::new();
            let _ = wrong.read_to_string(&mut s);
            assert!(s.starts_with("HTTP/1.1 404"));
            let mut right = TcpStream::connect(("127.0.0.1", port)).unwrap();
            right.write_all(b"GET /callback?code=abc&state=xyz HTTP/1.1\r\nHost: x\r\n\r\n").unwrap();
            let mut s = String::new();
            let _ = right.read_to_string(&mut s);
            s
        });
        let target = listener.accept_one("/callback", Instant::now() + Duration::from_secs(5), &CancelToken::new(), "<p>done</p>").unwrap();
        assert_eq!(target, "/callback?code=abc&state=xyz");
        assert!(client.join().unwrap().contains("<p>done</p>"));
    }

    #[test]
    fn a_websocket_round_trips_text_against_a_minimal_server() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let head = read_head(&mut s).unwrap();
            let key = head.lines().find_map(|l| l.strip_prefix("Sec-WebSocket-Key: ")).unwrap().trim().to_string();
            let accept = base64(&sha1(format!("{key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11").as_bytes()));
            s.write_all(format!("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n").as_bytes()).unwrap();
            // يقرأ إطارًا مقنّعًا من العميل ويعيده غير مقنّع.
            let mut h = [0u8; 2];
            s.read_exact(&mut h).unwrap();
            let len = (h[1] & 0x7F) as usize;
            let mut mask = [0u8; 4];
            s.read_exact(&mut mask).unwrap();
            let mut p = vec![0u8; len];
            s.read_exact(&mut p).unwrap();
            for (i, b) in p.iter_mut().enumerate() {
                *b ^= mask[i % 4];
            }
            let mut out = vec![0x81, len as u8];
            out.extend_from_slice(&p);
            s.write_all(&out).unwrap();
        });
        let mut ws = LoopbackWebSocket::connect(port, "/devtools/browser/x", Duration::from_secs(5)).unwrap();
        ws.send_text("{\"id\":1}").unwrap();
        assert_eq!(ws.read_message().unwrap().as_deref(), Some("{\"id\":1}"));
        server.join().unwrap();
    }
}
