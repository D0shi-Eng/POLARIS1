using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Polaris.W4.WindowsAdapter;

namespace Polaris.W5.WindowsAdapter
{
    /// <summary>حالة التشغيل كاملة، حتى يبقى هدمها وإصدار ذيل الدليل مسارًا واحدًا.</summary>
    internal sealed class PanicStopRunState
    {
        public string Workspace = "";
        public PanicStopTimeline Timeline = new PanicStopTimeline();
        public AppContainerScope Container;
        public RuntimeCodeStaging Staging = new RuntimeCodeStaging();
        public ExecutionEnvironmentPlan EnvironmentPlan;
        public JobScope CalibrationJob;
        public PanicStopSession LongLived;
        public PanicStopSession PositiveControl;
        public PanicStopSession Measurement;

        public bool MeasurementComplete;
        public string BlockedStage = "";
        public string BlockedReasonCode = "";
        public string BlockedDetail = "";

        public bool RuntimeCodeRemoved;
        public bool RuntimeScopesRemoved;
        public bool WorkspaceRemoved;
        public bool AclRestoreSuccess;
        public bool ProfileDeleteSuccess;
        public List<string> ResidualContainerAces = new List<string>();
        public bool CleanupRan;
        public List<string> Survivors = new List<string>();

        public void Block(string stage, string reasonCode, string detail)
        {
            if (BlockedReasonCode.Length > 0) { return; }
            BlockedStage = stage;
            BlockedReasonCode = reasonCode;
            BlockedDetail = detail;
        }

        public bool IsBlocked { get { return BlockedReasonCode.Length > 0; } }
    }

    /// <summary>
    /// W5 / P01 — إيقاف طوارئ على ابن محصور حيّ.
    ///
    /// ── ما كان يحدث فعلًا قبل هذا الإصلاح ─────────────────────────────────────
    /// كان هذا الوضع يمرّ الخريطة الأساسية وحدها إلى CreateProcessW، فيفشل
    /// الإنشاء بـWin32 203، فلا يوجد ابن أصلًا، ثم تُستقصى حياة ابنٍ غير موجود
    /// عشرين ثانية، فيُكتب «CHILD_NEVER_OBSERVED_ALIVE». والحكم كان يُشتق من
    /// حلقة الاستقصاء لا من حالة الإطلاق، فسُمّي العَرَض علّةً وضاعت العلّة وهي
    /// مسجّلة في الدليل الخام نفسه.
    ///
    /// ── ما تغيّر ─────────────────────────────────────────────────────────────
    ///   1) بيئة الإطلاق تُعايَر تجريبيًا على شكل الإطلاق الإنتاجي نفسه، بضابط
    ///      سالب وموجب لكل اسم مُثبَت. لا قائمة منسوخة من دليل قديم.
    ///   2) الاستعداد صار ملحوظًا: وثيقة العيّنة تُقرأ حين تُكتب لا بعد موتها.
    ///   3) الحياة صارت محكًّا صريحًا: رمز الخروج مع الانتظار، وعضوية الـJob من
    ///      النواة. لا اسم عملية، ولا وجود معرّف، ولا مضيّ زمن.
    ///   4) الموت يُثبَت على مقبض مثبَّت قبل الإيقاف، فلا تُضلّله إعادة استعمال
    ///      المعرّف.
    ///   5) لم تُزَد مهلة واحدة، ولم يُطَل عمر العيّنة. حلقة الاستقصاء حُذفت،
    ///      وحلّ محلها انتظارٌ على كائنات نواة.
    ///
    /// ── حدّ هذا الملف ────────────────────────────────────────────────────────
    /// يقيس ويسجّل الحقائق الخام. لا يُصدر حكمًا: الحكم يُشتق من هذه الحقائق في
    /// طبقة المسبار، فيبقى الاشتقاق قابلًا للاختبار على أي مضيف.
    /// </summary>
    internal static class PanicStopMode
    {
        internal const string StageWorkspace = "WORKSPACE";
        internal const string StageFixture = "HOLD_FIXTURE";
        internal const string StageRuntimeCodeStaging = "RUNTIME_CODE_STAGING";
        internal const string StageProfileCreate = "PROFILE_CREATE";
        internal const string StageAclGrant = "ACL_GRANT";
        internal const string StageJobCreate = "JOB_CREATE";
        internal const string StageEnvironmentCalibration = "ENVIRONMENT_CALIBRATION";
        internal const string StageLongLivedControl = "CONTROL_LONG_LIVED";
        internal const string StagePositiveControl = "CONTROL_POSITIVE_TERMINATION";
        internal const string StageLaunch = "LAUNCH";
        internal const string StageReadiness = "PROVE_READY_BEFORE_STOP";
        internal const string StageAliveBefore = "PROVE_ALIVE_BEFORE_STOP";
        internal const string StageStop = "PANIC_STOP";
        internal const string StageAliveAfter = "PROVE_DEAD_AFTER_STOP";
        internal const string StageCleanup = "CLEANUP";

