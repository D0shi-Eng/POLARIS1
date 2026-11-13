using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.AccessControl;
using System.Threading;
using Polaris.ConfinementSpike.Launcher.Native;
using Polaris.ConfinementSpike.Shared;

namespace Polaris.ConfinementSpike.Launcher
{
    // منسّق التنفيذ. مسؤوليته ترتيب الأنماط وتشغيلها وجمع النتائج، لا الحكم عليها
    public sealed class ConfinementTestRunner
    {
        private const string ChildProcessName = "polaris-adversarial-child";

        private readonly SpikePaths _paths;
        private readonly ProcessPolicy _processPolicy;
        private readonly TestResultCollector _collector = new TestResultCollector();
        private readonly AppContainerProfileManager _profiles = new AppContainerProfileManager();
        private readonly RestrictedProcessLauncher _launcher = new RestrictedProcessLauncher();
        private readonly List<string> _log = new List<string>();

        public ConfinementTestRunner(SpikePaths paths, ProcessPolicy processPolicy)
        {
            _paths = paths;
            _processPolicy = processPolicy;
        }

        public TestResultCollector Collector { get { return _collector; } }
        public IList<string> Log { get { return _log; } }

        public void RunAll(IList<VariantDefinition> variants, int sentinelPid, int loopbackPort)
        {
            for (int i = 0; i < variants.Count; i++)
            {
                // التنفيذ متسلسل عمدًا حتى لا نرهق الجهاز ولا نخلط الأدلة
                RunVariant(variants[i], sentinelPid, loopbackPort);
                Thread.Sleep(500);
            }
            AttributionAnalyzer.Apply(_collector.Records);
        }

