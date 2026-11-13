using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Polaris.ConfinementSpike.Launcher.Native;

namespace Polaris.W4.WindowsAdapter
{
    internal enum InheritanceMode
    {
        /// <summary>قائمة مقابض صريحة. هذا هو الوضع الوحيد المسموح في POLARIS.</summary>
        ExplicitHandleList,
        /// <summary>وراثة محيطة بلا قائمة. ضابط موجب فقط، وممنوع في مسار الإنتاج.</summary>
        AmbientInheritance
    }

    /// <summary>
    /// الحالة الكاملة المُمرَّرة إلى CreateProcessW، مسجَّلة قبل الاستدعاء.
    ///
    /// العيب الذي يغلقه هذا الصنف: حين فشل الإطلاق برقم Win32 وحده، لم يكن في
    /// الدليل ما يُشخَّص منه — لا سطر أوامر، ولا مجلد عمل، ولا أسماء بيئة، ولا
    /// حجم البنية ولا عدد السمات ولا الأعلام. الرقم بلا مدخلاته ليس تشخيصًا.
    /// القيم نفسها لا تُسجَّل: الأسماء وبصمات القيم فقط.
    /// </summary>
    internal sealed class LaunchInputs
    {
        public string ApplicationName = "";
        public bool ApplicationNameExplicit;
        public string CommandLine = "";
        public string WorkingDirectory = "";
        public bool ExecutableExists;
        public bool WorkingDirectoryExists;
        public List<string> RequiredFilesMissing = new List<string>();
        public List<string> NodeStartupFlags = new List<string>();
        public List<string> EnvironmentNames = new List<string>();
        public List<string> EnvironmentValueHashes = new List<string>();
        public bool AppContainerEnabled;
        public int CapabilityCount;
        public bool HandleListEnabled;
        public bool JobEnabled;
        public uint CreationFlags;
        public int StartupInfoCb;
        public int AttributeCount;
        public bool EnvironmentBlockValid;
        public bool EnvironmentBlockRoundTripVerified;
        public bool EnvironmentBlockSorted;
        public bool EnvironmentBlockDoubleNulTerminated;
        public int EnvironmentBlockBytes;
        public int EnvironmentEntryCount;
        public bool AmbientEnvironment;
        public string EnvironmentBlockDetail = "";

        internal static void Emit(JsonWriter json, string name, LaunchInputs inputs)
        {
            json.Name(name).BeginObject();
            if (inputs == null)
            {
                json.Property("recorded", false);
                json.EndObject();
                return;
            }
            json.Property("recorded", true);
            json.Property("application_name", inputs.ApplicationName);
            json.Property("application_name_explicit", inputs.ApplicationNameExplicit);
            json.Property("command_line", inputs.CommandLine);
            json.Property("node_startup_flags", inputs.NodeStartupFlags);
            json.Property("working_directory", inputs.WorkingDirectory);
            json.Property("executable_exists", inputs.ExecutableExists);
            json.Property("working_directory_exists", inputs.WorkingDirectoryExists);
            json.Property("required_files_missing", inputs.RequiredFilesMissing);
            json.Property("environment_names", inputs.EnvironmentNames);
            json.Property("environment_value_hashes", inputs.EnvironmentValueHashes);
            json.Property("environment_entry_count", inputs.EnvironmentEntryCount);
            json.Property("environment_block_bytes", inputs.EnvironmentBlockBytes);
            json.Property("environment_block_valid", inputs.EnvironmentBlockValid);
            json.Property("environment_block_round_trip_verified", inputs.EnvironmentBlockRoundTripVerified);
            json.Property("environment_block_sorted_case_insensitively", inputs.EnvironmentBlockSorted);
            json.Property("environment_block_double_nul_terminated", inputs.EnvironmentBlockDoubleNulTerminated);
            json.Property("environment_block_detail", inputs.EnvironmentBlockDetail);
            json.Property("ambient_environment", inputs.AmbientEnvironment);
            json.Property("appcontainer_enabled", inputs.AppContainerEnabled);
            json.Property("capability_count", inputs.CapabilityCount);
            json.Property("handle_list_enabled", inputs.HandleListEnabled);
            json.Property("job_enabled", inputs.JobEnabled);
            json.Property("creation_flags", "0x" + inputs.CreationFlags.ToString("x8"));
            json.Property("startupinfo_cb", inputs.StartupInfoCb);
            json.Property("attribute_count", inputs.AttributeCount);
            json.EndObject();
        }
    }