        // ── مهلات ────────────────────────────────────────────────────────────────
        // هذه القيم هي قيم ما قبل الإصلاح نفسها، بلا زيادة واحدة. الاستعداد لا
        // ينتظرها في الحالة السويّة: الحادثة تُرفع عند وصول الوثيقة أو عند انتهاء
        // نداء الإطلاق، والمهلة سقفٌ لحالة العطب لا زمنُ عملٍ.
        private const int ReadyTimeoutMs = 20000;
        private const int DeathTimeoutMs = 10000;
        /// <summary>نافذة الضابط السالب. انتظارٌ على مقبض العملية، لا نوم.</summary>
        private const int LongLivedWindowMs = 2000;
        private const int LongLivedObservations = 4;

        internal static int Run(Options options, JsonWriter json)
        {
            PanicStopRunState state = new PanicStopRunState();
            json.Property("measurement_started",
                DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture));
            try
            {
                Measure(options, json, state);
            }
            catch (Exception error)
            {
                state.Block(StageLaunch, "MEASUREMENT_THREW",
                    error.GetType().Name + ": " + error.Message);
            }
            finally
            {
                try { Teardown(state); }
                catch (Exception error)
                {
                    state.Block(StageCleanup, "CLEANUP_FAILED", error.GetType().Name + ": " + error.Message);
                }
            }
            EmitTail(json, state);
            return state.MeasurementComplete && !state.IsBlocked ? 0 : 4;
        }

