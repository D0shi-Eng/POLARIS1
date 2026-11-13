using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using Polaris.W4.WindowsAdapter;

namespace Polaris.W5.WindowsAdapter
{
    /// <summary>رموز الخط الزمني التي تخصّ جلسة واحدة. القياس يستعمل T*، والضوابط رموزها.</summary>
    internal sealed class SessionCodes
    {
        public string JobCreated = "";
        public string LaunchEntered = "";
        public string FirstStateQuery = "";
        public string FirstAlive = "";
        public string ReadyObserved = "";
        public string StopRequested = "";
        public string JobClosed = "";
        public string DeathObserved = "";
        public string SurvivorsVerified = "";
    }

    /// <summary>
    /// جلسة قياس واحدة: Job مملوك، وابن محصور واحد داخله، ومقبض يثبّت هويته.
    ///
    /// ── لماذا جلسة ────────────────────────────────────────────────────────────
    /// القياس وضابطاه يحتاجون المسار نفسه. جلسةٌ واحدة قابلة لإعادة الاستعمال
    /// تجعل «نفس الآلية» حقيقةً في الشيفرة لا وعدًا في تقرير: الضابط السالب
    /// والضابط الموجب والقياس كلها تمرّ من هنا، بنفس القالب ونفس البيئة المعايَرة.
    ///
    /// ── ما لا يُفعل هنا ───────────────────────────────────────────────────────
    /// لا نوم، ولا استقصاء لحالة الابن، ولا إطالة عمر، ولا قتل باسم عملية.
    /// الانتظار كله على كائنات نواة: حادثةُ وثيقة الاستعداد، ومقبضُ العملية.
    /// </summary>
    internal sealed class PanicStopSession : IDisposable
    {
        private sealed class LaunchThreadState
        {
            public ConfinedLauncher Launcher;
            public LaunchSpec Spec;
            public LaunchOutcome Outcome;
            public Exception Error;
            public bool Finished;
            public ReadinessObserver Readiness;
        }

        private sealed class LaunchRunner
        {
            private readonly LaunchThreadState _state;

            public LaunchRunner(LaunchThreadState state) { _state = state; }

            public void Run()
            {
                try { _state.Outcome = _state.Launcher.Launch(_state.Spec); }
                catch (Exception error) { _state.Error = error; }
                finally
                {
                    _state.Finished = true;
                    // انتهاء نداء الإطلاق حقيقة تُنهي الانتظار كما تُنهيه وثيقة
                    // الاستعداد: فشلُ إنشاء، أو موتُ ابن. لا مهلة تحكم هنا.
                    if (_state.Readiness != null) { _state.Readiness.Release(); }
                }
            }
        }

        private readonly string _label;
        private readonly PanicStopLaunchTemplate _template;
        private readonly Dictionary<string, string> _environment;
        private readonly PanicStopTimeline _timeline;
        private readonly SessionCodes _codes;
        private readonly List<ChildStateObservation> _observations = new List<ChildStateObservation>();

        private JobScope _job;
        private ReadinessObserver _readiness;
        private LaunchThreadState _state;
        private Thread _thread;
        private ChildHandle _child;
        private bool _jobClosed;

        public bool JobCreated;
        public int JobCreateWin32Error;
        public string JobCreateFailureStage = "";

        public bool ReadyObserved;
        public string ReadinessReasonCode = "";

        public int ProcessId;
        public List<int> JobProcessIdsAtFirstQuery = new List<int>();
        public bool ChildUniqueInJob;

        public ChildStateObservation AliveBeforeStop;
        public ChildStateObservation LongLivedFinal;
        public string LongLivedWaitResult = "NOT_RUN";
        public long LongLivedWindowMicroseconds = -1;
        public int LongLivedObservationCount;

        public bool StopRequested;
        public string StopRequestedAt = "";
        public long StopRequestedMicroseconds = -1;
        public string StopMechanism = "";
        public List<int> JobProcessIdsBeforeClose = new List<int>();
        public bool InJobBeforeStop;
        public bool JobClosed;
        public string JobClosedAt = "";
        public long JobClosedMicroseconds = -1;

        public string PostStopWaitResult = "NOT_QUERIED";
        public int PostStopWaitWin32Error;
        public bool PostStopExitCodeAvailable;
        public long PostStopExitCode = -1;
        public ChildStateObservation AliveAfterStop;
        public long DeathLatencyMicroseconds = -1;

