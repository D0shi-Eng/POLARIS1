using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Polaris.ConfinementSpike.Launcher.Native;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// W-12 — تكامل W4 مع AppContainer + Job Object.
    ///
    /// W1 أثبت الآلية. هذا الوضع يثبت شيئًا آخر ولا يغني عنه: أن مسار تنفيذ W4
    /// الحقيقي — منفّذ الأثر نفسه — يُطلَق تحت تلك الدلالات ويظل يعمل، وأن ما هو
    /// خارج النطاق يبقى مرفوضًا، وألا يبقى ناجٍ بعد الهدم، وألا يبقى أثر بعد التنظيف.
    ///
    /// ويثبت أمرين منفصلين لا يُخلطان:
    ///   (أ) نقطة الفرض في POLARIS ترفض العملية خارج النطاق بالسبب المنطقي الصحيح.
    ///   (ب) حدّ AppContainer نفسه لا يملك ACL يمنح المورد الممنوع.
    /// الأول ادّعاء عن الـPEP، والثاني ادّعاء عن الحصر. إثبات أحدهما ليس إثباتًا للآخر.
    ///
    /// آلة الحالة إلزامية، والحكم لا يُحسب قبل اكتمالها:
    ///   EXECUTION → TEARDOWN → CLEANUP VERIFICATION → FINAL VERDICT
    /// تشغيل ينجح تنفيذيًا ثم يفشل في إزالة منح ACL أو ملف تعريف أو شجرة مؤقتة
    /// ليس تشغيلًا ناجحًا.
    /// </summary>
    internal static class ConfinedExecMode
    {
        // تصنيف المراحل. يُذكر في الدليل حتى يكون العائق قابلًا للإصلاح مباشرة.
        internal const string StageProfileCreate = "PROFILE_CREATE";
        internal const string StageProfileReclaim = "PROFILE_RECLAIM";
        internal const string StageMissionFixtures = "MISSION_FIXTURES";
        internal const string StageRuntimeCodeStaging = "RUNTIME_CODE_STAGING";
        internal const string StageControlCodeStaging = "ACL_CONTROL_STAGING";
        internal const string StageAclGrant = "ACL_GRANT";
        internal const string StageAclInspection = "ACL_INSPECTION";
        internal const string StageJobCreate = "JOB_CREATE";
        internal const string StageEnvironmentCalibration = "ENVIRONMENT_CALIBRATION";
        internal const string StageEnvironmentBlock = "ENVIRONMENT_BLOCK_CONSTRUCTION";
        internal const string StageLaunchInputVerification = "LAUNCH_INPUT_VERIFICATION";
        internal const string StageCreateProcessSuspended = "CREATE_PROCESS_SUSPENDED";
        internal const string StageHandleValidation = "HANDLE_VALIDATION";
        internal const string StageJobAssign = "JOB_ASSIGN";
        internal const string StageRuntimeStartup = "RUNTIME_STARTUP";
        internal const string StageProtocolHandshake = "PROTOCOL_HANDSHAKE";
        internal const string StageAclControlStartup = "ACL_CONTROL_STARTUP";
        internal const string StageTeardown = "TEARDOWN";
        internal const string StageCleanupVerification = "CLEANUP_VERIFICATION";

        internal const string SourceNone = "NONE";
        internal const string SourceWin32 = "WIN32_API";
        internal const string SourceChildExit = "CHILD_EXIT_CODE";

        private const string PhaseExecution = "EXECUTION";
        private const string PhaseTeardown = "TEARDOWN";
        private const string PhaseCleanup = "CLEANUP_VERIFICATION";
        private const string PhaseFinal = "FINAL_VERDICT";

        /// <summary>نتيجة مرحلة التنفيذ وحدها. الحكم النهائي يُحسب بعد التنظيف.</summary>
        private sealed class ExecutionResult
        {
            public string Verdict = "INCONCLUSIVE";
            public string ReasonCode = "EXECUTION_NOT_REACHED";
            public string Stage = "";
            public string Detail = "";
            /// <summary>خطأ واجهة Win32 وحده. صفر لا يعني نجاحًا: انظر FailureValueSource.</summary>
            public int Win32Error;
            /// <summary>رمز خروج العملية الابن. ليس خطأ Win32 ولا يُروى مكانه.</summary>
            public int ChildExitCode;
            /// <summary>مصدر الرقم المُبلَّغ: NONE أو WIN32_API أو CHILD_EXIT_CODE.</summary>
            public string FailureValueSource = SourceNone;
            public bool Completed;
            public int PermittedProcessId;
            public int DeniedProcessId;
            public int ControlProcessId;
        }

        internal static void Run(Options options, JsonWriter json)
        {
            string workspace = options.Get("workspace", "");
            string node = options.Get("node", "");
            string hostScript = options.Get("host-script", "");
            string runtimeDist = options.Get("runtime-dist", "");

            json.Property("state_machine", "EXECUTION -> TEARDOWN -> CLEANUP_VERIFICATION -> FINAL_VERDICT");
            json.Property("measurement_started", true);
            json.Property("app_container_name", "polaris-w4-exec");

            MissionFixtures fixtures = new MissionFixtures();
            AppContainerScope container = new AppContainerScope("polaris-w4-exec");
            JobScope job = new JobScope();
            RuntimeCodeStaging staging = new RuntimeCodeStaging();
            AclControlProbe control = new AclControlProbe();
            // بنية التشغيل التحتية تُخطَّط قبل التنفيذ حتى يمكن هدمها والتحقق من
            // هدمها حتى لو انهار التنفيذ في أول مرحلة.
            ExecutionEnvironmentPlan environmentPlan = ExecutionEnvironmentPlan.Create(workspace);

            ExecutionResult execution;
            json.Property("phase_at_start", PhaseExecution);
            try
            {
                execution = Execute(json, workspace, node, hostScript, runtimeDist,
                    fixtures, container, job, staging, control, environmentPlan);
            }
            catch (Exception error)
            {
                execution = new ExecutionResult();
                execution.Verdict = "INCONCLUSIVE";
                execution.ReasonCode = "EXECUTION_THREW";
                execution.Stage = PhaseExecution;
                execution.Detail = error.GetType().Name + ": " + error.Message;
            }

            // ── TEARDOWN ────────────────────────────────────────────────────────
            // الـJob يُغلق أولًا: بـKILL_ON_JOB_CLOSE يموت كل ما بداخله، ولا يمكن
            // حذف كود التشغيل المُدرَّج قبل أن تُغلق العمليات التي تقرأه.
            List<int> insideJobBeforeClose = job.LiveProcessIds();
            job.Dispose();
            bool jobClosed = true;
            System.Threading.Thread.Sleep(500);

            List<int> survivors = new List<int>();
            if (execution.PermittedProcessId != 0 && ProcessAliveness.IsAlive(execution.PermittedProcessId, "node"))
            {
                survivors.Add(execution.PermittedProcessId);
            }
            if (execution.DeniedProcessId != 0 && ProcessAliveness.IsAlive(execution.DeniedProcessId, "node"))
            {
                survivors.Add(execution.DeniedProcessId);
            }
            if (execution.ControlProcessId != 0 && ProcessAliveness.IsAlive(execution.ControlProcessId, "node"))
            {
                survivors.Add(execution.ControlProcessId);
            }

            json.Name("teardown").BeginObject();
            json.Property("phase", PhaseTeardown);
            json.Property("processes_in_job_before_close", insideJobBeforeClose.Count);
            json.Property("job_closed", jobClosed);
            json.Name("surviving_processes").BeginArray();
            foreach (int pid in survivors) { json.Value(pid); }
            json.EndArray();
            json.EndObject();

            // ── CLEANUP ─────────────────────────────────────────────────────────
            ContainerCleanupResult containerCleanup = container.Cleanup();
            bool missionRemoved = fixtures.Remove();
            bool controlRemoved = control.Remove();
            bool runtimeCodeRemoved = staging.Remove();
            bool runtimeScopesRemoved = environmentPlan.RemoveDirectories();
            container.Dispose();

            json.Name("cleanup").BeginObject();
            json.Property("phase", PhaseCleanup);
            AppContainerScope.EmitCleanup(json, containerCleanup);
            json.Property("runtime_code_cleanup_success", runtimeCodeRemoved);
            json.Property("control_code_cleanup_success", controlRemoved);
            json.Property("mission_fixture_cleanup_success", missionRemoved);
            json.Property("runtime_infrastructure_cleanup_success", runtimeScopesRemoved);
            json.Property("job_closed", jobClosed);
            json.Name("surviving_processes").BeginArray();
            foreach (int pid in survivors) { json.Value(pid); }
            json.EndArray();
            json.EndObject();

            bool cleanupClean = containerCleanup.AclRestoreSuccess
                && containerCleanup.AclRestoreFailures.Count == 0
                && containerCleanup.ResidualContainerAces.Count == 0
                && containerCleanup.ProfileDeleteSuccess
                && runtimeCodeRemoved && controlRemoved && missionRemoved && runtimeScopesRemoved
                && jobClosed && survivors.Count == 0;

            // ── FINAL VERDICT ───────────────────────────────────────────────────
            string verdict = execution.Verdict;
            string reason = execution.ReasonCode;
            string stage = execution.Stage;
            string detail = execution.Detail;

            if (survivors.Count > 0)
            {
                verdict = "FAIL";
                reason = "SURVIVOR_AFTER_JOB_CLOSE";
                stage = StageTeardown;
                detail = "a confined child outlived the Job object";
            }
            else if (verdict == "PASS" && !cleanupClean)
            {
                // التنفيذ صحيح والتنظيف ليس كذلك. لا يجوز أن يُقرأ ذلك نجاحًا:
                // منح ACL باقٍ أو ملف تعريف باقٍ أو شجرة مؤقتة باقية أثرٌ أمني.
                verdict = "FAIL";
                reason = CleanupReason(containerCleanup, runtimeCodeRemoved, controlRemoved,
                    missionRemoved, runtimeScopesRemoved);
                stage = StageCleanupVerification;
                detail = "execution semantics held, but the security cleanup did not complete; see the cleanup block";
            }

            json.Property("phase", PhaseFinal);
            json.Property("cleanup_clean", cleanupClean);
            json.Property("measurement_completed", execution.Completed);
            json.Property("evidence_complete", execution.Completed && verdict != "BLOCKED");
            json.Property("verdict", verdict);
            json.Property("verdict_reason", reason);
            json.Property("reason_code", reason);
            json.Property("blocked_stage", stage);
            json.Property("blocked_reason", detail);
            json.Property("win32_error", execution.Win32Error);
            json.Property("child_exit_code", execution.ChildExitCode);
            json.Property("failure_value_source", execution.FailureValueSource);
            json.Property(
                "failure_value_note",
                "win32_error is a Win32 API error and nothing else; a non-zero exit status of the confined child"
                + " is reported as child_exit_code. failure_value_source names which of the two — if either —"
                + " carries the reported failure, so the two are never read as one number.");
            json.Property("evidence_reference", "evidence/w4-windows-confined-exec.json");
            json.Property(
                "interpretation",
                verdict == "PASS"
                    ? "The real W4 executor ran inside a zero-capability AppContainer, inside a kill-on-close Job, with an explicit handle list, a completely enumerated handle table and a constructed environment. The PEP refused the out-of-scope read for the correct logical reason, the OS boundary itself refused the denied fixture while a byte-identical granted fixture was readable, no child outlived the Job, and every ACL grant, profile and temporary tree was removed and verified."
                    : verdict == "BLOCKED"
                        ? "The integration could not be established. This is recorded as BLOCKED with its technical stage and cause. It is NOT a pass, is NOT a skip, and W1's mechanism result does not substitute for it."
                        : verdict == "INCONCLUSIVE"
                            ? "The probe could not establish the validity or completeness of its own measurement. No confinement claim follows."
                            : "The W4 execution path did not satisfy every confinement requirement. See reason_code and the blocks above for which one failed.");
        }

        private static string CleanupReason(
            ContainerCleanupResult cleanup, bool runtimeCodeRemoved, bool controlRemoved,
            bool missionRemoved, bool runtimeScopesRemoved)
        {
            if (cleanup.ResidualContainerAces.Count > 0) { return "CLEANUP_RESIDUAL_ACL_GRANT"; }
            if (!cleanup.AclRestoreSuccess || cleanup.AclRestoreFailures.Count > 0) { return "CLEANUP_ACL_RESTORE_FAILED"; }
            if (!cleanup.ProfileDeleteSuccess) { return "CLEANUP_PROFILE_DELETE_FAILED"; }
            if (!runtimeCodeRemoved) { return "CLEANUP_RUNTIME_CODE_NOT_REMOVED"; }
            if (!controlRemoved) { return "CLEANUP_CONTROL_CODE_NOT_REMOVED"; }
            if (!missionRemoved) { return "CLEANUP_MISSION_FIXTURE_NOT_REMOVED"; }
            if (!runtimeScopesRemoved) { return "CLEANUP_RUNTIME_INFRASTRUCTURE_NOT_REMOVED"; }
            return "CLEANUP_NOT_VERIFIED";
        }

        private static ExecutionResult Execute(
            JsonWriter json, string workspace, string node, string hostScript, string runtimeDist,
            MissionFixtures fixtures, AppContainerScope container, JobScope job,
            RuntimeCodeStaging staging, AclControlProbe control, ExecutionEnvironmentPlan environmentPlan)
        {
            ExecutionResult result = new ExecutionResult();

            // ── المرحلة 1: ملف التعريف ─────────────────────────────────────────
            bool profileReady = container.Create();
            container.EmitProfile(json);
            if (!profileReady)
            {
                result.Verdict = "BLOCKED";
                result.Win32Error = container.LastError;
                result.FailureValueSource = SourceWin32;
                if (container.StaleReclaimFailed)
                {
                    result.ReasonCode = "STALE_PROFILE_NOT_RECLAIMED";
                    result.Stage = StageProfileReclaim;
                    result.Detail =
                        "an AppContainer profile named polaris-w4-exec survived an earlier run and could not be deleted (HRESULT 0x"
                        + container.StaleDeleteHResult.ToString("x8")
                        + "). POLARIS does not own its lifecycle, so it is neither reused as if it were clean nor deleted. "
                        + "Remove it and run again; measuring confinement in a dirty environment would pass for the wrong reason.";
                }
                else
                {
                    result.ReasonCode = "APP_CONTAINER_PROFILE_UNAVAILABLE";
                    result.Stage = StageProfileCreate;
                    result.Detail = "CreateAppContainerProfile failed with 0x" + container.LastError.ToString("x8")
                        + " (" + container.FailureStage + ")";
                }
                return result;
            }
            json.Property("capability_count", 0);
            json.Property("internet_client_requested", false);
            json.Property("private_network_requested", false);

            // ── المرحلة 2: عيّنات المهمة، كل صنف نطاق في مجلد مستقل ────────────
            fixtures.Create(workspace);
            fixtures.Emit(json);
            string[] scopeRoots = new string[] { fixtures.AllowedDirectory };

            // ── المرحلة 2ب: بنية التشغيل التحتية، مفصولة عن موارد المهمة ───────
            // TEMP وملف التعريف ليسا موردَي مهمة. لهما مجلدان مستقلان داخل مساحة
            // العمل، ولا يشيران إلى ملف تعريف المستخدم الحقيقي بحال.
            environmentPlan.CreateDirectories();
            environmentPlan.EmitScopes(json);

            // ── المرحلة 3: تدريج نطاق كود التشغيل ──────────────────────────────
            // لا يُمنح ACL على مسارات النظام ولا على شجرة المستودع: كلاهما إما
            // يتطلب مديرًا أو يترك أثرًا خارج مساحة العمل.
            if (!staging.Stage(workspace, node, hostScript, runtimeDist))
            {
                staging.Emit(json);
                result.Verdict = "BLOCKED";
                result.ReasonCode = staging.FailureReasonCode.Length > 0
                    ? staging.FailureReasonCode
                    : RuntimeCodeStaging.ReasonNotStaged;
                result.Stage = staging.FailureStage;
                result.Detail = staging.FailureDetail;
                return result;
            }
            staging.Emit(json);

            // ── المرحلة 3ب: نطاق كود التشغيل خالٍ من نقاط إعادة التحليل ────────
            // قبل منح أي ACL وقبل إطلاق أي عملية: شجرةٌ نظيفة البايتات قد تكون
            // مع ذلك بابًا إلى خارج النطاق إن حوت رابطًا أو junction. المجموعة
            // المسموحة صفر، وتعذّر إثبات النظافة لا يمرّ مرور النظافة.
            ReparseScan reparse = new ReparseScan();
            bool reparseClean = reparse.Scan(staging.Root);
            reparse.Emit(json);
            if (!reparseClean)
            {
                result.Verdict = reparse.Incomplete ? "INCONCLUSIVE" : "BLOCKED";
                result.ReasonCode = reparse.Incomplete ? ReparseScan.ReasonIncomplete : ReparseScan.ReasonPresent;
                result.Stage = StageRuntimeCodeStaging;
                result.Detail = reparse.Incomplete
                    ? "the runtime-code scope could not be proven free of reparse points: " + reparse.IncompleteReason
                    : "the runtime-code scope contains "
                        + reparse.ReparseCount.ToString(System.Globalization.CultureInfo.InvariantCulture)
                        + " reparse point(s); W4 allows none, because staged bytes prove nothing about where a link leads."
                        + " See runtime_code_reparse_scan.findings.";
                return result;
            }

            string confinedNode = staging.NodePath;
            string confinedHost = staging.HostScriptPath;

            // ── المرحلة 4: تدريج ضابط الـACL ───────────────────────────────────
            List<AclControlTarget> controlTargets = new List<AclControlTarget>();
            controlTargets.Add(new AclControlTarget(
                MissionFixtures.ScopeAllowedResource, AclControlProbe.ExpectedReadable, fixtures.AllowedFile));
            controlTargets.Add(new AclControlTarget(
                MissionFixtures.ScopePositiveControlResource, AclControlProbe.ExpectedReadable, fixtures.PositiveControlFile));
            controlTargets.Add(new AclControlTarget(
                MissionFixtures.ScopeDeniedControlResource, AclControlProbe.ExpectedDenied, fixtures.DeniedFile));
            if (!control.Stage(workspace, controlTargets))
            {
                result.Verdict = "BLOCKED";
                result.ReasonCode = "ACL_CONTROL_NOT_STAGED";
                result.Stage = StageControlCodeStaging;
                result.Detail = control.FailureDetail;
                return result;
            }

            // ── المرحلة 5: المنح الصريح، مصنَّفًا بنطاقه وشكل وراثته ────────────
            // جذر المهمة يُمنح اجتيازًا فقط وبلا وراثة، فلا يرث المورد الممنوع شيئًا.
            List<string> grantFailures = new List<string>();
            if (!container.GrantTraverseOnly(workspace, "WORKSPACE_ROOT_TRAVERSAL"))
            {
                grantFailures.Add("WORKSPACE_ROOT_TRAVERSAL:" + workspace);
            }
            if (!container.GrantReadExecuteTree(staging.Root, MissionFixtures.ScopeRuntimeCode))
            {
                grantFailures.Add(MissionFixtures.ScopeRuntimeCode + ":" + staging.Root);
            }
            if (!container.GrantReadExecuteTree(control.Root, MissionFixtures.ScopeControlCode))
            {
                grantFailures.Add(MissionFixtures.ScopeControlCode + ":" + control.Root);
            }
            if (!container.GrantTraverseOnly(fixtures.Root, MissionFixtures.ScopeControlRoot))
            {
                grantFailures.Add(MissionFixtures.ScopeControlRoot + ":" + fixtures.Root);
            }
            if (!container.GrantModifyTree(fixtures.AllowedDirectory, MissionFixtures.ScopeAllowedResource))
            {
                grantFailures.Add(MissionFixtures.ScopeAllowedResource + ":" + fixtures.AllowedDirectory);
            }
            if (!container.GrantReadExecuteTree(fixtures.PositiveControlDirectory, MissionFixtures.ScopePositiveControlResource))
            {
                grantFailures.Add(MissionFixtures.ScopePositiveControlResource + ":" + fixtures.PositiveControlDirectory);
            }
            if (!container.GrantModifyTree(fixtures.WorkDirectory, MissionFixtures.ScopeWork))
            {
                grantFailures.Add(MissionFixtures.ScopeWork + ":" + fixtures.WorkDirectory);
            }
            // بنية التشغيل التحتية: أقل حق يكفي، وداخل مساحة العمل وحدها.
            if (!container.GrantModifyTree(
                    environmentPlan.RuntimeTempDirectory, ExecutionEnvironmentPlan.ScopeRuntimeTemp))
            {
                grantFailures.Add(
                    ExecutionEnvironmentPlan.ScopeRuntimeTemp + ":" + environmentPlan.RuntimeTempDirectory);
            }
            if (!container.GrantModifyTree(
                    environmentPlan.RuntimeProfileDirectory, ExecutionEnvironmentPlan.ScopeRuntimeProfile))
            {
                grantFailures.Add(
                    ExecutionEnvironmentPlan.ScopeRuntimeProfile + ":" + environmentPlan.RuntimeProfileDirectory);
            }
            // المورد الممنوع لا يُمنح، ولا يُذكر في أي استدعاء منح. هذا سطر مقصود.

            container.EmitGrants(json);
            json.Property("acl_grant_failures", grantFailures);
            if (grantFailures.Count > 0)
            {
                result.Verdict = "BLOCKED";
                result.ReasonCode = "ACL_GRANT_FAILED";
                result.Stage = StageAclGrant;
                result.Detail = "the AppContainer SID could not be granted access to "
                    + string.Join(", ", grantFailures.ToArray()) + " (" + container.FailureStage + ")";
                return result;
            }

            // ── المرحلة 6: الـACL الفعلي، لا المقصود ───────────────────────────
            List<AclInspector.AclDescription> effective = new List<AclInspector.AclDescription>();
            effective.Add(AclInspector.Describe(staging.Root, MissionFixtures.ScopeRuntimeCode, container.SidString));
            effective.Add(AclInspector.Describe(control.Root, MissionFixtures.ScopeControlCode, container.SidString));
            effective.Add(AclInspector.Describe(fixtures.Root, MissionFixtures.ScopeControlRoot, container.SidString));
            effective.Add(AclInspector.Describe(fixtures.AllowedDirectory, MissionFixtures.ScopeAllowedResource, container.SidString));
            effective.Add(AclInspector.Describe(fixtures.AllowedFile, MissionFixtures.ScopeAllowedResource, container.SidString));
            effective.Add(AclInspector.Describe(fixtures.PositiveControlDirectory, MissionFixtures.ScopePositiveControlResource, container.SidString));
            effective.Add(AclInspector.Describe(fixtures.PositiveControlFile, MissionFixtures.ScopePositiveControlResource, container.SidString));
            AclInspector.AclDescription deniedDirectory =
                AclInspector.Describe(fixtures.DeniedDirectory, MissionFixtures.ScopeDeniedControlResource, container.SidString);
            AclInspector.AclDescription deniedFile =
                AclInspector.Describe(fixtures.DeniedFile, MissionFixtures.ScopeDeniedControlResource, container.SidString);
            effective.Add(deniedDirectory);
            effective.Add(deniedFile);
            AclInspector.Emit(json, "effective_acl", effective);

            bool deniedBoundaryClean =
                !AclInspector.ContainerCanReach(deniedDirectory) && !AclInspector.ContainerCanReach(deniedFile);
            json.Property("denied_resource_boundary_clean", deniedBoundaryClean);
            if (!deniedBoundaryClean)
            {
                result.Verdict = "FAIL";
                result.ReasonCode = "DENIED_RESOURCE_HAS_CONTAINER_ACE";
                result.Stage = StageAclInspection;
                result.Completed = true;
                result.Detail =
                    "the denied control resource carries an allow entry the AppContainer can use"
                    + (deniedDirectory.ContainerAceInherited || deniedFile.ContainerAceInherited
                        ? " (inherited - a parent directory grants it)" : " (explicit)")
                    + ". A refusal measured against this fixture would be a PEP refusal only, not a filesystem confinement result.";
                return result;
            }

            // ── المرحلة 7: الـJob ──────────────────────────────────────────────
            if (!job.Create("polaris-w4-exec-job"))
            {
                result.Verdict = "BLOCKED";
                result.ReasonCode = "JOB_UNAVAILABLE";
                result.Stage = StageJobCreate;
                result.Win32Error = job.LastError;
                result.FailureValueSource = SourceWin32;
                result.Detail = "CreateJobObjectW/SetInformationJobObject failed at " + job.FailureStage;
                return result;
            }
            json.Property("job_kill_on_close", true);
            json.Property("job_breakaway_allowed", false);

            ConfinedLauncher launcher = new ConfinedLauncher();

            // ── المرحلة 7ب: مصفوفة تشخيص الإطلاق ومعايرة البيئة ────────────────
            // تُشغَّل قبل أي قياس أمني، وكل محاولاتها إنشاء معلّق يليه إنهاء فوري.
            // فائدتها مزدوجة: تُبقي في الدليل خط أساس للمقارنة حتى حين ينجح
            // الإطلاق، وتشتقّ البيئة الإنتاجية اشتقاقًا تجريبيًا بدل ادّعائها.
            LaunchContext launchContext = new LaunchContext();
            launchContext.Executable = confinedNode;
            launchContext.HostScript = confinedHost;
            launchContext.WorkingDirectory = fixtures.WorkDirectory;
            launchContext.AppContainerSid = container.Sid;
            launchContext.JobHandle = job.Handle;
            launchContext.ScopeRoots = scopeRoots;

            List<LaunchAttemptRecord> matrix =
                LaunchDiagnostics.RunMatrix(launcher, launchContext, environmentPlan);
            LaunchDiagnostics.EmitAttempts(json, "create_process_diagnostic_matrix", matrix);
            json.Property(
                "diagnostic_matrix_note",
                "every variant above is a create-only launch that is terminated before it executes an instruction. A variant that removes a constraint isolates a cause and is never evidence of W-12 confinement, and never the production launch configuration.");

            EnvironmentCalibration calibration =
                LaunchDiagnostics.Calibrate(launcher, launchContext, environmentPlan);
            LaunchDiagnostics.EmitCalibration(json, calibration);
            environmentPlan.Emit(json, "environment_contract_base", environmentPlan.BaseVariables);
            environmentPlan.Emit(json, "environment_candidate_space", environmentPlan.Candidates);

            if (!calibration.Success)
            {
                result.Verdict = "BLOCKED";
                result.ReasonCode = calibration.ReasonCode;
                result.Stage = StageEnvironmentCalibration;
                result.Win32Error = calibration.BaselineWin32Error;
                result.FailureValueSource = SourceWin32;
                result.Detail = calibration.Detail;
                return result;
            }

            // الضابط السببي يُشغَّل على البيئة المعايَرة نفسها: نزع الاسم يعيد
            // الفشل، وإعادته تعيد النجاح. إضافة بلا هذا الزوج مصادفة لا علّة.
            LaunchDiagnostics.EmitCausality(json, launcher, launchContext, calibration);

            Dictionary<string, string> environment = calibration.Environment;
            environmentPlan.Emit(json, "environment_production_additions", calibration.Additions);
            List<string> productionNames = new List<string>(environment.Keys);
            productionNames.Sort(StringComparer.OrdinalIgnoreCase);
            json.Property("production_environment_names", productionNames);
            json.Property("production_environment_inherits_parent", false);

            // ── المرحلة 8: المسار المسموح، عبر منفّذ W4 الحقيقي ────────────────
            LaunchSpec allowed = NewSpec(confinedNode, confinedHost,
                fixtures.WorkDirectory, environment, container, job, scopeRoots);
            allowed.ScanHandlesAfterResume = true;
            // هوية كائن الهدف تُرصد هنا، خارج الحاوية، على مقبض يفتحه المُطلِق مرة
            // واحدة. المنفّذ لا يعيد حلّ الاسم؛ يطابق هذه الهوية على مقبضه هو.
            TargetObjectIdentity allowedIdentity = TargetObjectIdentity.Of(fixtures.AllowedFile);
            allowedIdentity.Emit(json, "permitted_read_target_identity");
            allowed.StdinPayload = GrantBuilder.ReadGrant(
                fixtures.AllowedFile, "T:\\SCOPE\\in-scope.txt", scopeRoots, environment, allowedIdentity);

            // العقد يُفرض قبل الكتابة: حمولة لا تطابق مدخل المنفّذ عيب بروتوكول
            // يُسمّى باسمه، لا صمتٌ يُقرأ لاحقًا إخفاقَ حصر.
            ProtocolPayloadContract allowedPayload = new ProtocolPayloadContract();
            bool allowedPayloadValid = allowedPayload.Validate(allowed.StdinPayload);
            allowedPayload.Emit(json, "permitted_read_payload");
            if (!allowedPayloadValid)
            {
                result.Verdict = "BLOCKED";
                result.ReasonCode = allowedPayload.ReasonCode;
                result.Stage = StageProtocolHandshake;
                result.FailureValueSource = SourceNone;
                result.Detail =
                    "the execution grant the adapter built does not satisfy the real executor's input contract,"
                    + " so nothing was written to the executor's standard input. The redacted structure and every"
                    + " violation are recorded under permitted_read_payload. This is a protocol defect in the"
                    + " launcher, not an AppContainer result.";
                return result;
            }
            LaunchOutcome allowedOutcome = launcher.Launch(allowed);
            result.PermittedProcessId = allowedOutcome.ProcessId;

            json.Name("permitted_read").BeginObject();
            EmitLaunch(json, allowedOutcome);
            json.EndObject();

            if (!allowedOutcome.Created)
            {
                result.Verdict = "BLOCKED";
                result.Win32Error = allowedOutcome.Win32Error;
                result.FailureValueSource = SourceWin32;
                if (allowedOutcome.FailureStage == ConfinedLauncher.StageInputMissing)
                {
                    result.ReasonCode = "LAUNCH_INPUT_MISSING";
                    result.Stage = StageLaunchInputVerification;
                    result.Detail =
                        "a launch input did not exist at call time; the staged executable, the working directory and every required file are verified before CreateProcessW, and their canonical paths are recorded under permitted_read.inputs";
                }
                else if (allowedOutcome.FailureStage == ConfinedLauncher.StageEnvironmentBlockInvalid)
                {
                    result.ReasonCode = EnvironmentBlock.ReasonInvalid;
                    result.Stage = StageEnvironmentBlock;
                    result.Detail =
                        "the constructed environment block did not pass its own self-test, so CreateProcessW was never called: "
                        + (allowedOutcome.Inputs == null ? "" : allowedOutcome.Inputs.EnvironmentBlockDetail);
                }
                else
                {
                    result.ReasonCode = "EXECUTOR_NOT_CREATED";
                    result.Stage = StageCreateProcessSuspended;
                    result.Detail =
                        "CreateProcessW could not start the W4 executor inside the AppContainer at internal stage "
                        + allowedOutcome.FailureStage
                        + ". The full call state is recorded under permitted_read.inputs, and the isolated cause under"
                        + " create_process_diagnostic_matrix and environment_calibration."
                        + " Win32 5 means the AppContainer SID still cannot read or execute something on the launch path;"
                        + " Win32 2/3 means a path in the staged runtime-code scope is wrong;"
                        + " Win32 203 (ERROR_ENVVAR_NOT_FOUND) means the launch environment is missing a name the"
                        + " creation path itself resolves.";
                }
                return result;
            }
            if (!allowedOutcome.AssignedToJob)
            {
                result.Verdict = "BLOCKED";
                result.ReasonCode = "JOB_ASSIGN_FAILED";
                result.Stage = StageJobAssign;
                result.Win32Error = allowedOutcome.JobAssignError;
                result.FailureValueSource = SourceWin32;
                result.Detail = "AssignProcessToJobObject failed before resume; the process was created but never contained";
                return result;
            }
            if (allowedOutcome.HandleScopeViolation)
            {
                result.Verdict = "FAIL";
                result.ReasonCode = "WINDOWS_HANDLE_SCOPE_VIOLATION";
                result.Stage = StageHandleValidation;
                result.Completed = true;
                result.Detail =
                    "The confined W4 executor was created with an out-of-scope handle in its table. The launcher refused to resume it, which is the required behaviour, but the launch path itself is not clean.";
                return result;
            }
            if (allowedOutcome.HandleEnumerationSourcesDisagree)
            {
                // مصدران للتعداد اختلفا على جدول عملية معلّقة. لا يُدمجان، ولا
                // يُرجَّح أحدهما بلا سبب: القياس نفسه موضع شك.
                result.Verdict = "INCONCLUSIVE";
                result.ReasonCode = HandleScanner.ReasonSourcesDisagree;
                result.Stage = StageHandleValidation;
                result.Detail =
                    "the public Process Snapshotting enumeration and the internal corroboration reported different"
                    + " handle tables for the same suspended process, so neither reading can be trusted: "
                    + (allowedOutcome.HandlesAtStart == null ? "" : allowedOutcome.HandlesAtStart.IncompleteReason);
                return result;
            }
            if (allowedOutcome.HandleEnumerationIncomplete)
            {
                // لم يُثبت اكتمال القياس: لا نظافة ولا خرق. لا يُرقّى ولا يُخفّض.
                result.Verdict = "INCONCLUSIVE";
                result.ReasonCode = "HANDLE_ENUMERATION_INCOMPLETE";
                result.Stage = StageHandleValidation;
                result.Detail =
                    "the handle table of the confined executor could not be enumerated completely, so a clean list is not evidence of a clean table: "
                    + (allowedOutcome.HandlesAtStart == null ? "" : allowedOutcome.HandlesAtStart.IncompleteReason);
                return result;
            }

            ProtocolResponse permitted = ProtocolResponse.Parse(allowedOutcome.StandardOutput);
            permitted.Emit(json, "permitted_read_response");
            if (!permitted.Spoke)
            {
                // "لم يستجب" ليس تشخيصًا. المخرج التشخيصي يُقرأ ويُصنَّف باسمه،
                // فيُعرف من الدليل وحده أي حالة إقلاع وقعت.
                string startupClass = ExecutorStartupDiagnosis.Classify(allowedOutcome.StandardError);
                json.Name("executor_startup_diagnosis").BeginObject();
                json.Property("classification", startupClass);
                json.Property("meaning", ExecutorStartupDiagnosis.Explain(startupClass));
                json.Property("diagnostics_bytes", allowedOutcome.StderrBytesRead);
                json.Property("classified_from", "the executor's own diagnostic stream, recorded separately from its protocol stream");
                json.EndObject();

                result.Verdict = "BLOCKED";
                result.ReasonCode = "EXECUTOR_PRODUCED_NO_PROTOCOL_RESPONSE";
                result.Stage = StageRuntimeStartup;
                result.ChildExitCode = (int) allowedOutcome.ExitCode;
                result.FailureValueSource = SourceChildExit;
                result.Detail =
                    "the executor started but produced no parsable protocol response. Child exit code "
                    + allowedOutcome.ExitCode.ToString(CultureInfo.InvariantCulture)
                    + (allowedOutcome.ExitCodeAvailable ? "" : " (exit code unavailable)")
                    + (allowedOutcome.TimedOut ? " (timed out)" : "")
                    + ". This number is a child exit code, not a Win32 API error. Its protocol stream is recorded"
                    + " under permitted_read.output, its startup diagnostics under permitted_read.diagnostics,"
                    + " and the parse outcome under permitted_read_response. The startup failure is classified"
                    + " under executor_startup_diagnosis as " + startupClass + ".";
                return result;
            }
            bool permittedSucceeded = permitted.Succeeded;

            // ── المرحلة 9: المسار الممنوع، عبر نقطة الفرض ──────────────────────
            LaunchSpec denied = NewSpec(confinedNode, confinedHost,
                fixtures.WorkDirectory, environment, container, job, scopeRoots);
            TargetObjectIdentity deniedIdentity = TargetObjectIdentity.Of(fixtures.DeniedFile);
            denied.StdinPayload = GrantBuilder.ReadGrant(
                fixtures.DeniedFile, "T:\\OUTSIDE\\denied.txt", scopeRoots, environment, deniedIdentity);
            ProtocolPayloadContract deniedPayload = new ProtocolPayloadContract();
            bool deniedPayloadValid = deniedPayload.Validate(denied.StdinPayload);
            deniedPayload.Emit(json, "denied_read_payload");
            if (!deniedPayloadValid)
            {
                result.Verdict = "BLOCKED";
                result.ReasonCode = deniedPayload.ReasonCode;
                result.Stage = StageProtocolHandshake;
                result.FailureValueSource = SourceNone;
                result.Detail =
                    "the denied-path execution grant does not satisfy the executor's input contract, so the"
                    + " enforcement-point refusal was never measured. See denied_read_payload.";
                return result;
            }
            LaunchOutcome deniedOutcome = launcher.Launch(denied);
            result.DeniedProcessId = deniedOutcome.ProcessId;

            ProtocolResponse denialResponse = ProtocolResponse.Parse(deniedOutcome.StandardOutput);
            bool deniedRefused = denialResponse.Failed;
            // السبب المنطقي الصحيح، لا مجرد فشل: الهدف خارج المنحة.
            bool deniedRefusedForTheRightReason =
                deniedRefused
                && string.Equals(denialResponse.ErrorCode, "TARGET_OUTSIDE_GRANT", StringComparison.Ordinal);

            json.Name("denied_read").BeginObject();
            EmitLaunch(json, deniedOutcome);
            denialResponse.Emit(json, "protocol_response");
            json.Property("refused", deniedRefused);
            json.Property("refused_for_the_right_reason", deniedRefusedForTheRightReason);
            json.Property("expected_reason_code", "TARGET_OUTSIDE_GRANT");
            json.EndObject();

            // ── المرحلة 10: ضابط الـACL على مستوى النظام ───────────────────────
            LaunchSpec controlSpec = NewSpec(confinedNode, control.ScriptPath,
                fixtures.WorkDirectory, environment, container, job, scopeRoots);
            LaunchOutcome controlOutcome = launcher.Launch(controlSpec);
            result.ControlProcessId = controlOutcome.ProcessId;
            control.Parse(controlOutcome.StandardOutput);

            json.Name("os_acl_control_launch").BeginObject();
            EmitLaunch(json, controlOutcome);
            json.EndObject();
            control.Emit(json);

            if (!controlOutcome.Created || !control.ProtocolComplete)
            {
                result.Verdict = "BLOCKED";
                result.ReasonCode = "ACL_CONTROL_DID_NOT_RUN";
                result.Stage = StageAclControlStartup;
                if (controlOutcome.Created)
                {
                    result.ChildExitCode = (int) controlOutcome.ExitCode;
                    result.FailureValueSource = SourceChildExit;
                }
                else
                {
                    result.Win32Error = controlOutcome.Win32Error;
                    result.FailureValueSource = SourceWin32;
                }
                result.Detail =
                    "the OS-level ACL control did not run to completion inside the container (created="
                    + controlOutcome.Created.ToString() + ", exit=" + controlOutcome.ExitCode.ToString()
                    + "). Requirement B - that the AppContainer boundary itself refuses the denied resource - was therefore not measured.";
                return result;
            }

            // من هنا فصاعدًا: القياس وقع كاملًا.
            result.Completed = true;

            bool handlesClean = allowedOutcome.HandlesScanned
                && allowedOutcome.HandlesAtStart != null
                && allowedOutcome.HandlesAtStart.EnumerationComplete
                && HandleScanner.CountOutOfScope(allowedOutcome.HandlesAtStart) == 0;

            json.Property("permitted_read_succeeded", permittedSucceeded);
            json.Property("out_of_scope_read_refused", deniedRefusedForTheRightReason);
            json.Property("initial_handle_table_clean", handlesClean);
            json.Property("os_boundary_refuses_denied_resource", control.DeniedResourceRefusedByOs);
            json.Property("os_positive_control_valid", control.PositiveControlValid);

            // ── تقاطع الهوية: هل يبلّغ المُطلِق وبيئة التشغيل الرقم نفسه ───────
            // المُطلِق يرصد هوية الكائن بواجهة Win32 موثّقة، وبيئة تشغيل المنفّذ
            // ترصدها بواجهتها هي من داخل الحاوية. تطابق الترميز بين الاثنين ليس
            // مفروضًا بحكم التعريف، فيُقاس في التشغيل نفسه. وإن اختلفا فإخفاق
            // المطابقة عيبُ أداةِ قياس باسمه، لا نتيجةَ حصر — وINCONCLUSIVE لا FAIL.
            AclControlTarget allowedControl = control.Find(MissionFixtures.ScopeAllowedResource);
            bool identityCrossChecked = allowedControl != null
                && allowedControl.ObservedFileId != null
                && allowedControl.ObservedFileId.Length > 0;
            bool identityAgrees = identityCrossChecked
                && allowedIdentity.Matches(allowedControl.ObservedVolume, allowedControl.ObservedFileId);
            json.Name("target_identity_cross_check").BeginObject();
            json.Property("compared", identityCrossChecked);
            json.Property("launcher_volume", allowedIdentity.Volume);
            json.Property("launcher_file", allowedIdentity.FileId);
            json.Property("runtime_volume", allowedControl == null ? "" : allowedControl.ObservedVolume);
            json.Property("runtime_file", allowedControl == null ? "" : allowedControl.ObservedFileId);
            json.Property("agree", identityAgrees);
            json.Property("launcher_source", "GetFileInformationByHandle");
            json.Property("runtime_source", "the execution runtime's own fstat on its own handle, inside the container");
            json.Property("note",
                "the same object measured twice by two toolchains. Disagreement here makes the executor's identity"
                + " comparison an instrument defect, not a confinement result.");
            json.EndObject();

            // والفحص التمهيدي في المنفّذ يستعلم عن مكوّنات المسار داخل النطاق الممنوح.
            // الضابط يقيس هل تملك الحاوية ذلك الحق أصلًا، فلا يُقرأ رفضه حصرًا.
            json.Name("runtime_component_query_control").BeginObject();
            json.Property("target_link_stat_code", allowedControl == null ? "" : allowedControl.LinkStatCode);
            json.Property("parent_link_stat_code", allowedControl == null ? "" : allowedControl.ParentLinkStatCode);
            json.Property("note",
                "a direct attribute query on the granted target and on its granted parent directory, from inside the"
                + " container. OK on both means the executor's pre-open component scan asks for a right the container has.");
            json.EndObject();

            if (!permittedSucceeded)
            {
                bool encodingDisagreement = identityCrossChecked && !identityAgrees;
                result.Verdict = encodingDisagreement ? "INCONCLUSIVE" : "FAIL";
                result.ReasonCode = encodingDisagreement
                    ? "TARGET_IDENTITY_ENCODING_DISAGREEMENT"
                    : "ALLOWED_READ_DID_NOT_SUCCEED";
                result.Stage = StageProtocolHandshake;
                result.Detail = encodingDisagreement
                    ? "the launcher and the execution runtime report different identities for the same object, so the"
                      + " executor's identity check measured the instrument, not the boundary. See target_identity_cross_check."
                    : "the executor answered but did not complete the in-scope read";
                return result;
            }
            if (!deniedRefused)
            {
                result.Verdict = "FAIL";
                result.ReasonCode = "DENIED_READ_NOT_REFUSED";
                result.Stage = StageProtocolHandshake;
                result.Detail = "the out-of-scope read was not refused inside the container";
                return result;
            }
            if (!deniedRefusedForTheRightReason)
            {
                result.Verdict = "FAIL";
                result.ReasonCode = "DENIED_READ_REFUSED_FOR_THE_WRONG_REASON";
                result.Stage = StageProtocolHandshake;
                result.Detail =
                    "the out-of-scope read failed, but not with TARGET_OUTSIDE_GRANT. A refusal for an unrelated reason - a missing file, a broken fixture, an IO error - is not a confinement result.";
                return result;
            }
            if (!control.PositiveControlValid)
            {
                // ضابط موجب فاشل: لا يجوز قراءة الرفض حصرًا. INCONCLUSIVE لا PASS ولا FAIL.
                result.Verdict = "INCONCLUSIVE";
                result.ReasonCode = "OS_ACL_POSITIVE_CONTROL_DID_NOT_READ";
                result.Stage = StageAclControlStartup;
                result.Detail =
                    "the byte-identical granted fixture could not be read from inside the container either, so the refusal of the denied fixture does not distinguish confinement from a broken probe.";
                return result;
            }
            if (!control.DeniedResourceRefusedByOs)
            {
                result.Verdict = "FAIL";
                result.ReasonCode = "DENIED_RESOURCE_OS_ACCESSIBLE";
                result.Stage = StageAclControlStartup;
                result.Detail =
                    "a raw open of the denied control resource succeeded from inside the AppContainer. The PEP refusal above is therefore the only thing standing between the mission and that file; the OS boundary is not.";
                return result;
            }
            if (!handlesClean)
            {
                result.Verdict = "FAIL";
                result.ReasonCode = "OUT_OF_SCOPE_INITIAL_HANDLE";
                result.Stage = StageHandleValidation;
                result.Detail = "the confined executor started with an out-of-scope handle in a completely enumerated table";
                return result;
            }

            result.Verdict = "PASS";
            result.ReasonCode = "ALL_CONFINEMENT_REQUIREMENTS_MET";
            result.Stage = "";
            result.Detail = "";
            return result;
        }

        /// <summary>
        /// وضعية الإطلاق الإنتاجية الوحيدة: node مُدرَّج ببصمة مطابقة، سكربت مُدرَّج،
        /// lpApplicationName صريح، سطر أوامر مُقتبَس، بيئة مبنية بالكامل، AppContainer
        /// بصفر قدرات، قائمة مقابض صريحة، إنشاء معلّق، وJob قبل الاستئناف.
        /// </summary>
        private static LaunchSpec NewSpec(
            string node, string scriptPath, string workingDirectory,
            Dictionary<string, string> environment, AppContainerScope container, JobScope job, string[] scopeRoots)
        {
            LaunchSpec spec = new LaunchSpec();
            spec.ExecutablePath = node;
            // lpApplicationName صريح واقتباس صحيح: لا بحث في PATH، ولا تقسيم
            // لمسار فيه مسافة، ولا تشغيل عبر الصدفة.
            spec.UseExplicitApplicationName = true;
            // --preserve-symlinks-main و --preserve-symlinks: بلا هذين يستدعي
            // حلّ الوحدة الرئيسية realpath، وهو يستعلم عن جذر الوحدة التخزينية
            // نفسه ("C:\\"). حاوية بصفر قدرات لا تملك FILE_READ_ATTRIBUTES هناك،
            // فيموت المنفّذ بـEPERM قبل تنفيذ سطر واحد. البديل — منح المعرّف حقًّا
            // على جذر القرص — توسيعُ ACL خارج مساحة العمل، وهو ممنوع. فالعلاجُ
            // إسقاطُ الحاجة لا توسيعُ الصلاحية: لا يُتَّبع رابط رمزي في الحلّ أصلًا.
            spec.NodeStartupFlags = new string[] { "--preserve-symlinks-main", "--preserve-symlinks" };
            List<string> arguments = new List<string>();
            arguments.AddRange(spec.NodeStartupFlags);
            arguments.Add(scriptPath);
            spec.CommandLine = ConfinedLauncher.BuildCommandLine(node, arguments.ToArray());
            spec.RequiredFiles = new string[] { node, scriptPath };
            spec.WorkingDirectory = workingDirectory;
            spec.Environment = environment;
            spec.Inheritance = InheritanceMode.ExplicitHandleList;
            spec.AppContainerSid = container.Sid;
            spec.JobHandle = job.Handle;
            spec.ScopeRoots = scopeRoots;
            spec.ScanHandlesBeforeResume = true;
            spec.EnforceHandleScope = true;
            return spec;
        }

        private static void EmitLaunch(JsonWriter json, LaunchOutcome outcome)
        {
            LaunchInputs.Emit(json, "inputs", outcome.Inputs);
            json.Property("created", outcome.Created);
            json.Property("process_id", outcome.ProcessId);
            json.Property("assigned_to_job", outcome.AssignedToJob);
            json.Property("job_assign_error", outcome.JobAssignError);
            json.Property("win32_error", outcome.Win32Error);
            json.Property("failure_stage", outcome.FailureStage);
            json.Property("resumed", outcome.Resumed);
            json.Property("handle_scope_violation", outcome.HandleScopeViolation);
            json.Property("handle_enumeration_incomplete", outcome.HandleEnumerationIncomplete);
            json.Property("out_of_scope_handles_at_start", HandleScanner.CountOutOfScope(outcome.HandlesAtStart));
            HandleScanner.Emit(json, "handles_at_start", outcome.HandlesAtStart);
            HandleScanner.Emit(json, "handles_after_resume", outcome.HandlesAfterResume);
            json.Property("resume_succeeded", outcome.ResumeSucceeded);
            json.Property("resume_win32_error", outcome.ResumeWin32Error);
            json.Property("stdin_write_attempted", outcome.StdinWriteAttempted);
            json.Property("stdin_write_success", outcome.StdinWriteSuccess);
            json.Property("stdin_bytes_expected", outcome.StdinBytesExpected);
            json.Property("stdin_bytes_written", outcome.StdinBytesWritten);
            json.Property("stdin_write_win32_error", outcome.StdinWriteWin32Error);
            json.Property("stdin_broken_pipe", outcome.StdinBrokenPipe);
            json.Property("stdout_read_success", outcome.StdoutReadSuccess);
            json.Property("stdout_bytes_read", outcome.StdoutBytesRead);
            json.Property("stdout_read_win32_error", outcome.StdoutReadWin32Error);
            json.Property("stdout_read_joined", outcome.StdoutReadJoined);
            json.Property("stderr_merged", outcome.StderrMerged);
            json.Property("stderr_read_success", outcome.StderrReadSuccess);
            json.Property("stderr_bytes_read", outcome.StderrBytesRead);
            json.Property("stderr_read_win32_error", outcome.StderrReadWin32Error);
            json.Property("stderr_read_joined", outcome.StderrReadJoined);
            json.Property("wait_result", outcome.WaitResult);
            json.Property("wait_win32_error", outcome.WaitWin32Error);
            json.Property("child_exit_code", outcome.ExitCode);
            json.Property("exit_code", outcome.ExitCode);
            json.Property("exit_code_available", outcome.ExitCodeAvailable);
            json.Property("exit_code_win32_error", outcome.ExitCodeWin32Error);
            json.Property("timed_out", outcome.TimedOut);
            json.Property("output", Trim(outcome.StandardOutput));
            json.Property("diagnostics", Trim(outcome.StandardError));
        }

        private static string Trim(string text)
        {
            if (text == null) { return ""; }
            return text.Length > 8000 ? text.Substring(0, 8000) : text;
        }
    }
}