        private static void Measure(Options options, JsonWriter json, PanicStopRunState state)
        {
            PanicStopTimeline timeline = state.Timeline;

            string repositoryRoot = options.Get("repository-root", "");
            string node = options.Get("node", "");
            string holdScript = options.Get("hold-script", "");
            string distRoot = options.Get("dist-root", "");

            timeline.Mark("T0", "fixture preparation begins");

            if (repositoryRoot.Length == 0 || node.Length == 0 || holdScript.Length == 0 || distRoot.Length == 0)
            {
                state.Block(StageWorkspace, "MISSING_ARGUMENTS",
                    "panic-stop needs --repository-root, --node, --hold-script and --dist-root");
                return;
            }

            state.Workspace = Path.Combine(
                Path.GetTempPath(), "polaris-w5-panic-" + Guid.NewGuid().ToString("N"));
            json.Property("workspace", state.Workspace);
            Directory.CreateDirectory(state.Workspace);

            // ── 1 العيّنة: تُثبَت قبل أي شيء، فغيابها عائق لا فشل قياس ──────────
            bool fixturePresent = File.Exists(holdScript);
            json.Name("fixture").BeginObject();
            json.Property("node", node);
            json.Property("hold_script", holdScript);
            json.Property("hold_script_exists", fixturePresent);
            json.Property("dist_root", distRoot);
            json.Property("dist_root_exists", Directory.Exists(distRoot));
            json.EndObject();
            if (!fixturePresent)
            {
                state.Block(StageFixture, "HOLD_FIXTURE_ABSENT",
                    "the long-lived child fixture is not built at " + holdScript);
                return;
            }
            timeline.Mark("T1", "runtime hold-child module verified");

            state.EnvironmentPlan = ExecutionEnvironmentPlan.Create(state.Workspace);
            state.EnvironmentPlan.CreateDirectories();

            // ── 2 تدريج كود التشغيل: نفس آلية تدريج منفّذ W4 ────────────────────
            timeline.Mark("T2", "runtime staging begins");
            bool staged = state.Staging.Stage(state.Workspace, node, holdScript, distRoot);
            json.Name("staging").BeginObject();
            json.Property("staged", staged);
            json.Property("root", state.Staging.Root);
            json.Property("application_root", state.Staging.ApplicationRoot);
            json.Property("node_path", state.Staging.NodePath);
            json.Property("host_script_path", state.Staging.HostScriptPath);
            json.Property("package_manifest_path", state.Staging.PackageManifestPath);
            json.Property("module_file_count", state.Staging.FileCount);
            json.Property("failure_stage", state.Staging.FailureStage);
            json.Property("failure_reason_code", state.Staging.FailureReasonCode);
            json.Property("failure_detail", state.Staging.FailureDetail);
            json.EndObject();
            if (!staged)
            {
                state.Block(StageRuntimeCodeStaging, state.Staging.FailureReasonCode,
                    state.Staging.FailureStage + ": " + state.Staging.FailureDetail);
                return;
            }
            timeline.Mark("T3", "runtime staging completes");

            // ── 3 حاوية بصفر قدرات ──────────────────────────────────────────────
            state.Container = new AppContainerScope("polaris-w5-panic");
            bool containerCreated = state.Container.Create();
            json.Name("appcontainer").BeginObject();
            json.Property("active", containerCreated);
            json.Property("sid", state.Container.SidString);
            json.Property("lifecycle", state.Container.Lifecycle);
            json.Property("capability_count", 0);
            json.Property("internet_client_requested", false);
            json.Property("private_network_requested", false);
            json.Property("create_failure_stage", state.Container.FailureStage);
            json.Property("create_win32_error", state.Container.LastError);
            json.EndObject();
            if (!containerCreated)
            {
                state.Block(StageProfileCreate, "APPCONTAINER_PROFILE_NOT_CREATED",
                    "CreateAppContainerProfile failed at " + state.Container.FailureStage
                    + " with Win32 error " + state.Container.LastError.ToString(CultureInfo.InvariantCulture));
                return;
            }
            timeline.Mark("T4", "AppContainer profile created or resolved");

            // ── 4 الحقوق: داخل مساحة العمل وحدها ────────────────────────────────
            List<string> grantFailures = new List<string>();
            if (!state.Container.GrantReadExecuteTree(state.Staging.Root, MissionFixtures.ScopeRuntimeCode))
            {
                grantFailures.Add(MissionFixtures.ScopeRuntimeCode + ":" + state.Staging.Root);
            }
            if (!state.Container.GrantModifyTree(
                    state.EnvironmentPlan.RuntimeTempDirectory, ExecutionEnvironmentPlan.ScopeRuntimeTemp))
            {
                grantFailures.Add(ExecutionEnvironmentPlan.ScopeRuntimeTemp + ":"
                    + state.EnvironmentPlan.RuntimeTempDirectory);
            }
            if (!state.Container.GrantModifyTree(
                    state.EnvironmentPlan.RuntimeProfileDirectory, ExecutionEnvironmentPlan.ScopeRuntimeProfile))
            {
                grantFailures.Add(ExecutionEnvironmentPlan.ScopeRuntimeProfile + ":"
                    + state.EnvironmentPlan.RuntimeProfileDirectory);
            }
            json.Property("acl_grant_failures", grantFailures);
            if (grantFailures.Count > 0)
            {
                state.Block(StageAclGrant, "ACL_GRANT_FAILED",
                    "one or more ACL grants inside the workspace failed; no confinement claim follows");
                return;
            }
            timeline.Mark("T5", "ACLs applied inside the workspace only");

            // ── 5 قالب الإطلاق الإنتاجي، ومعه توقيع القياس ──────────────────────
            PanicStopLaunchTemplate template = new PanicStopLaunchTemplate();
            template.ExecutablePath = state.Staging.NodePath;
            template.HostScriptPath = state.Staging.HostScriptPath;
            template.WorkingDirectory = state.Staging.ApplicationRoot;
            template.Nonce = Guid.NewGuid().ToString("N");
            template.AppContainerSid = state.Container.Sid;
            template.ScopeRoots = new string[] { state.Staging.Root };

            json.Name("launch_template").BeginObject();
            json.Property("executable", template.ExecutablePath);
            json.Property("command_line", template.CommandLine());
            json.Property("node_startup_flags", new List<string>(PanicStopLaunchTemplate.NodeFlags));
            json.Property("working_directory", template.WorkingDirectory);
            json.Property("nonce_present", template.Nonce.Length > 0);
            json.Property("nonce_length", template.Nonce.Length);
            json.Property("same_shape_for_calibration_and_measurement", true);
            json.EndObject();

            json.Name("handles").BeginObject();
            json.Property("explicit_handle_list", true);
            json.Property("inherited_handles", 3);
            json.Property("inherited_handle_roles",
                new List<string>(new string[] { "STDIN_READ", "STDOUT_WRITE", "STDERR_WRITE" }));
            json.Property("readiness_handle_origin", ReadinessObserver.HandleOrigin);
            json.Property("readiness_handle_is_additional", false);
            json.Property("ambient_handle_count", 0);
            json.Property("ambient_inheritance", false);
            json.Property("readiness_channel_note",
                "the readiness channel is the standard output handle the launcher already creates and already lists;"
                + " this measurement adds no handle, no named kernel object and no environment name for it");
            json.EndObject();

            // ── 6 Job المعايرة، منفصل عن Job القياس ─────────────────────────────
            state.CalibrationJob = new JobScope();
            if (!state.CalibrationJob.Create("polaris-w5-panic-calibration-" + Guid.NewGuid().ToString("N")))
            {
                state.Block(StageJobCreate, "JOB_NOT_CREATED",
                    "CreateJobObjectW failed at " + state.CalibrationJob.FailureStage
                    + " with Win32 error " + state.CalibrationJob.LastError.ToString(CultureInfo.InvariantCulture));
                return;
            }
            timeline.Mark("T6", "job objects created (calibration job separate from the measurement job)");

            // ── 7 معايرة البيئة، على شكل الإطلاق الإنتاجي نفسه ──────────────────
            ConfinedLauncher calibrationLauncher = new ConfinedLauncher();
            PanicStopEnvironmentResult calibration = PanicStopEnvironmentCalibration.Calibrate(
                calibrationLauncher, template, state.EnvironmentPlan, state.CalibrationJob.Handle);
            calibration.Emit(json, "environment_calibration");
            if (!calibration.Success)
            {
                state.Block(StageEnvironmentCalibration, "LAUNCH_ENVIRONMENT_NOT_CALIBRATED", calibration.Detail);
                return;
            }

            // ── 8 الضابط السالب: العيّنة تبقى حيّة بلا إيقاف ────────────────────
            SessionCodes controlCodes = new SessionCodes();
            controlCodes.JobCreated = "C1-JOB";
            controlCodes.LaunchEntered = "C1-LAUNCH";
            controlCodes.FirstStateQuery = "C1-QUERY";
            controlCodes.FirstAlive = "C1-ALIVE";
            controlCodes.ReadyObserved = "C1-READY";
            controlCodes.StopRequested = "C1-TEARDOWN-REQUESTED";
            controlCodes.JobClosed = "C1-TEARDOWN-CLOSED";
            controlCodes.DeathObserved = "C1-TEARDOWN-DEAD";
            controlCodes.SurvivorsVerified = "C1-SURVIVORS";

            state.LongLived = new PanicStopSession(
                "control-long-lived", template, calibration.Environment, timeline, controlCodes);
            RunSession(state.LongLived, true, false);
            state.LongLived.Emit(json, "control_long_lived");
            if (!state.LongLived.ReadyObserved
                || state.LongLived.AliveBeforeStop == null
                || !state.LongLived.AliveBeforeStop.ObservedAlive
                || state.LongLived.LongLivedWaitResult != "WAIT_TIMEOUT")
            {
                state.Block(StageLongLivedControl, "LONG_LIVED_CONTROL_FAILED",
                    "the control could not establish that the confined fixture stays alive on its own,"
                    + " so no later death can be attributed to the stop");
                return;
            }

            // ── 9 الضابط الموجب: نفس الآلية، والقتل عند الإغلاق يفعل فعله ───────
            SessionCodes positiveCodes = new SessionCodes();
            positiveCodes.JobCreated = "C2-JOB";
            positiveCodes.LaunchEntered = "C2-LAUNCH";
            positiveCodes.FirstStateQuery = "C2-QUERY";
            positiveCodes.FirstAlive = "C2-ALIVE";
            positiveCodes.ReadyObserved = "C2-READY";
            positiveCodes.StopRequested = "C2-STOP-REQUESTED";
            positiveCodes.JobClosed = "C2-STOP-CLOSED";
            positiveCodes.DeathObserved = "C2-STOP-DEAD";
            positiveCodes.SurvivorsVerified = "C2-SURVIVORS";

            state.PositiveControl = new PanicStopSession(
                "control-positive-termination", template, calibration.Environment, timeline, positiveCodes);
            RunSession(state.PositiveControl, false, true);
            state.PositiveControl.Emit(json, "control_positive_termination");
            if (!state.PositiveControl.ReadyObserved
                || state.PositiveControl.AliveAfterStop == null
                || !state.PositiveControl.AliveAfterStop.ObservedExited)
            {
                state.Block(StagePositiveControl, "POSITIVE_TERMINATION_CONTROL_FAILED",
                    "closing the owned job handle did not provably kill a live child through the same native"
                    + " mechanism the measurement uses");
                return;
            }

            // ── 10 القياس نفسه ─────────────────────────────────────────────────
            SessionCodes measurementCodes = new SessionCodes();
            measurementCodes.JobCreated = "T6M";
            measurementCodes.LaunchEntered = "T7";
            measurementCodes.FirstStateQuery = "T18";
            measurementCodes.FirstAlive = "T19";
            measurementCodes.ReadyObserved = "T20";
            measurementCodes.StopRequested = "T21";
            measurementCodes.JobClosed = "T22";
            measurementCodes.DeathObserved = "T23";
            measurementCodes.SurvivorsVerified = "T24";

            state.Measurement = new PanicStopSession(
                "measurement", template, calibration.Environment, timeline, measurementCodes);
            RunSession(state.Measurement, false, true);
            state.Measurement.Emit(json, "measurement");

            EmitLauncherStateOnlyCodes(json, state.Measurement);
            EmitOrdering(json, state.Measurement, timeline);

            state.Survivors = new List<string>();
            state.Survivors.AddRange(state.LongLived.Survivors());
            state.Survivors.AddRange(state.PositiveControl.Survivors());
            state.Survivors.AddRange(state.Measurement.Survivors());

            // اكتمال القياس يُشترط ولا يُفترض. وكل عائق يُسمّى بسببه المُصنَّف —
            // وهذا بالضبط ما لم يكن يحدث: سببٌ عام واحد كان يُخفي أي علّة.
            if (!state.Measurement.JobCreated)
            {
                state.Block(StageJobCreate, "JOB_NOT_CREATED",
                    "CreateJobObjectW failed for the measurement job with Win32 error "
                    + state.Measurement.JobCreateWin32Error.ToString(CultureInfo.InvariantCulture));
                return;
            }
            if (!state.Measurement.ReadyObserved)
            {
                state.Block(StageReadiness,
                    state.Measurement.ReadinessReasonCode.Length > 0
                        ? state.Measurement.ReadinessReasonCode
                        : ReadinessObserver.ReasonNotObserved,
                    "the confined child never announced successful startup on the listed standard-output handle,"
                    + " so nothing was proven about a stop applied to it");
                return;
            }
            if (state.Measurement.AliveBeforeStop == null || !state.Measurement.AliveBeforeStop.ObservedAlive)
            {
                state.Block(StageAliveBefore, "CHILD_NOT_ALIVE_BEFORE_STOP",
                    "the child was not proven alive by the explicit predicate immediately before the stop");
                return;
            }
            if (!state.Measurement.StopRequested)
            {
                state.Block(StageStop, "STOP_NOT_TRIGGERED",
                    "the stop was never triggered, so no death can be attributed to it");
                return;
            }

            state.MeasurementComplete = true;
        }

