using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Threading;
using Polaris.W4.WindowsAdapter;

namespace Polaris.W5.WindowsAdapter
{
    /// <summary>
    /// مراقب وثيقة الاستعداد على مخرج الابن القياسي.
    ///
    /// ── لماذا لم يكن الاستعداد يُلاحظ قبل هذا ──────────────────────────────────
    /// العيّنة كانت تكتب علامتها فعلًا، والمُطلِق كان يقرأ المخرج فعلًا — لكنه
    /// ينشر نصّ المخرج بعد نهاية الملف وحدها، ونهاية الملف لا تأتي إلا بموت
    /// الابن. فابنٌ لا ينتهي من تلقاء نفسه كان استعداده غير قابل للملاحظة
    /// بنيويًا، لا بطيئًا: لا مهلة تُطيلها ولا استقصاء يكشفه.
    ///
    /// ── القناة ────────────────────────────────────────────────────────────────
    /// مقبض المخرج القياسي نفسه: أنبوب أنشأه المُقيس بـCreatePipe، مُدرَج صراحةً
    /// في PROC_THREAD_ATTRIBUTE_HANDLE_LIST، ويُغلق في تنظيف المُطلِق. لا مقبض
    /// إضافي، ولا كائن نواة مُسمّى يحتاج ACL لمعرّف الحاوية، ولا وراثة محيطة.
    /// عدد المقابض الموروثة لا يتغيّر بهذا العقد، وثابت القائمة الصريحة كما هو.
    ///
    /// ── التزامن ──────────────────────────────────────────────────────────────
    /// ReadFile على طرف القراءة يعود عند وصول كتابة الابن، لا بعد مهلة. الانتظار
    /// هنا على حادثة تُرفع من خيط القراءة، فالمُقيس لا ينام ولا يستقصي. وانكسار
    /// الأنبوب — أي موت الابن — يُنهي القراءة أيضًا، فيخرج المُقيس من انتظاره
    /// بحقيقة لا بمهلة.
    ///
    /// ── ما تعنيه الوثيقة ─────────────────────────────────────────────────────
    /// أن مفسّر العقدة أقلع، وحمّل الوحدة، ونفّذها. وهي موقّعة بعدد استعمال واحد
    /// يملكه هذا القياس، فلا يقبل المُقيس إعلانًا من مخرج قديم ولا من عملية أخرى.
    /// وتُشترط وثيقة واحدة: وثيقتان تعنيان أن العقد ليس كما وُصف.
    /// </summary>
    internal sealed class ReadinessObserver : IPipeObserver
    {
        internal const string Mechanism = "INHERITED_STDOUT_PIPE_NEWLINE_FRAMED_JSON_DOCUMENT";
        internal const string HandleOrigin = "PROBE_CREATED_CREATEPIPE_LISTED_IN_EXPLICIT_HANDLE_LIST";
        internal const string Protocol = "polaris.w5.readiness";
        internal const string Role = "w5-hold-child";
        internal const string State = "READY";
        internal const long ProtocolVersion = 1;

        internal const string ReasonNotObserved = "CHILD_READINESS_NOT_OBSERVED";
        internal const string ReasonInvalid = "CHILD_READINESS_PROTOCOL_INVALID";

        private readonly object _gate = new object();
        private readonly ManualResetEvent _signal = new ManualResetEvent(false);
        private readonly StringBuilder _pending = new StringBuilder();
        private readonly List<string> _documents = new List<string>();
        private readonly string _expectedNonce;
        private readonly PanicStopTimeline _timeline;

        private int _bytesObserved;
        private int _documentCount;
        private bool _payloadValid;
        private string _parseError = "";
        private string _observedDocument = "";
        private string _observedAt = "";
        private long _observedMicroseconds = -1;
        private int _readyPid;

        public ReadinessObserver(string expectedNonce, PanicStopTimeline timeline)
        {
            _expectedNonce = expectedNonce == null ? "" : expectedNonce;
            _timeline = timeline;
        }

        public string ExpectedNonce { get { return _expectedNonce; } }
        public bool PayloadValid { get { lock (_gate) { return _payloadValid; } } }
        public int DocumentCount { get { lock (_gate) { return _documentCount; } } }
        public int ReadyPid { get { lock (_gate) { return _readyPid; } } }
        public int BytesObserved { get { lock (_gate) { return _bytesObserved; } } }
        public string ParseError { get { lock (_gate) { return _parseError; } } }
        public string ObservedAt { get { lock (_gate) { return _observedAt; } } }
        public long ObservedMicroseconds { get { lock (_gate) { return _observedMicroseconds; } } }