    internal sealed class LaunchOutcome
    {
        public bool Created;
        public int ProcessId;
        public int Win32Error;
        public string FailureStage = "";
        public bool AssignedToJob;
        public int JobAssignError;
        public uint ExitCode;
        /// <summary>هل قُرئ رمز الخروج فعلًا. غيابه ليس صفرًا.</summary>
        public bool ExitCodeAvailable;
        public int ExitCodeWin32Error;
        public bool TimedOut;
        /// <summary>نتيجة الانتظار باسمها: WAIT_OBJECT_0 أو WAIT_TIMEOUT أو WAIT_FAILED.</summary>
        public string WaitResult = "";
        public int WaitWin32Error;
        /// <summary>نجح استئناف الخيط فعلًا. 0xFFFFFFFF من النداء إخفاق لا استئناف.</summary>
        public bool ResumeSucceeded;
        public int ResumeWin32Error;
        public bool StdinWriteAttempted;
        public bool StdinWriteSuccess;
        public int StdinBytesExpected;
        public int StdinBytesWritten;
        public int StdinWriteWin32Error;
        /// <summary>انكسر أنبوب الإدخال: الابن مات قبل أن يقرأ منحته.</summary>
        public bool StdinBrokenPipe;
        public bool StdoutReadSuccess;
        public int StdoutBytesRead;
        public int StdoutReadWin32Error;
        public bool StdoutReadJoined;
        public bool StderrReadSuccess;
        public int StderrBytesRead;
        public int StderrReadWin32Error;
        public bool StderrReadJoined;
        /// <summary>هل خُلط الخطأ القياسي بالمخرج. false: مجريان مستقلان.</summary>
        public bool StderrMerged;
        public string StandardOutput = "";
        /// <summary>الخطأ القياسي كاملًا، مفصولًا عن البروتوكول.</summary>
        public string StandardError = "";
        /// <summary>حالة الاستدعاء كما مُرِّرت فعلًا. تُسجَّل نجح أم فشل.</summary>
        public LaunchInputs Inputs;
        /// <summary>لقطة جدول المقابض والعملية معلّقة: هذه هي دلالة الوراثة.</summary>
        public HandleScanResult HandlesAtStart;
        /// <summary>لقطة بعد الاستئناف، لتمييز ما فُتح في وقت التشغيل. تشخيصية.</summary>
        public HandleScanResult HandlesAfterResume;
        /// <summary>هل جرى فحص جدول المقابض فعلًا؟ قائمة فارغة بلا فحص ليست دليل نظافة.</summary>
        public bool HandlesScanned;
        /// <summary>جرى الفحص لكنه لم يثبت اكتماله. لا يُقرأ نظافةً ولا خرقًا.</summary>
        public bool HandleEnumerationIncomplete;
        /// <summary>
        /// مصدرا التعداد اختلفا على جدول هدف معلّق. حالة خاصة من عدم الاكتمال،
        /// تُسمّى باسمها ولا تُدمج نتائجها.
        /// </summary>
        public bool HandleEnumerationSourcesDisagree;
        /// <summary>مُنع الاستئناف لأن مقبضًا خارج النطاق كان في جدول الابن.</summary>
        public bool HandleScopeViolation;
        public bool Resumed;
        /// <summary>أُنشئت ثم أُنهيت فورًا: قياس إطلاق فقط، بلا تنفيذ ولا حكم أمني.</summary>
        public bool CreateOnly;
    }

    internal sealed class LaunchSpec
    {
        public string ExecutablePath = "";
        public string CommandLine = "";
        public string WorkingDirectory = "";
        public Dictionary<string, string> Environment = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public InheritanceMode Inheritance = InheritanceMode.ExplicitHandleList;
        /// <summary>مقبض يُسرَّب عمدًا. للضابط الموجب فقط.</summary>
        public IntPtr DeliberateLeak = IntPtr.Zero;
        public IntPtr AppContainerSid = IntPtr.Zero;
        public IntPtr JobHandle = IntPtr.Zero;
        public string StdinPayload = "";
        public string[] ScopeRoots = new string[0];
        public string Canary = "";
        public int TimeoutMilliseconds = 30000;
        /// <summary>يفحص جدول مقابض الابن وهو معلّق، قبل استئنافه.</summary>
        public bool ScanHandlesBeforeResume = true;
        /// <summary>لقطة ثانية بعد الاستئناف لتصنيف RUNTIME_OPENED. تشخيصية، وليست شرط حكم.</summary>
        public bool ScanHandlesAfterResume;
        /// <summary>
        /// فرض لا وصف: إن وُجد مقبض ملف أو مجلد خارج النطاق قبل الاستئناف، أو تعذّر
        /// إثبات اكتمال التعداد، لا تُستأنف العملية إطلاقًا — تُنهى ويُسجَّل السبب.
        /// يُطفأ فقط في الضابط الموجب، حيث التسريب مقصود ويجب أن يُرى.
        /// </summary>
        public bool EnforceHandleScope = true;
        /// <summary>
        /// تمرير lpApplicationName صراحةً بدل ترك ويندوز يستنتج الملف التنفيذي من
        /// سطر الأوامر. يزيل غموض البحث في PATH وتقسيم المسارات ذات المسافات.
        /// </summary>
        public bool UseExplicitApplicationName;
        /// <summary>
        /// إنشاء معلّق ثم إنهاء فوري. قياس قابلية الإطلاق وحدها: لا استئناف، ولا
        /// قراءة مخرجات، ولا فحص مقابض، ولا يُقرأ منه أي ادّعاء أمني.
        /// </summary>
        public bool CreateOnly;
        /// <summary>
        /// تشخيصي فقط: تمرير lpEnvironment = NULL فترث العملية بيئة الأب كاملة.
        /// ممنوع في مسار الإنتاج، والمُطلِق نفسه يرفضه ما لم يكن CreateOnly.
        /// </summary>
        public bool UseAmbientEnvironment;
        /// <summary>ملفات يجب أن توجد قبل الاستدعاء. تُفحص وتُسجَّل، ولا تُفترض.</summary>
        public string[] RequiredFiles = new string[0];
        /// <summary>
        /// أعلام مفسّر العقدة المسبوقة على مسار السكربت في سطر الأوامر. تُسجَّل في
        /// الدليل حتى يُقرأ سلوك الإقلاع من الحالة لا من الذاكرة.
        /// </summary>
        public string[] NodeStartupFlags = new string[0];
        /// <summary>
        /// مراقب مباشر لمخرج الابن القياسي، اختياري.
        ///
        /// مرجع فارغ — وهو الأصل — يعني قراءةً مطابقة حرفيًا لما كانت: تُنشَر
        /// النتيجة بعد نهاية الملف وحدها. يُضبط حين يحتاج المُقيس أن يلاحظ
        /// وثيقة استعداد قبل أن ينتهي الابن، وهو ما لا يمكن بعد نهاية الملف.
        ///
        /// لا يضيف مقبضًا ولا يغيّر قائمة المقابض الصريحة: القناة هي مقبض المخرج
        /// القياسي القائم نفسه، المُدرَج أصلًا والمُغلق أصلًا في التنظيف.
        /// </summary>
        public IPipeObserver StdoutObserver;
    }