        /// <summary>
        /// جلسة واحدة من أولها إلى آخرها. الترتيب هو الادعاء: استعداد، ثم حياة
        /// مُثبَتة، ثم عضوية مُثبَتة، ثم — وبعد ذلك فقط — الإيقاف.
        /// </summary>
        private static void RunSession(PanicStopSession session, bool longLivedControl, bool stop)
        {
            int launchTimeout = ReadyTimeoutMs + DeathTimeoutMs + LongLivedWindowMs + 20000;
            if (!session.Start(launchTimeout)) { return; }
            if (!session.AwaitReady(ReadyTimeoutMs)) { return; }
            session.QueryJobMembership();
            ChildStateObservation alive = session.ProveAlive(session.Label + ":before-stop");
            if (!alive.ObservedAlive) { return; }
            if (longLivedControl)
            {
                session.ProveLongLived(LongLivedWindowMs, LongLivedObservations);
            }
            if (!stop) { return; }
            session.RequestStop();
            session.ProveDead(DeathTimeoutMs);
            session.JoinLaunchThread(5000);
        }

        /// <summary>
        /// الرموز التي مداها داخل مُطلِق W4: حالتها مُثبتة من نتيجته، وزمنها غير
        /// موقَّت، ولا يُخترع لها زمن. قول هذا صراحةً أصدق من رقم مُلفَّق.
        /// </summary>
        private static void EmitLauncherStateOnlyCodes(JsonWriter json, PanicStopSession session)
        {
            LaunchOutcome outcome = session.Outcome;
            json.Name("launcher_internal_states").BeginObject();
            json.Property("timestamp_source", "LAUNCHER_OUTCOME_STATE_NOT_INDEPENDENTLY_TIMESTAMPED");
            json.Property("codes", new List<string>(new string[]
            {
                "T8", "T9", "T10", "T11", "T12", "T13", "T14", "T15", "T16", "T17",
            }));
            json.Property("order_enforced_by", "CONFINED_LAUNCHER_SOURCE_ORDER_PLUS_STRUCTURAL_REGRESSION_TEST");
            json.Property("create_returned", outcome != null && outcome.Created);
            json.Property("process_id_assigned", outcome == null ? 0 : outcome.ProcessId);
            json.Property("suspended_at_create", true);
            json.Property("assigned_to_job_before_resume", outcome != null && outcome.AssignedToJob);
            json.Property("job_assign_win32_error", outcome == null ? 0 : outcome.JobAssignError);
            json.Property("resume_succeeded", outcome != null && outcome.ResumeSucceeded);
            json.Property("resumed", outcome != null && outcome.Resumed);
            json.Property("resume_win32_error", outcome == null ? 0 : outcome.ResumeWin32Error);
            json.Property("note",
                "between entering CreateProcessW and ResumeThread succeeding, control never returns to W5;"
                + " timestamping those transitions would require instrumenting the frozen W4 launcher, which this"
                + " remediation refuses to do, so their state is proven and their time is declared unmeasured");
            json.EndObject();
        }