        public PanicStopSession(
            string label,
            PanicStopLaunchTemplate template,
            Dictionary<string, string> environment,
            PanicStopTimeline timeline,
            SessionCodes codes)
        {
            _label = label;
            _template = template;
            _environment = environment;
            _timeline = timeline;
            _codes = codes;
        }

        public string Label { get { return _label; } }
        public LaunchOutcome Outcome { get { return _state == null ? null : _state.Outcome; } }
        public bool LaunchFinished { get { return _state != null && _state.Finished; } }
        public ReadinessObserver Readiness { get { return _readiness; } }
        public IntPtr JobHandle { get { return _job == null ? IntPtr.Zero : _job.Handle; } }

        /// <summary>ينشئ الـJob ويبدأ الإطلاق على خيط خلفي. المُطلِق ينتظر الابن.</summary>
        public bool Start(int launchTimeoutMilliseconds)
        {
            _job = new JobScope();
            if (!_job.Create("polaris-w5-panic-" + Guid.NewGuid().ToString("N")))
            {
                JobCreateWin32Error = _job.LastError;
                JobCreateFailureStage = _job.FailureStage;
                return false;
            }
            JobCreated = true;
            _timeline.Mark(_codes.JobCreated, "job created with kill-on-close, breakaway unset");

            _readiness = new ReadinessObserver(_template.Nonce, _timeline);
            _state = new LaunchThreadState();
            _state.Launcher = new ConfinedLauncher();
            _state.Readiness = _readiness;
            _state.Spec = _template.Build(_environment, _job.Handle, false, _readiness, launchTimeoutMilliseconds);

            _thread = new Thread(new ThreadStart(new LaunchRunner(_state).Run));
            _thread.IsBackground = true;
            _timeline.Mark(_codes.LaunchEntered, "confined launch entered on its own thread");
            _thread.Start();
            return true;
        }

        /// <summary>
        /// ينتظر وثيقة الاستعداد. يعود عند وصولها، أو عند انتهاء نداء الإطلاق —
        /// فشلَ إنشاءٍ كان أو موتَ ابن — أو عند انقضاء المهلة. بلا نوم ولا استقصاء.
        /// </summary>
        public bool AwaitReady(int timeoutMilliseconds)
        {
            _readiness.Wait(timeoutMilliseconds);
            if (_readiness.PayloadValid && _readiness.DocumentCount == 1)
            {
                ReadyObserved = true;
                ReadinessReasonCode = "";
                _timeline.MarkState(_codes.ReadyObserved, "structured readiness document accepted",
                    PanicStopTimeline.StateReady);
                return true;
            }

            ReadyObserved = false;
            if (_readiness.DocumentCount > 0)
            {
                ReadinessReasonCode = ReadinessObserver.ReasonInvalid;
            }
            else if (_state.Finished)
            {
                LaunchOutcome outcome = _state.Outcome;
                if (outcome == null) { ReadinessReasonCode = "CHILD_LAUNCH_THREW"; }
                else if (!outcome.Created) { ReadinessReasonCode = "CHILD_CREATE_FAILED"; }
                else if (!outcome.AssignedToJob) { ReadinessReasonCode = "CHILD_JOB_ASSIGN_FAILED"; }
                else if (!outcome.Resumed) { ReadinessReasonCode = "CHILD_RESUME_FAILED"; }
                else { ReadinessReasonCode = "CHILD_EXITED_BEFORE_READY"; }
            }
            else
            {
                ReadinessReasonCode = ReadinessObserver.ReasonNotObserved;
            }
            return false;
        }

        /// <summary>
        /// أول استعلام حالة بعد الاستئناف: معرّفات الـJob من النواة. الملكية تُقرأ
        /// من عضوية الحصر لا من اسم عملية، ووجود معرّف وحده لا يُقرأ حياةً.
        /// </summary>
        public void QueryJobMembership()
        {
            JobProcessIdsAtFirstQuery = _job.LiveProcessIds();
            _timeline.Mark(_codes.FirstStateQuery, "first post-resume state query: job process id list",
                JobProcessIdsAtFirstQuery.Count.ToString(CultureInfo.InvariantCulture) + " process(es) in job");
            ChildUniqueInJob = JobProcessIdsAtFirstQuery.Count == 1;
            if (JobProcessIdsAtFirstQuery.Count > 0) { ProcessId = JobProcessIdsAtFirstQuery[0]; }
        }