    /// <summary>
    /// مُطلِق W4 على ويندوز.
    ///
    /// الترتيب مقصود بالكامل:
    ///   0) التحقق من المدخلات: وجود الملف التنفيذي ومجلد العمل والملفات المطلوبة،
    ///      وصحة شكل كتلة البيئة — قبل الاستدعاء لا بعد فشله.
    ///   1) إنشاء العملية معلّقة، فلا تنفّذ تعليمة واحدة قبل اكتمال الحصر.
    ///   2) قائمة مقابض صريحة عبر PROC_THREAD_ATTRIBUTE_HANDLE_LIST — لا وراثة محيطة.
    ///   3) قدرات AppContainer صفرية عند طلبها.
    ///   4) الضم إلى Job قبل الاستئناف، وإلا وُجدت نافذة تهرب.
    ///   5) تعداد جدول المقابض كاملًا وهي معلّقة: مقبض ملف خارج النطاق — أو تعداد
    ///      لم يثبت اكتماله — يمنع الاستئناف.
    ///   6) الاستئناف.
    ///
    /// الخطوة الخامسة ليست اختبارًا بل شرط تنفيذ: نظافة المقابض مفروضة، لا موصوفة.
    /// </summary>
    internal sealed class ConfinedLauncher
    {
        private const uint WaitTimeout = 0x00000102;
        private const uint ThreadResumeFailed = 0xFFFFFFFF;

        internal const string StageInputMissing = "LAUNCH_INPUT_MISSING";
        internal const string StageEnvironmentBlockInvalid = "ENVIRONMENT_BLOCK_INVALID";
        internal const string StageAmbientForbidden = "AMBIENT_ENVIRONMENT_FORBIDDEN_OUTSIDE_DIAGNOSTIC";
        internal const string StageCreateProcess = "CreateProcessW";
        internal const string StageResumeFailed = "RESUME_THREAD";

        private const uint WaitFailed = 0xFFFFFFFF;
        private const int ErrorBrokenPipe = 109;
        private const int ErrorNoData = 232;
        private const int PipeJoinMilliseconds = 10000;

