// خادم HTTP تجريبي على الحلقة المحلية.
//
// تجهيزة اختبار فقط: يستقبل طلبات حقيقية على مقبس حقيقي ويعيد ما يُطلب منه —
// JSON، أو بايتات خام، أو بثًّا بطيئًا، أو صمتًا، أو قطعًا. يسجّل كل طلب، ويسجّل
// إن قطع العميل الاتصال أثناء البث، فيصير الإلغاء قابلًا للإثبات لا للادعاء.

#![allow(dead_code)]

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Recorded {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Recorded {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

pub enum Reply {
    Json(u16, String),
    Raw(Vec<u8>),
    /// أجزاء تُرسل بفاصل زمني بترميز chunked.
    Stream { content_type: &'static str, parts: Vec<String>, gap: Duration },
    Hang(Duration),
    Close,
}

pub type Handler = Arc<dyn Fn(&Recorded) -> Reply + Send + Sync>;

pub struct MockServer {
    pub port: u16,
    pub requests: Arc<Mutex<Vec<Recorded>>>,
    pub client_aborts: Arc<AtomicUsize>,
    pub completed_streams: Arc<AtomicUsize>,
}

impl MockServer {
    pub fn start(handler: Handler) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let requests = Arc::new(Mutex::new(Vec::new()));
        let client_aborts = Arc::new(AtomicUsize::new(0));
        let completed_streams = Arc::new(AtomicUsize::new(0));
        let (r, a, c) = (requests.clone(), client_aborts.clone(), completed_streams.clone());
        thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let (h, r, a, c) = (handler.clone(), r.clone(), a.clone(), c.clone());
                thread::spawn(move || serve(stream, h, r, a, c));
            }
        });
        Self { port, requests, client_aborts, completed_streams }
    }

    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn recorded(&self) -> Vec<Recorded> {
        self.requests.lock().unwrap().clone()
    }

    pub fn aborts(&self) -> usize {
        self.client_aborts.load(Ordering::SeqCst)
    }

    pub fn completed(&self) -> usize {
        self.completed_streams.load(Ordering::SeqCst)
    }
}

fn read_request(stream: &mut TcpStream) -> Option<Recorded> {
    stream.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    let head_end;
    loop {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..n]);
        if let Some(pos) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
            head_end = pos + 4;
            break;
        }
    }
    let head = String::from_utf8_lossy(&buffer[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let first = lines.next()?;
    let mut parts = first.split(' ');
    let method = parts.next()?.to_string();
    let path = parts.next()?.to_string();
    let headers: Vec<(String, String)> = lines
        .filter(|l| !l.is_empty())
        .filter_map(|l| l.split_once(':').map(|(k, v)| (k.trim().to_string(), v.trim().to_string())))
        .collect();
    let length: usize = headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
        .and_then(|(_, v)| v.parse().ok())
        .unwrap_or(0);
    let mut body = buffer[head_end..].to_vec();
    while body.len() < length {
        let n = stream.read(&mut chunk).ok()?;
        if n == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..n]);
    }
    Some(Recorded { method, path, headers, body: String::from_utf8_lossy(&body).to_string() })
}

fn serve(mut stream: TcpStream, handler: Handler, requests: Arc<Mutex<Vec<Recorded>>>, aborts: Arc<AtomicUsize>, completed: Arc<AtomicUsize>) {
    let Some(request) = read_request(&mut stream) else { return };
    requests.lock().unwrap().push(request.clone());
    match handler(&request) {
        Reply::Json(status, body) => {
            let head = format!(
                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(body.as_bytes());
        }
        Reply::Raw(bytes) => {
            let _ = stream.write_all(&bytes);
        }
        Reply::Stream { content_type, parts, gap } => {
            let head = format!("HTTP/1.1 200 OK\r\nContent-Type: {content_type}\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n");
            if stream.write_all(head.as_bytes()).is_err() {
                aborts.fetch_add(1, Ordering::SeqCst);
                return;
            }
            for part in parts {
                let frame = format!("{:x}\r\n{}\r\n", part.len(), part);
                if stream.write_all(frame.as_bytes()).and_then(|_| stream.flush()).is_err() {
                    aborts.fetch_add(1, Ordering::SeqCst);
                    return;
                }
                thread::sleep(gap);
            }
            if stream.write_all(b"0\r\n\r\n").is_err() {
                aborts.fetch_add(1, Ordering::SeqCst);
                return;
            }
            completed.fetch_add(1, Ordering::SeqCst);
        }
        Reply::Hang(duration) => thread::sleep(duration),
        Reply::Close => {}
    }
}

pub fn handler(f: impl Fn(&Recorded) -> Reply + Send + Sync + 'static) -> Handler {
    Arc::new(f)
}