        /// <summary>يثبّت هوية الابن بمقبض يبقى مفتوحًا عبر الإيقاف، ثم يقيس حالته.</summary>
        public ChildStateObservation ProveAlive(string observationLabel)
        {
            if (_child == null) { _child = ChildHandle.Open(ProcessId); }
            ChildStateObservation observation =
                ChildStateProbe.Observe(observationLabel, _child, _job.Handle, _timeline);
            _observations.Add(observation);
            if (observation.ObservedAlive)
            {
                _timeline.MarkState(_codes.FirstAlive, "child proven not exited by exit-code and wait",
                    PanicStopTimeline.StateAlive);
            }
            AliveBeforeStop = observation;
            InJobBeforeStop = observation.InJob;
            return observation;
        }

        /// <summary>
        /// الضابط السالب: هل يبقى الابن حيًّا بلا إيقاف؟
        ///
        /// الانتظار على مقبض العملية نفسه، لا نومًا: WAIT_TIMEOUT بعد النافذة يعني
        /// أن العملية لم تُؤشَّر خلالها، أي لم تخرج — وهي نتيجة نداء لا رجاء.
        /// WAIT_OBJECT_0 يعني أنها خرجت من تلقاء نفسها، وهو ما يُبطل القياس بعده.
        /// </summary>
        public void ProveLongLived(int windowMilliseconds, int observationCount)
        {
            if (_child == null || !_child.Valid) { return; }
            long start = _timeline.NowMicroseconds();
            uint wait = Polaris.ConfinementSpike.Launcher.Native.ProcessNativeMethods.WaitForSingleObject(
                _child.Handle, (uint) windowMilliseconds);
            LongLivedWaitResult = PanicStopNative.WaitResultName(wait);
            for (int i = 0; i < observationCount; i++)
            {
                LongLivedFinal = ChildStateProbe.Observe(
                    _label + ":long-lived-observation-" + (i + 1).ToString(CultureInfo.InvariantCulture),
                    _child, _job.Handle, _timeline);
                _observations.Add(LongLivedFinal);
                LongLivedObservationCount++;
            }
            LongLivedWindowMicroseconds = _timeline.NowMicroseconds() - start;
        }

        /// <summary>
        /// الإيقاف: إغلاق مقبض الـJob المملوك. هذا هو مسار الهدم الحقيقي.
        /// لا إنهاء بالاسم، ولا إنهاء بالمعرّف، ولا TerminateProcess.
        /// </summary>
        public void RequestStop()
        {
            JobProcessIdsBeforeClose = _job.LiveProcessIds();
            StopRequestedAt = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
            StopRequestedMicroseconds = _timeline.NowMicroseconds();
            StopRequested = true;
            _timeline.Mark(_codes.StopRequested, "panic stop requested; job still holds the child");

            StopMechanism = "CLOSE_JOB_HANDLE_WITH_KILL_ON_JOB_CLOSE";
            _job.Dispose();
            _jobClosed = true;
            JobClosed = true;
            JobClosedAt = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ", CultureInfo.InvariantCulture);
            JobClosedMicroseconds = _timeline.NowMicroseconds();
            _timeline.Mark(_codes.JobClosed, "last owned job handle closed");
        }