        public LaunchOutcome Launch(LaunchSpec spec)
        {
            LaunchOutcome outcome = new LaunchOutcome();
            outcome.CreateOnly = spec.CreateOnly;

            LaunchInputs inputs = new LaunchInputs();
            outcome.Inputs = inputs;
            inputs.ApplicationName = spec.UseExplicitApplicationName ? spec.ExecutablePath : "";
            inputs.ApplicationNameExplicit = spec.UseExplicitApplicationName;
            inputs.CommandLine = spec.CommandLine;
            inputs.NodeStartupFlags = new List<string>(spec.NodeStartupFlags);
            inputs.WorkingDirectory = spec.WorkingDirectory;
            inputs.AppContainerEnabled = spec.AppContainerSid != IntPtr.Zero;
            inputs.CapabilityCount = 0;
            inputs.HandleListEnabled = spec.Inheritance == InheritanceMode.ExplicitHandleList;
            inputs.JobEnabled = spec.JobHandle != IntPtr.Zero;
            inputs.AmbientEnvironment = spec.UseAmbientEnvironment;

            // ── الحارس: البيئة المحيطة تشخيص، ولا تكون مسار تنفيذ أبدًا ─────────
            if (spec.UseAmbientEnvironment && !spec.CreateOnly)
            {
                outcome.FailureStage = StageAmbientForbidden;
                return outcome;
            }

            // ── التحقق من المدخلات قبل أي استدعاء ───────────────────────────────
            inputs.ExecutableExists = spec.ExecutablePath.Length > 0 && File.Exists(spec.ExecutablePath);
            inputs.WorkingDirectoryExists =
                spec.WorkingDirectory.Length > 0 && Directory.Exists(spec.WorkingDirectory);
            for (int i = 0; i < spec.RequiredFiles.Length; i++)
            {
                if (!File.Exists(spec.RequiredFiles[i])) { inputs.RequiredFilesMissing.Add(spec.RequiredFiles[i]); }
            }
            if (!inputs.ExecutableExists || !inputs.WorkingDirectoryExists || inputs.RequiredFilesMissing.Count > 0)
            {
                outcome.FailureStage = StageInputMissing;
                return outcome;
            }

            IntPtr stdoutRead = IntPtr.Zero, stdoutWrite = IntPtr.Zero;
            IntPtr stderrRead = IntPtr.Zero, stderrWrite = IntPtr.Zero;
            IntPtr stdinRead = IntPtr.Zero, stdinWrite = IntPtr.Zero;
            IntPtr attributeList = IntPtr.Zero;
            IntPtr handleArray = IntPtr.Zero;
            IntPtr capabilitiesBuffer = IntPtr.Zero;
            IntPtr environmentBlock = IntPtr.Zero;
            IntPtr applicationNameBuffer = IntPtr.Zero;
            IntPtr commandLineBuffer = IntPtr.Zero;

            try
            {
                ProcessNativeMethods.SECURITY_ATTRIBUTES pipeAttributes = new ProcessNativeMethods.SECURITY_ATTRIBUTES();
                pipeAttributes.nLength = Marshal.SizeOf(typeof(ProcessNativeMethods.SECURITY_ATTRIBUTES));
                pipeAttributes.bInheritHandle = true;
                IntPtr attributesBuffer = Marshal.AllocHGlobal(pipeAttributes.nLength);
                Marshal.StructureToPtr(pipeAttributes, attributesBuffer, false);

                try
                {
                    if (!NativeExtras.CreatePipe(out stdoutRead, out stdoutWrite, attributesBuffer, 0))
                    {
                        outcome.Win32Error = Marshal.GetLastWin32Error();
                        outcome.FailureStage = "CreatePipe(stdout)";
                        return outcome;
                    }
                    if (!NativeExtras.CreatePipe(out stderrRead, out stderrWrite, attributesBuffer, 0))
                    {
                        outcome.Win32Error = Marshal.GetLastWin32Error();
                        outcome.FailureStage = "CreatePipe(stderr)";
                        return outcome;
                    }
                    if (!NativeExtras.CreatePipe(out stdinRead, out stdinWrite, attributesBuffer, 0))
                    {
                        outcome.Win32Error = Marshal.GetLastWin32Error();
                        outcome.FailureStage = "CreatePipe(stdin)";
                        return outcome;
                    }
                }
                finally
                {
                    Marshal.FreeHGlobal(attributesBuffer);
                }

                // الطرف الذي يبقى مع الوالد يجب ألا يُورَّث أبدًا.
                NativeExtras.SetHandleInformation(stdoutRead, NativeExtras.HANDLE_FLAG_INHERIT, 0);
                NativeExtras.SetHandleInformation(stderrRead, NativeExtras.HANDLE_FLAG_INHERIT, 0);
                NativeExtras.SetHandleInformation(stdinWrite, NativeExtras.HANDLE_FLAG_INHERIT, 0);

                // القائمة الصريحة تحمل المجاري القياسية فقط. المقبض المسرَّب عمدًا
                // لا يُضاف إليها أبدًا: وجوده في الوالد قابلًا للتوريث هو الاختبار،
                // والقائمة الصريحة هي ما يجب أن يمنع وصوله.
                List<IntPtr> inheritable = new List<IntPtr>();
                inheritable.Add(stdinRead);
                inheritable.Add(stdoutWrite);
                inheritable.Add(stderrWrite);

                // كائنات المسبار نفسه، حتى يُميَّز ما صنعناه عمّا وُرث.
                HandleScanContext scanContext = new HandleScanContext();
                scanContext.ScopeRoots = spec.ScopeRoots;
                scanContext.Canary = spec.Canary;
                scanContext.Phase = "AT_CREATE";
                // الابن يبقى معلّقًا طوال لقطة الوراثة الأساسية، فمقارنة مصدرَي
                // التعداد ذات معنى: أي اختلاف بينهما خطأ قياس لا تغيّر جدول.
                scanContext.TargetSuspended = true;
                scanContext.ProbeHandles.Add(new KeyValuePair<IntPtr, string>(stdinRead, "STDIO_PIPE"));
                scanContext.ProbeHandles.Add(new KeyValuePair<IntPtr, string>(stdoutWrite, "STDIO_PIPE"));
                scanContext.ProbeHandles.Add(new KeyValuePair<IntPtr, string>(stderrWrite, "STDIO_PIPE"));
                if (spec.DeliberateLeak != IntPtr.Zero)
                {
                    scanContext.ProbeHandles.Add(
                        new KeyValuePair<IntPtr, string>(spec.DeliberateLeak, "DELIBERATE_LEAK"));
                }

                bool useHandleList = spec.Inheritance == InheritanceMode.ExplicitHandleList;
                int attributeCount = (useHandleList ? 1 : 0) + (spec.AppContainerSid != IntPtr.Zero ? 1 : 0);
                inputs.AttributeCount = attributeCount;

                if (attributeCount > 0)
                {
                    IntPtr size = IntPtr.Zero;
                    ProcessNativeMethods.InitializeProcThreadAttributeList(IntPtr.Zero, attributeCount, 0, ref size);
                    attributeList = Marshal.AllocHGlobal(size);
                    if (!ProcessNativeMethods.InitializeProcThreadAttributeList(attributeList, attributeCount, 0, ref size))
                    {
                        outcome.Win32Error = Marshal.GetLastWin32Error();
                        outcome.FailureStage = "InitializeProcThreadAttributeList";
                        return outcome;
                    }

                    if (useHandleList)
                    {
                        handleArray = Marshal.AllocHGlobal(IntPtr.Size * inheritable.Count);
                        for (int i = 0; i < inheritable.Count; i++)
                        {
                            Marshal.WriteIntPtr(handleArray, i * IntPtr.Size, inheritable[i]);
                        }
                        if (!ProcessNativeMethods.UpdateProcThreadAttribute(
                                attributeList, 0, ProcessNativeMethods.PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                handleArray, new IntPtr(IntPtr.Size * inheritable.Count), IntPtr.Zero, IntPtr.Zero))
                        {
                            outcome.Win32Error = Marshal.GetLastWin32Error();
                            outcome.FailureStage = "UpdateProcThreadAttribute(HANDLE_LIST)";
                            return outcome;
                        }
                    }

                    if (spec.AppContainerSid != IntPtr.Zero)
                    {
                        ProcessNativeMethods.SECURITY_CAPABILITIES capabilities =
                            new ProcessNativeMethods.SECURITY_CAPABILITIES();
                        capabilities.AppContainerSid = spec.AppContainerSid;
                        // صفر قدرات. لا internetClient، ولا أي قدرة أخرى.
                        capabilities.Capabilities = IntPtr.Zero;
                        capabilities.CapabilityCount = 0;
                        capabilities.Reserved = 0;

                        int capabilitiesSize = Marshal.SizeOf(typeof(ProcessNativeMethods.SECURITY_CAPABILITIES));
                        capabilitiesBuffer = Marshal.AllocHGlobal(capabilitiesSize);
                        Marshal.StructureToPtr(capabilities, capabilitiesBuffer, false);

                        if (!ProcessNativeMethods.UpdateProcThreadAttribute(
                                attributeList, 0, ProcessNativeMethods.PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
                                capabilitiesBuffer, new IntPtr(capabilitiesSize), IntPtr.Zero, IntPtr.Zero))
                        {
                            outcome.Win32Error = Marshal.GetLastWin32Error();
                            outcome.FailureStage = "UpdateProcThreadAttribute(SECURITY_CAPABILITIES)";
                            return outcome;
                        }
                    }
                }

                // ── كتلة البيئة: تُبنى وتُفحص، ولا تُمرَّر قبل أن يثبت شكلها ────
                if (!spec.UseAmbientEnvironment)
                {
                    EnvironmentBlockResult built = EnvironmentBlock.Build(spec.Environment);
                    inputs.EnvironmentNames = built.Names;
                    inputs.EnvironmentValueHashes = built.ValueHashes;
                    inputs.EnvironmentEntryCount = built.EntryCount;
                    inputs.EnvironmentBlockBytes = built.ByteCount;
                    inputs.EnvironmentBlockValid = built.Valid;
                    inputs.EnvironmentBlockRoundTripVerified = built.RoundTripVerified;
                    inputs.EnvironmentBlockSorted = built.SortedCaseInsensitive;
                    inputs.EnvironmentBlockDoubleNulTerminated = built.DoubleNulTerminated;
                    inputs.EnvironmentBlockDetail = built.Detail;
                    if (!built.Valid)
                    {
                        outcome.FailureStage = StageEnvironmentBlockInvalid;
                        return outcome;
                    }
                    environmentBlock = built.Block;
                }

                ProcessNativeMethods.STARTUPINFOEX startupInfo = new ProcessNativeMethods.STARTUPINFOEX();
                // cb يجب أن يطابق البنية التي يقرأها ويندوز فعلًا: الموسّعة فقط حين
                // تُمرَّر قائمة سمات، وإلا فالبنية الأساسية.
                startupInfo.StartupInfo.cb = attributeList != IntPtr.Zero
                    ? Marshal.SizeOf(typeof(ProcessNativeMethods.STARTUPINFOEX))
                    : Marshal.SizeOf(typeof(ProcessNativeMethods.STARTUPINFO));
                startupInfo.lpAttributeList = attributeList;
                startupInfo.StartupInfo.dwFlags = ProcessNativeMethods.STARTF_USESTDHANDLES;
                startupInfo.StartupInfo.hStdInput = stdinRead;
                startupInfo.StartupInfo.hStdOutput = stdoutWrite;
                startupInfo.StartupInfo.hStdError = stderrWrite;
                outcome.StderrMerged = false;
                inputs.StartupInfoCb = startupInfo.StartupInfo.cb;

                uint flags = ProcessNativeMethods.CREATE_SUSPENDED
                           | ProcessNativeMethods.CREATE_NO_WINDOW;
                if (!spec.UseAmbientEnvironment) { flags |= ProcessNativeMethods.CREATE_UNICODE_ENVIRONMENT; }
                if (attributeList != IntPtr.Zero) { flags |= ProcessNativeMethods.EXTENDED_STARTUPINFO_PRESENT; }
                inputs.CreationFlags = flags;

                // lpCommandLine قد تُعدَّل داخل CreateProcessW. تُمرَّر نسخة خاصة
                // قابلة للكتابة بدل سلسلة مُدارة مثبَّتة، فلا تُفسد سلسلة داخلية.
                if (spec.UseExplicitApplicationName)
                {
                    applicationNameBuffer = Marshal.StringToHGlobalUni(spec.ExecutablePath);
                }
                commandLineBuffer = Marshal.StringToHGlobalUni(spec.CommandLine);

                ProcessNativeMethods.PROCESS_INFORMATION processInformation;
                bool created = ProcessNativeMethods.CreateProcessW(
                    applicationNameBuffer, commandLineBuffer, IntPtr.Zero, IntPtr.Zero, true, flags,
                    environmentBlock, spec.WorkingDirectory, ref startupInfo, out processInformation);

                if (!created)
                {
                    // GetLastError يُقرأ مباشرة بعد الاستدعاء الفاشل، بلا أي نداء بينهما.
                    outcome.Win32Error = Marshal.GetLastWin32Error();
                    outcome.Created = false;
                    outcome.FailureStage = StageCreateProcess;
                    return outcome;
                }

                outcome.Created = true;
                outcome.ProcessId = (int) processInformation.dwProcessId;

                try
                {
                    if (spec.JobHandle != IntPtr.Zero)
                    {
                        outcome.AssignedToJob = JobNativeMethods.AssignProcessToJobObject(
                            spec.JobHandle, processInformation.hProcess);
                        if (!outcome.AssignedToJob) { outcome.JobAssignError = Marshal.GetLastWin32Error(); }
                    }

                    // قياس إطلاق فقط: تُنهى قبل أن تنفّذ تعليمة واحدة، ولا يُقرأ
                    // منها شيء عن الحصر. هذا المسار تشخيصي بحت.
                    if (spec.CreateOnly)
                    {
                        ProcessNativeMethods.TerminateProcess(processInformation.hProcess, 262);
                        ProcessNativeMethods.WaitForSingleObject(processInformation.hProcess, 5000);
                        return outcome;
                    }

                    // الفحص وهي معلّقة: النتيجة حتمية، لا سباق. والتعداد كامل من
                    // النواة، لا تجريب مدى مخمَّن.
                    if (spec.ScanHandlesBeforeResume)
                    {
                        outcome.HandlesAtStart = HandleScanner.Scan(processInformation.hProcess, scanContext);
                        outcome.HandlesScanned = true;
                        outcome.HandleEnumerationIncomplete = !outcome.HandlesAtStart.EnumerationComplete;
                        outcome.HandleEnumerationSourcesDisagree =
                            outcome.HandlesAtStart.IncompleteReasonCode == HandleScanner.ReasonSourcesDisagree;
                    }

                    // الفرض: مقبض خارج النطاق، أو تعداد لم يثبت اكتماله، يعني ألا
                    // تنفّذ العملية تعليمة واحدة. لا استئناف، ولا مسار احتياطي.
                    if (outcome.HandlesScanned && spec.EnforceHandleScope
                        && HandleScanner.CountOutOfScope(outcome.HandlesAtStart) > 0)
                    {
                        outcome.HandleScopeViolation = true;
                        outcome.FailureStage = "WINDOWS_HANDLE_SCOPE_VIOLATION";
                        ProcessNativeMethods.TerminateProcess(processInformation.hProcess, 259);
                        return outcome;
                    }
                    // اختلاف مصدرَي التعداد على هدف معلّق يمنع الاستئناف كذلك،
                    // ويُسمّى باسمه بدل أن يُبتلع في "ناقص" عام.
                    if (outcome.HandlesScanned && spec.EnforceHandleScope && outcome.HandleEnumerationSourcesDisagree)
                    {
                        outcome.FailureStage = "WINDOWS_HANDLE_ENUMERATION_SOURCES_DISAGREE";
                        ProcessNativeMethods.TerminateProcess(processInformation.hProcess, 261);
                        return outcome;
                    }
                    if (outcome.HandlesScanned && spec.EnforceHandleScope && outcome.HandleEnumerationIncomplete)
                    {
                        outcome.FailureStage = "WINDOWS_HANDLE_ENUMERATION_INCOMPLETE";
                        ProcessNativeMethods.TerminateProcess(processInformation.hProcess, 260);
                        return outcome;
                    }

                    // نتيجة ResumeThread تُفحص: 0xFFFFFFFF إخفاق، لا استئناف.
                    uint previousSuspendCount = ProcessNativeMethods.ResumeThread(processInformation.hThread);
                    if (previousSuspendCount == ThreadResumeFailed)
                    {
                        outcome.ResumeWin32Error = Marshal.GetLastWin32Error();
                        outcome.FailureStage = StageResumeFailed;
                        ProcessNativeMethods.TerminateProcess(processInformation.hProcess, 263);
                        ProcessNativeMethods.WaitForSingleObject(processInformation.hProcess, 5000);
                        return outcome;
                    }
                    outcome.ResumeSucceeded = true;
                    outcome.Resumed = true;

                    // الأطراف الكاتبة تُغلق في الوالد وإلا لم تنتهِ القراءة أبدًا.
                    ProcessNativeMethods.CloseHandle(stdoutWrite);
                    stdoutWrite = IntPtr.Zero;
                    ProcessNativeMethods.CloseHandle(stderrWrite);
                    stderrWrite = IntPtr.Zero;

                    // كل مجرى يُستنزَف في خيطه قبل كتابة المنحة: لو كُتبت أولًا
                    // وامتلأ مخزن الأنبوب لحجب الوالدُ نفسه بينما يملأ الابن مخرجه،
                    // وهو تعليق متبادل لا ينكسر إلا بمهلة. القراءة تسبق الكتابة دائمًا.
                    PipeReader outputReader = new PipeReader(stdoutRead, spec.StdoutObserver);
                    Thread outputThread = new Thread(new ThreadStart(outputReader.Run));
                    outputThread.IsBackground = true;
                    outputThread.Start();
                    PipeReader errorReader = new PipeReader(stderrRead);
                    Thread errorThread = new Thread(new ThreadStart(errorReader.Run));
                    errorThread.IsBackground = true;
                    errorThread.Start();

                    // stdin: النتيجة تُفحص، والعدد المكتوب يُقارن بالمتوقَّع. أنبوب
                    // مكسور هنا يعني أن الابن مات قبل أن يقرأ منحته — تشخيص لا يُبتلع.
                    if (spec.StdinPayload.Length > 0)
                    {
                        byte[] payload = Encoding.UTF8.GetBytes(spec.StdinPayload);
                        outcome.StdinWriteAttempted = true;
                        outcome.StdinBytesExpected = payload.Length;
                        uint written = 0;
                        bool wrote = NativeExtras.WriteFile(
                            stdinWrite, payload, (uint) payload.Length, out written, IntPtr.Zero);
                        outcome.StdinBytesWritten = (int) written;
                        if (!wrote)
                        {
                            outcome.StdinWriteWin32Error = Marshal.GetLastWin32Error();
                            outcome.StdinBrokenPipe = outcome.StdinWriteWin32Error == ErrorBrokenPipe
                                || outcome.StdinWriteWin32Error == ErrorNoData;
                        }
                        outcome.StdinWriteSuccess = wrote
                            && outcome.StdinBytesWritten == outcome.StdinBytesExpected;
                    }
                    else
                    {
                        outcome.StdinWriteSuccess = true;
                    }
                    ProcessNativeMethods.CloseHandle(stdinWrite);
                    stdinWrite = IntPtr.Zero;

                    // لقطة ثانية بعد الاستئناف: ما ليس في الأولى فُتح في وقت التشغيل.
                    // تشخيصية بحتة — لا تدخل في حكم الوراثة، ولا تُرقّي شيئًا.
                    if (spec.ScanHandlesAfterResume && outcome.HandlesAtStart != null)
                    {
                        ProcessNativeMethods.WaitForSingleObject(processInformation.hProcess, 250);
                        HandleScanContext afterContext = new HandleScanContext();
                        afterContext.ScopeRoots = spec.ScopeRoots;
                        afterContext.Canary = spec.Canary;
                        afterContext.Phase = "AFTER_RESUME";
                        // العملية تعمل الآن: لا تُقارن المصادر، ولا يُتَّهم اختلاف
                        // مشروع بأنه تناقض قياس. هذه اللقطة تشخيصية أصلًا.
                        afterContext.TargetSuspended = false;
                        afterContext.ProbeHandles = scanContext.ProbeHandles;
                        afterContext.PreviousValues = HandleScanner.ValueSet(outcome.HandlesAtStart);
                        outcome.HandlesAfterResume = HandleScanner.Scan(processInformation.hProcess, afterContext);
                    }

                    uint wait = ProcessNativeMethods.WaitForSingleObject(
                        processInformation.hProcess, (uint) spec.TimeoutMilliseconds);
                    if (wait == WaitFailed)
                    {
                        outcome.WaitResult = "WAIT_FAILED";
                        outcome.WaitWin32Error = Marshal.GetLastWin32Error();
                        ProcessNativeMethods.TerminateProcess(processInformation.hProcess, 264);
                    }
                    else if (wait == WaitTimeout)
                    {
                        outcome.WaitResult = "WAIT_TIMEOUT";
                        outcome.TimedOut = true;
                        ProcessNativeMethods.TerminateProcess(processInformation.hProcess, 258);
                    }
                    else
                    {
                        outcome.WaitResult = "WAIT_OBJECT_0";
                        uint exitCode = 0;
                        if (ProcessNativeMethods.GetExitCodeProcess(processInformation.hProcess, out exitCode))
                        {
                            outcome.ExitCode = exitCode;
                            outcome.ExitCodeAvailable = true;
                        }
                        else
                        {
                            outcome.ExitCodeWin32Error = Marshal.GetLastWin32Error();
                        }
                    }

                    // الابن انتهى، فطرفا الكتابة أُغلقا وانتهى الخيطان. النتيجة
                    // تُقرأ بعد الانضمام، فلا تُهجَر قراءة ولا يُقرأ نص نصفه ناقص.
                    outcome.StdoutReadJoined = outputThread.Join(PipeJoinMilliseconds);
                    outcome.StderrReadJoined = errorThread.Join(PipeJoinMilliseconds);
                    outcome.StandardOutput = outputReader.Result.Text;
                    outcome.StdoutBytesRead = outputReader.Result.ByteCount;
                    outcome.StdoutReadWin32Error = outputReader.Result.Win32Error;
                    outcome.StdoutReadSuccess = outcome.StdoutReadJoined
                        && outputReader.Result.EndedAtEof
                        && outputReader.Result.Win32Error == 0;
                    outcome.StandardError = errorReader.Result.Text;
                    outcome.StderrBytesRead = errorReader.Result.ByteCount;
                    outcome.StderrReadWin32Error = errorReader.Result.Win32Error;
                    outcome.StderrReadSuccess = outcome.StderrReadJoined
                        && errorReader.Result.EndedAtEof
                        && errorReader.Result.Win32Error == 0;
                    return outcome;
                }
                finally
                {
                    ProcessNativeMethods.CloseHandle(processInformation.hThread);
                    ProcessNativeMethods.CloseHandle(processInformation.hProcess);
                }
            }
            finally
            {
                if (attributeList != IntPtr.Zero)
                {
                    ProcessNativeMethods.DeleteProcThreadAttributeList(attributeList);
                    Marshal.FreeHGlobal(attributeList);
                }
                if (handleArray != IntPtr.Zero) { Marshal.FreeHGlobal(handleArray); }
                if (capabilitiesBuffer != IntPtr.Zero) { Marshal.FreeHGlobal(capabilitiesBuffer); }
                if (environmentBlock != IntPtr.Zero) { Marshal.FreeHGlobal(environmentBlock); }
                if (applicationNameBuffer != IntPtr.Zero) { Marshal.FreeHGlobal(applicationNameBuffer); }
                if (commandLineBuffer != IntPtr.Zero) { Marshal.FreeHGlobal(commandLineBuffer); }
                if (stdoutRead != IntPtr.Zero) { ProcessNativeMethods.CloseHandle(stdoutRead); }
                if (stdoutWrite != IntPtr.Zero) { ProcessNativeMethods.CloseHandle(stdoutWrite); }
                if (stderrRead != IntPtr.Zero) { ProcessNativeMethods.CloseHandle(stderrRead); }
                if (stderrWrite != IntPtr.Zero) { ProcessNativeMethods.CloseHandle(stderrWrite); }
                if (stdinRead != IntPtr.Zero) { ProcessNativeMethods.CloseHandle(stdinRead); }
                if (stdinWrite != IntPtr.Zero) { ProcessNativeMethods.CloseHandle(stdinWrite); }
            }
        }

