// مقبس بشرائح: لا قراءة بلا سقف، والإلغاء يُفحص بين الشريحة والتي تليها.
//
// العيب الذي أغلقه هذا الملف (ADR-020): كان الإلغاء يقوم على أن `shutdown`
// يوقظ قراءة معلّقة. ذلك صحيح على POSIX وغير صحيح على ويندوز — قيس ثلاث مرات
// متتالية، فبقيت القراءة معلّقة ثلاث ثوانٍ كاملة حتى أغلق الطرف الآخر. وما دامت
// مصافحة TLS تقرأ بالمهلة الكاملة، فطلبٌ أُلغي يظل معلّقًا إلى نهاية المهلة على
// المنصّة التي نستهدفها أولًا.
//
// العلاج لا يفترض دلالة منصّة بل يمنع الحالة التي تختلف فيها المنصّات: لا تُصدَر
// قراءة بلا سقف. الضمان الناتج يُقال صراحةً ولا يُلمَّح إليه: الإلغاء يُلاحَظ خلال
// شريحة واحدة، لا «فورًا».
//
// الكتابة لا تُشرَّح عمدًا: إرسال محجوب تنتهي مهلته يُبلّغ عددًا غير محدَّد من
// البايتات المكتوبة، وإعادة المحاولة عليه تُفسد الطلب. الكتابة تبقى بمهلة المهلة
// الكاملة، وهذا متبقٍّ معلوم مذكور في ADR-020.

use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

use super::cancel::CancelToken;

// Debug مطلوب هنا لا للتشخيص: `HandshakeError<S>` في native-tls لا يحقّق Display
// إلا إذا حقّق S الوسم Debug، ومسار خطأ TLS يصوغ نصّه.
#[derive(Debug)]
pub(crate) struct SlicedStream {
    socket: TcpStream,
    deadline: Instant,
    cancel: CancelToken,
    /// مهلة الخمول وآخر لحظة وصلت فيها بايتات (Phase-08).
    idle: Option<Duration>,
    last_progress: Instant,
}

impl SlicedStream {
    /// يلفّ مقبسًا مفتوحًا ويثبّت سقف القراءة عند الشريحة.
    pub(crate) fn new(socket: TcpStream, deadline: Instant, cancel: CancelToken, slice: Duration) -> io::Result<Self> {
        socket.set_read_timeout(Some(slice))?;
        Ok(Self { socket, deadline, cancel, idle: None, last_progress: Instant::now() })
    }

    /// يضبط مهلة الخمول: صمتٌ أطول منها ينهي القراءة بانتهاء مهلة، والسقف المطلق يبقى.
    pub(crate) fn with_idle(mut self, idle: Option<Duration>) -> Self {
        self.idle = idle;
        self.last_progress = Instant::now();
        self
    }

    pub(crate) fn socket(&self) -> &TcpStream {
        &self.socket
    }

    /// الإلغاء أولًا ثم المهلة: الملغى ليس منتهي المهلة، والتمييز يصل إلى المتصل.
    fn check(&self) -> io::Result<()> {
        if self.cancel.is_cancelled() {
            return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
        }
        let now = Instant::now();
        if now >= self.deadline {
            return Err(io::Error::new(io::ErrorKind::TimedOut, "deadline"));
        }
        if self.idle.is_some_and(|idle| now.duration_since(self.last_progress) >= idle) {
            return Err(io::Error::new(io::ErrorKind::TimedOut, "idle"));
        }
        Ok(())
    }
}