        /// <summary>
        /// إثبات الموت على الكائن نفسه لا على المعرّف: انتظار على المقبض المثبّت،
        /// ثم رمز الخروج منه. إعادة استعمال المعرّف لا تستطيع أن تُضلّل هذا.
        /// </summary>
        public void ProveDead(int timeoutMilliseconds)
        {
            if (_child == null || !_child.Valid)
            {
                PostStopWaitResult = "NOT_QUERIED";
                return;
            }
            uint wait = Polaris.ConfinementSpike.Launcher.Native.ProcessNativeMethods.WaitForSingleObject(
                _child.Handle, (uint) timeoutMilliseconds);
            PostStopWaitResult = PanicStopNative.WaitResultName(wait);
            if (wait == PanicStopNative.WaitFailed)
            {
                PostStopWaitWin32Error = System.Runtime.InteropServices.Marshal.GetLastWin32Error();
            }
            uint exitCode = 0;
            if (Polaris.ConfinementSpike.Launcher.Native.ProcessNativeMethods.GetExitCodeProcess(
                    _child.Handle, out exitCode))
            {
                PostStopExitCodeAvailable = true;
                PostStopExitCode = exitCode;
            }
            // الـJob أُغلق، فلا مقبض له يُستعلم به. العضوية بعد الإغلاق غير قابلة
            // للاستعلام بحكم الآلية نفسها، فتُقاس قبله ويُقال ذلك صراحةً.
            AliveAfterStop = ChildStateProbe.Observe(_label + ":after-stop", _child, IntPtr.Zero, _timeline);
            _observations.Add(AliveAfterStop);
            if (AliveAfterStop.ObservedExited)
            {
                _timeline.MarkState(_codes.DeathObserved, "child proven exited on the pinned handle",
                    PanicStopTimeline.StateTerminatedByStop);
            }
            if (StopRequestedMicroseconds >= 0)
            {
                DeathLatencyMicroseconds = _timeline.NowMicroseconds() - StopRequestedMicroseconds;
            }
        }

        /// <summary>لا ناجين من هذه الجلسة: كل ابن مملوك مُثبَت خروجه على مقبضه.</summary>
        public List<string> Survivors()
        {
            List<string> survivors = new List<string>();
            if (AliveAfterStop != null && AliveAfterStop.ObservedAlive)
            {
                survivors.Add(ProcessId.ToString(CultureInfo.InvariantCulture));
            }
            if (AliveAfterStop != null && AliveAfterStop.StateUnproven && ProcessId > 0)
            {
                survivors.Add("UNPROVEN:" + ProcessId.ToString(CultureInfo.InvariantCulture));
            }
            _timeline.Mark(_codes.SurvivorsVerified, "owned survivors verified on pinned handles",
                survivors.Count.ToString(CultureInfo.InvariantCulture) + " survivor(s)");
            return survivors;
        }

        public bool JoinLaunchThread(int milliseconds)
        {
            return _thread == null ? true : _thread.Join(milliseconds);
        }