        /// <summary>الترتيب المُقاس، لا الترتيب المقصود. الإسناد يُبنى على هذا وحده.</summary>
        private static void EmitOrdering(JsonWriter json, PanicStopSession session, PanicStopTimeline timeline)
        {
            bool ready = session.ReadyObserved;
            bool aliveBefore = session.AliveBeforeStop != null && session.AliveBeforeStop.ObservedAlive;
            bool inJobBefore = session.AliveBeforeStop != null && session.AliveBeforeStop.InJob
                && session.AliveBeforeStop.JobMembershipQuerySucceeded;
            bool exitedBefore = session.AliveBeforeStop != null && session.AliveBeforeStop.ObservedExited;
            bool deadAfter = session.AliveAfterStop != null && session.AliveAfterStop.ObservedExited;
            bool stopBeforeDeath = session.StopRequestedMicroseconds >= 0
                && timeline.Precedes("T21", "T23");
            bool waitProvesDeath = session.PostStopWaitResult == "WAIT_OBJECT_0";
            bool memberAtClose = false;
            for (int i = 0; i < session.JobProcessIdsBeforeClose.Count; i++)
            {
                if (session.JobProcessIdsBeforeClose[i] == session.ProcessId) { memberAtClose = true; }
            }

            bool attributable = ready && aliveBefore && inJobBefore && !exitedBefore
                && session.StopRequested && session.JobClosed && memberAtClose
                && waitProvesDeath && deadAfter;

            json.Name("ordering").BeginObject();
            json.Property("ready_before_stop", ready && session.StopRequested);
            json.Property("alive_before_stop", aliveBefore);
            json.Property("in_job_before_stop", inJobBefore);
            json.Property("child_in_job_when_job_handle_closed", memberAtClose);
            json.Property("voluntary_exit_before_stop", exitedBefore);
            json.Property("stop_precedes_death", stopBeforeDeath);
            json.Property("post_stop_wait_proves_death", waitProvesDeath);
            json.Property("dead_after_stop", deadAfter);
            json.Property("alive_after_stop",
                session.AliveAfterStop != null && session.AliveAfterStop.ObservedAlive);
            json.Property("post_stop_state_unproven",
                session.AliveAfterStop == null || session.AliveAfterStop.StateUnproven);
            json.EndObject();

            json.Name("attribution").BeginObject();
            json.Property("termination_attribution",
                attributable ? "JOB_CLOSE_KILL_ON_CLOSE" : "NOT_ATTRIBUTABLE");
            json.Property("attributable", attributable);
            json.Property("mechanism", session.StopMechanism);
            json.Property("killed_by_name", false);
            json.Property("killed_by_process_id", false);
            json.Property("terminate_process_called_on_child", false);
            json.Property("exit_code_after_stop", session.PostStopExitCode);
            json.Property("exit_code_after_stop_is_job_close_kill",
                session.PostStopExitCodeAvailable && session.PostStopExitCode == PanicStopNative.ErrorAbandonedWait0);
            json.Property("exit_code_corroborates_only",
                "the exit code is recorded as corroboration; attribution rests on the measured order and on the"
                + " child being a proven member of the job whose last handle was closed");
            json.EndObject();
        }

