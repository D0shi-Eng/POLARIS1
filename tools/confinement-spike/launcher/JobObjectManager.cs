using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Polaris.ConfinementSpike.Launcher.Native;

namespace Polaris.ConfinementSpike.Launcher
{
    // مسؤولية واحدة: إنشاء Job Object وتطبيق الحدود عليه وإنهاؤه
    public sealed class JobObjectManager : IDisposable
    {
        private IntPtr _job = IntPtr.Zero;
        private readonly List<string> _log = new List<string>();

        public IntPtr Handle { get { return _job; } }
        public IList<string> Log { get { return _log; } }

        public void Create(string name, ProcessPolicy policy)
        {
            _job = JobNativeMethods.CreateJobObjectW(IntPtr.Zero, name);
            if (_job == IntPtr.Zero)
            {
                throw new InvalidOperationException("CreateJobObject failed, win32=" + Marshal.GetLastWin32Error());
            }

            ApplyExtendedLimits(policy);
            ApplyCpuRateControl(policy);
        }

        private void ApplyExtendedLimits(ProcessPolicy policy)
        {
            JobNativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION info =
                new JobNativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION();

            uint flags = JobNativeMethods.JOB_OBJECT_LIMIT_ACTIVE_PROCESS
                       | JobNativeMethods.JOB_OBJECT_LIMIT_JOB_MEMORY;

            if (policy.KillOnJobClose)
            {
                flags |= JobNativeMethods.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            }

            info.BasicLimitInformation.LimitFlags = flags;
            info.BasicLimitInformation.ActiveProcessLimit = policy.ActiveProcessLimit;
            info.JobMemoryLimit = new UIntPtr((ulong)policy.JobMemoryLimitMegabytes * 1024UL * 1024UL);

            int size = Marshal.SizeOf(typeof(JobNativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(info, buffer, false);
                if (!JobNativeMethods.SetInformationJobObject(
                        _job, JobNativeMethods.JobObjectExtendedLimitInformation, buffer, (uint)size))
                {
                    throw new InvalidOperationException(
                        "SetInformationJobObject(ExtendedLimit) failed, win32=" + Marshal.GetLastWin32Error());
                }
                _log.Add("JOB limits: active_process_limit=" + policy.ActiveProcessLimit
                    + " job_memory_mb=" + policy.JobMemoryLimitMegabytes
                    + " kill_on_job_close=" + policy.KillOnJobClose
                    + " breakaway_ok=" + policy.AllowBreakaway);
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        private void ApplyCpuRateControl(ProcessPolicy policy)
        {
            JobNativeMethods.JOBOBJECT_CPU_RATE_CONTROL_INFORMATION info =
                new JobNativeMethods.JOBOBJECT_CPU_RATE_CONTROL_INFORMATION();
            info.ControlFlags = JobNativeMethods.JOB_OBJECT_CPU_RATE_CONTROL_ENABLE
                              | JobNativeMethods.JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP;
            info.CpuRate = policy.CpuRatePercent * 100;

            int size = Marshal.SizeOf(typeof(JobNativeMethods.JOBOBJECT_CPU_RATE_CONTROL_INFORMATION));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(info, buffer, false);
                bool ok = JobNativeMethods.SetInformationJobObject(
                    _job, JobNativeMethods.JobObjectCpuRateControlInformation, buffer, (uint)size);
                _log.Add(ok
                    ? "JOB cpu hard cap: " + policy.CpuRatePercent + "%"
                    : "JOB cpu rate control NOT applied, win32=" + Marshal.GetLastWin32Error());
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        public bool Assign(IntPtr processHandle)
        {
            return JobNativeMethods.AssignProcessToJobObject(_job, processHandle);
        }

        // وصف نصي لمحاسبة الـ job، يُستخدم دليلًا على عدد العمليات التي مرت داخل الحدود
        public string DescribeAccounting()
        {
            int size = Marshal.SizeOf(typeof(JobNativeMethods.JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                if (!JobNativeMethods.QueryInformationJobObject(
                        _job, JobNativeMethods.JobObjectBasicAccountingInformation, buffer, (uint)size, IntPtr.Zero))
                {
                    return "JOB accounting unavailable, win32=" + Marshal.GetLastWin32Error();
                }

                JobNativeMethods.JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info =
                    (JobNativeMethods.JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)
                    Marshal.PtrToStructure(buffer, typeof(JobNativeMethods.JOBOBJECT_BASIC_ACCOUNTING_INFORMATION));

                return "JOB accounting: total_processes=" + info.TotalProcesses
                    + " active_processes=" + info.ActiveProcesses
                    + " terminated_processes=" + info.TotalTerminatedProcesses;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }

        public void Terminate()
        {
            if (_job != IntPtr.Zero)
            {
                JobNativeMethods.TerminateJobObject(_job, 1);
                _log.Add("JOB terminated explicitly");
            }
        }

        public void Dispose()
        {
            if (_job != IntPtr.Zero)
            {
                // إغلاق المقبض يفعّل KILL_ON_JOB_CLOSE، وهو ما نختبره في P04
                ProcessNativeMethods.CloseHandle(_job);
                _job = IntPtr.Zero;
                _log.Add("JOB handle closed");
            }
        }
    }
}
