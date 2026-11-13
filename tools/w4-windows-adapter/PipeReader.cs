using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>نتيجة استنزاف أنبوب واحد حتى نهايته، بنتيجة النداء لا بتخمينها.</summary>
    internal sealed class PipeReadResult
    {
        public string Text = "";
        public int ByteCount;
        /// <summary>انتهت القراءة بنهاية ملف حقيقية: صفر بايت أو أنبوب مكسور.</summary>
        public bool EndedAtEof;
        /// <summary>خطأ Win32 الذي أنهى القراءة، إن لم تكن نهاية ملف.</summary>
        public int Win32Error;
    }

    /// <summary>
    /// مراقب مباشر لما يصل من الأنبوب، قبل نهايته.
    ///
    /// العيب الذي يغلقه: نتيجة القراءة لا تُنشر إلا بعد نهاية الملف، فمخرج ابنٍ
    /// لا ينتهي من تلقاء نفسه غير قابل للملاحظة أصلًا مهما كان صريحًا. المراقب
    /// اختياري: مرجعٌ فارغ يعني سلوكًا مطابقًا حرفيًا لما كان، ولا مسار جديد.
    ///
    /// لا يفتح قناة ولا مقبضًا: يقرأ ما يمر على المقبض القائم نفسه.
    /// </summary>
    internal interface IPipeObserver
    {
        /// <summary>يُنادى داخل خيط القراءة لكل دفعة فُكّت شفرتها. لا يرمي.</summary>
        void OnChunk(string text);
    }

    /// <summary>
    /// قارئ أنبوب واحد، يعمل في خيطه.
    ///
    /// العيب الذي يغلقه: القراءة المتزامنة على مجرى واحد بعد الاستئناف تجعل خرج
    /// الابن رهينة ترتيب — إن ملأ الابن أنبوبًا لا يقرأه أحد تعلّقت الجهتان — وإن
    /// فشل ReadFile لسبب حقيقي بدا الفشل كنهاية ملف. هنا الاثنان مفصولان: كل
    /// مجرى في خيطه، ونهاية الملف تُمَيَّز عن الخطأ ويُسجَّل رقمه.
    ///
    /// ERROR_BROKEN_PIPE على طرف القراءة نهاية ملف حقيقية على ويندوز: الكاتب
    /// أُغلق. أي رقم آخر خطأ يُبلَّغ ولا يُقرأ اكتمالًا.
    /// </summary>
    internal sealed class PipeReader
    {
        private const int ErrorBrokenPipe = 109;
        private const int BufferBytes = 8192;

        private readonly IntPtr _pipe;
        private readonly IPipeObserver _observer;
        private readonly PipeReadResult _result = new PipeReadResult();

        public PipeReader(IntPtr pipe)
        {
            _pipe = pipe;
            _observer = null;
        }

        /// <summary>القارئ نفسه، ومعه مراقب مباشر. مرجع فارغ = السلوك الأصلي.</summary>
        public PipeReader(IntPtr pipe, IPipeObserver observer)
        {
            _pipe = pipe;
            _observer = observer;
        }

        public PipeReadResult Result { get { return _result; } }

        public void Run()
        {
            StringBuilder text = new StringBuilder();
            byte[] buffer = new byte[BufferBytes];
            int total = 0;
            while (true)
            {
                uint read = 0;
                bool ok = NativeExtras.ReadFile(_pipe, buffer, (uint) buffer.Length, out read, IntPtr.Zero);
                if (!ok)
                {
                    int error = Marshal.GetLastWin32Error();
                    if (error == ErrorBrokenPipe) { _result.EndedAtEof = true; }
                    else { _result.Win32Error = error; }
                    break;
                }
                if (read == 0) { _result.EndedAtEof = true; break; }
                total += (int) read;
                string chunk = Encoding.UTF8.GetString(buffer, 0, (int) read);
                text.Append(chunk);
                // المراقب لا يملك أن يوقف القراءة ولا أن يُفشلها: استثناء منه
                // يُبتلع هنا عمدًا، فقناة المخرجات أهم من مراقبها.
                if (_observer != null)
                {
                    try { _observer.OnChunk(chunk); }
                    catch (Exception) { }
                }
            }
            _result.ByteCount = total;
            _result.Text = text.ToString();
        }
    }
}