        /// <summary>ينتظر الحادثة. صحيح = وُصلت وثيقة مقبولة، لا أن مهلةً مضت.</summary>
        public bool Wait(int milliseconds) { return _signal.WaitOne(milliseconds); }

        /// <summary>يرفع الحادثة بلا وثيقة، حين يموت الابن أو يفشل الإطلاق.</summary>
        public void Release() { _signal.Set(); }

        public void OnChunk(string text)
        {
            if (text == null || text.Length == 0) { return; }
            lock (_gate)
            {
                _bytesObserved += Encoding.UTF8.GetByteCount(text);
                _pending.Append(text);
                while (true)
                {
                    string buffered = _pending.ToString();
                    int newline = buffered.IndexOf('\n');
                    if (newline < 0) { break; }
                    string line = buffered.Substring(0, newline).Trim();
                    _pending.Length = 0;
                    _pending.Append(buffered.Substring(newline + 1));
                    if (line.Length == 0) { continue; }
                    Consider(line);
                }
            }
        }

        /// <summary>يفحص سطرًا واحدًا بنيويًا. لا مطابقة نصّية ولا احتواء سلسلة.</summary>
        private void Consider(string line)
        {
            _documentCount++;
            _documents.Add(line);
            if (_documentCount > 1)
            {
                // وثيقة ثانية: العقد ينصّ على واحدة. الأولى إن قُبلت لا تُنقض،
                // لكن الخرق يُسجَّل ويُحكَم عليه في الاشتقاق لا هنا.
                _parseError = "the child emitted more than one document on the readiness channel";
                return;
            }
            _observedDocument = line;
            _observedAt = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
            _observedMicroseconds = _timeline == null ? -1 : _timeline.NowMicroseconds();

            string error;
            JsonValue document = JsonReader.Parse(line, out error);
            if (document == null)
            {
                _parseError = "the readiness document did not parse: " + error;
                _signal.Set();
                return;
            }
            if (!document.IsObject)
            {
                _parseError = "the readiness document is not a JSON object";
                _signal.Set();
                return;
            }

            List<string> mismatches = new List<string>();
            if (document.MemberText("protocol") != Protocol) { mismatches.Add("protocol"); }
            if (document.MemberText("role") != Role) { mismatches.Add("role"); }
            if (document.MemberText("state") != State) { mismatches.Add("state"); }
            if (document.MemberText("nonce") != _expectedNonce) { mismatches.Add("nonce"); }

            JsonValue version = document.Member("version");
            if (version == null || !version.IsNumber || (long) version.Number != ProtocolVersion) { mismatches.Add("version"); }

            JsonValue pid = document.Member("pid");
            if (pid == null || !pid.IsNumber) { mismatches.Add("pid"); }
            else { _readyPid = (int) pid.Number; }

            if (mismatches.Count > 0)
            {
                _parseError = "the readiness document is structurally wrong in: " + string.Join(",", mismatches.ToArray());
                _signal.Set();
                return;
            }

            _parseError = "";
            _payloadValid = true;
            _signal.Set();
        }

        public void Emit(JsonWriter json, string property, bool observed, int expectedPid)
        {
            lock (_gate)
            {
                bool pidMatches = _payloadValid && _readyPid == expectedPid && expectedPid > 0;
                json.Name(property).BeginObject();
                json.Property("mechanism", Mechanism);
                json.Property("synchronisation", "BLOCKING_READFILE_ON_PIPE_PLUS_EVENT_NO_SLEEP_NO_POLL");
                json.Property("readiness_handle_origin", HandleOrigin);
                json.Property("readiness_handle_is_new", false);
                json.Property("readiness_handle_ambient", false);
                json.Property("expected_protocol", Protocol);
                json.Property("expected_role", Role);
                json.Property("expected_state", State);
                json.Property("expected_version", ProtocolVersion);
                json.Property("expected_nonce_present", _expectedNonce.Length > 0);
                json.Property("expected_document_count", 1);
                json.Property("observed", observed);
                json.Property("observed_document_count", _documentCount);
                json.Property("observed_document", Cap(_observedDocument));
                json.Property("observed_bytes", _bytesObserved);
                json.Property("timestamp", _observedAt);
                json.Property("monotonic_us", _observedMicroseconds);
                json.Property("payload_valid", _payloadValid);
                json.Property("payload_pid", _readyPid);
                json.Property("payload_pid_matches_measured_pid", pidMatches);
                json.Property("parse_error", _parseError);
                json.EndObject();
            }
        }

        private static string Cap(string text)
        {
            if (text == null) { return ""; }
            if (text.Length <= 512) { return text; }
            return text.Substring(0, 512);
        }

        public void Close()
        {
            try { _signal.Close(); }
            catch (Exception) { }
        }
    }
}