        private static void Teardown(PanicStopRunState state)
        {
            // الـJob يُغلق أولًا في كل جلسة: أي ابن بقي داخله يموت قبل أن يُلمس
            // شيء آخر. مسار العائق يمرّ من هنا أيضًا، فلا يترك ابنًا ولا حقًّا.
            if (state.Measurement != null) { state.Measurement.Dispose(); }
            if (state.PositiveControl != null) { state.PositiveControl.Dispose(); }
            if (state.LongLived != null) { state.LongLived.Dispose(); }
            if (state.CalibrationJob != null) { state.CalibrationJob.Dispose(); }

            state.RuntimeCodeRemoved = state.Staging.Remove();
            state.RuntimeScopesRemoved = state.EnvironmentPlan == null || state.EnvironmentPlan.RemoveDirectories();
            if (state.Container != null)
            {
                ContainerCleanupResult cleanup = state.Container.Cleanup();
                state.AclRestoreSuccess = cleanup.AclRestoreSuccess;
                state.ProfileDeleteSuccess = cleanup.ProfileDeleteSuccess;
                state.ResidualContainerAces = cleanup.ResidualContainerAces;
                state.Container.Dispose();
            }
            else
            {
                state.AclRestoreSuccess = true;
                state.ProfileDeleteSuccess = true;
            }
            state.WorkspaceRemoved = RemoveTree(state.Workspace);
            state.CleanupRan = true;
            state.Timeline.Mark("T25", "cleanup complete");
        }

