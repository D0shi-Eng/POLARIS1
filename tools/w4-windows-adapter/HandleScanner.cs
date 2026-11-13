using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace Polaris.W4.WindowsAdapter
{
    // ما وجده الفحص عن مقبض واحد داخل عملية هدف.
    internal sealed class HandleFinding
    {
        public long Value;
        public string Path = "";
        public string TypeName = "UNKNOWN";
        public bool IsFileSystemObject;
        public bool InsideScope;
        public bool CanaryReadable;
        public bool Duplicable;
        public int Win32Error;
        public uint GrantedAccess;
        public uint ObjectTypeIndex;
        public uint HandleAttributes;
        /// <summary>نوع الكائن كما تعيده الواجهة العامة PSS_HANDLE_ENTRY.ObjectType.</summary>
        public uint PssObjectType;
        /// <summary>INHERITED_AT_CREATE أو PROBE_CREATED أو RUNTIME_OPENED.</summary>
        public string Origin = "UNCLASSIFIED";
        /// <summary>دور المقبض إن كان كائنًا أنشأه المسبار نفسه (مجرى قياسي، أو تسريب مقصود).</summary>
        public string ProbeRole = "";
    }

    /// <summary>سياق الفحص: النطاق، الكناري، كائنات المسبار، ولقطة سابقة للمقارنة.</summary>
    internal sealed class HandleScanContext
    {
        public string[] ScopeRoots = new string[0];
        public string Canary = "";
        public string Phase = "AT_CREATE";
        /// <summary>مقابض أنشأها المسبار في عمليتنا، لتمييز ما هو من صنعنا.</summary>
        public List<KeyValuePair<IntPtr, string>> ProbeHandles = new List<KeyValuePair<IntPtr, string>>();
        /// <summary>قيم لقطة سابقة؛ ما ليس فيها ظهر بعد الاستئناف.</summary>
        public HashSet<long> PreviousValues;
        /// <summary>
        /// الهدف معلّق طوال اللقطة. شرط لمقارنة مصدرَي التعداد: على عملية تعمل قد
        /// يختلف المصدران لأن الجدول تغيّر بينهما، وذلك ليس تناقض قياس.
        /// </summary>
        public bool TargetSuspended;
    }

    /// <summary>نتيجة فحص كاملة: النتائج، وحالة التعداد الذي أنتجها.</summary>
    internal sealed class HandleScanResult
    {
        public bool Attempted;
        public string Phase = "AT_CREATE";
        /// <summary>الواجهة التي أنتجت التعداد المستعمل فعلًا.</summary>
        public string Method = "NONE";
        /// <summary>PSS_PRIMARY أو NT_FALLBACK_DECLARED أو NONE.</summary>
        public string EnumerationSource = "NONE";
        public uint NtStatus;
        public long ReportedCount;
        public long EnumeratedCount;
        /// <summary>اكتمال القياس. بدونه لا يجوز أن تُقرأ قائمة نظيفة نجاحًا.</summary>
        public bool EnumerationComplete;
        public string IncompleteReason = "";
        /// <summary>رمز مصنَّف لسبب عدم الاكتمال، للحكم لا للنثر.</summary>
        public string IncompleteReasonCode = "";

        // ── الواجهة العامة (PSS) ───────────────────────────────────────────
        public bool PrimaryAttempted;
        public bool PrimaryAvailable;
        public bool PrimaryComplete;
        public string PrimaryMethod = "NONE";
        public long PrimaryReportedCount;
        public long PrimaryWalkedCount;
        public bool PrimaryWalkEndedWithNoMoreItems;
        public bool PrimaryHandlesCapturedRecorded;
        public uint PrimaryCaptureStatus;
        public uint PrimaryCaptureFlags;
        public uint PrimaryQueryStatus;
        public uint PrimaryWalkTerminalStatus;
        public int PrimaryEntrySize;
        public string PrimaryFailureReason = "";

        // ── الواجهة الداخلية (شاهد ثانٍ أو احتياطي معلن) ────────────────────
        public bool SecondaryAttempted;
        public bool SecondaryAvailable;
        public bool SecondaryComplete;
        public string SecondaryMethod = "NONE";
        public long SecondaryReportedCount;
        public long SecondaryParsedCount;
        public string SecondaryFailureReason = "";

        // ── المقارنة بين المصدرين ──────────────────────────────────────────
        public bool SourcesCompared;
        public string SourcesNotComparedReason = "";
        public bool SourcesAgree;
        public List<long> PrimaryOnlyValues = new List<long>();
        public List<long> SecondaryOnlyValues = new List<long>();
        public bool CorroborationRan;
        public long CorroborationUpperBound;
        public List<long> CorroborationExtraValues = new List<long>();
        public bool ObjectIdentityAvailable;
        public List<HandleFinding> Findings = new List<HandleFinding>();
    }

    /// <summary>
    /// فحص جدول مقابض عملية أخرى.
    ///
    /// مصدر التعداد الأول هو الواجهة العامة الموثّقة: Process Snapshotting API في
    /// kernel32 (PssHandleEnumeration). الواجهة الداخلية
    /// NtQueryInformationProcess تبقى شاهدًا ثانيًا مستقلًا، ومسارًا احتياطيًا
    /// معلنًا حين تتعذّر العامة — لا أساسًا. راجع ADR-007 بعد تصحيحه.
    ///
    /// لا يوجد في أي من المسارين سقف قيمة مخترع، ولا تجريب أعمى لمدى مخمَّن.
    ///
    /// اختلاف المصدرين لا يُدمج ولا يُخفى: على هدف معلّق، اختلاف مجموعتَي القيم
    /// يعني أن أحد القياسين خاطئ، والحكم عندها INCONCLUSIVE برمز
    /// HANDLE_ENUMERATION_SOURCES_DISAGREE. وعلى هدف يعمل لا تجري المقارنة أصلًا،
    /// ويُسجَّل سبب امتناعها: جدول عملية تعمل قد يتغيّر بين القياسين، وذلك ليس
    /// تناقض قياس.
    ///
    /// ثم لكل قيمة معدودة: DuplicateHandle إلى عمليتنا، و GetFileType لتحديد
    /// النوع، و GetFinalPathNameByHandleW لمسار مقابض القرص. النسخ يقع في جدول
    /// الفاحص لا في جدول الهدف، فلا يغيّر ما نقيسه.
    ///
    /// تعزيز الاكتمال: بعد التعداد يُجرَّب مدى مشتق من القياس نفسه (حتى أعلى قيمة
    /// معدودة، وزيادة متناسبة مع حجم الجدول المُبلَّغ). أي مقبض ينسخ بنجاح ولا يوجد
    /// في التعداد يعني أن التعداد ناقص — وعندها لا يجوز حكم PASS.
    ///
    /// لماذا لا /proc: هذا ويندوز. منطق واصفات لينكس ليس دليلًا هنا، ولا يُستعمل.
    ///
    /// الفحص عند الإنشاء يجري على عملية معلّقة، فالنتيجة حتمية: لم تنفّذ العملية
    /// بعد أي تعليمة تفتح أو تغلق مقبضًا.
    /// </summary>
    internal static class HandleScanner
    {
        internal const string OriginInheritedAtCreate = "INHERITED_AT_CREATE";
        internal const string OriginProbeCreated = "PROBE_CREATED";
        internal const string OriginRuntimeOpened = "RUNTIME_OPENED";

        internal const string SourcePrimary = "PSS_PRIMARY";
        internal const string SourceFallback = "NT_FALLBACK_DECLARED";
        internal const string ReasonSourcesDisagree = "HANDLE_ENUMERATION_SOURCES_DISAGREE";
        internal const string ReasonNoSource = "NO_HANDLE_ENUMERATION_SOURCE_SUCCEEDED";
        internal const string ReasonCorroborationExtra = "ENUMERATION_MISSED_DUPLICABLE_HANDLE";

        internal static HandleScanResult Scan(IntPtr targetProcess, HandleScanContext context)
        {
            HandleScanResult result = new HandleScanResult();
            result.Attempted = true;
            result.Phase = context.Phase;

            // 1) الواجهة العامة أولًا.
            HandleTableSnapshot primary = PssHandleEnumeration.Query(targetProcess);
            result.PrimaryAttempted = primary.Attempted;
            result.PrimaryAvailable = primary.Available;
            result.PrimaryComplete = primary.Succeeded;
            result.PrimaryMethod = primary.Method;
            result.PrimaryReportedCount = primary.ReportedCount;
            result.PrimaryWalkedCount = primary.ParsedCount;
            result.PrimaryWalkEndedWithNoMoreItems = primary.WalkEndedWithNoMoreItems;
            result.PrimaryHandlesCapturedRecorded = primary.HandlesCapturedRecorded;
            result.PrimaryCaptureStatus = primary.CaptureStatus;
            result.PrimaryCaptureFlags = primary.CaptureFlags;
            result.PrimaryQueryStatus = primary.QueryStatus;
            result.PrimaryWalkTerminalStatus = primary.WalkTerminalStatus;
            result.PrimaryEntrySize = primary.EntrySizeUsed;
            result.PrimaryFailureReason = primary.FailureReason;

            // 2) الواجهة الداخلية: شاهد ثانٍ دائمًا، واحتياطي عند الحاجة.
            HandleTableSnapshot secondary = NtHandleEnumeration.Query(targetProcess);
            result.SecondaryAttempted = secondary.Attempted;
            result.SecondaryAvailable = secondary.Available;
            result.SecondaryComplete = secondary.Succeeded;
            result.SecondaryMethod = secondary.Method;
            result.SecondaryReportedCount = secondary.ReportedCount;
            result.SecondaryParsedCount = secondary.ParsedCount;
            result.SecondaryFailureReason = secondary.FailureReason;
            result.NtStatus = secondary.NtStatus;

            // 3) اختيار المصدر المستعمل، معلنًا في الدليل لا مضمرًا.
            HandleTableSnapshot chosen;
            if (primary.Succeeded)
            {
                chosen = primary;
                result.EnumerationSource = SourcePrimary;
            }
            else if (secondary.Succeeded)
            {
                chosen = secondary;
                result.EnumerationSource = SourceFallback;
            }
            else
            {
                result.EnumerationSource = "NONE";
                result.Method = "NONE";
                result.EnumerationComplete = false;
                result.IncompleteReasonCode = ReasonNoSource;
                result.IncompleteReason =
                    "the public enumeration failed (" + primary.FailureReason
                    + ") and the declared internal fallback also failed (" + secondary.FailureReason + ")";
                return result;
            }

            result.Method = chosen.Method;
            result.ReportedCount = chosen.ReportedCount;
            result.EnumeratedCount = chosen.ParsedCount;

            // 4) المقارنة بين المصدرين. لا دمج، ولا إخفاء اختلاف.
            CompareSources(primary, secondary, context, result);

            // 5) الوصف. الحقول الوصفية من الواجهة الداخلية حين توفّرت.
            Dictionary<long, HandleTableEntry> descriptive = new Dictionary<long, HandleTableEntry>();
            if (secondary.Succeeded)
            {
                foreach (HandleTableEntry entry in secondary.Entries)
                {
                    descriptive[entry.Value] = entry;
                }
            }

            IntPtr self = NativeExtras.GetCurrentProcess();
            HashSet<long> enumerated = new HashSet<long>();
            foreach (HandleTableEntry entry in chosen.Entries)
            {
                enumerated.Add(entry.Value);
                HandleTableEntry described = entry;
                if (descriptive.ContainsKey(entry.Value))
                {
                    described.GrantedAccess = descriptive[entry.Value].GrantedAccess;
                    described.ObjectTypeIndex = descriptive[entry.Value].ObjectTypeIndex;
                    described.HandleAttributes = descriptive[entry.Value].HandleAttributes;
                }
                HandleFinding finding = Describe(targetProcess, self, described, context);
                result.Findings.Add(finding);
            }

            // 6) الشاهد المستقل: مدى مشتق من القياس، لا سقف مخترع.
            Corroborate(targetProcess, self, chosen, enumerated, result);

            result.ObjectIdentityAvailable = NativeExtras.ObjectIdentityAvailable;

            // 7) الحكم على الاكتمال. كل شرط يجب أن يتحقق؛ لا يعوّض أحدها عن آخر.
            if (result.CorroborationExtraValues.Count > 0)
            {
                result.EnumerationComplete = false;
                result.IncompleteReasonCode = ReasonCorroborationExtra;
                result.IncompleteReason =
                    "an independent probe found " + result.CorroborationExtraValues.Count.ToString()
                    + " duplicable handle value(s) the enumeration did not report";
                return result;
            }
            if (result.SourcesCompared && !result.SourcesAgree)
            {
                result.EnumerationComplete = false;
                result.IncompleteReasonCode = ReasonSourcesDisagree;
                result.IncompleteReason =
                    "the public enumeration and the internal corroboration disagree on the handle table of a"
                    + " suspended process: " + result.PrimaryOnlyValues.Count.ToString()
                    + " value(s) only in " + result.PrimaryMethod + ", "
                    + result.SecondaryOnlyValues.Count.ToString() + " value(s) only in " + result.SecondaryMethod;
                return result;
            }

            result.EnumerationComplete = true;
            return result;
        }

        /// <summary>
        /// مقارنة مجموعتَي القيم. تجري فقط على هدف معلّق: هناك أي اختلاف يعني خطأ
        /// قياس. وعلى هدف يعمل يُسجَّل امتناع المقارنة بسببه، ولا يُدَّعى اتفاق لم
        /// يُقَس ولا يُتَّهم اختلافٌ مشروع.
        /// </summary>
        private static void CompareSources(
            HandleTableSnapshot primary, HandleTableSnapshot secondary,
            HandleScanContext context, HandleScanResult result)
        {
            if (!context.TargetSuspended)
            {
                result.SourcesCompared = false;
                result.SourcesNotComparedReason = "TARGET_NOT_SUSPENDED";
                return;
            }
            if (!primary.Succeeded || !secondary.Succeeded)
            {
                result.SourcesCompared = false;
                result.SourcesNotComparedReason =
                    primary.Succeeded ? "SECONDARY_ENUMERATION_UNAVAILABLE" : "PRIMARY_ENUMERATION_UNAVAILABLE";
                return;
            }

            HashSet<long> primaryValues = new HashSet<long>();
            foreach (HandleTableEntry entry in primary.Entries) { primaryValues.Add(entry.Value); }
            HashSet<long> secondaryValues = new HashSet<long>();
            foreach (HandleTableEntry entry in secondary.Entries) { secondaryValues.Add(entry.Value); }

            foreach (long value in primaryValues)
            {
                if (!secondaryValues.Contains(value)) { result.PrimaryOnlyValues.Add(value); }
            }
            foreach (long value in secondaryValues)
            {
                if (!primaryValues.Contains(value)) { result.SecondaryOnlyValues.Add(value); }
            }

            result.SourcesCompared = true;
            result.SourcesAgree =
                result.PrimaryOnlyValues.Count == 0 && result.SecondaryOnlyValues.Count == 0;
        }

        private static HandleFinding Describe(
            IntPtr targetProcess, IntPtr self, HandleTableEntry entry, HandleScanContext context)
        {
            HandleFinding finding = new HandleFinding();
            finding.Value = entry.Value;
            finding.GrantedAccess = entry.GrantedAccess;
            finding.ObjectTypeIndex = entry.ObjectTypeIndex;
            finding.HandleAttributes = entry.HandleAttributes;
            finding.PssObjectType = entry.PssObjectType;

            IntPtr duplicated;
            bool copied = NativeExtras.DuplicateHandle(
                targetProcess, new IntPtr(entry.Value), self, out duplicated,
                0, false, NativeExtras.DUPLICATE_SAME_ACCESS);

            if (!copied)
            {
                // القيمة معدودة، لكن الكائن لا يُنسخ إلى فاحصنا. تُسجَّل كما هي:
                // إخفاء ما لم نستطع وصفه هو ما يصنع النتائج الكاذبة.
                finding.Duplicable = false;
                finding.Win32Error = Marshal.GetLastWin32Error();
                finding.TypeName = "NOT_DUPLICABLE";
                finding.Origin = ClassifyOrigin(context, entry.Value, "");
                return finding;
            }

            try
            {
                finding.Duplicable = true;
                finding.ProbeRole = MatchProbeObject(duplicated, context);
                uint type = NativeExtras.GetFileType(duplicated);
                finding.TypeName = TypeName(type);

                if (type == NativeExtras.FILE_TYPE_DISK)
                {
                    StringBuilder buffer = new StringBuilder(1024);
                    uint length = NativeExtras.GetFinalPathNameByHandleW(
                        duplicated, buffer, (uint) buffer.Capacity, NativeExtras.VOLUME_NAME_DOS);
                    if (length > 0)
                    {
                        finding.IsFileSystemObject = true;
                        finding.Path = Normalize(buffer.ToString());
                        finding.InsideScope = IsInsideAny(finding.Path, context.ScopeRoots);
                        finding.CanaryReadable =
                            !finding.InsideScope && CanReadCanary(duplicated, context.Canary, finding);
                    }
                    else
                    {
                        finding.Win32Error = Marshal.GetLastWin32Error();
                        finding.TypeName = "DISK_PATH_UNRESOLVED";
                    }
                }

                finding.Origin = ClassifyOrigin(context, entry.Value, finding.ProbeRole);
                return finding;
            }
            finally
            {
                Polaris.ConfinementSpike.Launcher.Native.ProcessNativeMethods.CloseHandle(duplicated);
            }
        }

        /// <summary>
        /// تعزيز مستقل لاكتمال التعداد. المدى مشتق من القياس: حتى أعلى قيمة معدودة،
        /// وزيادة متناسبة مع عدد المقابض المُبلَّغ. ليس سقفًا مخترعًا، وليس مصدر
        /// التعداد — بل شاهد عليه.
        /// </summary>
        private static void Corroborate(
            IntPtr targetProcess, IntPtr self, HandleTableSnapshot snapshot,
            HashSet<long> enumerated, HandleScanResult result)
        {
            long overscan = 4 * (snapshot.ReportedCount + 1) * 4;
            long upper = snapshot.MaxValue + overscan;
            if (upper < 4) { upper = 4; }
            result.CorroborationRan = true;
            result.CorroborationUpperBound = upper;

            for (long value = 4; value <= upper; value += 4)
            {
                if (enumerated.Contains(value)) { continue; }
                IntPtr duplicated;
                bool copied = NativeExtras.DuplicateHandle(
                    targetProcess, new IntPtr(value), self, out duplicated,
                    0, false, NativeExtras.DUPLICATE_SAME_ACCESS);
                if (!copied) { continue; }
                Polaris.ConfinementSpike.Launcher.Native.ProcessNativeMethods.CloseHandle(duplicated);
                result.CorroborationExtraValues.Add(value);
            }
        }

        private static string ClassifyOrigin(HandleScanContext context, long value, string probeRole)
        {
            if (context.PreviousValues != null && !context.PreviousValues.Contains(value))
            {
                return OriginRuntimeOpened;
            }
            if (probeRole == "STDIO_PIPE") { return OriginProbeCreated; }
            // العملية تُفحص عند الإنشاء وهي معلّقة، ولم تنفّذ تعليمة واحدة، والنسخ
            // يقع في جدولنا لا في جدولها. فما يظهر هنا كان في جدولها لحظة الإنشاء.
            return OriginInheritedAtCreate;
        }

        private static string MatchProbeObject(IntPtr duplicated, HandleScanContext context)
        {
            foreach (KeyValuePair<IntPtr, string> probe in context.ProbeHandles)
            {
                if (probe.Key == IntPtr.Zero) { continue; }
                if (NativeExtras.SameObject(duplicated, probe.Key)) { return probe.Value; }
            }
            return "";
        }

        private static string TypeName(uint type)
        {
            if (type == NativeExtras.FILE_TYPE_DISK) { return "DISK"; }
            if (type == NativeExtras.FILE_TYPE_CHAR) { return "CHAR"; }
            if (type == NativeExtras.FILE_TYPE_PIPE) { return "PIPE"; }
            return "NON_FILE_OBJECT";
        }

        // إثبات أن المقبض ليس موجودًا فحسب بل صالح للقراءة فعلًا:
        // هذا هو الفرق بين "مقبض ظاهر" و"تسرّب حقيقي".
        private static bool CanReadCanary(IntPtr handle, string canary, HandleFinding finding)
        {
            if (string.IsNullOrEmpty(canary)) { return false; }
            try
            {
                NativeExtras.SetFilePointerEx(handle, 0, IntPtr.Zero, 0);
                byte[] buffer = new byte[4096];
                uint read;
                if (!NativeExtras.ReadFile(handle, buffer, (uint) buffer.Length, out read, IntPtr.Zero))
                {
                    finding.Win32Error = Marshal.GetLastWin32Error();
                    return false;
                }
                string text = Encoding.UTF8.GetString(buffer, 0, (int) read);
                return text.IndexOf(canary, StringComparison.Ordinal) >= 0;
            }
            catch
            {
                return false;
            }
        }

        internal static int CountOutOfScope(HandleScanResult result)
        {
            if (result == null) { return 0; }
            int count = 0;
            foreach (HandleFinding finding in result.Findings)
            {
                if (finding.IsFileSystemObject && !finding.InsideScope) { count++; }
            }
            return count;
        }

        internal static HashSet<long> ValueSet(HandleScanResult result)
        {
            HashSet<long> values = new HashSet<long>();
            if (result == null) { return values; }
            foreach (HandleFinding finding in result.Findings) { values.Add(finding.Value); }
            return values;
        }

        /// <summary>
        /// إخراج النتائج الخام كما هي، ومعها حالة التعداد. الفارق بين "لم نجد"
        /// و"لم نفحص" و"فحصنا فحصًا ناقصًا" يجب أن يظهر في الدليل لا في النثر.
        /// </summary>
        internal static void Emit(JsonWriter json, string name, HandleScanResult result)
        {
            bool scanned = result != null && result.Attempted;
            json.Property(name + "_scanned", scanned);
            json.Name(name + "_enumeration").BeginObject();
            json.Property("attempted", scanned);
            json.Property("phase", result == null ? "" : result.Phase);
            json.Property("method", result == null ? "NONE" : result.Method);
            json.Property("enumeration_source", result == null ? "NONE" : result.EnumerationSource);
            json.Property("reported_count", result == null ? 0 : result.ReportedCount);
            json.Property("enumerated_count", result == null ? 0 : result.EnumeratedCount);
            json.Property("enumeration_complete", result != null && result.EnumerationComplete);
            json.Property("incomplete_reason_code", result == null ? "" : result.IncompleteReasonCode);
            json.Property("incomplete_reason", result == null ? "" : result.IncompleteReason);

            // الواجهة العامة: شواهد اكتمالها كما تعيدها هي، لا كما نصفها.
            json.Name("primary_enumeration").BeginObject();
            json.Property("api_class", "PUBLIC_DOCUMENTED");
            json.Property("method", result == null ? "NONE" : result.PrimaryMethod);
            json.Property("attempted", result != null && result.PrimaryAttempted);
            json.Property("available", result != null && result.PrimaryAvailable);
            json.Property("capture_flags", result == null ? "" : "0x" + result.PrimaryCaptureFlags.ToString("x8"));
            json.Property("capture_status", result == null ? 0 : result.PrimaryCaptureStatus);
            json.Property("query_status", result == null ? 0 : result.PrimaryQueryStatus);
            json.Property("handles_captured_recorded", result != null && result.PrimaryHandlesCapturedRecorded);
            json.Property("handles_captured", result == null ? 0 : result.PrimaryReportedCount);
            json.Property("handles_walked", result == null ? 0 : result.PrimaryWalkedCount);
            json.Property("walk_ended_with_no_more_items", result != null && result.PrimaryWalkEndedWithNoMoreItems);
            json.Property("walk_terminal_status", result == null ? 0 : result.PrimaryWalkTerminalStatus);
            json.Property("entry_size_used", result == null ? 0 : result.PrimaryEntrySize);
            json.Property("complete", result != null && result.PrimaryComplete);
            json.Property("failure_reason", result == null ? "" : result.PrimaryFailureReason);
            json.EndObject();

            // الواجهة الداخلية: شاهد ثانٍ أو احتياطي معلن، ومصنَّفة كذلك صراحةً.
            json.Name("secondary_enumeration").BeginObject();
            json.Property("api_class", "INTERNAL_UNDOCUMENTED");
            json.Property("method", result == null ? "NONE" : result.SecondaryMethod);
            json.Property("attempted", result != null && result.SecondaryAttempted);
            json.Property("available", result != null && result.SecondaryAvailable);
            json.Property("nt_status", result == null ? "" : "0x" + result.NtStatus.ToString("x8"));
            json.Property("reported_count", result == null ? 0 : result.SecondaryReportedCount);
            json.Property("parsed_count", result == null ? 0 : result.SecondaryParsedCount);
            json.Property("complete", result != null && result.SecondaryComplete);
            json.Property("failure_reason", result == null ? "" : result.SecondaryFailureReason);
            json.EndObject();

            // المقارنة: تُخرَج كاملة. اتفاق لم يُقَس لا يُدَّعى، واختلاف لا يُبتلع.
            json.Name("source_agreement").BeginObject();
            json.Property("compared", result != null && result.SourcesCompared);
            json.Property("not_compared_reason", result == null ? "" : result.SourcesNotComparedReason);
            json.Property("agree", result != null && result.SourcesAgree);
            json.Name("primary_only_values").BeginArray();
            if (result != null)
            {
                foreach (long value in result.PrimaryOnlyValues) { json.Value(value); }
            }
            json.EndArray();
            json.Name("secondary_only_values").BeginArray();
            if (result != null)
            {
                foreach (long value in result.SecondaryOnlyValues) { json.Value(value); }
            }
            json.EndArray();
            json.EndObject();

            json.Property("corroboration_ran", result != null && result.CorroborationRan);
            json.Property("corroboration_upper_bound", result == null ? 0 : result.CorroborationUpperBound);
            json.Property("object_identity_available", result != null && result.ObjectIdentityAvailable);
            json.Name("corroboration_extra_values").BeginArray();
            if (result != null)
            {
                foreach (long value in result.CorroborationExtraValues) { json.Value(value); }
            }
            json.EndArray();
            json.EndObject();

            json.Name(name).BeginArray();
            if (result != null)
            {
                foreach (HandleFinding finding in result.Findings)
                {
                    json.BeginObject();
                    json.Property("value", finding.Value);
                    json.Property("path", finding.Path);
                    json.Property("type", finding.TypeName);
                    json.Property("filesystem_object", finding.IsFileSystemObject);
                    json.Property("inside_scope", finding.InsideScope);
                    json.Property("canary_readable", finding.CanaryReadable);
                    json.Property("duplicable", finding.Duplicable);
                    json.Property("win32_error", finding.Win32Error);
                    json.Property("granted_access", "0x" + finding.GrantedAccess.ToString("x8"));
                    json.Property("object_type_index", finding.ObjectTypeIndex);
                    json.Property("handle_attributes", "0x" + finding.HandleAttributes.ToString("x8"));
                    json.Property("pss_object_type", finding.PssObjectType);
                    json.Property("origin", finding.Origin);
                    json.Property("probe_role", finding.ProbeRole);
                    json.EndObject();
                }
            }
            json.EndArray();
        }

        internal static string Normalize(string path)
        {
            string value = path;
            if (value.StartsWith(@"\\?\", StringComparison.Ordinal)) { value = value.Substring(4); }
            return value.TrimEnd('\\');
        }

        internal static bool IsInsideAny(string path, string[] roots)
        {
            if (roots == null) { return false; }
            string folded = path.ToUpperInvariant();
            foreach (string root in roots)
            {
                if (string.IsNullOrEmpty(root)) { continue; }
                string baseRoot = Normalize(root).ToUpperInvariant();
                if (folded == baseRoot || folded.StartsWith(baseRoot + "\\", StringComparison.Ordinal)) { return true; }
            }
            return false;
        }
    }
}
