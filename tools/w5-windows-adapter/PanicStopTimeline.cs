using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using Polaris.W4.WindowsAdapter;

namespace Polaris.W5.WindowsAdapter
{
    /// <summary>حدث واحد على الخط الزمني: رمزه، واسمه، ولحظته، والحالة إن غيّرها.</summary>
    internal sealed class TimelineEvent
    {
        public string Code = "";
        public string Name = "";
        public string Iso = "";
        public long MonotonicMicroseconds;
        public string LifecycleState = "";
        public string Detail = "";
    }

    /// <summary>
    /// الخط الزمني لقياس W5-P01.
    ///
    /// لماذا خطٌّ صريح لا سجل رسائل: الأحكام هنا ترتيبية. «حيّ» قبل «إيقاف» قبل
    /// «ميت» ليست ثلاث حقائق مستقلة بل حقيقة واحدة مرتبة، وسجلٌّ بلا ترتيب مُقاس
    /// يجعل الإسناد رأيًا. ولذلك القياس بساعة رتيبة (Stopwatch) لا بساعة الحائط:
    /// الأخيرة قد تُعدَّل أثناء القياس فتقلب فارقًا موجبًا إلى سالب.
    ///
    /// وحالات الحياة ليست مترادفة، ولا يُقرأ بعضها من بعض:
    ///   CREATED             CreateProcessW عادت بنجاح
    ///   ASSIGNED_TO_JOB     AssignProcessToJobObject نجحت قبل الاستئناف
    ///   RESUMED             ResumeThread نجحت
    ///   ALIVE               مُقاس أنها لم تخرج، بمحكّ صريح لا بوجود معرّف
    ///   READY               وثيقة استعداد مبنيّة ومطابقة للتوقيع
    ///   EXITED              خرجت من تلقاء نفسها
    ///   TERMINATED_BY_STOP  ماتت بعد الإيقاف، والترتيب يُسنِد الموت إليه
    /// </summary>
    internal sealed class PanicStopTimeline
    {
        internal const string StateCreated = "CREATED";
        internal const string StateAssignedToJob = "ASSIGNED_TO_JOB";
        internal const string StateResumed = "RESUMED";
        internal const string StateAlive = "ALIVE";
        internal const string StateReady = "READY";
        internal const string StateExited = "EXITED";
        internal const string StateTerminatedByStop = "TERMINATED_BY_STOP";

        /// <summary>الرموز المعلنة، بترتيبها. ما لم يُسجَّل منها يظهر ناقصًا لا مفترضًا.</summary>
        private static readonly string[] DeclaredCodes = new string[]
        {
            "T0", "T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12",
            "T13", "T14", "T15", "T16", "T17", "T18", "T19", "T20", "T21", "T22", "T23", "T24", "T25",
        };

        /// <summary>
        /// رموز لا يملك هذا المحوّل أن يضع لها لحظةً مستقلة.
        ///
        /// مداها كله داخل مُطلِق W4: بين دخول CreateProcessW ونجاح ResumeThread لا
        /// يعود التنفيذ إلى W5 مرة واحدة. وضع لحظة لكل منها يقتضي زرع قياس داخل
        /// شيفرة W4 المغلقة، وهذا الإصلاح يرفض ذلك.
        ///
        /// فالمُعامَلة الصريحة: حالتها تُثبَت من نتيجة المُطلِق — أُنشئت، ضُمّت،
        /// استُؤنفت، وبأي أعلام إنشاء — ويُقال صراحةً إنها غير موقَّتة، ولا تُحسب
        /// ناقصةً ولا يُخترع لها زمن. وترتيبها مفروض ببنية المُطلِق نفسها، وعليه
        /// اختبار انحدار بنيوي يقرأ المصدر لا التعليق.
        /// </summary>
        private static readonly string[] StateOnlyCodes = new string[]
        {
            "T8", "T9", "T10", "T11", "T12", "T13", "T14", "T15", "T16", "T17",
        };

        internal static bool IsStateOnly(string code)
        {
            for (int i = 0; i < StateOnlyCodes.Length; i++)
            {
                if (StateOnlyCodes[i] == code) { return true; }
            }
            return false;
        }

