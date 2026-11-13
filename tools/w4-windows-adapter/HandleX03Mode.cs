using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using Polaris.ConfinementSpike.Launcher.Native;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// W-11 — انحدار X03 على ويندوز، بدلالات مقابض ويندوز الحقيقية.
    ///
    /// W1 أثبت أن مقبضًا موروثًا يتجاوز حصر نظام الملفات. هذا الوضع يثبت أن مسار
    /// تنفيذ W4 نفسه لا يورّث مقبضًا خارج نطاقه — ويثبت أولًا أن أداة القياس نفسها
    /// قادرة على كشف تسرب حقيقي، وإلا لكان "لم نجد شيئًا" بلا معنى.
    ///
    /// ثلاث حالات:
    ///   POSITIVE_CONTROL  وراثة محيطة بلا قائمة مقابض. يجب أن يجد الابن الكناري ويقرأه،
    ///                     ويجب أن يراه تعداد الوالد أيضًا.
    ///   CLEAN_ADAPTER     نفس الابن، لكن بقائمة مقابض صريحة. يجب ألا يجد شيئًا خارج النطاق.
    ///   CLEAN_EXECUTOR    منفّذ W4 الحقيقي بقائمة صريحة، ويُفحص جدوله وهو معلّق.
    ///
    /// ضابطان لا واحد:
    ///   1) الابن المسرَّب إليه يقرأ الكناري فعلًا  → التسريب حقيقي.
    ///   2) تعداد الوالد يرى ذلك المقبض نفسه        → أداة القياس ترى ما هو موجود.
    /// سقوط أيٍّ منهما يجعل الحكم INCONCLUSIVE: قائمة نظيفة من أداة لم تُثبت أنها ترى
    /// ليست دليل نظافة.
    ///
    /// ولا يُقرأ تعدادٌ لم يثبت اكتماله نظافةً بحال.
    ///
    /// لا يُستعمل منطق واصفات لينكس هنا إطلاقًا.
    /// </summary>
    internal static class HandleX03Mode
    {
        internal static void Run(Options options, JsonWriter json)
        {
            string workspace = options.Get("workspace", "");
            string node = options.Get("node", "");
            string hostScript = options.Get("host-script", "");
            string adapter = Assembly.GetExecutingAssembly().Location;

            json.Property("measurement_started", true);

            string scopeDirectory = Path.Combine(workspace, "scope");
            string outsideDirectory = Path.Combine(workspace, "outside");
            Directory.CreateDirectory(scopeDirectory);
            Directory.CreateDirectory(outsideDirectory);

            string canary = "POLARIS-X03-CANARY-" + Guid.NewGuid().ToString("N");
            string canaryFile = Path.Combine(outsideDirectory, "canary.txt");
            File.WriteAllText(canaryFile, canary);
            string inScopeFile = Path.Combine(scopeDirectory, "in-scope.txt");
            File.WriteAllText(inScopeFile, "in scope content");

            string[] scopeRoots = new string[] { scopeDirectory };
            Dictionary<string, string> environment = GrantBuilder.ExecutionEnvironment(workspace);

            // المقبض المسرَّب عمدًا: مفتوح في الوالد وقابل للتوريث. هذا هو X03 حرفيًا.
            IntPtr leaked = OpenInheritableRead(canaryFile);
            bool leakOpened = leaked != ProcessNativeMethods.INVALID_HANDLE_VALUE && leaked != IntPtr.Zero;

            json.Property("canary_file", canaryFile);
            json.Property("scope_root", scopeDirectory);
            json.Property("leak_handle_opened", leakOpened);
            json.Property("parent_process_id", NativeExtras.GetCurrentProcessId());

            bool controlDetected = false;
            bool controlScanComplete = false;
            bool controlScanSawLeak = false;
            bool controlSourcesDisagree = false;
            bool adapterSourcesDisagree = false;
            bool executorSourcesDisagree = false;
            string controlScanSource = "NONE";
            string executorScanSource = "NONE";
            bool adapterClean = false;
            bool adapterScanComplete = false;
            bool executorClean = false;
            bool executorLaunched = false;
            bool executorScanned = false;
            bool executorScanComplete = false;
            bool executorViolation = false;
            bool measurementCompleted = false;

            try
            {
                ConfinedLauncher launcher = new ConfinedLauncher();

                // 1) الضابط الموجب.
                LaunchSpec control = new LaunchSpec();
                control.ExecutablePath = adapter;
                control.CommandLine = "\"" + adapter + "\" --mode handle-child --canary " + canary + " --scope " + scopeDirectory;
                control.WorkingDirectory = workspace;
                control.Environment = environment;
                control.Inheritance = InheritanceMode.AmbientInheritance;
                control.DeliberateLeak = leaked;
                control.ScopeRoots = scopeRoots;
                control.Canary = canary;
                control.ScanHandlesBeforeResume = true;
                control.EnforceHandleScope = false; // التسريب مقصود هنا: يجب أن يُرى لا أن يُمنع.
                LaunchOutcome controlOutcome = launcher.Launch(control);
                controlDetected = ChildSawCanary(controlOutcome.StandardOutput, canaryFile);
                controlScanComplete = controlOutcome.HandlesAtStart != null
                    && controlOutcome.HandlesAtStart.EnumerationComplete;
                controlScanSawLeak = CountOutOfScope(controlOutcome.HandlesAtStart) > 0;
                controlSourcesDisagree = SourcesDisagree(controlOutcome.HandlesAtStart);
                controlScanSource = SourceOf(controlOutcome.HandlesAtStart);

                json.Name("positive_control").BeginObject();
                json.Property("handle_setup_mode", "AMBIENT_INHERITANCE_NO_HANDLE_LIST");
                json.Property("child_process_id", controlOutcome.ProcessId);
                json.Property("created", controlOutcome.Created);
                json.Property("win32_error", controlOutcome.Win32Error);
                json.Property("failure_stage", controlOutcome.FailureStage);
                json.Property("enforcement_active", false);
                json.Property("child_detected_out_of_scope_handle", controlDetected);
                json.Property("parent_scan_saw_out_of_scope", controlScanSawLeak);
                json.Property("parent_scan_enumeration_complete", controlScanComplete);
                // الضابط الموجب هو ما يثبت أن المعدِّد يرى ما هو موجود. لذلك يُسجَّل
                // بأي واجهة رآه: العامة، أم الاحتياطي الداخلي المعلن.
                json.Property("parent_scan_enumeration_source", controlScanSource);
                json.Property("parent_scan_sources_disagree", controlSourcesDisagree);
                HandleScanner.Emit(json, "parent_scan_handles", controlOutcome.HandlesAtStart);
                json.Property("exit_code", controlOutcome.ExitCode);
                json.Property("timed_out", controlOutcome.TimedOut);
                json.Property("child_report", Trim(controlOutcome.StandardOutput));
                json.EndObject();

                // 2) نفس الابن، بقائمة مقابض صريحة.
                LaunchSpec clean = new LaunchSpec();
                clean.ExecutablePath = adapter;
                clean.CommandLine = "\"" + adapter + "\" --mode handle-child --canary " + canary + " --scope " + scopeDirectory;
                clean.WorkingDirectory = workspace;
                clean.Environment = environment;
                clean.Inheritance = InheritanceMode.ExplicitHandleList;
                clean.DeliberateLeak = leaked;
                clean.ScopeRoots = scopeRoots;
                clean.Canary = canary;
                clean.ScanHandlesBeforeResume = true;
                clean.EnforceHandleScope = false; // الابن يجب أن يعمل ليبلّغ عمّا رآه.
                LaunchOutcome cleanOutcome = launcher.Launch(clean);
                adapterClean = cleanOutcome.Created && !ChildSawCanary(cleanOutcome.StandardOutput, canaryFile);
                adapterScanComplete = cleanOutcome.HandlesAtStart != null
                    && cleanOutcome.HandlesAtStart.EnumerationComplete;
                adapterSourcesDisagree = SourcesDisagree(cleanOutcome.HandlesAtStart);

                json.Name("clean_adapter_child").BeginObject();
                json.Property("handle_setup_mode", "EXPLICIT_HANDLE_LIST");
                json.Property("child_process_id", cleanOutcome.ProcessId);
                json.Property("created", cleanOutcome.Created);
                json.Property("win32_error", cleanOutcome.Win32Error);
                json.Property("enforcement_active", false);
                json.Property("child_detected_out_of_scope_handle", !adapterClean);
                json.Property("parent_scan_out_of_scope_count", CountOutOfScope(cleanOutcome.HandlesAtStart));
                json.Property("parent_scan_enumeration_complete", adapterScanComplete);
                json.Property("parent_scan_enumeration_source", SourceOf(cleanOutcome.HandlesAtStart));
                json.Property("parent_scan_sources_disagree", adapterSourcesDisagree);
                HandleScanner.Emit(json, "parent_scan_handles", cleanOutcome.HandlesAtStart);
                json.Property("exit_code", cleanOutcome.ExitCode);
                json.Property("timed_out", cleanOutcome.TimedOut);
                json.Property("child_report", Trim(cleanOutcome.StandardOutput));
                json.EndObject();

                // 3) منفّذ W4 الحقيقي، بقائمة صريحة، ويُفحص جدوله وهو معلّق.
                if (node.Length > 0 && hostScript.Length > 0 && File.Exists(node) && File.Exists(hostScript))
                {
                    LaunchSpec executor = new LaunchSpec();
                    executor.ExecutablePath = node;
                    executor.CommandLine = "\"" + node + "\" \"" + hostScript + "\"";
                    executor.WorkingDirectory = workspace;
                    executor.Environment = environment;
                    executor.Inheritance = InheritanceMode.ExplicitHandleList;
                    executor.DeliberateLeak = leaked;
                    executor.ScopeRoots = scopeRoots;
                    executor.Canary = canary;
                    // هوية كائن الهدف تُرصد هنا عند المُطلِق نفسه، على مقبض يفتحه مرة
                    // واحدة — نفس المسار الموثوق الذي يستعمله W-12. المنحة هنا ناقلة:
                    // تُشغّل المنفّذ ليُفحص جدول مقابضه، لكنها منحة حقيقية بعقدها الكامل:
                    // لا هوية مخترعة ولا صفرية تُدسّ لإرضاء المُصرّف أو العقد.
                    TargetObjectIdentity inScopeIdentity = TargetObjectIdentity.Of(inScopeFile);
                    executor.StdinPayload = GrantBuilder.ReadGrant(
                        inScopeFile, "T:\\SCOPE\\in-scope.txt", scopeRoots, environment, inScopeIdentity);
                    executor.ScanHandlesBeforeResume = true;
                    executor.ScanHandlesAfterResume = true;
                    executor.EnforceHandleScope = true; // مسار W4 الحقيقي: الفرض لا الوصف.
                    LaunchOutcome executorOutcome = launcher.Launch(executor);
                    executorLaunched = executorOutcome.Created;
                    executorScanned = executorOutcome.HandlesScanned;
                    executorScanComplete = executorOutcome.HandlesAtStart != null
                        && executorOutcome.HandlesAtStart.EnumerationComplete;
                    executorViolation = executorOutcome.HandleScopeViolation;
                    executorSourcesDisagree = executorOutcome.HandleEnumerationSourcesDisagree
                        || SourcesDisagree(executorOutcome.HandlesAtStart);
                    executorScanSource = SourceOf(executorOutcome.HandlesAtStart);
                    int outOfScope = CountOutOfScope(executorOutcome.HandlesAtStart);
                    // نظيف يعني: أُنشئت، وفُحصت فعلًا، وثبت اكتمال الفحص، ولم يوجد
                    // شيء خارج النطاق. قائمة فارغة من تعداد ناقص ليست دليلًا.
                    executorClean = executorLaunched && executorScanned && executorScanComplete && outOfScope == 0;
                    measurementCompleted = true;

                    json.Name("clean_w4_executor").BeginObject();
                    json.Property("handle_setup_mode", "EXPLICIT_HANDLE_LIST");
                    json.Property("child_process_id", executorOutcome.ProcessId);
                    json.Property("created", executorOutcome.Created);
                    json.Property("win32_error", executorOutcome.Win32Error);
                    json.Property("failure_stage", executorOutcome.FailureStage);
                    inScopeIdentity.Emit(json, "executor_read_target_identity");
                    json.Property("enforcement_active", true);
                    json.Property("out_of_scope_handles_at_start", outOfScope);
                    json.Property("handle_scope_violation_enforced", executorOutcome.HandleScopeViolation);
                    json.Property("handle_enumeration_incomplete", executorOutcome.HandleEnumerationIncomplete);
                    json.Property("handle_enumeration_source", executorScanSource);
                    json.Property("handle_enumeration_sources_disagree", executorSourcesDisagree);
                    json.Property("resumed", executorOutcome.Resumed);
                    HandleScanner.Emit(json, "handles_at_start", executorOutcome.HandlesAtStart);
                    HandleScanner.Emit(json, "handles_after_resume", executorOutcome.HandlesAfterResume);
                    json.Property("exit_code", executorOutcome.ExitCode);
                    json.Property("timed_out", executorOutcome.TimedOut);
                    json.Property("executor_output", Trim(executorOutcome.StandardOutput));
                    json.EndObject();
                }
                else
                {
                    json.Name("clean_w4_executor").BeginObject();
                    json.Property("status", "NOT_RUN");
                    json.Property("reason", "node or host-main.js was not provided or does not exist");
                    json.EndObject();
                }
            }
            finally
            {
                if (leakOpened) { ProcessNativeMethods.CloseHandle(leaked); }
            }

            // الحكم. الضابطان شرطان سابقان: بلا كشف تسرّب حقيقي، وبلا تعداد يراه،
            // لا يعني "النظيف" شيئًا.
            string verdict;
            string verdictReason;
            if (!leakOpened)
            {
                verdict = "INCONCLUSIVE";
                verdictReason = "PROBE_SETUP: the deliberate leak handle could not be opened, so the probe cannot prove its own validity";
            }
            else if (!controlDetected)
            {
                verdict = "INCONCLUSIVE";
                verdictReason = "POSITIVE_CONTROL_DID_NOT_DETECT: the scan failed to see a leak that was deliberately created; finding nothing elsewhere proves nothing";
            }
            else if (controlSourcesDisagree)
            {
                verdict = "INCONCLUSIVE";
                verdictReason = HandleScanner.ReasonSourcesDisagree
                    + ": the public and internal enumerations reported different handle tables for the same suspended positive control, so the measurement tool contradicts itself";
            }
            else if (!controlScanComplete)
            {
                verdict = "INCONCLUSIVE";
                verdictReason = "CONTROL_ENUMERATION_INCOMPLETE: the handle table of the positive control could not be enumerated completely, so the enumerator itself is unproven";
            }
            else if (!controlScanSawLeak)
            {
                verdict = "INCONCLUSIVE";
                verdictReason = "PARENT_SCAN_MISSED_KNOWN_LEAK: the child read the canary through an inherited handle the parent enumeration did not report; the measurement tool does not see what is there";
            }
            else if (!adapterClean)
            {
                verdict = "FAIL";
                verdictReason = "CLEAN_ADAPTER_LEAKED: an out-of-scope handle reached a child launched with an explicit handle list";
            }
            else if (adapterSourcesDisagree)
            {
                verdict = "INCONCLUSIVE";
                verdictReason = HandleScanner.ReasonSourcesDisagree
                    + ": the public and internal enumerations disagreed on the explicit-handle-list child's suspended handle table";
            }
            else if (!adapterScanComplete)
            {
                verdict = "INCONCLUSIVE";
                verdictReason = "CLEAN_ADAPTER_ENUMERATION_INCOMPLETE: the explicit-handle-list child looked clean, but its handle table was not enumerated completely";
            }
            else if (!executorLaunched)
            {
                verdict = "INCONCLUSIVE";
                verdictReason = "EXECUTOR_NOT_LAUNCHED: the real W4 executor was not started, so its handle table was never examined";
            }
            else if (!executorScanned)
            {
                verdict = "INCONCLUSIVE";
                verdictReason = "EXECUTOR_NOT_SCANNED: the executor started but its handle table was not scanned; an empty list is not evidence";
            }
            else if (executorSourcesDisagree)
            {
                verdict = "INCONCLUSIVE";
                verdictReason = HandleScanner.ReasonSourcesDisagree
                    + ": the public and internal enumerations disagreed on the real W4 executor's suspended handle table; a clean list from a self-contradicting measurement is not a clean table";
            }
            else if (!executorScanComplete)
            {
                verdict = "INCONCLUSIVE";
                verdictReason = "EXECUTOR_ENUMERATION_INCOMPLETE: the executor's handle table was scanned but the enumeration did not prove itself complete; a clean list from an incomplete measurement is not a clean table";
            }
            else if (executorViolation)
            {
                verdict = "FAIL";
                verdictReason = "WINDOWS_HANDLE_SCOPE_VIOLATION: the real W4 executor started with an out-of-scope handle; the launcher refused to resume it";
            }
            else if (!executorClean)
            {
                verdict = "FAIL";
                verdictReason = "EXECUTOR_LEAKED: the real W4 executor's handle table carried an out-of-scope entry at creation";
            }
            else
            {
                verdict = "PASS";
                verdictReason = "POSITIVE_CONTROL_DETECTED_AND_BOTH_CLEAN_PATHS_HELD_UNDER_A_COMPLETE_ENUMERATION";
            }

            // مصدر التعداد المستعمل فعلًا، على مستوى المسبار كله. المسار الاحتياطي
            // الداخلي مسموح ومعلن — لكنه لا يمرّ صامتًا في الدليل بحال.
            json.Property("handle_enumeration_primary_api", "PSS_WALK_HANDLES");
            json.Property("handle_enumeration_primary_api_class", "PUBLIC_DOCUMENTED_KERNEL32");
            json.Property("handle_enumeration_fallback_api", "NT_PROCESS_HANDLE_SNAPSHOT");
            json.Property("handle_enumeration_fallback_api_class", "INTERNAL_UNDOCUMENTED");
            json.Property("positive_control_enumeration_source", controlScanSource);
            json.Property("executor_enumeration_source", executorScanSource);
            json.Property("measurement_completed", measurementCompleted);
            json.Property("evidence_complete", measurementCompleted && verdict != "BLOCKED");
            json.Property("verdict", verdict);
            json.Property("verdict_reason", verdictReason);
            json.Property("reason_code", ReasonCode(verdictReason));
            json.Property("evidence_reference", "evidence/w4-windows-x03.json");
            json.Property(
                "interpretation",
                verdict == "PASS"
                    ? "A deliberately leaked inheritable handle WAS detected under ambient inheritance - by the child and by a complete parent enumeration of the handle table - and was NOT present once an explicit handle list was used, for the adapter child and for the real W4 executor."
                    : verdict == "INCONCLUSIVE"
                        ? "The probe could not establish its own validity or the completeness of its measurement. No hygiene claim follows."
                        : "An out-of-scope handle reached a child launched with an explicit handle list. This is the X03 defect.");
        }

        private static string ReasonCode(string verdictReason)
        {
            int separator = verdictReason.IndexOf(':');
            return separator > 0 ? verdictReason.Substring(0, separator) : verdictReason;
        }

        private static IntPtr OpenInheritableRead(string path)
        {
            ProcessNativeMethods.SECURITY_ATTRIBUTES attributes = new ProcessNativeMethods.SECURITY_ATTRIBUTES();
            attributes.nLength = System.Runtime.InteropServices.Marshal.SizeOf(typeof(ProcessNativeMethods.SECURITY_ATTRIBUTES));
            attributes.lpSecurityDescriptor = IntPtr.Zero;
            attributes.bInheritHandle = true;
            return ProcessNativeMethods.CreateFileW(
                path, ProcessNativeMethods.GENERIC_READ,
                ProcessNativeMethods.FILE_SHARE_READ | ProcessNativeMethods.FILE_SHARE_WRITE,
                ref attributes, ProcessNativeMethods.OPEN_EXISTING,
                ProcessNativeMethods.FILE_ATTRIBUTE_NORMAL, IntPtr.Zero);
        }

        private static bool ChildSawCanary(string report, string canaryFile)
        {
            if (string.IsNullOrEmpty(report)) { return false; }
            string needle = Path.GetFileName(canaryFile);
            return report.IndexOf("\"canary_readable\":true", StringComparison.Ordinal) >= 0
                && report.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        private static int CountOutOfScope(HandleScanResult result)
        {
            return HandleScanner.CountOutOfScope(result);
        }

        /// <summary>مصدر التعداد كما جرى فعلًا. يُخرَج دائمًا، فالمسار الاحتياطي معلن لا صامت.</summary>
        private static string SourceOf(HandleScanResult result)
        {
            return result == null ? "NONE" : result.EnumerationSource;
        }

        private static bool SourcesDisagree(HandleScanResult result)
        {
            return result != null
                && result.IncompleteReasonCode == HandleScanner.ReasonSourcesDisagree;
        }

        private static string Trim(string text)
        {
            if (text == null) { return ""; }
            return text.Length > 4000 ? text.Substring(0, 4000) : text;
        }
    }
}