        private void RunVariant(VariantDefinition variant, int sentinelPid, int loopbackPort)
        {
            string evidenceDirectory = Path.Combine(_paths.EvidenceRoot, variant.Id);
            Directory.CreateDirectory(evidenceDirectory);

            string stdoutPath = Path.Combine(evidenceDirectory, "child-stdout.log");
            string stderrPath = Path.Combine(evidenceDirectory, "child-stderr.log");
            string reportPath = Path.Combine(evidenceDirectory, "child-report.tsv");

            AppContainerProfile profile = null;
            CapabilitySet capabilities = null;
            FileScopePolicy scope = new FileScopePolicy();
            JobObjectManager job = null;
            LoopbackExemptionManager loopbackExemption = null;
            IntPtr stdoutHandle = IntPtr.Zero;
            IntPtr stderrHandle = IntPtr.Zero;
            IntPtr leakedHandle = IntPtr.Zero;

            _log.Add("=== VARIANT " + variant.Id + " (" + variant.EnforcementLayer + ") ===");

            try
            {
                if (variant.UseAppContainer)
                {
                    profile = _profiles.CreateOrOpen("PolarisW1-" + variant.Id,
                        "POLARIS W1 " + variant.Id, "Phase 00 confinement spike, temporary profile");
                    _log.Add("APPCONTAINER sid=" + profile.SidString + " created_now=" + profile.CreatedByThisRun);
                    capabilities = CapabilitySet.FromStringSids(variant.Capabilities);
                    _log.Add("CAPABILITIES count=" + capabilities.Count);
                    ApplyFileScope(scope, profile.SidString, evidenceDirectory);
                    for (int i = 0; i < scope.Log.Count; i++) { _log.Add(scope.Log[i]); }

                    if (variant.LoopbackExempt)
                    {
                        loopbackExemption = new LoopbackExemptionManager();
                        bool applied = loopbackExemption.Apply(profile.SidString);
                        for (int i = 0; i < loopbackExemption.Log.Count; i++) { _log.Add(loopbackExemption.Log[i]); }
                        if (!applied)
                        {
                            _log.Add("LOOPBACK exemption could not be applied; N02 in this variant is not attributable");
                        }
                    }
                }

                if (variant.UseJobObject)
                {
                    job = new JobObjectManager();
                    job.Create("PolarisW1Job-" + variant.Id, _processPolicy);
                    for (int i = 0; i < job.Log.Count; i++) { _log.Add(job.Log[i]); }
                }

                stdoutHandle = InheritableFile.CreateForWrite(stdoutPath);
                stderrHandle = InheritableFile.CreateForWrite(stderrPath);

                if (variant.LeakDeniedFileHandle)
                {
                    leakedHandle = InheritableFile.OpenForRead(
                        Path.Combine(_paths.FixtureRoot, @"denied\secret.txt"));
                    _log.Add("DELIBERATE HANDLE LEAK to denied/secret.txt handle=" + leakedHandle.ToInt64());
                }

                LaunchRequest request = BuildRequest(variant, profile, capabilities, job,
                    evidenceDirectory, reportPath, sentinelPid, loopbackPort,
                    stdoutHandle, stderrHandle, leakedHandle);

                LaunchResult result = _launcher.Launch(request);
                _log.Add("LAUNCH created=" + result.Created + " pid=" + result.ProcessId
                    + " exit=" + result.ExitCode + " timed_out=" + result.TimedOut
                    + " assigned_to_job=" + result.AssignedToJob
                    + " stage=" + (result.FailureStage ?? "none")
                    + " win32=" + result.ErrorCode);

                InheritableFile.Close(stdoutHandle); stdoutHandle = IntPtr.Zero;
                InheritableFile.Close(stderrHandle); stderrHandle = IntPtr.Zero;

                if (!result.Created)
                {
                    AddVariantBlocked(variant, evidenceDirectory,
                        "process could not be created at stage " + result.FailureStage
                        + ", win32=" + result.ErrorCode + " (" + Win32ErrorNames.Resolve(result.ErrorCode) + ")");
                    return;
                }

                List<ProbeOutcome> outcomes = ChildReportReader.Read(reportPath, stdoutPath);
                _log.Add("OUTCOMES parsed=" + outcomes.Count);

                if (outcomes.Count == 0)
                {
                    AddVariantBlocked(variant, evidenceDirectory,
                        "the confined process produced no probe outcomes; exit code " + result.ExitCode);
                    return;
                }

                int orphanPid = 0;
                for (int i = 0; i < outcomes.Count; i++)
                {
                    _collector.Judge(variant, outcomes[i], evidenceDirectory);
                    if (outcomes[i].Id == "P04")
                    {
                        orphanPid = OrphanVerifier.ExtractPidFromDetail(outcomes[i].Detail, "orphan_pid=");
                    }
                }

                VerifyOrphanTermination(variant, job, orphanPid, evidenceDirectory);
                job = null; // تم التخلص منه داخل التحقق
            }
            catch (Exception ex)
            {
                AddVariantBlocked(variant, evidenceDirectory,
                    "launcher exception " + ex.GetType().Name + ": " + ex.Message);
                _log.Add("EXCEPTION " + ex.GetType().Name + " " + ex.Message);
            }
            finally
            {
                InheritableFile.Close(stdoutHandle);
                InheritableFile.Close(stderrHandle);
                InheritableFile.Close(leakedHandle);
                if (job != null) { job.Dispose(); }
                scope.RevertAll();
                for (int i = 0; i < scope.Log.Count; i++)
                {
                    if (scope.Log[i].StartsWith("REVERT", StringComparison.Ordinal)) { _log.Add(scope.Log[i]); }
                }
                if (loopbackExemption != null)
                {
                    int before = loopbackExemption.Log.Count;
                    loopbackExemption.Remove();
                    for (int i = before; i < loopbackExemption.Log.Count; i++) { _log.Add(loopbackExemption.Log[i]); }
                }
                if (capabilities != null) { capabilities.Dispose(); }
                if (profile != null)
                {
                    string name = profile.Name;
                    profile.Dispose();
                    int hresult = _profiles.Delete(name);
                    _log.Add("APPCONTAINER profile deleted name=" + name + " hresult=0x" + hresult.ToString("x8"));
                }
            }
        }

        private void ApplyFileScope(FileScopePolicy scope, string sid, string evidenceDirectory)
        {
            string allowed = Path.Combine(_paths.FixtureRoot, "allowed");

            // النطاق الممنوح كله: مجلد العمل المسموح، مجلد الأدلة، ومجلد الثنائيات للقراءة والتنفيذ
            scope.GrantDirectory(sid, allowed, FileSystemRights.Modify | FileSystemRights.Synchronize, true);
            scope.GrantDirectory(sid, evidenceDirectory, FileSystemRights.Modify | FileSystemRights.Synchronize, true);
            scope.GrantDirectory(sid, _paths.BinDirectory, FileSystemRights.ReadAndExecute, true);

            // حق العبور فقط على المجلدات الأعلى، دون سرد أو قراءة
            scope.GrantTraverseChain(sid, allowed, _paths.ProjectRoot);
            scope.GrantTraverseChain(sid, evidenceDirectory, _paths.ProjectRoot);
            scope.GrantTraverseChain(sid, _paths.BinDirectory, _paths.ProjectRoot);
        }