        internal static int CountOutOfScope(HandleScanResult result)
        {
            return HandleScanner.CountOutOfScope(result);
        }

        /// <summary>سطر أوامر مُقتبَس بشكل صحيح: argv[0] ثم الوسائط، كلٌّ بين علامتي اقتباس.</summary>
        internal static string BuildCommandLine(string executable, string[] arguments)
        {
            StringBuilder line = new StringBuilder();
            line.Append(Quote(executable));
            for (int i = 0; i < arguments.Length; i++)
            {
                line.Append(' ').Append(Quote(arguments[i]));
            }
            return line.ToString();
        }

        /// <summary>
        /// اقتباس وسيط واحد بقواعد CommandLineToArgvW: الخطوط المائلة الخلفية
        /// تُضاعف قبل علامة الاقتباس وحدها، لا في كل موضع.
        /// </summary>
        private static string Quote(string argument)
        {
            StringBuilder quoted = new StringBuilder();
            quoted.Append('"');
            int backslashes = 0;
            for (int i = 0; i < argument.Length; i++)
            {
                char current = argument[i];
                if (current == '\\') { backslashes++; continue; }
                if (current == '"')
                {
                    quoted.Append('\\', backslashes * 2 + 1).Append('"');
                    backslashes = 0;
                    continue;
                }
                quoted.Append('\\', backslashes);
                backslashes = 0;
                quoted.Append(current);
            }
            quoted.Append('\\', backslashes * 2);
            quoted.Append('"');
            return quoted.ToString();
        }
    }
}