impl Read for SlicedStream {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        loop {
            self.check()?;
            match self.socket.read(buf) {
                // قراءة صفرية بعد إلغاء (مقبس أُغلق بالإلغاء على POSIX) إلغاءٌ لا نهاية بثّ.
                Ok(0) if self.cancel.is_cancelled() => {
                    return Err(io::Error::new(io::ErrorKind::Interrupted, "cancelled"));
                }
                Ok(n) if n > 0 => {
                    self.last_progress = Instant::now();
                    return Ok(n);
                }
                // انتهاء الشريحة ليس خطأً بل موضع الفحص: نعود إلى check ولا نُبلّغ المتصل.
                Err(e) if matches!(e.kind(), io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut) => continue,
                Err(e) if self.cancel.is_cancelled() => {
                    return Err(io::Error::new(io::ErrorKind::Interrupted, e.to_string()));
                }
                other => return other,
            }
        }
    }
}

impl Write for SlicedStream {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.check()?;
        self.socket.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.socket.flush()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    /// الضمان المُعلن: الإلغاء يُلاحَظ خلال شريحة، على أي منصّة، بلا اعتماد على
    /// إيقاظ shutdown. هذا ما يقوم عليه الإنتاج فعلًا، وهو ما يُقاس هنا.
    #[test]
    fn cancel_is_observed_within_a_slice() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (_socket, _) = listener.accept().unwrap();
            std::thread::sleep(Duration::from_secs(3));
        });
        let client = TcpStream::connect(addr).unwrap();
        let token = CancelToken::new();
        token.register(&client);
        let mut stream = SlicedStream::new(
            client,
            Instant::now() + Duration::from_secs(30),
            token.clone(),
            Duration::from_millis(50),
        )
        .unwrap();

        let canceller = token.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            canceller.cancel();
        });

        let started = Instant::now();
        let mut buf = [0u8; 8];
        let read = stream.read(&mut buf);
        assert!(started.elapsed() < Duration::from_secs(1), "cancellation was not observed within a slice");
        let error = read.expect_err("a cancelled read must not report data");
        assert_eq!(error.kind(), io::ErrorKind::Interrupted, "a cancelled read is Interrupted, not TimedOut");
        assert!(token.is_cancelled());
        server.join().unwrap();
    }

    /// مهلة الخمول (Phase-08): بثّ يتقدّم يعيش بعد الخمول المعلن، وصمتٌ أطول منه يُنهي القراءة.
    #[test]
    fn an_idle_stream_ends_while_a_progressing_one_lives_past_the_idle_limit() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            // يبثّ بايتًا كل 60 ms لمدّة 600 ms، ثم يصمت.
            for _ in 0..10 {
                socket.write_all(b"x").unwrap();
                std::thread::sleep(Duration::from_millis(60));
            }
            std::thread::sleep(Duration::from_millis(1500));
        });
        let client = TcpStream::connect(addr).unwrap();
        let mut stream = SlicedStream::new(client, Instant::now() + Duration::from_secs(30), CancelToken::new(), Duration::from_millis(20))
            .unwrap()
            .with_idle(Some(Duration::from_millis(250)));
        let started = Instant::now();
        let mut got = 0;
        let mut buf = [0u8; 1];
        let error = loop {
            match stream.read(&mut buf) {
                Ok(n) => got += n,
                Err(e) => break e,
            }
        };
        assert_eq!(got, 10, "a progressing stream was cut by the idle limit");
        assert!(started.elapsed() >= Duration::from_millis(500));
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_millis(1400), "the silent stream outlived its idle limit");
        server.join().unwrap();
    }

    /// المهلة المطلقة تبقى محترمة، ولا تُقرأ إلغاءً.
    #[test]
    fn the_absolute_deadline_still_ends_the_read() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (_socket, _) = listener.accept().unwrap();
            std::thread::sleep(Duration::from_secs(2));
        });
        let client = TcpStream::connect(addr).unwrap();
        let mut stream = SlicedStream::new(
            client,
            Instant::now() + Duration::from_millis(200),
            CancelToken::new(),
            Duration::from_millis(50),
        )
        .unwrap();

        let started = Instant::now();
        let mut buf = [0u8; 8];
        let error = stream.read(&mut buf).expect_err("the deadline must end the read");
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(1));
        server.join().unwrap();
    }
}