        private LaunchRequest BuildRequest(VariantDefinition variant, AppContainerProfile profile,
            CapabilitySet capabilities, JobObjectManager job, string evidenceDirectory, string reportPath,
            int sentinelPid, int loopbackPort, IntPtr stdoutHandle, IntPtr stderrHandle, IntPtr leakedHandle)
        {
            System.Text.StringBuilder arguments = new System.Text.StringBuilder();
            arguments.Append("--role probe");
            arguments.Append(" --variant ").Append(variant.Id);
            arguments.Append(" --fixture \"").Append(_paths.FixtureRoot).Append('"');
            arguments.Append(" --evidence \"").Append(evidenceDirectory).Append('"');
            arguments.Append(" --report \"").Append(reportPath).Append('"');
            arguments.Append(" --self \"").Append(_paths.ChildExecutable).Append('"');
            arguments.Append(" --sentinel-pid ").Append(sentinelPid.ToString(CultureInfo.InvariantCulture));
            arguments.Append(" --loopback-port ").Append(loopbackPort.ToString(CultureInfo.InvariantCulture));
            arguments.Append(" --max-spawn 12");
            if (leakedHandle != IntPtr.Zero && leakedHandle != ProcessNativeMethods.INVALID_HANDLE_VALUE)
            {
                arguments.Append(" --leaked-handle ").Append(leakedHandle.ToInt64().ToString(CultureInfo.InvariantCulture));
            }

            LaunchRequest request = new LaunchRequest();
            request.ExecutablePath = _paths.ChildExecutable;
            request.Arguments = arguments.ToString();
            request.WorkingDirectory = _paths.BinDirectory;
            request.Profile = profile;
            request.Capabilities = capabilities;
            request.LessPrivilegedAppContainer = variant.LessPrivilegedAppContainer;
            request.StandardOutputHandle = stdoutHandle;
            request.StandardErrorHandle = stderrHandle;
            request.LeakedHandle = (leakedHandle == ProcessNativeMethods.INVALID_HANDLE_VALUE) ? IntPtr.Zero : leakedHandle;
            request.JobHandle = job != null ? job.Handle : IntPtr.Zero;
            request.TimeoutMilliseconds = 180000;
            return request;
        }

        // P04B: إغلاق مقبض الـ job يجب أن يقتل كل ما بقي. خط الأساس بلا job يجب أن يُظهر النجاة
        private void VerifyOrphanTermination(VariantDefinition variant, JobObjectManager job,
            int orphanPid, string evidenceDirectory)
        {
            if (job != null)
            {
                _log.Add(job.DescribeAccounting());
                job.Dispose();
                for (int i = 0; i < job.Log.Count; i++) { _log.Add(job.Log[i]); }
            }

            Thread.Sleep(2500);
            bool alive = OrphanVerifier.IsAlive(orphanPid, ChildProcessName);

            ProbeOutcome outcome = new ProbeOutcome("P04B",
                "check surviving process after confinement teardown",
                alive ? OutcomeKind.Allow : OutcomeKind.Deny,
                0,
                alive ? "PROCESS_ALIVE" : "PROCESS_GONE",
                "orphan_pid=" + orphanPid.ToString(CultureInfo.InvariantCulture)
                    + " surviving=" + (alive ? "1" : "0"));

            _collector.Judge(variant, outcome, evidenceDirectory);

            if (alive)
            {
                bool killed = OrphanVerifier.KillIfAlive(orphanPid, ChildProcessName);
                _log.Add("ORPHAN survived pid=" + orphanPid + " killed_by_launcher=" + killed);
            }
            else
            {
                _log.Add("ORPHAN terminated with the job, pid=" + orphanPid);
            }
        }

        private void AddVariantBlocked(VariantDefinition variant, string evidenceDirectory, string reason)
        {
            TestRecord record = new TestRecord();
            record.Variant = variant.Id;
            record.TestId = "VARIANT";
            record.Category = "validation";
            record.Attempt = "execute the adversarial child under " + variant.EnforcementLayer;
            record.Expected = "execution";
            record.Actual = "not executed";
            record.EnforcementLayer = variant.EnforcementLayer;
            record.OsErrorName = "N/A";
            record.Result = ResultValue.Blocked;
            record.Passed = false;
            record.EvidencePath = evidenceDirectory;
            record.Notes = reason;
            _collector.AddDerived(record);
        }
    }
}
