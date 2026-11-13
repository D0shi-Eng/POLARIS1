// رمز الإلغاء.
//
// كل مقبس يفتحه العميل يُسجَّل في الرمز، و`cancel` يغلقه من خيط آخر.
//
// ما لا يُدَّعى هنا (ADR-020): أن هذا يوقظ قراءة معلّقة بالفعل. يفعل ذلك على
// POSIX، ولا يفعله على ويندوز — قيس ثلاث مرات متتالية فبقيت القراءة معلّقة حتى
// أغلق الطرف الآخر. فالإغلاق هنا مُعجِّل بأفضل جهد لا ضمان: هو يُفشل القراءات
// اللاحقة على المنصّتين، ويوقظ المعلّقة على واحدة منهما فقط.
//
// الضمان الفعلي يعيش في `SlicedStream`: لا قراءة بلا سقف، والعلم يُفحص بين
// الشرائح، فيُلاحَظ الإلغاء خلال شريحة واحدة على أي منصّة.

use std::net::{Shutdown, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct CancelToken {
    inner: Arc<Inner>,
}

#[derive(Default)]
struct Inner {
    cancelled: AtomicBool,
    sockets: Mutex<Vec<TcpStream>>,
}

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_cancelled(&self) -> bool {
        self.inner.cancelled.load(Ordering::SeqCst)
    }

    /// يلغي ويغلق كل مقبس مسجَّل. يُستدعى مرة أو أكثر بلا أثر إضافي.
    pub fn cancel(&self) {
        self.inner.cancelled.store(true, Ordering::SeqCst);
        if let Ok(mut sockets) = self.inner.sockets.lock() {
            for socket in sockets.drain(..) {
                let _ = socket.shutdown(Shutdown::Both);
            }
        }
    }

    /// يسجّل نسخة من مقبس مفتوح. إن كان الإلغاء قد وقع، يُغلق المقبس فورًا.
    pub fn register(&self, socket: &TcpStream) {
        let Ok(clone) = socket.try_clone() else { return };
        if self.is_cancelled() {
            let _ = clone.shutdown(Shutdown::Both);
            return;
        }
        if let Ok(mut sockets) = self.inner.sockets.lock() {
            sockets.push(clone);
        }
        // سباق: الإلغاء وقع بين الفحص والتسجيل.
        if self.is_cancelled() {
            self.cancel();
        }
    }
}

impl std::fmt::Debug for CancelToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "CancelToken(cancelled={})", self.is_cancelled())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::net::TcpListener;

    // ما كان هنا: `cancel_unblocks_a_pending_read`. كان يقيس أثرًا خاصًا بـPOSIX
    // على مقبس خام بلا مهلة قراءة — وهي هيئة لا يستعملها الإنتاج. أُزيل ولم
    // يُضعَّف: الضمان الذي يقوم عليه الإنتاج يُقاس في
    // `sliced::tests::cancel_is_observed_within_a_slice`، وهو يُخفق على المنصّتين
    // معًا إن لم يُحترم الإلغاء. التفصيل في ADR-020.

    #[test]
    fn registering_after_cancel_closes_immediately() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let token = CancelToken::new();
        token.cancel();
        let mut client = TcpStream::connect(addr).unwrap();
        token.register(&client);
        let mut buf = [0u8; 1];
        assert!(matches!(client.read(&mut buf), Ok(0) | Err(_)));
        drop(listener);
    }
}