        public void Emit(JsonWriter json, string property)
        {
            LaunchOutcome outcome = Outcome;
            json.Name(property).BeginObject();
            json.Property("label", _label);

            json.Name("job").BeginObject();
            json.Property("created", JobCreated);
            json.Property("create_win32_error", JobCreateWin32Error);
            json.Property("create_failure_stage", JobCreateFailureStage);
            json.Property("kill_on_close", true);
            json.Property("breakaway_allowed", false);
            json.Property("child_membership_before_stop", InJobBeforeStop);
            json.Name("processes_at_first_query").BeginArray();
            for (int i = 0; i < JobProcessIdsAtFirstQuery.Count; i++) { json.Value(JobProcessIdsAtFirstQuery[i]); }
            json.EndArray();
            json.Property("child_unique_in_job", ChildUniqueInJob);
            json.Name("processes_before_close").BeginArray();
            for (int i = 0; i < JobProcessIdsBeforeClose.Count; i++) { json.Value(JobProcessIdsBeforeClose[i]); }
            json.EndArray();
            json.Property("processes_after_close_queryable", false);
            json.Property("processes_after_close_reason",
                "kill-on-close fires when the last handle to the job closes, so no handle remains to query the job"
                + " afterwards; membership is therefore proven before the close and death is proven on the pinned"
                + " process handle instead");
            json.Property("closed", JobClosed);
            json.Property("closed_at", JobClosedAt);
            json.Property("closed_monotonic_us", JobClosedMicroseconds);
            json.EndObject();

            json.Name("launch").BeginObject();
            json.Property("finished", LaunchFinished);
            json.Property("exception", _state == null || _state.Error == null
                ? "" : _state.Error.GetType().Name + ": " + _state.Error.Message);
            if (outcome == null)
            {
                json.Property("outcome_recorded", false);
            }
            else
            {
                json.Property("outcome_recorded", true);
                json.Property("created", outcome.Created);
                json.Property("process_id", outcome.ProcessId);
                json.Property("assigned_to_job", outcome.AssignedToJob);
                json.Property("resumed", outcome.Resumed);
                json.Property("suspended_at_create", true);
                json.Property("failure_stage", outcome.FailureStage);
                json.Property("win32_error", outcome.Win32Error);
                json.Property("resume_win32_error", outcome.ResumeWin32Error);
                json.Property("handles_scanned", outcome.HandlesScanned);
                json.Property("handle_scope_violation", outcome.HandleScopeViolation);
                json.Property("handle_enumeration_incomplete", outcome.HandleEnumerationIncomplete);
                json.Property("wait_result", outcome.WaitResult);
                json.Property("exit_code_available", outcome.ExitCodeAvailable);
                json.Property("exit_code", outcome.ExitCode);
                json.Property("timed_out", outcome.TimedOut);
                json.Property("stdout_bytes", outcome.StdoutBytesRead);
                json.Property("stderr_bytes", outcome.StderrBytesRead);
                json.Property("stdout", Cap(outcome.StandardOutput));
                json.Property("stderr", Cap(outcome.StandardError));
                json.Property("stdin_bytes_expected", outcome.StdinBytesExpected);
                json.Property("stdin_bytes_written", outcome.StdinBytesWritten);
                json.Property("stdout_read_win32_error", outcome.StdoutReadWin32Error);
                json.Property("stderr_read_win32_error", outcome.StderrReadWin32Error);
                LaunchInputs.Emit(json, "inputs", outcome.Inputs);
            }
            json.EndObject();

            if (_readiness != null) { _readiness.Emit(json, "readiness", ReadyObserved, ProcessId); }
            json.Property("readiness_reason_code", ReadinessReasonCode);

            json.Name("observations").BeginArray();
            for (int i = 0; i < _observations.Count; i++) { _observations[i].Emit(json); }
            json.EndArray();

            json.Name("long_lived_control").BeginObject();
            json.Property("wait_on_process_handle", LongLivedWaitResult);
            json.Property("window_monotonic_us", LongLivedWindowMicroseconds);
            json.Property("observation_count", LongLivedObservationCount);
            json.Property("still_alive_after_window",
                LongLivedFinal != null && LongLivedFinal.ObservedAlive);
            json.Property("exited_on_its_own", LongLivedWaitResult == "WAIT_OBJECT_0");
            json.EndObject();

            json.Name("stop").BeginObject();
            json.Property("requested", StopRequested);
            json.Property("requested_at", StopRequestedAt);
            json.Property("requested_monotonic_us", StopRequestedMicroseconds);
            json.Property("mechanism", StopMechanism);
            json.Property("kills_by_name", false);
            json.Property("kills_by_process_id", false);
            json.Property("post_stop_wait_result", PostStopWaitResult);
            json.Property("post_stop_wait_win32_error", PostStopWaitWin32Error);
            json.Property("post_stop_exit_code_available", PostStopExitCodeAvailable);
            json.Property("post_stop_exit_code", PostStopExitCode);
            json.Property("post_stop_exit_code_is_job_close_kill",
                PostStopExitCodeAvailable && PostStopExitCode == PanicStopNative.ErrorAbandonedWait0);
            json.Property("death_latency_us", DeathLatencyMicroseconds);
            json.Property("child_proven_dead", AliveAfterStop != null && AliveAfterStop.ObservedExited);
            json.Property("child_proven_alive_after_stop", AliveAfterStop != null && AliveAfterStop.ObservedAlive);
            json.EndObject();

            json.EndObject();
        }

        private static string Cap(string text)
        {
            if (text == null) { return ""; }
            if (text.Length <= 2048) { return text; }
            return text.Substring(0, 2048);
        }

        /// <summary>
        /// الهدم. الـJob يُغلق أولًا إن لم يُغلق: أي ابن بقي داخله يموت قبل أن
        /// يُلمس شيء آخر، ومسار العائق يمرّ من هنا أيضًا فلا يترك ابنًا.
        /// </summary>
        public void Dispose()
        {
            if (_job != null && !_jobClosed)
            {
                try { _job.Dispose(); }
                catch (Exception) { }
                _jobClosed = true;
            }
            if (_child != null)
            {
                try { _child.Dispose(); }
                catch (Exception) { }
                _child = null;
            }
            if (_readiness != null)
            {
                try { _readiness.Release(); }
                catch (Exception) { }
            }
            if (_thread != null)
            {
                try { _thread.Join(5000); }
                catch (Exception) { }
            }
            if (_readiness != null)
            {
                try { _readiness.Close(); }
                catch (Exception) { }
                _readiness = null;
            }
        }
    }
}