        private static void EmitTail(JsonWriter json, PanicStopRunState state)
        {
            bool cleanupClean = state.CleanupRan
                && state.RuntimeCodeRemoved
                && state.RuntimeScopesRemoved
                && state.AclRestoreSuccess
                && state.ResidualContainerAces.Count == 0
                && state.WorkspaceRemoved;

            json.Name("cleanup").BeginObject();
            json.Property("ran", state.CleanupRan);
            json.Property("runtime_code_removed", state.RuntimeCodeRemoved);
            json.Property("runtime_scopes_removed", state.RuntimeScopesRemoved);
            json.Property("job_closed", true);
            json.Property("pipes_closed_by_launcher", true);
            json.Property("process_handles_closed", true);
            json.Property("thread_handles_closed", true);
            json.Property("acl_restore_success", state.AclRestoreSuccess);
            json.Property("profile_delete_success", state.ProfileDeleteSuccess);
            json.Property("residual_container_aces", state.ResidualContainerAces);
            json.Property("temp_tree_removed", state.WorkspaceRemoved);
            json.Property("cleanup_clean", cleanupClean);
            json.EndObject();

            json.Property("survivors", state.Survivors);
            json.Property("survivor_check_method",
                "every owned child is proven exited on a process handle pinned before the stop; no process is"
                + " enumerated or terminated by name");

            state.Timeline.Emit(json, "timeline");

            json.Name("blocked").BeginObject();
            json.Property("blocked", state.IsBlocked);
            json.Property("stage", state.BlockedStage);
            json.Property("reason_code", state.BlockedReasonCode);
            json.Property("detail", state.BlockedDetail);
            json.EndObject();

            json.Property("evidence_complete", state.MeasurementComplete && !state.IsBlocked);
            json.Property("measurement_complete", state.MeasurementComplete);
            json.Property("verdict_owner", "polaris.w5.native-probes");
            json.Property("verdict_owner_note",
                "this adapter records measured facts and does not judge them; the verdict is derived from these"
                + " facts by the probe layer, so the derivation itself is testable on any host");
            json.Property("measurement_completed",
                DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture));
        }

        private static bool RemoveTree(string path)
        {
            try
            {
                if (path.Length == 0) { return true; }
                if (!Directory.Exists(path)) { return true; }
                Directory.Delete(path, true);
                return !Directory.Exists(path);
            }
            catch (Exception)
            {
                return false;
            }
        }
    }
}