        private readonly Stopwatch _clock = Stopwatch.StartNew();
        private readonly List<TimelineEvent> _events = new List<TimelineEvent>();
        private readonly List<string> _states = new List<string>();

        public IEnumerable<TimelineEvent> Events { get { return _events; } }

        public void Mark(string code, string name) { Record(code, name, "", ""); }

        public void Mark(string code, string name, string detail) { Record(code, name, "", detail); }

        /// <summary>حدث يُغيّر حالة الحياة. الحالة تُسجَّل مرة واحدة وبترتيبها.</summary>
        public void MarkState(string code, string name, string state) { Record(code, name, state, ""); }

        public void MarkState(string code, string name, string state, string detail)
        {
            Record(code, name, state, detail);
        }

        private void Record(string code, string name, string state, string detail)
        {
            TimelineEvent recorded = new TimelineEvent();
            recorded.Code = code;
            recorded.Name = name;
            recorded.Iso = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
            recorded.MonotonicMicroseconds = Microseconds();
            recorded.LifecycleState = state;
            recorded.Detail = detail;
            _events.Add(recorded);
            if (state.Length > 0 && !_states.Contains(state)) { _states.Add(state); }
        }

        private long Microseconds()
        {
            return (long) ((_clock.ElapsedTicks * 1000000L) / Stopwatch.Frequency);
        }

        /// <summary>اللحظة الرتيبة الآن. لكل قياس يحتاج زمنًا لا يعتمد على ساعة الحائط.</summary>
        public long NowMicroseconds() { return Microseconds(); }

        public bool HasState(string state) { return _states.Contains(state); }

        /// <summary>لحظة رمز بعينه بالميكروثانية الرتيبة، أو -1 إن لم يُسجَّل.</summary>
        public long MicrosecondsOf(string code)
        {
            for (int i = 0; i < _events.Count; i++)
            {
                if (_events[i].Code == code) { return _events[i].MonotonicMicroseconds; }
            }
            return -1;
        }

        public bool HasCode(string code) { return MicrosecondsOf(code) >= 0; }

        /// <summary>الرموز الموقَّتة الغائبة. الرموز الحالية-فقط ليست منها.</summary>
        public List<string> MissingCodes()
        {
            List<string> missing = new List<string>();
            for (int i = 0; i < DeclaredCodes.Length; i++)
            {
                string code = DeclaredCodes[i];
                if (IsStateOnly(code)) { continue; }
                if (!HasCode(code)) { missing.Add(code); }
            }
            return missing;
        }

        public List<string> StateOnly()
        {
            return new List<string>(StateOnlyCodes);
        }

        /// <summary>هل رمزٌ سُجِّل قبل آخر فعلًا؟ سؤال ترتيبي لا سؤال وجود.</summary>
        public bool Precedes(string earlier, string later)
        {
            long first = MicrosecondsOf(earlier);
            long second = MicrosecondsOf(later);
            return first >= 0 && second >= 0 && first <= second;
        }

        public void Emit(JsonWriter json, string property)
        {
            List<string> missing = MissingCodes();
            json.Name(property).BeginObject();
            json.Property("clock", "MONOTONIC_STOPWATCH_PLUS_UTC_WALL_CLOCK");
            json.Property("complete", missing.Count == 0);
            json.Property("declared_codes", new List<string>(DeclaredCodes));
            json.Property("state_only_codes", new List<string>(StateOnlyCodes));
            json.Property("state_only_reason",
                "T8..T17 lie inside the frozen W4 launcher between CreateProcessW and ResumeThread;"
                + " their state is proven from the launcher outcome and their order from the launcher source,"
                + " and no timestamp is invented for them because instrumenting W4 is out of scope here");
            json.Property("missing_codes", missing);
            json.Property("lifecycle_states_observed", _states);
            json.Name("events").BeginArray();
            for (int i = 0; i < _events.Count; i++)
            {
                TimelineEvent recorded = _events[i];
                json.BeginObject();
                json.Property("code", recorded.Code);
                json.Property("name", recorded.Name);
                json.Property("at", recorded.Iso);
                json.Property("monotonic_us", recorded.MonotonicMicroseconds);
                json.Property("lifecycle_state", recorded.LifecycleState);
                json.Property("detail", recorded.Detail);
                json.EndObject();
            }
            json.EndArray();
            json.EndObject();
        }
    }
}
